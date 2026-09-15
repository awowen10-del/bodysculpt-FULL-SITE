/**
 * Read the dashboard freshness signal from `sync_runs` — READ-ONLY.
 *
 * Powers the "Data current to …" indicator: the completion time of the most
 * recent SUCCESSFUL sync (what the visible data is current to), plus the status
 * of the most recent run of ANY outcome (so a silent overnight failure — a run
 * that started and failed, or never advanced — is visible, not just invisible
 * staleness).
 *
 * SANITISED BY CONSTRUCTION: it selects only timestamps (as ISO text) and the
 * status string. No id, account uuid, url, token, error payload or row value can
 * appear. Callers run it inside a `SET TRANSACTION READ ONLY` transaction so the
 * database itself rejects any write this module might ever grow.
 */

/**
 * The minimal READ-ONLY SQL capability this reader needs: a tagged-template query
 * returning typed rows. Declared structurally (never importing the server-only
 * `postgres` driver) so any handle — a client or a read-only transaction handle —
 * satisfies it, and tests can pass a fake.
 */
export type SyncStatusSqlHandle = <Row>(
  strings: TemplateStringsArray,
  ...values: readonly unknown[]
) => Promise<Row>

/** The freshness signal. All fields null when no run has ever been recorded. */
export interface SyncStatus {
  /** `ended_at` of the most recent successful, finalised run (ISO string). */
  lastSuccessAt: string | null
  /** `status` of the most recent run of any outcome. */
  lastRunStatus: string | null
  /** `started_at` of the most recent run of any outcome (ISO string). */
  lastRunStartedAt: string | null
  /** `ended_at` of the most recent run of any outcome (ISO string, null if running). */
  lastRunEndedAt: string | null
}

/**
 * Read the freshness signal in a single round-trip. The scalar sub-selects each
 * touch the `idx_sync_runs_started_at` / `status` indexes, so this stays cheap
 * even as `sync_runs` grows.
 */
export async function readSyncStatus(
  sql: SyncStatusSqlHandle,
): Promise<SyncStatus> {
  const rows = await sql<
    {
      last_success_at: string | null
      last_run_status: string | null
      last_run_started_at: string | null
      last_run_ended_at: string | null
    }[]
  >`
    select
      (select ended_at::text
         from sync_runs
        where status = 'success' and ended_at is not null
        order by ended_at desc
        limit 1)                              as last_success_at,
      (select status
         from sync_runs
        order by started_at desc
        limit 1)                              as last_run_status,
      (select started_at::text
         from sync_runs
        order by started_at desc
        limit 1)                              as last_run_started_at,
      (select ended_at::text
         from sync_runs
        order by started_at desc
        limit 1)                              as last_run_ended_at`

  const row = rows[0]
  return {
    lastSuccessAt: row?.last_success_at ?? null,
    lastRunStatus: row?.last_run_status ?? null,
    lastRunStartedAt: row?.last_run_started_at ?? null,
    lastRunEndedAt: row?.last_run_ended_at ?? null,
  }
}
