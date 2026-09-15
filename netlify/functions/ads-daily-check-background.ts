/**
 * Netlify BACKGROUND entry for Daily Ad Check GENERATE (`POST /api/daily-check/generate`).
 *
 * The `-background` suffix makes Netlify run this asynchronously (up to 15 min) and
 * return 202 immediately — necessary because generation materialises the graph and
 * calls the AI, which exceeds the ~10s synchronous wall. There is no response body;
 * the dashboard card polls the READ endpoint until the new check appears.
 *
 * Thin wiring only: binds the tested generate orchestrator to the platform, the
 * session secret, the write-capable connection, and the Anthropic completor (null
 * when ANTHROPIC_API_KEY is unset → deterministic fallback). All logic lives in
 * `src/server/dailyCheck/*` and is unit-tested.
 *
 * Required env: DAILY_CHECK_DATABASE_URL (or DATABASE_URL), (v167: no login,)
 * ANTHROPIC_API_KEY.
 */
import { createDailyCheckRuntime } from '../ads/src/server/dailyCheck/runtime.ts'
import { runDailyCheckGenerate } from '../ads/src/server/dailyCheck/handleDailyCheck.ts'
import { createAnthropicCompletor } from '../ads/src/server/dailyCheck/anthropic.ts'
import { safeErrorFields, type LogEvent } from '../ads/src/server/diagnostics.ts'
import { toEvent } from '../ads/src/server/v2.ts'
import type { NetlifyEvent } from '../ads/src/server/adapter.ts'

function log(event: LogEvent): void {
  console.log(`[ads-daily-check-bg] ${JSON.stringify(event)}`)
}

// v176: the modern function API (no 4KB env limit) — see ads/src/server/v2.ts
export default async (req: Request): Promise<void> => {
  const event: NetlifyEvent = await toEvent(req)
  try {
    await runDailyCheckGenerate({
      event,
      openConnection: (logger) => createDailyCheckRuntime(logger),
      completor: createAnthropicCompletor(),
      logger: log,
    })
  } catch (err) {
    log({ stage: 'error', ...safeErrorFields(err) })
  }
}
