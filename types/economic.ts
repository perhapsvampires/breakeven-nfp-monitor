// Shared economic data types for the Breakeven NFP Monitor.

/** A single FRED observation. `value` is null for missing periods ("."). */
export interface FredObservation {
  date: string // "YYYY-MM-DD"
  value: number | null
}

/** A clean, non-null time-series point. */
export interface SeriesPoint {
  date: string
  value: number
}

/** One month of a breakeven model's output, aligned for charting. */
export interface BreakevenPoint {
  date: string // "YYYY-MM-DD" (first of month)
  actualNfp: number | null // month-over-month NFP change, thousands
  breakeven: number | null // model breakeven, thousands/month
  gap: number | null // actualNfp - breakeven
  /**
   * True when the breakeven relies on an input carried forward from an earlier
   * month rather than one observed for this month — e.g. the CER model reusing
   * the last known cohort EPR term while CPS microdata lags PAYEMS. The value
   * is still the model's best estimate, but it is not a fresh observation.
   */
  stale?: boolean
}

/** Latest / trailing-average summary for a series, in thousands/month. */
export interface MetricSummary {
  latest: number | null
  avg3: number | null
  avg6: number | null
  avg12: number | null
}

/** Standard result shape returned by every model. */
export interface ModelResult {
  id: string
  points: BreakevenPoint[]
  /** Most recent breakeven estimate, thousands/month. */
  latestBreakeven: number | null
  /** Most recent actual NFP print (MoM change), thousands. */
  latestActual: number | null
  actualSummary: MetricSummary
  breakevenSummary: MetricSummary
  /** ISO timestamp the result was computed. */
  computedAt: string
  /** Model-specific extra payload (e.g. CER decomposition). */
  meta?: Record<string, unknown>
}

/** Dallas Fed (Cheremukhin) three-component decomposition point (thousands/month). */
export interface CheremukhinComponentPoint {
  date: string
  pop: number | null // population-growth contribution
  lfp: number | null // labor-force-participation cycle contribution
  structural: number | null // structural CNP/POP ratio contribution
  breakeven: number | null // sum of the three
}

/** Employ America CER decomposition for the latest window (thousands/month). */
export interface CerDecomposition {
  /** Observed NFP growth contribution. */
  gN: number
  /** Within-cohort EPR change contribution (subtracted). */
  gEpr: number
  /** CPS->CES adjustment contribution (subtracted). */
  gAdj: number
  /** False when the BLS series was unreachable and gAdj fell back to 0. */
  gAdjAvailable: boolean
  /** Resulting CER breakeven. */
  gCer: number
}

/** Serializable payload sent from the AI Summary page to /api/summary. */
export interface SummaryPayload {
  computedAt: string
  latestNfpDate: string
  models: {
    cer: number | null
    stl: number | null
    frbsf: number | null
    brookings: { low: number | null; base: number | null; high: number | null }
    sfFed: { shortRun: number | null; longRun: number | null }
    fedBoard: number | null
    dallas: { low: number | null; base: number | null; high: number | null }
  }
  actualNfp: {
    latest: number | null
    avg3: number | null
    avg6: number | null
    avg12: number | null
  }
}
