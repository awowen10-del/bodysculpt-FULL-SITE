# `sync/` — backfill + daily sync jobs

Orchestrates pulling Meta data and writing it to the database. Called by the
Netlify Functions in `netlify/functions/`; the heavy work runs in Background
Functions (≤15 min) because of Netlify's runtime limits.

- **Backfill:** chunked, resumable date windows; a failed window is retried, not
  the whole job.
- **Daily:** re-pulls a rolling 7-day window each night (Meta restates recent
  conversions), upserting so re-runs are safe.
- Every run is recorded in `sync_runs` (counts, timings, errors, rate limits).

> **Status (Stage 7):** implemented, **offline-only** (mock fetch + PGlite). The
> orchestrator (`orchestrator.ts`) wires the runtime read-only Meta client
> (`src/meta/graphClient.ts` + `fetchEntities.ts`) → Stage 5 normalisation →
> Stage 6 write primitives, with one `sync_runs` row per live-write request. It is
> **server-only** (never browser-reachable) and driven by the manual CLI
> `scripts/sync/run.ts` (`npm run sync`), dry-run by default. Live-write needs all
> four gates: the `--live-write` mode, the `--confirm-live-write` flag,
> `SYNC_CONFIRM_LIVE_WRITE=1`, and `DATABASE_URL`. No live fetch/write, no Netlify
> function, no RLS/role/migration in Stage 7. See `docs/STAGE-7-SYNC.md`.

## Stage 9 — first controlled live write (prepared, not yet run)

Three commands, in order. Full procedure: **`docs/STAGE-9-RUNBOOK.md`**.

| Command                      | Touches production?       | Writes?                  |
| ---------------------------- | ------------------------- | ------------------------ |
| `npm run db:preflight`       | yes — `DATABASE_URL`      | **no** (read-only txn)   |
| `npm run sync:rehearse`      | **no** — in-memory PGlite | yes, locally             |
| `npm run sync -- …`          | yes                       | **yes** — the real write |
| `npm run db:rollback-stage9` | yes — admin connection    | deletes one account      |

**Window:** `2026-07-13` → `2026-07-13`, level `manual`, scope `incremental`
(all three are the CLI defaults bar the dates — pass no level flag).

**A one-day window is not a small write.** The date range bounds the _insights_
only; `writeDimensions` always upserts the entire dimension graph.

**`records_written` is not evidence.** It counts input records submitted to
upserts that committed — not measured row changes — so on success it equals
`records_requested` by construction. Verify with `SELECT count(*)`. The
per-entity counts on `DryRunResult` / `LiveWriteResult` are the _prediction_;
the SQL counts are the _evidence_.

**`sync_runs.ad_account_id`** is populated at finalisation from the committed
dimension transaction. A `running` row has NULL — the run row is created before
the first Meta request, so no account is known yet.
