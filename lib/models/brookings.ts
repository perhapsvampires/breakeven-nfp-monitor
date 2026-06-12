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
// range. Under the current low/negative-immigration scenarios the adjustment
// is NEGATIVE, pushing the range BELOW the pre-pandemic baseline — the
// inverse of the paper's 2024 finding.

import { fetchFredSeries, observationsToMap } from '@/lib/fred'
import { SERIES } from '@/config/series'
import { summarize } from '@/lib/filters'
import {
  getScenario,
  type ImmigrationScenario,
  type ScenarioId,
} from '@/config/scenarios.config'
import type { BreakevenPoint, ModelResult } from '@/types/economic'

const DEFAULT_DISPLAY_START = '2022-01-01'
const FETCH_START = '2021-12-01' // one month of headroom for the MoM diff

/** Pre-pandemic potential-employment-growth range, thousands/month (Table 1, 2024 column). */
export const PRE_PANDEMIC_RANGE = { low: 60, high: 100 }

/** CBO's 2019-vintage projection of net immigration, thousands/year (~1.0M/year). */
export const PRE_PANDEMIC_PROJECTION = 1000

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

    const annualNetImmigration = scenario.monthlyNetImmigration * 12
    const immigrationAdjustment =
      ((annualNetImmigration - PRE_PANDEMIC_PROJECTION) *
        scenario.cnipShare *
        scenario.newImmigrantLFPR) /
      12

    const breakevenLow = PRE_PANDEMIC_RANGE.low + immigrationAdjustment
    const breakevenHigh = PRE_PANDEMIC_RANGE.high + immigrationAdjustment
    const breakeven = (breakevenLow + breakevenHigh) / 2

    const payemsObs = await fetchFredSeries(SERIES.PAYEMS, { startDate: FETCH_START })
    const payems = observationsToMap(payemsObs)

    const months = payemsObs
      .filter((o) => o.value != null)
      .map((o) => o.date)
      .sort()

    const points: BreakevenPoint[] = []
    for (const date of months) {
      if (date < displayStart) continue
      const cur = payems.get(date)
      const prev = payems.get(shiftMonths(date, -1))
      const actualNfp = cur != null && prev != null ? cur - prev : null
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
      latestBreakeven: breakeven,
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
      },
    }
  } catch (err) {
    console.error('computeBrookings failed:', err)
    return emptyModelResult(scenario, err)
  }
}
