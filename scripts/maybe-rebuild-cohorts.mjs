// Prebuild staleness guard for CER cohort data.
//
// Compares meta.lastMonth in data/cer-cohorts.json against the latest PAYEMS
// observation from FRED. If cohort data is more than 1 month behind PAYEMS,
// runs build-cer-cohorts.mjs to refresh it.
//
// Wired as the npm "prebuild" lifecycle hook so it runs automatically before
// "next build" in both local and Vercel build environments. FRED API errors
// are non-fatal (logged as warnings); a missing cohort file is fatal.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COHORTS_PATH = join(ROOT, 'data', 'cer-cohorts.json')

function getFredKey() {
  if (process.env.FRED_API_KEY) return process.env.FRED_API_KEY
  const envPath = join(ROOT, '.env.local')
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, 'utf8').match(/^FRED_API_KEY=(.+)$/m)
    if (m) return m[1].trim()
  }
  return null
}

// Returns (later - earlier) in whole months. Accepts "YYYY-MM-DD" or "YYYY-MM".
function monthsApart(earlier, later) {
  const [ay, am] = earlier.slice(0, 7).split('-').map(Number)
  const [by, bm] = later.slice(0, 7).split('-').map(Number)
  return (by - ay) * 12 + (bm - am)
}

async function getLatestPayemsDate(key) {
  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=PAYEMS&api_key=${key}&file_type=json&sort_order=desc&limit=1`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`FRED HTTP ${res.status}`)
  const json = await res.json()
  return json.observations?.[0]?.date ?? null
}

function runBuild() {
  const result = spawnSync('node', [join(ROOT, 'scripts', 'build-cer-cohorts.mjs')], {
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

async function main() {
  if (!existsSync(COHORTS_PATH)) {
    console.log('[prebuild:cer] cer-cohorts.json missing — rebuilding')
    runBuild()
    return
  }

  const cohortMeta = JSON.parse(readFileSync(COHORTS_PATH, 'utf8')).meta
  const lastMonth = cohortMeta?.lastMonth
  if (!lastMonth) {
    console.log('[prebuild:cer] No meta.lastMonth in cohort data — rebuilding')
    runBuild()
    return
  }

  const fredKey = getFredKey()
  if (!fredKey) {
    console.warn('[prebuild:cer] FRED_API_KEY not found — skipping staleness check')
    return
  }

  let latestPayems
  try {
    latestPayems = await getLatestPayemsDate(fredKey)
  } catch (e) {
    console.warn(`[prebuild:cer] FRED fetch failed (${e.message}) — skipping check`)
    return
  }

  if (!latestPayems) {
    console.warn('[prebuild:cer] No PAYEMS date returned — skipping check')
    return
  }

  const lag = monthsApart(lastMonth, latestPayems)
  console.log(
    `[prebuild:cer] Cohort lastMonth=${lastMonth}  PAYEMS latest=${latestPayems}  lag=${lag}mo`,
  )

  if (lag > 1) {
    console.log('[prebuild:cer] Stale — rebuilding cer-cohorts.json')
    runBuild()
  } else {
    console.log('[prebuild:cer] Cohort data is current — skipping rebuild')
  }
}

main().catch((e) => {
  console.error('[prebuild:cer]', e)
  process.exit(1)
})
