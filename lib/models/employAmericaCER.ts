// Model 1 — Employ America Constant-Employment-Rate (CER) NFP growth.
//
// Source: Preston Mui, Employ America, "Estimating Constant-Employment-Rate
// (CER) NFP Growth," April 2026 (breakeven_theory-3.pdf), reproducing the
// published "Implied NFP Breakeven Growth" series.
//
// Decomposition over a 12-month window (t' = t + 12):
//
//   g_N   = ln( N_t' / N_t )                          (nonfarm payroll growth)
//   g_e~  = ln( Σ_i E_it·(e_it'/e_it) / Σ_i E_it )    (within-cohort EPR change)
//   g_CER = g_N - g_e~ - g_A   (population-driven breakeven)
//
// Cohorts i = {native, foreign-born} × age band (16-24, 25-34, 35-44, 45-54,
// 55-64, 65+). E_it (employment) and P_it (population, for e_it = E_it/P_it)
// come from Census CPS Basic Monthly microdata, precomputed offline into
// data/cer-cohorts.json by scripts/build-cer-cohorts.mjs. PAYEMS (g_N) is
// fetched live from FRED. The foreign-born dimension is essential: it lets the
// 2025-26 immigration reversal show up as a population effect (breakeven falls)
// rather than being misattributed to within-cohort EPR changes.
//
// g_A (BLS payroll-concept adjustment) is small and slow-moving and is omitted
// (set to 0); not available from FRED/CPS without the BLS research series.
//
// Monthly breakeven (thousands/month) = g_CER · N_t' / 12.

import { fetchFredSeries, observationsToMap } from '@/lib/fred'
import { SERIES } from '@/config/series'
import { summarize } from '@/lib/filters'
import cohortData from '@/data/cer-cohorts.json'
import type {
  BreakevenPoint,
  CerDecomposition,
  ModelResult,
} from '@/types/economic'

const WINDOW = 12 // months
const DEFAULT_DISPLAY_START = '2020-01-01'
const FETCH_START = '2018-01-01'

interface CohortCell {
  emp: number
  pop: number
}
type CohortMonth = Record<string, CohortCell>

// Defensive: on Vercel the statically-imported JSON could be missing or empty
// if it failed to bundle. Null-coalesce so MONTHS / COHORT_IDS are never
// undefined (which would throw during prerender). Typed cast is used instead of
// `as any` to satisfy the no-explicit-any lint rule.
interface CohortDataShape {
  months?: Record<string, CohortMonth>
  cohorts?: Array<{ id: string }>
  meta?: unknown
}
const data = cohortData as CohortDataShape
const MONTHS: Record<string, CohortMonth> = data.months ?? {}
const COHORT_IDS: string[] = (data.cohorts ?? []).map((c) => c.id)

/** Shift a "YYYY-MM-01" date by `delta` months. */
function shiftMonths(date: string, delta: number): string {
  const [y, m] = date.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  const ny = Math.floor(idx / 12)
  const nm = (idx % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}-01`
}

/**
 * Within-cohort EPR change g_e~ over the window ending at `current` (base =
 * current - 12). Returns the log change, or null if cohort data is missing at
 * either endpoint.
 */
function eprChange(current: string, base: string): number | null {
  const cur = MONTHS[current]
  const bas = MONTHS[base]
  if (!cur || !bas) return null

  let weightedRatioSum = 0 // Σ_i E_it·(e_it'/e_it)
  let baseEmpSum = 0 // Σ_i E_it

  for (const id of COHORT_IDS) {
    const cb = bas[id]
    const cc = cur[id]
    if (!cb || !cc || cb.pop <= 0 || cc.pop <= 0 || cb.emp <= 0) return null
    const eBase = cb.emp / cb.pop
    const eCur = cc.emp / cc.pop
    weightedRatioSum += cb.emp * (eCur / eBase)
    baseEmpSum += cb.emp
  }
  if (baseEmpSum === 0) return null
  return Math.log(weightedRatioSum / baseEmpSum)
}

export interface CerOptions {
  displayStart?: string
}

const EMPTY_SUMMARY = { latest: null, avg3: null, avg6: null, avg12: null }

/** A valid, empty result used when computation fails (never throws). */
function emptyModelResult(error?: unknown): ModelResult {
  return {
    id: 'employ-america',
    points: [],
    latestBreakeven: null,
    latestActual: null,
    actualSummary: { ...EMPTY_SUMMARY },
    breakevenSummary: { ...EMPTY_SUMMARY },
    computedAt: new Date().toISOString(),
    meta: {
      decomposition: null,
      error: error instanceof Error ? error.message : error ? String(error) : null,
    },
  }
}

export async function computeEmployAmericaCER(
  options: CerOptions = {},
): Promise<ModelResult> {
  try {
    const displayStart = options.displayStart ?? DEFAULT_DISPLAY_START

  const payemsObs = await fetchFredSeries(SERIES.PAYEMS, { startDate: FETCH_START })
  const payems = observationsToMap(payemsObs)

  const months = payemsObs
    .filter((o) => o.value != null)
    .map((o) => o.date)
    .sort()

  const points: BreakevenPoint[] = []
  let latestDecomp: CerDecomposition | null = null
  // Carry-forward: when CPS microdata for the latest month isn't published yet,
  // eprChange returns null. We reuse the last known value so that new PAYEMS
  // prints still produce a breakeven estimate rather than a gap in the chart.
  let lastValidGEpr: number | null = null

  for (const date of months) {
    const base = shiftMonths(date, -WINDOW)

    const nCur = payems.get(date)
    const nBase = payems.get(base)

    // Always compute gEpr (even pre-displayStart) to keep the carry-forward current.
    let gEpr: number | null = null
    if (nCur != null && nBase != null && nBase > 0) {
      gEpr = eprChange(date, base)
      if (gEpr != null) lastValidGEpr = gEpr
    }

    if (date < displayStart) continue

    const prev = shiftMonths(date, -1)
    const nPrev = payems.get(prev)
    const actualNfp = nCur != null && nPrev != null ? nCur - nPrev : null

    let breakeven: number | null = null
    if (nCur != null && nBase != null && nBase > 0) {
      const effectiveGEpr = gEpr ?? lastValidGEpr
      if (effectiveGEpr != null) {
        const gN = Math.log(nCur / nBase)
        const gCer = gN - effectiveGEpr
        breakeven = (gCer * nCur) / WINDOW
        latestDecomp = {
          gN: (gN * nCur) / WINDOW,
          gEpr: (effectiveGEpr * nCur) / WINDOW,
          gAdj: 0,
          gCer: breakeven,
        }
      }
    }

    points.push({
      date,
      actualNfp,
      breakeven,
      gap: actualNfp != null && breakeven != null ? actualNfp - breakeven : null,
    })
  }

  const actualSeries = points.map((p) => p.actualNfp)
  const breakevenSeries = points.map((p) => p.breakeven)
  const lastWithBreakeven = [...points].reverse().find((p) => p.breakeven != null)
  const lastWithActual = [...points].reverse().find((p) => p.actualNfp != null)

    return {
      id: 'employ-america',
      points,
      latestBreakeven: lastWithBreakeven?.breakeven ?? null,
      latestActual: lastWithActual?.actualNfp ?? null,
      actualSummary: summarize(actualSeries),
      breakevenSummary: summarize(breakevenSeries),
      computedAt: new Date().toISOString(),
      meta: {
        decomposition: latestDecomp,
        cohortSource: data.meta,
      },
    }
  } catch (err) {
    console.error('computeEmployAmericaCER failed:', err)
    return emptyModelResult(err)
  }
}
