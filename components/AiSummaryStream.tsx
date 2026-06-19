'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { SummaryPayload } from '@/types/economic'

interface Props {
  payloadJson: string
}

export function AiSummaryStream({ payloadJson }: Props) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle')
  const [ts, setTs] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const run = useCallback(async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setText('')
    setStatus('streaming')
    setTs(null)

    try {
      const res = await fetch('/api/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payloadJson,
        signal: ac.signal,
      })
      if (!res.ok) {
        const msg = await res.text().catch(() => `HTTP ${res.status}`)
        throw new Error(msg)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        setText(buf)
      }
      setStatus('done')
      setTs(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.error('AI summary fetch error:', err)
      setStatus('error')
    }
  }, [payloadJson])

  useEffect(() => {
    run()
    return () => { abortRef.current?.abort() }
  }, [run])

  // Render asterisk-delimited bold as <strong>
  function renderMarkdown(raw: string) {
    const lines = raw.split('\n')
    return lines.map((line, li) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/)
      return (
        <p key={li} className={li > 0 && line.startsWith('**') ? 'mt-4' : 'mt-2 first:mt-0'}>
          {parts.map((part, pi) =>
            part.startsWith('**') && part.endsWith('**')
              ? <strong key={pi} className="font-semibold text-primary">{part.slice(2, -2)}</strong>
              : part
          )}
        </p>
      )
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-widest text-tertiary">
            AI Analysis
          </span>
          {status === 'streaming' && (
            <span className="inline-flex items-center gap-1 text-xs text-secondary">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-chart-line" />
              Generating…
            </span>
          )}
          {ts && status === 'done' && (
            <span className="text-xs text-tertiary">Generated at {ts}</span>
          )}
        </div>
        <button
          onClick={run}
          disabled={status === 'streaming'}
          className="rounded border border-border px-3 py-1 text-xs font-medium text-secondary transition hover:border-chart-line hover:text-chart-line disabled:cursor-not-allowed disabled:opacity-40"
        >
          Refresh Analysis
        </button>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5 text-sm text-secondary leading-relaxed">
        {status === 'idle' && (
          <p className="text-tertiary">Starting analysis…</p>
        )}
        {status === 'error' && (
          <p className="text-negative">
            Analysis unavailable — ANTHROPIC_API_KEY may not be configured, or the request failed.
            Check server logs and try again.
          </p>
        )}
        {text ? (
          <div className="space-y-0">{renderMarkdown(text)}</div>
        ) : status === 'streaming' ? (
          <p className="text-tertiary">
            <span className="animate-pulse">▌</span>
          </p>
        ) : null}
      </div>

      <p className="text-xs text-tertiary">
        AI analysis synthesizes published economic research. Not financial advice.
        Powered by Claude (Anthropic).
      </p>
    </div>
  )
}
