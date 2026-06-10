// Model 5 — SF Fed breakeven (Nicolas Petrosky-Nadeau & Stephanie Stewart,
// FRBSF Economic Letter 2024-18, July 2024).
//
// The paper separates breakeven into a stable long-run structural rate
// (~70-90k/month, from a band-pass filter) and a cyclically variable short-run
// rate (peaked ~230k during the immigration surge). We approximate:
//
//   short-run  = 6-month moving average of labor-force growth (CLF16OV MoM),
//                excluding January transitions (CPS population controls are
//                revised every January as a one-time level step)
//   long-run   = flat structural band ~70-90k (midpoint 75k)
//
// The short-run series is intentionally cyclical/noisy; the long-run band is
// the stable anchor. Windows mangled by the Oct-2025 CPS data gap (shutdown)
// are left null rather than averaged from too few months.

import { fetchFredSeries, observationsToMap } from '@/lib/fred'
import { SERIES } from '@/config/series'
import { summarize } from '@/lib/filters'
import type { BreakevenPoint, ModelResult } from '@/types/economic'

const MA_WINDOW = 6
const MIN_WINDOW_OBS = 4 // skip windows gutted by the Oct-2025 data gap
const DEFAULT_DISPLAY_START = '2022-01-01'
const FETCH_START = '2021-01-01'

export const LONG_RUN = { low: 70, high: 90, mid: 75 } // thousands/month

function shiftMonths(date: string, delta: number): string {
  const [y, m] = date.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`
}

function isJanuary(date: string): boolean {
  return date.slice(5, 7) === '01'
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
    meta: {
      longRun: LONG_RUN,
      error: error instanceof Error ? error.message : error ? String(error) : null,
    },
  }
}

export interface SfFedOptions {
  displayStart?: string
}

export async function computeSfFed(options: SfFedOptions = {}): Promise<ModelResult> {
  try {
    const displayStart = options.displayStart ?? DEFAULT_DISPLAY_START

    const [payemsObs, clfObs] = await Promise.all([
      fetchFredSeries(SERIES.PAYEMS, { startDate: FETCH_START }),
      fetchFredSeries(SERIES.CLF16OV, { startDate: FETCH_START }),
    ])

    const payems = observationsToMap(payemsObs)
    const clf = observationsToMap(clfObs)

    // Month-over-month labor-force change (thousands).
    const lfGrowth = new Map<string, number>()
    for (const [date, v] of clf) {
      const prev = clf.get(shiftMonths(date, -1))
      if (prev != null) lfGrowth.set(date, v - prev)
    }

    // Short-run: 6-month MA of labor-force growth, excluding January transitions.
    function shortRun(date: string): number | null {
      let sum = 0
      let n = 0
      for (let k = 0; k < MA_WINDOW; k++) {
        const dd = shiftMonths(date, -k)
        if (isJanuary(dd)) continue
        const v = lfGrowth.get(dd)
        if (v != null) {
          sum += v
          n++
        }
      }
      return n >= MIN_WINDOW_OBS ? sum / n : null
    }

    const months = payemsObs
      .filter((o) => o.value != null)
      .map((o) => o.date)
      .sort()

    const points: BreakevenPoint[] = []
    for (const date of months) {
      if (date < displayStart) continue
      const nCur = payems.get(date)
      const nPrev = payems.get(shiftMonths(date, -1))
      const actualNfp = nCur != null && nPrev != null ? nCur - nPrev : null
      const breakeven = shortRun(date)
      points.push({
        date,
        actualNfp,
        breakeven,
        gap: actualNfp != null && breakeven != null ? actualNfp - breakeven : null,
      })
    }

    const lastWithBreakeven = [...points].reverse().find((p) => p.breakeven != null)
    const lastWithActual = [...points].reverse().find((p) => p.actualNfp != null)

    return {
      id: 'sf-fed',
      points,
      latestBreakeven: lastWithBreakeven?.breakeven ?? null,
      latestActual: lastWithActual?.actualNfp ?? null,
      actualSummary: summarize(points.map((p) => p.actualNfp)),
      breakevenSummary: summarize(points.map((p) => p.breakeven)),
      computedAt: new Date().toISOString(),
      meta: {
        longRun: LONG_RUN,
        shortRunLatest: lastWithBreakeven?.breakeven ?? null,
        shortRunMonth: lastWithBreakeven?.date ?? null,
      },
    }
  } catch (err) {
    console.error('computeSfFed failed:', err)
    return emptyModelResult(err)
  }
}
