// FRED series IDs used across the dashboard.
//
// NOTE: Several IDs in the original build spec do not exist on FRED (validated
// live 2026-06-05). The Employ America CER model does NOT use FRED for its
// cohort data — FRED lacks foreign-born × age detail, which is essential to
// reproduce the published series. Those cohorts come from Census CPS microdata
// (see data/cer-cohorts.json + scripts/build-cer-cohorts.mjs); FRED supplies
// only PAYEMS (g_N) for that model.

export const SERIES = {
  // Core employment
  PAYEMS: 'PAYEMS', // Nonfarm payrolls, SA, thousands
  PAYNSA: 'PAYNSA', // Nonfarm payrolls, NSA, thousands
  CE16OV: 'CE16OV', // Civilian employment level (CPS total), SA, thousands
  CLF16OV: 'CLF16OV', // Civilian labor force level, SA, thousands
  CNP16OV: 'CNP16OV', // Civilian noninstitutional population 16+, NSA, thousands
  CIVPART: 'CIVPART', // Labor force participation rate, SA, %
  UNRATE: 'UNRATE', // Unemployment rate, SA, %
  EMRATIO: 'EMRATIO', // Employment-population ratio (overall), SA, %
  POPTHM: 'POPTHM', // Total U.S. resident population, monthly, thousands

  // Structural
  NROU: 'NROU', // Noncyclical rate of unemployment (CBO), quarterly, %
} as const

export type SeriesId = (typeof SERIES)[keyof typeof SERIES]
