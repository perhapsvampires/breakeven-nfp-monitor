'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { SCENARIOS, type ScenarioId } from '@/config/scenarios.config'

export function ScenarioToggle({ active }: { active: ScenarioId }) {
  const pathname = usePathname()
  const params = useSearchParams()

  function hrefFor(id: ScenarioId) {
    const next = new URLSearchParams(params.toString())
    next.set('s', id)
    return `${pathname}?${next.toString()}`
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
      <span className="px-2 text-xs font-medium uppercase tracking-widest text-secondary">
        Immigration
      </span>
      {SCENARIOS.map((s) => {
        const isActive = s.id === active
        return (
          <Link
            key={s.id}
            href={hrefFor(s.id)}
            scroll={false}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-accent text-white'
                : 'text-secondary hover:bg-background hover:text-primary'
            }`}
          >
            {s.label}
          </Link>
        )
      })}
    </div>
  )
}
