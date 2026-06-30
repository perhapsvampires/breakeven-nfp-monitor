// POST /api/summary — streaming Claude endpoint (used by the revalidation
// webhook for force-refresh; ordinary page loads use the unstable_cache
// path in lib/ai-summary.ts instead).
import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { buildSummaryPrompt } from '@/lib/ai-summary'
import type { SummaryPayload } from '@/types/economic'

export const dynamic = 'force-dynamic'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

  const stream = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    stream: true,
    messages: [{ role: 'user', content: buildSummaryPrompt(payload) }],
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
