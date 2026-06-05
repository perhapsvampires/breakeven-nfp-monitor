# Breakeven NFP Monitor — Claude Code Build Spec

## Project Overview
A publicly available Next.js dashboard that tracks seven methodologies for estimating the monthly nonfarm payroll (NFP) breakeven rate — the number of jobs needed to keep the U.S. unemployment rate stable. Each model gets its own tab. An AI Summary tab synthesizes all models into a consensus view. The design reference is https://inflation-monitor-rust.vercel.app/ — clean, professional, data-first.

Deployed on Vercel. Built locally first, then pushed to GitHub for Vercel auto-deploy.

---

## Setup Instructions (Do These First)

### 1. Read the FRED API Key
The FRED API key lives at:
`C:\Users\alexe\Documents\Projects\Markets Analysis\Breakeven NFP\fred_api_key.txt`
Read this file. When creating `.env.local`, write the key as `FRED_API_KEY=<contents>`.

### 2. Scaffold the Project
Run inside the project folder:
```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=no --import-alias="@/*"
```

### 3. Install Dependencies
```bash
npm install recharts @anthropic-ai/sdk swr date-fns papaparse
npm install -D @types/papaparse
```

### 4. Environment Variables
Create `.env.local` in project root:
```
FRED_API_KEY=<from fred_api_key.txt>
ANTHROPIC_API_KEY=<user will add this>
REVALIDATE_TOKEN=<generate a random 32-char string>
```
**Never** prefix these with `NEXT_PUBLIC_`. They must stay server-side only.

---

## Design System

### Philosophy
Modern, professional, eminently usable. Data is the hero. No decorative chrome. Every pixel earns its place.

### Colors
```
Background:      #F8F9FA  (off-white, not pure white)
Surface:         #FFFFFF  (cards, panels)
Border:          #E2E8F0  (subtle separators)
Text primary:    #0F172A  (near-black)
Text secondary:  #64748B  (muted labels, metadata)
Text tertiary:   #94A3B8  (disabled, footnotes)
Accent blue:     #1D4ED8  (links, active tabs, primary CTA)
Green:           #16A34A  (payrolls above breakeven)
Red:             #DC2626  (payrolls below breakeven)
Amber:           #D97706  (within range / uncertain)
Chart bars:      #93C5FD  (actual NFP, light blue)
Chart line:      #1D4ED8  (breakeven line, dark blue)
Recession shading: rgba(100,116,139,0.08)
```

### Typography
- Font: Inter (Google Fonts). Load via `next/font/google`.
- Numbers: `font-variant-numeric: tabular-nums` on all data values.
- Big headline numbers: `text-4xl font-semibold tracking-tight`.
- Labels above numbers: `text-xs font-medium uppercase tracking-widest text-secondary`.
- Body / descriptions: `text-sm text-secondary leading-relaxed`.

### Layout
- Max content width: `max-w-7xl mx-auto px-6`
- Top header: site title left, "DATA UPDATED [date] · Last BLS Release: [date]" center, "Refresh" button right
- Tab bar: horizontal pill tabs, one per model + "AI Summary". Active tab has `bg-accent-blue text-white`. Tabs scroll horizontally on mobile.
- Each model page: full-width chart at top (height 320px), then metric cards row, then methodology note.

