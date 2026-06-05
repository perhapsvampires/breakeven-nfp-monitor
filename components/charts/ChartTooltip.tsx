'use client'

import type { BreakevenPoint } from '@/types/economic'
import { formatK, formatMonthYear } from '@/lib/formatting'

interface TooltipProps {
  active?: boolean
  label?: string
  payload?: Array<{ payload: BreakevenPoint }>
}

export function ChartTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const point = payload[0].payload
  const gap = point.gap

  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium text-primary">
        {formatMonthYear(label ?? point.date)}
      </p>
      <dl className="space-y-0.5 tnum">
        <div className="flex justify-between gap-6">
          <dt className="text-secondary">Actual NFP</dt>
          <dd className="text-primary">{formatK(point.actualNfp)}</dd>
        </div>
        <div className="flex justify-between gap-6">
          <dt className="text-secondary">Breakeven</dt>
          <dd className="text-primary">{formatK(point.breakeven, false)}</dd>
        </div>
        <div className="flex justify-between gap-6 border-t border-border pt-0.5">
          <dt className="text-secondary">Gap</dt>
          <dd
            className={
              gap == null
                ? 'text-secondary'
                : gap >= 0
                  ? 'text-positive'
                  : 'text-negative'
            }
          >
            {formatK(gap)}
          </dd>
        </div>
      </dl>
    </div>
  )
}
