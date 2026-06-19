import { computeFrbsf2016 } from '@/lib/models/frbsf2016'
import { BreakevenChart } from '@/components/charts/BreakevenChart'
import { ModelCard } from '@/components/ModelCard'
import { MetricsRow } from '@/components/MetricsRow'
import { MethodologyNote } from '@/components/MethodologyNote'
import { formatK, formatLongDate, formatMonthYear, formatPct } from '@/lib/formatting'

export const dynamic = 'force-dynamic'

function ErrorState() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-primary">
          FRBSF 2016 — Bidder, Mahedy &amp; Valletta
        </h2>
      </div>
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm font-medium text-primary">
          Data unavailable — check back after the next refresh
        </p>
        <p className="mt-2 text-xs text-secondary">
          The demographic breakeven estimate could not be computed.
        </p>
      </div>
    </div>
  )
}

export default async function Frbsf2016Page() {
  let result
  try {
    result = await computeFrbsf2016()
  } catch (err) {
    console.error('Frbsf2016Page failed:', err)
    return <ErrorState />
  }
  if (!result.points.length) return <ErrorState />

  const latestNrou = (result.meta?.latestNrou as number | null) ?? null
  const observedDate = (result.meta?.observedDate as string | null) ?? null
  const latestLfprByBand = (result.meta?.latestLfprByBand as Record<string, number> | null) ?? null
  const latestPopChangeByBand = (result.meta?.latestPopChangeByBand as Record<string, number> | null) ?? null

  const gap =
    result.latestActual != null && result.latestBreakeven != null
      ? result.latestActual - result.latestBreakeven
      : null

  const bands = ['16-19', '20-24', '25-54', '55+'] as const

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-primary">
            FRBSF 2016 — Bidder, Mahedy &amp; Valletta
          </h2>
          <p className="mt-1 text-sm text-secondary">
            Demographic baseline: age-group population growth × cohort
            participation rate trends, scaled by the noncyclical unemployment
            rate.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-tertiary">
            Updated {formatLongDate(new Date(result.computedAt))}
          </p>
          <p className="mt-0.5 text-xs font-medium text-secondary">
            2016 methodology · historical baseline
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <ModelCard
          label="Demographic breakeven"
          value={formatK(result.latestBreakeven, false)}
          sub={observedDate ? `As of ${formatMonthYear(observedDate)}` : 'Current estimate'}
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
            Demographic breakeven
          </span>
        </div>
        <BreakevenChart points={result.points} />
      </div>

      {/* Age-band decomposition */}
      {latestLfprByBand && latestPopChangeByBand && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-tertiary">
            Age-band breakdown
            {observedDate && <> · {formatMonthYear(observedDate)}</>}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-secondary">
                  <th className="pb-2 font-medium">Age band</th>
                  <th className="pb-2 font-medium text-right">Pop growth/yr</th>
                  <th className="pb-2 font-medium text-right">Trend LFPR</th>
                  <th className="pb-2 font-medium text-right">LF contribution/mo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {bands.map((band) => {
                  const lfpr = latestLfprByBand[band]
                  const popAnn = latestPopChangeByBand[band]
                  const contrib = popAnn != null && lfpr != null
                    ? (popAnn / 12) * (lfpr / 100)
                    : null
                  return (
                    <tr key={band} className="text-primary">
                      <td className="py-2 font-medium">{band}</td>
                      <td className="py-2 text-right tabular-nums text-secondary">
                        {formatK(popAnn, false)}/yr
                      </td>
                      <td className="py-2 text-right tabular-nums text-secondary">
                        {lfpr != null ? formatPct(lfpr, 1) : '—'}
                      </td>
                      <td className="py-2 text-right tabular-nums font-medium">
                        {formatK(contrib, false)}/mo
                      </td>
                    </tr>
                  )
                })}
                {/* Total row */}
                <tr className="font-semibold text-primary">
                  <td className="pt-2">Total potential LF</td>
                  <td className="pt-2 text-right tabular-nums text-secondary">—</td>
                  <td className="pt-2 text-right tabular-nums text-secondary">
                    NROU {latestNrou != null ? formatPct(latestNrou, 2) : '—'}
                  </td>
                  <td className="pt-2 text-right tabular-nums">
                    {formatK(result.latestBreakeven, false)}/mo
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <MetricsRow actual={result.actualSummary} breakeven={result.breakevenSummary} />

      <MethodologyNote
        source="Bidder, Mahedy & Valletta, FRBSF Economic Letter 2016-32."
        vintage={`FRED LFPR series (LNS11300012/36/60/24230), NSA population series (LNU00000012/36/60/24230), FRED NROU. Trend: 12-month moving averages.`}
      >
        <p>
          The paper decomposes labor force growth into age-band contributions:
          for each cohort, multiply monthly population growth by the cohort&rsquo;s
          trend labor force participation rate. Summing across four age bands
          (16–19, 20–24, 25–54, 55+) gives potential labor force growth.
          Multiplying by (1&nbsp;&minus;&nbsp;NROU) yields the employment level needed
          to hold the unemployment rate steady.
        </p>
        <p>
          The insight of the 2016 paper was that baby-boomer retirements were
          structurally lowering aggregate LFPR — because cohorts aging into the
          55+ band participate at lower rates than prime-age workers — reducing
          the breakeven below its pre-demographic-transition level. This same
          framework now captures the reverse dynamic: net population growth
          accelerated sharply during the 2022–2024 immigration surge (raising the
          breakeven), and has since slowed as immigration policy tightened.
        </p>
        <p>
          The 12-month moving average on LFPR and the 12-month smoothed
          population change both remove the January CPS population-control
          step-jumps and short-run seasonal noise, leaving only the structural
          trend. No scenario toggle is applied — this is a realized,
          data-driven series throughout.
        </p>
      </MethodologyNote>
    </div>
  )
}
