/**
 * `sync_runs` lifecycle helpers (Stage 6).
 *
 * The run row is created and updated with the TOP-LEVEL db handle, OUTSIDE all
 * data transactions, so a rolled-back data transaction still leaves a recordable
 * `failed` row. `startRun` inserts a `running` row; `finishRun` writes a terminal
 * status exactly once. Terminal states must not be reopened by callers.
 */
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { syncRuns } from './schema/index.ts'
import { withRetry, type RetryOptions } from './ingest/dbErrors.ts'
import type {
  IngestRunMeta,
  StructuredSyncError,
  SyncRunStatus,
} from '../types/index.ts'

/**
 * Insert a `running` row (outside any data transaction) and return its id.
 *
 * This is the FIRST database round-trip of a live write, and it fails exactly
 * like the main write path does: the Supavisor pooler can drop a freshly-handed
 * connection (CONNECTION_CLOSED / CONNECTION_DESTROYED / CONNECTION_ENDED, or a
 * CONNECT_TIMEOUT while establishing). Those are TRANSIENT driver faults — the
 * same set `classifyDbError` already retries for dimension/insight writes — so
 * the run-row insert is wrapped in the SAME bounded `withRetry`. Before this,
 * `run_start` had no retry at all and a single blip surfaced as the terminal
 * `RUN_START_FAILED`, having written nothing.
 *
 * Idempotent under retry: the id is generated CLIENT-SIDE and the insert is
 * `ON CONFLICT DO NOTHING`. If an attempt COMMITTED the row but the connection
 * dropped before its acknowledgement reached us, the retry re-runs the very same
 * keyed insert, hits the primary key, no-ops, and returns the same id — so a
 * lost-ack never produces a duplicate `running` row. (Relying on the DB's
 * `defaultRandom()` would instead mint a fresh UUID on every attempt and leak a
 * duplicate on exactly that race.)
 *
 * A NON-transient failure (NOT NULL, permission, …) is not retried: `withRetry`
 * returns on the first attempt and the ORIGINAL error is re-thrown, so the
 * orchestrator still wraps it as the fail-loud `RUN_START_FAILED` it does today.
 */
export async function startRun<
  Q extends PgQueryResultHKT,
  S extends Record<string, unknown>,
>(
  db: PgDatabase<Q, S>,
  meta: IngestRunMeta,
  retryOptions: RetryOptions = {},
): Promise<string> {
  const id = randomUUID()
  const outcome = await withRetry(async () => {
    await db
      .insert(syncRuns)
      .values({
        id,
        level: meta.level,
        scope: meta.scope,
        dateRangeStart: meta.dateRangeStart ?? null,
        dateRangeEnd: meta.dateRangeEnd ?? null,
        status: 'running',
      })
      .onConflictDoNothing()
    return id
  }, retryOptions)
  if (!outcome.ok) throw outcome.error
  return outcome.value
}

export interface RunOutcome {
  status: SyncRunStatus
  recordsRequested: number
  recordsWritten: number
  errors: StructuredSyncError[]
  /** Sanitised aggregate rate-limit allow-list (Stage 7); null/omitted otherwise. */
  rateLimitInfo?: unknown
  /**
   * The internal ad-account UUID this run touched (Stage 9), or null/omitted.
   *
   * `startRun` CANNOT set this: the run row is created before the first Meta
   * request, so no account has been fetched, let alone resolved to a UUID. A
   * `running` row therefore always has `ad_account_id = NULL`, and that is
   * correct — the account genuinely is not yet known.
   *
   * Callers MUST pass a UUID only from a dimension transaction that COMMITTED.
   * A UUID read from a rolled-back transaction refers to a row that does not
   * exist, and attaching it would point the run row at a phantom account (and,
   * with the FK below, fail outright).
   */
  adAccountId?: string | null
}

/**
 * Write the terminal status/counts/errors for a run (outside any data txn).
 *
 * NOTE: `sync_runs.ad_account_id` FKs to `ad_accounts.id` with ON DELETE RESTRICT,
 * so a populated run row PINS its account row against deletion. This is why
 * `src/db/rollback.ts` must detach these references before deleting the account.
 */
export async function finishRun<
  Q extends PgQueryResultHKT,
  S extends Record<string, unknown>,
>(db: PgDatabase<Q, S>, runId: string, outcome: RunOutcome): Promise<void> {
  await db
    .update(syncRuns)
    .set({
      status: outcome.status,
      endedAt: sql`now()`,
      recordsRequested: outcome.recordsRequested,
      recordsWritten: outcome.recordsWritten,
      errors: outcome.errors.length > 0 ? outcome.errors : null,
      rateLimitInfo: outcome.rateLimitInfo ?? null,
      adAccountId: outcome.adAccountId ?? null,
      updatedAt: sql`now()`,
    })
    .where(eq(syncRuns.id, runId))
}
