/**
 * Serverless request diagnostics (Stage 11E hotfix).
 *
 * A small, redacted logging contract plus a hard timeout guard so a stalled
 * database connection or query fails FAST with a diagnosable stage, instead of
 * hanging until the platform kills the function.
 *
 * SAFE LOGGING RULE: events carry only non-sensitive fields (stage, method, path,
 * status, and a sanitised error name/code/message). They NEVER carry
 * `DATABASE_URL`, passwords, cookies, tokens, request bodies or query strings.
 */

/** Ordered lifecycle stages a request passes through. */
export type LogStage =
  | 'entry'
  | 'auth_ok'
  | 'unauthorized'
  | 'db_connect_start'
  | 'db_established'
  | 'query_start'
  | 'query_complete'
  | 'query_error'
  | 'materialize_summary'
  // Per-request work stages (timed) — pinpoint WHERE a slow /creatives request
  // spends its budget: materialise (repository_loaded) vs the synchronous
  // creative assembly (rows_assembled) vs JSON serialisation (response_serialized).
  | 'repository_loaded'
  | 'rows_assembled'
  | 'response_serialized'
  | 'request_complete'
  | 'error'
  | 'db_close'
  // Manual "Sync now" trigger (`/api/sync-trigger`): it forwarded to the background
  // sync (triggered), the forward was rejected/threw (trigger_rejected /
  // trigger_failed), or the secret/URL was missing (misconfigured).
  | 'triggered'
  | 'trigger_rejected'
  | 'trigger_failed'
  | 'misconfigured'

export interface LogEvent {
  stage: LogStage
  /** Safe route metadata only. */
  method?: string
  path?: string
  status?: number
  /** Non-sensitive label: a table name (`query_*`) or a date range (summary). */
  label?: string
  /** Safe aggregate counts (materialize_summary / *_assembled) — never ids/copy/rows. */
  counts?: Record<string, number>
  /** Serialised response size in bytes (response_serialized only). */
  bytes?: number
  /** Safe validation flags (materialize_summary only). */
  flags?: Record<string, boolean>
  /** Sanitised error fields (present only on `error` / `query_error`). */
  name?: string
  code?: string
  message?: string
  /** Elapsed ms (since request entry, or since query start on `query_*`). */
  ms?: number
}

export type Logger = (event: LogEvent) => void

/** Thrown when the database connect/query exceeds the request budget. */
export class DbTimeoutError extends Error {
  readonly code = 'DB_TIMEOUT'
  constructor(phase: string) {
    super(`database ${phase} timed out`)
    this.name = 'DbTimeoutError'
  }
}

/**
 * Default per-request database budget.
 *
 * Netlify SYNCHRONOUS functions are killed at a 10s wall-clock hard limit by
 * default (raised to 26s only on Pro, by request) — NOT 60s. The budget must sit
 * BELOW that wall so a slow query is abandoned by US first and returns a graceful,
 * client-readable JSON 500 (`{ error: { code } }`). If the budget exceeds the
 * platform wall, Netlify kills the function instead and returns an opaque 502
 * (text/html) the browser cannot parse — surfacing to the user as a dead-end
 * "couldn't load" with no diagnosable status. 9s leaves ~1s of headroom for cold
 * start + response serialisation before the platform's 10s wall.
 *
 * Refs: https://docs.netlify.com/build/functions/overview/ (execution limits).
 */
export const DEFAULT_DB_TIMEOUT_MS = 9_000

/**
 * Race a promise against a timeout. On timeout the promise is abandoned (the
 * caller closes the connection in a `finally`) and a `DbTimeoutError` is thrown so
 * the function returns a safe 500 before the platform limit.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  phase: string,
  setTimer: (cb: () => void, ms: number) => unknown = setTimeout,
  clearTimer: (handle: unknown) => void = clearTimeout as (h: unknown) => void,
): Promise<T> {
  let handle: unknown
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimer(() => reject(new DbTimeoutError(phase)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimer(handle))
}

/**
 * Extract a client-safe `{ name, code, message }` from an unknown error. The
 * message is stripped of any connection string and any long digit run (matching
 * the repo's redaction convention) and truncated, so no secret, host, or id can
 * leak into logs.
 */
export function safeErrorFields(err: unknown): {
  name: string
  code: string
  message: string
} {
  if (!(err instanceof Error)) {
    return { name: 'unknown', code: 'UNKNOWN', message: '' }
  }
  const raw = (err as { code?: unknown }).code
  const code =
    typeof raw === 'string'
      ? raw
      : raw === undefined || raw === null
        ? 'NONE'
        : String(raw)
  const message = (err.message ?? '')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted-connection]')
    .replace(/\b\d{6,}\b/g, '******')
    .slice(0, 300)
  return { name: err.name, code, message }
}
