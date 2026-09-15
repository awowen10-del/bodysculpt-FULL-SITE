/**
 * Database error classification, bounded retry, and error SANITISATION for the
 * Stage 6 write layer.
 *
 * - Only explicitly-classified TRANSIENT database faults are retried
 *   (serialization failure, deadlock, connection-class errors). Everything else
 *   — validation, mapping, FK, NOT NULL, check, unique-from-bad-input, auth,
 *   permission — is NON-RETRYABLE and fails fast, preserving the original error.
 * - Stored errors carry only: stage, safe code, optional window dates, a redacted
 *   single-line message, and the retry count. Never connection strings,
 *   DATABASE_URL, tokens, headers, SQL text, stack traces, raw payloads, or PII.
 */
import type { SanitisedCause, StructuredSyncError } from '../../types/index.ts'
import { redactSensitive } from '../../meta/redact.ts'

/** Ingest-level, fail-loud conditions raised before/around the database. */
export type IngestErrorCode =
  | 'INVALID_REQUEST'
  | 'MISSING_PARENT'
  | 'UNRESOLVED_ID'
  | 'AMBIGUOUS_ID'
  | 'CURRENCY_MISMATCH'
  | 'DUPLICATE_INPUT'

export class IngestError extends Error {
  readonly code: IngestErrorCode
  constructor(code: IngestErrorCode, detail: string) {
    super(`${code}: ${detail}`)
    this.name = 'IngestError'
    this.code = code
  }
}

export type ErrorClass = 'transient' | 'non_retryable'

/**
 * PostgreSQL SQLSTATE codes that represent transient, safely-retryable faults.
 * Kept deliberately narrow and documented.
 */
export const TRANSIENT_SQLSTATES: ReadonlySet<string> = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
  '57P01', // admin_shutdown
])

/**
 * postgres.js DRIVER-level connection faults. These are NOT PostgreSQL SQLSTATEs:
 * the driver raises them as plain `Error`s whose `.code` is an
 * UPPERCASE_UNDERSCORE string (e.g. `CONNECTION_CLOSED`) — which is exactly the
 * shape `appErrorCode` below treats as a non-retryable APPLICATION code. Without
 * this explicit set, a mid-flight pooled-connection reset (Supavisor recycles
 * idle/long-lived connections, so a large dimension transaction on the pooler is
 * a prime candidate) is misclassified as non-retryable and the write fails on the
 * first blip having committed zero rows — the exact Stage 9 live-write symptom.
 * They are transient: re-running the idempotent upsert on a fresh connection is
 * the correct recovery, which the bounded retry then performs.
 *
 * Source of the literals: `node_modules/postgres/src/{connection,index}.js`
 * (`Errors.connection('CONNECTION_CLOSED' | 'CONNECTION_DESTROYED' |
 * 'CONNECTION_ENDED' | 'CONNECT_TIMEOUT', …)`).
 */
export const TRANSIENT_DRIVER_CODES: ReadonlySet<string> = new Set([
  'CONNECTION_CLOSED', // socket closed mid-flight (pooler reset / server drop)
  'CONNECTION_DESTROYED', // connection torn down with a query in flight
  'CONNECTION_ENDED', // server ended the connection
  'CONNECT_TIMEOUT', // establishment exceeded connect_timeout
])

/**
 * The error and its `.cause` ancestry (bounded), surface-error first.
 *
 * Drizzle's postgres-js session wraps EVERY query fault in a `DrizzleQueryError`
 * whose own `.code` is ABSENT and whose `.message` is the failed SQL text — the
 * real driver error (carrying the transient `CONNECTION_CLOSED` / SQLSTATE
 * `.code`) is its `.cause`. So a pooled-connection reset that lands MID-transaction
 * — the common case for a large dimension upsert, which runs many statements —
 * arrives WRAPPED, and classifying only the surface error mis-reads it as
 * non-retryable: the exact `retries=0, written=0` live-write symptom. Every
 * classifier below therefore walks the chain, not just the outermost error.
 *
 * (The previous fix caught only the RAW driver error — a drop exactly at `BEGIN`,
 * before any statement — which postgres.js throws unwrapped. The wrapped
 * mid-statement drop slipped straight through.)
 */
