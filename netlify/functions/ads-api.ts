/**
 * Netlify Functions entry for the read API (Stage 11E; hotfixed for the pooler
 * timeout). Thin wiring only: it binds the tested orchestrator (`handleApiEvent`)
 * to the platform + secrets + a redacted console logger. All logic, timeouts and
 * cleanup live in `src/server/*` and are unit-tested.
 *
 * Required env (Netlify environment variables, never committed):
 * - DATABASE_URL       — Supavisor TRANSACTION pooler (6543), read-only role.
 * (v167: no session secret or password — the dashboard has no login.)
 */
import { createRuntimeReadRepository } from '../ads/src/server/runtime.ts'
import { handleApiEvent } from '../ads/src/server/handleEvent.ts'
import { safeErrorFields, type LogEvent } from '../ads/src/server/diagnostics.ts'
import type { NetlifyEvent, NetlifyResult } from '../ads/src/server/adapter.ts'

/** Structured, redacted log line — safe fields only (never secrets/cookies/body). */
function log(event: LogEvent): void {
  console.log(`[ads-api] ${JSON.stringify(event)}`)
}

/**
 * Netlify entry. `handleApiEvent` already returns a safe JSON result for every
 * request it can process, but this FINAL catch is the backstop required so NO
 * uncaught exception ever escapes to the platform as a raw 502/text-plain: any
 * throw is logged with redacted fields and returned as a client-readable JSON 500.
 * (A hard timeout or OOM is a platform kill this cannot catch — those are
 * diagnosed by the absence of a `rows_assembled` / `response_serialized` log.)
 */
export const handler = async (event: NetlifyEvent): Promise<NetlifyResult> => {
  try {
    return await handleApiEvent({
      event,
      openConnection: (logger) => createRuntimeReadRepository(logger),
      logger: log,
    })
  } catch (err) {
    log({ stage: 'error', ...safeErrorFields(err) })
    return {
      statusCode: 500,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: JSON.stringify({
        error: { code: 'INTERNAL', message: 'Something went wrong.' },
      }),
    }
  }
}
