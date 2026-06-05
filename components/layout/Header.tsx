import { RefreshButton } from '@/components/RefreshButton'

export function Header() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-primary">
            Breakeven NFP Monitor
          </h1>
          <p className="text-xs text-secondary">
            Seven methodologies for the U.S. payroll breakeven rate
          </p>
        </div>
        <RefreshButton />
      </div>
    </header>
  )
}
