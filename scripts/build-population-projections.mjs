// Build data/population-projections.json from Census Bureau 2023 National
// Population Projections (NPP) detailed files (np2023_d1_*.csv).
//
// Files used (downloaded to /tmp):
//   np2023_d1_mid.csv  -> baseline (Main series)
//   np2023_d1_hi.csv   -> high   (High immigration)
//   np2023_d1_low.csv  -> low    (Low immigration)
//
// Each file: SEX,ORIGIN,RACE,YEAR,TOTAL_POP,POP_0..POP_100 (single year of age).
//   SEX: 0=both, 1=male, 2=female ; ORIGIN: 0=all ; RACE: 0=all
// We filter ORIGIN=0 & RACE=0 (no double counting), SEX in {1,2}, YEAR 2024-2032.
// Resident population, July 1 (mid-year) reference date. Persons -> thousands.

import { readFileSync, writeFileSync } from 'node:fs'

const SRC_DIR = 'C:/Users/alexe/AppData/Local/Temp'
const FILES = {
  baseline: `${SRC_DIR}/d1_mid.csv`,
  high: `${SRC_DIR}/d1_hi.csv`,
  low: `${SRC_DIR}/d1_low.csv`,
}

const AGE_BANDS = [
  { band: '16-24', min: 16, max: 24 },
  { band: '25-34', min: 25, max: 34 },
  { band: '35-44', min: 35, max: 44 },
  { band: '45-54', min: 45, max: 54 },
  { band: '55-64', min: 55, max: 64 },
  { band: '65+', min: 65, max: 100 }, // POP_100 is "100 and over" in NPP
]
const YEARS = [2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032]
const SEX_CODE = { 1: 'M', 2: 'F' }

function parseScenario(path) {
  const text = readFileSync(path, 'utf8')
  const lines = text.split(/\r?\n/)
  const header = lines[0].split(',')
  // Map POP_<age> -> column index
  const popIdx = {} // age -> index
  let idxSex, idxOrigin, idxRace, idxYear
  header.forEach((h, i) => {
    if (h === 'SEX') idxSex = i
    else if (h === 'ORIGIN') idxOrigin = i
    else if (h === 'RACE') idxRace = i
    else if (h === 'YEAR') idxYear = i
    else {
      const m = /^POP_(\d+)$/.exec(h)
      if (m) popIdx[Number(m[1])] = i
    }
  })

  const rows = [] // {year, ageBand, sex, pop}
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li]
    if (!line) continue
    const f = line.split(',')
    const sex = Number(f[idxSex])
    const origin = Number(f[idxOrigin])
    const race = Number(f[idxRace])
    const year = Number(f[idxYear])
    if (origin !== 0 || race !== 0) continue
    if (sex !== 1 && sex !== 2) continue
    if (!YEARS.includes(year)) continue

    for (const ab of AGE_BANDS) {
      let sum = 0
      for (let age = ab.min; age <= ab.max; age++) {
        const ci = popIdx[age]
        if (ci !== undefined) sum += Number(f[ci])
      }
      rows.push({
        year,
        ageBand: ab.band,
        sex: SEX_CODE[sex],
        pop: Math.round((sum / 1000) * 10) / 10, // thousands, 1 decimal
      })
    }
  }
  // sort: year, then ageBand order, then M before F
  const bandOrder = Object.fromEntries(AGE_BANDS.map((b, i) => [b.band, i]))
  rows.sort(
    (a, b) =>
      a.year - b.year ||
      bandOrder[a.ageBand] - bandOrder[b.ageBand] ||
      (a.sex === 'M' ? 0 : 1) - (b.sex === 'M' ? 0 : 1),
  )
  return rows
}

const byScenario = {}
for (const [key, path] of Object.entries(FILES)) {
  byScenario[key] = parseScenario(path)
}

const out = {
  meta: {
    generatedAt: new Date().toISOString(),
    source:
      'U.S. Census Bureau, 2023 National Population Projections, detailed files np2023_d1_{mid,hi,low}.csv',
    sourceUrls: {
      baseline:
        'https://www2.census.gov/programs-surveys/popproj/datasets/2023/2023-popproj/np2023_d1_mid.csv',
      high: 'https://www2.census.gov/programs-surveys/popproj/datasets/2023/2023-popproj/np2023_d1_hi.csv',
      low: 'https://www2.census.gov/programs-surveys/popproj/datasets/2023/2023-popproj/np2023_d1_low.csv',
    },
    concept: 'resident',
    method: 'census-2023-npp',
    vintage: '2023 National Population Projections (released Nov 2023)',
    referenceDate: 'July 1 (mid-year)',
    units: 'thousands of persons',
    scenarios: ['baseline', 'high', 'low'],
    scenarioMapping: {
      baseline: 'Census 2023 NPP Main series (np2023_d1_mid.csv)',
      high: 'Census 2023 NPP High-immigration scenario (np2023_d1_hi.csv)',
      low: 'Census 2023 NPP Low-immigration scenario (np2023_d1_low.csv)',
    },
    ageBands: AGE_BANDS.map((b) => b.band),
    sexes: ['M', 'F'],
    years: YEARS,
    notes:
      'RESIDENT population (all persons, all races/origins, ORIGIN=0 & RACE=0), single year of age summed into 6 bands; SEX 1->M, 2->F. ' +
      'This is NOT the civilian-noninstitutional (CNI) 16+ concept used by the labor-force/LFP models: it includes Armed Forces and the institutionalized, and uses a July-1 reference. ' +
      'Consumers should CALIBRATE/scale each group to a known recent CNI 16+ endpoint (e.g., CPS group population from data/cer-cohorts.json, or a BLS CNI control) before multiplying by trend LFP. ' +
      'The CNI/resident ratio is roughly stable within a group over this short horizon, so the scenario GROWTH and the immigration spread (high>baseline>low) carry over; only the level needs rescaling. ' +
      'Vintage note: this 2023 NPP predates the larger 2021-2024 immigration surge captured in Census Vintage 2025 and config/scenarios.config.ts; treat the level (and near-term growth) as conservative.',
  },
  byScenario,
}

writeFileSync(
  'C:/Users/alexe/Documents/Projects/Markets Analysis/Breakeven NFP/data/population-projections.json',
  JSON.stringify(out, null, 2),
)

// ---- Sanity table: total 16+ population (thousands) by scenario & year ----
function total16(rows, year) {
  return rows
    .filter((r) => r.year === year)
    .reduce((s, r) => s + r.pop, 0)
}
console.log('16+ resident population (millions), high>baseline>low expected:')
console.log('scenario   2024      2030')
for (const key of ['high', 'baseline', 'low']) {
  const t24 = total16(byScenario[key], 2024) / 1000
  const t30 = total16(byScenario[key], 2030) / 1000
  console.log(
    `${key.padEnd(9)}  ${t24.toFixed(1)}M   ${t30.toFixed(1)}M`,
  )
}
console.log(
  `\nrows per scenario: baseline=${byScenario.baseline.length}, high=${byScenario.high.length}, low=${byScenario.low.length} (expect 9 years x 6 bands x 2 sex = 108)`,
)
// spot check one group
const b = byScenario.baseline
console.log('\nbaseline 2024 sample:')
for (const r of b.filter((r) => r.year === 2024)) {
  console.log(`  ${r.ageBand.padEnd(6)} ${r.sex}  ${r.pop.toFixed(0)}k`)
}
