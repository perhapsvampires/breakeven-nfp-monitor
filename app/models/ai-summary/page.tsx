import { computeEmployAmericaCER } from '@/lib/models/employAmericaCER'
import { computeGregoryBick } from '@/lib/models/gregoryBick'
import { computeFrbsf2016 } from '@/lib/models/frbsf2016'
import { computeBrookings } from '@/lib/models/brookings'
import { computeSfFed } from '@/lib/models/sfFed'
import { computeMurrayVidangos } from '@/lib/models/murrayVidangos'
import { computeCheremukhin } from '@/lib/models/cheremukhin'
import { AiSummaryStream } from '@/components/AiSummaryStream'
import { ModelCard } from '@/components/ModelCard'
import { formatK, formatMonthYear, gapColorClass } from '@/lib/formatting'
import type { SummaryPayload } from '@/types/economic'

export const dynamic = 'force-dynamic'

function mean(vals: Array<number | null>): number | null {
  const nums = vals.filter((v): v is number => v != null)
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
}

function latestNfpDate(points: Array<{ date: string; actualNfp: number | null }>): string {
  const last = [...points].reverse().find((p) => p.actualNfp != null)
  return last ? formatMonthYear(last.date) : 'Latest'
}

export default async function AiSummaryPage() {
  const [
    cer,
    stl,
    frbsf,
    bkLow,
    bkBase,
    bkHigh,
    sfFed,
    fedBoard,
    dallasLow,
    dallasBase,
    dallasHigh,
  ] = await Promise.all([
    computeEmployAmericaCER().catch(() => null),
    computeGregoryBick().catch(() => null),
    computeFrbsf2016().catch(() => null),
    computeBrookings('low').catch(() => null),
    computeBrookings('baseline').catch(() => null),
    computeBrookings('high').catch(() => null),
    computeSfFed().catch(() => null),
    computeMurrayVidangos('baseline').catch(() => null),
    computeCheremukhin('low').catch(() => null),
    computeCheremukhin('baseline').catch(() => null),
    computeCheremukhin('high').catch(() => null),
  ])

  const sfShortRun = sfFed?.latestBreakeven ?? null
  const sfLongRun = (sfFed?.meta?.latestLongRun as number | null) ?? null

  // Baseline breakevens used for aggregate consensus
  const baselineBreakevens: Array<number | null> = [
    cer?.latestBreakeven ?? null,
    stl?.latestBreakeven ?? null,
    frbsf?.latestBreakeven ?? null,
    bkBase?.latestBreakeven ?? null,
    sfShortRun,
    fedBoard?.latestBreakeven ?? null,
    dallasBase?.latestBreakeven ?? null,
  ]
  const validBaselines = baselineBreakevens.filter((v): v is number => v != null)
  const consensusMin = validBaselines.length ? Math.min(...validBaselines) : null
  const consensusMax = validBaselines.length ? Math.max(...validBaselines) : null
  const consensusMid = mean(baselineBreakevens)

  const latestNfp = cer?.latestActual ?? stl?.latestActual ?? null
  const actualSummary = cer?.actualSummary ?? stl?.actualSummary ?? null
  const nfpDateStr = cer?.points.length
    ? latestNfpDate(cer.points)
    : stl?.points.length
    ? latestNfpDate(stl.points)
    : 'Latest'

  const gap = latestNfp != null && consensusMid != null ? latestNfp - consensusMid : null
  const positionLabel =
    latestNfp == null || consensusMin == null || consensusMax == null
      ? null
      : latestNfp > consensusMax
      ? 'Above consensus range'
      : latestNfp < consensusMin
      ? 'Below consensus range'
      : 'Within consensus range'

  const payload: SummaryPayload = {
    computedAt: new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    }),
    latestNfpDate: nfpDateStr,
    models: {
      cer: cer?.latestBreakeven ?? null,
      stl: stl?.latestBreakeven ?? null,
      frbsf: frbsf?.latestBreakeven ?? null,
      brookings: {
        low: bkLow?.latestBreakeven ?? null,
        base: bkBase?.latestBreakeven ?? null,
        high: bkHigh?.latestBreakeven ?? null,
      },
      sfFed: { shortRun: sfShortRun, longRun: sfLongRun },
      fedBoard: fedBoard?.latestBreakeven ?? null,
      dallas: {
        low: dallasLow?.latestBreakeven ?? null,
        base: dallasBase?.latestBreakeven ?? null,
        high: dallasHigh?.latestBreakeven ?? null,
      },
    },
    actualNfp: {
      latest: latestNfp,
      avg3: actualSummary?.avg3 ?? null,
      avg6: actualSummary?.avg6 ?? null,
      avg12: actualSummary?.avg12 ?? null,
    },
  }

  const modelRows: Array<{
    label: string
    slug: string
    breakeven: string
    note: string
    gap: number | null
  }> = [
    {
      label: 'Employ America CER',
      slug: 'employ-america',
      breakeven: formatK(cer?.latestBreakeven, false),
      note: '—',
      gap: latestNfp != null && cer?.latestBreakeven != null ? latestNfp - cer.latestBreakeven : null,
    },
    {
      label: 'St. Louis Fed',
      slug: 'stlouis-fed',
      breakeven: formatK(stl?.latestBreakeven, false),
      note: 'CBO proj.',
      gap: latestNfp != null && stl?.latestBreakeven != null ? latestNfp - stl.latestBreakeven : null,
    },
    {
      label: 'FRBSF 2016',
      slug: 'frbsf-2016',
      breakeven: formatK(frbsf?.latestBreakeven, false),
      note: '—',
      gap: latestNfp != null && frbsf?.latestBreakeven != null ? latestNfp - frbsf.latestBreakeven : null,
    },
    {
      label: 'Brookings',
      slug: 'brookings',
      breakeven:
        bkLow?.latestBreakeven != null && bkHigh?.latestBreakeven != null
          ? `${formatK(bkLow.latestBreakeven, false)} – ${formatK(bkHigh.latestBreakeven, false)}`
          : formatK(bkBase?.latestBreakeven, false),
      note: 'Low–High',
      gap: latestNfp != null && bkBase?.latestBreakeven != null ? latestNfp - bkBase.latestBreakeven : null,
    },
    {
      label: 'SF Fed',
      slug: 'sf-fed',
      breakeven:
        sfShortRun != null && sfLongRun != null
          ? `${formatK(sfShortRun, false)} SR / ${formatK(sfLongRun, false)} LR`
          : formatK(sfShortRun, false),
      note: 'Short / Long run',
      gap: latestNfp != null && sfShortRun != null ? latestNfp - sfShortRun : null,
    },
    {
      label: 'Fed Board',
      slug: 'fed-board',
      breakeven: formatK(fedBoard?.latestBreakeven, false),
      note: 'Baseline',
      gap: latestNfp != null && fedBoard?.latestBreakeven != null ? latestNfp - fedBoard.latestBreakeven : null,
    },
    {
      label: 'Dallas Fed',
      slug: 'dallas-fed',
      breakeven:
        dallasLow?.latestBreakeven != null && dallasHigh?.latestBreakeven != null
          ? `${formatK(dallasLow.latestBreakeven, false)} – ${formatK(dallasHigh.latestBreakeven, false)}`
          : formatK(dallasBase?.latestBreakeven, false),
      note: 'Low–High',
      gap: latestNfp != null && dallasBase?.latestBreakeven != null ? latestNfp - dallasBase.latestBreakeven : null,
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-primary">
            AI Summary
          </h2>
          <p className="mt-1 text-sm text-secondary">
            Claude synthesizes seven breakeven methodologies into a consensus view.
          </p>
        </div>
        <p className="text-xs text-tertiary">
          Latest data: {nfpDateStr}
        </p>
      </div>

      {/* Aggregate consensus */}
      <div className="grid gap-4 sm:grid-cols-3">
        <ModelCard
          label="Consensus range"
          value={
            consensusMin != null && consensusMax != null
              ? `${formatK(consensusMin, false)} – ${formatK(consensusMax, false)}`
              : '—'
          }
          sub="Across 7 baseline estimates"
        />
        <ModelCard
          label="Consensus midpoint"
          value={formatK(consensusMid, false)}
          sub="Mean of 7 baseline estimates"
        />
        <ModelCard
          label="Latest actual NFP"
          value={formatK(latestNfp)}
          sub={positionLabel ?? 'vs consensus'}
          accent={
            gap == null
              ? 'neutral'
              : latestNfp != null && consensusMin != null && consensusMax != null
              ? latestNfp > consensusMax
                ? 'positive'
                : latestNfp < consensusMin
                ? 'negative'
                : 'neutral'
              : 'neutral'
          }
        />
      </div>

      {/* Model comparison table */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-tertiary">
          Model Comparison · {nfpDateStr}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-secondary">
                <th className="pb-2 font-medium">Model</th>
                <th className="pb-2 font-medium text-right">Breakeven</th>
                <th className="pb-2 font-medium text-right">Scenario / note</th>
                <th className="pb-2 font-medium text-right">Gap vs NFP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {modelRows.map((row) => (
                <tr key={row.slug} className="text-primary">
                  <td className="py-2">
                    <a
                      href={`/models/${row.slug}`}
                      className="font-medium hover:text-chart-line hover:underline"
                    >
                      {row.label}
                    </a>
                  </td>
                  <td className="py-2 text-right tabular-nums font-medium">
                    {row.breakeven}
                  </td>
                  <td className="py-2 text-right text-xs text-secondary">
                    {row.note}
                  </td>
                  <td className={`py-2 text-right tabular-nums font-medium ${gapColorClass(row.gap)}`}>
                    {row.gap != null ? formatK(row.gap) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Streaming AI analysis */}
      <AiSummaryStream payloadJson={JSON.stringify(payload)} />
    </div>
  )
}
