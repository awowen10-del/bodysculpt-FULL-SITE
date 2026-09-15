/**
 * Serverless orchestrator for the sync freshness endpoint (`GET /api/sync-status`).
 *
 * A single fast read behind the owner session cookie — safe for a synchronous
 * function. Mirrors `handleDailyCheckRead`: GET-only, verify the signed session
 * cookie, open a READ-ONLY connection, read the freshness signal, always close.
 * Kept isolated from the main `DashboardRepository`/parity surface (the same
 * isolation the Daily Ad Check uses) so it never perturbs the core read contract.
 *
 * The response is intentionally raw timestamps + status; the staleness decision
 * (fresh / stale / failed) is a browser-safe pure function shared with the UI
 * (`src/sync/freshness.ts`), so it is testable and identical wherever it renders.
 */
import {
  toApiRequest,
  type NetlifyEvent,
  type NetlifyResult,
} from '../adapter.ts'
import { createOpenAuthenticator } from '../openAuth.ts'
import {
  DEFAULT_DB_TIMEOUT_MS,
  safeErrorFields,
  withTimeout,
  type Logger,
} from '../diagnostics.ts'
import type { SyncStatus } from './readSyncStatus.ts'

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

/** A read-only runtime: reads the freshness signal, then closes. */
export interface SyncStatusRuntime {
  readStatus: () => Promise<SyncStatus>
  close: () => Promise<void>
}

export interface SyncStatusDeps {
  event: NetlifyEvent
  /** v167: kept for call-site compatibility; no secret is read any more. */
  env?: { secret?: string }
  openConnection: (logger: Logger) => SyncStatusRuntime
  logger: Logger
  now?: () => number
  timeoutMs?: number
}

export async function handleSyncStatus(
  deps: SyncStatusDeps,
): Promise<NetlifyResult> {
  const { event, openConnection, logger } = deps
  const timeoutMs = deps.timeoutMs ?? DEFAULT_DB_TIMEOUT_MS

  if (event.httpMethod.toUpperCase() !== 'GET') {
    return errorBody(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.')
  }
  if (!(await isAuthorised(event))) {
    logger({ stage: 'unauthorized', path: '/api/sync-status' })
    return errorBody(401, 'UNAUTHORIZED', 'You are not signed in.')
  }

  const conn = openConnection(logger)
  try {
    const status = await withTimeout(
      conn.readStatus(),
      timeoutMs,
      'sync_status_read',
    )
    return json(200, status)
  } catch (err) {
    logger({ stage: 'error', ...safeErrorFields(err) })
    return errorBody(500, 'INTERNAL', 'Something went wrong.')
  } finally {
    await conn.close().catch(() => {})
  }
}
