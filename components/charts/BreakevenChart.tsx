'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { BreakevenPoint } from '@/types/economic'
import { RECESSIONS } from '@/config/recession-dates'
import { ChartTooltip } from './ChartTooltip'

const COLORS = {
  bar: '#93c5fd',
  line: '#1d4ed8',
  axis: '#94a3b8',
  grid: '#e2e8f0',
  zero: '#94a3b8',
  recession: 'rgba(100,116,139,0.08)',
  select: 'rgba(29,78,216,0.10)',
}

// Window whose 12-month-window distortions are excluded from the *default*
// y-axis fit so COVID volatility doesn't flatten the rest of the series.
const DEFAULT_OUTLIER_WINDOW = { start: '2020-03-01', end: '2021-12-01' }

type YDomain = [number, number] | ['auto', 'auto']

/** Nice-rounded [min, max] covering the actual + breakeven values in `pts`. */
function computeYDomain(pts: BreakevenPoint[]): YDomain {
  const vals: number[] = []
  for (const p of pts) {
    if (p.actualNfp != null) vals.push(p.actualNfp)
    if (p.breakeven != null) vals.push(p.breakeven)
  }
  if (vals.length === 0) return ['auto', 'auto']
  let lo = Math.min(...vals, 0)
  let hi = Math.max(...vals, 0)
  const pad = Math.max((hi - lo) * 0.08, 10)
  lo -= pad
  hi += pad
  const step = 50
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step]
}

interface BreakevenChartProps {
  points: BreakevenPoint[]
  /** Date range excluded from the default y-fit (defaults to the COVID window). */
  outlierWindow?: { start: string; end: string }
}

export function BreakevenChart({
  points,
  outlierWindow = DEFAULT_OUTLIER_WINDOW,
}: BreakevenChartProps) {
  const [zoom, setZoom] = useState<{ left: string; right: string } | null>(null)
  const [sel, setSel] = useState<{ a: string | null; b: string | null }>({
    a: null,
    b: null,
  })
  const selecting = useRef(false)

  // Points currently in view (sliced when zoomed).
  const visible = useMemo(() => {
    if (!zoom) return points
    const i1 = points.findIndex((p) => p.date === zoom.left)
    const i2 = points.findIndex((p) => p.date === zoom.right)
    if (i1 < 0 || i2 < 0) return points
    const [lo, hi] = [Math.min(i1, i2), Math.max(i1, i2)]
    return points.slice(lo, hi + 1)
  }, [points, zoom])

  // Y domain: exact fit when zoomed; outlier-excluded fit by default.
  const yDomain = useMemo<YDomain>(() => {
    if (zoom) return computeYDomain(visible)
    const filtered = points.filter(
      (p) => p.date < outlierWindow.start || p.date > outlierWindow.end,
    )
    return computeYDomain(filtered.length ? filtered : points)
  }, [points, visible, zoom, outlierWindow])

  if (points.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center text-sm text-secondary">
        No data available.
      </div>
    )
  }

  const dates = visible.map((p) => p.date)
  const first = dates[0]
  const last = dates[dates.length - 1]
  const dateSet = new Set(dates)
  const janTicks = dates.filter((d) => d.endsWith('-01-01'))

  const bands = RECESSIONS.map((r) => ({
    x1: r.start < first ? first : r.start,
    x2: r.end > last ? last : r.end,
  })).filter((b) => b.x1 <= b.x2 && dateSet.has(b.x1) && dateSet.has(b.x2))

  const startSelect = (state: { activeLabel?: string | number }) => {
    const label = state?.activeLabel
    if (label == null) return
    selecting.current = true
    setSel({ a: String(label), b: String(label) })
  }
  const moveSelect = (state: { activeLabel?: string | number }) => {
    if (!selecting.current) return
    const label = state?.activeLabel
    if (label == null) return
    setSel((prev) => ({ ...prev, b: String(label) }))
  }
  const endSelect = () => {
    if (!selecting.current) return
    selecting.current = false
    const { a, b } = sel
    setSel({ a: null, b: null })
    if (a && b && a !== b) setZoom({ left: a, right: b })
  }

  const showPreview = sel.a != null && sel.b != null && sel.a !== sel.b

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-tertiary">
        <span>Drag to zoom · double-click to reset</span>
        {zoom && (
          <button
            type="button"
            onClick={() => setZoom(null)}
            className="rounded border border-border px-2 py-0.5 font-medium text-secondary transition-colors hover:bg-background hover:text-primary"
          >
            Reset zoom
          </button>
        )}
      </div>
      <div style={{ userSelect: 'none' }}>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart
            data={visible}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            onMouseDown={startSelect}
            onMouseMove={moveSelect}
            onMouseUp={endSelect}
            onMouseLeave={endSelect}
            onDoubleClick={() => setZoom(null)}
          >
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            {bands.map((b, i) => (
              <ReferenceArea
                key={`rec-${i}`}
                x1={b.x1}
                x2={b.x2}
                fill={COLORS.recession}
                stroke="none"
              />
            ))}
            {showPreview && (
              <ReferenceArea
                x1={sel.a as string}
                x2={sel.b as string}
                fill={COLORS.select}
                stroke="none"
              />
            )}
            <XAxis
              dataKey="date"
              ticks={janTicks}
              tickFormatter={(d: string) => d.slice(0, 4)}
              tick={{ fill: COLORS.axis, fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: COLORS.grid }}
            />
            <YAxis
              domain={yDomain}
              allowDataOverflow
              tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}k`}
              tick={{ fill: COLORS.axis, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <ReferenceLine y={0} stroke={COLORS.zero} strokeDasharray="3 3" />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
            />
            <Bar
              dataKey="actualNfp"
              name="Actual NFP"
              fill={COLORS.bar}
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />
            <Line
              dataKey="breakeven"
              name="Breakeven"
              stroke={COLORS.line}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
