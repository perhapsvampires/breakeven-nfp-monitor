// Model 5 — SF Fed breakeven (Nicolas Petrosky-Nadeau & Stephanie Stewart,
// FRBSF Economic Letter 2024-18, July 2024). FULL methodology rebuild.
//
// The paper extracts trend labor-force growth with a band-pass filter and sets
//   breakeven employment growth = trend labor-force growth × (1 − u),  u = 3.8%
// distinguishing a LONG-RUN trend (40-year+ horizon, structural ~70–90k) from a
// SHORT-RUN trend (down to ~6-month horizons, cyclically elevated by the
// 2022–24 immigration surge, peaking ~230k). It projects the labor force
// forward under Census-baseline and CBO-high-immigration scenarios.
//
// Implementation here:
//  1. CLF16OV (civilian labor force, 1948→present) from FRED.
//  2. De-step the January CPS population-control level jumps (deStepJanuary) so
//     the filtered short-run trend isn't spiked by control revisions.
//  3. Project the labor force forward 24 months under two scenarios (baseline
//     and high-immigration) by transitioning the monthly LF-growth pace from the
//     latest smoothed pace to a scenario terminal pace.
//  4. Christiano-Fitzgerald low-pass (cfLowPass): short-run trend = periods
//     ≥ 18 months (smooth yet responsive; 12 oversamples to a sawtooth, 18
//     matches the paper's ~270k 2023 peak), long-run = periods ≥ 480 months.
//  5. breakeven = month-over-month growth of the trend level × (1 − u).
//
// NOTE: realized values now run well below the July-2024 paper because net
// immigration reversed after 2024 — the short-run trend has genuinely collapsed
// toward/under the long-run. The forward projection (dashed in the UI) shows the
// scenario spread. Long-run lands ~85–90k, at the top of the paper's 70–90k.

import { fetchFredSeries, observationsToMap } from '@/lib/fred'
import { cfLowPass, deStepJanuary } from '@/lib/filters'
import { SERIES } from '@/config/series'
import { summarize } from '@/lib/filters'
import type { BreakevenPoint, ModelResult } from '@/types/economic'

const U = 0.038 // long-run unemployment rate (paper)
const SHORT_CUTOFF = 18 // months
const LONG_CUTOFF = 480 // months (40 years)
const PROJECT_MONTHS = 24
const TRANSITION = 18 // months to reach scenario terminal pace
const TERMINAL = { baseline: 80, high: 200 } // thousands/month LF growth
const DEFAULT_DISPLAY_START = '2022-01-01'
const CLF_START = '1948-01-01'
const PAYEMS_START = '2021-06-01'
// The 2020-21 COVID labor-force crash/rebound is a large transient that the
// band-pass filter would "ring" off of (a spurious dip ~early 2022 then an
// overshoot), distorting the short-run trend. Treat the pandemic months as an
// outlier and linearly interpolate the labor-force level across them before
// filtering — standard practice for trend extraction around COVID.
const COVID_FROM = '2020-02-01'
const COVID_TO = '2021-07-01'

interface SfPoint extends BreakevenPoint {
  shortRun: number | null // realized short-run (solid)
  srBaseProj: number | null // baseline projection (dashed)
  srHighProj: number | null // high-immigration projection (dashed)
  longRun: number | null
}

