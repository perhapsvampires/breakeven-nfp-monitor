// Validate a Christiano-Fitzgerald random-walk asymmetric low-pass filter
// against the SF Fed breakeven model (Petrosky-Nadeau & Stewart, FRBSF EL
// 2024-18). Long-run trend = CF low-pass with 480-month (40yr) cutoff;
// short-run trend = CF low-pass with a 6/12/18-month cutoff. Breakeven =
// trend labor-force growth (thousands/month) * (1 - u).
//
// The CF random-walk filter requires a drift adjustment for trending levels
// (otherwise the endpoints blow up and the level is wrong). We subtract a
// linear drift line t*(y[T-1]-y[0])/(T-1), low-pass the residual, then add the
// drift line back. This matches statsmodels' cffilter(drift=True) and was
// cross-checked numerically against it.
//
//   node scripts/validate-cf.mjs

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FRED_KEY = readFileSync(join(ROOT, 'fred_api_key.txt'), 'utf8').trim()
const U = 0.04 // assumed steady-state unemployment rate

// ---------------------------------------------------------------------------
// Christiano-Fitzgerald random-walk asymmetric (full-sample) low-pass filter.
// Returns the filtered (trend) LEVEL, same length as input. Retains components
// with period >= cutoffPeriod. Passband [a,b]: a=0 (low-pass), b=2*pi/cutoff.
//   B0 = b/pi ;  Bj = sin(j*b)/(j*pi) for j>=1   (a=0 so the sin(a*j) term is 0)
// Two endpoint weights close the truncated sum so the total weight is exactly
// zero (random-walk assumption):
//   future endpoint  B = -0.5*B0 - sum_{j=1}^{fut-1} Bj
//   past endpoint    A = -B0 - sum_{future Bj used} - sum_{past Bj used} - B
// Note A is NOT -0.5*B0 - sum; it is the balancing term that forces sum->0,
// which is what statsmodels.cffilter uses and what keeps the LAST observation
// from blowing up. Verified numerically equal to statsmodels (drift=True).
// Drift adjustment (required for trending levels): subtract linear drift
// d_t = t*(y[T-1]-y[0])/(T-1) before filtering, add it back after.
// O(T^2) total via prefix sums of Bj.
// ---------------------------------------------------------------------------
function cfLowPass(series, cutoffPeriod, drift = true) {
  const T = series.length
  if (T === 0) return []
  if (T === 1) return [series[0]]

  const slope = (series[T - 1] - series[0]) / (T - 1)
  const x = drift ? series.map((v, t) => v - t * slope) : series.slice()

  const b = (2 * Math.PI) / cutoffPeriod
  const B0 = b / Math.PI
  // B[j] for j = 0..T (B[0] = B0).
  const B = new Float64Array(T + 1)
  B[0] = B0
  for (let j = 1; j <= T; j++) B[j] = Math.sin(j * b) / (j * Math.PI)
  // prefix[k] = sum_{j=0}^{k-1} B[j]
  const prefix = new Float64Array(T + 2)
  for (let k = 0; k <= T; k++) prefix[k + 1] = prefix[k] + B[k]
  const sumB = (lo, hi) => {
    lo = Math.max(lo, 0); hi = Math.min(hi, T + 1)
    return hi <= lo ? 0 : prefix[hi] - prefix[lo]
  }

  const out = new Array(T)
  for (let t = 0; t < T; t++) {
    const fut = T - 1 - t // number of future weights B[1..fut-1]
    const past = t // number of past weights B[1..past-1]
    const Bfut = sumB(1, fut) // sum_{j=1}^{fut-1} B[j]
    const Bpast = sumB(1, past) // sum_{j=1}^{past-1} B[j]
    const Bend = -0.5 * B[0] - Bfut // future endpoint weight on x[T-1]
    const Aend = -B[0] - Bfut - Bpast - Bend // past endpoint weight on x[0]
    let acc = B[0] * x[t] + Bend * x[T - 1] + Aend * x[0]
    for (let j = 1; j < fut; j++) acc += B[j] * x[t + j]
    for (let j = 1; j < past; j++) acc += B[j] * x[t - j]
    out[t] = drift ? acc + series[0] + t * slope : acc
  }
  return out
}

