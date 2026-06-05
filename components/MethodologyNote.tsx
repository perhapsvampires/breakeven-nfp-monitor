'use client'

import { useState } from 'react'

interface MethodologyNoteProps {
  source: string
  vintage: string
  link?: string
  children: React.ReactNode
}

export function MethodologyNote({
  source,
  vintage,
  link,
  children,
}: MethodologyNoteProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="text-sm font-medium text-primary">
          Methodology &amp; source
        </span>
        <span className="text-xs text-secondary">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-5 py-4 text-sm leading-relaxed text-secondary">
          <p className="font-medium text-primary">{source}</p>
          <div>{children}</div>
          <p className="text-xs text-tertiary">
            Data vintage: {vintage}
            {link && (
              <>
                {' · '}
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  Original source
                </a>
              </>
            )}
          </p>
        </div>
      )}
    </div>
  )
}
