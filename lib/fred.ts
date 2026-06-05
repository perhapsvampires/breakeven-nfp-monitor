// FRED data access. Used directly from Server Components and from the
// /api/fred route handler. Never import this into a client component — it
// reads the server-only FRED_API_KEY.
import type { FredObservation } from '@/types/economic'

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'

export interface FetchOptions {
  startDate?: string
  endDate?: string
  frequency?: string
}

export async function fetchFredSeries(
  seriesId: string,
  options: FetchOptions = {},
): Promise<FredObservation[]> {
  const apiKey = process.env.FRED_API_KEY
  if (!apiKey) throw new Error('FRED_API_KEY is not set in the environment')

  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    observation_start: options.startDate ?? '2018-01-01',
    ...(options.endDate ? { observation_end: options.endDate } : {}),
    ...(options.frequency ? { frequency: options.frequency } : {}),
  })

  const res = await fetch(`${FRED_BASE}?${params.toString()}`, {
    next: { revalidate: 21600, tags: ['fred'] }, // 6-hour ISR cache
  })
  if (!res.ok) {
    throw new Error(`FRED fetch failed for ${seriesId}: ${res.status} ${res.statusText}`)
  }

  const json = (await res.json()) as {
    observations?: Array<{ date: string; value: string }>
    error_message?: string
  }
  if (json.error_message) {
    throw new Error(`FRED error for ${seriesId}: ${json.error_message}`)
  }

  return (json.observations ?? []).map((o) => ({
    date: o.date,
    value: o.value === '.' ? null : parseFloat(o.value),
  }))
}

/** Fetch many series in parallel, keyed by series id. */
export async function fetchMultipleSeries(
  seriesIds: string[],
  options: FetchOptions = {},
): Promise<Record<string, FredObservation[]>> {
  const results = await Promise.all(
    seriesIds.map((id) =>
      fetchFredSeries(id, options).then((data) => [id, data] as const),
    ),
  )
  return Object.fromEntries(results)
}

/** Index observations by date, dropping nulls, for O(1) lookup. */
export function observationsToMap(obs: FredObservation[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const o of obs) {
    if (o.value != null && !Number.isNaN(o.value)) map.set(o.date, o.value)
  }
  return map
}
