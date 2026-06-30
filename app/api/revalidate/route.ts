// On-demand ISR revalidation, hit by a Vercel Cron after each BLS release.
// GET /api/revalidate?secret=REVALIDATE_TOKEN
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath, revalidateTag } from 'next/cache'

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (!secret || secret !== process.env.REVALIDATE_TOKEN) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }
  // Bust FRED data cache and all model pages.
  revalidatePath('/', 'layout')
  // Also bust the cached AI summary so Claude regenerates with new NFP data.
  revalidateTag('ai-summary', 'default')
  return NextResponse.json({ revalidated: true, now: Date.now() })
}
