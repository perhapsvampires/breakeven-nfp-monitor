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
// Cohorts i = {native, foreign-born} × 5-year age band (16-19, 20-24, ...,
// 65-69, 70+) = 24 cohorts, matching the paper's granularity except that its
// 70-74 and 75+ are collapsed into 70+ to keep the foreign-born cells stable.
// E_it (employment) and P_it (population, for e_it = E_it/P_it)
// come from Census CPS Basic Monthly microdata, precomputed offline into
// data/cer-cohorts.json by scripts/build-cer-cohorts.mjs. PAYEMS (g_N) is
// fetched live from FRED. The foreign-born dimension is essential: it lets the
// 2025-26 immigration reversal show up as a population effect (breakeven falls)
// rather than being misattributed to within-cohort EPR changes.
//
// g_A is the paper's CPS-to-CES definition adjustment:
//
//   A_t   = LNS16000000 / LNS12000000   (CPS employment adjusted to the CES
//                                        concept, over total CPS employment)
//   g_A   = ln( A_t' / A_t )
//
// It is NOT small: over 2025 the 12-month change ran +0.002 to +0.006, which is
// a 30-84k/month effect on the breakeven, and it changes sign month to month.
// LNS16000000 comes from the BLS API (lib/bls.ts); LNS12000000 is CE16OV on
// FRED. If the BLS call fails, g_A degrades to 0 and `gAdjAvailable` is set
// false so the UI can say so rather than silently overstating breakeven.
//
// Monthly breakeven (thousands/month) = g_CER · N_t' / 12.

import { fetchFredSeries, observationsToMap } from '@/lib/fred'
import { fetchBlsSeries } from '@/lib/bls'
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
const BLS_START_YEAR = 2018

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

  // LNS16000000 is only on the BLS API. A BLS outage or quota trip must not
  // blank the whole model — degrade g_A to 0 and flag it instead.
  const [payemsObs, ce16Obs, lns16Obs] = await Promise.all([
    fetchFredSeries(SERIES.PAYEMS, { startDate: FETCH_START }),
    fetchFredSeries(SERIES.CE16OV, { startDate: FETCH_START }),
    fetchBlsSeries('LNS16000000', BLS_START_YEAR, new Date().getFullYear()).catch(
      (err) => {
        console.error('CER: BLS LNS16000000 unavailable, g_A degraded to 0:', err)
        return null
      },
    ),
  ])
  const payems = observationsToMap(payemsObs)
  const ce16 = observationsToMap(ce16Obs)
  const lns16 = lns16Obs ? observationsToMap(lns16Obs) : null

  // A_t = LNS16000000 / LNS12000000 (= CE16OV).
  const adjLevel = new Map<string, number>()
  if (lns16) {
    for (const [date, adj] of lns16) {
      const total = ce16.get(date)
      if (total != null && total > 0 && adj > 0) adjLevel.set(date, adj / total)
    }
  }
  const gAdjAvailable = adjLevel.size > 0

  /** g_A = ln(A_t' / A_t) over the window, or null if either endpoint is missing. */
  function adjChange(current: string, base: string): number | null {
    const cur = adjLevel.get(current)
    const bas = adjLevel.get(base)
    if (cur == null || bas == null || cur <= 0 || bas <= 0) return null
    return Math.log(cur / bas)
  }

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
  // BLS publishes LNS16000000 on its own schedule and has gaps (e.g. Oct 2025),
  // so g_A gets the same carry-forward treatment as g_e~.
  let lastValidGAdj: number | null = null

  for (const date of months) {
    const base = shiftMonths(date, -WINDOW)

    const nCur = payems.get(date)
    const nBase = payems.get(base)

    // Always compute gEpr/gAdj (even pre-displayStart) to keep carry-forward current.
    let gEpr: number | null = null
    let gAdj: number | null = null
    if (nCur != null && nBase != null && nBase > 0) {
      gEpr = eprChange(date, base)
      if (gEpr != null) lastValidGEpr = gEpr
      gAdj = adjChange(date, base)
      if (gAdj != null) lastValidGAdj = gAdj
    }

    if (date < displayStart) continue

    const prev = shiftMonths(date, -1)
    const nPrev = payems.get(prev)
    const actualNfp = nCur != null && nPrev != null ? nCur - nPrev : null

    let breakeven: number | null = null
    // A month is stale if either input had to be carried forward. gAdj is only
    // counted when BLS data exists at all — when it is unavailable the whole
    // series is flagged via gAdjAvailable instead.
    const stale = gEpr == null || (gAdjAvailable && gAdj == null)
    if (nCur != null && nBase != null && nBase > 0) {
      const effectiveGEpr = gEpr ?? lastValidGEpr
      // Degrades to 0 only when BLS is unavailable; gAdjAvailable records which.
      const effectiveGAdj = gAdj ?? lastValidGAdj ?? 0
      if (effectiveGEpr != null) {
        const gN = Math.log(nCur / nBase)
        const gCer = gN - effectiveGEpr - effectiveGAdj
        breakeven = (gCer * nCur) / WINDOW
        latestDecomp = {
          gN: (gN * nCur) / WINDOW,
          gEpr: (effectiveGEpr * nCur) / WINDOW,
          gAdj: (effectiveGAdj * nCur) / WINDOW,
          gAdjAvailable,
          gCer: breakeven,
        }
      }
    }

    points.push({
      date,
      actualNfp,
      breakeven,
      gap: actualNfp != null && breakeven != null ? actualNfp - breakeven : null,
      ...(breakeven != null && stale ? { stale: true } : {}),
    })
  }

  // Trailing run of carried-forward months — what the UI needs to disclose.
  let staleMonths = 0
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].breakeven == null) continue
    if (points[i].stale) staleMonths++
    else break
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
        gAdjAvailable,
        /** Cohort microdata vintage — the EPR term cannot be fresher than this. */
        cohortLastMonth: (data.meta as { lastMonth?: string } | undefined)?.lastMonth ?? null,
        /** Trailing months whose breakeven uses a carried-forward input. */
        staleMonths,
      },
    }
  } catch (err) {
    console.error('computeEmployAmericaCER failed:', err)
    return emptyModelResult(err)
  }
}
