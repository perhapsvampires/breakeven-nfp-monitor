// Standalone validation of the foreign-born × age CER series against the
// published Employ America chart (CER breakeven_graph-1.png). Reads the cached
// cohort JSON + live PAYEMS, prints my values vs approximate chart readings.
//
//   node scripts/validate-cer.mjs

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FRED_KEY = readFileSync(join(ROOT, 'fred_api_key.txt'), 'utf8').trim()
// Optional --cohorts=<path> lets you validate an alternative cohort file (e.g.
// a pre-rebuild backup) against the same chart readings, for A/B comparison.
const cohortsArg = process.argv.find((a) => a.startsWith('--cohorts='))
const COHORTS_PATH = cohortsArg
  ? cohortsArg.slice('--cohorts='.length)
  : join(ROOT, 'data', 'cer-cohorts.json')
const data = JSON.parse(readFileSync(COHORTS_PATH, 'utf8'))

const COHORT_IDS = data.cohorts.map((c) => c.id)

function shiftMonths(date, delta) {
  const [y, m] = date.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`
}

async function fetchFred(seriesId) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&observation_start=2016-01-01`
  const j = await (await fetch(url)).json()
  const m = new Map()
  for (const o of j.observations) if (o.value !== '.') m.set(o.date, parseFloat(o.value))
  return m
}

const fetchPayems = () => fetchFred('PAYEMS')

function eprChange(current, base) {
  const cur = data.months[current]
  const bas = data.months[base]
  if (!cur || !bas) return null
  let weighted = 0
  let baseEmp = 0
  for (const id of COHORT_IDS) {
    const cb = bas[id]
    const cc = cur[id]
    if (!cb || !cc || cb.pop <= 0 || cc.pop <= 0 || cb.emp <= 0) return null
    const eBase = cb.emp / cb.pop
    const eCur = cc.emp / cc.pop
    weighted += cb.emp * (eCur / eBase)
    baseEmp += cb.emp
  }
  return Math.log(weighted / baseEmp)
}

// Approximate readings off CER breakeven_graph-1.png.
const CHART = {
  '2024-01': 140, '2024-02': 158, '2024-03': 135, '2024-04': 150, '2024-05': 170,
  '2024-06': 185, '2024-07': 190, '2024-08': 178, '2024-09': 183, '2024-10': 150,
  '2024-11': 150, '2024-12': 135, '2025-01': 110, '2025-02': 40, '2025-03': 15,
  '2025-04': 50, '2025-05': 60, '2025-06': 85, '2025-07': 110, '2025-08': 75,
  '2025-09': 55, '2025-10': 35, '2025-11': 30, '2025-12': 8, '2026-01': 10,
  '2026-02': 20, '2026-03': 35, '2026-04': 50,
}

// g_A = ln(A_t'/A_t), A = LNS16000000 (BLS) / CE16OV (FRED) — the paper's
// CPS->CES definition adjustment. Must be included here or this script cannot
// validate what lib/models/employAmericaCER.ts actually computes.
async function fetchAdjustment() {
  const startYear = 2016
  const endYear = new Date().getFullYear()
  const blsUrl =
    `https://api.bls.gov/publicAPI/v2/timeseries/data/LNS16000000` +
    `?startyear=${startYear}&endyear=${endYear}`
  const bls = await (await fetch(blsUrl)).json()
  if (bls.status !== 'REQUEST_SUCCEEDED') {
    console.warn(`  WARNING: BLS unavailable (${JSON.stringify(bls.message)}); g_A treated as 0`)
    return null
  }
  const adj = new Map()
  for (const row of bls.Results?.series?.[0]?.data ?? []) {
    if (!/^M(0[1-9]|1[0-2])$/.test(row.period)) continue
    if (row.value === '-' || row.value === '') continue
    adj.set(`${row.year}-${row.period.slice(1)}-01`, parseFloat(row.value))
  }
  const ce = await fetchFred('CE16OV')
  const out = new Map()
  for (const [d, v] of adj) {
    const t = ce.get(d)
    if (t != null && t > 0 && v > 0) out.set(d, v / t)
  }
  return out
}

const payems = await fetchPayems()
const adjLevel = await fetchAdjustment()

console.log('month   | mine | chart | diff |   g_A')
let n = 0, sae = 0, sMine = 0, sChart = 0, nAdj = 0
for (const ym of Object.keys(CHART)) {
  const d = `${ym}-01`
  const base = shiftMonths(d, -12)
  const nc = payems.get(d)
  const nb = payems.get(base)
  if (nc == null || nb == null) { console.log(`${ym} | (no payroll)`); continue }
  const gEpr = eprChange(d, base)
  if (gEpr == null) { console.log(`${ym} | (no cohort data for ${d} or ${base})`); continue }
  const gN = Math.log(nc / nb)
  const aCur = adjLevel?.get(d)
  const aBase = adjLevel?.get(base)
  const gAdj = aCur != null && aBase != null ? Math.log(aCur / aBase) : 0
  if (gAdj !== 0) nAdj++
  const brk = Math.round(((gN - gEpr - gAdj) * nc) / 12)
  const ch = CHART[ym]
  const gAdjK = Math.round((gAdj * nc) / 12)
  console.log(
    `${ym} | ${String(brk).padStart(4)} | ${String(ch).padStart(5)} | ${String(brk - ch).padStart(4)} | ${String(gAdjK).padStart(5)}`,
  )
  n++; sae += Math.abs(brk - ch); sMine += brk; sChart += ch
}
const bias = (sMine - sChart) / n
console.log(
  `\nN=${n} (g_A on ${nAdj})  mean(mine)=${(sMine / n).toFixed(0)}  ` +
  `mean(chart)=${(sChart / n).toFixed(0)}  bias=${bias > 0 ? '+' : ''}${bias.toFixed(0)}k  ` +
  `MAE=${(sae / n).toFixed(0)}k`,
)
console.log(`cohorts: ${COHORT_IDS.length}  (${data.meta.firstMonth} -> ${data.meta.lastMonth})`)
