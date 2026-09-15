# `src/seed/` — local, deterministic seed dataset

> ⚠️ **ILLUSTRATIVE SEED DATA — NOT REAL, NOT A BENCHMARK.**
> Every number in this folder is **invented** so the local dashboard has
> something plausible to render offline. It is **not** real Bodysculpt
> performance, **not** sourced from Meta, and must **never** be read as a target,
> a typical value, or a benchmark. The live production data path is untouched.

This is the Stage 10, **Phase 1** deliverable: a fixed, offline dataset that will
power the local seed dashboard (metrics layer and UI come in later, separately
approved phases — they are **not** started here).

## What it produces

`buildSeedDataset()` returns one normalised graph:

| Entity         | Count | Source                                             |
| -------------- | ----- | -------------------------------------------------- |
| Ad account     | 1     | `fixtures/adAccounts.json`                         |
| Campaigns      | 3     | `fixtures/campaigns.json`                          |
| Ad sets        | 6     | `fixtures/adSets.json` (2 per campaign)            |
| Ads            | 12    | `fixtures/ads.json` (2 per ad set)                 |
| Creatives      | 12    | derived from each ad's inline `creative` expansion |
| Daily insights | 168   | generated: 12 ads × 14 days                        |

The window is **14 days ending 2026-07-13** (2026-06-30 → 2026-07-13). The
dashboard's default visible date is `meta.endDate` (2026-07-13).

## How it is built

```
fixtures/*.json  ──┐
(hand-written raw  │
 Meta-shaped       │      normalize.ts          buildSeedDataset()
 dimensions)       ├──▶  (the SAME mapping  ──▶  SeedDataset
profiles.ts +      │       used by the live         { adAccounts, campaigns,
generateInsights   │       sync — no bespoke          adSets, creatives,
(raw insight rows) ┘       normalisation here)        ads, insights, meta }
```

- **`fixtures/*.json`** — hand-written **raw** Meta-shaped dimension records, in
  exactly the shape the Marketing API returns (creatives arrive inline on ads).
- **`profiles.ts`** — the invented per-ad delivery "shape" (baseline volumes and
  per-1000-impression rates) plus the seed constants and the date helper. Pure
  data.
- **`generateInsights.ts`** — turns profiles + dates into **raw** Meta-shaped
  insight rows (string scalars, `list<AdsActionStats>` arrays).
- **`buildSeedDataset.ts`** — passes **all** raw data through
  `src/meta/normalize.ts`, derives creatives from the ads exactly as the sync
  layer does, and returns the `SeedDataset`.

Because everything goes through `normalize.ts`, the seed exercises the real
validation, `bigint` counts, exact-decimal strings and null handling — not a
parallel mock of them.

## Determinism

There is **no `Math.random`** and no wall-clock input. Day-to-day variation comes
from `wobble(adIndex, dayIndex)`, a pure integer hash, so **every build produces a
byte-identical dataset**. This is asserted in
`tests/seed/buildSeedDataset.test.ts`.

## Deliberate edge cases (so the dashboard can show honest "—" states)

- **Dark days** (`AdProfile.darkDays`) emit a genuine **zero row** with `reach`
  and the reported ratios **absent** → normalised to `null`. This gives the
  metrics/UI layer real data behind undefined ratios (CPM/CTR/CPC/frequency with
  a zero or missing denominator). Eight such rows exist.
- **Leads stay `null`** under the shipped **`unresolved`** lead definition (the
  default in `src/config/leadActionConfig.ts`). The lead **components** are still
  present in each `actions` array, so a future, explicitly reviewed lead-mode
  change can compute totals without regenerating the seed. Choosing a lead mode
  is **not** part of Phase 1.

> Note: real Meta typically **omits** an ad's row on a zero-delivery day. The
> seed instead emits a full 12 × 14 grid (168 rows) with explicit zero rows, so
> the count is fixed and deterministic. This is a documented seed simplification.

## Boundaries

This folder imports **only** the normalisation layer, shared types, config, and
its own modules. It never imports the database, Postgres, the sync layer, the
graph client, or any server-only module, and opens **no** connection and reads
**no** credentials — it is safe to import into the browser bundle.
