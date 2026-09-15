/**
 * Netlify entry for the sync freshness endpoint (`GET /api/sync-status`).
 *
 * Thin wiring only: binds the tested read orchestrator to the platform + the
 * session secret + a redacted console logger. Fast single read behind the owner
 * session cookie. All logic lives in `src/server/sync/*` and is unit-tested.
 *
 * Required env: DATABASE_URL (read-only role, granted SELECT on sync_runs),
 * (v167: no session secret — the dashboard has no login).
 */
import { createSyncStatusRuntime } from '../ads/src/server/sync/statusRuntime.ts'
import { handleSyncStatus } from '../ads/src/server/sync/index.ts'
import { safeErrorFields, type LogEvent } from '../ads/src/server/diagnostics.ts'
import { toEvent, toResponse } from '../ads/src/server/v2.ts'

function log(event: LogEvent): void {
  console.log(`[ads-sync-status] ${JSON.stringify(event)}`)
}

// v176: the modern function API (no 4KB env limit) — see ads/src/server/v2.ts
export default async (req: Request): Promise<Response> => {
  const event = await toEvent(req)
  try {
    return toResponse(await handleSyncStatus({
      event,
      openConnection: () => createSyncStatusRuntime(),
      logger: log,
    }))
  } catch (err) {
    log({ stage: 'error', ...safeErrorFields(err) })
    return toResponse({
      statusCode: 500,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: JSON.stringify({
        error: { code: 'INTERNAL', message: 'Something went wrong.' },
      }),
    })
  }
}
