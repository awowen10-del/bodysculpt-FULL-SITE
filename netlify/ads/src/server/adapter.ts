/**
 * Netlify Functions transport adapter (Stage 11E).
 *
 * Pure mapping between a Netlify (classic) function event and the transport-neutral
 * `ApiRequest`/`ApiResponse`. Keeping it pure means the whole request path is
 * unit-testable without a Netlify runtime or a database. The thin wiring that
 * opens the DB connection and reads env lives in `netlify/functions/api.ts`.
 *
 * No dependency on `@netlify/functions`: the minimal event/result shapes are
 * declared locally.
 */
import type { ApiRequest, ApiResponse } from './http.ts'

/** The subset of a Netlify classic function event this adapter reads. */
export interface NetlifyEvent {
  httpMethod: string
  path: string
  headers: Record<string, string | undefined>
  queryStringParameters: Record<string, string | undefined> | null
  body: string | null
}

/** The Netlify classic function result shape. */
export interface NetlifyResult {
  statusCode: number
  headers: Record<string, string>
  body: string
}

function lowerCaseHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v
  return out
}

/**
 * Normalise the request path to the router's `/api/...` space. A Netlify rewrite
 * usually preserves the original `/api/...` path; if the function is hit directly
 * at `/.netlify/functions/api/...`, that prefix is rewritten to `/api`.
 */
export function normaliseApiPath(rawPath: string): string {
  // v167: inside the Bodysculpt dashboard the ads API lives under /api/ads/… (the
  // dashboard's other functions keep their own addresses), served by the function
  // `ads-api`. Both spellings normalise to the /api/… paths the router has always
  // matched, so the router and its tests did not change.
  for (const prefix of ['/.netlify/functions/ads-api', '/api/ads']) {
    if (rawPath === prefix) return '/api'
    if (rawPath.startsWith(`${prefix}/`))
      return `/api/${rawPath.slice(prefix.length + 1)}`
  }
  const fn = '/.netlify/functions/api'
  if (rawPath === fn) return '/api'
  if (rawPath.startsWith(`${fn}/`))
    return `/api/${rawPath.slice(fn.length + 1)}`
  return rawPath
}

export function toApiRequest(event: NetlifyEvent): ApiRequest {
  return {
    method: event.httpMethod,
    path: normaliseApiPath(event.path),
    query: event.queryStringParameters ?? {},
    headers: lowerCaseHeaders(event.headers),
  }
}

export function toNetlifyResult(res: ApiResponse): NetlifyResult {
  return {
    statusCode: res.status,
    headers: { ...res.headers },
    body: JSON.stringify(res.body),
  }
}

/** Build a client-safe error result directly (used by the login route). */
export function errorResult(
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): NetlifyResult {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ error: { code, message } }),
  }
}
