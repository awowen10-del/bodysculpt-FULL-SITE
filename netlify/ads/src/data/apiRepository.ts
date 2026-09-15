/**
 * API-backed `DashboardRepository` (Stage 11B) — `getDataState` and `getSummary`.
 *
 * BROWSER-SAFE: imports only `fetch` (injectable), `zod` schemas, and DTO/contract
 * *types*. It performs NO arithmetic and NO classification — it fetches, validates
 * the response against the DTO schema, and returns the parsed DTO. The other seven
 * methods intentionally throw `RepositoryNotImplementedError` until Stage 11C.
 *
 * This repository is NOT yet the UI default (see `src/ui/repository.tsx`).
 */
import type {
  DashboardRepository,
  DateRangeQuery,
  AdSetQuery,
  AdQuery,
  DailyQuery,
  CreativeQuery,
} from './repository.ts'
import type {
  AdDetailDTO,
  AdDTO,
  AdSetDTO,
  CampaignDTO,
  CreativeRowDTO,
  DailyRowDTO,
  DataStateDTO,
  SummaryDTO,
} from './dto.ts'
import {
  adDetailDtoSchema,
  adListSchema,
  adSetListSchema,
  campaignListSchema,
  creativeRowDtoSchema,
  dailyListSchema,
  dataStateDtoSchema,
  summaryDtoSchema,
} from './apiSchemas.ts'

// --- controlled repository errors -------------------------------------------

/**
 * SAFE, displayable failure metadata attached to a repository error. It carries
 * ONLY non-sensitive signals a user can be shown to unstick a stuck screen: which
 * endpoint failed, the HTTP status, the response content type, and the server's
 * own safe error code (from a `{ error: { code } }` body). It NEVER carries a
 * response body, row data, id, url, token or query string.
 */
export interface RepositoryDiagnostics {
  /** Safe endpoint label, e.g. `'creatives'` — never a full URL or query. */
  endpoint: string
  /** HTTP status, or null when the request never completed (network error). */
  status: number | null
  /** Response `content-type` (mime only), or null when unknown. */
  contentType: string | null
  /** The server's client-safe error code (`error.code`), or null. */
  code: string | null
}

/** Base class for every error this repository throws. */
export class RepositoryError extends Error {
  /** Safe, displayable failure metadata (see `RepositoryDiagnostics`). */
  diagnostics?: RepositoryDiagnostics
}

/** Attach safe diagnostics to a repository error and return it (for `throw`). */
function withDiagnostics<E extends RepositoryError>(
  err: E,
  diagnostics: RepositoryDiagnostics,
): E {
  err.diagnostics = diagnostics
  return err
}

/**
 * Read a repository error's safe diagnostics, if any. UI-safe: returns only the
 * `RepositoryDiagnostics` fields (endpoint/status/contentType/code), never a body.
 */
export function repositoryDiagnostics(
  err: unknown,
): RepositoryDiagnostics | undefined {
  return err instanceof RepositoryError ? err.diagnostics : undefined
}

/** The request was not authenticated (HTTP 401). */
export class RepositoryUnauthorizedError extends RepositoryError {
  constructor(message = 'You are not authorised to view this data.') {
    super(message)
    this.name = 'RepositoryUnauthorizedError'
  }
}

/** The service was unreachable or returned a non-OK, non-401 status. */
export class RepositoryUnavailableError extends RepositoryError {
  constructor(message = 'The dashboard data service is unavailable.') {
    super(message)
    this.name = 'RepositoryUnavailableError'
  }
}

/** The response was not valid JSON or did not match the DTO contract. */
export class RepositoryResponseError extends RepositoryError {
  constructor(message = 'The dashboard returned an unexpected response.') {
    super(message)
    this.name = 'RepositoryResponseError'
  }
}

/** A method not implemented by this Stage 11B partial repository. */
export class RepositoryNotImplementedError extends RepositoryError {
  constructor(method: string) {
    super(`${method} is not available in the Stage 11B API repository yet.`)
    this.name = 'RepositoryNotImplementedError'
  }
}

// --- minimal fetch surface (keeps the client testable & Response-free) -------

