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

  // Age-group LFPR — Seasonally Adjusted (FRBSF 2016 model)
  LFPR_16_19: 'LNS11300012', // LFPR 16–19 yrs, SA, %
  LFPR_20_24: 'LNS11300036', // LFPR 20–24 yrs, SA, %
  LFPR_25_54: 'LNS11300060', // LFPR 25–54 yrs, SA, %
  LFPR_55_PLUS: 'LNS11324230', // LFPR 55+ yrs, SA, %

  // Age-group population — Not Seasonally Adjusted (CPS, monthly, thousands)
  POP_16_19: 'LNU00000012',
  POP_20_24: 'LNU00000036',
  POP_25_54: 'LNU00000060',
  POP_55_PLUS: 'LNU00024230',

  // Structural
  NROU: 'NROU', // Noncyclical rate of unemployment (CBO), quarterly, %
} as const

export type SeriesId = (typeof SERIES)[keyof typeof SERIES]
