// Validate the full SF Fed pipeline: de-step CLF16OV -> forward scenario
// projections -> CF low-pass (short-run & long-run) -> breakeven = growth x (1-u).
// Mirrors the logic that lib/models/sfFed.ts will use. node scripts/validate-sf.mjs

import { readFileSync } from 'node:fs'

const FRED_KEY = readFileSync('fred_api_key.txt', 'utf8').trim()
const U = 0.038 // long-run unemployment rate (paper)
const PROJECT_MONTHS = 24
const TRANSITION = 18
const TERMINAL = { baseline: 80, high: 200 } // thousands/month LF growth
const SHORT_CUTOFFS = [12, 18]
const LONG_CUTOFF = 480

// ---- CF low-pass (copied from lib/filters.ts, validated vs statsmodels) ----
function cfLowPass(series, cutoffPeriod, drift = true) {
  const T = series.length
  if (T === 0) return []
  if (T === 1) return [series[0]]
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
  for (let i = 1; i < T; i++) if (series[i].date.slice(5, 7) !== '01') nonJan.push(dRaw[i])
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

function shiftMonths(date, delta) {
  const [y, m] = date.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`
}

const j = await (
  await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=CLF16OV&api_key=${FRED_KEY}&file_type=json&observation_start=1948-01-01`)
).json()
const obs = j.observations.filter((o) => o.value !== '.').map((o) => ({ date: o.date, value: +o.value }))
const dates = obs.map((o) => o.date)
const lastDate = dates[dates.length - 1]
const deStepped = deStepJanuary(obs)

// latest realized short-run growth (g0) from a 12-cutoff trend
function trendGrowth(levels, cutoff) {
  const f = cfLowPass(levels, cutoff)
  return f.map((v, i) => (i === 0 ? null : v - f[i - 1]))
}
const g0 = (() => {
  const f = cfLowPass(deStepped, 18)
  return f[f.length - 1] - f[f.length - 2]
})()

// Build full series (realized + projection) per scenario.
function projectSeries(terminal) {
  const lv = deStepped.slice()
  const d = dates.slice()
  let last = lv[lv.length - 1]
  for (let k = 1; k <= PROJECT_MONTHS; k++) {
    const g = g0 + (terminal - g0) * Math.min(k / TRANSITION, 1)
    last += g
    lv.push(last)
    d.push(shiftMonths(d[d.length - 1], 1))
  }
  return { lv, d }
}

const PRINT = ['2022-01-01', '2022-07-01', '2023-01-01', '2023-07-01', '2024-01-01', '2025-01-01', lastDate, shiftMonths(lastDate, 12), shiftMonths(lastDate, 24)]

for (const cutoff of SHORT_CUTOFFS) {
  console.log(`\n===== short-run cutoff = ${cutoff} =====`)
  const base = projectSeries(TERMINAL.baseline)
  const high = projectSeries(TERMINAL.high)
  const srBase = trendGrowth(base.lv, cutoff)
  const srHigh = trendGrowth(high.lv, cutoff)
  const lr = trendGrowth(base.lv, LONG_CUTOFF)
  console.log('month      | srBase | srHigh | longRun  (x(1-u), k/mo)')
  for (const m of PRINT) {
    const i = base.d.indexOf(m)
    if (i < 1) { console.log(`${m} | n/a`); continue }
    const proj = m > lastDate ? ' (proj)' : ''
    console.log(
      `${m} | ${(srBase[i] * (1 - U)).toFixed(0).padStart(6)} | ${(srHigh[i] * (1 - U)).toFixed(0).padStart(6)} | ${(lr[i] * (1 - U)).toFixed(0).padStart(6)}${proj}`,
    )
  }
}
console.log(`\nlatest realized month: ${lastDate}; g0 (latest SR18 growth) = ${g0.toFixed(1)}k/mo`)
