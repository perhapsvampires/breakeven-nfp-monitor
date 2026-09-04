// Model 5 — SF Fed breakeven (Petrosky-Nadeau & Stewart, FRBSF EL 2024-18).
//
// dNbe = (1 − ū) × dLFtrend, ū = 3.8% ("Our baseline calculations assume a
// long-run unemployment rate of 3.8%" — paper, "Long- and short-run breakeven
// employment growth").
//
// Trend labor force extracted with a Christiano-Fitzgerald asymmetric filter.
// NOTE ON DIRECTION: cfLowPass RETAINS periods >= cutoff. A larger cutoff means
// a SMOOTHER trend, not a wider passband.
//   Long-run:  cutoff 480 months — "movements at the 40-year or longer horizon"
//   Short-run: cutoff SHORT_CUTOFF — "movements as frequent as every six
//              months". See the calibration note on SHORT_CUTOFF below.
//
// Both filters run on CLF16OV (history) spliced with a Census-based demographic
// projection (forward), which stabilizes filter endpoint drift. The short-run
// filter is also sensitive to the COVID break; the linear interpolation through
// 2020-02–2021-07 is a reasonable substitute for the author's separate pre/post
// filter approach, since the 72-month passband naturally attenuates the 17-month
// disruption.
//
// FORWARD PROJECTION (the paper's actual method, demographically grounded):
// the labor force is projected as Σ_group projectedPopulation_g × trendLFP_g,
// where trendLFP_g is the 24-month average participation rate by age×sex group
// from CPS microdata (data/sf-lfp.json) and projectedPopulation_g comes from the
// Census 2023 National Population Projections by age×sex under baseline vs
// high-immigration scenarios (data/population-projections.json). Census gives
// RESIDENT population; we form an LFP-weighted population index and normalize it
// to the realized labor-force endpoint, so the resident→CNI level ratio cancels
// and the projection splices onto realized CLF16OV continuously. Extending the
// series forward also stabilizes the two-sided filter's recent endpoint.
//
// Realized history = COVID-interpolated CLF16OV (≡ the CPS aggregate), NOT
// de-stepped. BLS introduces new population controls each January as a one-time
// level step rather than revising history, and in 2022-24 those steps largely
// WERE how the immigration surge entered the labor force data. The paper used
// CPS microdata as published, which carries the same steps, so removing them is
// a deviation from its method — and removing them suppresses exactly the signal
// the short-run breakeven is meant to measure. Disabling de-stepping moves the
// long-run anchor to the paper's 72k exactly and lifts Q1-2024 short-run from
// 83k to 95k. lib/filters.ts still exports deStepJanuary but nothing in the app
// calls it now; it is kept because this decision is reversible and
// scripts/calibrate-sf-cutoff.mjs --destep documents the comparison.

import { fetchFredSeries, observationsToMap } from '@/lib/fred'
import { cfLowPass, summarize } from '@/lib/filters'
import { SERIES } from '@/config/series'
import sfLfpData from '@/data/sf-lfp.json'
import popProjData from '@/data/population-projections.json'
import type { BreakevenPoint, ModelResult } from '@/types/economic'

const U = 0.038
/**
 * Short-run CF low-pass cutoff, months. The paper defines the short-run trend
 * as "movements as frequent as every six months", so 6 is the literal reading
 * and is what we use.
 *
 * scripts/calibrate-sf-cutoff.mjs replicates the paper's vintage (sample
 * truncated at 2024-04). In the production configuration it reproduces the
 * LONG-run anchor exactly: 72k for 2024 vs the paper's ~72k.
 *
 * The SHORT-run anchor is NOT reproduced at any cutoff:
 *   cutoff  6 -> 95k    12 -> 55k    18 -> 27k    72 -> 121k   (paper: ~145k)
 * The relationship is non-monotonic, and 72 is nearest only by coincidence —
 * it is not the paper's definition, so we do not adopt it. The level gap is
 * driven upstream of the cutoff, not by it. Of the two suspected causes:
 *   1. RESOLVED — de-stepping was removing the immigration signal. It is now
 *      disabled for this model (see the header note), which took the long-run
 *      anchor to the paper's 72k exactly and Q1-2024 short-run to 95k. The
 *      table above predates that change; re-run the script for current values.
 *   2. RULED OUT — trend-LFP vintage. An as-of-2024-04 rebuild reproduces the
 *      numbers to four decimals; the projection normalises the level away.
 * The residual gap (95k vs ~145k) most likely lies in the realized labor-force
 * series itself: we use aggregate CLF16OV, the paper used re-weighted CPS
 * microdata. Re-run scripts/calibrate-sf-cutoff.mjs before changing this value.
 */
const SHORT_CUTOFF = 6
const LONG_CUTOFF = 480
const DEFAULT_DISPLAY_START = '2022-01-01'
const DISPLAY_PROJ_MONTHS = 30 // months of projection to display past the data
const CLF_START = '1948-01-01'
const PAYEMS_START = '2021-06-01'
const COVID_FROM = '2020-02-01'
const COVID_TO = '2021-07-01'

interface LfpGroup { id: string; trendLFP: number }
interface PopRow { year: number; ageBand: string; sex: string; pop: number }
const LFP_GROUPS = ((sfLfpData as { groups?: LfpGroup[] }).groups ?? [])
const POP_BY_SCENARIO = ((popProjData as { byScenario?: Record<string, PopRow[]> }).byScenario ?? {})

interface SfPoint extends BreakevenPoint {
  shortRun: number | null
  srBaseProj: number | null
  srHighProj: number | null
  longRun: number | null
}

