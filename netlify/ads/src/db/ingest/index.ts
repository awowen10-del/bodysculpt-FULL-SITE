/**
 * Stage 6 ingestion orchestrator — the offline write layer.
 *
 * Takes Stage 5 normalised objects and persists them idempotently, resolving Meta
 * ids to UUIDs, in FK-safe order, with deterministic date-window transactions and
 * honest partial-failure handling. NO live fetching, NO live connection here — it
 * operates on any Drizzle handle (PGlite in tests; the runtime client in prod).
 *
 * Transaction shape:
 *  - the `sync_runs` row is created FIRST, outside all data transactions;
 *  - the whole dimension graph is upserted in ONE transaction;
 *  - each daily-insight window is its OWN transaction (a failed window rolls back
 *    only itself; successful windows stay committed);
 *  - the final `sync_runs` status is ALWAYS attempted.
 *
 * Status: success = every intended write committed (incl. the empty-valid run);
 * partial = ≥1 window committed AND ≥1 failed; failed = dimension txn failed, or
 * ≥1 window intended but none committed, or a fatal error.
 */
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type {
  IngestInput,
  IngestRunMeta,
  IngestResult,
  StructuredSyncError,
  SyncRunStatus,
  WindowOutcome,
} from '../../types/index.ts'
import type { DimensionMaps } from './upsertDimensions.ts'
import type { InsightWindow } from './windows.ts'
import { startRun, finishRun } from '../syncRuns.ts'
import { upsertDimensions } from './upsertDimensions.ts'
import { upsertInsightWindow } from './upsertInsights.ts'
import {
  groupInsightsIntoWindows,
  DEFAULT_INSIGHT_WINDOW_DAYS,
} from './windows.ts'
import {
  withRetry,
  toStructuredError,
  type RetryOptions,
  type RetryOutcome,
} from './dbErrors.ts'
import { dedupeByKey } from './resolveIds.ts'

export interface IngestOptions {
  /** Deterministic insight window size in calendar days (default 7). */
  windowDays?: number
  /** Total attempts per transaction, including the first (default 3). */
  maxRetryAttempts?: number
  /** Injectable sleep so tests never actually wait. */
  sleep?: (ms: number) => Promise<void>
  /** Injectable backoff (ms) before the next attempt (1-indexed). */
  backoffMs?: (attempt: number) => number
}

// Unambiguous dedupe key for an insight row; JSON encoding avoids any
// separator-collision between the ad id and the date.
const INSIGHT_KEY = (i: { metaAdId: string; date: string }): string =>
  JSON.stringify([i.metaAdId, i.date])

function distinctDimensionCount(input: IngestInput): number {
  return (
    dedupeByKey(input.adAccounts, (a) => a.metaAdAccountId).length +
    dedupeByKey(input.campaigns, (c) => c.metaCampaignId).length +
    dedupeByKey(input.adSets, (s) => s.metaAdSetId).length +
    dedupeByKey(input.creatives, (c) => c.metaCreativeId).length +
    dedupeByKey(input.ads, (a) => a.metaAdId).length
  )
}

// --- reusable write primitives (the ONE write path) ------------------------
//
// Both the standalone ingest() below and the Stage 7 orchestrator compose these,
// so there is a single ingestion implementation.

/** Upsert the complete dimension graph in one transaction (bounded retry). */
export function writeDimensions<
  Q extends PgQueryResultHKT,
  S extends Record<string, unknown>,
>(
  db: PgDatabase<Q, S>,
  input: IngestInput,
  retryOptions: RetryOptions = {},
): Promise<RetryOutcome<DimensionMaps>> {
  return withRetry(
    () => db.transaction((tx) => upsertDimensions(tx, input)),
    retryOptions,
  )
}

/** Upsert one insight window in its own transaction (bounded retry). */
export function writeInsightWindow<
  Q extends PgQueryResultHKT,
  S extends Record<string, unknown>,
>(
  db: PgDatabase<Q, S>,
  window: InsightWindow,
  maps: DimensionMaps,
  retryOptions: RetryOptions = {},
): Promise<RetryOutcome<number>> {
  return withRetry(
    () => db.transaction((tx) => upsertInsightWindow(tx, window, maps)),
    retryOptions,
  )
}

/** Combined status rule shared by ingest() and the orchestrator. */
export function computeRunStatus(
  dimensionsCommitted: boolean,
  windowStatuses: readonly ('success' | 'failed')[],
): SyncRunStatus {
  if (!dimensionsCommitted) return 'failed'
  if (windowStatuses.length === 0) return 'success'
  const failed = windowStatuses.filter((s) => s === 'failed').length
  const succeeded = windowStatuses.length - failed
  if (failed === 0) return 'success'
  if (succeeded === 0) return 'failed'
  return 'partial'
}

export async function ingest<
  Q extends PgQueryResultHKT,
  S extends Record<string, unknown>,
>(
  db: PgDatabase<Q, S>,
  input: IngestInput,
  meta: IngestRunMeta,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const windowDays = options.windowDays ?? DEFAULT_INSIGHT_WINDOW_DAYS
  const retryOptions: RetryOptions = {
    maxAttempts: options.maxRetryAttempts,
    sleep: options.sleep,
    backoffMs: options.backoffMs,
  }

  // Deduplicate insights by (ad, date) once, before retries, for counting.
  const dedupedInsights = dedupeByKey(input.insights, INSIGHT_KEY)
  const recordsRequested =
    distinctDimensionCount(input) + dedupedInsights.length

  // The run row is created outside every data transaction, under the same
  // bounded transient-retry policy as the data writes below.
  const syncRunId = await startRun(db, meta, retryOptions)

  const errors: StructuredSyncError[] = []
  const windows: WindowOutcome[] = []
  let recordsWritten = 0
  let status: SyncRunStatus = 'failed'

  try {
    const insightWindows = groupInsightsIntoWindows(dedupedInsights, windowDays)

    const dimResult = await writeDimensions(db, input, retryOptions)

    if (!dimResult.ok) {
      errors.push(
        toStructuredError('dimensions', dimResult.error, {
          retryCount: dimResult.attempts - 1,
        }),
      )
      status = 'failed'
    } else {
      recordsWritten += dimResult.value.written
      const maps = dimResult.value

      for (const window of insightWindows) {
        const result = await writeInsightWindow(db, window, maps, retryOptions)
        if (result.ok) {
          recordsWritten += result.value
          windows.push({
            start: window.start,
            end: window.end,
            status: 'success',
            written: result.value,
          })
        } else {
          errors.push(
            toStructuredError('insight_window', result.error, {
              windowStart: window.start,
              windowEnd: window.end,
              retryCount: result.attempts - 1,
            }),
          )
          windows.push({
            start: window.start,
            end: window.end,
            status: 'failed',
            written: 0,
          })
        }
      }

      status = computeRunStatus(
        true,
        windows.map((w) => w.status),
      )
    }
  } catch (error) {
    // Fatal/unexpected (e.g. invalid request): record and fail — never leave running.
    errors.push(toStructuredError('ingest', error, { retryCount: 0 }))
    status = 'failed'
  }

  // The final status update is always attempted.
  await finishRun(db, syncRunId, {
    status,
    recordsRequested,
    recordsWritten,
    errors,
  })

  return {
    syncRunId,
    status,
    recordsRequested,
    recordsWritten,
    windows,
    errors,
  }
}
