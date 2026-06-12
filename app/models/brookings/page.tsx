import {
  computeBrookings,
  PRE_PANDEMIC_RANGE,
} from '@/lib/models/brookings'
import { BreakevenChart } from '@/components/charts/BreakevenChart'
import { ModelCard } from '@/components/ModelCard'
import { MetricsRow } from '@/components/MetricsRow'
import { MethodologyNote } from '@/components/MethodologyNote'
import { ScenarioToggle } from '@/components/ScenarioToggle'
import { formatK, formatLongDate } from '@/lib/formatting'
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
          Brookings — Edelberg &amp; Watson
        </h2>
      </div>
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm font-medium text-primary">
          Data unavailable — check back after the next refresh
        </p>
        <p className="mt-2 text-xs text-secondary">
          The breakeven range could not be computed (data source or
          environment configuration may be temporarily unavailable).
        </p>
      </div>
    </div>
  )
}

export default async function BrookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>
}) {
  const { s } = await searchParams
  const scenario = getScenario(s)

  let result
  try {
    result = await computeBrookings(scenario.id as ScenarioId)
  } catch (err) {
    console.error('BrookingsPage failed to compute breakeven:', err)
    return <ErrorState />
  }
  if (!result.points.length) return <ErrorState />

  const scen = (result.meta?.scenario as ImmigrationScenario) ?? scenario
  const breakevenLow = (result.meta?.breakevenLow as number | null) ?? null
  const breakevenHigh = (result.meta?.breakevenHigh as number | null) ?? null
  const immigrationAdjustment =
    (result.meta?.immigrationAdjustment as number | null) ?? null
  const annualNetImmigration =
    (result.meta?.annualNetImmigration as number | null) ?? null

  const gap =
    result.latestActual != null && result.latestBreakeven != null
      ? result.latestActual - result.latestBreakeven
      : null

  const rangeLabel =
    breakevenLow != null && breakevenHigh != null
      ? `${formatK(breakevenLow, false)} to ${formatK(breakevenHigh, false)}`
      : '—'

  const baselineLabel = `${formatK(PRE_PANDEMIC_RANGE.low, false)}–${formatK(PRE_PANDEMIC_RANGE.high, false)}`
  const belowBaseline = immigrationAdjustment != null && immigrationAdjustment < 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-primary">
            Brookings — Edelberg &amp; Watson
          </h2>
          <p className="mt-1 text-sm text-secondary">
            Pre-pandemic potential-employment-growth range, shifted for net
            immigration relative to its 2019 CBO-projected pace.
          </p>
        </div>
        <p className="text-xs text-tertiary">
          Updated {formatLongDate(new Date(result.computedAt))}
        </p>
      </div>

      <ScenarioToggle active={scenario.id} />

      <div className="grid gap-4 sm:grid-cols-3">
        <ModelCard
          label={`Breakeven range · ${scen.label}`}
          value={rangeLabel}
          sub="thousands/month"
        />
        <ModelCard
          label="Actual NFP"
          value={formatK(result.latestActual)}
          sub="Latest monthly print"
        />
        <ModelCard
          label="Gap vs midpoint"
          value={formatK(gap)}
          sub={gap == null ? undefined : gap >= 0 ? 'Above range midpoint' : 'Below range midpoint'}
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
            Breakeven midpoint ({scen.label})
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-3 rounded-sm"
              style={{ background: 'rgba(22,163,74,0.18)' }}
            />
            {scen.label} range
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-4"
              style={{
                background:
                  'repeating-linear-gradient(90deg, #94a3b8 0 4px, transparent 4px 7px)',
              }}
            />
            Pre-pandemic baseline ({baselineLabel})
          </span>
        </div>
        <BreakevenChart
          points={result.points}
          referenceBand={
            breakevenLow != null && breakevenHigh != null
              ? { low: breakevenLow, high: breakevenHigh, label: `${scen.label} range` }
              : undefined
          }
          extraLines={[
            {
              y: PRE_PANDEMIC_RANGE.high,
              label: `Pre-pandemic baseline (${baselineLabel})`,
              color: '#94a3b8',
            },
            { y: PRE_PANDEMIC_RANGE.low, color: '#94a3b8' },
          ]}
        />
      </div>

      <div className="rounded-lg border border-accent/20 bg-accent/5 p-5 text-sm leading-relaxed text-primary">
        At {scen.label.toLowerCase()} immigration (
        {formatK(scen.monthlyNetImmigration)}/month net
        {annualNetImmigration != null && `, ${formatK(annualNetImmigration)}/year`}
        ), sustainable employment growth is approximately {rangeLabel}/month
        &mdash;{' '}
        {belowBaseline ? (
          <>
            below the {baselineLabel} pre-pandemic baseline, since net
            immigration is now running below its 2019 CBO-projected pace.
          </>
        ) : (
          <>
            above the {baselineLabel} pre-pandemic baseline, since net
            immigration is running above its 2019 CBO-projected pace.
          </>
        )}
      </div>

      <MetricsRow actual={result.actualSummary} breakeven={result.breakevenSummary} />

      <MethodologyNote
        source="Wendy Edelberg & Tara Watson, The Hamilton Project, Brookings Institution, March 7, 2024."
        vintage={`Scenario: ${scen.source} (vintage ${scen.vintageDate}); FRED PAYEMS`}
      >
        <p>
          The paper anchors a <strong>pre-pandemic</strong> range for
          potential monthly employment growth of {baselineLabel}, based on the
          CBO&rsquo;s 2019 demographic projections (net immigration of roughly
          1.0 million per year). It then shifts that range by how far net
          immigration is running above or below the 2019 projection, scaled
          by the share of new immigrants who are civilian, noninstitutional,
          and 16+ ({Math.round(scen.cnipShare * 100)}%) and their assumed
          labor-force participation rate ({Math.round(scen.newImmigrantLFPR * 100)}%).
        </p>
        <p>
          Under the {scen.label.toLowerCase()} scenario ({formatK(scen.monthlyNetImmigration)}/month
          {annualNetImmigration != null && `, ${formatK(annualNetImmigration)}/year`} net
          immigration), the adjustment is {formatK(immigrationAdjustment, false)}/month, putting
          the breakeven range at {rangeLabel} &mdash; {belowBaseline ? 'below' : 'above'} the
          pre-pandemic baseline. This is the inverse of the paper&rsquo;s 2024
          finding, where the post-2022 immigration surge pushed potential
          employment growth above its pre-pandemic range; the scenario toggle
          shows how the range moves as the immigration assumption changes.
        </p>
      </MethodologyNote>
    </div>
  )
}
