// Model 2 — St. Louis Fed breakeven (Victoria Gregory & Alexander Bick, Apr 2025).
//
// Breakeven = CBO_pop_growth × (CIVPART_12m_avg / 100)
//           × (1 − UNRATE / 100) × survey_adjustment
//
//   CBO_pop_growth   = CBO Demographic Outlook projected population growth,
//                      year-keyed (thousands/month), from scenarios.config.ts
//   CIVPART_12m_avg  = 12-month trailing average of FRED CIVPART
//   UNRATE           = prior-month FRED UNRATE
//   survey_adjustment = rolling 12-month average of PAYEMS / LNS16000000
//                      (LNS16000000 = household employment adjusted to the
//                       payroll-survey concept; sourced from the BLS API,
//                       since FRED does not carry it)
//
// Gregory & Bick use a single CBO projection, not immigration scenarios, so
// there is no scenario toggle. The CBO values update when CBO publishes a new
// Demographic Outlook (edit config/scenarios.config.ts).

import { fetchFredSeries, observationsToMap } from '@/lib/fred'
import { fetchBlsSeries } from '@/lib/bls'
import { SERIES } from '@/config/series'
import { summarize } from '@/lib/filters'
import { CBO_POP_GROWTH, cboPopGrowthForYear } from '@/config/scenarios.config'
import type { BreakevenPoint, ModelResult } from '@/types/economic'

const WINDOW = 12
const DEFAULT_DISPLAY_START = '2024-01-01' // CBO config covers 2024+
const FETCH_START = '2022-01-01' // headroom for 12-month trailing windows
const BLS_START_YEAR = 2022

function shiftMonths(date: string, delta: number): string {
  const [y, m] = date.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`
}

/** 12-month trailing average of `map` ending at `date` (inclusive). */
function trailing12(map: Map<string, number>, date: string): number | null {
  let sum = 0
  let n = 0
  for (let k = 0; k < WINDOW; k++) {
    const v = map.get(shiftMonths(date, -k))
    if (v != null) {
      sum += v
      n++
    }
  }
  return n > 0 ? sum / n : null
}

export interface GregoryBickOptions {
  displayStart?: string
}

export async function computeGregoryBick(
  options: GregoryBickOptions = {},
): Promise<ModelResult> {
  const displayStart = options.displayStart ?? DEFAULT_DISPLAY_START
  const endYear = new Date().getFullYear()

  const [payemsObs, civpartObs, unrateObs, lns16Obs] = await Promise.all([
    fetchFredSeries(SERIES.PAYEMS, { startDate: FETCH_START }),
    fetchFredSeries(SERIES.CIVPART, { startDate: FETCH_START }),
    fetchFredSeries(SERIES.UNRATE, { startDate: FETCH_START }),
    fetchBlsSeries('LNS16000000', BLS_START_YEAR, endYear),
  ])

  const payems = observationsToMap(payemsObs)
  const civpart = observationsToMap(civpartObs)
  const unrate = observationsToMap(unrateObs)
  const lns16 = observationsToMap(lns16Obs)

  // Per-month survey adjustment ratio PAYEMS / LNS16000000.
  const surveyRatio = new Map<string, number>()
  for (const [date, n] of payems) {
    const h = lns16.get(date)
    if (h != null && h > 0) surveyRatio.set(date, n / h)
  }

  /** Breakeven (thousands/month) at `date`, or null if any input is missing. */
  function breakevenAt(date: string): {
    breakeven: number
    cbo: number
    lfpr: number
    unemployment: number
    surveyAdj: number
  } | null {
    const year = Number(date.slice(0, 4))
    const cbo = cboPopGrowthForYear(year)
    const lfpr = trailing12(civpart, date)
    const uPrev = unrate.get(shiftMonths(date, -1))
    const surveyAdj = trailing12(surveyRatio, date)
    if (cbo == null || lfpr == null || uPrev == null || surveyAdj == null) return null
    const breakeven = cbo * (lfpr / 100) * (1 - uPrev / 100) * surveyAdj
    return { breakeven, cbo, lfpr, unemployment: uPrev, surveyAdj }
  }

  const months = payemsObs
    .filter((o) => o.value != null)
    .map((o) => o.date)
    .sort()

  const points: BreakevenPoint[] = []
  let latestCalc: ReturnType<typeof breakevenAt> = null
  let latestMonth: string | null = null

  for (const date of months) {
    if (date < displayStart) continue
    const nCur = payems.get(date)
    const nPrev = payems.get(shiftMonths(date, -1))
    const actualNfp = nCur != null && nPrev != null ? nCur - nPrev : null

    const calc = breakevenAt(date)
    const breakeven = calc?.breakeven ?? null
    if (calc) {
      latestCalc = calc
      latestMonth = date
    }

    points.push({
      date,
      actualNfp,
      breakeven,
      gap: actualNfp != null && breakeven != null ? actualNfp - breakeven : null,
    })
  }

  const lastWithActual = [...points].reverse().find((p) => p.actualNfp != null)
  const gap =
    lastWithActual?.actualNfp != null && latestCalc != null
      ? lastWithActual.actualNfp - latestCalc.breakeven
      : null

  return {
    id: 'stlouis-fed',
    points,
    latestBreakeven: latestCalc?.breakeven ?? null,
    latestActual: lastWithActual?.actualNfp ?? null,
    actualSummary: summarize(points.map((p) => p.actualNfp)),
    breakevenSummary: summarize(points.map((p) => p.breakeven)),
    computedAt: new Date().toISOString(),
    meta: {
      headlineMonth: latestMonth,
      gap,
      cbo: CBO_POP_GROWTH,
      decomposition: latestCalc,
    },
  }
}
