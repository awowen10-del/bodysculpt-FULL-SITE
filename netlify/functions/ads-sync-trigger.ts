/**
 * Netlify entry for the MANUAL "Sync now" trigger (`POST /api/sync-trigger`).
 *
 * Thin wiring only: binds the tested `handleSyncTrigger` orchestrator to the
 * platform + the session secret + the server-side forward to `sync-background`.
 * Session-gated (owner cookie), then it presents the shared `SYNC_TRIGGER_SECRET`
 * to the background function in the `x-sync-trigger` header — the exact hop the
 * nightly `sync-scheduled` cron makes, so the secret never reaches the browser and
 * the write path's auth is unchanged. Returns 202 as soon as the job is accepted;
 * the dashboard polls `/api/sync-status` for the result.
 *
 * Required env: SYNC_TRIGGER_SECRET (v167: no session secret), and the platform URL
 * (Netlify-provided). If the secret or URL is missing the forward is treated as a
 * failure (502) and logged 'misconfigured'.
 */
import {
  handleSyncTrigger,
  type TriggerResult,
} from '../ads/src/server/sync/index.ts'
import { safeErrorFields, type LogEvent } from '../ads/src/server/diagnostics.ts'
import { toEvent, toResponse } from '../ads/src/server/v2.ts'

function log(event: LogEvent): void {
  console.log(`[ads-sync-trigger] ${JSON.stringify(event)}`)
}

/** Forward to the background sync with the shared trigger secret (as cron does). */
async function forwardToBackground(): Promise<TriggerResult> {
  const base =
    process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? process.env.DEPLOY_URL
  const secret = process.env.SYNC_TRIGGER_SECRET
  if (base === undefined || secret === undefined || secret === '') {
    log({
      stage: 'misconfigured',
      flags: {
        hasBase: base !== undefined,
        hasSecret: secret !== undefined && secret !== '',
      },
    })
    return { ok: false, status: 0 }
  }
  const res = await fetch(`${base}/.netlify/functions/ads-sync-background`, {
    method: 'POST',
    headers: { 'x-sync-trigger': secret },
  })
  return { ok: res.ok, status: res.status }
}

// v176: the modern function API (no 4KB env limit) — see ads/src/server/v2.ts
export default async (req: Request): Promise<Response> => {
  const event = await toEvent(req)
  try {
    return toResponse(await handleSyncTrigger({
      event,
      trigger: forwardToBackground,
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
