import { computeSfFed } from '@/lib/models/sfFed'
import { BreakevenChart, type BreakevenSeries } from '@/components/charts/BreakevenChart'
import { ModelCard } from '@/components/ModelCard'
import { MetricsRow } from '@/components/MetricsRow'
import { MethodologyNote } from '@/components/MethodologyNote'
import { formatK, formatMonthYear, formatLongDate } from '@/lib/formatting'

export const dynamic = 'force-dynamic'

const SERIES: BreakevenSeries[] = [
  { key: 'shortRun', label: 'Short-run breakeven', color: '#1d4ed8' },
  { key: 'srHighProj', label: 'Short-run · high immig. (proj.)', color: '#dc2626', dashed: true },
  { key: 'srBaseProj', label: 'Short-run · baseline (proj.)', color: '#1d4ed8', dashed: true },
  { key: 'longRun', label: 'Long-run breakeven', color: '#64748b' },
]

function ErrorState() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-primary">
          SF Fed — Petrosky-Nadeau &amp; Stewart
        </h2>
      </div>
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm font-medium text-primary">
          Data unavailable — check back after the next refresh
        </p>
        <p className="mt-2 text-xs text-secondary">
          The breakeven series could not be computed (data source or
          environment configuration may be temporarily unavailable).
        </p>
      </div>
    </div>
  )
}

export default async function SfFedPage() {
  let result
  try {
    result = await computeSfFed()
  } catch (err) {
    console.error('SfFedPage failed to compute breakeven:', err)
    return <ErrorState />
  }
  if (!result.points.length) return <ErrorState />

  const lastRealized = (result.meta?.lastRealized as string | null) ?? null
  const latestLongRun = (result.meta?.latestLongRun as number | null) ?? null
  const gap =
    result.latestActual != null && result.latestBreakeven != null
      ? result.latestActual - result.latestBreakeven
      : null

  const legend: Array<{ label: string; color: string; dashed?: boolean }> = [
    { label: 'Actual NFP (MoM)', color: '#93c5fd' },
    { label: 'Short-run breakeven', color: '#1d4ed8' },
    { label: 'High-immig. proj.', color: '#dc2626', dashed: true },
    { label: 'Baseline proj.', color: '#1d4ed8', dashed: true },
    { label: 'Long-run', color: '#64748b' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-primary">
            SF Fed — Petrosky-Nadeau &amp; Stewart
          </h2>
          <p className="mt-1 text-sm text-secondary">
            Band-pass-filtered trend labor-force growth × (1 − u): a structural
            long-run rate versus a cyclically variable short-run rate.
          </p>
        </div>
        {lastRealized && (
          <p className="text-xs text-tertiary">
            Realized through {formatMonthYear(lastRealized)} · Updated{' '}
            {formatLongDate(new Date(result.computedAt))}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <ModelCard
          label="Short-run breakeven"
          value={formatK(result.latestBreakeven, false)}
          sub={lastRealized ? `${formatMonthYear(lastRealized)}, cyclical` : undefined}
        />
        <ModelCard
          label="Long-run breakeven"
          value={formatK(latestLongRun, false)}
          sub="Structural (40-yr trend)"
        />
        <ModelCard
          label="Actual NFP"
          value={formatK(result.latestActual)}
          sub={gap == null ? 'Latest print' : gap >= 0 ? 'Above short-run breakeven' : 'Below short-run breakeven'}
          accent={gap == null ? 'neutral' : gap >= 0 ? 'positive' : 'negative'}
        />
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-secondary">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4"
                style={{
                  background: l.dashed
                    ? `repeating-linear-gradient(90deg, ${l.color} 0 4px, transparent 4px 7px)`
                    : l.color,
                  height: l.label.includes('NFP') ? 10 : 2,
                  width: l.label.includes('NFP') ? 12 : 16,
                  borderRadius: l.label.includes('NFP') ? 2 : 0,
                }}
              />
              {l.label}
            </span>
          ))}
        </div>
        <p className="mb-3 text-xs text-tertiary">
          Solid lines are realized (band-pass trend); dashed lines beyond{' '}
          {lastRealized ? formatMonthYear(lastRealized) : 'the latest data'} are
          forward projections under baseline vs high-immigration scenarios.
        </p>
        <BreakevenChart points={result.points} series={SERIES} />
      </div>

      <MetricsRow actual={result.actualSummary} breakeven={result.breakevenSummary} />

      <div className="rounded-lg border border-accent/20 bg-accent/5 p-5 text-sm leading-relaxed text-primary">
        The long-run structural breakeven is stable around{' '}
        {formatK(latestLongRun, false)}/month. The short-run rate is cyclically
        variable — it peaked near 230–290k during the 2023–24 immigration surge
        and has since fallen sharply (now near the long-run, even below it) as net
        immigration reversed. The dashed lines show how it would evolve if
        immigration stays low (baseline) versus rebounds (high).
      </div>

      <MethodologyNote
        source="Nicolas Petrosky-Nadeau & Stephanie Stewart, FRBSF Economic Letter 2024-18, July 8, 2024."
        vintage="FRED CLF16OV (1948–present) + PAYEMS; Christiano-Fitzgerald band-pass; scenario projections"
      >
        <p>
          Breakeven = trend labor-force growth × (1 − u), u = 3.8%. Trends are
          extracted with a Christiano-Fitzgerald band-pass (low-pass) filter on
          the civilian labor-force level: the <strong>long-run</strong> trend
          keeps movements at the 40-year+ horizon (~{formatK(latestLongRun, false)}
          /month here), and the <strong>short-run</strong> trend keeps movements
          down to ~18-month horizons (cyclically elevated by the 2022–24
          immigration surge). The labor force is projected forward 24 months under
          baseline vs high-immigration scenarios (dashed).
        </p>
        <p>
          CLF16OV&rsquo;s January CPS population-control level jumps are removed
          before filtering (a +2.2M Jan-2025 step would otherwise spike the
          short-run trend), and the 2020–21 COVID crash/rebound is interpolated
          as an outlier so the band-pass doesn&rsquo;t ring off it (which had
          produced a spurious early-2022 dip). Realized values run well below the July-2024 paper
          because net immigration reversed after 2024, genuinely collapsing the
          short-run rate — a useful sanity check, not an error. Long-run sits at
          the upper edge of the paper&rsquo;s 70–90k (aggregate FRED data vs the
          paper&rsquo;s CPS microdata by age/sex/race).
        </p>
      </MethodologyNote>
    </div>
  )
}
