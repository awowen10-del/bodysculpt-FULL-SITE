/**
 * Read-only completeness check for the `daily_ad_insights` backfill (Stage 11E).
 *
 * WHY THIS EXISTS (and what the old check got wrong): the previous verifier
 * demanded one insight row for every calendar date in a fixed 14-day window and
 * failed otherwise. Meta legitimately returns NO rows for a date with no ad
 * delivery (a paused account, a weekend with no spend, days not yet reported), so
 * "missing dates" is normal and is NOT evidence of an incomplete backfill.
 *
 * A backfill is judged from the SYNC RUN, not from the calendar:
 *   - the latest sync run covering the requested range must have succeeded;
 *   - it must have recorded no errors (a failed insight window records one);
 *   - the records it requested must equal the records it wrote (a rolled-back
 *     window contributes 0 to `written`, so a mismatch means a window/dimension
 *     never committed).
 * `recordsRequested === recordsWritten` holds BY CONSTRUCTION on a fully
 * successful run (see the count-semantics note in `src/types/index.ts`), so their
 * agreement is a necessary gate, not proof of landed rows. The authoritative
 * measure of what landed is a direct read of `daily_ad_insights` — which is why
 * the report always prints the stored row count and the exact dates present.
 *
 * SERVER-ONLY (imports the Drizzle schema). Takes an injected db handle, opens no
 * connection of its own, and is unit-testable on PGlite. Reads only; never writes.
 */
import { and, desc, gte, inArray, isNotNull, lte } from 'drizzle-orm'
import * as schema from './schema/index.ts'
import type { ReadableDb } from './insightsSummary.ts'
import type { StructuredSyncError } from '../types/index.ts'

const DAY_MS = 86_400_000

/** Run levels that fetch the insights edge. `reconciliation` never does. */
const INSIGHT_LEVELS = ['backfill', 'daily', 'manual'] as const

/**
 * How many trailing days with no delivery are tolerated before the newest stored
 * insight date is flagged as "unexpectedly old". A handful of recent no-delivery
 * days is normal (Meta has simply not reported them yet), so a small tail must NOT
 * warn; only a week-plus gap between the newest stored date and the requested end
 * is worth an operator's attention — and even then it is a WARNING, never a
 * FAILED (requirement: an old tail must not auto-fail the backfill).
 */
const STALE_TAIL_DAYS = 7

/** Hard cap on date enumeration so a malformed range can never spin forever. */
const MAX_RANGE_DAYS = 3660

export type BackfillResult = 'COMPLETE' | 'WARNING' | 'FAILED'

export type RangeSource = 'arguments' | 'latest-sync-run' | 'rolling-default'

/** The safe, printable summary of the sync run the verdict was drawn from. */
export interface RelevantSyncRun {
  id: string
  level: string
  scope: string
  status: string
  dateRangeStart: string | null
  dateRangeEnd: string | null
  recordsRequested: number | null
  recordsWritten: number | null
  /** Total structured errors recorded on the run (0 when the column is null). */
  errorCount: number
  /** Insight-window failures only (window bounds — never messages or ids). */
  failedWindows: { start?: string; end?: string }[]
}

export interface BackfillVerification {
  requestedRange: { since: string; until: string }
  rangeSource: RangeSource
  /** The latest run COVERING the requested range, or null when none exists. */
  syncRun: RelevantSyncRun | null
  /** Sync-run record counts (all entities), echoed for the operator report. */
  recordsRequested: number | null
  recordsWritten: number | null
  /** Distinct `daily_ad_insights` rows whose date falls inside the range. */
  storedRowsInRange: number
  /** Dates in range that Meta returned at least one row for, ascending. */
  datesWithRows: string[]
  /** Dates in range with NO returned rows — i.e. no delivery, not incomplete. */
  datesWithNoRows: string[]
  /** Newest stored insight date inside the range, or null when none landed. */
  latestStoredDate: string | null
  result: BackfillResult
  /** Reasons the run is judged FAILED (empty unless result === 'FAILED'). */
  failureReasons: string[]
  /** Non-fatal heads-ups that downgrade COMPLETE to WARNING. */
  warnings: string[]
}

