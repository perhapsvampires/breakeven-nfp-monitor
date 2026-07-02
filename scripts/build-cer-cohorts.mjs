// Offline data-prep for the Employ America CER model.
//
// Pulls Census CPS Basic Monthly microdata and aggregates weighted employment
// and population for {native, foreign-born} × age-band cohorts, then writes
// data/cer-cohorts.json. Heavy compute runs here (offline); the dashboard reads
// the cached JSON. Re-run monthly after each CPS release:
//
//   node scripts/build-cer-cohorts.mjs
//
// Recodes validated against BLS (Jan 2025): employed 162.4M vs ~161.4M,
// foreign-born employed 31.7M vs ~32M.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function getCensusKey() {
  if (process.env.CENSUS_API_KEY) return process.env.CENSUS_API_KEY
  const keyPath = join(ROOT, 'census_api_key.txt')
  if (existsSync(keyPath)) return readFileSync(keyPath, 'utf8').trim()
  throw new Error(
    'Census API key not found: set CENSUS_API_KEY env var or create census_api_key.txt',
  )
}
const KEY = getCensusKey()

const START_YEAR = 2018
const END_YEAR = 2026
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const CONCURRENCY = 2
// Completeness check: a complete pull contains all 51 state codes (50 + DC).
// A truncated/partial API response drops states, so we require all 51 and
// re-fetch otherwise. Record count varies legitimately (~89-98k), so it's only
// a loose floor; employment range is a secondary sanity guard.
const EXPECTED_STATES = 51
const MIN_RECORDS = 60000
const MIN_EMP = 125_000_000
const MAX_EMP = 175_000_000

// Age bands partition the 16+ population. (Employ America crosses these with
// foreign-born status; their caption omits 45-54, almost certainly a typo, so
// we keep a complete partition.)
const AGE_BANDS = [
  { band: '16-24', min: 16, max: 24 },
  { band: '25-34', min: 25, max: 34 },
  { band: '35-44', min: 35, max: 44 },
  { band: '45-54', min: 45, max: 54 },
  { band: '55-64', min: 55, max: 64 },
  { band: '65+', min: 65, max: 200 },
]

const COHORTS = []
for (const nat of ['native', 'fb']) {
  for (const a of AGE_BANDS) {
    COHORTS.push({ id: `${nat}-${a.band}`, nativity: nat, band: a.band, ageMin: a.min, ageMax: a.max })
  }
}

function bandFor(age) {
  for (const a of AGE_BANDS) if (age >= a.min && age <= a.max) return a.band
  return null
}

async function fetchMonthRows(year, monthName) {
  const url = `https://api.census.gov/data/${year}/cps/basic/${monthName}?get=PRTAGE,PRCITSHP,PEMLR,PWSSWGT&for=state:*&key=${KEY}`
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
      const empPersons = out._total.emp * 1000
      if (empPersons < MIN_EMP || empPersons > MAX_EMP) {
        throw new Error(`employment ${(empPersons / 1e6).toFixed(1)}M out of range`)
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
  const iCit = h.indexOf('PRCITSHP')
  const iEmp = h.indexOf('PEMLR')
  const iW = h.indexOf('PWSSWGT')
  const iState = h.indexOf('state')

  const acc = {}
  for (const c of COHORTS) acc[c.id] = { emp: 0, pop: 0 }
  let totEmp = 0
  let totPop = 0
  const states = new Set()

  for (let k = 1; k < rows.length; k++) {
    const r = rows[k]
    if (iState >= 0) states.add(r[iState])
    const age = +r[iAge]
    const w = +r[iW]
    if (age < 16 || !(w > 0)) continue
    const band = bandFor(age)
    if (!band) continue
    const cit = +r[iCit]
    const nat = cit === 4 || cit === 5 ? 'fb' : 'native'
    const id = `${nat}-${band}`
    const employed = +r[iEmp] === 1 || +r[iEmp] === 2

    acc[id].pop += w
    totPop += w
    if (employed) {
      acc[id].emp += w
      totEmp += w
    }
  }

  // Convert persons -> thousands, round to 0.1k.
  const out = {}
  for (const c of COHORTS) {
    out[c.id] = {
      emp: Math.round(acc[c.id].emp / 100) / 10,
      pop: Math.round(acc[c.id].pop / 100) / 10,
    }
  }
  out._total = {
    emp: Math.round(totEmp / 100) / 10,
    pop: Math.round(totPop / 100) / 10,
  }
  out._states = states.size
  return out
}

async function main() {
  const jobs = []
  for (let y = START_YEAR; y <= END_YEAR; y++) {
    for (let m = 0; m < 12; m++) {
      jobs.push({ year: y, mIdx: m, monthName: MONTHS[m] })
    }
  }

  const months = {}
  let done = 0
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const batch = jobs.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (j) => {
        const out = await getMonth(j.year, j.monthName)
        return { j, out }
      }),
    )
    for (const { j, out } of results) {
      done++
      if (!out) continue
      const dateKey = `${j.year}-${String(j.mIdx + 1).padStart(2, '0')}-01`
      months[dateKey] = out
    }
    const last = batch[batch.length - 1]
    console.log(`  ...${done}/${jobs.length} (through ${last.year}-${last.monthName})`)
  }

  const sortedKeys = Object.keys(months).sort()
  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: 'U.S. Census Bureau, CPS Basic Monthly microdata',
      weight: 'PWSSWGT',
      recodes: {
        foreignBorn: 'PRCITSHP in {4,5}',
        employed: 'PEMLR in {1,2}',
        universe: 'PRTAGE >= 16 and PWCMPWGT > 0',
      },
      units: 'thousands of persons',
      firstMonth: sortedKeys[0],
      lastMonth: sortedKeys[sortedKeys.length - 1],
      monthCount: sortedKeys.length,
    },
    cohorts: COHORTS,
    months,
  }

  const outPath = join(ROOT, 'data', 'cer-cohorts.json')
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(payload))
  console.log(`\nWrote ${outPath}`)
  console.log(`Months: ${payload.meta.firstMonth} … ${payload.meta.lastMonth} (${payload.meta.monthCount})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
