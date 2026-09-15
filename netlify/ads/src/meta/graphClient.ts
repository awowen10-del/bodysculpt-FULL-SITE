/**
 * Runtime, read-only Meta Graph/Marketing API networking core (Stage 7).
 *
 * Canonical home for the reusable client logic promoted out of the Stage 4 POC
 * client script (the read-only scripts tree re-exports from here). Pure and
 * framework-agnostic: injectable `fetch`/`sleep`, NO env reads, NO console. The
 * dependency only points from the scripts tree into `src/meta/`, never the
 * reverse.
 *
 * Hard safety rules (unchanged from Stage 4, extended for runtime):
 *  - GET only; the token is sent as an `Authorization: Bearer` header, NEVER in a
 *    URL query string, and is never logged.
 *  - Cursor pagination via `paging.cursors.after` only — we never follow
 *    `paging.next`. A hard page cap, repeated-cursor detection, and
 *    malformed-pagination fail-loud protect against loops.
 *  - Retries ONLY on 429 / 5xx (bounded); 400 / 401 / 403 fail immediately.
 *  - Rate-limit metadata is parsed into a typed, sanitised allow-list (no raw
 *    headers, ids, trace values, urls, or tokens).
 */
import { META_API_VERSION } from '../config/metaApiVersion.ts'
import { redactLongIds, redactSensitive } from './redact.ts'

export const GRAPH_BASE = 'https://graph.facebook.com'

export const MAX_RETRIES = 3
/** General per-request insight date-range cap (a single window is <= 7 days). */
export const MAX_INSIGHT_RANGE_DAYS = 7
/** Hard upper bound on pages walked for a single edge — loop backstop. */
export const HARD_MAX_PAGES_PER_EDGE = 1000

const SERVER_ERROR_MIN = 500
const SERVER_ERROR_MAX = 599
const BACKOFF_BASE_MS = 500
const BACKOFF_CAP_MS = 4000

export interface MetaConfig {
  accessToken: string
  adAccountId: string
}

// --- shared validators -----------------------------------------------------

export function requireAccessToken(raw: string | undefined): string {
  if (!raw || raw.trim() === '') throw new Error('META_ACCESS_TOKEN is not set')
  return raw.trim()
}

export function normalizeAdAccountId(raw: string | undefined): string {
  if (!raw || raw.trim() === '')
    throw new Error('META_AD_ACCOUNT_ID is not set')
  const trimmed = raw.trim()
  const digits = trimmed.startsWith('act_') ? trimmed.slice(4) : trimmed
  if (!/^\d+$/.test(digits)) {
    throw new Error(
      'META_AD_ACCOUNT_ID must be a numeric ad-account id, optionally prefixed with "act_"',
    )
  }
  return `act_${digits}`
}

// --- URL building ----------------------------------------------------------

export type QueryValue = string | number
export type QueryParams = Record<string, QueryValue | undefined>

/**
 * Build a Graph API URL. Refuses to place any credential in the query string,
 * and the API version always comes from the central constant.
 */
