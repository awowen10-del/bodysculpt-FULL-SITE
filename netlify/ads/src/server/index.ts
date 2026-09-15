/**
 * `server/` — the read-API server layer (Stage 11B). SERVER-ONLY.
 *
 * This barrel exposes the transport-agnostic, testable surface: HTTP shapes, the
 * client-safe error types, the auth seam, query/window validation, the read
 * repository, and the router. It deliberately does NOT re-export `runtime.ts`
 * (the live-connection wiring) so importing the testable surface never pulls in
 * the database client.
 *
 * Nothing here may ever be imported by the browser graph (`src/main.tsx`,
 * `src/App.tsx`, `src/ui/**`, `src/data/**`) — enforced by
 * `tests/boundaries/uiNoDbImports.test.ts` and `tests/boundaries/serverOnly.test.ts`.
 */
export type { ApiRequest, ApiResponse } from './http.ts'
export type { ApiErrorCode, ClientSafeError } from './errors.ts'
export { ApiError, toClientSafeError } from './errors.ts'
export type { AuthContext, Authenticator } from './auth.ts'
export {
  createBearerTokenAuthenticator,
  createDenyAllAuthenticator,
} from './auth.ts'
export {
  MAX_WINDOW_DAYS,
  parseDateRange,
  resolveWindow,
  inclusiveDays,
} from './validate.ts'
export type { DateBounds, DataExtent, ResolvedWindow } from './validate.ts'
export type { ReadDb } from './repository.ts'
export { createServerReadRepository } from './repository.ts'
export { materializeDataset } from './materialize.ts'
export type { ApiRouter, RouterDeps, ServerLogEvent } from './router.ts'
export { createApiRouter } from './router.ts'
