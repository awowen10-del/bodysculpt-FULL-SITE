/**
 * Shared, pure primitives for reading Meta `list<AdsActionStats>` arrays
 * (`actions`, `action_values`, `cost_per_action_type`, `outbound_clicks`,
 * `video_*_watched_actions`, …). Each is a list of `{ action_type, value }`
 * objects.
 *
 * Canonical home (Stage 5): both the runtime lead-extraction engine
 * (`src/meta/leadExtraction.ts`) and the read-only Stage 4 discovery aggregator
 * (`actionAggregation.ts`, under the scripts tree) build on `readActionStats` so
 * the "walk an actions array safely" logic exists exactly once. The dependency
 * only ever points from the scripts into `src/meta/`, never the reverse.
 *
 * No network, no env, no side effects — fully unit-testable and offline.
 */

/** One well-formed entry parsed from a Meta AdsActionStats array. */
export interface ActionStatEntry {
  actionType: string
  /** The raw `value` exactly as Meta returned it — coerce at the call site. */
  rawValue: unknown
}

/**
 * Walk a Meta actions array, yielding only well-formed `{ action_type, value }`
 * entries. Malformed entries — non-arrays, non-object members, or members
 * without a string `action_type` — are skipped (never throw). Value coercion is
 * deliberately left to the caller: the CLI discovery path coerces leniently for
 * display, while the runtime path parses strictly and losslessly.
 */
export function readActionStats(actions: unknown): ActionStatEntry[] {
  if (!Array.isArray(actions)) return []
  const out: ActionStatEntry[] = []
  for (const entry of actions) {
    if (typeof entry !== 'object' || entry === null) continue
    const rec = entry as Record<string, unknown>
    if (typeof rec.action_type !== 'string') continue
    out.push({ actionType: rec.action_type, rawValue: rec.value })
  }
  return out
}

/**
 * Lenient numeric coercion for CLI DISCOVERY DISPLAY ONLY — an invalid or
 * missing value becomes 0 so a review table always renders. The runtime,
 * authoritative path must NOT use this; it parses strictly (fail-loud,
 * bigint-safe) via `src/validation/metaResponses.ts`.
 */
export function coerceActionCountLenient(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}
