// Model 7 — Dallas Fed breakeven (Anton Cheremukhin, Oct 2025; updated with
// Wilson & Zhou, Mar 2026).
//
// A growth-accounting decomposition of employment, E = POP × (CNP16/POP) ×
// LFPR × (1 − u). Holding the unemployment rate constant, breakeven employment
// growth is the sum of three contributions, each a monthly growth rate × the
// employment level:
//
//   breakeven = (g_pop + g_lfp + g_structural) × EmploymentLevel
//
//   g_pop        = ΔPopulation / POPTHM, where ΔPopulation (thousands/month)
//                  = natural change (≈30k) + scenario net immigration
//   g_lfp        = 2-year (24-month) moving average of monthly CIVPART growth
//   g_structural = trailing average of monthly growth in the CNP16OV/POPTHM ratio
//
// Both observed-data rates (g_lfp, g_structural) EXCLUDE January transitions:
// CPS population controls are revised every January as a one-time level step
// (CNP16OV jumped +3M in Jan 2025), which would otherwise spike the structural
// component. The employment level is PAYEMS so the result is comparable to the
// reported NFP print.
//
// APPROXIMATION: the Dallas Fed uses a proprietary high-frequency estimate of
// net unauthorized immigration. This dashboard substitutes the public scenario
// config (net immigration), so the population component is an approximation —
// see the disclosure surfaced in the UI.

import { fetchFredSeries, observationsToMap } from '@/lib/fred'
import { SERIES } from '@/config/series'
import { summarize } from '@/lib/filters'
import {
  getScenario,
  type ImmigrationScenario,
  type ScenarioId,
} from '@/config/scenarios.config'
import type {
  BreakevenPoint,
  CheremukhinComponentPoint,
  ModelResult,
} from '@/types/economic'

const CYCLE_WINDOW = 24 // months, for g_lfp and g_structural
const DEFAULT_DISPLAY_START = '2024-01-01' // avoids COVID distortion in the 2yr MA
const FETCH_START = '2021-06-01' // headroom for 24-month trailing windows
const NATURAL_CHANGE_PER_MONTH = 30 // thousands/month (CDC births − deaths trend)
const MIN_WINDOW_OBS = 10

function shiftMonths(date: string, delta: number): string {
  const [y, m] = date.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`
}

function isJanuary(date: string): boolean {
  return date.slice(5, 7) === '01'
}

/**
 * Trailing average of month-over-month growth in `map`, over `window` months
 * ending at `date`, EXCLUDING January transitions (population-control steps).
 */
function deJumpedRate(
  map: Map<string, number>,
  date: string,
  window: number,
): number | null {
  let sum = 0
  let n = 0
  for (let k = 0; k < window; k++) {
    const dd = shiftMonths(date, -k)
    if (isJanuary(dd)) continue
    const pd = shiftMonths(dd, -1)
    const cur = map.get(dd)
    const prev = map.get(pd)
    if (cur != null && prev != null && prev !== 0) {
      sum += (cur - prev) / prev
      n++
    }
  }
  return n >= MIN_WINDOW_OBS ? sum / n : null
}

const EMPTY_SUMMARY = { latest: null, avg3: null, avg6: null, avg12: null }

function emptyModelResult(
  scenario: ImmigrationScenario,
  error?: unknown,
): ModelResult {
  return {
    id: 'dallas-fed',
    points: [],
    latestBreakeven: null,
    latestActual: null,
    actualSummary: { ...EMPTY_SUMMARY },
    breakevenSummary: { ...EMPTY_SUMMARY },
    computedAt: new Date().toISOString(),
    meta: {
      scenario,
      components: [],
      decomposition: null,
      error: error instanceof Error ? error.message : error ? String(error) : null,
    },
  }
}

export interface CheremukhinOptions {
  displayStart?: string
}

export async function computeCheremukhin(
  scenarioId: ScenarioId,
  options: CheremukhinOptions = {},
): Promise<ModelResult> {
  const scenario = getScenario(scenarioId)
  try {
    const displayStart = options.displayStart ?? DEFAULT_DISPLAY_START

    const [payemsObs, civpartObs, cnpObs, popObs] = await Promise.all([
      fetchFredSeries(SERIES.PAYEMS, { startDate: FETCH_START }),
      fetchFredSeries(SERIES.CIVPART, { startDate: FETCH_START }),
      fetchFredSeries(SERIES.CNP16OV, { startDate: FETCH_START }),
      fetchFredSeries(SERIES.POPTHM, { startDate: FETCH_START }),
    ])

    const payems = observationsToMap(payemsObs)
    const civpart = observationsToMap(civpartObs)
    const cnp = observationsToMap(cnpObs)
    const pop = observationsToMap(popObs)

    // Structural ratio: civilian noninstitutional 16+ share of total population.
    const ratio = new Map<string, number>()
    for (const [date, p] of pop) {
      const c = cnp.get(date)
      if (c != null && p > 0) ratio.set(date, c / p)
    }

    const deltaPopulation = NATURAL_CHANGE_PER_MONTH + scenario.monthlyNetImmigration

    const months = payemsObs
      .filter((o) => o.value != null)
      .map((o) => o.date)
      .sort()

    const points: BreakevenPoint[] = []
    const components: CheremukhinComponentPoint[] = []
    let latest: CheremukhinComponentPoint | null = null

    for (const date of months) {
      if (date < displayStart) continue

      const E = payems.get(date)
      const P = pop.get(date)
      const nPrev = payems.get(shiftMonths(date, -1))
      const actualNfp = E != null && nPrev != null ? E - nPrev : null

      let popC: number | null = null
      let lfpC: number | null = null
      let structC: number | null = null
      let breakeven: number | null = null

      if (E != null && P != null && P > 0) {
        const gLfp = deJumpedRate(civpart, date, CYCLE_WINDOW)
        const gStruct = deJumpedRate(ratio, date, CYCLE_WINDOW)
        if (gLfp != null && gStruct != null) {
          popC = (deltaPopulation / P) * E
          lfpC = gLfp * E
          structC = gStruct * E
          breakeven = popC + lfpC + structC
        }
      }

      const cp: CheremukhinComponentPoint = {
        date,
        pop: popC,
        lfp: lfpC,
        structural: structC,
        breakeven,
      }
      components.push(cp)
      if (breakeven != null) latest = cp

      points.push({
        date,
        actualNfp,
        breakeven,
        gap: actualNfp != null && breakeven != null ? actualNfp - breakeven : null,
      })
    }

    const lastWithActual = [...points].reverse().find((p) => p.actualNfp != null)

    return {
      id: 'dallas-fed',
      points,
      latestBreakeven: latest?.breakeven ?? null,
      latestActual: lastWithActual?.actualNfp ?? null,
      actualSummary: summarize(points.map((p) => p.actualNfp)),
      breakevenSummary: summarize(points.map((p) => p.breakeven)),
      computedAt: new Date().toISOString(),
      meta: {
        scenario,
        components,
        decomposition: latest,
        deltaPopulation,
        naturalChange: NATURAL_CHANGE_PER_MONTH,
      },
    }
  } catch (err) {
    console.error('computeCheremukhin failed:', err)
    return emptyModelResult(scenario, err)
  }
}
