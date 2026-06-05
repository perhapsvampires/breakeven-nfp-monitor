const CAVEATS = [
  {
    title: 'Breakeven estimates are not revised.',
    body: 'Monthly payroll data is heavily revised (preliminary → two monthly revisions → annual benchmark). A print above breakeven today may fall below it later.',
  },
  {
    title: 'Immigration is the dominant uncertainty.',
    body: 'Net unauthorized immigration in 2025–26 has no reliable real-time public measure. Estimates rely on CBO/Census/Brookings projections.',
  },
  {
    title: 'Models disagree by design.',
    body: 'Each methodology captures different labor-force dynamics. The range across models is itself informative.',
  },
  {
    title: 'Not financial advice.',
    body: 'An educational research tool synthesizing published academic and government research.',
  },
]

export function Footer() {
  return (
    <footer className="mt-12 border-t border-border bg-surface">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-secondary">
          About the data
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CAVEATS.map((c) => (
            <div key={c.title}>
              <p className="text-sm font-medium text-primary">{c.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </footer>
  )
}
