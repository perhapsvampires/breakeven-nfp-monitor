// Small numeric helpers shared by models (moving averages, trailing means).
import type { MetricSummary } from '@/types/economic'

/** Mean of the non-null values in an array, or null if none. */
export function mean(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => v != null && !Number.isNaN(v))
  if (nums.length === 0) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

/** Mean of the trailing `window` values ending at the array's end. */
export function trailingMean(
  values: Array<number | null | undefined>,
  window: number,
): number | null {
  return mean(values.slice(-window))
}

/**
 * Trailing simple moving average. Output[i] is the mean of values[i-window+1..i].
 * Positions without a full window are null.
 */
export function movingAverage(
  values: Array<number | null>,
  window: number,
): Array<number | null> {
  return values.map((_, i) => {
    if (i + 1 < window) return null
    return mean(values.slice(i + 1 - window, i + 1))
  })
}

/** Build a latest / 3m / 6m / 12m summary from a chronological series. */
export function summarize(values: Array<number | null>): MetricSummary {
  const last = values.length ? values[values.length - 1] : null
  return {
    latest: last ?? null,
    avg3: trailingMean(values, 3),
    avg6: trailingMean(values, 6),
    avg12: trailingMean(values, 12),
  }
}

/**
 * Christiano-Fitzgerald random-walk asymmetric (full-sample) LOW-PASS filter.
 *
 * Returns the filtered (trend) LEVEL, same length as the input, retaining
 * components with period >= `cutoffPeriod` (in the units of the series'
 * sampling interval, e.g. months). Used by the SF Fed breakeven model to
 * extract a long-run labor-force trend (cutoff ~480 months / 40 years) and a
 * short-run trend (cutoff ~12 months).
 *
 * Method (CF 2003). Passband [a, b] with a = 0 (low-pass) and b = 2π/cutoff:
 *
 *     B0 = b/π ;   Bj = sin(j·b)/(j·π)   for j ≥ 1
 *
 * For each t the filtered value uses all observations, with two endpoint
 * weights that close the truncated weight sequence so the total weight is
 * exactly zero (the random-walk assumption):
 *
 *     future endpoint weight on y[T-1]:  Bend = −0.5·B0 − Σ_{j=1}^{fut-1} Bj
 *     past   endpoint weight on y[0]:    Aend = −B0 − Σ(future) − Σ(past) − Bend
 *
 * where fut = T-1-t future obs and past = t past obs. Note `Aend` is the
 * balancing term (not −0.5·B0 − Σ); this is the form used by statsmodels'
 * `cffilter` and is what keeps the final observation from blowing up. This
 * implementation was validated to match statsmodels numerically.
 *
 * `drift` (default true) is REQUIRED for trending levels such as the labor
 * force: a linear drift d_t = t·(y[T-1]-y[0])/(T-1) is removed before
 * filtering and added back afterwards. Without it the level is wrong and the
 * endpoints are unstable.
 *
 * O(T^2) total via prefix sums of Bj.
 */
export function cfLowPass(
  series: number[],
  cutoffPeriod: number,
  drift = true,
): number[] {
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
  const sumB = (lo: number, hi: number): number => {
    const l = Math.max(lo, 0)
    const h = Math.min(hi, T + 1)
    return h <= l ? 0 : prefix[h] - prefix[l]
  }

  const out = new Array<number>(T)
  for (let t = 0; t < T; t++) {
    const fut = T - 1 - t
    const past = t
    const Bfut = sumB(1, fut) // Σ_{j=1}^{fut-1} B[j]
    const Bpast = sumB(1, past) // Σ_{j=1}^{past-1} B[j]
    const Bend = -0.5 * B[0] - Bfut
    const Aend = -B[0] - Bfut - Bpast - Bend
    let acc = B[0] * x[t] + Bend * x[T - 1] + Aend * x[0]
    for (let j = 1; j < fut; j++) acc += B[j] * x[t + j]
    for (let j = 1; j < past; j++) acc += B[j] * x[t - j]
    out[t] = drift ? acc + series[0] + t * slope : acc
  }
  return out
}

/**
 * Christiano-Fitzgerald band-pass: retain components with period in
 * [pLow, pHigh]. Implemented as the difference of two low-pass trends,
 * lowPass(pLow) − lowPass(pHigh). With pHigh = Infinity this reduces to
 * `cfLowPass(series, pLow)`.
 */
export function cfBandPass(
  series: number[],
  pLow: number,
  pHigh: number,
): number[] {
  const lo = cfLowPass(series, pLow)
  if (!Number.isFinite(pHigh)) return lo
  const hi = cfLowPass(series, pHigh)
  return lo.map((v, i) => v - hi[i])
}

/**
 * De-step the January CPS population-control revisions in CLF16OV (civilian
 * labor force level). Each January the BLS introduces new population controls,
 * producing a one-time LEVEL jump that is not real labor-force flow (e.g.
 * Jan-2025 ≈ +2.2M in a single month). Left in, these jumps create spurious
 * spikes/sawtooth in the short-run filtered trend right around the months when
 * the underlying flow was actually changing.
 *
 * This detects each January month-over-month change that is an outlier (> k·σ,
 * σ from the MAD of non-January changes) relative to a local baseline (mean of
 * the surrounding non-January MoM changes) and subtracts the "excess" (the
 * control step) cumulatively from that month onward, producing a
 * control-consistent level series suitable for filtering.
 *
 * Returns the adjusted level array (same length/order as input) plus the list
 * of detected steps for diagnostics.
 */
export function deStepJanuary(
  series: Array<{ date: string; value: number }>,
  kSigma = 3,
): { adjusted: number[]; steps: Array<{ date: string; excess: number }> } {
  const T = series.length
  const raw = series.map((o) => o.value)
  if (T < 14) return { adjusted: raw, steps: [] }

  const dRaw = new Array<number>(T).fill(0)
  for (let i = 1; i < T; i++) dRaw[i] = raw[i] - raw[i - 1]

  // Robust scale of non-January MoM changes (median & MAD).
  const nonJan: number[] = []
  for (let i = 1; i < T; i++) {
    if (series[i].date.slice(5, 7) !== '01') nonJan.push(dRaw[i])
  }
  nonJan.sort((a, b) => a - b)
  const med = nonJan[Math.floor(nonJan.length / 2)]
  const madArr = nonJan.map((v) => Math.abs(v - med)).sort((a, b) => a - b)
  const sigma = 1.4826 * (madArr[Math.floor(madArr.length / 2)] || 1)

  const adjusted = raw.slice()
  let cumStep = 0
  const steps: Array<{ date: string; excess: number }> = []
  for (let i = 1; i < T; i++) {
    if (series[i].date.slice(5, 7) === '01') {
      const neigh: number[] = []
      for (let k = i - 3; k <= i + 3; k++) {
        if (k <= 0 || k >= T || k === i) continue
        if (series[k].date.slice(5, 7) === '01') continue
        neigh.push(dRaw[k])
      }
      const base = neigh.length
        ? neigh.reduce((a, b) => a + b, 0) / neigh.length
        : med
      const excess = dRaw[i] - base
      if (Math.abs(excess) > kSigma * sigma) {
        cumStep += excess
        steps.push({ date: series[i].date, excess })
      }
    }
    adjusted[i] = raw[i] - cumStep
  }
  return { adjusted, steps }
}
