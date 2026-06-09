import { computeGregoryBick } from '@/lib/models/gregoryBick'
import { BreakevenChart } from '@/components/charts/BreakevenChart'
import { ModelCard } from '@/components/ModelCard'
import { MetricsRow } from '@/components/MetricsRow'
import { MethodologyNote } from '@/components/MethodologyNote'
import { formatK, formatMonthYear, formatLongDate } from '@/lib/formatting'
import type { CboPopGrowthConfig } from '@/config/scenarios.config'

// Temporarily render at request time while we confirm the data pipeline on
// Vercel (env vars, FRED + BLS). Switch back to `export const revalidate =
// 21600` once confirmed good.
export const dynamic = 'force-dynamic'

interface Decomp {
  breakeven: number
  cbo: number
  lfpr: number
  unemployment: number
  surveyAdj: number
}

function ErrorState() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-primary">
          St. Louis Fed — Gregory &amp; Bick
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

export default async function StLouisFedPage() {
  let result
  try {
    result = await computeGregoryBick()
  } catch (err) {
    console.error('StLouisFedPage failed to compute breakeven:', err)
    return <ErrorState />
  }

  if (!result.points.length) {
    return <ErrorState />
  }

  const headlineMonth = (result.meta?.headlineMonth as string | null) ?? null
  const gap = (result.meta?.gap as number | null) ?? null
  const decomp = (result.meta?.decomposition as Decomp | null) ?? null
  const cbo = result.meta?.cbo as CboPopGrowthConfig
  const headlineYear = headlineMonth ? headlineMonth.slice(0, 4) : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-primary">
            St. Louis Fed — Gregory &amp; Bick
          </h2>
          <p className="mt-1 text-sm text-secondary">
            Breakeven from CBO-projected population growth × participation ×
            employment rate, adjusted to payrolls.
          </p>
        </div>
        {headlineMonth && (
          <p className="text-xs text-tertiary">
            Latest data: {formatMonthYear(headlineMonth)} · Updated{' '}
            {formatLongDate(new Date(result.computedAt))}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <ModelCard
          label={`Breakeven${headlineYear ? ` · ${headlineYear}` : ''}`}
          value={formatK(result.latestBreakeven, false)}
          sub="Current estimate, per month"
        />
        <ModelCard
          label="Actual NFP"
          value={formatK(result.latestActual)}
          sub="Latest monthly print"
        />
        <ModelCard
          label="Gap vs Breakeven"
          value={formatK(gap)}
          sub={gap == null ? undefined : gap >= 0 ? 'Above breakeven' : 'Below breakeven'}
          accent={gap == null ? 'neutral' : gap >= 0 ? 'positive' : 'negative'}
        />
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex items-center gap-4 text-xs text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-3 rounded-sm bg-chart-bar" />
            Actual NFP (MoM)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 bg-chart-line" />
            Breakeven (CBO projection)
          </span>
        </div>
        <BreakevenChart points={result.points} />
      </div>

      {decomp && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-secondary">
            Decomposition · {headlineYear} (per month)
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm tnum">
            <span className="text-secondary">CBO pop. growth</span>
            <span className="font-medium text-primary">{formatK(decomp.cbo, false)}</span>
            <span className="text-tertiary">× LFPR {decomp.lfpr.toFixed(1)}%</span>
            <span className="text-tertiary">× (1 − u {decomp.unemployment.toFixed(1)}%)</span>
            <span className="text-tertiary">× survey adj {decomp.surveyAdj.toFixed(3)}</span>
            <span className="text-tertiary">=</span>
            <span className="font-semibold text-accent">{formatK(decomp.breakeven, false)}</span>
          </div>
        </div>
      )}

      <MetricsRow actual={result.actualSummary} breakeven={result.breakevenSummary} />

      <div className="rounded-lg border border-accent/20 bg-accent/5 p-5 text-sm leading-relaxed text-primary">
        Breakeven is the payroll growth that holds the unemployment rate flat:
        the labor force grows with CBO-projected population and participation,
        and employment must keep pace. CBO&rsquo;s projected population growth has
        fallen sharply — from {formatK(cbo?.byYear?.[2024], false)}/mo in 2024 to{' '}
        {formatK(cbo?.byYear?.[2026], false)}/mo in 2026 — pulling breakeven down
        with it.
      </div>

      {cbo && (
        <p className="text-xs text-tertiary">
          Population-growth inputs: {cbo.source} (vintage {cbo.vintageDate}).
          This value updates when CBO publishes a new Demographic Outlook —
          edit <code>config/scenarios.config.ts</code>.
        </p>
      )}

      <MethodologyNote
        source="Victoria Gregory & Alexander Bick, Federal Reserve Bank of St. Louis, April 15, 2025."
        vintage={`${cbo?.source ?? 'CBO Demographic Outlook'}; FRED CIVPART, UNRATE, PAYEMS; BLS LNS16000000`}
      >
        <p>
          Breakeven = CBO projected population growth × LFPR (12-month average) ×
          (1 − unemployment rate) × survey adjustment. The CBO population-growth
          figure is read for the current calendar year from a year-keyed config
          ({formatK(cbo?.byYear?.[2024], false)}/mo 2024,{' '}
          {formatK(cbo?.byYear?.[2025], false)}/mo 2025,{' '}
          {formatK(cbo?.byYear?.[2026], false)}/mo 2026) and updates with each
          CBO Demographic Outlook.
        </p>
        <p>
          The survey adjustment is the rolling 12-month average of PAYEMS ÷
          LNS16000000 (household employment adjusted to the payroll-survey
          concept). LNS16000000 is fetched from the BLS API because FRED does
          not carry it; the ratio runs near 1.0.
        </p>
      </MethodologyNote>
    </div>
  )
}
