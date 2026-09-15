# `metrics/` — the single authoritative metrics/aggregation layer

The **one** place metrics like CPM, CTR, CPC, CPL are computed. Every displayed
number comes from here.

**Rule:** ratio metrics are computed from **summed numerator ÷ summed
denominator** — never by averaging row-level ratios. This layer also produces
totals, date-range aggregations, and comparison-period figures.

Each metric records whether it is _sourced_, _calculated_, or _manually
entered_, mirroring `docs/METRIC-DICTIONARY-DRAFT.md`.