/** The subset of a `fetch` response this repository uses. */
export interface FetchResponseLike {
  status: number
  ok: boolean
  json: () => Promise<unknown>
  /**
   * Response headers (optional — test doubles may omit it). Only `content-type`
   * is read, and only to populate safe diagnostics; no header value is trusted.
   */
  headers?: { get: (name: string) => string | null }
}

/** A `fetch`-like function. The default wraps the global `fetch`. */
export type FetchLike = (
  url: string,
  init: {
    method: 'GET'
    headers: Record<string, string>
    credentials: 'same-origin'
  },
) => Promise<FetchResponseLike>

export interface ApiRepositoryOptions {
  /** API base path. Default `'/api'`. */
  baseUrl?: string
  /** Injectable fetch. Defaults to the global `fetch`. */
  fetch?: FetchLike
  /** Supplies auth headers per request (e.g. a bearer token). Default none. */
  getAuthHeaders?: () =>
    Record<string, string> | Promise<Record<string, string>>
}

function defaultFetch(): FetchLike {
  return async (url, init) => {
    const res = await globalThis.fetch(url, {
      method: init.method,
      headers: init.headers,
      credentials: init.credentials,
    })
    return {
      status: res.status,
      ok: res.ok,
      json: () => res.json(),
      headers: res.headers,
    }
  }
}

/** Safe endpoint label from a request path: the first segment, no query/ids. */
function endpointLabel(path: string): string {
  return path.replace(/^\/+/, '').split('/')[0] || 'api'
}

/**
 * Best-effort read of the server's client-safe `error.code` from a non-OK JSON
 * body. Never throws and never returns anything but that one string — no message,
 * body or field value. Consumes the response body, so call at most once per error.
 */
async function safeErrorCode(res: FetchResponseLike): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown } } | null
    const code = body?.error?.code
    return typeof code === 'string' ? code : null
  } catch {
    return null
  }
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams()
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, value)
    }
  }
  const qs = params.toString()
  return `${baseUrl}${path}${qs === '' ? '' : `?${qs}`}`
}

