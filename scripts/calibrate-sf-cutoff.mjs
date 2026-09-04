// Calibrate SHORT_CUTOFF for the SF Fed model (lib/models/sfFed.ts) against the
// published anchors in Petrosky-Nadeau & Stewart, FRBSF EL 2024-18.
//
//   node scripts/calibrate-sf-cutoff.mjs
//
// Supersedes the former scripts/validate-sf.mjs, which was written before the
// model and never updated: it de-stepped, swept cutoffs [12,18], and projected
// with a terminal-growth ramp rather than the Census NPP x trend-LFP method the
// model actually uses. Recover it with `git show 90fd5f6:scripts/validate-sf.mjs`
// if ever needed.
//
// The paper's stated definition is "movements as frequent as every six months"
// -> cutoff 6. This script checks what each candidate cutoff actually produces.
//
// REPLICATION VINTAGE: the CF filter is two-sided and full-sample, so running
// today's data cannot reproduce a 2024 publication - the filter would see two
// extra years the authors never had. We therefore truncate the labor force
// series at 2024-04 (the paper: CPS microdata "available from January 1976 to
// April 2024") and splice the forward projection from there.
//
// Published anchors (baseline scenario):
//   long-run  ~72k/month in 2024
//   short-run ~145k/month in Q1 2024 (breakeven ~140k)
//   short-run converges to long-run by end-2025
//
// TRend-LFP VINTAGE: tested and ruled out as a source of error. Building an
// as-of-2024-04 vintage (build-sf-lfp.mjs --end=2024-04 --out=...) and passing
// it via --lfp reproduces the numbers below to four decimal places. The reason:
// the projection normalises by W(lastRealized), so only the cross-group LFP
// PATTERN survives, and that pattern is stable over two years. (The weighting
// itself is not negligible — it halves projected growth vs unweighted
// population, 0.36%/yr vs 0.72%/yr — it is just vintage-insensitive.)

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FRED_KEY = readFileSync(join(ROOT, 'fred_api_key.txt'), 'utf8').trim()

const U = 0.038
const LONG_CUTOFF = 480
const CANDIDATES = [6, 12, 18, 72]
const SAMPLE_END = '2024-04-01'
const COVID_FROM = '2020-02-01'
const COVID_TO = '2021-07-01'

// --lfp=<path> supplies an as-of trend-LFP vintage built by
//   node scripts/build-sf-lfp.mjs --end=2024-04 --out=<path>
// Without it the current production file is used, which is anachronistic for a
// 2024 replication (see KNOWN IMPRECISION above).
const lfpArg = process.argv.find((a) => a.startsWith('--lfp='))
const LFP_PATH = lfpArg ? lfpArg.slice('--lfp='.length) : join(ROOT, 'data', 'sf-lfp.json')
const sfLfp = JSON.parse(readFileSync(LFP_PATH, 'utf8'))
const popProj = JSON.parse(
  readFileSync(join(ROOT, 'data', 'population-projections.json'), 'utf8'),
)

// ---- filters (mirrors lib/filters.ts) ----------------------------------------
function cfLowPass(series, cutoffPeriod, drift = true) {
  const T = series.length
  if (T <= 1) return series.slice()
  const slope = (series[T - 1] - series[0]) / (T - 1)
  const x = drift ? series.map((v, t) => v - t * slope) : series.slice()
  const b = (2 * Math.PI) / cutoffPeriod
  const B0 = b / Math.PI
  const B = new Float64Array(T + 1)
  B[0] = B0
  for (let j = 1; j <= T; j++) B[j] = Math.sin(j * b) / (j * Math.PI)
  const prefix = new Float64Array(T + 2)
  for (let k = 0; k <= T; k++) prefix[k + 1] = prefix[k] + B[k]
  const sumB = (lo, hi) => {
    const l = Math.max(lo, 0)
    const h = Math.min(hi, T + 1)
    return h <= l ? 0 : prefix[h] - prefix[l]
  }
  const out = new Array(T)
  for (let t = 0; t < T; t++) {
    const fut = T - 1 - t
    const past = t
    const Bfut = sumB(1, fut)
    const Bpast = sumB(1, past)
    const Bend = -0.5 * B[0] - Bfut
    const Aend = -B[0] - Bfut - Bpast - Bend
    let acc = B[0] * x[t] + Bend * x[T - 1] + Aend * x[0]
    for (let j = 1; j < fut; j++) acc += B[j] * x[t + j]
    for (let j = 1; j < past; j++) acc += B[j] * x[t - j]
    out[t] = drift ? acc + series[0] + t * slope : acc
  }
  return out
}