### Chart Standard
Every model chart shows:
- Light blue bars: actual monthly NFP (PAYEMS month-over-month)
- Dark blue line: breakeven estimate (the model's output)
- Gray shaded band: uncertainty range where applicable
- Gray vertical bands: NBER recession periods (hard-code dates)
- Horizontal dashed line at zero
- X-axis: monthly dates, show year labels only
- Y-axis: thousands of jobs, formatted as `+150k` / `-50k`
- Tooltip on hover: date, actual NFP, breakeven, gap

---

## File Structure

```
/
├── app/
│   ├── layout.tsx               # Inter font, global nav, tab bar
│   ├── page.tsx                 # Redirects to /models/overview or renders overview
│   ├── overview/page.tsx        # All models side-by-side summary cards
│   ├── models/
│   │   ├── employ-america/page.tsx       # BUILD FIRST
│   │   ├── stlouis-fed/page.tsx
│   │   ├── sf-fed/page.tsx
│   │   ├── dallas-fed/page.tsx
│   │   ├── fed-board/page.tsx
│   │   ├── hamilton-project/page.tsx
│   │   ├── frbsf-2016/page.tsx
│   │   └── ai-summary/page.tsx
│   └── api/
│       ├── fred/route.ts                # FRED proxy — server only
│       ├── summary/route.ts             # Claude AI summary
│       └── revalidate/route.ts          # On-demand ISR revalidation
├── lib/
│   ├── fred.ts                  # fetchFredSeries(), fetchMultiple(), types
│   ├── filters.ts               # movingAverage(), bandPassFilter()
│   ├── formatting.ts            # formatK(), formatDate(), formatSign()
│   └── models/
│       ├── employAmericaCER.ts
│       ├── gregoryBick.ts
│       ├── sfFedBandpass.ts
│       ├── cheremukhin.ts
│       ├── murrayVidangos.ts
│       ├── edelbergWatson.ts
│       └── frbsf2016.ts
├── config/
│   ├── series.ts                # All FRED series IDs as typed constants
│   ├── scenarios.config.ts      # Immigration Low/Base/High parameters
│   └── recession-dates.ts       # NBER recession start/end dates
├── data/
│   └── cbo-projections.json     # Potential LFPR + NROU (static, from CBO ZIP)
├── components/
│   ├── layout/
│   │   ├── Header.tsx
│   │   ├── TabBar.tsx
│   │   └── Footer.tsx
│   ├── charts/
│   │   ├── BreakevenChart.tsx   # Standard recharts wrapper used by all models
│   │   └── ChartTooltip.tsx
│   ├── ModelCard.tsx            # Big number + label + trend arrow
│   ├── MetricsRow.tsx           # Latest / 3m avg / 6m avg / 12m avg
│   ├── ScenarioToggle.tsx       # Low/Base/High immigration buttons
│   ├── MethodologyNote.tsx      # Collapsible source citation block
│   └── RefreshButton.tsx
└── types/
    └── economic.ts              # FredObservation, ModelResult, Scenario
```

---

## FRED Series IDs Reference (`config/series.ts`)

```typescript
export const SERIES = {
  // Core employment
  PAYEMS:        'PAYEMS',         // Nonfarm Payrolls, SA, thousands
  CE16OV:        'CE16OV',         // Employment Level CPS, SA, thousands
  CLF16OV:       'CLF16OV',        // Labor Force Level, SA, thousands
  CNP16OV:       'CNP16OV',        // Civilian Noninstitutional Pop 16+, NSA, thousands
  CIVPART:       'CIVPART',        // Labor Force Participation Rate, SA, %
  UNRATE:        'UNRATE',         // Unemployment Rate, SA, %
  EMRATIO:       'EMRATIO',        // Employment-Population Ratio overall, SA
  LNS16000000:   'LNS16000000',    // CPS employment adjusted to payroll concept
  LNS12000000:   'LNS12000000',    // CPS total employment

  // CBO structural
  NROU:          'NROU',           // Noncyclical rate of unemployment (NAIRU), quarterly

  // Age-group EPR — Seasonally Adjusted (LNS12300xxx)
  EPR_16_19:     'LNS12300012',
  EPR_20_24:     'LNS12300036',
  EPR_25_54:     'LNS12300060',
  EPR_55_PLUS:   'LNS12324230',
  EPR_25_34:     'LNS12300089',
  EPR_35_44:     'LNS12300091',
  EPR_45_54:     'LNS12300093',

  // Age-group EPR — NOT Seasonally Adjusted (LNU02300xxx) — used by Employ America CER
  EPR_NSA_16_19: 'LNU02300012',
  EPR_NSA_20_24: 'LNU02300036',
  EPR_NSA_25_54: 'LNU02300060',
  EPR_NSA_55_PLUS: 'LNU02324230',

  // Age-group LFPR — SA (LNS11300xxx)
  LFPR_16_19:    'LNS11300012',
  LFPR_20_24:    'LNS11300036',
  LFPR_25_54:    'LNS11300060',
  LFPR_55_PLUS:  'LNS11324230',

  // Foreign-born (NSA, CPS Table A-7, starts Jan 2007)
  FB_LFPR:       'LNU01373395',    // Foreign-born LFPR
  FB_LF:         'LNU01073395',    // Foreign-born labor force level
  FB_EMP:        'LNU02073395',    // Foreign-born employment level
  FB_POP:        'LNU00073395',    // Foreign-born population level

  // Population
  POPTHM:        'POPTHM',         // Total US population, monthly, thousands
} as const
```

---

## Immigration Scenario Config (`config/scenarios.config.ts`)

```typescript
export interface ImmigrationScenario {
  id: 'low' | 'baseline' | 'high'
  label: string
  // Net immigration contribution to CNI 16+ population per month (thousands)
  monthlyNetImmigration: number
  // Share of net immigrants who are civilian, non-institutional, 16+ (from Edelberg/Watson)
  cnipShare: number
  // Labor force participation rate assumed for new immigrants
  newImmigrantLFPR: number
  // Data sources and vintage
  source: string
  vintageDate: string
}

export const SCENARIOS: ImmigrationScenario[] = [
  {
    id: 'low',
    label: 'Low',
    // Brookings Jan 2026 low end: ~-925,000/yr → -77K/month; or Dallas Fed ~-55K/month net outflow H2 2025
    monthlyNetImmigration: -46,
    cnipShare: 0.81,
    newImmigrantLFPR: 0.66,
    source: 'Brookings/Edelberg et al. Jan 2026; Dallas Fed Cheremukhin Mar 2026',
    vintageDate: '2026-01',
  },
  {
    id: 'baseline',
    label: 'Baseline',
    // Census Vintage 2025: ~321,000/yr → ~27K/month
    monthlyNetImmigration: 27,
    cnipShare: 0.81,
    newImmigrantLFPR: 0.66,
    source: 'Census Bureau Vintage 2025 (Jan 27, 2026)',
    vintageDate: '2026-01',
  },
  {
    id: 'high',
    label: 'High',
    // CBO Jan 2026 Demographic Outlook: slightly above Census; ~35K/month
    monthlyNetImmigration: 35,
    cnipShare: 0.81,
    newImmigrantLFPR: 0.66,
    source: 'CBO Demographic Outlook Jan 2026',
    vintageDate: '2026-01',
  },
]

export const DEFAULT_SCENARIO: ImmigrationScenario['id'] = 'baseline'

// UPDATE THIS FILE when CBO/Census/Brookings publish new immigration estimates.
// Change monthlyNetImmigration values and update vintageDate.
// No code changes needed — the UI reads this config at build time.
```

---

## FRED API Utility (`lib/fred.ts`)

```typescript
const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'

export interface FredObservation {
  date: string        // "YYYY-MM-DD"
  value: number | null
}

export async function fetchFredSeries(
  seriesId: string,
  options: { startDate?: string; frequency?: string } = {}
): Promise<FredObservation[]> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: process.env.FRED_API_KEY!,
    file_type: 'json',
    observation_start: options.startDate ?? '2019-01-01',
    ...(options.frequency ? { frequency: options.frequency } : {}),
  })
  const res = await fetch(`${FRED_BASE}?${params}`, {
    next: { revalidate: 21600, tags: ['fred'] },  // 6-hour cache
  })
  if (!res.ok) throw new Error(`FRED fetch failed: ${seriesId}`)
  const json = await res.json()
  return json.observations.map((o: any) => ({
    date: o.date,
    value: o.value === '.' ? null : parseFloat(o.value),
  }))
}

// Fetch multiple series in parallel
export async function fetchMultipleSeries(
  seriesIds: string[]
): Promise<Record<string, FredObservation[]>> {
  const results = await Promise.all(
    seriesIds.map(id => fetchFredSeries(id).then(data => [id, data] as const))
  )
  return Object.fromEntries(results)
}
```

All FRED API calls go through `/app/api/fred/route.ts` (a Route Handler) when called from the client, or directly from `lib/fred.ts` in Server Components. Never call FRED from client components.

---

## Model Implementations

### Build Order
1. **Employ America CER** — FRED-only, build and validate end-to-end pipeline first
2. **St. Louis Fed (Gregory & Bick)** — simple formula, good second step
3. **FRBSF 2016 (Bidder et al.)** — historical baseline, mostly FRED
4. **Hamilton Project (Edelberg & Watson)** — adds scenario toggle
5. **SF Fed (Petrosky-Nadeau)** — adds band-pass filter complexity
6. **Fed Board (Murray & Vidangos)** — adds CBO ZIP static data
7. **Dallas Fed (Cheremukhin)** — most complex, needs all components
8. **AI Summary** — last, after all model data is confirmed working

---

### Model 1: Employ America CER (Build First)

**Source:** Preston Mui, Employ America, April 2026. "Estimating Constant-Employment-Rate (CER) NFP Growth."

**Formula (12-month window to avoid seasonality):**
```
gCER = gN - g_ẽ - gA

where:
  gN  = 12-month growth rate of nonfarm payrolls (PAYEMS)
  g_ẽ = employment-weighted change in cohort EPRs (using NSA age-group EPRs)
  gA  = growth rate of CPS-to-CES adjustment factor A
       = LNS16000000 / LNS12000000

CER-NFP level = (PAYEMS_t / PAYEMS_{t-12}) * PAYEMS_{t-12} * (gCER / 12)
```

**FRED series needed:** `PAYEMS`, `LNS16000000`, `LNS12000000`, and NSA EPR series:
`LNU02300012` (16-19), `LNU02300036` (20-24), `LNU02300060` (25-54), `LNU02324230` (55+).

**What to display:**
- Big number: current month CER-NFP estimate (thousands)
- MetricsRow: Latest / 3m avg / 6m avg / 12m avg for both actual NFP and CER breakeven
- Chart: actual NFP bars vs CER breakeven line, Jan 2020–present
- Source callout: "This model removes the effect of changing employment rates within age groups, leaving only the population-driven component. It requires no immigration assumptions, making it the most robust to demographic uncertainty."

---

### Model 2: St. Louis Fed — Gregory & Bick

**Source:** Victoria Gregory & Alexander Bick, FRB St. Louis, April 15, 2025.

**Formula:**
```
Breakeven = LaborForceGrowth × (1 - UnemploymentRate)

LaborForceGrowth = PopulationGrowth × LFPR_12mAvg

PopulationGrowth = CBO projected monthly CNI 16+ growth (from scenarios.config.ts)
LFPR_12mAvg     = 12-month moving average of CIVPART
UnemploymentRate = prior month UNRATE
SurveyAdj       = PAYEMS / LNS16000000  (establishment ÷ household)

BreakevenJobs   = LaborForceGrowth × (1 - UnemploymentRate) × SurveyAdj
```

**FRED series:** `CIVPART`, `UNRATE`, `PAYEMS`, `LNS16000000`, `CNP16OV`.

**Scenario toggle:** connects to `scenarios.config.ts` → `monthlyNetImmigration` adjusts `PopulationGrowth`.

**What to display:**
- Show Low/Base/High scenario toggle (drives population growth input)
- Big number: breakeven at selected scenario
- Decomposition note: "Population growth contributes X, LFPR contributes Y"

---

### Model 3: FRBSF 2016 Baseline — Bidder, Mahedy & Valletta

**Source:** FRBSF Economic Letter 2016-32. Historical/reference baseline.

**Formula:**
```
Breakeven = PopGrowth × LFPR × (1 - NaturalRate)

Uses age-group LFPR trends (16-24, 25-54, 55-64, 65+) × Census population projections by age.
NaturalRate = NROU (from FRED, currently ~4.4%).
```

**FRED series:** `LFPR_16_19`, `LFPR_20_24`, `LFPR_25_54`, `LFPR_55_PLUS`, `NROU`, `CNP16OV`.

**Purpose:** Show the pre-immigration-surge consensus estimate as a historical anchor. Label clearly as "2016 methodology — historical baseline."

---

### Model 4: Hamilton Project — Edelberg & Watson

**Source:** Wendy Edelberg & Tara Watson, Hamilton Project / Brookings, March 2024.

**Formula:**
```
Breakeven = PrePandemicRange + ImmigrationAdjustment

ImmigrationAdjustment = (CBONetImmigration - PrePandemicProjection) × 0.81 × 0.66 / 12

PrePandemicProjection = 1,000,000 / year (CBO 2019 baseline)
CBONetImmigration     = from scenarios.config.ts (scenario-dependent)
0.81                  = share of net immigrants who are CNIP 16+
0.66                  = labor force participation rate for new immigrants
```

**Scenario toggle:** scenario drives `CBONetImmigration`. Show the resulting range as a band, not a point estimate.

**What to display:**
- Range band on chart (shaded area between low and high breakeven)
- Text: "At [scenario] immigration (X/month net), sustainable employment growth is approximately Y,000–Z,000/month"
- Show the pre-pandemic baseline (60-100K) as a reference line

---

### Model 5: SF Fed — Petrosky-Nadeau & Stewart

**Source:** Nicolas Petrosky-Nadeau & Stephanie Stewart, FRBSF EL 2024-18, July 8, 2024.

**Long-run breakeven:** ~70,000–90,000/month (structural, from band-pass filter).
**Short-run breakeven:** cyclically variable, peaked ~230,000 during immigration surge.

**Implementation:**
```typescript
// lib/filters.ts
export function movingAverage(data: number[], window: number): number[] { ... }

// Short-run: 6-month moving average of labor force growth rate
// Long-run: approximate as stable 75,000 band (the paper's filter result)
// Show both on chart as two separate lines
```

**FRED series:** `CLF16OV`, `CNP16OV`, `CIVPART`.

**Note:** Label the long-run line "Long-run trend (~75K)" as a flat reference band.
Label the short-run line as the 6-month moving average of labor force growth.

---

### Model 6: Fed Board — Murray & Vidangos

**Source:** Seth Murray & Ivan Vidangos, FEDS Notes, April 2, 2026.

**Formula:**
```
Breakeven = ΔPotentialLaborForce × (1 - NoncyclicalUnemployment)

ΔPotentialLF = ΔPopulation × PotentialLFPR + ΔPotentialLFPR × Population_{t-1}
```

**Static data dependency:** CBO's potential LFPR is **not on FRED**. Extract from CBO ZIP at `https://www.cbo.gov/system/files/2026-02/55022-2026-02-Historical-Economic-Data.zip`. The quarterly series "Potential Labor Force Participation Rate" → save as `data/cbo-projections.json`:
```json
{
  "vintageDate": "2026-02",
  "source": "CBO Economic Projections Feb 2026",
  "potentialLFPR": [
    { "date": "2020-Q1", "value": 63.1 },
    ...
  ],
  "nrou": [
    { "date": "2020-Q1", "value": 4.4 },
    ...
  ]
}
```

**FRED series:** `CNP16OV`, `NROU` (cross-check with cbo-projections.json).

**Scenario toggle:** adjusts population growth (immigration component of ΔPopulation).

**What to display:**
- Key callout: "Potential labor force growing by fewer than 10,000/month in 2026 — a pace without precedent in at least 65 years" (Murray & Vidangos verbatim finding)
- Chart: show historical breakeven (1990–present) alongside actual NFP

---

### Model 7: Dallas Fed — Cheremukhin

**Source:** Anton Cheremukhin, Dallas Fed, October 2025; updated with Wilson & Zhou, March 2026.

**Three-component formula:**
```
Breakeven = (PopGrowthContrib + LFPCycleContrib + StructuralRatioContrib) × EmploymentLevel

Component 1 — Population growth (monthly, thousands):
  = NaturalChange + LegalImmigration + NetUnauthorized
  NaturalChange    ≈ 30K/month (CDC births minus deaths, project trend)
  LegalImmigration ≈ from scenarios.config.ts (LPR + INA share)
  NetUnauthorized  ≈ from scenarios.config.ts (most uncertain; negative in 2025-26)

Component 2 — LFP cycle:
  = 2-year moving average of monthly CIVPART growth rate

Component 3 — Structural CNP/POP ratio:
  = slow-moving ratio of CNP16OV to POPTHM (changes ~25K/month)
```

**Key display:** show the three-component decomposition as a stacked bar chart (like Figure 2 in the paper).

**Important disclosure:** "Net unauthorized immigration is the most uncertain input. This dashboard uses public proxy data (CBO projections + scenario config) as an approximation of the Dallas Fed's proprietary high-frequency estimate."

---

## AI Summary Tab

**Source:** Claude API, called live on each page load / refresh.

**Route Handler** (`app/api/summary/route.ts`):
```typescript
import Anthropic from '@anthropic-ai/sdk'

export async function GET() {
  // 1. Fetch all model outputs from internal endpoints (or recompute here)
  // 2. Build prompt with current model results
  // 3. Stream response from Claude
}
```

**Prompt structure:**
```
You are a professional economic analyst writing for a sophisticated financial audience.
Today is [DATE]. The latest BLS Employment Situation showed [X,000] nonfarm payrolls added in [MONTH].

Here are the current breakeven estimates from seven methodologies:

- Employ America CER: [X,000]
- St. Louis Fed (Gregory & Bick, [scenario]): [X,000]
- FRBSF 2016 Baseline: [X,000]
- Hamilton Project (Edelberg & Watson, [scenario]): [X,000]–[Y,000]
- SF Fed (Petrosky-Nadeau): Long-run ~[X,000], Short-run [Y,000]
- Fed Board (Murray & Vidangos, [scenario]): [X,000]
- Dallas Fed (Cheremukhin, [scenario]): [X,000]

Recent payrolls context:
- Latest print: [X,000]
- 3-month average: [X,000]
- 6-month average: [X,000]

Write a concise AI summary (350–450 words) structured as follows:
1. **Aggregate Breakeven Estimate** — synthesize the seven models into a consensus range with a point estimate midpoint. Explain the key drivers of disagreement (immigration assumptions, methodology).
2. **Current Labor Market Reading** — compare the latest and recent-average payroll prints to the consensus range. Assess whether the labor market is above, at, or below breakeven.
3. **Immigration Sensitivity** — briefly explain how breakeven estimates shift between Low, Baseline, and High immigration scenarios.
4. **Key Uncertainties** — flag the two or three most important data limitations (e.g., unauthorized immigration measurement, CBO revision timing, payroll benchmark revisions).

Be precise with numbers. Avoid hedging language. Write in a direct, analytical voice.
```

**UI for AI Summary tab:**
- Show aggregate breakeven range prominently (a computed average/range of the 7 models)
- Below it, the full Claude-generated prose
- Small label: "Generated by Claude, [timestamp]. Refresh to regenerate."
- "Refresh Analysis" button
- Disclosure: "AI analysis synthesizes published economic research. Not financial advice."

---

## MetricsRow Component

Show this row on every model tab:

| | Latest | 3m Avg | 6m Avg | 12m Avg |
|---|---|---|---|---|
| Actual NFP | +X,000 | +X,000 | +X,000 | +X,000 |
| Breakeven | X,000 | X,000 | X,000 | X,000 |
| Gap | **+X,000** (green) | ... | ... | ... |

Gap = Actual NFP − Breakeven. Green if positive (payrolls exceeding breakeven), red if negative.

---

## Revalidation Strategy

In `next.config.js`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { ppr: false },
}
module.exports = nextConfig
```

On model pages, add:
```typescript
export const revalidate = 21600 // 6 hours
```

The `/api/revalidate` route handler accepts `?secret=REVALIDATE_TOKEN` and calls `revalidatePath('/')` + `revalidateTag('fred')`. Wire a Vercel Cron to hit this on the first Friday of each month at 8:35am ET (after BLS Employment Situation release at 8:30am).

---

## Methodology Notes (shown on each tab)

Each model tab ends with a collapsible `<MethodologyNote>` component showing:
- Source paper title, authors, institution, date
- One-paragraph plain-English explanation of what the model measures and its key assumptions
- Link to the original paper
- Data vintage and last-updated stamp

---

## Deployment Checklist

1. `git init` + push to GitHub
2. Connect repo to Vercel (vercel.com → Import Project)
3. Add environment variables in Vercel Project Settings:
   - `FRED_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `REVALIDATE_TOKEN`
