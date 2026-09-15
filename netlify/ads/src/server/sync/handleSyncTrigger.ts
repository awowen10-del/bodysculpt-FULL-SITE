/**
 * Serverless orchestrator for the MANUAL "Sync now" trigger (`POST /api/sync-trigger`).
 *
 * The dashboard's "Sync now" button hits this. It is the owner-facing twin of the
 * nightly `sync-scheduled` cron: verify the request is the signed-in owner, then
 * forward to the write-heavy `sync-background` function so the SAME live-write the
 * cron uses runs on demand. It returns as soon as the background function accepts
 * the job (202) — the browser then polls `/api/sync-status` for the result.
 *
 * WHY A SEPARATE FUNCTION (not the browser calling sync-background directly): the
 * write path is locked to the shared `SYNC_TRIGGER_SECRET` and must stay that way.
 * The secret never reaches the browser — this session-gated endpoint holds it and
 * forwards it server-side, exactly as `sync-scheduled` does for cron. So the audited
 * write path's auth is unchanged; only this thin, session-checked hop can start it.
 *
 * Never throws: a forward failure is logged with safe fields and reported as 502 so
 * the button can show a plain-English "couldn't start" without leaking anything.
 */
import {
  toApiRequest,
  type NetlifyEvent,
  type NetlifyResult,
} from '../adapter.ts'
import { createOpenAuthenticator } from '../openAuth.ts'
import { safeErrorFields, type Logger } from '../diagnostics.ts'

const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
}

function json(status: number, body: unknown): NetlifyResult {
  return {
    statusCode: status,
    headers: { ...JSON_HEADERS },
    body: JSON.stringify(body),
  }
}

function errorBody(
  status: number,
  code: string,
  message: string,
): NetlifyResult {
  return json(status, { error: { code, message } })
}

/** v167: the dashboard has no login; the seam answers 'owner' (see openAuth.ts). */
async function isAuthorised(event: NetlifyEvent): Promise<boolean> {
  const auth = createOpenAuthenticator()
  return (await auth.authenticate(toApiRequest(event))) !== null
}

/** Outcome of the server-side forward to the background function. */
export interface TriggerResult {
  ok: boolean
  /** The HTTP status the background function replied with (202 = accepted). */
  status: number
}

export interface SyncTriggerDeps {
  event: NetlifyEvent
  /** v167: kept for call-site compatibility; no secret is read any more. */
  env?: { secret?: string }
  /**
   * Forwards to `sync-background` (with the shared trigger secret). Injected so the
   * whole outcome matrix is testable without a network call. Should not throw; a
   * thrown value is caught here and reported as a 502.
   */
  trigger: () => Promise<TriggerResult>
  logger: Logger
  now?: () => number
}

/**
 * Handle a manual sync request. POST-only, owner-session-gated; forwards to the
 * background sync and reports whether it was accepted. Resolves to a NetlifyResult
 * — it never throws.
 */
export async function handleSyncTrigger(
  deps: SyncTriggerDeps,
): Promise<NetlifyResult> {
  const { event, trigger, logger } = deps

  if (event.httpMethod.toUpperCase() !== 'POST') {
    return errorBody(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.')
  }
  if (!(await isAuthorised(event))) {
    logger({ stage: 'unauthorized', path: '/api/sync-trigger' })
    return errorBody(401, 'UNAUTHORIZED', 'You are not signed in.')
  }

  let result: TriggerResult
  try {
    result = await trigger()
  } catch (err) {
    logger({ stage: 'trigger_failed', ...safeErrorFields(err) })
    return errorBody(502, 'TRIGGER_FAILED', 'Could not start the sync.')
  }

  // A background function replies 202 immediately; anything else means the job did
  // not land (misconfigured secret/URL, the function is down, …).
  if (!result.ok) {
    logger({ stage: 'trigger_rejected', status: result.status })
    return errorBody(502, 'TRIGGER_FAILED', 'Could not start the sync.')
  }

  logger({ stage: 'triggered', status: result.status })
  return json(202, { started: true })
}
