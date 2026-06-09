'use client'

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CheremukhinComponentPoint } from '@/types/economic'
import { formatK, formatMonthYear } from '@/lib/formatting'

const COLORS = {
  pop: '#1d4ed8', // population growth — blue
  lfp: '#d97706', // LFP cycle — amber
  structural: '#0d9488', // structural ratio — teal
  total: '#0f172a', // breakeven total — near-black line
  axis: '#94a3b8',
  grid: '#e2e8f0',
}

interface TooltipProps {
  active?: boolean
  label?: string
  payload?: Array<{ payload: CheremukhinComponentPoint }>
}

function ComponentTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0].payload
  const rows: Array<[string, number | null, string]> = [
    ['Population', p.pop, COLORS.pop],
    ['LFP cycle', p.lfp, COLORS.lfp],
    ['Structural', p.structural, COLORS.structural],
  ]
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium text-primary">{formatMonthYear(label ?? p.date)}</p>
      <dl className="space-y-0.5 tnum">
        {rows.map(([name, val, color]) => (
          <div key={name} className="flex justify-between gap-6">
            <dt className="flex items-center gap-1.5 text-secondary">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />
              {name}
            </dt>
            <dd className="text-primary">{formatK(val)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-6 border-t border-border pt-0.5">
          <dt className="font-medium text-secondary">Breakeven</dt>
          <dd className="font-semibold text-primary">{formatK(p.breakeven, false)}</dd>
        </div>
      </dl>
    </div>
  )
}

export function StackedComponentChart({
  components,
}: {
  components: CheremukhinComponentPoint[]
}) {
  if (components.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center text-sm text-secondary">
        No data available.
      </div>
    )
  }

  const janTicks = components.map((c) => c.date).filter((d) => d.endsWith('-01-01'))

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={components} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={COLORS.grid} vertical={false} />
        <XAxis
          dataKey="date"
          ticks={janTicks}
          tickFormatter={(d: string) => d.slice(0, 4)}
          tick={{ fill: COLORS.axis, fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: COLORS.grid }}
        />
        <YAxis
          tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}k`}
          tick={{ fill: COLORS.axis, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <ReferenceLine y={0} stroke={COLORS.axis} />
        <Tooltip content={<ComponentTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
        <Bar dataKey="pop" name="Population" stackId="c" fill={COLORS.pop} isAnimationActive={false} />
        <Bar dataKey="lfp" name="LFP cycle" stackId="c" fill={COLORS.lfp} isAnimationActive={false} />
        <Bar dataKey="structural" name="Structural" stackId="c" fill={COLORS.structural} isAnimationActive={false} />
        <Line
          dataKey="breakeven"
          name="Breakeven"
          stroke={COLORS.total}
          strokeWidth={2}
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