function deStepJanuary(series, kSigma = 3) {
  const T = series.length
  const raw = series.map((o) => o.value)
  if (T < 14) return raw
  const dRaw = new Array(T).fill(0)
  for (let i = 1; i < T; i++) dRaw[i] = raw[i] - raw[i - 1]
  const nonJan = []
  for (let i = 1; i < T; i++) {
    if (series[i].date.slice(5, 7) !== '01') nonJan.push(dRaw[i])
  }
  nonJan.sort((a, b) => a - b)
  const med = nonJan[Math.floor(nonJan.length / 2)]
  const madArr = nonJan.map((v) => Math.abs(v - med)).sort((a, b) => a - b)
  const sigma = 1.4826 * (madArr[Math.floor(madArr.length / 2)] || 1)
  const adjusted = raw.slice()
  let cumStep = 0
  for (let i = 1; i < T; i++) {
    if (series[i].date.slice(5, 7) === '01') {
      const neigh = []
      for (let k = i - 3; k <= i + 3; k++) {
        if (k <= 0 || k >= T || k === i) continue
        if (series[k].date.slice(5, 7) === '01') continue
        neigh.push(dRaw[k])
      }
      const base = neigh.length ? neigh.reduce((a, b) => a + b, 0) / neigh.length : med
      const excess = dRaw[i] - base
      if (Math.abs(excess) > kSigma * sigma) cumStep += excess
    }
    adjusted[i] = raw[i] - cumStep
  }
  return adjusted
}

// ---- projection (mirrors lib/models/sfFed.ts) --------------------------------
function shiftMonths(date, delta) {
  const [y, m] = date.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`
}

function annualWeightedPop(scenario) {
  const lfp = new Map((sfLfp.groups ?? []).map((g) => [g.id, g.trendLFP]))
  const rows = (popProj.byScenario ?? {})[scenario] ?? []
  const out = new Map()
  for (const r of rows) {
    const rate = lfp.get(`${r.sex}-${r.ageBand}`)
    if (rate == null) continue
    out.set(r.year, (out.get(r.year) ?? 0) + r.pop * rate)
  }
  return out
}

function interpAnnual(annual, date) {
  const years = [...annual.keys()].sort((a, b) => a - b)
  const lo = years[0]
  const hi = years[years.length - 1]
  const [y, mo] = date.split('-').map(Number)
  const x = y + (mo - 0.5) / 12
  const clamped = Math.max(lo + 0.5, Math.min(hi + 0.5, x))
  const a = Math.floor(clamped - 0.5)
  const b = Math.min(a + 1, hi)
  const wa = annual.get(a)
  const wb = annual.get(b)
  return b === a ? wa : wa + (wb - wa) * (clamped - (a + 0.5))
}

function interpolateCovid(dates, levels) {
  const i0 = dates.indexOf(COVID_FROM)
  const i1 = dates.indexOf(COVID_TO)
  if (i0 < 0 || i1 < 0 || i1 <= i0) return levels.slice()
  const out = levels.slice()
  for (let i = i0 + 1; i < i1; i++) {
    out[i] = levels[i0] + (levels[i1] - levels[i0]) * ((i - i0) / (i1 - i0))
  }
  return out
}

// ---- run ---------------------------------------------------------------------
const url =
  `https://api.stlouisfed.org/fred/series/observations?series_id=CLF16OV` +
  `&api_key=${FRED_KEY}&file_type=json&observation_start=1948-01-01`
const json = await (await fetch(url)).json()
const all = json.observations
  .filter((o) => o.value !== '.')
  .map((o) => ({ date: o.date, value: parseFloat(o.value) }))

const clf = all.filter((o) => o.date <= SAMPLE_END)
const dates = clf.map((o) => o.date)
const lastRealized = dates[dates.length - 1]
// Mirrors production: de-stepping is OFF by default (see lib/models/sfFed.ts).
// Pass --destep to re-enable it for comparison.
const DESTEP = process.argv.includes('--destep')
const adjusted = interpolateCovid(dates, DESTEP ? deStepJanuary(clf) : clf.map((o) => o.value))
const realizedLast = adjusted[adjusted.length - 1]

const annualBase = annualWeightedPop('baseline')
const wLast = interpAnnual(annualBase, lastRealized)
const projDates = []
let d = shiftMonths(lastRealized, 1)
const projEnd = `${Math.max(...annualBase.keys())}-12-01`
while (d <= projEnd) {
  projDates.push(d)
  d = shiftMonths(d, 1)
}
const proj = projDates.map((dt) => (realizedLast * interpAnnual(annualBase, dt)) / wLast)

const fullDates = dates.concat(projDates)
const levels = adjusted.concat(proj)

function breakevenSeries(cutoff) {
  const f = cfLowPass(levels, cutoff)
  return f.map((v, i) => (i === 0 ? 0 : (v - f[i - 1]) * (1 - U)))
}

const idx = new Map(fullDates.map((dt, i) => [dt, i]))
const avg = (series, from, to) => {
  const vals = fullDates
    .filter((dt) => dt >= from && dt <= to)
    .map((dt) => series[idx.get(dt)])
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

const longRun = breakevenSeries(LONG_CUTOFF)
console.log(`Sample truncated at ${lastRealized} (paper vintage), u = ${U}\n`)
console.log(`long-run (cutoff ${LONG_CUTOFF}) 2024 avg : ${avg(longRun, '2024-01-01', '2024-12-01').toFixed(0)}k   [paper ~72k]\n`)

console.log('cutoff   Q1-2024 avg   [paper ~145k]   2025-12 (converged?)   [paper ~long-run]')
for (const c of CANDIDATES) {
  const s = breakevenSeries(c)
  const q1 = avg(s, '2024-01-01', '2024-03-01')
  const end25 = avg(s, '2025-10-01', '2025-12-01')
  console.log(
    `${String(c).padStart(6)}${q1.toFixed(0).padStart(14)}k${''.padStart(15)}${end25.toFixed(0).padStart(10)}k`,
  )
}
