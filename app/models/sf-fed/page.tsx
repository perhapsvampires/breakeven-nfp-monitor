import { computeSfFed } from '@/lib/models/sfFed'
import { BreakevenChart } from '@/components/charts/BreakevenChart'
import { ModelCard } from '@/components/ModelCard'
import { MetricsRow } from '@/components/MetricsRow'
import { MethodologyNote } from '@/components/MethodologyNote'
import { formatK, formatMonthYear, formatLongDate } from '@/lib/formatting'

export const dynamic = 'force-dynamic'

interface LongRun {
  low: number
  high: number
  mid: number
}

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

  const longRun = (result.meta?.longRun as LongRun) ?? { low: 70, high: 90, mid: 75 }
  const shortRunMonth = (result.meta?.shortRunMonth as string | null) ?? null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-primary">
            SF Fed — Petrosky-Nadeau &amp; Stewart
          </h2>
          <p className="mt-1 text-sm text-secondary">
            A stable long-run structural breakeven versus a cyclically variable
            short-run rate from labor-force growth.
          </p>
        </div>
        {shortRunMonth && (
          <p className="text-xs text-tertiary">
            Latest data: {formatMonthYear(shortRunMonth)} · Updated{' '}
            {formatLongDate(new Date(result.computedAt))}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <ModelCard
          label="Short-run breakeven"
          value={formatK(result.latestBreakeven, false)}
          sub="6-month avg of labor-force growth"
        />
        <ModelCard
          label="Long-run breakeven"
          value={`${longRun.low}–${longRun.high}k`}
          sub={`Structural trend (~${longRun.mid}k)`}
        />
        <ModelCard
          label="Actual NFP"
          value={formatK(result.latestActual)}
          sub="Latest monthly print"
        />
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-3 rounded-sm bg-chart-bar" />
            Actual NFP (MoM)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 bg-chart-line" />
            Short-run breakeven
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-3 rounded-sm" style={{ background: 'rgba(22,163,74,0.25)' }} />
            Long-run band (~{longRun.low}–{longRun.high}k)
          </span>
        </div>
        <BreakevenChart
          points={result.points}
          referenceBand={{ low: longRun.low, high: longRun.high, label: `Long-run ~${longRun.mid}k` }}
        />
      </div>

      <MetricsRow actual={result.actualSummary} breakeven={result.breakevenSummary} />

      <div className="rounded-lg border border-accent/20 bg-accent/5 p-5 text-sm leading-relaxed text-primary">
        The structural (long-run) breakeven is a stable ~{longRun.low}–
        {longRun.high}k/month. The short-run rate tracks labor-force growth and
        swings widely with the cycle — it peaked near 230k during the 2023–24
        immigration surge and has fallen sharply as net immigration reversed.
      </div>

      <MethodologyNote
        source="Nicolas Petrosky-Nadeau & Stephanie Stewart, FRBSF Economic Letter 2024-18, July 8, 2024."
        vintage="FRED CLF16OV (labor force), PAYEMS; long-run band ~70–90k from the paper's band-pass filter"
      >
        <p>
          The short-run breakeven is a 6-month moving average of monthly
          labor-force growth (CLF16OV), excluding January transitions because
          CPS population controls are revised each January as a one-time level
          step. The long-run breakeven is shown as a flat ~{longRun.low}–
          {longRun.high}k band (midpoint {longRun.mid}k), approximating the
          structural rate the paper extracts with a band-pass filter.
        </p>
        <p>
          The short-run series is cyclical and noisy by design; windows
          disrupted by the October 2025 CPS data gap (government shutdown) are
          omitted rather than averaged from too few months.
        </p>
      </MethodologyNote>
    </div>
  )
}