function shiftMonths(date: string, delta: number): string {
  const [y, m] = date.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`
}

/** Linearly interpolate the COVID-period level between its endpoints. */
function interpolateCovid(dates: string[], levels: number[]): number[] {
  const i0 = dates.indexOf(COVID_FROM)
  const i1 = dates.indexOf(COVID_TO)
  if (i0 < 0 || i1 < 0 || i1 <= i0) return levels.slice()
  const out = levels.slice()
  for (let i = i0 + 1; i < i1; i++) {
    const f = (i - i0) / (i1 - i0)
    out[i] = levels[i0] + (levels[i1] - levels[i0]) * f
  }
  return out
}

/** Month-over-month growth of a filtered level, scaled by (1 − u). */
function trendBreakeven(levels: number[], cutoff: number): number[] {
  const f = cfLowPass(levels, cutoff)
  return f.map((v, i) => (i === 0 ? 0 : (v - f[i - 1]) * (1 - U)))
}

const EMPTY_SUMMARY = { latest: null, avg3: null, avg6: null, avg12: null }

function emptyModelResult(error?: unknown): ModelResult {
  return {
    id: 'sf-fed',
    points: [],
    latestBreakeven: null,
    latestActual: null,
    actualSummary: { ...EMPTY_SUMMARY },
    breakevenSummary: { ...EMPTY_SUMMARY },
    computedAt: new Date().toISOString(),
    meta: { error: error instanceof Error ? error.message : error ? String(error) : null },
  }
}

export interface SfFedOptions {
  displayStart?: string
}

export async function computeSfFed(options: SfFedOptions = {}): Promise<ModelResult> {
  try {
    const displayStart = options.displayStart ?? DEFAULT_DISPLAY_START

    const [clfObs, payemsObs] = await Promise.all([
      fetchFredSeries(SERIES.CLF16OV, { startDate: CLF_START }),
      fetchFredSeries(SERIES.PAYEMS, { startDate: PAYEMS_START }),
    ])

    const clf = clfObs.filter((o) => o.value != null) as { date: string; value: number }[]
    if (clf.length < 120) return emptyModelResult('insufficient CLF16OV history')
    const payems = observationsToMap(payemsObs)

    const dates = clf.map((o) => o.date)
    const lastRealized = dates[dates.length - 1]
    // De-step January control jumps, then interpolate the COVID transient.
    const deStepped = deStepJanuary(clf).adjusted
    const adjusted = interpolateCovid(dates, deStepped)

    // Latest smoothed LF-growth pace (g0) to anchor the forward projection.
    const srTrend = cfLowPass(adjusted, SHORT_CUTOFF)
    const g0 = srTrend[srTrend.length - 1] - srTrend[srTrend.length - 2]

    // Forward projection of the LF level under a terminal growth pace.
    function project(terminal: number): { levels: number[]; dates: string[] } {
      const levels = adjusted.slice()
      const ds = dates.slice()
      let last = levels[levels.length - 1]
      for (let k = 1; k <= PROJECT_MONTHS; k++) {
        const g = g0 + (terminal - g0) * Math.min(k / TRANSITION, 1)
        last += g
        levels.push(last)
        ds.push(shiftMonths(ds[ds.length - 1], 1))
      }
      return { levels, dates: ds }
    }

    const base = project(TERMINAL.baseline)
    const high = project(TERMINAL.high)
    const fullDates = base.dates // identical to high.dates
    const srBase = trendBreakeven(base.levels, SHORT_CUTOFF)
    const srHigh = trendBreakeven(high.levels, SHORT_CUTOFF)
    const longRun = trendBreakeven(base.levels, LONG_CUTOFF)

    const byDate = new Map(fullDates.map((d, i) => [d, i]))

    const points: SfPoint[] = []
    for (const date of fullDates) {
      if (date < displayStart) continue
      const i = byDate.get(date)!
      const realized = date <= lastRealized
      const nCur = payems.get(date)
      const nPrev = payems.get(shiftMonths(date, -1))
      const actualNfp = realized && nCur != null && nPrev != null ? nCur - nPrev : null

      const shortRun = realized ? srBase[i] : null
      // Dashed projection lines connect at the boundary month, then fan out.
      const inProjOrBoundary = date >= lastRealized
      points.push({
        date,
        actualNfp,
        breakeven: shortRun, // for MetricsRow / gap (realized short-run)
        gap: actualNfp != null && shortRun != null ? actualNfp - shortRun : null,
        shortRun,
        srBaseProj: inProjOrBoundary ? srBase[i] : null,
        srHighProj: inProjOrBoundary ? srHigh[i] : null,
        longRun: longRun[i],
      })
    }

    const lastIdx = byDate.get(lastRealized)!
    const latestShortRun = srBase[lastIdx]
    const latestLongRun = longRun[lastIdx]
    const realizedPoints = points.filter((p) => p.date <= lastRealized)
    const lastWithActual = [...realizedPoints].reverse().find((p) => p.actualNfp != null)

    return {
      id: 'sf-fed',
      points: points as BreakevenPoint[],
      latestBreakeven: latestShortRun,
      latestActual: lastWithActual?.actualNfp ?? null,
      actualSummary: summarize(realizedPoints.map((p) => p.actualNfp)),
      breakevenSummary: summarize(realizedPoints.map((p) => p.breakeven)),
      computedAt: new Date().toISOString(),
      meta: {
        lastRealized,
        latestShortRun,
        latestLongRun,
        shortCutoff: SHORT_CUTOFF,
        terminals: TERMINAL,
        u: U,
      },
    }
  } catch (err) {
    console.error('computeSfFed failed:', err)
    return emptyModelResult(err)
  }
}
