// Display formatting helpers. All number formatters assume values are in
// thousands of jobs unless otherwise noted.

/** Format thousands-of-jobs as "+150k" / "-50k". */
export function formatK(value: number | null | undefined, withSign = true): string {
  if (value == null || Number.isNaN(value)) return '—'
  const rounded = Math.round(value)
  const sign = withSign && rounded > 0 ? '+' : ''
  return `${sign}${rounded.toLocaleString('en-US')}k`
}

/** Format a signed percentage, e.g. "+0.8%". */
export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}%`
}

/** "2026-04-01" -> "Apr 2026". */
export function formatMonthYear(date: string): string {
  const [y, m] = date.split('-').map(Number)
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  return `${months[m - 1]} ${y}`
}

/** "2026-04-01" -> "April 5, 2026" style long date. */
export function formatLongDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : date
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/** Tailwind text color class for a gap value (actual vs breakeven). */
export function gapColorClass(gap: number | null | undefined): string {
  if (gap == null || Number.isNaN(gap)) return 'text-secondary'
  if (gap > 0) return 'text-positive'
  if (gap < 0) return 'text-negative'
  return 'text-secondary'
}