function shiftMonths(date: string, delta: number): string {
  const [y, m] = date.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`
}

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

function trendBreakeven(levels: number[], cutoff: number): number[] {
  const f = cfLowPass(levels, cutoff)
  return f.map((v, i) => (i === 0 ? 0 : (v - f[i - 1]) * (1 - U)))
}

/** Annual LFP-weighted population index per scenario: Σ_g pop_g(year) × trendLFP_g. */
function annualWeightedPop(scenario: string): Map<number, number> {
  const lfp = new Map(LFP_GROUPS.map((g) => [g.id, g.trendLFP]))
  const rows = POP_BY_SCENARIO[scenario] ?? []
  const out = new Map<number, number>()
  for (const r of rows) {
    const rate = lfp.get(`${r.sex}-${r.ageBand}`)
    if (rate == null) continue
    out.set(r.year, (out.get(r.year) ?? 0) + r.pop * rate)
  }
  return out
}

/** Interpolate an annual (mid-year-anchored) series to a monthly date. */
function interpAnnual(annual: Map<number, number>, date: string): number {
  const years = [...annual.keys()].sort((a, b) => a - b)
  const lo = years[0]
  const hi = years[years.length - 1]
  const [y, mo] = date.split('-').map(Number)
  const x = y + (mo - 0.5) / 12
  const clamped = Math.max(lo + 0.5, Math.min(hi + 0.5, x))
  const a = Math.floor(clamped - 0.5)
  const b = Math.min(a + 1, hi)
  const wa = annual.get(a)!
  const wb = annual.get(b)!
  return b === a ? wa : wa + (wb - wa) * (clamped - (a + 0.5))
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
    if (LFP_GROUPS.length === 0 || Object.keys(POP_BY_SCENARIO).length === 0) {
      return emptyModelResult('missing sf-lfp.json or population-projections.json')
    }

    const [clfObs, payemsObs] = await Promise.all([
      fetchFredSeries(SERIES.CLF16OV, { startDate: CLF_START }),
      fetchFredSeries(SERIES.PAYEMS, { startDate: PAYEMS_START }),
    ])
    const clf = clfObs.filter((o) => o.value != null) as { date: string; value: number }[]
    if (clf.length < 120) return emptyModelResult('insufficient CLF16OV history')
    const payems = observationsToMap(payemsObs)

    const dates = clf.map((o) => o.date)
    const lastRealized = dates[dates.length - 1]
    const adjusted = interpolateCovid(dates, clf.map((o) => o.value))
    const realizedLast = adjusted[adjusted.length - 1]

    // ---- Forward projection: Σ_g pop_g(scenario) × trendLFP_g, normalized so
    // the projection equals the realized labor force at the splice point. ----
    const annualBase = annualWeightedPop('baseline')
    const annualHigh = annualWeightedPop('high')
    const wBaseLast = interpAnnual(annualBase, lastRealized)
    const wHighLast = interpAnnual(annualHigh, lastRealized)

    const projDates: string[] = []
    const lastProjYear = Math.max(...[...annualBase.keys()])
    let d = shiftMonths(lastRealized, 1)
    const projEnd = `${lastProjYear}-12-01`
    while (d <= projEnd) {
      projDates.push(d)
      d = shiftMonths(d, 1)
    }
    const projBase = projDates.map((dt) => (realizedLast * interpAnnual(annualBase, dt)) / wBaseLast)
    const projHigh = projDates.map((dt) => (realizedLast * interpAnnual(annualHigh, dt)) / wHighLast)

    const fullDates = dates.concat(projDates)
    const srBase = trendBreakeven(adjusted.concat(projBase), SHORT_CUTOFF)
    const srHigh = trendBreakeven(adjusted.concat(projHigh), SHORT_CUTOFF)
    const longRun = trendBreakeven(adjusted.concat(projBase), LONG_CUTOFF)

    const idxOf = new Map(fullDates.map((dt, i) => [dt, i]))
    const displayEnd = shiftMonths(lastRealized, DISPLAY_PROJ_MONTHS)

    const points: SfPoint[] = []
    for (const date of fullDates) {
      if (date < displayStart || date > displayEnd) continue
      const i = idxOf.get(date)!
      const realized = date <= lastRealized
      const nCur = payems.get(date)
      const nPrev = payems.get(shiftMonths(date, -1))
      const actualNfp = realized && nCur != null && nPrev != null ? nCur - nPrev : null
      const shortRun = realized ? srBase[i] : null
      const inProj = date >= lastRealized
      points.push({
        date,
        actualNfp,
        breakeven: shortRun,
        gap: actualNfp != null && shortRun != null ? actualNfp - shortRun : null,
        shortRun,
        srBaseProj: inProj ? srBase[i] : null,
        srHighProj: inProj ? srHigh[i] : null,
        longRun: longRun[i],
      })
    }

    const lastIdx = idxOf.get(lastRealized)!
    const realizedPoints = points.filter((p) => p.date <= lastRealized)
    const lastWithActual = [...realizedPoints].reverse().find((p) => p.actualNfp != null)

    return {
      id: 'sf-fed',
      points: points as BreakevenPoint[],
      latestBreakeven: srBase[lastIdx],
      latestActual: lastWithActual?.actualNfp ?? null,
      actualSummary: summarize(realizedPoints.map((p) => p.actualNfp)),
      breakevenSummary: summarize(realizedPoints.map((p) => p.breakeven)),
      computedAt: new Date().toISOString(),
      meta: {
        lastRealized,
        latestShortRun: srBase[lastIdx],
        latestLongRun: longRun[lastIdx],
        shortCutoff: SHORT_CUTOFF,
        projectionSource: (popProjData as { meta?: unknown }).meta ?? null,
        u: U,
      },
    }
  } catch (err) {
    console.error('computeSfFed failed:', err)
    return emptyModelResult(err)
  }
}
