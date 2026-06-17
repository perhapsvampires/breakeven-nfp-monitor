import { computeMurrayVidangos, NATURAL_CHANGE_CNP16_PER_MONTH } from '@/lib/models/murrayVidangos'
import { BreakevenChart } from '@/components/charts/BreakevenChart'
import { ModelCard } from '@/components/ModelCard'
import { MetricsRow } from '@/components/MetricsRow'
import { MethodologyNote } from '@/components/MethodologyNote'
import { ScenarioToggle } from '@/components/ScenarioToggle'
import { formatK, formatLongDate, formatMonthYear, formatPct } from '@/lib/formatting'
import {
  getScenario,
  type ImmigrationScenario,
  type ScenarioId,
} from '@/config/scenarios.config'

export const dynamic = 'force-dynamic'

function ErrorState() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-primary">
          Board of Governors — Murray &amp; Vidangos
        </h2>
      </div>
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm font-medium text-primary">
          Data unavailable — check back after the next refresh
        </p>
        <p className="mt-2 text-xs text-secondary">
          The breakeven estimate could not be computed (FRED data or CBO
          projections file may be temporarily unavailable).
        </p>
      </div>
    </div>
  )
}

export default async function FedBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>
}) {
  const { s } = await searchParams
  const scenario = getScenario(s)

  let result
  try {
    result = await computeMurrayVidangos(scenario.id as ScenarioId)
  } catch (err) {
    console.error('FedBoardPage failed:', err)
    return <ErrorState />
  }
  if (!result.points.length) return <ErrorState />

  const scen = (result.meta?.scenario as ImmigrationScenario) ?? scenario
  const scenarioBreakeven = (result.meta?.scenarioBreakeven as number | null) ?? null
  const scenarioDeltaPopulation16 = (result.meta?.scenarioDeltaPopulation16 as number | null) ?? null
  const latestPotentialLFPR = (result.meta?.latestPotentialLFPR as number | null) ?? null
  const latestNrou = (result.meta?.latestNrou as number | null) ?? null
  const latestDeltaPotentialLFPR = (result.meta?.latestDeltaPotentialLFPR as number | null) ?? null
  const populationGrowthTerm = (result.meta?.populationGrowthTerm as number | null) ?? null
  const lfprTrendTerm = (result.meta?.lfprTrendTerm as number | null) ?? null
  const observedDate = (result.meta?.observedDate as string | null) ?? null

  const gap =
    result.latestActual != null && result.latestBreakeven != null
      ? result.latestActual - result.latestBreakeven
      : null

  // Scenario-based "current" band — show ±20k around the point estimate
  // (reflecting uncertainty in immigration assumption within the scenario)
  const scenarioBandLow = scenarioBreakeven != null ? scenarioBreakeven - 20 : null
  const scenarioBandHigh = scenarioBreakeven != null ? scenarioBreakeven + 20 : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-primary">
            Board of Governors — Murray &amp; Vidangos
          </h2>
          <p className="mt-1 text-sm text-secondary">
            Potential labor force growth (CBO structural LFPR × population)
            scaled by the noncyclical unemployment rate.
          </p>
        </div>
        <p className="text-xs text-tertiary">
          Updated {formatLongDate(new Date(result.computedAt))}
        </p>
      </div>

      <ScenarioToggle active={scenario.id} />

      {/* Key finding callout */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
        <p className="font-semibold text-amber-900">
          Key finding (Murray &amp; Vidangos, April 2026)
        </p>
        <p className="mt-1 text-amber-800 leading-relaxed">
          &ldquo;Potential labor force growing by fewer than 10,000 per month
          in 2026 — a pace without precedent in at least 65 years.&rdquo;
          {scenarioBreakeven != null && (
            <> Under the {scen.label.toLowerCase()} immigration scenario, this
            model currently estimates a breakeven of {formatK(scenarioBreakeven, false)}/month.</>
          )}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <ModelCard
          label={`Breakeven · ${scen.label} scenario`}
          value={formatK(scenarioBreakeven, false)}
          sub="Current scenario estimate"
        />
        <ModelCard
          label="Actual NFP"
          value={formatK(result.latestActual)}
          sub="Latest monthly print"
        />
        <ModelCard
          label="Gap vs breakeven"
          value={formatK(gap)}
          sub={gap == null ? undefined : gap >= 0 ? 'Above breakeven' : 'Below breakeven'}
          accent={gap == null ? 'neutral' : gap >= 0 ? 'positive' : 'negative'}
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
            Breakeven (dynamic, realized)
          </span>
          {scenarioBandLow != null && scenarioBandHigh != null && (
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-3 rounded-sm"
                style={{ background: 'rgba(22,163,74,0.18)' }}
              />
              {scen.label} scenario range
            </span>
          )}
        </div>
        <BreakevenChart
          points={result.points}
          referenceBand={
            scenarioBandLow != null && scenarioBandHigh != null
              ? {
                  low: scenarioBandLow,
                  high: scenarioBandHigh,
                  label: `${scen.label} scenario`,
                }
              : undefined
          }
        />
      </div>

      {/* Decomposition */}
      {(populationGrowthTerm != null || lfprTrendTerm != null) && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-tertiary">
            Potential labor force decomposition
            {observedDate && <> · as of {formatMonthYear(observedDate)}</>}
          </p>
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div>
              <p className="text-xs text-secondary">Population growth term</p>
              <p className="mt-0.5 font-semibold tabular-nums text-primary">
                {formatK(populationGrowthTerm, false)}/mo
              </p>
              <p className="mt-0.5 text-xs text-tertiary">
                ΔPop16 × CBO potential LFPR ({latestPotentialLFPR != null ? formatPct(latestPotentialLFPR, 1) : '—'})
              </p>
            </div>
            <div>
              <p className="text-xs text-secondary">LFPR trend term</p>
              <p className="mt-0.5 font-semibold tabular-nums text-primary">
                {formatK(lfprTrendTerm, false)}/mo
              </p>
              <p className="mt-0.5 text-xs text-tertiary">
                ΔPotential LFPR × pop — aging-population drag
              </p>
            </div>
            <div>
              <p className="text-xs text-secondary">Noncyclical unemployment</p>
              <p className="mt-0.5 font-semibold tabular-nums text-primary">
                {latestNrou != null ? formatPct(latestNrou, 2) : '—'}
              </p>
              <p className="mt-0.5 text-xs text-tertiary">
                CBO NROU — scales potential LF growth to breakeven jobs
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Current scenario callout */}
      <div className="rounded-lg border border-accent/20 bg-accent/5 p-5 text-sm leading-relaxed text-primary">
        <p className="mb-1 text-xs font-medium uppercase tracking-widest text-accent">
          Current scenario — {scen.label}
        </p>
        Under the {scen.label.toLowerCase()} immigration scenario (
        {formatK(scen.monthlyNetImmigration)}/month net), the 16+ civilian
        population grows at approximately{' '}
        {formatK(scenarioDeltaPopulation16, false)}/month ({formatK(NATURAL_CHANGE_CNP16_PER_MONTH, false)}/month
        natural change + {formatK(
          scenarioDeltaPopulation16 != null
            ? scenarioDeltaPopulation16 - NATURAL_CHANGE_CNP16_PER_MONTH
            : null,
          true,
        )}/month from immigration). With CBO&rsquo;s structural LFPR of{' '}
        {latestPotentialLFPR != null ? formatPct(latestPotentialLFPR, 1) : '—'}{' '}
        and NROU of {latestNrou != null ? formatPct(latestNrou, 2) : '—'}, the implied
        breakeven is approximately {formatK(scenarioBreakeven, false)}/month.
      </div>

      <MetricsRow actual={result.actualSummary} breakeven={result.breakevenSummary} />

      <MethodologyNote
        source="Seth Murray & Ivan Vidangos, FEDS Notes, Board of Governors of the Federal Reserve System, April 2, 2026."
        vintage={`CBO Economic Outlook Feb 2026 (potential LFPR & NROU); FRED POPTHM, CNP16OV, PAYEMS. Scenario: ${scen.source} (vintage ${scen.vintageDate})`}
      >
        <p>
          Murray &amp; Vidangos decompose the employment breakeven into two structural
          components. The <strong>population growth term</strong> counts how many new
          working-age people enter the civilian noninstitutional population each month,
          multiplied by CBO&rsquo;s &ldquo;potential&rdquo; (structural/trend) labor
          force participation rate — abstracting away cyclical fluctuations in
          participation. The <strong>LFPR trend term</strong> captures the drag from
          demographic aging: as the population grows older, CBO&rsquo;s projected
          structural participation rate declines slowly (~0.006 pp/month), applying
          a negative adjustment of roughly {formatK(lfprTrendTerm, false)}/month to
          the existing population stock.
        </p>
        <p>
          Multiplying the sum by (1 &minus; NROU) gives the employment growth
          needed to hold the unemployment rate at its noncyclical level. The result
          is highly sensitive to the population growth input: with immigration-driven
          population growth near zero or negative (as in 2025&ndash;2026), the LFPR
          trend drag dominates and the breakeven falls below 10,000/month — the
          paper&rsquo;s headline finding.
        </p>
        <p>
          The chart&rsquo;s blue line uses realized 12-month population growth
          (from FRED POPTHM, scaled to the civilian 16+ population concept) at
          each month, making the breakeven dynamic. The green band shows the
          current scenario&rsquo;s point estimate &plusmn;20k. CBO potential LFPR
          and NROU values are from the February 2026 Budget and Economic Outlook;
          run{' '}
          <code className="rounded bg-background px-1 py-0.5 text-xs">
            node scripts/build-cbo-projections.mjs
          </code>{' '}
          to update when CBO publishes a new outlook.
        </p>
      </MethodologyNote>
    </div>
  )
}