export interface VerifyOptions {
  /** Requested window start (`YYYY-MM-DD`); resolved from the run when omitted. */
  since?: string
  /** Requested window end (`YYYY-MM-DD`); resolved from the run when omitted. */
  until?: string
  /** Today (`YYYY-MM-DD`), used only for the rolling-window fallback range. */
  today: string
  /** Override the stale-tail threshold (days). Test seam; defaults sensibly. */
  staleTailDays?: number
  /** Length of the rolling fallback window when no range can be resolved. */
  rollingWindowDays?: number
}

/** Inclusive list of `YYYY-MM-DD` dates from `since` to `until` (empty if invalid). */
export function enumerateDates(since: string, until: string): string[] {
  const start = Date.parse(`${since}T00:00:00Z`)
  const end = Date.parse(`${until}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return []
  const out: string[] = []
  for (let t = start; t <= end && out.length < MAX_RANGE_DAYS; t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

/** Whole days from `a` to `b` (`b - a`); negative when `b` precedes `a`. */
function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS,
  )
}

/** `until` shifted back `days - 1` so the rolling window is `days` long inclusive. */
function rollingSince(until: string, days: number): string {
  return new Date(Date.parse(`${until}T00:00:00Z`) - (days - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10)
}

function errorsOf(raw: unknown): StructuredSyncError[] {
  return Array.isArray(raw) ? (raw as StructuredSyncError[]) : []
}

/**
 * The latest insight-bearing run whose stored date range COVERS [since, until].
 * "Covers" means `dateRangeStart <= since AND dateRangeEnd >= until`, so a run
 * over a wider window still verifies a narrower requested range. Latest by
 * `startedAt` — a newer failed re-run must not be masked by an older success.
 */
async function findRunCoveringRange(
  db: ReadableDb,
  since: string,
  until: string,
): Promise<RelevantSyncRun | null> {
  const rows = await db
    .select({
      id: schema.syncRuns.id,
      level: schema.syncRuns.level,
      scope: schema.syncRuns.scope,
      status: schema.syncRuns.status,
      dateRangeStart: schema.syncRuns.dateRangeStart,
      dateRangeEnd: schema.syncRuns.dateRangeEnd,
      recordsRequested: schema.syncRuns.recordsRequested,
      recordsWritten: schema.syncRuns.recordsWritten,
      errors: schema.syncRuns.errors,
    })
    .from(schema.syncRuns)
    .where(
      and(
        inArray(schema.syncRuns.level, [...INSIGHT_LEVELS]),
        isNotNull(schema.syncRuns.dateRangeStart),
        isNotNull(schema.syncRuns.dateRangeEnd),
        lte(schema.syncRuns.dateRangeStart, since),
        gte(schema.syncRuns.dateRangeEnd, until),
      ),
    )
    .orderBy(desc(schema.syncRuns.startedAt))
    .limit(1)

  const run = rows[0]
  if (run === undefined) return null
  const errors = errorsOf(run.errors)
  return {
    id: run.id,
    level: run.level,
    scope: run.scope,
    status: run.status,
    dateRangeStart: run.dateRangeStart,
    dateRangeEnd: run.dateRangeEnd,
    recordsRequested: run.recordsRequested,
    recordsWritten: run.recordsWritten,
    errorCount: errors.length,
    failedWindows: errors
      .filter((e) => e.stage === 'insight_window')
      .map((e) => ({ start: e.windowStart, end: e.windowEnd })),
  }
}

/** The date range of the most recent insight-bearing run, for the arg-less default. */
async function latestRunRange(
  db: ReadableDb,
): Promise<{ since: string; until: string } | null> {
  const rows = await db
    .select({
      start: schema.syncRuns.dateRangeStart,
      end: schema.syncRuns.dateRangeEnd,
    })
    .from(schema.syncRuns)
    .where(
      and(
        inArray(schema.syncRuns.level, [...INSIGHT_LEVELS]),
        isNotNull(schema.syncRuns.dateRangeStart),
        isNotNull(schema.syncRuns.dateRangeEnd),
      ),
    )
    .orderBy(desc(schema.syncRuns.startedAt))
    .limit(1)

  const row = rows[0]
  if (row?.start == null || row?.end == null) return null
  return { since: row.start, until: row.end }
}

/** Total insight rows and the distinct dates present inside [since, until]. */
async function storedInRange(
  db: ReadableDb,
  since: string,
  until: string,
): Promise<{ totalRows: number; dates: string[] }> {
  const rows = await db
    .select({ date: schema.dailyAdInsights.date })
    .from(schema.dailyAdInsights)
    .where(
      and(
        gte(schema.dailyAdInsights.date, since),
        lte(schema.dailyAdInsights.date, until),
      ),
    )
  const dates = [...new Set(rows.map((r) => r.date))].sort((a, b) =>
    a.localeCompare(b),
  )
  return { totalRows: rows.length, dates }
}

/**
 * Resolve the requested range from explicit args, else the latest run's range,
 * else a rolling window ending today. `since` alone or `until` alone is completed
 * with the rolling window so a half-specified range still verifies something.
 */
async function resolveRange(
  db: ReadableDb,
  opts: VerifyOptions,
): Promise<{ since: string; until: string; source: RangeSource }> {
  const rollingDays = opts.rollingWindowDays ?? 14
  if (opts.since && opts.until) {
    return { since: opts.since, until: opts.until, source: 'arguments' }
  }
  if (opts.since || opts.until) {
    const until = opts.until ?? opts.today
    const since = opts.since ?? rollingSince(until, rollingDays)
    return { since, until, source: 'arguments' }
  }
  const fromRun = await latestRunRange(db)
  if (fromRun) return { ...fromRun, source: 'latest-sync-run' }
  return {
    since: rollingSince(opts.today, rollingDays),
    until: opts.today,
    source: 'rolling-default',
  }
}

/**
 * Verify the insights backfill for a requested (or resolved) date range and
 * return a structured verdict. Pure over its injected db handle — the CLI adds
 * only connection handling and printing on top.
 */
export async function verifyInsightsBackfill(
  db: ReadableDb,
  opts: VerifyOptions,
): Promise<BackfillVerification> {
  const staleTailDays = opts.staleTailDays ?? STALE_TAIL_DAYS
  const { since, until, source } = await resolveRange(db, opts)

  const run = await findRunCoveringRange(db, since, until)
  const stored = await storedInRange(db, since, until)
  const datesWithRows = stored.dates
  const present = new Set(datesWithRows)
  const datesWithNoRows = enumerateDates(since, until).filter(
    (d) => !present.has(d),
  )
  const latestStoredDate =
    datesWithRows.length > 0 ? datesWithRows[datesWithRows.length - 1] : null

  const failureReasons: string[] = []
  const warnings: string[] = []

  if (run === null) {
    failureReasons.push(
      `no sync run covering ${since}..${until} was found — nothing has attempted this range`,
    )
  } else {
    if (run.status !== 'success') {
      failureReasons.push(
        `the latest run covering this range ended '${run.status}', not 'success'`,
      )
    }
    if (run.errorCount > 0) {
      const windows = run.failedWindows
        .map((w) => `${w.start ?? '?'}..${w.end ?? '?'}`)
        .join(', ')
      failureReasons.push(
        run.failedWindows.length > 0
          ? `the run recorded ${run.errorCount} error(s), including failed window(s): ${windows}`
          : `the run recorded ${run.errorCount} error(s)`,
      )
    }
    if (
      run.recordsRequested !== null &&
      run.recordsWritten !== null &&
      run.recordsRequested !== run.recordsWritten
    ) {
      failureReasons.push(
        `records requested (${run.recordsRequested}) != records written (${run.recordsWritten}) — a window or dimension did not commit`,
      )
    }
  }

  // Warnings only matter once the run itself is sound; a FAILED run is already
  // decided and its stale/empty data is a symptom of the failure, not a warning.
  if (failureReasons.length === 0 && run !== null) {
    if (latestStoredDate === null) {
      warnings.push(
        `the run succeeded but no insight rows are stored in ${since}..${until} — Meta may have returned no delivery for the whole window`,
      )
    } else {
      const tail = daysBetween(latestStoredDate, until)
      if (tail > staleTailDays) {
        warnings.push(
          `the newest stored insight date (${latestStoredDate}) is ${tail} days before the requested end (${until}) — verify Meta has no later delivery to report`,
        )
      }
    }
  }

  const result: BackfillResult =
    failureReasons.length > 0
      ? 'FAILED'
      : warnings.length > 0
        ? 'WARNING'
        : 'COMPLETE'

  return {
    requestedRange: { since, until },
    rangeSource: source,
    syncRun: run,
    recordsRequested: run?.recordsRequested ?? null,
    recordsWritten: run?.recordsWritten ?? null,
    storedRowsInRange: stored.totalRows,
    datesWithRows,
    datesWithNoRows,
    latestStoredDate,
    result,
    failureReasons,
    warnings,
  }
}
