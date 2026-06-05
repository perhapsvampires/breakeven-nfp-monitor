interface ModelCardProps {
  label: string
  value: string
  sub?: string
  accent?: 'positive' | 'negative' | 'neutral'
}

const accentClass = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-primary',
}

export function ModelCard({ label, value, sub, accent = 'neutral' }: ModelCardProps) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <p className="text-xs font-medium uppercase tracking-widest text-secondary">
        {label}
      </p>
      <p
        className={`mt-2 text-4xl font-semibold tracking-tight tnum ${accentClass[accent]}`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-sm text-secondary">{sub}</p>}
    </div>
  )
}