export function createApiRepository(
  options: ApiRepositoryOptions = {},
): DashboardRepository {
  const baseUrl = options.baseUrl ?? '/api'
  const doFetch = options.fetch ?? defaultFetch()

  /** Sentinel for a 404 on a single-entity lookup (a legitimate "not found"). */
  const NOT_FOUND = Symbol('not-found')

  /**
   * Fetch a resource, mapping transport/status failures to controlled errors.
   * When `allow404`, a 404 resolves to the `NOT_FOUND` sentinel instead of an
   * error (single-entity lookups map that to `null`, never a throw).
   */
  async function getJson(
    path: string,
    query?: Record<string, string | undefined>,
    allow404 = false,
  ): Promise<unknown> {
    const label = endpointLabel(path)
    const authHeaders = (await options.getAuthHeaders?.()) ?? {}
    let res: FetchResponseLike
    try {
      res = await doFetch(buildUrl(baseUrl, path, query), {
        method: 'GET',
        headers: { accept: 'application/json', ...authHeaders },
        credentials: 'same-origin',
      })
    } catch {
      // The request never completed (offline / DNS / connection reset): no status.
      throw withDiagnostics(new RepositoryUnavailableError(), {
        endpoint: label,
        status: null,
        contentType: null,
        code: 'NETWORK',
      })
    }
    const contentType = res.headers?.get('content-type') ?? null
    if (res.status === 401) {
      throw withDiagnostics(new RepositoryUnauthorizedError(), {
        endpoint: label,
        status: 401,
        contentType,
        code: await safeErrorCode(res),
      })
    }
    if (allow404 && res.status === 404) return NOT_FOUND
    if (!res.ok) {
      // A non-OK status. If Netlify killed the function (timeout/size) this is a
      // 502/504 with a text/html body — captured here as safe status + type so the
      // screen can show WHY instead of a dead-end message.
      throw withDiagnostics(new RepositoryUnavailableError(), {
        endpoint: label,
        status: res.status,
        contentType,
        code: await safeErrorCode(res),
      })
    }
    try {
      return await res.json()
    } catch {
      // 200 but not JSON (e.g. an HTML SPA-fallback body reaching a data call).
      throw withDiagnostics(
        new RepositoryResponseError('The dashboard returned malformed data.'),
        { endpoint: label, status: res.status, contentType, code: null },
      )
    }
  }

  function rangeQuery(
    query?: DateRangeQuery,
  ): Record<string, string | undefined> {
    return { start: query?.start, end: query?.end }
  }

  return {
    async getDataState(): Promise<DataStateDTO> {
      const parsed = dataStateDtoSchema.safeParse(await getJson('/data-state'))
      if (!parsed.success) throw new RepositoryResponseError()
      return parsed.data
    },

    async getSummary(query?: DateRangeQuery): Promise<SummaryDTO> {
      const parsed = summaryDtoSchema.safeParse(
        await getJson('/summary', rangeQuery(query)),
      )
      if (!parsed.success) throw new RepositoryResponseError()
      return parsed.data
    },

    async listCampaigns(query?: DateRangeQuery): Promise<CampaignDTO[]> {
      const parsed = campaignListSchema.safeParse(
        await getJson('/campaigns', rangeQuery(query)),
      )
      if (!parsed.success) throw new RepositoryResponseError()
      return parsed.data
    },

    async listAdSets(query?: AdSetQuery): Promise<AdSetDTO[]> {
      const parsed = adSetListSchema.safeParse(
        await getJson('/ad-sets', {
          ...rangeQuery(query),
          campaignId: query?.campaignId,
        }),
      )
      if (!parsed.success) throw new RepositoryResponseError()
      return parsed.data
    },

    async listAds(query?: AdQuery): Promise<AdDTO[]> {
      const parsed = adListSchema.safeParse(
        await getJson('/ads', {
          ...rangeQuery(query),
          campaignId: query?.campaignId,
          adSetId: query?.adSetId,
        }),
      )
      if (!parsed.success) throw new RepositoryResponseError()
      return parsed.data
    },

    async getAd(
      adId: string,
      query?: DateRangeQuery,
    ): Promise<AdDetailDTO | null> {
      const raw = await getJson(
        `/ads/${encodeURIComponent(adId)}`,
        rangeQuery(query),
        true,
      )
      if (raw === NOT_FOUND) return null
      const parsed = adDetailDtoSchema.safeParse(raw)
      if (!parsed.success) throw new RepositoryResponseError()
      return parsed.data
    },

    async getDaily(query?: DailyQuery): Promise<DailyRowDTO[]> {
      const parsed = dailyListSchema.safeParse(
        await getJson('/daily', {
          ...rangeQuery(query),
          campaignId: query?.campaignId,
          adSetId: query?.adSetId,
          adId: query?.adId,
          creativeId: query?.creativeId,
        }),
      )
      if (!parsed.success) throw new RepositoryResponseError()
      return parsed.data
    },

    async listCreatives(query?: CreativeQuery): Promise<CreativeRowDTO[]> {
      const raw = await getJson('/creatives', {
        ...rangeQuery(query),
        family: query?.family,
        optimizationEvent: query?.optimizationEvent,
        sort: query?.sort,
      })
      // Only a NON-list response is a structural integrity failure. A single
      // malformed creative must NOT take down the whole screen: parse per row,
      // keep the valid ones, and isolate (drop) any that fail. This makes the
      // dashboard resilient to one odd production creative or minor field drift.
      if (!Array.isArray(raw))
        throw withDiagnostics(new RepositoryResponseError(), {
          endpoint: 'creatives',
          status: 200,
          contentType: 'application/json',
          code: 'BAD_SHAPE',
        })
      const rows: CreativeRowDTO[] = []
      let dropped = 0
      for (const item of raw) {
        const parsed = creativeRowDtoSchema.safeParse(item)
        if (parsed.success) rows.push(parsed.data)
        else dropped += 1
      }
      if (dropped > 0) {
        // Safe: a count only — never an id, name, url, field value or payload.
        console.warn(
          `Creative Intelligence: ${dropped} creative(s) could not be read and were skipped.`,
        )
      }
      return rows
    },

    async getCreative(
      creativeId: string,
      query?: DateRangeQuery,
    ): Promise<CreativeRowDTO | null> {
      const raw = await getJson(
        `/creatives/${encodeURIComponent(creativeId)}`,
        rangeQuery(query),
        true,
      )
      if (raw === NOT_FOUND) return null
      const parsed = creativeRowDtoSchema.safeParse(raw)
      if (!parsed.success) throw new RepositoryResponseError()
      return parsed.data
    },
  }
}
