// Offline data-prep for the SF Fed breakeven model's forward projection.
//
// Pulls Census CPS Basic Monthly microdata and computes trend labor-force-
// participation (LFP) rates by demographic group g = (age band × sex), over the
// most recent 24 available months. The breakeven model projects the labor force
// forward as:  labor force = Σ_group population × trend_LFP.
//
//   node scripts/build-sf-lfp.mjs
//
// Recodes:
//   age   = PRTAGE (universe: age >= 16, PWSSWGT > 0)
//   sex   = PESEX  (1=Male, 2=Female)
//   labor force = PEMLR in {1,2,3,4} (employed or unemployed)
//   weight= PWSSWGT (used as-is; already carries decimals; summed it reproduces
//           CLF16OV — verified). Persons -> thousands by /1000.
//
// Validation: the latest-month total labor force reconciles with FRED CLF16OV.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const KEY = readFileSync(join(ROOT, 'census_api_key.txt'), 'utf8').trim()
const FRED_KEY = readFileSync(join(ROOT, 'fred_api_key.txt'), 'utf8').trim()

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const CONCURRENCY = 3
const TREND_WINDOW = 24

// Completeness check: a complete pull contains all 51 state codes (50 + DC).
const EXPECTED_STATES = 51
const MIN_RECORDS = 60000

const AGE_BANDS = [
  { band: '16-24', min: 16, max: 24 },
  { band: '25-34', min: 25, max: 34 },
  { band: '35-44', min: 35, max: 44 },
  { band: '45-54', min: 45, max: 54 },
  { band: '55-64', min: 55, max: 64 },
  { band: '65+', min: 65, max: 200 },
]

const SEXES = [
  { sex: 'M', code: 1 },
  { sex: 'F', code: 2 },
]

const GROUPS = []
for (const s of SEXES) {
  for (const a of AGE_BANDS) {
    GROUPS.push({ id: `${s.sex}-${a.band}`, sex: s.sex, sexCode: s.code, ageBand: a.band, ageMin: a.min, ageMax: a.max })
  }
}

function bandFor(age) {
  for (const a of AGE_BANDS) if (age >= a.min && age <= a.max) return a.band
  return null
}

async function fetchMonthRows(year, monthName) {
  const url = `https://api.census.gov/data/${year}/cps/basic/${monthName}?get=PRTAGE,PESEX,PEMLR,PWSSWGT&for=state:*&key=${KEY}`
  const res = await fetch(url)
  if (res.status === 404) return null // month not released
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const rows = await res.json()
  if (!Array.isArray(rows) || rows.length - 1 < MIN_RECORDS) {
    throw new Error(`only ${Array.isArray(rows) ? rows.length - 1 : '?'} records (truncated)`)
  }
  return rows
}

/** Fetch + aggregate one month with validation and retry. */
async function getMonth(year, monthName) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const rows = await fetchMonthRows(year, monthName)
      if (rows === null) return null
      const out = aggregate(rows)
      if (out._states !== EXPECTED_STATES) {
        throw new Error(`only ${out._states}/${EXPECTED_STATES} states (partial)`)
      }
      delete out._states
      return out
    } catch (err) {
      if (attempt === 4) {
        console.warn(`  ${year}-${monthName}: FAILED after retries (${err.message})`)
        return null
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
  return null
}

function aggregate(rows) {
  const h = rows[0]
  const iAge = h.indexOf('PRTAGE')
  const iSex = h.indexOf('PESEX')
  const iEmp = h.indexOf('PEMLR')
  const iW = h.indexOf('PWSSWGT')
  const iState = h.indexOf('state')

  const acc = {}
  for (const g of GROUPS) acc[g.id] = { pop: 0, lf: 0 }
  const states = new Set()

  for (let k = 1; k < rows.length; k++) {
    const r = rows[k]
    if (iState >= 0) states.add(r[iState])
    const age = +r[iAge]
    const w = +r[iW]
    if (age < 16 || !(w > 0)) continue
    const band = bandFor(age)
    if (!band) continue
    const sexCode = +r[iSex]
    const sex = sexCode === 1 ? 'M' : sexCode === 2 ? 'F' : null
    if (!sex) continue
    const id = `${sex}-${band}`
    const mlr = +r[iEmp]
    const inLF = mlr >= 1 && mlr <= 4

    acc[id].pop += w
    if (inLF) acc[id].lf += w
  }

  // Keep person-weight sums (not yet thousands); LFP computed from raw sums.
  const out = { groups: {} }
  for (const g of GROUPS) out.groups[g.id] = { pop: acc[g.id].pop, lf: acc[g.id].lf }
  out._states = states.size
  return out
}

/** Determine the most recent available month, then collect 24 going backward. */
async function collectMonths() {
  const now = new Date()
  // Start probing from current month and walk back; CPS latest is usually ~1-2
  // months stale. We gather months (most recent first) until we have 24.
  const months = []
  const skipped = []
  let y = now.getUTCFullYear()
  let m = now.getUTCMonth() // 0-based
  let probes = 0
  const MAX_PROBES = 24 + 18 // allow generous lookback for skips

  while (months.length < TREND_WINDOW && probes < MAX_PROBES) {
    probes++
    const monthName = MONTHS[m]
    const out = await getMonth(y, monthName)
    const dateKey = `${y}-${String(m + 1).padStart(2, '0')}-01`
    if (out) {
      months.push({ dateKey, year: y, mIdx: m, data: out })
      console.log(`  ok   ${dateKey} (${months.length}/${TREND_WINDOW})`)
    } else {
      skipped.push(dateKey)
      console.log(`  skip ${dateKey} (404/incomplete)`)
    }
    // step back one month
    m--
    if (m < 0) { m = 11; y-- }
  }
  // sort ascending by date
  months.sort((a, b) => a.dateKey.localeCompare(b.dateKey))
  return { months, skipped }
}

async function fetchCLF16OV(latestDateKey) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=CLF16OV&observation_start=${latestDateKey}&observation_end=${latestDateKey}&file_type=json&api_key=${FRED_KEY}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`FRED HTTP ${res.status}`)
  const json = await res.json()
  const obs = json.observations && json.observations[0]
  if (!obs || obs.value === '.') return null
  return +obs.value // thousands
}

