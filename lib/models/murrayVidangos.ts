// Model 6 — Board of Governors (Murray & Vidangos)
// Seth Murray & Ivan Vidangos, FEDS Notes, Board of Governors of the
// Federal Reserve System, April 2, 2026.
//
// Formula:
//   Breakeven = ΔPotentialLaborForce × (1 − NoncyclicalUnemploymentRate)
//
//   ΔPotentialLF = ΔPopulation16 × (PotentialLFPR / 100)
//                + (ΔPotentialLFPR / 100) × Population16_{t−1}
//
//   Component 1 — "population growth" term: how many new working-age
//   people enter × the structural participation rate (CBO's potential LFPR).
//
//   Component 2 — "LFPR trend" term: how the age-mix drift in structural
//   participation (aging population) shifts the existing stock of workers.
//   This term is negative (~−16k/month) because CBO's potential LFPR is
//   declining as the population ages.
//
// Data inputs:
//   ΔPopulation16   — 12-month change in FRED POPTHM scaled to CNP16OV
//                     (avoids January CPS population-control step-jumps).
//                     Falls back to scenario for months where POPTHM lags.
//   Population16    — FRED CNP16OV level (16+ civilian noninstitutional).
//   PotentialLFPR   — CBO quarterly potential LFPR, linearly interpolated.
//   NoncyclicalRate — CBO quarterly NROU, forward-filled to monthly.
//
// Static data: data/cbo-projections.json (run scripts/build-cbo-projections.mjs
// to regenerate when CBO publishes a new Economic Outlook).
//
// Scenario toggle adjusts the current/forward reference band only.
// The realized historical line is driven by FRED population data.

import { fetchFredSeries, observationsToMap } from '@/lib/fred'
import { SERIES } from '@/config/series'
import { summarize } from '@/lib/filters'
import {
  getScenario,
  type ImmigrationScenario,
  type ScenarioId,
} from '@/config/scenarios.config'
import type { BreakevenPoint, ModelResult } from '@/types/economic'
import cboData from '@/data/cbo-projections.json'

const DEFAULT_DISPLAY_START = '2020-01-01'
const FETCH_START = '2019-01-01'

// Non-immigration sources of CNP16OV growth (aging-in of 16-year-olds minus
// 16+ deaths), calibrated from CBO Feb 2026: their projected 16+ population
// grows ~125k/month at baseline immigration (~324k/yr net, cnipShare 0.81),
// so natural change ≈ 125 − 324×0.81/12 = 125 − 21.9 ≈ 103k/month.
// We use a slightly lower figure (90k) to reflect that CBO's Feb 2026
// immigration baseline may have been revised upward relative to outturn.
export const NATURAL_CHANGE_CNP16_PER_MONTH = 90 // thousands/month

// Fraction of total-population growth that falls in the 16+ civilian
// noninstitutional category — used when mapping POPTHM YoY growth to
// the CNP16OV concept. Calibrated as a rolling ratio; we hold it fixed
// at its 2024-2025 approximate value.
const CNP16_SHARE_OF_TOTAL_POP = 0.791

