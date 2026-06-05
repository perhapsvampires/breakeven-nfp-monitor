'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MODEL_TABS } from '@/config/models'

export function TabBar() {
  const pathname = usePathname()

  return (
    <nav className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-6 py-2">
        {MODEL_TABS.map((tab) => {
          const href = `/models/${tab.slug}`
          const active = pathname === href

          if (!tab.enabled) {
            return (
              <span
                key={tab.slug}
                title="Coming soon"
                className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium text-tertiary"
              >
                {tab.label}
              </span>
            )
          }

          return (
            <Link
              key={tab.slug}
              href={href}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-accent text-white'
                  : 'text-secondary hover:bg-background hover:text-primary'
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
