// On-demand ISR revalidation, hit by a Vercel Cron after each BLS release.
// GET /api/revalidate?secret=REVALIDATE_TOKEN
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (!secret || secret !== process.env.REVALIDATE_TOKEN) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }
  // Busts the cached layout subtree and the FRED fetches it depends on.
  revalidatePath('/', 'layout')
  return NextResponse.json({ revalidated: true, now: Date.now() })
}
