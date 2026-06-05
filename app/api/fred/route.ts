// Server-side FRED proxy so client components never see the API key.
// GET /api/fred?series_id=PAYEMS&start=2018-01-01
import { NextRequest, NextResponse } from 'next/server'
import { fetchFredSeries } from '@/lib/fred'

export async function GET(req: NextRequest) {
  const seriesId = req.nextUrl.searchParams.get('series_id')
  if (!seriesId) {
    return NextResponse.json({ error: 'series_id is required' }, { status: 400 })
  }
  const start = req.nextUrl.searchParams.get('start') ?? undefined
  const end = req.nextUrl.searchParams.get('end') ?? undefined

  try {
    const observations = await fetchFredSeries(seriesId, {
      startDate: start,
      endDate: end,
    })
    return NextResponse.json({ seriesId, observations })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
