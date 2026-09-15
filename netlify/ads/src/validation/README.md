# `validation/` — input & response validation, null handling

Validates Meta API responses and any user input before it is trusted by the rest
of the app, so malformed or missing data fails loudly and early rather than
silently corrupting stored facts.

## What's here (Stage 5)

- `metaResponses.ts` — the strict, lossless, fail-loud scalar parsers plus `zod`
  structural checks (`parseMetaListEnvelope`, `asGraphEntity`). Used by the
  `src/meta/` mapping layer.

## Rules (deliberate and strict)

- **Genuine absence** (`undefined` / JSON `null`) → `null`.
- **A valid zero stays zero** (`"0"` → `0n`, `"0.0"` → `"0.0"`).
- **A malformed present value fails loudly** (`MetaValidationError`) — it is
  never silently coerced to `null` or `0`.
- **Integer counts are lossless `bigint`** and never pass through JavaScript's
  `Number` (unsafe beyond 2^53). **Decimals stay exact strings.**

Missing/unavailable Meta fields are handled explicitly here and surfaced honestly
downstream — never invented or defaulted to a misleading zero.
