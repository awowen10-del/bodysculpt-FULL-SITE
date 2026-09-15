/**
 * Deterministic date-window grouping for daily-insight ingestion (Stage 6).
 *
 * Insights are grouped into fixed-size calendar windows so each window can be
 * written in its own transaction (resumable, isolated partial failure). Windows
 * are deterministic: bins are anchored to the earliest insight date and sized at
 * `DEFAULT_INSIGHT_WINDOW_DAYS` calendar days; only non-empty bins are emitted,
 * in ascending start order; rows within a window are ordered by `(date, ad id)`.
 */
import type { NormalizedDailyInsight } from '../../types/index.ts'
import { IngestError } from './dbErrors.ts'

/** Documented default window size: 7 calendar days. */
export const DEFAULT_INSIGHT_WINDOW_DAYS = 7

export interface InsightWindow {
  /** Inclusive window start (YYYY-MM-DD). */
  start: string
  /** Inclusive window end (YYYY-MM-DD). */
  end: string
  insights: NormalizedDailyInsight[]
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86_400_000

function toUtcMs(date: string): number {
  if (!ISO_DATE_RE.test(date)) {
    throw new IngestError('INVALID_REQUEST', 'insight date is not YYYY-MM-DD')
  }
  const ms = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(ms)) {
    throw new IngestError('INVALID_REQUEST', 'insight date is not a real date')
  }
  return ms
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function dayDiff(fromMs: number, toMs: number): number {
  return Math.floor((toMs - fromMs) / MS_PER_DAY)
}

/**
 * Group insights into deterministic, non-overlapping windows. Empty input yields
 * an empty array (a valid, zero-work run). `windowDays` must be >= 1.
 */
export function groupInsightsIntoWindows(
  insights: readonly NormalizedDailyInsight[],
  windowDays: number = DEFAULT_INSIGHT_WINDOW_DAYS,
): InsightWindow[] {
  if (!Number.isInteger(windowDays) || windowDays < 1) {
    throw new IngestError(
      'INVALID_REQUEST',
      'windowDays must be an integer >= 1',
    )
  }
  if (insights.length === 0) return []

  // Deterministic ordering: by date ascending, then Meta ad id ascending.
  const sorted = [...insights].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.metaAdId.localeCompare(b.metaAdId),
  )

  const anchorMs = toUtcMs(sorted[0].date)
  const byBin = new Map<number, InsightWindow>()

  for (const insight of sorted) {
    const bin = Math.floor(
      dayDiff(anchorMs, toUtcMs(insight.date)) / windowDays,
    )
    let window = byBin.get(bin)
    if (!window) {
      const startMs = anchorMs + bin * windowDays * MS_PER_DAY
      const endMs = startMs + (windowDays - 1) * MS_PER_DAY
      window = {
        start: fromUtcMs(startMs),
        end: fromUtcMs(endMs),
        insights: [],
      }
      byBin.set(bin, window)
    }
    window.insights.push(insight)
  }

  return [...byBin.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, window]) => window)
}
