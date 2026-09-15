/**
 * Date-range validation and deterministic fetch-window chunking for Stage 7.
 *
 * Hard caps (cannot be increased by CLI or env; tests may inject LOWER values):
 *   MAX_BACKFILL_DAYS = 400 (inclusive), MAX_WINDOWS_PER_RUN = 60,
 *   FETCH_WINDOW_DAYS = 7.
 */
import { SyncError } from './errors.ts'

export const MAX_BACKFILL_DAYS = 400
export const MAX_WINDOWS_PER_RUN = 60
export const FETCH_WINDOW_DAYS = 7

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86_400_000

export interface DateRange {
  since: string
  until: string
}

export interface WindowLimits {
  /** <= MAX_BACKFILL_DAYS; a larger value is rejected. */
  maxBackfillDays?: number
  /** <= MAX_WINDOWS_PER_RUN; a larger value is rejected. */
  maxWindows?: number
  /** <= FETCH_WINDOW_DAYS; a larger value is rejected. Tests may lower it. */
  windowDays?: number
}

function toUtcMs(date: string, field: string): number {
  if (!ISO_DATE_RE.test(date)) {
    throw new SyncError('INVALID_REQUEST', `${field} must be YYYY-MM-DD`)
  }
  const ms = Date.parse(`${date}T00:00:00Z`)
  const d = new Date(ms)
  if (Number.isNaN(ms) || d.toISOString().slice(0, 10) !== date) {
    throw new SyncError(
      'INVALID_REQUEST',
      `${field} is not a real calendar date`,
    )
  }
  return ms
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Resolve limits, clamping each to its hard maximum (never above). */
function resolveLimits(limits: WindowLimits): Required<WindowLimits> {
  const maxBackfillDays = Math.min(
    limits.maxBackfillDays ?? MAX_BACKFILL_DAYS,
    MAX_BACKFILL_DAYS,
  )
  const maxWindows = Math.min(
    limits.maxWindows ?? MAX_WINDOWS_PER_RUN,
    MAX_WINDOWS_PER_RUN,
  )
  const windowDays = Math.min(
    limits.windowDays ?? FETCH_WINDOW_DAYS,
    FETCH_WINDOW_DAYS,
  )
  if (maxBackfillDays < 1 || maxWindows < 1 || windowDays < 1) {
    throw new SyncError('INVALID_REQUEST', 'window limits must be >= 1')
  }
  return { maxBackfillDays, maxWindows, windowDays }
}

/**
 * Validate a range against caps and today's date. `todayIso` is injected (no
 * hidden clock). Returns the inclusive day count.
 */
export function validateRange(
  range: DateRange,
  todayIso: string,
  limits: WindowLimits = {},
): number {
  const { maxBackfillDays } = resolveLimits(limits)
  const start = toUtcMs(range.since, 'since')
  const end = toUtcMs(range.until, 'until')
  const today = toUtcMs(todayIso, 'today')
  if (end < start) {
    throw new SyncError('INVALID_REQUEST', 'until precedes since')
  }
  if (end > today) {
    throw new SyncError('INVALID_REQUEST', 'until is in the future')
  }
  const inclusiveDays = Math.floor((end - start) / MS_PER_DAY) + 1
  if (inclusiveDays > maxBackfillDays) {
    throw new SyncError(
      'RANGE_TOO_LARGE',
      `range of ${inclusiveDays} days exceeds the ${maxBackfillDays}-day cap`,
    )
  }
  return inclusiveDays
}

/**
 * Chunk an (already-validated) range into deterministic ascending fetch windows,
 * enforcing the window-count cap.
 */
export function chunkRange(
  range: DateRange,
  limits: WindowLimits = {},
): DateRange[] {
  const { maxWindows, windowDays } = resolveLimits(limits)
  const start = toUtcMs(range.since, 'since')
  const end = toUtcMs(range.until, 'until')
  if (end < start) {
    throw new SyncError('INVALID_REQUEST', 'until precedes since')
  }
  const windows: DateRange[] = []
  for (let ms = start; ms <= end; ms += windowDays * MS_PER_DAY) {
    const winEnd = Math.min(ms + (windowDays - 1) * MS_PER_DAY, end)
    windows.push({ since: fromUtcMs(ms), until: fromUtcMs(winEnd) })
    if (windows.length > maxWindows) {
      throw new SyncError(
        'TOO_MANY_WINDOWS',
        `range produces more than the ${maxWindows}-window cap`,
      )
    }
  }
  return windows
}

/** Rolling window ending today (inclusive), `windowDays` long. */
export function rollingRange(
  todayIso: string,
  windowDays: number = FETCH_WINDOW_DAYS,
): DateRange {
  const end = toUtcMs(todayIso, 'today')
  const days = Math.min(windowDays, FETCH_WINDOW_DAYS)
  const start = end - (days - 1) * MS_PER_DAY
  return { since: fromUtcMs(start), until: fromUtcMs(end) }
}