function shiftMonths(date: string, delta: number): string {
  const [y, m] = date.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`
}

// --------------------------------------------------------------------------
// CBO data helpers
// --------------------------------------------------------------------------

/** Parse "2020Q1" → { year: 2020, q: 1 }. */
function parseQuarter(s: string): { year: number; q: number } {
  const [y, q] = s.toUpperCase().split('Q').map(Number)
  return { year: y, q }
}

/** Return the first month (YYYY-MM-01) of a calendar quarter. */
function quarterToDate(year: number, q: number): string {
  const month = String((q - 1) * 3 + 1).padStart(2, '0')
  return `${year}-${month}-01`
}

type CboQuarter = (typeof cboData.quarterly)[number]

/**
 * Build monthly maps of CBO values by linearly interpolating between the
 * midpoints of adjacent quarters.
 * Returns: { potentialLFPR: Map<date, %>, nrou: Map<date, %> }
 */
function buildCboMonthlyMaps(): {
  potentialLFPR: Map<string, number>
  nrou: Map<string, number>
} {
  const lfprMap = new Map<string, number>()
  const nrouMap = new Map<string, number>()

  const rows = cboData.quarterly as CboQuarter[]

  for (let i = 0; i < rows.length; i++) {
    const curr = rows[i]
    if (curr.potentialLFPR == null || curr.nrou == null) continue

    const { year: y0, q: q0 } = parseQuarter(curr.date)
    const startDate = quarterToDate(y0, q0)

    // Determine the end of the interpolation window: the start of the next
    // available quarter (or just repeat for the last row).
    const next = rows.find((r, j) => j > i && r.potentialLFPR != null && r.nrou != null)

    if (!next) {
      // Last row: fill forward for its 3 months.
      for (let mo = 0; mo < 3; mo++) {
        const d = shiftMonths(startDate, mo)
        lfprMap.set(d, curr.potentialLFPR)
        nrouMap.set(d, curr.nrou)
      }
      break
    }

    const { year: y1, q: q1 } = parseQuarter(next.date)
    const nextDate = quarterToDate(y1, q1)

    // Count months between the two quarter starts.
    const [y0n, m0n] = startDate.split('-').map(Number)
    const [y1n, m1n] = nextDate.split('-').map(Number)
    const totalMonths = (y1n - y0n) * 12 + (m1n - m0n) // typically 3

    for (let mo = 0; mo < totalMonths; mo++) {
      const d = shiftMonths(startDate, mo)
      const t = mo / totalMonths
      lfprMap.set(d, curr.potentialLFPR + t * (next.potentialLFPR! - curr.potentialLFPR))
      nrouMap.set(d, curr.nrou + t * (next.nrou! - curr.nrou))
    }
  }

  return { potentialLFPR: lfprMap, nrou: nrouMap }
}

// --------------------------------------------------------------------------
// Scenario reference band helpers
// --------------------------------------------------------------------------

function scenarioBreakevenAt(
  scenarioDeltaPop16: number,
  latestPop16: number,
  deltaPotentialLFPR_pp: number,
  potentialLFPR_pct: number,
  nrou_pct: number,
): number {
  const deltaPotLF =
    scenarioDeltaPop16 * (potentialLFPR_pct / 100) +
    (deltaPotentialLFPR_pp / 100) * latestPop16
  return deltaPotLF * (1 - nrou_pct / 100)
}

// --------------------------------------------------------------------------
// Empty result
// --------------------------------------------------------------------------

const EMPTY_SUMMARY = { latest: null, avg3: null, avg6: null, avg12: null }

function emptyModelResult(scenario: ImmigrationScenario, error?: unknown): ModelResult {
  return {
    id: 'murray-vidangos',
    points: [],
    latestBreakeven: null,
    latestActual: null,
    actualSummary: { ...EMPTY_SUMMARY },
    breakevenSummary: { ...EMPTY_SUMMARY },
    computedAt: new Date().toISOString(),
    meta: {
      scenario,
      scenarioBreakeven: null,
      scenarioDeltaPopulation16: null,
      latestPotentialLFPR: null,
      latestNrou: null,
      latestDeltaPotentialLFPR: null,
      latestPop16: null,
      populationGrowthTerm: null,
      lfprTrendTerm: null,
      observedDate: null,
      error: error instanceof Error ? error.message : error ? String(error) : null,
    },
  }
}

export interface MurrayVidangosOptions {
  displayStart?: string
}

export async function computeMurrayVidangos(
  scenarioId: ScenarioId,
  options: MurrayVidangosOptions = {},
): Promise<ModelResult> {
  const scenario = getScenario(scenarioId)
  try {
    const displayStart = options.displayStart ?? DEFAULT_DISPLAY_START
    const { potentialLFPR: lfprMap, nrou: nrouMap } = buildCboMonthlyMaps()

    const [payemsObs, cnp16Obs, popthmObs] = await Promise.all([
      fetchFredSeries(SERIES.PAYEMS, { startDate: FETCH_START }),
      fetchFredSeries(SERIES.CNP16OV, { startDate: FETCH_START }),
      fetchFredSeries(SERIES.POPTHM, { startDate: FETCH_START }),
    ])

    const payems = observationsToMap(payemsObs)
    const cnp16 = observationsToMap(cnp16Obs)
    const popthm = observationsToMap(popthmObs)

    const months = payemsObs
      .filter((o) => o.value != null)
      .map((o) => o.date)
      .sort()

    let lastObservedDate: string | null = null
    let lastObservedDeltaPop: number | null = null

    const points: BreakevenPoint[] = []

    for (const date of months) {
      if (date < displayStart) continue

      // Actual NFP (month-over-month PAYEMS change)
      const cur = payems.get(date)
      const prevMonth = payems.get(shiftMonths(date, -1))
      const actualNfp = cur != null && prevMonth != null ? cur - prevMonth : null

      // CBO monthly values (interpolated)
      const potLFPR = lfprMap.get(date)
      const nrou = nrouMap.get(date)
      const prevMonthDate = shiftMonths(date, -1)
      const potLFPR_prev = lfprMap.get(prevMonthDate)
      if (potLFPR == null || nrou == null) continue

      // Population level (CNP16OV, prior month, thousands)
      const pop16Prev = cnp16.get(prevMonthDate)

      // Dynamic 16+ population growth from POPTHM YoY (avoids step-jumps),
      // scaled to the CNP16OV concept.
      const popthmCur = popthm.get(date)
      const popthmPrev12 = popthm.get(shiftMonths(date, -12))

      let deltaPop16: number
      if (popthmCur != null && popthmPrev12 != null) {
        deltaPop16 = ((popthmCur - popthmPrev12) / 12) * CNP16_SHARE_OF_TOTAL_POP
        lastObservedDate = date
        lastObservedDeltaPop = deltaPop16
      } else {
        // Scenario fallback for months where POPTHM lags the PAYEMS release.
        deltaPop16 =
          NATURAL_CHANGE_CNP16_PER_MONTH + scenario.monthlyNetImmigration * scenario.cnipShare
      }

      // ΔPotentialLFPR (month-over-month change, percentage points)
      const deltaPotLFPR_pp =
        potLFPR_prev != null ? potLFPR - potLFPR_prev : 0

      // Potential labor force growth decomposition (thousands/month)
      const populationGrowthTerm =
        pop16Prev != null ? deltaPop16 * (potLFPR / 100) : deltaPop16 * (potLFPR / 100)
      const lfprTrendTerm =
        pop16Prev != null ? (deltaPotLFPR_pp / 100) * pop16Prev : 0

      const deltaPotLF = populationGrowthTerm + lfprTrendTerm
      const breakeven = deltaPotLF * (1 - nrou / 100)

      points.push({
        date,
        actualNfp,
        breakeven,
        gap: actualNfp != null ? actualNfp - breakeven : null,
      })
    }

    const lastWithActual = [...points].reverse().find((p) => p.actualNfp != null)
    const lastPoint = points[points.length - 1]

    // Current/forward scenario reference band
    const latestPotLFPR = lastPoint ? lfprMap.get(lastPoint.date) : null
    const latestNrou = lastPoint ? nrouMap.get(lastPoint.date) : null
    const latestPrevDate = lastPoint ? shiftMonths(lastPoint.date, -1) : null
    const latestPotLFPR_prev = latestPrevDate ? lfprMap.get(latestPrevDate) : null
    const latestDeltaPotLFPR =
      latestPotLFPR != null && latestPotLFPR_prev != null
        ? latestPotLFPR - latestPotLFPR_prev
        : 0
    const latestPop16 = lastPoint ? cnp16.get(shiftMonths(lastPoint.date, -1)) : null

    const scenarioDeltaPop16 =
      NATURAL_CHANGE_CNP16_PER_MONTH + scenario.monthlyNetImmigration * scenario.cnipShare

    const currentScenarioBreakeven =
      latestPotLFPR != null && latestNrou != null && latestPop16 != null
        ? scenarioBreakevenAt(
            scenarioDeltaPop16,
            latestPop16,
            latestDeltaPotLFPR,
            latestPotLFPR,
            latestNrou,
          )
        : null

    // Decompose latest observed point's terms for display
    const latestComputedPoint = lastWithActual ?? lastPoint
    const latestPotLFPR_disp = latestComputedPoint
      ? lfprMap.get(latestComputedPoint.date)
      : null
    const latestNrou_disp = latestComputedPoint
      ? nrouMap.get(latestComputedPoint.date)
      : null
    const latestObsPop16 = latestComputedPoint
      ? cnp16.get(shiftMonths(latestComputedPoint.date, -1))
      : null
    const latestPotLFPR_prev_disp = latestComputedPoint
      ? lfprMap.get(shiftMonths(latestComputedPoint.date, -1))
      : null
    const latestDeltaPotLFPR_disp =
      latestPotLFPR_disp != null && latestPotLFPR_prev_disp != null
        ? latestPotLFPR_disp - latestPotLFPR_prev_disp
        : 0

    const latestObsDeltaPop = lastObservedDeltaPop
    const latestPopGrowthTerm =
      latestPotLFPR_disp != null && latestObsDeltaPop != null
        ? latestObsDeltaPop * (latestPotLFPR_disp / 100)
        : null
    const latestLfprTrendTerm =
      latestPotLFPR_prev_disp != null && latestObsPop16 != null
        ? (latestDeltaPotLFPR_disp / 100) * latestObsPop16
        : null

    return {
      id: 'murray-vidangos',
      points,
      latestBreakeven: lastWithActual?.breakeven ?? null,
      latestActual: lastWithActual?.actualNfp ?? null,
      actualSummary: summarize(points.map((p) => p.actualNfp)),
      breakevenSummary: summarize(points.map((p) => p.breakeven)),
      computedAt: new Date().toISOString(),
      meta: {
        scenario,
        scenarioBreakeven: currentScenarioBreakeven,
        scenarioDeltaPopulation16: scenarioDeltaPop16,
        latestPotentialLFPR: latestPotLFPR,
        latestNrou,
        latestDeltaPotentialLFPR: latestDeltaPotLFPR,
        latestPop16,
        populationGrowthTerm: latestPopGrowthTerm,
        lfprTrendTerm: latestLfprTrendTerm,
        observedDate: lastObservedDate,
      },
    }
  } catch (err) {
    console.error('computeMurrayVidangos failed:', err)
    return emptyModelResult(scenario, err)
  }
}
