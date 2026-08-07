import { Suspense } from 'react'
import { revalidateTag, revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { computeEmployAmericaCER } from '@/lib/models/employAmericaCER'
import { computeGregoryBick } from '@/lib/models/gregoryBick'
import { computeFrbsf2016 } from '@/lib/models/frbsf2016'
import { computeBrookings } from '@/lib/models/brookings'
import { computeSfFed } from '@/lib/models/sfFed'
import { computeMurrayVidangos } from '@/lib/models/murrayVidangos'
import { computeCheremukhin } from '@/lib/models/cheremukhin'
import { getCachedAiSummary } from '@/lib/ai-summary'
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

// Server action: invalidate ai-summary cache and reload the page so a fresh
// Claude response is generated. Does NOT touch the FRED cache.
async function refreshSummary() {
  'use server'
  // Invalidate the unstable_cache entry for the AI summary (tag-based).
  // Next.js 16 revalidateTag requires a cache profile as the second arg.
  revalidateTag('ai-summary', 'default')
  // Also clear the full page so the new server render picks up the miss.
  revalidatePath('/models/ai-summary', 'page')
  redirect('/models/ai-summary', 'push')
}

// ─── AI Analysis server component ────────────────────────────────────────────
// Wrapped in Suspense so the rest of the page renders immediately while Claude
// generates the text on the first load of each NFP month.

async function AiAnalysisSection({
  nfpDate,
  payloadJson,
}: {
  nfpDate: string
  payloadJson: string
}) {
  let text = ''
  try {
    text = await getCachedAiSummary(nfpDate, payloadJson)
  } catch (err) {
    console.error('getCachedAiSummary failed:', err)
  }

  function renderText(raw: string) {
    return raw.split('\n\n').filter(Boolean).map((para, i) => {
      const chunks = para.split(/(\*\*[^*]+\*\*)/)
      return (
        <p key={i} className={i === 0 ? '' : 'mt-3'}>
          {chunks.map((chunk, j) =>
            chunk.startsWith('**') && chunk.endsWith('**')
              ? <strong key={j} className="font-semibold text-primary">{chunk.slice(2, -2)}</strong>
              : chunk
          )}
        </p>
      )
    })
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5 text-sm text-secondary leading-relaxed">
      {text ? (
        renderText(text)
      ) : (
        <p className="text-negative text-xs">
          AI analysis unavailable — ANTHROPIC_API_KEY may not be configured or has
          insufficient credits. Check server logs.
        </p>
      )}
    </div>
  )
}

function AiAnalysisSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3 animate-pulse">
      {[100, 90, 95, 80, 85, 70, 90, 75].map((w, i) => (
        <div key={i} className="h-3 rounded bg-border" style={{ width: `${w}%` }} />
      ))}
      <p className="text-xs text-tertiary pt-1">
        Generating analysis — this happens once per NFP release and may take a few seconds…
      </p>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AiSummaryPage() {
  const [
    cer, stl, frbsf,
    bkLow, bkBase, bkHigh,
    sfFed, fedBoard,
    dallasLow, dallasBase, dallasHigh,
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

  const positionLabel =
    latestNfp == null || consensusMin == null || consensusMax == null ? null
    : latestNfp > consensusMax ? 'Above consensus range'
    : latestNfp < consensusMin ? 'Below consensus range'
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
  const payloadJson = JSON.stringify(payload)

  const modelRows = [
    {
      label: 'Employ America CER', slug: 'employ-america',
      breakeven: formatK(cer?.latestBreakeven, false), note: '—',
      gap: latestNfp != null && cer?.latestBreakeven != null ? latestNfp - cer.latestBreakeven : null,
    },
    {
      label: 'St. Louis Fed', slug: 'stlouis-fed',
      breakeven: formatK(stl?.latestBreakeven, false), note: 'CBO proj.',
      gap: latestNfp != null && stl?.latestBreakeven != null ? latestNfp - stl.latestBreakeven : null,
    },
    {
      label: 'FRBSF 2016', slug: 'frbsf-2016',
      breakeven: formatK(frbsf?.latestBreakeven, false), note: '—',
      gap: latestNfp != null && frbsf?.latestBreakeven != null ? latestNfp - frbsf.latestBreakeven : null,
    },
    {
      label: 'Brookings', slug: 'brookings',
      breakeven: bkLow?.latestBreakeven != null && bkHigh?.latestBreakeven != null
        ? `${formatK(bkLow.latestBreakeven, false)} – ${formatK(bkHigh.latestBreakeven, false)}`
        : formatK(bkBase?.latestBreakeven, false),
      note: 'Low – High',
      gap: latestNfp != null && bkBase?.latestBreakeven != null ? latestNfp - bkBase.latestBreakeven : null,
    },
    {
      label: 'SF Fed', slug: 'sf-fed',
      breakeven: sfShortRun != null && sfLongRun != null
        ? `${formatK(sfShortRun, false)} SR / ${formatK(sfLongRun, false)} LR`
        : formatK(sfShortRun, false),
      note: 'Short / Long run',
      gap: latestNfp != null && sfShortRun != null ? latestNfp - sfShortRun : null,
    },
    {
      label: 'Fed Board', slug: 'fed-board',
      breakeven: formatK(fedBoard?.latestBreakeven, false), note: 'Baseline',
      gap: latestNfp != null && fedBoard?.latestBreakeven != null ? latestNfp - fedBoard.latestBreakeven : null,
    },
    {
      label: 'Dallas Fed', slug: 'dallas-fed',
      breakeven: dallasLow?.latestBreakeven != null && dallasHigh?.latestBreakeven != null
        ? `${formatK(dallasLow.latestBreakeven, false)} – ${formatK(dallasHigh.latestBreakeven, false)}`
        : formatK(dallasBase?.latestBreakeven, false),
      note: 'Low – High',
      gap: latestNfp != null && dallasBase?.latestBreakeven != null ? latestNfp - dallasBase.latestBreakeven : null,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-primary">Summary</h2>
          <p className="mt-1 text-sm text-secondary">
            Claude synthesizes seven breakeven methodologies into a consensus view.
            Analysis regenerates automatically after each BLS Employment Situation release.
          </p>
        </div>
        <p className="text-xs text-tertiary">Latest data: {nfpDateStr}</p>
      </div>

      {/* Aggregate consensus */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
            latestNfp == null || consensusMin == null || consensusMax == null ? 'neutral'
            : latestNfp > consensusMax ? 'positive'
            : latestNfp < consensusMin ? 'negative'
            : 'neutral'
          }
        />
        <ModelCard
          label="3-month avg NFP"
          value={formatK(actualSummary?.avg3 ?? null)}
          sub="Recent trend"
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
                    <a href={`/models/${row.slug}`}
                       className="font-medium hover:text-chart-line hover:underline">
                      {row.label}
                    </a>
                  </td>
                  <td className="py-2 text-right tabular-nums font-medium">{row.breakeven}</td>
                  <td className="py-2 text-right text-xs text-secondary">{row.note}</td>
                  <td className={`py-2 text-right tabular-nums font-medium ${gapColorClass(row.gap)}`}>
                    {row.gap != null ? formatK(row.gap) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* AI Analysis — Suspense so cards render immediately; Claude awaits cache hit */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-widest text-tertiary">
            AI Analysis
          </span>
          <form action={refreshSummary}>
            <button
              type="submit"
              className="rounded border border-border px-3 py-1 text-xs font-medium text-secondary transition hover:border-chart-line hover:text-chart-line"
            >
              Refresh Analysis
            </button>
          </form>
        </div>
        <Suspense fallback={<AiAnalysisSkeleton />}>
          <AiAnalysisSection nfpDate={nfpDateStr} payloadJson={payloadJson} />
        </Suspense>
        <p className="text-xs text-tertiary">
          AI analysis synthesizes published economic research. Not financial advice.
          Powered by Claude (Anthropic). Analysis is cached and regenerates automatically
          when new BLS payroll data is released.
        </p>
      </div>
    </div>
  )
}
