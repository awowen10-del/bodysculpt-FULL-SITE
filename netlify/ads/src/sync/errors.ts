/**
 * Fail-loud errors for the Stage 7 sync orchestrator. All carry an uppercase,
 * underscore-delimited `code` (no SQLSTATE shape), so Stage 6's error
 * classification treats them as non-retryable and its sanitiser surfaces the
 * code — without the sync layer importing db internals. Messages never contain
 * raw account ids, tokens, urls, or other secrets.
 */
import type { SanitisedCause } from '../types/index.ts'
import {
  MetaRequestError,
  type SanitisedMetaError,
} from '../meta/graphClient.ts'
import { MetaValidationError } from '../validation/metaResponses.ts'

export type SyncErrorCode =
  | 'INVALID_REQUEST'
  | 'RANGE_TOO_LARGE'
  | 'TOO_MANY_WINDOWS'
  | 'UNSUPPORTED_VERSION'
  | 'CONFLICTING_DUPLICATE'
  | 'ORPHAN_ENTITY'
  | 'CROSS_ACCOUNT'
  | 'LIVE_WRITE_REFUSED'
  | 'FINALISE_FAILED'
  // The `sync_runs` row could not be created — the database connection failed
  // BEFORE the first write, so there is no run row to record against and nothing
  // to finalise. Raised as a fail-loud SyncError so the CLI prints the real
  // stage/code/message instead of the opaque `sync failed (see sanitised
  // sync_runs errors)` (which points at a row that was never written).
  | 'RUN_START_FAILED'
  | 'MALFORMED_RESPONSE'
  | 'DIMENSION_FETCH_FAILED'
  // A dimension record was fetched cleanly but failed NORMALISATION/VALIDATION.
  // Kept distinct from DIMENSION_FETCH_FAILED so a post-fetch schema drift is
  // never reported as a network/fetch failure — the two have different causes,
  // different owners, and different fixes. See src/sync/orchestrator.ts.
  | 'DIMENSION_NORMALISE_FAILED'

export class SyncError extends Error {
  readonly code: SyncErrorCode
  /**
   * Sanitised classification of the exception this error wraps, when it wraps
   * one. Absent for errors we raise directly — those already carry a meaningful
   * `code`, so a cause would add nothing.
   */
  readonly sanitisedCause?: SanitisedCause
  /**
   * The lifecycle stage this error was raised in, when known. A fixed,
   * secret-free classifier (e.g. `dimension_fetch`, `dimension_normalise`) that
   * lets the CLI and `sync_runs.errors` record WHICH phase failed rather than a
   * single catch-all `fetch`. Absent for errors raised outside a labelled stage.
   *
   * Not `readonly`: a structural fail-loud error (e.g. `CONFLICTING_DUPLICATE`)
   * is raised deep in a normalise/fetch step with no stage of its own, so the
   * enclosing lifecycle span stamps its stage exactly once via `stampStage` —
   * see `dimensionStep` in src/sync/orchestrator.ts. A stage set at construction
   * is never overwritten.
   */
  stage?: string
  /**
   * An OPTIONAL, secret-safe STRUCTURAL diagnostic for human eyes, carried on the
   * errors that can pinpoint their own cause without leaking (today: the creative
   * merge conflict — field names, presence buckets, occurrence counts and
   * categories only, never a value). Diagnosis-only: the sanitised surfaces
   * (`classifyCause`/`sanitisedCause`, `toStructuredError`) do NOT read it, so it
   * never widens what is persisted to `sync_runs.errors`. The CLI prints it.
   */
  diagnostic?: string
  /**
   * The SANITISED projection of Meta's error body, when this error wraps a
   * `MetaRequestError` whose failing response carried one. This is the same
   * allow-list the read-only diagnostic prints (`type` / `code` /
   * `error_subcode` / `fbtrace_id` and a redacted `message`) — carried here so a
   * read-only preflight can surface Meta's REAL reason behind
   * `DIMENSION_FETCH_FAILED` instead of only the generic wrapper message.
   *
   * It is HUMAN-DIAGNOSIS-only: `classifyCause`/`sanitisedCause` do NOT read it,
   * so it never widens what is persisted to `sync_runs.errors`. Absent for
   * errors we raise directly and for non-Meta causes.
   */
  readonly metaError?: SanitisedMetaError
  constructor(
    code: SyncErrorCode,
    detail: string,
    cause?: SanitisedCause,
    stage?: string,
    metaError?: SanitisedMetaError,
    underlyingCause?: unknown,
  ) {
    // Retain the RAW underlying error as the native `Error.cause` so the full
    // exception chain survives for human diagnosis (Node prints it under
    // `[cause]`). This is diagnosis-only: none of the sanitised surfaces read it
    // — `classifyCause`/`sanitisedCause`, `toStructuredError` and the CLIs all
    // pick an allow-list of fields — and the errors this wraps (MetaRequestError,
    // MetaValidationError) are themselves secret-free by construction. Passed for
    // every dimension operation via `dimensionStep`, not just the account fetch.
    super(
      `${code}: ${detail}`,
      underlyingCause === undefined ? undefined : { cause: underlyingCause },
    )
    this.name = 'SyncError'
    this.code = code
    if (cause !== undefined) this.sanitisedCause = cause
    if (stage !== undefined) this.stage = stage
    if (metaError !== undefined) this.metaError = metaError
  }