export function buildGraphUrl(
  path: string,
  params: QueryParams = {},
  version: string = META_API_VERSION,
): string {
  const cleanPath = path.replace(/^\/+/, '')
  const url = new URL(`${GRAPH_BASE}/${version}/${cleanPath}`)
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    if (/access_token|client_secret|appsecret_proof/i.test(key)) {
      throw new Error(
        `Refusing to place credential "${key}" in the request URL`,
      )
    }
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

// --- shape / presence helpers (structure only, never values) ---------------

export type BroadShape =
  | 'absent'
  | 'null'
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | `array[${number}]`

export function describeValueShape(value: unknown): BroadShape {
  if (value === undefined) return 'absent'
  if (value === null) return 'null'
  if (Array.isArray(value)) return `array[${value.length}]`
  const t = typeof value
  if (t === 'string' || t === 'number' || t === 'boolean') return t
  return 'object'
}

export interface FieldPresence {
  field: string
  present: boolean
  shape: BroadShape
}

export function summariseFieldPresence(
  record: Record<string, unknown>,
  fields: readonly string[],
): FieldPresence[] {
  return fields.map((field) => ({
    field,
    present: field in record,
    shape: describeValueShape(record[field]),
  }))
}

export function safeScalar(value: unknown): string {
  if (value === undefined) return '(absent)'
  if (value === null) return '(null)'
  if (Array.isArray(value)) return `(array[${value.length}])`
  if (typeof value === 'object') return '(object)'
  return String(value)
}

// --- request failures ------------------------------------------------------

/** Transport-level failure (no response) vs. a response with a failing status. */
export type MetaFailureKind = 'network' | 'http'

/**
 * A SANITISED projection of Meta's error response body, safe to surface in a
 * diagnostic. Explicit allow-list: the four opaque classification fields Meta
 * returns (`type` / `code` / `error_subcode` / `fbtrace_id`) plus a scrubbed
 * `message`. The message is passed through the token/credential scrubber AND
 * `redactLongIds`, so any access token, credential-bearing url fragment, or long
 * numeric id (an ad-account or business id Meta echoes back) is masked before it
 * can reach a log line. The raw body, url, query string and headers are NEVER
 * retained here.
 *
 * WHY: the four opaque fields are exactly what Meta's own docs and support ask
 * for when diagnosing a 400 — an `error_subcode` distinguishes "token expired"
 * from "wrong account" from "missing permission" — yet none of them can carry a
 * secret. The one free-text field that could, `message`, is redacted.
 */
export interface SanitisedMetaError {
  /** e.g. "OAuthException", "GraphMethodException". Opaque; never a secret. */
  type: string | null
  /** e.g. 190 (auth), 100 (bad request). Opaque numeric class. */
  code: number | null
  /** e.g. 463 (token expired). The field that pins the exact cause. */
  errorSubcode: number | null
  /** Meta's support-trace correlation id. Not a credential. */
  fbtraceId: string | null
  /** Human-readable reason, already token/credential/long-id redacted. */
  message: string
}

/**
 * Parse Meta's `{ error: { ... } }` failure body into the sanitised allow-list.
 * Returns null when the body is absent or not shaped like a Meta error. The
 * caller passes the token so it is scrubbed from `message` on top of the
 * structural credential and long-id redaction.
 */
export function parseMetaError(
  body: unknown,
  token: string,
): SanitisedMetaError | null {
  if (!isRecord(body)) return null
  const error = body.error
  if (!isRecord(error)) return null
  const rawMessage = typeof error.message === 'string' ? error.message : ''
  return {
    type: typeof error.type === 'string' ? error.type : null,
    code: typeof error.code === 'number' ? error.code : null,
    errorSubcode:
      typeof error.error_subcode === 'number' ? error.error_subcode : null,
    fbtraceId: typeof error.fbtrace_id === 'string' ? error.fbtrace_id : null,
    // Belt-and-braces: scrub the token, structural creds, then any long id.
    message: redactLongIds(redactSensitive(rawMessage, [token])),
  }
}

/**
 * A Meta request failure carrying a SANITISED classification of itself.
 *
 * WHY THIS EXISTS: this client used to throw a bare `Error`, and the sync
 * orchestrator's dimension wrapper replaces every non-`SyncError` with a generic
 * `DIMENSION_FETCH_FAILED`. A throttle, an expired token and a transport fault
 * were therefore indistinguishable in `sync_runs.errors` — the first controlled
 * production write failed and the row could not say why.
 *
 * The classification fields are deliberately the minimum that separates those
 * cases: a numeric status, whether the retry policy considers it retryable, and
 * how many retries actually happened. None of them can hold a url, header, token,
 * id or raw body, and `message` is a fixed string built only from the status —
 * NEVER from the caught exception.
 *
 * `metaError` is an OPTIONAL, already-sanitised projection of Meta's response
 * body (see `SanitisedMetaError`) carried for HUMAN DIAGNOSIS only. It is present
 * on failing-status responses whose body parses as a Meta error. The sync
 * persistence path (`classifyCause`) does NOT read it, so it never widens what is
 * written to `sync_runs.errors`; the read-only CLI diagnostic is its only reader.
 *
 * This class carries no `code` property ON PURPOSE: `safeErrorCode` duck-types
 * `.code`, so adding one would silently change the code recorded for insight
 * windows, which is out of scope here.
 */
export class MetaRequestError extends Error {
  readonly kind: MetaFailureKind
  /** HTTP only; null for transport failures, where no response was received. */
  readonly status: number | null
  readonly retryable: boolean
  /** Retries actually performed before this failure (0 = failed first attempt). */
  readonly retryCount: number
  /** Sanitised Meta error body, when the failing response carried one. */
  readonly metaError?: SanitisedMetaError

  constructor(init: {
    kind: MetaFailureKind
    status: number | null
    retryable: boolean
    retryCount: number
    message: string
    metaError?: SanitisedMetaError | null
  }) {
    super(init.message)
    this.name = 'MetaRequestError'
    this.kind = init.kind
    this.status = init.status
    this.retryable = init.retryable
    this.retryCount = init.retryCount
    if (init.metaError) this.metaError = init.metaError
  }
}

// --- retry / backoff -------------------------------------------------------

export function isRetryableStatus(status: number): boolean {
  return (
    status === 429 || (status >= SERVER_ERROR_MIN && status <= SERVER_ERROR_MAX)
  )
}

export function isImmediateFailStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403
}

