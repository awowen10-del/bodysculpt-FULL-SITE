/**
 * Query validation and reporting-window resolution for the read API (Stage 11B).
 *
 * Validation uses the existing `zod` dependency (no new deps). The reporting
 * window follows docs/STAGE-11-API-PLAN.md §2:
 * - malformed / inverted ranges are rejected `INVALID_QUERY`;
 * - an EXPLICIT closed range wider than the cap is rejected `RANGE_TOO_LARGE`
 *   (never silently truncated);
 * - an OPEN-ended range is resolved against the data extent and the OPEN side is
 *   CLAMPED so the effective window never exceeds the cap.
 */
import { z } from 'zod'
import { invalidQuery, rangeTooLarge } from './errors.ts'

/**
 * Maximum days a single request may span. Mirrors the ingestion backfill cap
 * (`MAX_BACKFILL_DAYS = 400`) as a deliberate, documented product ceiling for the
 * read path; it is a read concern, kept independent of the sync constant.
 */
export const MAX_WINDOW_DAYS = 400

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86_400_000

/** True when `s` is a real calendar date in `YYYY-MM-DD` form. */
function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const ms = Date.parse(`${s}T00:00:00Z`)
  if (Number.isNaN(ms)) return false
  // Reject values Date normalised (e.g. 2026-02-30 → March): round-trip must match.
  return new Date(ms).toISOString().slice(0, 10) === s
}

const dateString = z.string().refine(isRealDate, 'must be a YYYY-MM-DD date')

const dateRangeSchema = z.object({
  start: dateString.optional(),
  end: dateString.optional(),
})

/** A validated (but not yet extent-resolved) pair of optional bounds. */
export interface DateBounds {
  start?: string
  end?: string
}

/** Whole days between two `YYYY-MM-DD` dates, inclusive of both ends. */
export function inclusiveDays(start: string, end: string): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)
  return Math.round(ms / MS_PER_DAY) + 1
}

/** Shift a `YYYY-MM-DD` date by `days` (may be negative), in UTC. */
function shiftDate(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Validate raw query bounds. Throws a client-safe `ApiError` on malformed dates,
 * an inverted range, or an EXPLICIT closed range wider than {@link MAX_WINDOW_DAYS}.
 * Open-ended requests pass through here and are clamped later in {@link resolveWindow}.
 */
export function parseDateRange(query: {
  start?: string
  end?: string
}): DateBounds {
  const parsed = dateRangeSchema.safeParse({
    start: query.start,
    end: query.end,
  })
  if (!parsed.success) {
    throw invalidQuery('start and end must be YYYY-MM-DD dates.')
  }
  const { start, end } = parsed.data
  if (start !== undefined && end !== undefined) {
    if (start > end) throw invalidQuery('start must not be after end.')
    if (inclusiveDays(start, end) > MAX_WINDOW_DAYS) {
      throw rangeTooLarge(
        `The requested window exceeds the ${MAX_WINDOW_DAYS}-day maximum.`,
      )
    }
  }
  return { start, end }
}

/** The inclusive extent of the available data, or `null` when there is none. */
export interface DataExtent {
  start: string
  end: string
}

/** A fully resolved, inclusive window ready to filter on. */
export interface ResolvedWindow {
  start: string
  end: string
}

/**
 * Resolve validated bounds against the data extent, clamping the OPEN side so the
 * effective window never exceeds {@link MAX_WINDOW_DAYS}. A closed range that
 * reaches here is already within the cap (checked in {@link parseDateRange}). When
 * there is no data, an empty-string window is returned — the honest "no window"
 * signal. With NO bounds the default is the FULL data extent: the dashboard has no
 * date picker any more, and verdicts run from each campaign's launch to the newest
 * synced day, so display metrics default to everything synced rather than a
 * trailing slice that would disagree with the cards.
 */
export function resolveWindow(
  bounds: DateBounds,
  extent: DataExtent | null,
): ResolvedWindow {
  if (extent === null) {
    return { start: bounds.start ?? '', end: bounds.end ?? '' }
  }
  const hasStart = bounds.start !== undefined
  const hasEnd = bounds.end !== undefined

  if (hasStart && hasEnd) {
    return { start: bounds.start!, end: bounds.end! }
  }
  if (hasStart && !hasEnd) {
    const start = bounds.start!
    const capped = shiftDate(start, MAX_WINDOW_DAYS - 1)
    return { start, end: extent.end < capped ? extent.end : capped }
  }
  if (!hasStart && hasEnd) {
    const end = bounds.end!
    const capped = shiftDate(end, -(MAX_WINDOW_DAYS - 1))
    return { start: extent.start > capped ? extent.start : capped, end }
  }
  // No bounds at all → the full data extent (everything synced).
  return { start: extent.start, end: extent.end }
}