4. Set Vercel Cron in `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/revalidate?secret=<REVALIDATE_TOKEN>",
    "schedule": "35 8 1-7 * 5"
  }]
}
```
5. Deploy. First build will pull fresh FRED data.
6. Test: visit `/models/employ-america` first. Validate all charts render with real data before proceeding to immigration-dependent models.

---

## Manual Maintenance Tasks (Non-Code)

These require human action, not code changes:

| Task | Frequency | Action |
|------|-----------|--------|
| Update immigration scenarios | Quarterly or when CBO/Census/Brookings publishes | Edit `config/scenarios.config.ts` → update `monthlyNetImmigration` and `vintageDate` |
| Refresh CBO potential LFPR | ~2x/year | Download new CBO ZIP, extract CSVs, update `data/cbo-projections.json` |
| Update CBO NAIRU | ~2x/year | Verify `NROU` on FRED is current; update `data/cbo-projections.json` if needed |
| Verify CBP encounter data URL | Monthly | CBP rotates filenames; check `cbp.gov/document/stats/nationwide-encounters` for latest CSV link |

---

## Important Caveats to Surface in UI

Display these as a sticky "About the Data" footer on every page:

1. **Breakeven estimates are not revised.** Monthly payroll data is subject to substantial revision (preliminary → two monthly revisions → annual benchmark). A payroll print that appears above breakeven may fall below it after revision.
2. **Immigration is the dominant uncertainty.** Net unauthorized immigration in 2025-26 has no reliable real-time public measure. This dashboard uses CBO/Census/Brookings projections; the Dallas Fed model uses a proprietary estimate.
3. **Models disagree on breakeven by design.** Each methodology captures different aspects of labor force dynamics. The range across models is itself informative — a wide range signals elevated measurement uncertainty.
4. **Not financial advice.** This is an educational research tool synthesizing published academic and government research.
