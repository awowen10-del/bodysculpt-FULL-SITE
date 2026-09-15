/**
 * Serverless request orchestrator for the read API (Stage 11E hotfix).
 *
 * Extracted from the Netlify function so the full request lifecycle — auth, connect
 * (probe), route, timeout, redacted logging and connection cleanup — is
 * unit-testable with an injected connection. The function file is now thin wiring.
 *
 * Guarantees: an unauthenticated request opens NO connection; a stalled connect or
 * query is abandoned after `timeoutMs` and returns a safe 500 (well under the
 * platform limit); the connection is ALWAYS closed in a `finally`; logs carry only
 * redacted, non-sensitive fields.
 */
import {
  errorResult,
  normaliseApiPath,
  toApiRequest,
  toNetlifyResult,
  type NetlifyEvent,
  type NetlifyResult,
} from './adapter.ts'
import { createOpenAuthenticator } from './openAuth.ts'
import { createApiRouter } from './router.ts'
import type { DashboardRepository } from '../data/index.ts'
import {
  DEFAULT_DB_TIMEOUT_MS,
  safeErrorFields,
  withTimeout,
  type Logger,
} from './diagnostics.ts'

/** A live runtime connection + its lifecycle hooks (injected; PGlite/fake in tests). */
export interface RuntimeConn {
  repository: DashboardRepository
  probe: () => Promise<void>
  close: () => Promise<void>
}

export interface HandleApiDeps {
  event: NetlifyEvent
  /** v167: kept for call-site compatibility; no secret or password is read any more. */
  env?: { secret?: string; password?: string }
  /**
   * Opens a fresh connection, called ONLY for an authenticated read. The `logger`
   * is passed through so `materializeDataset` emits per-query diagnostics on the
   * same stream.
   */
  openConnection: (logger: Logger) => RuntimeConn
  logger: Logger
  now?: () => number
  timeoutMs?: number
}

export async function handleApiEvent(
  deps: HandleApiDeps,
): Promise<NetlifyResult> {
  const { event, openConnection, logger } = deps
  const now = deps.now ?? (() => Date.now())
  const timeoutMs = deps.timeoutMs ?? DEFAULT_DB_TIMEOUT_MS
  const startedAt = now()
  const elapsed = () => now() - startedAt
  const path = normaliseApiPath(event.path)

  logger({ stage: 'entry', method: event.httpMethod, path })

  // --- login / logout / method (no database) ---
  // v167: no /api/login or /api/logout — the dashboard has no login (openAuth.ts).
  if (event.httpMethod !== 'GET') {
    return errorResult(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.')
  }

  // --- authenticate BEFORE opening a database connection ---
  const authenticator = createOpenAuthenticator()
  const apiReq = toApiRequest(event)
  if ((await authenticator.authenticate(apiReq)) === null) {
    logger({ stage: 'unauthorized', path, ms: elapsed() })
    return errorResult(401, 'UNAUTHORIZED', 'Authentication is required.', {
      'cache-control': 'no-store',
    })
  }
  logger({ stage: 'auth_ok', path, ms: elapsed() })

  // --- authenticated read: open, probe, route, always close ---
  // `conn` is opened INSIDE the try so a throw from `openConnection` itself
  // (e.g. a missing/invalid DATABASE_URL) is caught here and returned as a safe
  // JSON 500 — never an uncaught rejection the platform turns into a raw 502.
  logger({ stage: 'db_connect_start', path, ms: elapsed() })
  let conn: RuntimeConn | undefined
  try {
    conn = openConnection(logger)
    await withTimeout(conn.probe(), timeoutMs, 'connect')
    logger({ stage: 'db_established', path, ms: elapsed() })

    const router = createApiRouter({
      repository: conn.repository,
      authenticator,
      // Surface a repository/router 500 (e.g. a Postgres error the router
      // swallows into a generic 500) as a redacted `error` stage.
      logger: (e) =>
        logger({ stage: 'error', name: e.errorName, code: e.code }),
    })
    const res = await withTimeout(router.handle(apiReq), timeoutMs, 'query')

    // Time + size the serialisation explicitly: a large /creatives body is a
    // candidate cause (Netlify's 6 MB response cap), so `bytes` is logged safely.
    const serializeStart = now()
    const netlify = toNetlifyResult(res)
    logger({
      stage: 'response_serialized',
      path,
      status: res.status,
      bytes: netlify.body.length,
      ms: now() - serializeStart,
    })
    logger({
      stage: 'request_complete',
      path,
      status: res.status,
      ms: elapsed(),
    })
    return netlify
  } catch (err) {
    logger({ stage: 'error', path, ms: elapsed(), ...safeErrorFields(err) })
    return errorResult(500, 'INTERNAL', 'Something went wrong.', {
      'cache-control': 'no-store',
    })
  } finally {
    try {
      await conn?.close()
    } catch {
      // The connection may already be gone; closing must never mask the result.
    }
    logger({ stage: 'db_close', path, ms: elapsed() })
  }
}