async function main() {
  console.log('Collecting most recent 24 available CPS months...')
  const { months, skipped } = await collectMonths()
  if (months.length === 0) throw new Error('No months collected')

  const latest = months[months.length - 1]
  const latestKey = latest.dateKey

  // Trend LFP per group = mean of monthly LFP over the window.
  const groupOut = []
  let totLatestLF = 0
  let totLatestPop = 0
  for (const g of GROUPS) {
    let lfpSum = 0
    let lfpN = 0
    for (const mo of months) {
      const gg = mo.data.groups[g.id]
      if (gg && gg.pop > 0) {
        lfpSum += gg.lf / gg.pop
        lfpN++
      }
    }
    const trendLFP = lfpN > 0 ? lfpSum / lfpN : 0
    const lg = latest.data.groups[g.id]
    const latestPop = lg.pop / 1000
    const latestLF = lg.lf / 1000
    totLatestLF += latestLF
    totLatestPop += latestPop
    groupOut.push({
      id: g.id,
      sex: g.sex,
      ageBand: g.ageBand,
      trendLFP: Math.round(trendLFP * 100000) / 100000,
      latestPop: Math.round(latestPop * 10) / 10,
      latestLF: Math.round(latestLF * 10) / 10,
    })
  }

  totLatestLF = Math.round(totLatestLF * 10) / 10
  totLatestPop = Math.round(totLatestPop * 10) / 10

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: 'U.S. Census Bureau, CPS Basic Monthly microdata',
      weight: 'PWSSWGT',
      trendWindowMonths: TREND_WINDOW,
      latestMonth: latestKey,
      monthsUsed: months.length,
    },
    ageBands: AGE_BANDS.map((a) => a.band),
    groups: groupOut,
    totals: { latestLF: totLatestLF, latestPop: totLatestPop },
  }

  const outPath = join(ROOT, 'data', 'sf-lfp.json')
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(payload, null, 2))
  console.log(`\nWrote ${outPath}`)
  console.log(`Latest month: ${latestKey}, months used: ${months.length}`)
  if (skipped.length) console.log(`Skipped: ${skipped.join(', ')}`)

  // Reconciliation vs FRED CLF16OV.
  let clf = null
  try {
    clf = await fetchCLF16OV(latestKey)
  } catch (e) {
    console.warn(`FRED fetch failed: ${e.message}`)
  }
  console.log('\n--- Reconciliation (latest month total labor force) ---')
  console.log(`  Microdata Σ groups latestLF: ${totLatestLF.toFixed(1)} thousand`)
  if (clf != null) {
    const pctDiff = ((totLatestLF - clf) / clf) * 100
    console.log(`  FRED CLF16OV ${latestKey}:      ${clf.toFixed(1)} thousand`)
    console.log(`  Difference:                   ${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(2)}%`)
    console.log(`  Status: ${Math.abs(pctDiff) <= 1 ? 'PASS (within 1%)' : 'FAIL (>1%)'}`)
  } else {
    console.log(`  FRED CLF16OV ${latestKey}: not available`)
  }

  // Print group table.
  console.log('\n--- Groups ---')
  console.log('  id          trendLFP   latestPop(k)  latestLF(k)')
  for (const g of groupOut) {
    console.log(
      `  ${g.id.padEnd(10)}  ${(g.trendLFP * 100).toFixed(1).padStart(6)}%  ${g.latestPop
        .toFixed(1)
        .padStart(11)}  ${g.latestLF.toFixed(1).padStart(11)}`,
    )
  }
  console.log(`  TOTAL pop=${totLatestPop.toFixed(1)}k  LF=${totLatestLF.toFixed(1)}k`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
