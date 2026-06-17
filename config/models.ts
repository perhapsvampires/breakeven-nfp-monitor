// Registry of model tabs. Only `enabled` models are linkable; the rest render
// as disabled placeholders until their pages are built in later phases.

export interface ModelTab {
  slug: string
  label: string
  enabled: boolean
}

export const MODEL_TABS: ModelTab[] = [
  { slug: 'employ-america', label: 'Employ America CER', enabled: true },
  { slug: 'stlouis-fed', label: 'St. Louis Fed', enabled: true },
  { slug: 'frbsf-2016', label: 'FRBSF 2016', enabled: false },
  { slug: 'brookings', label: 'Brookings', enabled: true },
  { slug: 'sf-fed', label: 'SF Fed', enabled: true },
  { slug: 'fed-board', label: 'Board of Governors', enabled: true },
  { slug: 'dallas-fed', label: 'Dallas Fed', enabled: true },
  { slug: 'ai-summary', label: 'AI Summary', enabled: false },
]
