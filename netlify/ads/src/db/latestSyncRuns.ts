/**
 * Read-back of the most recent `sync_runs` rows with their SANITISED errors.
 *
 * WHY THIS EXISTS
 * ---------------
 * On a failed live-write the CLI prints `sync failed (see sanitised sync_runs
 * errors)` — but until now there was no supported way to actually SEE those
 * errors without hand-writing SQL against production. This reader is that
 * command: it returns the latest runs (any status) and, for each, the
 * already-sanitised structured errors recorded on the row.
 *
 * SANITISED BY CONSTRUCTION. `sync_runs.errors` is written as
 * `StructuredSyncError[]` — every entry sanitised at write time (stage, safe
 * code, redacted single-line message, retry count, optional window dates and a
 * numeric-status cause). This reader RE-PROJECTS each error to that same
 * allow-list, so even a hand-tampered row cannot leak a field the type never
 * had. The run id and the `ad_account_id` UUID are never returned — the account
 * is reduced to a boolean, exactly as the Stage 9 verifier does.
 *
 * READ-ONLY: the single query is a `select`, and callers run it inside a
 * `SET TRANSACTION READ ONLY` transaction so the database itself rejects any
 * write this module might ever grow.
 */
import type { StructuredSyncError, SanitisedCause } from '../types/index.ts'

/**
 * The minimal READ-ONLY SQL capability this reader needs: a tagged-template query
 * function returning typed rows. Declared structurally (never importing the
 * `postgres` driver, which is server-only and boundary-guarded) so any handle —
 * a top-level client or a `SET TRANSACTION READ ONLY` transaction handle —
 * satisfies it. The postgres.js `Sql` and `TransactionSql` handles both do.
 */
export type ReadonlySqlHandle = <Row>(
  strings: TemplateStringsArray,
  ...values: readonly unknown[]
) => Promise<Row>

/** A sync run reduced to the fields that are safe to print. No id, no account. */
export interface SanitisedSyncRun {
  status: string
  level: string
  scope: string
  dateRangeStart: string | null
  dateRangeEnd: string | null
  recordsRequested: number | null
  recordsWritten: number | null
  startedAt: string | null
  /** `ended_at` is set — finalisation ran. */
  finalised: boolean
  /** `ad_account_id` resolved from a committed dimension transaction. */
  adAccountIdPopulated: boolean
  /** The already-sanitised structured errors recorded on the run (may be empty). */
  errors: StructuredSyncError[]
}

/** Re-project one recorded error to the StructuredSyncError allow-list. */
function projectError(raw: unknown): StructuredSyncError | null {
  if (typeof raw !== 'object' || raw === null) return null
  const e = raw as Record<string, unknown>
  const stage = typeof e.stage === 'string' ? e.stage : 'unknown'
  const code = typeof e.code === 'string' ? e.code : 'UNKNOWN'
  const message = typeof e.message === 'string' ? e.message : ''
  const retryCount = typeof e.retryCount === 'number' ? e.retryCount : 0
  const out: StructuredSyncError = { stage, code, message, retryCount }
  if (typeof e.windowStart === 'string') out.windowStart = e.windowStart
  if (typeof e.windowEnd === 'string') out.windowEnd = e.windowEnd
  if (typeof e.cause === 'object' && e.cause !== null) {
    const c = e.cause as Record<string, unknown>
    const kind = c.kind
    if (
      kind === 'network' ||
      kind === 'http' ||
      kind === 'validation' ||
      kind === 'unknown'
    ) {
      const cause: SanitisedCause = { kind }
      if (typeof c.status === 'number') cause.status = c.status
      if (typeof c.retryable === 'boolean') cause.retryable = c.retryable
      if (typeof c.retryCount === 'number') cause.retryCount = c.retryCount
      out.cause = cause
    }
  }
  return out
}

/** Coerce the jsonb `errors` column (null | array) to a sanitised array. */
export function projectErrors(raw: unknown): StructuredSyncError[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(projectError)
    .filter((e): e is StructuredSyncError => e !== null)
}

/**
 * Read the latest `limit` sync runs, newest first, with their sanitised errors.
 * Identifiers come only from this module — `limit` is clamped to a small integer.
 */
export async function readLatestSyncRuns(
  sql: ReadonlySqlHandle,
  limit = 5,
): Promise<SanitisedSyncRun[]> {
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit)))
  const rows = await sql<
    {
      status: string
      level: string
      scope: string
      date_range_start: string | null
      date_range_end: string | null
      records_requested: number | null
      records_written: number | null
      started_at: string | null
      finalised: boolean
      account_populated: boolean
      errors: unknown
    }[]
  >`
    select status, level, scope,
           date_range_start::text        as date_range_start,
           date_range_end::text          as date_range_end,
           records_requested, records_written,
           started_at::text              as started_at,
           (ended_at is not null)        as finalised,
           (ad_account_id is not null)   as account_populated,
           errors
    from sync_runs
    order by started_at desc
    limit ${safeLimit}`

  return rows.map((r) => ({
    status: r.status,
    level: r.level,
    scope: r.scope,
    dateRangeStart: r.date_range_start,
    dateRangeEnd: r.date_range_end,
    recordsRequested: r.records_requested,
    recordsWritten: r.records_written,
    startedAt: r.started_at,
    finalised: r.finalised,
    adAccountIdPopulated: r.account_populated,
    errors: projectErrors(r.errors),
  }))
}
