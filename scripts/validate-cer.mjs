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
const data = JSON.parse(readFileSync(join(ROOT, 'data', 'cer-cohorts.json'), 'utf8'))

const COHORT_IDS = data.cohorts.map((c) => c.id)

function shiftMonths(date, delta) {
  const [y, m] = date.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`
}

async function fetchPayems() {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=PAYEMS&api_key=${FRED_KEY}&file_type=json&observation_start=2016-01-01`
  const j = await (await fetch(url)).json()
  const m = new Map()
  for (const o of j.observations) if (o.value !== '.') m.set(o.date, parseFloat(o.value))
  return m
}

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

const payems = await fetchPayems()
console.log('month   | mine | chart | diff')
let n = 0, sae = 0, sMine = 0, sChart = 0
for (const ym of Object.keys(CHART)) {
  const d = `${ym}-01`
  const base = shiftMonths(d, -12)
  const nc = payems.get(d)
  const nb = payems.get(base)
  if (nc == null || nb == null) { console.log(`${ym} | (no payroll)`); continue }
  const gEpr = eprChange(d, base)
  if (gEpr == null) { console.log(`${ym} | (no cohort data for ${d} or ${base})`); continue }
  const gN = Math.log(nc / nb)
  const brk = Math.round(((gN - gEpr) * nc) / 12)
  const ch = CHART[ym]
  console.log(`${ym} | ${String(brk).padStart(4)} | ${String(ch).padStart(5)} | ${String(brk - ch).padStart(5)}`)
  n++; sae += Math.abs(brk - ch); sMine += brk; sChart += ch
}
console.log(`\nN=${n}  mean(mine)=${(sMine / n).toFixed(0)}  mean(chart)=${(sChart / n).toFixed(0)}  MAE=${(sae / n).toFixed(0)}k`)
