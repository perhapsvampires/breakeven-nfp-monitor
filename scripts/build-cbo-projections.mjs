#!/usr/bin/env node
// Fetches the CBO Feb 2026 "Historical Economic Data" ZIP, extracts the
// quarterly CSV, and writes data/cbo-projections.json.
//
// Run with:  node scripts/build-cbo-projections.mjs
//
// UPDATE the ZIP_URL when CBO publishes a new Economic Outlook.

import { execSync } from 'child_process'
import { createWriteStream } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import https from 'https'
import path from 'path'
import { fileURLToPath } from 'url'

const ZIP_URL =
  'https://www.cbo.gov/system/files/2026-02/55022-2026-02-Historical-Economic-Data.zip'
const VINTAGE = '2026-02'
const PUBLICATION = 'https://www.cbo.gov/publication/61882'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = path.join(ROOT, '.next', 'cache', 'cbo-data.zip')
const OUT = path.join(ROOT, 'data', 'cbo-projections.json')

async function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        return download(res.headers.location, dest).then(resolve, reject)
      }
      res.pipe(file)
      file.on('finish', () => file.close(resolve))
    }).on('error', reject)
  })
}

console.log('Downloading CBO ZIP…')
await download(ZIP_URL, TMP)
console.log('Downloaded to', TMP)

const raw = execSync(`unzip -p "${TMP}" Quarterly_February2026.csv`, { maxBuffer: 5_000_000 }).toString()
const lines = raw.trim().split('\n')
const header = lines[0].split(',')
const idx = {
  date: 0,
  potentialLFPR: header.indexOf('potential_lfpr'),
  nrou: header.indexOf('noncyclical_rate_of_unemployment'),
  potentialLF: header.indexOf('potential_lf'),
  popCiv16: header.indexOf('population_civ_16yo_census'),
}

const quarterly = []
for (const line of lines.slice(1)) {
  const f = line.split(',')
  const rawDate = f[idx.date]
  if (!rawDate) continue
  const m = rawDate.match(/^(\d{4})q([1-4])$/)
  if (!m) continue
  const year = parseInt(m[1])
  if (year < 2015 || year > 2036) continue
  const parse = (v) => { const n = parseFloat(v); return isNaN(n) ? null : Math.round(n * 10000) / 10000 }
  quarterly.push({
    date: rawDate.toUpperCase().replace('q', 'Q'),
    potentialLFPR: parse(f[idx.potentialLFPR]),
    nrou: parse(f[idx.nrou]),
    potentialLFMillions: parse(f[idx.potentialLF]),
    popCiv16Millions: parse(f[idx.popCiv16]),
  })
}

const out = JSON.stringify({
  meta: {
    source: `CBO Budget and Economic Outlook, ${VINTAGE}`,
    publication: PUBLICATION,
    dataZip: ZIP_URL,
    vintage: VINTAGE,
    units: {
      potentialLFPR: 'percent',
      nrou: 'percent',
      potentialLFMillions: 'millions of people',
      popCiv16Millions: 'millions of people (civilian noninstitutional, 16+)',
    },
    generatedAt: new Date().toISOString(),
  },
  quarterly,
}, null, 2)

await writeFile(OUT, out)
console.log(`Wrote ${quarterly.length} quarters to data/cbo-projections.json`)
