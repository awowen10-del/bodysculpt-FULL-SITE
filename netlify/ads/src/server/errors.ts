/**
 * Client-safe API errors (Stage 11B).
 *
 * The ONLY error shape a client ever sees is `{ error: { code, message } }` with a
 * generic, single-line message. No stack, SQL, connection string, Meta id, or
 * internal UUID may ever reach a response body — `toClientSafeError` guarantees
 * that any non-`ApiError` collapses to a generic INTERNAL error.
 */

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'INVALID_QUERY'
  | 'RANGE_TOO_LARGE'
  | 'METHOD_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INTERNAL'

/** The exact JSON body shape returned on any error. */
export interface ClientSafeError {
  error: { code: ApiErrorCode; message: string }
}

/**
 * A deliberately-thrown, safe-to-surface API error. `safeMessage` is written to be
 * shown to a client verbatim; it must never be built from an exception's text.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly safeMessage: string

  constructor(code: ApiErrorCode, status: number, safeMessage: string) {
    super(`${code}: ${safeMessage}`)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.safeMessage = safeMessage
  }
}

export const unauthorized = (
  message = 'Authentication is required.',
): ApiError => new ApiError('UNAUTHORIZED', 401, message)

export const invalidQuery = (
  message = 'The request was not valid.',
): ApiError => new ApiError('INVALID_QUERY', 400, message)

export const rangeTooLarge = (message: string): ApiError =>
  new ApiError('RANGE_TOO_LARGE', 400, message)

export const methodNotAllowed = (): ApiError =>
  new ApiError('METHOD_NOT_ALLOWED', 405, 'Only GET requests are supported.')

export const notFound = (): ApiError =>
  new ApiError('NOT_FOUND', 404, 'The requested resource was not found.')

export const internalError = (): ApiError =>
  new ApiError('INTERNAL', 500, 'Something went wrong.')

/**
 * Map any thrown value to a safe `{ status, body }`. A known `ApiError` keeps its
 * code/status/message; anything else becomes a generic INTERNAL error so no
 * technical detail can leak. This is the single choke point for error output.
 */
export function toClientSafeError(err: unknown): {
  status: number
  body: ClientSafeError
} {
  const safe = err instanceof ApiError ? err : internalError()
  return {
    status: safe.status,
    body: { error: { code: safe.code, message: safe.safeMessage } },
  }
}
