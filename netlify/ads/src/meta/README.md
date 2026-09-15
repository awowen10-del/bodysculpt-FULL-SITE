# `meta/` — Meta field lists + the one field-mapping layer

The **only** place that knows Meta's field names, and the **one authoritative
normalisation layer** that turns raw Meta responses into our internal shapes.

## What's here (Stage 5 — normalisation only)

- `fields.ts` — the authoritative Meta field list (canonical home; the Stage 4
  read-only scripts re-export it).
- `actions.ts` — shared pure primitives for walking `list<AdsActionStats>`
  arrays (`readActionStats`) + a lenient CLI-only display coercion.
- `redact.ts` — redaction primitives (canonical home; scripts re-export).
- `normalize.ts` — `normalize{AdAccount,Campaign,AdSet,Ad,Creative,DailyInsight}`
  (+ list helpers): raw Meta → typed internal objects keyed by **Meta natural
  ids**. Extracts named metrics from the nested action arrays and keeps an
  allow-listed provenance snapshot.
- `leadExtraction.ts` — the config-driven lead / landing-page-view engine and
  the fail-closed double-count guard.
- `rawSnapshot.ts` — the strict allow-list for `raw_snapshot`.

### Stage 7 runtime client (server-only)

- `graphClient.ts` — the promoted runtime networking core (cursor pagination with
  repeated-cursor/malformed-pagination protection, retries, typed sanitised
  rate-limit parser). The Stage 4 POC client re-exports from here.
- `runtimeConfig.ts` — **server-only** Meta config (reads `META_*` at call time;
  `META_API_VERSION` must equal the supported version).
- `fetchEntities.ts` — read-only runtime fetchers for account/campaigns/ad sets/
  ads (+inline creative)/insights. Used only by `src/sync/`.

## Boundaries and scope

- **No network, no database.** Stage 5 is pure mapping/validation. The live
  server-side client (auth, cursor pagination, rate-limit headers, retries) and
  the DB write/upsert path are **later stages**. Raw scalars are read via
  `src/validation/metaResponses.ts`.
- **UUID FKs are deferred.** Normalised objects carry Meta ids; resolving them to
  database UUIDs and upserting happens in the write stage.
- **Import direction:** shared pure logic lives here in `src/meta/`; the
  `scripts/meta/` POC re-exports from it. `src/` never imports `scripts/meta/`.
- API version comes from `src/config/metaApiVersion.ts` — never hard-coded here.

## Value rules (via `src/validation/`)

Genuine absence → `null`; a valid zero stays zero; a malformed present value
**fails loudly**; integer counts are lossless `bigint` (never JavaScript
`Number`); decimals are kept as exact strings; unknown extra fields are ignored
unless explicitly allow-listed into `raw_snapshot`.

## Leads

The lead metric is a **mapping choice**, not a fact. It is configured as data in
`src/config/leadActionConfig.ts` (named, mutually-exclusive modes) and the
shipped default is `unresolved` — no authoritative lead total is computed and
`leads` stays null until a reviewed change selects a mode. The generic `lead`
aggregate can never be combined with its components, and the custom conversion is
always excluded. See `docs/STAGE-5-NORMALISATION.md`.
