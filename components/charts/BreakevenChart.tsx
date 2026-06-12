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
import { formatK, formatMonthYear } from '@/lib/formatting'
import { ChartTooltip } from './ChartTooltip'

/**
 * A chart point: the standard breakeven fields plus any number of extra
 * numeric series keys (referenced by `series[].key`).
 *
 * Note: this is intentionally NOT an index-signature intersection — that would
 * make a plain `BreakevenPoint` non-assignable. Extra series keys are read with
 * a runtime-safe lookup helper instead, so callers can pass either a plain
 * `BreakevenPoint[]` or objects with arbitrary extra numeric fields.
 */
export type BreakevenChartPoint = BreakevenPoint

/** Safely read an arbitrary numeric series key off a chart point. */
function readNum(point: BreakevenChartPoint, key: string): number | null {
  const v = (point as unknown as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : null
}

/** A single extra breakeven line rendered when `series` is provided. */
export interface BreakevenSeries {
  /** Numeric field on each point to plot. */
  key: string
  /** Display name (legend / tooltip). */
  label: string
  /** Stroke color. */
  color: string
  /** Render as a dashed line. */
  dashed?: boolean
}

const COLORS = {
  bar: '#93c5fd',
  line: '#1d4ed8',
  axis: '#94a3b8',
  grid: '#e2e8f0',
  zero: '#94a3b8',
  recession: 'rgba(100,116,139,0.08)',
  select: 'rgba(29,78,216,0.10)',
  band: 'rgba(22,163,74,0.08)', // long-run reference band
  bandLine: '#16a34a',
}

// Window whose 12-month-window distortions are excluded from the *default*
// y-axis fit so COVID volatility doesn't flatten the rest of the series.
const DEFAULT_OUTLIER_WINDOW = { start: '2020-03-01', end: '2021-12-01' }

type YDomain = [number, number] | ['auto', 'auto']

/**
 * Nice-rounded [min, max] covering the actual NFP plus the plotted line
 * values in `pts`. When `seriesKeys` is non-empty those keys are scanned
 * instead of the default `breakeven` field; otherwise `breakeven` is used.
 */
function computeYDomain(
  pts: BreakevenChartPoint[],
  seriesKeys: string[] = [],
): YDomain {
  const lineKeys = seriesKeys.length > 0 ? seriesKeys : ['breakeven']
  const vals: number[] = []
  for (const p of pts) {
    if (p.actualNfp != null) vals.push(p.actualNfp)
    for (const k of lineKeys) {
      const v = readNum(p, k)
      if (v != null) vals.push(v)
    }
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

/**
 * Tooltip used when `series` is provided: shows the date, Actual NFP, and one
 * row per series (label → value) in the series color.
 */
function MultiSeriesTooltip({
  active,
  payload,
  label,
  series,
}: {
  active?: boolean
  label?: string
  payload?: Array<{ payload: BreakevenChartPoint }>
  series: BreakevenSeries[]
}) {
  if (!active || !payload || payload.length === 0) return null
  const point = payload[0].payload
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
        {series.map((s) => (
          <div key={s.key} className="flex justify-between gap-6">
            <dt className="text-secondary" style={{ color: s.color }}>
              {s.label}
            </dt>
            <dd className="text-primary">
              {formatK(readNum(point, s.key), false)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

interface BreakevenChartProps {
  /**
   * Chart points. Pass a plain `BreakevenPoint[]` (default single-line usage)
   * or points that also carry extra numeric fields named by `series[].key`
   * (multi-line usage). Extra keys are read with a runtime-safe lookup, so the
   * declared element type stays `BreakevenPoint` and any `BreakevenPoint[]`
   * (or wider, with extra fields) remains assignable.
   */
  points: BreakevenChartPoint[]
  /** Date range excluded from the default y-fit (defaults to the COVID window). */
  outlierWindow?: { start: string; end: string }
  /** Optional horizontal reference band (e.g. a long-run structural range). */
  referenceBand?: { low: number; high: number; label?: string }
  /**
   * Optional multiple breakeven lines. When provided, one line is rendered per
   * entry (using `key` as the numeric dataKey) INSTEAD of the default single
   * `breakeven` line, and a multi-series tooltip is used. Each `key` must exist
   * as a numeric field on the point objects.
   */
  series?: BreakevenSeries[]
  /** Additional flat horizontal reference lines (e.g. a historical baseline). */
  extraLines?: Array<{ y: number; label?: string; color?: string; dashed?: boolean }>
}

export function BreakevenChart({
  points,
  outlierWindow = DEFAULT_OUTLIER_WINDOW,
  referenceBand,
  series,
  extraLines,
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

  // Y domain: exact fit when zoomed; outlier-excluded fit by default. Always
  // widen to include the reference band so it stays visible.
  const yDomain = useMemo<YDomain>(() => {
    const seriesKeys = series?.map((s) => s.key) ?? []
    const base = zoom
      ? computeYDomain(visible, seriesKeys)
      : computeYDomain(
          points.filter(
            (p) => p.date < outlierWindow.start || p.date > outlierWindow.end,
          ).length
            ? points.filter(
                (p) => p.date < outlierWindow.start || p.date > outlierWindow.end,
              )
            : points,
          seriesKeys,
        )
    let lo = base[0]
    let hi = base[1]
    if (lo === 'auto' || hi === 'auto') return base
    if (referenceBand) {
      lo = Math.min(lo, referenceBand.low)
      hi = Math.max(hi, referenceBand.high)
    }
    if (extraLines?.length) {
      for (const l of extraLines) {
        lo = Math.min(lo, l.y)
        hi = Math.max(hi, l.y)
      }
    }
    return [lo, hi]
  }, [points, visible, zoom, outlierWindow, referenceBand, series, extraLines])

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
            {referenceBand && (
              <ReferenceArea
                y1={referenceBand.low}
                y2={referenceBand.high}
                fill={COLORS.band}
                stroke="none"
              />
            )}
            {referenceBand && (
              <ReferenceLine
                y={(referenceBand.low + referenceBand.high) / 2}
                stroke={COLORS.bandLine}
                strokeDasharray="4 4"
                label={
                  referenceBand.label
                    ? {
                        value: referenceBand.label,
                        position: 'insideBottomRight',
                        fill: COLORS.bandLine,
                        fontSize: 11,
                      }
                    : undefined
                }
              />
            )}
            {extraLines?.map((l, i) => (
              <ReferenceLine
                key={`extra-${i}`}
                y={l.y}
                stroke={l.color ?? COLORS.axis}
                strokeDasharray={l.dashed === false ? undefined : '3 3'}
                label={
                  l.label
                    ? {
                        value: l.label,
                        position: 'insideTopRight',
                        fill: l.color ?? COLORS.axis,
                        fontSize: 11,
                      }
                    : undefined
                }
              />
            ))}
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
              content={
                series && series.length > 0 ? (
                  <MultiSeriesTooltip series={series} />
                ) : (
                  <ChartTooltip />
                )
              }
              cursor={{ fill: 'rgba(0,0,0,0.03)' }}
            />
            <Bar
              dataKey="actualNfp"
              name="Actual NFP"
              fill={COLORS.bar}
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />
            {series && series.length > 0 ? (
              series.map((s) => (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray={s.dashed ? '5 4' : undefined}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))
            ) : (
              <Line
                dataKey="breakeven"
                name="Breakeven"
                stroke={COLORS.line}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
