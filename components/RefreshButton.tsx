'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

export function RefreshButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-background disabled:opacity-60"
    >
      {pending ? 'Refreshing…' : 'Refresh'}
    </button>
  )
}
