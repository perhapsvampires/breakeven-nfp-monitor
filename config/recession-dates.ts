// NBER U.S. recession periods (peak month -> trough month), hard-coded for
// chart shading. Source: NBER Business Cycle Dating Committee.

export interface RecessionPeriod {
  start: string // peak, "YYYY-MM-DD"
  end: string // trough, "YYYY-MM-DD"
}

export const RECESSIONS: RecessionPeriod[] = [
  { start: '1990-07-01', end: '1991-03-01' },
  { start: '2001-03-01', end: '2001-11-01' },
  { start: '2007-12-01', end: '2009-06-01' },
  { start: '2020-02-01', end: '2020-04-01' },
]
