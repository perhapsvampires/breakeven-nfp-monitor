import { computeEmployAmericaCER } from '@/lib/models/employAmericaCER'
import { BreakevenChart } from '@/components/charts/BreakevenChart'
import { ModelCard } from '@/components/ModelCard'
import { MetricsRow } from '@/components/MetricsRow'
import { MethodologyNote } from '@/components/MethodologyNote'
import { formatK, formatMonthYear, formatLongDate } from '@/lib/formatting'
import type { CerDecomposition } from '@/types/economic'

// Temporarily render at request time while we confirm the data pipeline on
// Vercel (env vars + data/cer-cohorts.json). Switch back to `export const
// revalidate = 21600` once the data is confirmed good.
export const dynamic = 'force-dynamic'

function ErrorState() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-primary">
          Employ America — Constant-Employment-Rate (CER)
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

export default async function EmployAmericaPage() {
  let result
  try {
    result = await computeEmployAmericaCER()
  } catch (err) {
    console.error('EmployAmericaPage failed to compute CER:', err)
    return <ErrorState />
  }

  // The model returns an empty result rather than throwing on failure; treat
  // that as the error state too.
  if (!result.points.length) {
    return <ErrorState />
  }

  const latestPoint = [...result.points].reverse().find((p) => p.breakeven != null)
  const latestMonth = latestPoint?.date
  const gap =
    result.latestActual != null && result.latestBreakeven != null
      ? result.latestActual - result.latestBreakeven
      : null
  const decomp = (result.meta?.decomposition as CerDecomposition | null) ?? null
  const staleMonths = (result.meta?.staleMonths as number | undefined) ?? 0
  const cohortLastMonth = (result.meta?.cohortLastMonth as string | null) ?? null

  return (
    <div className="space-y-6">
      {staleMonths > 0 && (
        <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-secondary">
          <span className="font-medium text-warning">
            {staleMonths === 1 ? 'Latest month' : `Latest ${staleMonths} months`}
          </span>{' '}
          use a carried-forward cohort EPR term
          {cohortLastMonth
            ? `: CPS microdata runs through ${formatMonthYear(cohortLastMonth)}, behind the payroll data.`
            : ' — CPS microdata is behind the payroll data.'}{' '}
          Payroll growth is current; the employment-rate component is not, so
          these points will revise when the next CPS release lands.
        </div>
      )}
      {/* Title */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-primary">
            Employ America — Constant-Employment-Rate (CER)
          </h2>
          <p className="mt-1 text-sm text-secondary">
            Population-driven breakeven payrolls, stripping out within-cohort
            employment-rate changes.
          </p>
        </div>
        {latestMonth && (
          <p className="text-xs text-tertiary">
            Latest data: {formatMonthYear(latestMonth)} · Updated{' '}
            {formatLongDate(new Date(result.computedAt))}
          </p>
        )}
      </div>

      {/* Headline cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <ModelCard
          label="CER Breakeven"
          value={formatK(result.latestBreakeven, false)}
          sub={latestMonth ? `${formatMonthYear(latestMonth)}, per month` : undefined}
          accent="neutral"
        />
        <ModelCard
          label="Actual NFP"
          value={formatK(result.latestActual)}
          sub="Latest monthly print"
          accent="neutral"
        />
        <ModelCard
          label="Gap vs Breakeven"
          value={formatK(gap)}
          sub={gap == null ? undefined : gap >= 0 ? 'Above breakeven' : 'Below breakeven'}
          accent={gap == null ? 'neutral' : gap >= 0 ? 'positive' : 'negative'}
        />
      </div>

      {/* Chart */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex items-center gap-4 text-xs text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-3 rounded-sm bg-chart-bar" />
            Actual NFP (MoM)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 bg-chart-line" />
            CER breakeven
          </span>
        </div>
        <BreakevenChart points={result.points} />
      </div>

      {/* Decomposition */}
      {decomp && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-secondary">
            Latest decomposition (per month)
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm tnum">
            <span className="text-secondary">NFP growth</span>
            <span className="font-medium text-primary">{formatK(decomp.gN)}</span>
            <span className="text-tertiary">−</span>
            <span className="text-secondary">EPR change</span>
            <span className="font-medium text-primary">{formatK(decomp.gEpr)}</span>
            <span className="text-tertiary">−</span>
            <span className="text-secondary">adjustment</span>
            {decomp.gAdjAvailable ? (
              <span className="font-medium text-primary">{formatK(decomp.gAdj)}</span>
            ) : (
              <span className="font-medium text-warning" title="BLS series LNS16000000 unavailable; breakeven is overstated by this term">
                n/a
              </span>
            )}
            <span className="text-tertiary">=</span>
            <span className="text-secondary">CER breakeven</span>
            <span className="font-semibold text-accent">{formatK(decomp.gCer, false)}</span>
          </div>
        </div>
      )}

      {/* Metrics */}
      <MetricsRow actual={result.actualSummary} breakeven={result.breakevenSummary} />

      {/* Source callout */}
      <div className="rounded-lg border border-accent/20 bg-accent/5 p-5 text-sm leading-relaxed text-primary">
        This model removes the effect of changing employment rates within age
        groups, leaving only the population-driven component. It requires no
        immigration assumptions, making it the most robust to demographic
        uncertainty.
      </div>

      {/* Methodology */}
      <MethodologyNote
        source="Preston Mui, Employ America — “Estimating Constant-Employment-Rate (CER) NFP Growth,” April 2026."
        vintage="Census CPS Basic Monthly microdata (foreign-born × age cohorts) + FRED PAYEMS; 12-month windows"
      >
        <p>
          CER decomposes 12-month payroll growth into a within-cohort
          employment-rate term, a population term, a CPS-to-CES definitional
          adjustment, and residual noise:{' '}
          <span className="tnum">g_CER = g_N − g_ẽ − g_A</span>. Subtracting the
          employment-weighted change in cohort employment-population ratios
          leaves the population-driven pace of job growth needed to hold
          employment rates constant.
        </p>
        <p>
          Cohorts are defined by foreign-born status crossed with 5-year age
          bands (16-19, 20-24, …, 65-69, 70+) — the paper&rsquo;s granularity,
          except that its 70-74 and 75+ are collapsed into 70+ to keep the
          foreign-born cells large enough for a stable monthly EPR. Employment
          and population are aggregated from Census CPS Basic Monthly microdata
          (weight PWSSWGT). The foreign-born dimension lets the 2025-26
          immigration reversal register as a population effect — the reason this
          tracks Employ America&rsquo;s published series. The payroll-concept
          adjustment g_A = ln(A_t′/A_t), A = LNS16000000/CE16OV, is included;
          it is not small, running a 30-80k/month effect through 2025.
          Validated against the published chart over 27 months: mean 86k vs
          99k (bias −13k), MAE 40k. January estimates are the least reliable —
          the annual CPS population-control revision steps the cohort
          employment levels that weight the EPR term.
        </p>
      </MethodologyNote>
    </div>
  )
}
