// BLS Public Data API access for series FRED does not mirror (e.g.
// LNS16000000, household employment adjusted to the payroll-survey concept).
// Server-only. Uses the cacheable GET endpoint; an optional BLS_API_KEY raises
// the request quota but is not required.
import type { FredObservation } from '@/types/economic'

const BLS_BASE = 'https://api.bls.gov/publicAPI/v2/timeseries/data/'

export async function fetchBlsSeries(
  seriesId: string,
  startYear: number,
  endYear: number,
): Promise<FredObservation[]> {
  const params = new URLSearchParams({
    startyear: String(startYear),
    endyear: String(endYear),
  })
  if (process.env.BLS_API_KEY) params.set('registrationkey', process.env.BLS_API_KEY)

  const res = await fetch(`${BLS_BASE}${seriesId}?${params.toString()}`, {
    next: { revalidate: 21600, tags: ['bls'] },
  })
  if (!res.ok) {
    throw new Error(`BLS fetch failed for ${seriesId}: ${res.status} ${res.statusText}`)
  }

  const json = (await res.json()) as {
    status?: string
    message?: string[]
    Results?: { series?: Array<{ data?: Array<{ year: string; period: string; value: string }> }> }
  }
  if (json.status !== 'REQUEST_SUCCEEDED') {
    throw new Error(`BLS error for ${seriesId}: ${JSON.stringify(json.message)}`)
  }

  const data = json.Results?.series?.[0]?.data ?? []
  const out: FredObservation[] = []
  for (const d of data) {
    if (!/^M(0[1-9]|1[0-2])$/.test(d.period)) continue // skip M13 annual average
    const month = d.period.slice(1)
    out.push({
      date: `${d.year}-${month}-01`,
      value: d.value === '-' || d.value === '' ? null : parseFloat(d.value),
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}