function causeChain(err: unknown, maxDepth = 5): unknown[] {
  const chain: unknown[] = []
  let cur = err
  for (let depth = 0; depth <= maxDepth && cur != null; depth += 1) {
    chain.push(cur)
    cur =
      typeof cur === 'object' && cur !== null && 'cause' in cur
        ? (cur as { cause: unknown }).cause
        : undefined
  }
  return chain
}

/** The `.code` string carried by an error object, if any. */
function rawCodeOf(e: unknown): string | undefined {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = (e as { code: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

/** The postgres.js driver connection code carried ANYWHERE in the cause chain. */
export function driverConnectionCode(err: unknown): string | undefined {
  for (const e of causeChain(err)) {
    const code = rawCodeOf(e)
    if (code !== undefined && TRANSIENT_DRIVER_CODES.has(code)) return code
  }
  return undefined
}

/** Extract a 5-char SQLSTATE from anywhere in the cause chain, if present. */
export function sqlStateOf(err: unknown): string | undefined {
  for (const e of causeChain(err)) {
    const code = rawCodeOf(e)
    if (code !== undefined && /^[0-9A-Z]{5}$/.test(code)) return code
  }
  return undefined
}

/**
 * A non-SQLSTATE application error code (uppercase, underscore-delimited) carried
 * by IngestError and the Stage 7 SyncError. Duck-typed so this module needs no
 * dependency on higher layers.
 */
function appErrorCode(err: unknown): string | undefined {
  for (const e of causeChain(err)) {
    if (e instanceof IngestError) return e.code
    const code = rawCodeOf(e)
    if (code !== undefined && /_/.test(code) && /^[A-Z0-9_]+$/.test(code)) {
      return code
    }
  }
  return undefined
}

/**
 * Classify an error. Only errors carrying a transient SQLSTATE are retryable;
 * application errors (IngestError / SyncError) and everything else are not.
 */
export function classifyDbError(err: unknown): ErrorClass {
  // Checked FIRST: a postgres.js connection code (e.g. CONNECTION_CLOSED) shares
  // the UPPERCASE_UNDERSCORE shape of an application code, so `appErrorCode`
  // would otherwise claim it and mark a transient connection reset as
  // non-retryable — the bug that let a single pooled-connection drop fail the
  // whole live write with zero rows written.
  if (driverConnectionCode(err) !== undefined) return 'transient'
  if (appErrorCode(err) !== undefined) return 'non_retryable'
  const state = sqlStateOf(err)
  if (state && TRANSIENT_SQLSTATES.has(state)) return 'transient'
  return 'non_retryable'
}

/** A safe, non-secret code for storage. */
export function safeErrorCode(err: unknown): string {
  return appErrorCode(err) ?? sqlStateOf(err) ?? 'UNKNOWN'
}

const MAX_MESSAGE_LEN = 300

/**
 * True when `e` is a Drizzle "Failed query" wrapper — its `.message` is the raw
 * SQL text and its `.params` the bound row values, NEITHER of which may ever be
 * stored. Detected structurally (`query`+`params`) and by message prefix.
 */
function isQueryWrapper(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false
  if ('query' in e && 'params' in e) return true
  return e instanceof Error && e.message.startsWith('Failed query:')
}

/**
 * Produce a redacted, single-line, truncated message. Only an error's `.message`
 * is used — never `.stack`, `.query`, `.parameters`, `.detail`, or `.where`
 * (which can carry SQL text or row values). Secrets/URLs are scrubbed.
 *
 * Reads through the cause chain to the DEEPEST non-wrapper error: Drizzle's
 * `DrizzleQueryError` wrapper carries the failed SQL and bound params in its
 * message, so storing it verbatim would leak both. Its cause — the real driver
 * error with the safe `write CONNECTION_CLOSED host:port` message — is stored
 * instead. A bare wrapper with no usable cause falls back to a generic string.
 */
export function redactMessage(err: unknown): string {
  const source = [...causeChain(err)]
    .reverse()
    .find((e) => e != null && !isQueryWrapper(e))
  const raw =
    source instanceof Error
      ? source.message
      : source !== undefined
        ? String(source)
        : 'database query failed'
  const scrubbed = redactSensitive(raw)
    // Defensively strip any postgres connection URL (never store connection details).
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '***redacted***')
    .replace(/\s+/g, ' ')
    .trim()
  return scrubbed.length > MAX_MESSAGE_LEN
    ? `${scrubbed.slice(0, MAX_MESSAGE_LEN)}…`
    : scrubbed
}

/**
 * Shape a fully-sanitised structured error for `sync_runs.errors`.
 *
 * `opts.cause` is passed IN rather than derived from `err` here: the
 * classification is the sync layer's to make (it knows the Meta error types),
 * and this module must not import upwards to reach them. It is already
 * sanitised by construction — see `SanitisedCause`.
 */
export function toStructuredError(
  stage: string,
  err: unknown,
  opts: {
    windowStart?: string
    windowEnd?: string
    retryCount: number
    cause?: SanitisedCause
  },
): StructuredSyncError {
  const structured: StructuredSyncError = {
    stage,
    code: safeErrorCode(err),
    message: redactMessage(err),
    retryCount: opts.retryCount,
  }
  if (opts.windowStart !== undefined) structured.windowStart = opts.windowStart
  if (opts.windowEnd !== undefined) structured.windowEnd = opts.windowEnd
  if (opts.cause !== undefined) structured.cause = opts.cause
  return structured
}

// --- bounded retry ---------------------------------------------------------

export type RetryOutcome<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; error: unknown; attempts: number }

export interface RetryOptions {
  /** Total attempts, including the first (default 3). */
  maxAttempts?: number
  /** Injectable sleep so tests never actually wait. */
  sleep?: (ms: number) => Promise<void>
  /** Backoff for the delay BEFORE the next attempt (1-indexed). */
  backoffMs?: (attempt: number) => number
  /**
   * Fired right BEFORE each transient retry, with SAFE fields only: the attempt
   * that just failed, the attempt ceiling, and the classified transient code
   * (e.g. `CONNECTION_CLOSED`). Lets a caller surface `retry 1/3` progress so a
   * pooled-connection reset that IS being retried is visible, never silent. It
   * carries no SQL, params, connection string or payload.
   */
  onRetry?: (info: {
    attempt: number
    maxAttempts: number
    code: string
  }) => void
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const defaultBackoff = (attempt: number): number =>
  Math.min(100 * 2 ** (attempt - 1), 2000)

/**
 * Run `op` with bounded retries on TRANSIENT errors only. Never throws for a
 * classified failure — returns a discriminated outcome carrying the attempt
 * count and the ORIGINAL (unwrapped) error, so the caller can record the retry
 * count and sanitise the preserved error. A non-retryable error stops
 * immediately (attempts = 1).
 */
export async function withRetry<T>(
  op: () => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryOutcome<T>> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const sleep = options.sleep ?? defaultSleep
  const backoff = options.backoffMs ?? defaultBackoff

  let attempt = 0
  for (;;) {
    attempt += 1
    try {
      const value = await op()
      return { ok: true, value, attempts: attempt }
    } catch (error) {
      const retryable = classifyDbError(error) === 'transient'
      if (!retryable || attempt >= maxAttempts) {
        return { ok: false, error, attempts: attempt }
      }
      // Announce the retry with safe fields only (the classified code is a
      // driver/SQLSTATE token, never a message, SQL or connection detail).
      options.onRetry?.({ attempt, maxAttempts, code: safeErrorCode(error) })
      await sleep(backoff(attempt))
    }
  }
}
