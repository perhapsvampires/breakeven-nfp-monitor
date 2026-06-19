import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { SummaryPayload } from '@/types/economic'

export const dynamic = 'force-dynamic'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function k(v: number | null): string {
  if (v == null) return 'N/A'
  const sign = v > 0 ? '+' : ''
  return `${sign}${Math.round(v).toLocaleString('en-US')}k`
}

function buildPrompt(p: SummaryPayload): string {
  const { models: m, actualNfp: a } = p

  const sfFedLine =
    m.sfFed.shortRun != null && m.sfFed.longRun != null
      ? `Short-run ${k(m.sfFed.shortRun)} / Long-run ${k(m.sfFed.longRun)}`
      : k(m.sfFed.shortRun)

  const brookingsLine =
    `Low ${k(m.brookings.low)} / Baseline ${k(m.brookings.base)} / High ${k(m.brookings.high)}`

  const dallasLine =
    `Low ${k(m.dallas.low)} / Baseline ${k(m.dallas.base)} / High ${k(m.dallas.high)}`

  return `Today is ${p.computedAt}. The latest BLS Employment Situation showed ${k(a.latest)} nonfarm payrolls added in ${p.latestNfpDate}.

Here are the current breakeven estimates from seven research methodologies (thousands of jobs per month needed to hold the unemployment rate steady):

• Employ America CER (Preston Mui, Apr 2026): ${k(m.cer)} — removes within-cohort EPR changes; no immigration assumptions; most methodologically robust to demographic uncertainty
• St. Louis Fed (Gregory & Bick, Apr 2025): ${k(m.stl)} — uses CBO Demographic Outlook population projections; currently near-zero due to near-zero projected CNIP growth in 2026
• FRBSF 2016 Baseline (Bidder, Mahedy & Valletta): ${k(m.frbsf)} — age-group demographic baseline; 12-month smoothed population changes × cohort LFPRs
• Brookings (Edelberg & Watson, Mar 2024): ${brookingsLine} — range driven by net immigration scenario
• SF Fed (Petrosky-Nadeau & Stewart, Jul 2024): ${sfFedLine} — Christiano-Fitzgerald band-pass on CLF16OV; short-run captures cyclical LF growth
• Fed Board (Murray & Vidangos, Apr 2026): ${k(m.fedBoard)} — potential LFPR from CBO × (1 − NROU); scenario-adjusted for immigration
• Dallas Fed (Cheremukhin, Oct 2025 / Mar 2026): ${dallasLine} — three-component growth accounting (population, LFP cycle, structural ratio)

Recent actual nonfarm payrolls:
• Latest (${p.latestNfpDate}): ${k(a.latest)}
• 3-month average: ${k(a.avg3)}
• 6-month average: ${k(a.avg6)}
• 12-month average: ${k(a.avg12)}

Write a concise AI summary (350–450 words) structured as follows:

**1. Aggregate Breakeven Estimate**
Synthesize the seven models into a consensus range with a point estimate midpoint. Explain the key drivers of disagreement across models (immigration assumptions, methodology differences, CBO vintage).

**2. Current Labor Market Reading**
Compare the latest and recent-average payroll prints to the consensus range. Assess whether the labor market is above, at, or below breakeven, and what recent trend in payrolls implies.

**3. Immigration Sensitivity**
Briefly explain how breakeven estimates shift across the Low, Baseline, and High immigration scenarios. Quantify the spread. Note which models are most and least sensitive to immigration assumptions.

**4. Key Uncertainties**
Flag the two or three most important data limitations or model caveats (e.g., unauthorized immigration measurement, CBO projection vintage, payroll benchmark revisions).

Be precise with numbers. Avoid hedging language. Write in a direct, analytical voice suited for a professional financial audience.`
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response('ANTHROPIC_API_KEY not configured', { status: 503 })
  }

  let payload: SummaryPayload
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const prompt = buildPrompt(payload)

  const stream = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    stream: true,
    messages: [{ role: 'user', content: prompt }],
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(event.delta.text))
          }
        }
      } catch (err) {
        console.error('Claude stream error:', err)
        controller.error(err)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
