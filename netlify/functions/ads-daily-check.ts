/**
 * Netlify entry for the Daily Ad Check READ endpoint (`GET /api/daily-check`).
 *
 * Thin wiring only: binds the tested read orchestrator to the platform + the
 * session secret + a redacted console logger. Fast single query behind the owner
 * session cookie — safe for a synchronous function. All logic lives in
 * `src/server/dailyCheck/*` and is unit-tested.
 *
 * Required env: DAILY_CHECK_DATABASE_URL (or DATABASE_URL). v167: no login.
 */
import { createDailyCheckRuntime } from '../ads/src/server/dailyCheck/runtime.ts'
import { handleDailyCheckRead } from '../ads/src/server/dailyCheck/handleDailyCheck.ts'
import { safeErrorFields, type LogEvent } from '../ads/src/server/diagnostics.ts'
import type { NetlifyEvent, NetlifyResult } from '../ads/src/server/adapter.ts'

function log(event: LogEvent): void {
  console.log(`[ads-daily-check] ${JSON.stringify(event)}`)
}

export const handler = async (event: NetlifyEvent): Promise<NetlifyResult> => {
  try {
    return await handleDailyCheckRead({
      event,
      openConnection: (logger) => createDailyCheckRuntime(logger),
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
