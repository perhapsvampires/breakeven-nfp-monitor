// Prebuild staleness guard for the CPS-microdata datasets.
//
// Two datasets are derived from Census CPS Basic Monthly microdata and cached
// as JSON, because the aggregation is far too slow to do per request:
//
//   data/cer-cohorts.json  (meta.lastMonth)    -> Employ America CER model
//   data/sf-lfp.json       (meta.latestMonth)  -> SF Fed forward projection
//
// Each is compared against the latest PAYEMS observation from FRED. More than
// one month behind and the corresponding builder is re-run.
//
// Wired as the npm "prebuild" lifecycle hook, so it runs before "next build"
// both locally and on Vercel.
//
// FAILURE POLICY, deliberately asymmetric:
//   - dataset file MISSING  -> rebuild; failure is FATAL (the model cannot
//                              render at all without it)
//   - dataset file STALE    -> rebuild; failure is a WARNING and the build
//                              continues on the existing data. A dashboard
//                              serving month-old figures beats a dashboard
//                              that failed to deploy, and the staleness is
//                              surfaced in the UI.
//   - FRED unreachable      -> skip the check entirely (warning)
//
// Note the two files use different meta keys (lastMonth vs latestMonth); that
// is historical, and normalising it would invalidate both cached files.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const DATASETS = [
  {
    label: 'cer-cohorts',
    path: join(ROOT, 'data', 'cer-cohorts.json'),
    metaKey: 'lastMonth',
    script: 'build-cer-cohorts.mjs',
  },
  {
    label: 'sf-lfp',
    path: join(ROOT, 'data', 'sf-lfp.json'),
    metaKey: 'latestMonth',
    script: 'build-sf-lfp.mjs',
  },
]

function getFredKey() {
  if (process.env.FRED_API_KEY) return process.env.FRED_API_KEY
  const envPath = join(ROOT, '.env.local')
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, 'utf8').match(/^FRED_API_KEY=(.+)$/m)
    if (m) return m[1].trim()
  }
  const keyPath = join(ROOT, 'fred_api_key.txt')
  if (existsSync(keyPath)) return readFileSync(keyPath, 'utf8').trim()
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

/** Runs a builder. Returns true on success. */
function runBuild(script) {
  const result = spawnSync('node', [join(ROOT, 'scripts', script)], {
    stdio: 'inherit',
    env: process.env,
  })
  return result.status === 0
}

async function main() {
  const fredKey = getFredKey()
  let latestPayems = null

  if (!fredKey) {
    console.warn('[prebuild] FRED_API_KEY not found — skipping staleness checks')
  } else {
    try {
      latestPayems = await getLatestPayemsDate(fredKey)
      if (!latestPayems) console.warn('[prebuild] No PAYEMS date returned — skipping staleness checks')
    } catch (e) {
      console.warn(`[prebuild] FRED fetch failed (${e.message}) — skipping staleness checks`)
    }
  }

  for (const ds of DATASETS) {
    // Missing file: must rebuild, and failure is fatal.
    if (!existsSync(ds.path)) {
      console.log(`[prebuild:${ds.label}] missing — rebuilding (required)`)
      if (!runBuild(ds.script)) {
        console.error(`[prebuild:${ds.label}] rebuild FAILED and no cached data exists — aborting build`)
        process.exit(1)
      }
      continue
    }

    if (!latestPayems) continue

    const meta = JSON.parse(readFileSync(ds.path, 'utf8')).meta
    const asOf = meta?.[ds.metaKey]
    if (!asOf) {
      console.warn(`[prebuild:${ds.label}] no meta.${ds.metaKey} — skipping staleness check`)
      continue
    }

    const lag = monthsApart(asOf, latestPayems)
    console.log(`[prebuild:${ds.label}] ${ds.metaKey}=${asOf}  PAYEMS=${latestPayems}  lag=${lag}mo`)

    if (lag > 1) {
      console.log(`[prebuild:${ds.label}] stale — rebuilding`)
      if (!runBuild(ds.script)) {
        console.warn(
          `[prebuild:${ds.label}] rebuild FAILED — continuing with existing data ` +
            `(${lag} months stale). Fix before the next release.`,
        )
      }
    } else {
      console.log(`[prebuild:${ds.label}] current — skipping rebuild`)
    }
  }
}

main().catch((e) => {
  console.error('[prebuild]', e)
  process.exit(1)
})