  /**
   * Label this error with the lifecycle stage it surfaced in, but ONLY if it does
   * not already carry one. A structural error (e.g. `CONFLICTING_DUPLICATE`)
   * raised inside a labelled span has no stage of its own; the span stamps it so
   * the stored error and the CLI agree it failed in, say, `dimension_normalise`
   * rather than the catch-all `fetch`. Idempotent, and never overwrites an
   * explicitly-constructed stage. Returns `this` so it can be stamped inline.
   */
  stampStage(stage: string): this {
    if (this.stage === undefined) this.stage = stage
    return this
  }
}

/**
 * STRUCTURAL type guard for a `SyncError`, used by the CLI to decide whether a
 * thrown value is one of our own fail-loud errors (and so carries a printable
 * `code`/`stage`/`message`) rather than an opaque driver error.
 *
 * `instanceof SyncError` alone is not enough at the process boundary. An error
 * can survive a `structuredClone`, a serialize/rehydrate, or a second class
 * identity (a duplicated module instance under a bundler/loader) and STILL be, in
 * every field that matters, one of ours — yet fail `instanceof` and fall through
 * to the generic `sync failed (…)` fallback, hiding the real stage/code. The
 * `instanceof` check stays as the fast path; the duck-typed fallback recognises
 * the shape `SyncError` constructs: `name === 'SyncError'` with a string `code`
 * and a string `message`. Deliberately narrow — it never matches a bare `Error`.
 */
export function isSyncError(err: unknown): err is SyncError {
  if (err instanceof SyncError) return true
  if (typeof err !== 'object' || err === null) return false
  const e = err as { name?: unknown; code?: unknown; message?: unknown }
  return (
    e.name === 'SyncError' &&
    typeof e.code === 'string' &&
    typeof e.message === 'string'
  )
}

/**
 * Classify an arbitrary thrown value into the SANITISED shape safe to persist
 * and print.
 *
 * This is the only bridge between a raw exception and the record of it, and it
 * is a one-way one: it reads an allow-list of typed fields off errors we
 * recognise and NEVER copies the message, stack, url, headers or body of
 * anything. An unrecognised throw yields `unknown` — deliberately uninformative
 * rather than risking an unsanitised leak from a shape we do not control.
 */
export function classifyCause(err: unknown): SanitisedCause {
  if (err instanceof MetaRequestError) {
    const cause: SanitisedCause = {
      kind: err.kind,
      retryable: err.retryable,
      retryCount: err.retryCount,
    }
    // Omitted rather than null for a transport failure: no response, no status.
    if (err.status !== null) cause.status = err.status
    return cause
  }
  if (err instanceof MetaValidationError) {
    // Offline and deterministic, so it is never retried. Note that the field
    // name it carries is NOT copied: it is a Meta field path, not ours to leak.
    return { kind: 'validation', retryable: false, retryCount: 0 }
  }
  return { kind: 'unknown', retryCount: 0 }
}
