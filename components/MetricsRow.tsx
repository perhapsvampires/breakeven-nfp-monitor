import type { MetricSummary } from '@/types/economic'
import { formatK } from '@/lib/formatting'

interface MetricsRowProps {
  actual: MetricSummary
  breakeven: MetricSummary
}

const COLUMNS: Array<{ key: keyof MetricSummary; label: string }> = [
  { key: 'latest', label: 'Latest' },
  { key: 'avg3', label: '3m Avg' },
  { key: 'avg6', label: '6m Avg' },
  { key: 'avg12', label: '12m Avg' },
]

function gap(a: number | null, b: number | null): number | null {
  return a == null || b == null ? null : a - b
}

export function MetricsRow({ actual, breakeven }: MetricsRowProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-sm tnum">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-secondary">
              {' '}
            </th>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className="px-4 py-3 text-right text-xs font-medium uppercase tracking-widest text-secondary"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border">
            <td className="px-4 py-3 font-medium text-primary">Actual NFP</td>
            {COLUMNS.map((c) => (
              <td key={c.key} className="px-4 py-3 text-right text-primary">
                {formatK(actual[c.key])}
              </td>
            ))}
          </tr>
          <tr className="border-b border-border">
            <td className="px-4 py-3 font-medium text-primary">Breakeven</td>
            {COLUMNS.map((c) => (
              <td key={c.key} className="px-4 py-3 text-right text-primary">
                {formatK(breakeven[c.key], false)}
              </td>
            ))}
          </tr>
          <tr>
            <td className="px-4 py-3 font-medium text-primary">Gap</td>
            {COLUMNS.map((c) => {
              const g = gap(actual[c.key], breakeven[c.key])
              return (
                <td
                  key={c.key}
                  className={`px-4 py-3 text-right font-semibold ${
                    g == null
                      ? 'text-secondary'
                      : g >= 0
                        ? 'text-positive'
                        : 'text-negative'
                  }`}
                >
                  {formatK(g)}
                </td>
              )
            })}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
