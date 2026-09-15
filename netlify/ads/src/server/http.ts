/**
 * Transport-agnostic HTTP request/response shapes for the read API (Stage 11B).
 *
 * The server layer is deliberately decoupled from any hosting vendor: a thin
 * Netlify (or other) adapter maps its native event to an `ApiRequest`, calls the
 * router, and renders the returned `ApiResponse`. Nothing here imports a runtime
 * or a database — it is pure data.
 */

/** A normalised inbound request. Header keys are expected lower-cased. */
export interface ApiRequest {
  /** HTTP method, e.g. `'GET'`. Non-GET is rejected by the router. */
  method: string
  /** Path only, e.g. `'/api/summary'` (no query string). */
  path: string
  /** Parsed query parameters; a missing param is `undefined`. */
  query: Readonly<Record<string, string | undefined>>
  /** Lower-cased header map; a missing header is `undefined`. */
  headers: Readonly<Record<string, string | undefined>>
}

/** A JSON response. `body` is serialised by the adapter; never a raw error. */
export interface ApiResponse {
  status: number
  body: unknown
  headers: Readonly<Record<string, string>>
}
