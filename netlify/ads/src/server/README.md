# `server/` — read-API server layer (Stage 11B)

**SERVER-ONLY.** Never import anything here from browser-reachable code
(`src/main.tsx`, `src/App.tsx`, `src/ui/**`, `src/data/**`). Two boundary tests
enforce this.

Stage 11B implements the **first vertical slice only**: `getDataState` and
`getSummary`. The remaining seven endpoints arrive in Stage 11C.

## Layout

- `http.ts` — transport-agnostic `ApiRequest` / `ApiResponse` shapes (pure data).
- `errors.ts` — `ApiError` + the `{ error: { code, message } }` client-safe shape;
  `toClientSafeError` is the single choke point that collapses any non-`ApiError`
  to a generic INTERNAL error (no leak).
- `auth.ts` — the `Authenticator` seam + an injectable bearer-token authenticator
  for tests/local dev. **No production vendor is wired** (see the plan §5).
- `validate.ts` — `zod` query validation and window resolution/clamping
  (`MAX_WINDOW_DAYS = 400`).
- `repository.ts` — `createServerReadRepository(db)`: reads Postgres via an
  injected Drizzle handle (PGlite in tests) and reuses `src/metrics` +
  `src/data/dto.ts`. **No second metrics implementation; no arithmetic here.**
- `router.ts` — GET-only, authenticates every route, routes to the repository,
  and maps every failure to a safe body.
- `runtime.ts` — the ONLY module that opens a live connection
  (`createRuntimeConnection` reads `DATABASE_URL` at call time). Not exercised by
  tests; not re-exported from `index.ts`.

## Request lifecycle

`adapter → ApiRequest → router.handle → authenticate → route → repository →
metrics/dto → ApiResponse → adapter`. A hosting adapter (e.g. a Netlify function)
maps the platform event to an `ApiRequest` and renders the `ApiResponse`; it is
not built in Stage 11B.

## Guarantees

- Every endpoint rejects unauthenticated requests (`401`).
- Only GET is accepted (`405` otherwise).
- DTOs are byte-identical in shape to the seed repository's (same converters).
- No stack, SQL, connection string, Meta id or internal UUID ever reaches a
  response body or a log line.
- The live lead definition stays unresolved: `leads` / `cpl` are unavailable
  (`lead_definition_unresolved`) until a reviewed change verifies the mapping.
