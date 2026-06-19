// Model 3 — FRBSF 2016 Baseline (Bidder, Mahedy & Valletta)
// FRBSF Economic Letter 2016-32. "Will the Real Rate of Interest Please
// Stand Up?" / companion piece on labor market demographics.
//
// This model is the pre-immigration-surge demographic baseline. It applies
// the 2016-era methodology — age-group weighted labor force participation
// rate × population growth — to current data, showing how the structural
// breakeven has evolved as demographics, immigration cycles, and cohort
// participation rates have shifted.
//
// Formula (applied per age band at each month, then summed):
//
//   ΔPotentialLF(t) = Σ_i [ ΔPop_i(t) × LFPR_trend_i(t) / 100 ]
//
//   Breakeven(t) = ΔPotentialLF(t) × (1 − NROU(t) / 100)
//
//   ΔPop_i(t)        = 12-month change in NSA population of age band i,
//                       divided by 12 (smooth monthly average, eliminates
//                       January CPS population-control step-jumps)
//   LFPR_trend_i(t)  = 12-month moving average of SA LFPR for band i
//                       (removes seasonal and short-run cyclical noise)
//   NROU(t)          = noncyclical unemployment rate, from FRED, quarterly
//                       forward-filled to monthly
//
// Age bands: 16–19, 20–24, 25–54, 55+ (matching the four available
// FRED LFPR series; population from the NSA CPS monthly series).
//
// No scenario toggle — this is a realized, data-driven series throughout.
// The scenario variation in population growth is visible in the chart as the
// immigration surge (2022-2024) raises the breakeven, then its reversal
// (2025-2026) brings it back toward (and below) the pre-pandemic baseline.
//
import { fetchFredSeries, observationsToMap } from '@/lib/fred'
import { SERIES } from '@/config/series'
import { summarize, movingAverage } from '@/lib/filters'
import type { BreakevenPoint, ModelResult } from '@/types/economic'

const DEFAULT_DISPLAY_START = '2020-01-01'
// 13mo headroom: 12-month pop smoothing + 1mo prior for LFPR MA start
const FETCH_START = '2018-12-01'