export function backoffDelayMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS)
}

// --- insight date-range cap ------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86_400_000

export function assertInsightRangeWithinCap(
  since: string,
  until: string,
  maxDays: number = MAX_INSIGHT_RANGE_DAYS,
): void {
  if (!DATE_RE.test(since) || !DATE_RE.test(until)) {
    throw new Error('Insight date range must use YYYY-MM-DD dates')
  }
  const start = Date.parse(`${since}T00:00:00Z`)
  const end = Date.parse(`${until}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error('Insight date range is not a valid date')
  }
  if (end < start) throw new Error('Insight date range end precedes start')
  const inclusiveDays = Math.floor((end - start) / MS_PER_DAY) + 1
  if (inclusiveDays > maxDays) {
    throw new Error(
      `Insight date range of ${inclusiveDays} days exceeds the ${maxDays}-day cap`,
    )
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function defaultInsightRange(now: Date = new Date()): {
  since: string
  until: string
} {
  const until = new Date(now)
  const since = new Date(now)
  since.setUTCDate(since.getUTCDate() - (MAX_INSIGHT_RANGE_DAYS - 1))
  return { since: isoDate(since), until: isoDate(until) }
}

// --- rate-limit metadata (typed, sanitised allow-list) ---------------------

/**
 * Sanitised aggregate rate-limit metadata suitable for `sync_runs.rate_limit_info`.
 * Explicit allow-list: only these numeric percentages, a recovery estimate, an
 * access tier string, and a trace-id COUNT are ever retained. Raw headers,
 * business/account id keys, trace-id values, URLs, and tokens are never stored.
 */
export interface SanitisedRateLimit {
  appCallCountPct: number | null
  appTotalTimePct: number | null
  appTotalCputimePct: number | null
  businessCallCountPct: number | null
  businessTotalTimePct: number | null
  businessTotalCputimePct: number | null
  estimatedTimeToRegainAccessMin: number | null
  adsApiAccessTier: string | null
  insightsThrottleAppPct: number | null
  insightsThrottleAccountPct: number | null
  traceIdCount: number
}

export function emptyRateLimit(): SanitisedRateLimit {
  return {
    appCallCountPct: null,
    appTotalTimePct: null,
    appTotalCputimePct: null,
    businessCallCountPct: null,
    businessTotalTimePct: null,
    businessTotalCputimePct: null,
    estimatedTimeToRegainAccessMin: null,
    adsApiAccessTier: null,
    insightsThrottleAppPct: null,
    insightsThrottleAccountPct: null,
    traceIdCount: 0,
  }
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}
function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Parse Meta usage headers into the sanitised allow-list. Never retains raw text. */
export function parseRateLimit(headers: Headers): SanitisedRateLimit {
  const out = emptyRateLimit()

  const app = parseJsonObject(headers.get('x-app-usage'))
  if (app) {
    out.appCallCountPct = num(app.call_count)
    out.appTotalTimePct = num(app.total_time)
    out.appTotalCputimePct = num(app.total_cputime)
  }

  // x-business-use-case-usage is keyed by business id -> [ { ...metrics } ].
  // The id KEYS are never stored; we aggregate the inner allow-listed metrics.
  const buc = parseJsonObject(headers.get('x-business-use-case-usage'))
  if (buc) {
    for (const entries of Object.values(buc)) {
      if (!Array.isArray(entries)) continue
      for (const entry of entries) {
        if (typeof entry !== 'object' || entry === null) continue
        const e = entry as Record<string, unknown>
        out.businessCallCountPct = maxN(
          out.businessCallCountPct,
          num(e.call_count),
        )
        out.businessTotalTimePct = maxN(
          out.businessTotalTimePct,
          num(e.total_time),
        )
        out.businessTotalCputimePct = maxN(
          out.businessTotalCputimePct,
          num(e.total_cputime),
        )
        out.estimatedTimeToRegainAccessMin = maxN(
          out.estimatedTimeToRegainAccessMin,
          num(e.estimated_time_to_regain_access),
        )
        out.adsApiAccessTier =
          out.adsApiAccessTier ?? str(e.ads_api_access_tier)
      }
    }
  }

  const throttle = parseJsonObject(headers.get('x-fb-ads-insights-throttle'))
  if (throttle) {
    out.insightsThrottleAppPct = num(throttle.app_id_util_pct)
    out.insightsThrottleAccountPct = num(throttle.acc_id_util_pct)
  }

  const traceId =
    headers.get('x-fb-trace-id') ?? headers.get('x-fb-request-id') ?? null
  out.traceIdCount = traceId !== null ? 1 : 0
  return out
}

function maxN(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}

/** Merge two sanitised rate-limit snapshots (max of pcts, sum of trace counts). */
export function mergeRateLimit(
  a: SanitisedRateLimit,
  b: SanitisedRateLimit,
): SanitisedRateLimit {
  return {
    appCallCountPct: maxN(a.appCallCountPct, b.appCallCountPct),
    appTotalTimePct: maxN(a.appTotalTimePct, b.appTotalTimePct),
    appTotalCputimePct: maxN(a.appTotalCputimePct, b.appTotalCputimePct),
    businessCallCountPct: maxN(a.businessCallCountPct, b.businessCallCountPct),
    businessTotalTimePct: maxN(a.businessTotalTimePct, b.businessTotalTimePct),
    businessTotalCputimePct: maxN(
      a.businessTotalCputimePct,
      b.businessTotalCputimePct,
    ),
    estimatedTimeToRegainAccessMin: maxN(
      a.estimatedTimeToRegainAccessMin,
      b.estimatedTimeToRegainAccessMin,
    ),
    adsApiAccessTier: a.adsApiAccessTier ?? b.adsApiAccessTier,
    insightsThrottleAppPct: maxN(
      a.insightsThrottleAppPct,
      b.insightsThrottleAppPct,
    ),
    insightsThrottleAccountPct: maxN(
      a.insightsThrottleAccountPct,
      b.insightsThrottleAccountPct,
    ),
    traceIdCount: a.traceIdCount + b.traceIdCount,
  }
}

// --- legacy Stage-4 response meta (redacted usage strings) ------------------

const USAGE_HEADER_NAMES = [
  'x-app-usage',
  'x-business-use-case-usage',
  'x-ad-account-usage',
  'x-fb-ads-insights-throttle',
] as const

export interface ResponseMeta {
  traceIdCaptured: boolean
  /** Usage headers with any long IDs redacted — Stage-4 CLI display. */
  usage: Record<string, string>
  /** Typed, sanitised rate-limit allow-list (Stage 7). */
  rateLimit: SanitisedRateLimit
}

export function captureResponseMeta(headers: Headers): ResponseMeta {
  const usage: Record<string, string> = {}
  for (const name of USAGE_HEADER_NAMES) {
    const raw = headers.get(name)
    if (raw) usage[name] = redactLongIds(raw)
  }
  const traceId =
    headers.get('x-fb-trace-id') ?? headers.get('x-fb-request-id') ?? null
  return {
    traceIdCaptured: traceId !== null,
    usage,
    rateLimit: parseRateLimit(headers),
  }
}

// --- the read-only paginated GET -------------------------------------------

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>
export type SleepLike = (ms: number) => Promise<void>

const defaultSleep: SleepLike = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms))

export interface PagedRequest {
  path: string
  params?: QueryParams
  maxPages: number
  maxRecords: number
  fetchImpl?: FetchLike
  sleepImpl?: SleepLike
  version?: string
}

export interface PagedResult {
  data: unknown[]
  pages: number
  truncated: boolean
  meta: ResponseMeta[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

type CursorResult =
  { kind: 'done' } | { kind: 'cursor'; after: string } | { kind: 'malformed' }

/**
 * Decide the next page. Absent paging (or no `next`) means complete. A `next`
 * with a usable `cursors.after` advances. A `next` WITHOUT a usable cursor is
 * malformed pagination and must fail loud.
 */
function nextPageCursor(body: unknown): CursorResult {
  if (!isRecord(body)) return { kind: 'done' }
  const paging = body.paging
  if (!isRecord(paging) || !('next' in paging)) return { kind: 'done' }
  const cursors = paging.cursors
  if (isRecord(cursors) && typeof cursors.after === 'string' && cursors.after) {
    return { kind: 'cursor', after: cursors.after }
  }
  return { kind: 'malformed' }
}

async function getOnce(
  token: string,
  url: string,
  fetchImpl: FetchLike,
  sleepImpl: SleepLike,
): Promise<{ body: unknown; meta: ResponseMeta }> {
  for (let attempt = 1; ; attempt += 1) {
    let res: Response
    try {
      res = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      })
    } catch {
      // The caught value is deliberately NOT bound: a transport exception can
      // embed the request url (and therefore query params) in its message. It is
      // discarded unread and replaced by a fixed string plus a classification.
      if (attempt > MAX_RETRIES) {
        throw new MetaRequestError({
          kind: 'network',
          status: null,
          retryable: true,
          retryCount: attempt - 1,
          message: `Meta request failed: network error after ${MAX_RETRIES} retries`,
        })
      }
      await sleepImpl(backoffDelayMs(attempt))
      continue
    }

    const meta = captureResponseMeta(res.headers)

    if (res.ok) {
      const body: unknown = await res.json().catch(() => null)
      return { body, meta }
    }
    if (isImmediateFailStatus(res.status)) {
      // Read the body ONLY to extract Meta's sanitised error fields. The raw
      // body is discarded; `parseMetaError` retains an allow-list and redacts
      // the one free-text field. This is what tells "token expired" apart from
      // "wrong account" apart from "missing permission" behind a bare HTTP 400.
      const failureBody: unknown = await res.json().catch(() => null)
      throw new MetaRequestError({
        kind: 'http',
        status: res.status,
        retryable: false,
        retryCount: attempt - 1,
        message: `Meta request failed: HTTP ${res.status} (not retried)`,
        metaError: parseMetaError(failureBody, token),
      })
    }
    if (isRetryableStatus(res.status) && attempt <= MAX_RETRIES) {
      await sleepImpl(backoffDelayMs(attempt))
      continue
    }
    // Either a retryable status whose budget is spent, or a status outside both
    // classes (e.g. 404). `retryable` reflects the CLASS, not whether budget
    // remained, so an exhausted 429 is still reported as retryable.
    const failureBody: unknown = await res.json().catch(() => null)
    throw new MetaRequestError({
      kind: 'http',
      status: res.status,
      retryable: isRetryableStatus(res.status),
      retryCount: attempt - 1,
      message: `Meta request failed: HTTP ${res.status}`,
      metaError: parseMetaError(failureBody, token),
    })
  }
}

/**
 * Paginated GET using cursor-based paging. Follows `paging.cursors.after` and
 * rebuilds the next URL ourselves — NEVER follows `paging.next` (which embeds the
 * token). Enforces page/record caps, a hard page backstop, repeated-cursor
 * detection, and malformed-pagination fail-loud.
 */
export async function metaGetPaged(
  config: MetaConfig,
  request: PagedRequest,
): Promise<PagedResult> {
  const fetchImpl: FetchLike = request.fetchImpl ?? fetch
  const sleepImpl: SleepLike = request.sleepImpl ?? defaultSleep
  const version = request.version ?? META_API_VERSION
  const maxPages = Math.min(
    Math.max(1, request.maxPages),
    HARD_MAX_PAGES_PER_EDGE,
  )
  const maxRecords = Math.max(1, request.maxRecords)

  const data: unknown[] = []
  const metas: ResponseMeta[] = []
  const seenCursors = new Set<string>()
  let after: string | undefined
  let pages = 0
  let truncated = false

  while (pages < maxPages) {
    const params: QueryParams = { ...request.params }
    if (after !== undefined) params.after = after
    const url = buildGraphUrl(request.path, params, version)

    const { body, meta } = await getOnce(
      config.accessToken,
      url,
      fetchImpl,
      sleepImpl,
    )
    metas.push(meta)
    pages += 1

    const batch: unknown[] =
      isRecord(body) && Array.isArray(body.data) ? body.data : [body]
    for (const row of batch) {
      if (data.length >= maxRecords) {
        truncated = true
        break
      }
      data.push(row)
    }
    if (data.length >= maxRecords) {
      truncated = true
      break
    }

    const cursor = nextPageCursor(body)
    if (cursor.kind === 'done') break
    if (cursor.kind === 'malformed') {
      throw new Error(
        'Meta pagination is malformed: "next" present but no usable cursors.after',
      )
    }
    if (pages >= maxPages) {
      truncated = true
      break
    }
    if (seenCursors.has(cursor.after)) {
      throw new Error('Meta pagination returned a repeated after-cursor')
    }
    seenCursors.add(cursor.after)
    after = cursor.after
  }

  return { data, pages, truncated, meta: metas }
}
