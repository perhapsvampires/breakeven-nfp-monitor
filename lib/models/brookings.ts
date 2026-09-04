// Model 4 — Brookings (Edelberg & Watson, The Hamilton Project / Brookings
// Institution, March 7, 2024). "New immigration estimates help make sense of
// the pace of employment."
//
// The paper anchors a PRE-PANDEMIC range of "breakeven" payroll growth (the
// CBO-2019-vintage estimate of potential employment growth, ~60-100k/month)
// and shifts it by how much net immigration is running ABOVE or BELOW the
// CBO's 2019 projection of ~1.0M/year:
//
//   ImmigrationAdjustment = (AnnualNetImmigration - PrePandemicProjection)
//                            × cnipShare × newImmigrantLFPR / 12
//
//   AnnualNetImmigration  = scenario.monthlyNetImmigration × 12
//   PrePandemicProjection = 1,000 (thousands/year; CBO 2019 baseline)
//   cnipShare, newImmigrantLFPR = scenario shares (0.81, 0.66 in the paper)
//
//   BreakevenLow/High = PrePandemicRange.{low,high} + ImmigrationAdjustment
//
// Validated against the paper's Table 1: for 2023 (CBO 2023 net immigration
// 3.3M vs the 2019 projection of 1.0M), the adjustment is
// (3,300-1,000) × 0.81 × 0.66 / 12 ≈ +102.5k/month, matching the paper's
// shift from a 60-130k pre-pandemic range to a 160-230k immigration-adjusted
// range.
//
// DYNAMIC SERIES: rather than apply one current-vintage AnnualNetImmigration
// to every month, each chart point uses its OWN realized net-immigration
// estimate, backed out from FRED POPTHM (total US population, monthly, NSA):
//
//   NetImmigrationAnnual(t) = [POPTHM(t) - POPTHM(t-12)] - NaturalChangeAnnual
//
// NaturalChangeAnnual = 360 (thousands/year ≈ 30k/month births minus deaths,
// matching the Dallas Fed model's assumption). POPTHM lags the PAYEMS release
// by ~1-2 months; for trailing month(s) where POPTHM(t) isn't yet published,
// NetImmigrationAnnual(t) falls back to the selected scenario's
// `monthlyNetImmigration × 12`.
//
// The scenario toggle does two things: (1) it sets the CURRENT/FORWARD
// breakevenLow/High range shown as the green reference band and ModelCard,
// computed from `scenario.monthlyNetImmigration` directly and independent of
// date, and (2) it fills in the dynamic line's trailing month(s) where POPTHM
// data lags. The realized history is otherwise scenario-independent — driven
// entirely by published Census population estimates.

import { fetchFredSeries, observationsToMap } from '@/lib/fred'
import { SERIES } from '@/config/series'
import { summarize } from '@/lib/filters'
import {
  getScenario,
  NATURAL_CHANGE,
  type ImmigrationScenario,
  type ScenarioId,
} from '@/config/scenarios.config'
import type { BreakevenPoint, ModelResult } from '@/types/economic'

const DEFAULT_DISPLAY_START = '2022-01-01'
const FETCH_START = '2021-01-01' // 12mo headroom for the POPTHM YoY lookback

/** Pre-pandemic potential-employment-growth range, thousands/month (Table 1, 2024 column). */
export const PRE_PANDEMIC_RANGE = { low: 60, high: 100 }

/** CBO's 2019-vintage projection of net immigration, thousands/year (~1.0M/year). */
export const PRE_PANDEMIC_PROJECTION = 1000

/**
 * Assumed natural population change (births minus deaths), thousands/year.
 * Derived from the single config constant rather than restated, so this and the
 * Dallas Fed model cannot drift apart. See the caveat on NATURAL_CHANGE — the
 * value is not source-verified, and it directly scales the net-immigration
 * figure this model backs out of POPTHM.
 */
export const NATURAL_CHANGE_ANNUAL = NATURAL_CHANGE.value * 12

