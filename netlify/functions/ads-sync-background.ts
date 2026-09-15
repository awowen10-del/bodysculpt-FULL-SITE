/**
 * Netlify BACKGROUND entry for the SCHEDULED SYNC.
 *
 * The `-background` suffix makes Netlify run this asynchronously (202 immediately,
 * up to 15 min) — necessary because a live-write fetches from Meta across windows
 * and upserts the graph, which can exceed the 30s scheduled-function wall. It is
 * INVOKED by `sync-scheduled` (the cron trigger), not by the dashboard.
 *
 * A background function is reachable at its own public URL, and this one WRITES to
 * production — so it refuses to run unless the caller presents the shared
 * `SYNC_TRIGGER_SECRET` in the `x-sync-trigger` header. All sync logic lives in
 * `src/server/sync/*` and is unit-tested; this is thin wiring only.
 *
 * A non-success is never silent: it is written to the `sync_runs` row and mirrored
 * into these function logs, and the dashboard's "Data current to …" indicator turns
 * amber/red off the same state — so no chat webhook is needed.
 *
 * Required env:
 *   SYNC_SCHEDULE_ENABLED=1   — deliberate write opt-in (off = no-op)
 *   SYNC_TRIGGER_SECRET       — shared secret the scheduled trigger must present
 *   SYNC_DATABASE_URL         — write-capable role (falls back to DATABASE_URL)
 *   META_ACCESS_TOKEN, META_AD_ACCOUNT_ID — the System User token + account
 */
import { createSyncConnection } from '../ads/src/db/client.ts'
import { getRuntimeMetaConfig } from '../ads/src/meta/runtimeConfig.ts'
import { runScheduledSync, type SyncLog } from '../ads/src/server/sync/index.ts'
import type { NetlifyEvent } from '../ads/src/server/adapter.ts'

const log: SyncLog = (event) =>
  console.log(`[ads-sync-bg] ${JSON.stringify(event)}`)

/** True when the request presents the shared trigger secret. */
function authorised(event: NetlifyEvent): boolean {
  const expected = process.env.SYNC_TRIGGER_SECRET
  if (expected === undefined || expected === '') return false
  return event.headers['x-sync-trigger'] === expected
}

export const handler = async (event: NetlifyEvent): Promise<void> => {
  if (!authorised(event)) {
    log({ stage: 'unauthorized' })
    return
  }
  try {
    const outcome = await runScheduledSync({
      env: process.env,
      openConnection: () => {
        const conn = createSyncConnection()
        return { db: conn.db, close: conn.close }
      },
      metaConfig: () => getRuntimeMetaConfig(),
      fetchImpl: fetch,
      todayIso: new Date().toISOString().slice(0, 10),
      logger: log,
    })
    log({ stage: 'complete', ...outcome })
  } catch (err) {
    // runScheduledSync is designed not to throw; this is the last-resort backstop
    // so no exception escapes to the platform. Redacted fields only.
    log({
      stage: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
