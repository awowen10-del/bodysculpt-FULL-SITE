/**
 * Serverless orchestrators for the Daily Ad Check endpoints (SERVER-ONLY).
 *
 * Two paths, deliberately split by cost:
 *  - READ (`handleDailyCheckRead`) is a single fast query behind the session cookie;
 *    it runs in a normal synchronous function well under the platform's ~10s wall.
 *  - GENERATE (`runDailyCheckGenerate`) materialises the graph twice and calls the
 *    AI, which exceeds that wall — so it runs in a Netlify BACKGROUND function
 *    (up to 15 min, 202 immediately). It returns no body; the card polls the READ
 *    endpoint until the new check appears.
 *
 * Both verify the signed session cookie and always close the connection in a
 * `finally`. Logs carry only redacted, non-sensitive fields.
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
import { readLatestCheck } from './store.ts'
import { generateDailyCheck } from './generate.ts'
import type { Completor } from './anthropic.ts'
import type { DailyCheckRuntime } from './runtime.ts'

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

// --- READ: latest saved check ------------------------------------------------

export interface ReadDeps {
  event: NetlifyEvent
  /** v167: kept for call-site compatibility; no secret is read any more. */
  env?: { secret?: string }
  openConnection: (logger: Logger) => DailyCheckRuntime
  logger: Logger
  now?: () => number
  timeoutMs?: number
}

export async function handleDailyCheckRead(
  deps: ReadDeps,
): Promise<NetlifyResult> {
  const { event, openConnection, logger } = deps
  const timeoutMs = deps.timeoutMs ?? DEFAULT_DB_TIMEOUT_MS

  if (event.httpMethod.toUpperCase() !== 'GET') {
    return errorBody(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.')
  }
  if (!(await isAuthorised(event))) {
    logger({ stage: 'unauthorized', path: '/api/daily-check' })
    return errorBody(401, 'UNAUTHORIZED', 'You are not signed in.')
  }

  const conn = openConnection(logger)
  try {
    const check = await withTimeout(
      readLatestCheck(conn.db),
      timeoutMs,
      'daily_check_read',
    )
    return json(200, { check })
  } catch (err) {
    logger({ stage: 'error', ...safeErrorFields(err) })
    return errorBody(500, 'INTERNAL', 'Something went wrong.')
  } finally {
    await conn.close().catch(() => {})
  }
}

// --- GENERATE: background pipeline -------------------------------------------

/** Generous ceiling so a hung AI/DB call can't run the full 15-min background budget. */
export const GENERATE_TIMEOUT_MS = 120_000

export interface GenerateDeps {
  event: NetlifyEvent
  /** v167: kept for call-site compatibility; no secret is read any more. */
  env?: { secret?: string }
  openConnection: (logger: Logger) => DailyCheckRuntime
  /** The AI completor, or null to force the deterministic fallback. */
  completor: Completor | null
  logger: Logger
  now?: () => number
  timeoutMs?: number
}

/**
 * Run the generation pipeline. A background function's HTTP response (202) is fixed
 * by the platform, so this returns nothing meaningful to the client — it only does
 * the work, logs a redacted outcome, and always closes the connection. Every
 * failure is swallowed into a log line (never thrown to the platform).
 */
export async function runDailyCheckGenerate(deps: GenerateDeps): Promise<void> {
  const { event, openConnection, completor, logger } = deps
  const timeoutMs = deps.timeoutMs ?? GENERATE_TIMEOUT_MS

  if (event.httpMethod.toUpperCase() !== 'POST') {
    logger({ stage: 'error', code: 'METHOD_NOT_ALLOWED' })
    return
  }
  if (!(await isAuthorised(event))) {
    logger({ stage: 'unauthorized', path: '/api/daily-check/generate' })
    return
  }

  const conn = openConnection(logger)
  try {
    const record = await withTimeout(
      generateDailyCheck({
        repository: conn.repository,
        db: conn.db,
        completor,
        onFallback: (reason) =>
          logger({ stage: 'error', code: 'AI_FALLBACK', message: reason }),
      }),
      timeoutMs,
      'daily_check_generate',
    )
    logger({ stage: 'request_complete', path: '/api/daily-check/generate' })
    void record
  } catch (err) {
    logger({ stage: 'error', ...safeErrorFields(err) })
  } finally {
    await conn.close().catch(() => {})
  }
}
