/**
 * Read-only runtime wiring for the sync freshness endpoint (SERVER-ONLY).
 *
 * The ONE module in this feature that reaches a live database handle. It uses the
 * strictly read-only `createRuntimeConnection` (the deployed API's `DATABASE_URL`
 * role) and runs `readSyncStatus` inside a `SET TRANSACTION READ ONLY` block, so
 * the database itself rejects any write — the same double guard the manual
 * `db:latest-run` diagnostic uses.
 *
 * NOTE: the read-only role must be granted `SELECT` on `sync_runs` (it is not in
 * the original dashboard grant set). See docs/STAGE-12-SCHEDULED-SYNC.md.
 *
 * Reads/validates `DATABASE_URL` at CALL time; the caller MUST `close()`.
 */
import { createRuntimeConnection } from '../../db/client.ts'
import {
  readSyncStatus,
  type SyncStatus,
  type SyncStatusSqlHandle,
} from './readSyncStatus.ts'
import type { SyncStatusRuntime } from './handleSyncStatus.ts'

export function createSyncStatusRuntime(): SyncStatusRuntime {
  const conn = createRuntimeConnection()
  return {
    readStatus: (): Promise<SyncStatus> =>
      conn.sql.begin(async (tx) => {
        await tx`set transaction read only`
        return readSyncStatus(tx as unknown as SyncStatusSqlHandle)
      }) as Promise<SyncStatus>,
    close: conn.close,
  }
}