function shiftMonths(date: string, delta: number): string {
  const [y, m] = date.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`
}

const EMPTY_SUMMARY = { latest: null, avg3: null, avg6: null, avg12: null }

function emptyModelResult(scenario: ImmigrationScenario, error?: unknown): ModelResult {
  return {
    id: 'brookings',
    points: [],
    latestBreakeven: null,
    latestActual: null,
    actualSummary: { ...EMPTY_SUMMARY },
    breakevenSummary: { ...EMPTY_SUMMARY },
    computedAt: new Date().toISOString(),
    meta: {
      scenario,
      breakevenLow: null,
      breakevenHigh: null,
      immigrationAdjustment: null,
      annualNetImmigration: null,
      prePandemicRange: PRE_PANDEMIC_RANGE,
      observedNetImmigrationAnnual: null,
      observedDate: null,
      error: error instanceof Error ? error.message : error ? String(error) : null,
    },
  }
}

export interface BrookingsOptions {
  displayStart?: string
}

export async function computeBrookings(
  scenarioId: ScenarioId,
  options: BrookingsOptions = {},
): Promise<ModelResult> {
  const scenario = getScenario(scenarioId)
  try {
    const displayStart = options.displayStart ?? DEFAULT_DISPLAY_START
    const midPrePandemic = (PRE_PANDEMIC_RANGE.low + PRE_PANDEMIC_RANGE.high) / 2

    // Current/forward scenario range — independent of date, drives the
    // green reference band, ModelCard, and the trailing-month fallback.
    const annualNetImmigration = scenario.monthlyNetImmigration * 12
    const immigrationAdjustment =
      ((annualNetImmigration - PRE_PANDEMIC_PROJECTION) *
        scenario.cnipShare *
        scenario.newImmigrantLFPR) /
      12
    const breakevenLow = PRE_PANDEMIC_RANGE.low + immigrationAdjustment
    const breakevenHigh = PRE_PANDEMIC_RANGE.high + immigrationAdjustment

    const [payemsObs, popthmObs] = await Promise.all([
      fetchFredSeries(SERIES.PAYEMS, { startDate: FETCH_START }),
      fetchFredSeries(SERIES.POPTHM, { startDate: FETCH_START }),
    ])
    const payems = observationsToMap(payemsObs)
    const popthm = observationsToMap(popthmObs)

    const months = payemsObs
      .filter((o) => o.value != null)
      .map((o) => o.date)
      .sort()

    let observedNetImmigrationAnnual: number | null = null
    let observedDate: string | null = null

    const points: BreakevenPoint[] = []
    for (const date of months) {
      if (date < displayStart) continue
      const cur = payems.get(date)
      const prev = payems.get(shiftMonths(date, -1))
      const actualNfp = cur != null && prev != null ? cur - prev : null

      const popCur = popthm.get(date)
      const popPrev = popthm.get(shiftMonths(date, -12))
      let netImmigrationAnnual: number
      if (popCur != null && popPrev != null) {
        netImmigrationAnnual = popCur - popPrev - NATURAL_CHANGE_ANNUAL
        observedNetImmigrationAnnual = netImmigrationAnnual
        observedDate = date
      } else {
        netImmigrationAnnual = annualNetImmigration
      }

      const adjustment =
        ((netImmigrationAnnual - PRE_PANDEMIC_PROJECTION) *
          scenario.cnipShare *
          scenario.newImmigrantLFPR) /
        12
      const breakeven = midPrePandemic + adjustment

      points.push({
        date,
        actualNfp,
        breakeven,
        gap: actualNfp != null ? actualNfp - breakeven : null,
      })
    }

    const lastWithActual = [...points].reverse().find((p) => p.actualNfp != null)

    return {
      id: 'brookings',
      points,
      latestBreakeven: lastWithActual?.breakeven ?? null,
      latestActual: lastWithActual?.actualNfp ?? null,
      actualSummary: summarize(points.map((p) => p.actualNfp)),
      breakevenSummary: summarize(points.map((p) => p.breakeven)),
      computedAt: new Date().toISOString(),
      meta: {
        scenario,
        breakevenLow,
        breakevenHigh,
        immigrationAdjustment,
        annualNetImmigration,
        prePandemicRange: PRE_PANDEMIC_RANGE,
        observedNetImmigrationAnnual,
        observedDate,
      },
    }
  } catch (err) {
    console.error('computeBrookings failed:', err)
    return emptyModelResult(scenario, err)
  }
}
