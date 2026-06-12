// Immigration scenarios shared by the immigration-sensitive models
// (St. Louis Fed, Brookings, Fed Board, Dallas Fed).
//
// UPDATE THIS FILE when CBO/Census/Brookings publish new immigration estimates:
// change `monthlyNetImmigration` and `vintageDate`. No code changes needed.

export type ScenarioId = 'low' | 'baseline' | 'high'

export interface ImmigrationScenario {
  id: ScenarioId
  label: string
  /** Total net international migration per month, thousands (all ages). */
  monthlyNetImmigration: number
  /** Share of net immigrants who are civilian, noninstitutional, 16+. */
  cnipShare: number
  /** Labor force participation rate assumed for new immigrants. */
  newImmigrantLFPR: number
  source: string
  vintageDate: string
}

export const SCENARIOS: ImmigrationScenario[] = [
  {
    id: 'low',
    label: 'Low',
    // Brookings Jan 2026 low end / Dallas Fed net outflow H2 2025.
    monthlyNetImmigration: -46,
    cnipShare: 0.81,
    newImmigrantLFPR: 0.66,
    source: 'Brookings/Edelberg et al. Jan 2026; Dallas Fed Cheremukhin Mar 2026',
    vintageDate: '2026-01',
  },
  {
    id: 'baseline',
    label: 'Baseline',
    // Census Vintage 2025: ~321,000/yr -> ~27K/month.
    monthlyNetImmigration: 27,
    cnipShare: 0.81,
    newImmigrantLFPR: 0.66,
    source: 'Census Bureau Vintage 2025 (Jan 27, 2026)',
    vintageDate: '2026-01',
  },
  {
    id: 'high',
    label: 'High',
    // CBO Jan 2026 Demographic Outlook: slightly above Census.
    monthlyNetImmigration: 35,
    cnipShare: 0.81,
    newImmigrantLFPR: 0.66,
    source: 'CBO Demographic Outlook Jan 2026',
    vintageDate: '2026-01',
  },
]

export const DEFAULT_SCENARIO: ScenarioId = 'baseline'

export function getScenario(id: string | undefined): ImmigrationScenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS.find((s) => s.id === DEFAULT_SCENARIO)!
}

// CBO projected population growth, used by the St. Louis Fed (Gregory & Bick)
// model. Year-keyed, thousands/month (e.g. 312 = 312,000/month). Gregory & Bick
// use a single CBO projection rather than immigration scenarios.
//
// UPDATE these values (and vintageDate) when CBO publishes a new Demographic
// Outlook.
export interface CboPopGrowthConfig {
  source: string
  vintageDate: string
  /** Projected population growth, thousands/month, keyed by calendar year. */
  byYear: Record<number, number>
}

export const CBO_POP_GROWTH: CboPopGrowthConfig = {
  source: 'CBO Demographic Outlook, Feb 2026',
  vintageDate: '2026-02',
  byYear: {
    2024: 312,
    2025: 260,
    2026: 10,
  },
}

export function cboPopGrowthForYear(year: number): number | null {
  return CBO_POP_GROWTH.byYear[year] ?? null
}
