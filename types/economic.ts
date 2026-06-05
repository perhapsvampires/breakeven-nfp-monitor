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

/** Employ America CER decomposition for the latest window (thousands/month). */
export interface CerDecomposition {
  /** Observed NFP growth contribution. */
  gN: number
  /** Within-cohort EPR change contribution (subtracted). */
  gEpr: number
  /** CPS->CES adjustment contribution (subtracted; 0 in FRED-only build). */
  gAdj: number
  /** Resulting CER breakeven. */
  gCer: number
}