function shiftMonths(date: string, delta: number): string {
  const [y, m] = date.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`
}

/** 12-month moving average of a value map, returns new map. */
function movingAvg12(obs: Map<string, number>, months: string[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const date of months) {
    let sum = 0
    let count = 0
    for (let i = 0; i < 12; i++) {
      const v = obs.get(shiftMonths(date, -i))
      if (v != null) { sum += v; count++ }
    }
    if (count >= 10) out.set(date, sum / count)
  }
  return out
}

/** 12-month smoothed monthly population change: (Pop_t − Pop_{t-12}) / 12. */
function popChange12(obs: Map<string, number>, date: string): number | null {
  const cur = obs.get(date)
  const prev = obs.get(shiftMonths(date, -12))
  return cur != null && prev != null ? (cur - prev) / 12 : null
}

/** Forward-fill a quarterly NROU series to monthly. */
function buildNrouMonthly(obs: Map<string, number>, months: string[]): Map<string, number> {
  const out = new Map<string, number>()
  let last: number | null = null
  for (const date of months) {
    const v = obs.get(date)
    if (v != null) last = v
    if (last != null) out.set(date, last)
  }
  return out
}

const EMPTY_SUMMARY = { latest: null, avg3: null, avg6: null, avg12: null }

function emptyModelResult(error?: unknown): ModelResult {
  return {
    id: 'frbsf-2016',
    points: [],
    latestBreakeven: null,
    latestActual: null,
    actualSummary: { ...EMPTY_SUMMARY },
    breakevenSummary: { ...EMPTY_SUMMARY },
    computedAt: new Date().toISOString(),
    meta: {
      latestLfprByBand: null,
      latestPopChangByBand: null,
      latestNrou: null,
      observedDate: null,
      error: error instanceof Error ? error.message : error ? String(error) : null,
    },
  }
}

export interface Frbsf2016Options {
  displayStart?: string
}

export async function computeFrbsf2016(
  options: Frbsf2016Options = {},
): Promise<ModelResult> {
  try {
    const displayStart = options.displayStart ?? DEFAULT_DISPLAY_START

    // Fetch all series in parallel
    const [
      payemsObs,
      lfpr1619Obs,
      lfpr2024Obs,
      lfpr2554Obs,
      lfpr55pObs,
      pop1619Obs,
      pop2024Obs,
      pop2554Obs,
      pop55pObs,
      nrouObs,
    ] = await Promise.all([
      fetchFredSeries(SERIES.PAYEMS,     { startDate: FETCH_START }),
      fetchFredSeries(SERIES.LFPR_16_19, { startDate: FETCH_START }),
      fetchFredSeries(SERIES.LFPR_20_24, { startDate: FETCH_START }),
      fetchFredSeries(SERIES.LFPR_25_54, { startDate: FETCH_START }),
      fetchFredSeries(SERIES.LFPR_55_PLUS, { startDate: FETCH_START }),
      fetchFredSeries(SERIES.POP_16_19,  { startDate: FETCH_START }),
      fetchFredSeries(SERIES.POP_20_24,  { startDate: FETCH_START }),
      fetchFredSeries(SERIES.POP_25_54,  { startDate: FETCH_START }),
      fetchFredSeries(SERIES.POP_55_PLUS, { startDate: FETCH_START }),
      fetchFredSeries(SERIES.NROU,       { startDate: FETCH_START }),
    ])

    const payems   = observationsToMap(payemsObs)
    const lfpr1619 = observationsToMap(lfpr1619Obs)
    const lfpr2024 = observationsToMap(lfpr2024Obs)
    const lfpr2554 = observationsToMap(lfpr2554Obs)
    const lfpr55p  = observationsToMap(lfpr55pObs)
    const pop1619  = observationsToMap(pop1619Obs)
    const pop2024  = observationsToMap(pop2024Obs)
    const pop2554  = observationsToMap(pop2554Obs)
    const pop55p   = observationsToMap(pop55pObs)
    const nrouRaw  = observationsToMap(nrouObs)

    const allMonths = payemsObs
      .filter((o) => o.value != null)
      .map((o) => o.date)
      .sort()

    // Pre-compute 12-month LFPR trend (moving average) and monthly NROU
    const lfprTrend1619 = movingAvg12(lfpr1619, allMonths)
    const lfprTrend2024 = movingAvg12(lfpr2024, allMonths)
    const lfprTrend2554 = movingAvg12(lfpr2554, allMonths)
    const lfprTrend55p  = movingAvg12(lfpr55p,  allMonths)
    const nrouMonthly   = buildNrouMonthly(nrouRaw, allMonths)

    let latestObsDate: string | null = null
    let latestLfpr1619 = 0, latestLfpr2024 = 0, latestLfpr2554 = 0, latestLfpr55p = 0
    let latestPop1619 = 0, latestPop2024 = 0, latestPop2554 = 0, latestPop55p = 0
    let latestNrou: number | null = null

    const points: BreakevenPoint[] = []

    for (const date of allMonths) {
      if (date < displayStart) continue

      const cur  = payems.get(date)
      const prev = payems.get(shiftMonths(date, -1))
      const actualNfp = cur != null && prev != null ? cur - prev : null

      // 12-month smoothed population changes (thousands/month)
      const dPop1619 = popChange12(pop1619, date)
      const dPop2024 = popChange12(pop2024, date)
      const dPop2554 = popChange12(pop2554, date)
      const dPop55p  = popChange12(pop55p,  date)

      // 12-month LFPR trends (%)
      const tr1619 = lfprTrend1619.get(date)
      const tr2024 = lfprTrend2024.get(date)
      const tr2554 = lfprTrend2554.get(date)
      const tr55p  = lfprTrend55p.get(date)
      const nrou   = nrouMonthly.get(date)

      if (
        dPop1619 == null || dPop2024 == null || dPop2554 == null || dPop55p == null ||
        tr1619 == null || tr2024 == null || tr2554 == null || tr55p == null ||
        nrou == null
      ) continue

      // ΔPotentialLF = Σ ΔPop_i × LFPR_trend_i / 100
      const deltaPotLF =
        dPop1619 * (tr1619 / 100) +
        dPop2024 * (tr2024 / 100) +
        dPop2554 * (tr2554 / 100) +
        dPop55p  * (tr55p  / 100)

      const breakeven = deltaPotLF * (1 - nrou / 100)

      points.push({
        date,
        actualNfp,
        breakeven,
        gap: actualNfp != null ? actualNfp - breakeven : null,
      })

      // Track latest observed values for display
      latestObsDate = date
      latestLfpr1619 = tr1619; latestLfpr2024 = tr2024
      latestLfpr2554 = tr2554; latestLfpr55p  = tr55p
      latestPop1619 = dPop1619 * 12; latestPop2024 = dPop2024 * 12
      latestPop2554 = dPop2554 * 12; latestPop55p  = dPop55p  * 12
      latestNrou = nrou
    }

    // The 12-month smoothed population formula holds each annual CPS control
    // revision in the estimate for a full year, creating a "staircase" that is
    // structurally correct but visually misleading on a monthly chart. A 3-month
    // trailing average softens regime transitions without altering the underlying
    // demographic calculation.
    const smoothedBreakeven = movingAverage(points.map((p) => p.breakeven), 3)
    const smoothedPoints = points.map((p, i) => {
      const bk: number | null = smoothedBreakeven[i] ?? p.breakeven
      return {
        ...p,
        breakeven: bk,
        gap: p.actualNfp != null && bk != null ? p.actualNfp - bk : null,
      }
    })

    const lastWithActual = [...smoothedPoints].reverse().find((p) => p.actualNfp != null)

    return {
      id: 'frbsf-2016',
      points: smoothedPoints,
      latestBreakeven: lastWithActual?.breakeven ?? null,
      latestActual: lastWithActual?.actualNfp ?? null,
      actualSummary: summarize(smoothedPoints.map((p) => p.actualNfp)),
      breakevenSummary: summarize(smoothedPoints.map((p) => p.breakeven)),
      computedAt: new Date().toISOString(),
      meta: {
        latestNrou,
        observedDate: latestObsDate,
        latestLfprByBand: {
          '16-19': latestLfpr1619,
          '20-24': latestLfpr2024,
          '25-54': latestLfpr2554,
          '55+':   latestLfpr55p,
        },
        // Annual population change (thousands/year) by band
        latestPopChangeByBand: {
          '16-19': latestPop1619,
          '20-24': latestPop2024,
          '25-54': latestPop2554,
          '55+':   latestPop55p,
        },
      },
    }
  } catch (err) {
    console.error('computeFrbsf2016 failed:', err)
    return emptyModelResult(err)
  }
}