// ---------------------------------------------------------------------------
// De-step CLF16OV January CPS population-control revisions. Every January the
// BLS introduces new population controls, producing a one-time level jump that
// is not real labor-force flow. Detect a January MoM change that is an outlier
// vs neighboring months and subtract the "excess" cumulatively from that month
// onward, yielding a control-consistent level path.
// ---------------------------------------------------------------------------
function deStepJanuary(obs, kSigma = 3) {
  const T = obs.length
  const raw = obs.map((o) => o.value)
  if (T < 14) return { adj: raw, steps: [] }
  const dRaw = new Array(T).fill(0)
  for (let i = 1; i < T; i++) dRaw[i] = raw[i] - raw[i - 1]

  // Robust scale of non-January MoM changes (median & MAD).
  const nonJan = []
  for (let i = 1; i < T; i++) if (obs[i].date.slice(5, 7) !== '01') nonJan.push(dRaw[i])
  nonJan.sort((a, b) => a - b)
  const med = nonJan[Math.floor(nonJan.length / 2)]
  const madArr = nonJan.map((v) => Math.abs(v - med)).sort((a, b) => a - b)
  const sigma = 1.4826 * (madArr[Math.floor(madArr.length / 2)] || 1)

  const adj = raw.slice()
  let cumStep = 0
  const steps = []
  for (let i = 1; i < T; i++) {
    if (obs[i].date.slice(5, 7) === '01') {
      const neigh = []
      for (let k = i - 3; k <= i + 3; k++) {
        if (k <= 0 || k >= T || k === i) continue
        if (obs[k].date.slice(5, 7) === '01') continue
        neigh.push(dRaw[k])
      }
      const base = neigh.length ? neigh.reduce((a, b) => a + b, 0) / neigh.length : med
      const excess = dRaw[i] - base
      if (Math.abs(excess) > kSigma * sigma) {
        cumStep += excess
        steps.push({ date: obs[i].date, excess: Math.round(excess), dRaw: Math.round(dRaw[i]), base: Math.round(base) })
      }
    }
    adj[i] = raw[i] - cumStep
  }
  return { adj, steps }
}

async function fetchCLF16OV() {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=CLF16OV&api_key=${FRED_KEY}&file_type=json&observation_start=1948-01-01`
  const j = await (await fetch(url)).json()
  const obs = []
  for (const o of j.observations) {
    if (o.value === '.') continue
    obs.push({ date: o.date, value: parseFloat(o.value) })
  }
  return obs
}

function breakevenFromTrend(trend, dates) {
  const out = new Map()
  for (let i = 1; i < trend.length; i++) {
    out.set(dates[i].slice(0, 7), (trend[i] - trend[i - 1]) * (1 - U))
  }
  return out
}

function fmt(v) {
  if (v == null || Number.isNaN(v)) return '   -- '
  return String(Math.round(v)).padStart(6)
}

// ---------------------------------------------------------------------------
const obs = await fetchCLF16OV()
const dates = obs.map((o) => o.date)
const rawLevels = obs.map((o) => o.value)
const last = dates[dates.length - 1].slice(0, 7)
console.log(`Fetched ${obs.length} obs, ${dates[0]} .. ${dates[dates.length - 1]}`)

const { adj: destepped, steps } = deStepJanuary(obs)
console.log('\nDetected January control steps (excess MoM, thousands), recent:')
for (const s of steps.slice(-8)) console.log(`  ${s.date}: dRaw=${s.dRaw}  base=${s.base}  excess=${s.excess}`)

console.log('\nRecent January raw MoM (thousands) vs Feb:')
for (let i = 1; i < obs.length; i++) {
  if (obs[i].date.slice(5, 7) === '01' && obs[i].date >= '2022') {
    const dJan = rawLevels[i] - rawLevels[i - 1]
    const dFeb = i + 1 < obs.length ? rawLevels[i + 1] - rawLevels[i] : NaN
    console.log(`  ${obs[i].date}: Jan MoM=${dJan.toFixed(0)}  Feb MoM=${dFeb.toFixed(0)}`)
  }
}

function runTable(label, levels) {
  const longBE = breakevenFromTrend(cfLowPass(levels, 480), dates)
  const results = {}
  for (const sr of [6, 12, 18]) results[sr] = breakevenFromTrend(cfLowPass(levels, sr), dates)
  console.log(`\n===== ${label} =====`)
  console.log('date     | longRun |  SR6   |  SR12  |  SR18')
  for (const k of [...longBE.keys()].filter((k) => k >= '2022-01')) {
    console.log(`${k} | ${fmt(longBE.get(k))} | ${fmt(results[6].get(k))} | ${fmt(results[12].get(k))} | ${fmt(results[18].get(k))}`)
  }
  return { longBE, results }
}

const raw = runTable('RAW levels', rawLevels)
const adj = runTable('DE-STEPPED levels', destepped)

// Smoothness: mean abs MoM change in short-run breakeven, 2015+.
function smoothness(beMap) {
  const ks = [...beMap.keys()].filter((k) => k >= '2015-01').sort()
  let s = 0, n = 0
  for (let i = 1; i < ks.length; i++) { s += Math.abs(beMap.get(ks[i]) - beMap.get(ks[i - 1])); n++ }
  return s / n
}
console.log('\nShort-run breakeven smoothness (mean |MoM change|, 2015+; lower=smoother):')
for (const sr of [6, 12, 18]) {
  console.log(`  SR${sr}: raw=${smoothness(raw.results[sr]).toFixed(1)}  destepped=${smoothness(adj.results[sr]).toFixed(1)}`)
}

console.log('\nKey months (DE-STEPPED), breakeven thousands/month:')
console.log('date     | longRun(480) | SR6  | SR12 | SR18')
for (const ym of ['2023-01', '2024-01', '2025-01', last]) {
  console.log(`${ym} | ${fmt(adj.longBE.get(ym))}       | ${fmt(adj.results[6].get(ym))} | ${fmt(adj.results[12].get(ym))} | ${fmt(adj.results[18].get(ym))}`)
}
