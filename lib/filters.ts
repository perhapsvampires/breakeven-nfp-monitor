// Small numeric helpers shared by models (moving averages, trailing means).
import type { MetricSummary } from '@/types/economic'

/** Mean of the non-null values in an array, or null if none. */
export function mean(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => v != null && !Number.isNaN(v))
  if (nums.length === 0) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

/** Mean of the trailing `window` values ending at the array's end. */
export function trailingMean(
  values: Array<number | null | undefined>,
  window: number,
): number | null {
  return mean(values.slice(-window))
}

/**
 * Trailing simple moving average. Output[i] is the mean of values[i-window+1..i].
 * Positions without a full window are null.
 */
export function movingAverage(
  values: Array<number | null>,
  window: number,
): Array<number | null> {
  return values.map((_, i) => {
    if (i + 1 < window) return null
    return mean(values.slice(i + 1 - window, i + 1))
  })
}

/** Build a latest / 3m / 6m / 12m summary from a chronological series. */
export function summarize(values: Array<number | null>): MetricSummary {
  const last = values.length ? values[values.length - 1] : null
  return {
    latest: last ?? null,
    avg3: trailingMean(values, 3),
    avg6: trailingMean(values, 6),
    avg12: trailingMean(values, 12),
  }
}
