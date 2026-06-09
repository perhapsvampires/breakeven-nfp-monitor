import { computeCheremukhin } from '@/lib/models/cheremukhin'
import { BreakevenChart } from '@/components/charts/BreakevenChart'
import { StackedComponentChart } from '@/components/charts/StackedComponentChart'
import { ModelCard } from '@/components/ModelCard'
import { MetricsRow } from '@/components/MetricsRow'
import { MethodologyNote } from '@/components/MethodologyNote'
import { ScenarioToggle } from '@/components/ScenarioToggle'
import { formatK, formatMonthYear, formatLongDate } from '@/lib/formatting'
import { getScenario, type ImmigrationScenario, type ScenarioId } from '@/config/scenarios.config'
import type { CheremukhinComponentPoint } from '@/types/economic'

export const dynamic = 'force-dynamic'

function ErrorState() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-primary">
          Dallas Fed — Cheremukhin
        </h2>
      </div>
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm font-medium text-primary">
          Data unavailable — check back after the next refresh
        </p>
        <p className="mt-2 text-xs text-secondary">
          The breakeven decomposition could not be computed (data source or
          environment configuration may be temporarily unavailable).
        </p>
      </div>
    </div>
  )
}

export default async function DallasFedPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>
}) {
  const { s } = await searchParams
  const scenario = getScenario(s)

  let result
  try {
    result = await computeCheremukhin(scenario.id as ScenarioId)
  } catch (err) {
    console.error('DallasFedPage failed to compute breakeven:', err)
    return <ErrorState />
  }
  if (!result.points.length) return <ErrorState />

  const scen = (result.meta?.scenario as ImmigrationScenario) ?? scenario
  const components = (result.meta?.components as CheremukhinComponentPoint[]) ?? []
  const decomp = (result.meta?.decomposition as CheremukhinComponentPoint | null) ?? null
  const deltaPopulation = (result.meta?.deltaPopulation as number) ?? null
  const naturalChange = (result.meta?.naturalChange as number) ?? null

  const latestPoint = [...result.points].reverse().find((p) => p.breakeven != null)
  const latestMonth = latestPoint?.date
  const gap =
    result.latestActual != null && result.latestBreakeven != null
      ? result.latestActual - result.latestBreakeven
      : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-primary">
            Dallas Fed — Cheremukhin
          </h2>
          <p className="mt-1 text-sm text-secondary">
            Breakeven as a growth-accounting sum of population, participation,
            and structural contributions.
          </p>
        </div>
        {latestMonth && (
          <p className="text-xs text-tertiary">
            Latest data: {formatMonthYear(latestMonth)} · Updated{' '}
            {formatLongDate(new Date(result.computedAt))}
          </p>
        )}
      </div>

      <ScenarioToggle active={scenario.id} />

      <div className="grid gap-4 sm:grid-cols-3">
        <ModelCard
          label={`Breakeven · ${scen.label}`}
          value={formatK(result.latestBreakeven, false)}
          sub={latestMonth ? `${formatMonthYear(latestMonth)}, per month` : undefined}
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

      {/* Standard NFP vs breakeven chart */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex items-center gap-4 text-xs text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-3 rounded-sm bg-chart-bar" />
            Actual NFP (MoM)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 bg-chart-line" />
            Breakeven ({scen.label})
          </span>
        </div>
        <BreakevenChart points={result.points} />
      </div>

      {/* Three-component decomposition (stacked) */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <p className="mb-1 text-xs font-medium uppercase tracking-widest text-secondary">
          Breakeven decomposition
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-3 rounded-sm" style={{ background: '#1d4ed8' }} />
            Population
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-3 rounded-sm" style={{ background: '#d97706' }} />
            LFP cycle
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-3 rounded-sm" style={{ background: '#0d9488' }} />
            Structural
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: '#0f172a' }} />
            Breakeven (total)
          </span>
        </div>
        <StackedComponentChart components={components} />
      </div>

      {decomp && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-secondary">
            Latest decomposition · {scen.label} (per month)
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm tnum">
            <span className="text-secondary">Population</span>
            <span className="font-medium text-primary">{formatK(decomp.pop)}</span>
            {deltaPopulation != null && naturalChange != null && (
              <span className="text-tertiary">
                (Δpop {formatK(deltaPopulation, false)}/mo = natural{' '}
                {formatK(naturalChange, false)} + immigration {formatK(scen.monthlyNetImmigration)})
              </span>
            )}
            <span className="text-tertiary">+</span>
            <span className="text-secondary">LFP cycle</span>
            <span className="font-medium text-primary">{formatK(decomp.lfp)}</span>
            <span className="text-tertiary">+</span>
            <span className="text-secondary">structural</span>
            <span className="font-medium text-primary">{formatK(decomp.structural)}</span>
            <span className="text-tertiary">=</span>
            <span className="font-semibold text-accent">{formatK(decomp.breakeven, false)}</span>
          </div>
        </div>
      )}

      <MetricsRow actual={result.actualSummary} breakeven={result.breakevenSummary} />

      {/* Required disclosure */}
      <div className="rounded-lg border border-warning/30 bg-warning/5 p-5 text-sm leading-relaxed text-primary">
        <span className="font-medium">Net unauthorized immigration is the most uncertain input.</span>{' '}
        This dashboard uses public proxy data (CBO projections + scenario config)
        as an approximation of the Dallas Fed&rsquo;s proprietary high-frequency
        estimate. Toggle the scenario to see how breakeven shifts with the
        immigration assumption.
      </div>

      <MethodologyNote
        source="Anton Cheremukhin, Federal Reserve Bank of Dallas, October 2025; updated with Wilson & Zhou, March 2026."
        vintage={`Scenario: ${scen.source} (vintage ${scen.vintageDate}); FRED PAYEMS, CIVPART, CNP16OV, POPTHM`}
      >
        <p>
          Employment satisfies E = POP × (CNP16/POP) × LFPR × (1 − u). Holding
          unemployment constant, breakeven employment growth is the sum of three
          growth-rate contributions (each × the employment level): population
          growth, the 2-year trend in participation, and the slow-moving
          structural CNP16/POP ratio.
        </p>
        <p>
          Population growth combines a {formatK(naturalChange ?? 30, false)}/mo
          natural-change estimate with the selected scenario&rsquo;s net
          immigration. The participation and structural rates are trailing
          24-month averages that exclude January transitions, because CPS
          population controls are revised each January as a one-time level step
          that would otherwise distort the structural component. Employment level
          is PAYEMS, so the breakeven is comparable to the reported NFP.
        </p>
      </MethodologyNote>
    </div>
  )
}
