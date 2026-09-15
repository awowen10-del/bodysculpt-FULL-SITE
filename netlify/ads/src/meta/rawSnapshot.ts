/**
 * Strict, reviewed allow-list for the `raw_snapshot` JSONB kept on each daily
 * insight (Stage 5).
 *
 * Purpose: preserve only the Meta fields useful for provenance and future
 * debugging — the exact scalar strings Meta sent, and the action-stat ARRAYS we
 * reduce to scalar columns (so a mis-mapped `outbound_clicks` / `video_*` can be
 * re-derived without re-calling Meta).
 *
 * Deliberately EXCLUDED (never persisted): entity/account ids, paging, URLs,
 * headers, trace metadata, rate-limit metadata, tokens, any credential-like
 * value, personal lead data, and any unknown/unexpected response field. Only the
 * keys on this list survive; everything else is dropped. The `actions` /
 * `action_values` / `cost_per_action_type` arrays already have their own typed
 * JSONB columns, so they are not duplicated here.
 */
export const INSIGHT_SNAPSHOT_ALLOWLIST = [
  'date_start',
  'date_stop',
  'attribution_setting',
  'spend',
  'impressions',
  'reach',
  'frequency',
  'clicks',
  'ctr',
  'cpc',
  'cpm',
  'inline_link_clicks',
  'inline_link_click_ctr',
  'cost_per_inline_link_click',
  'outbound_clicks',
  'outbound_clicks_ctr',
  'cost_per_outbound_click',
  'video_play_actions',
  'video_p25_watched_actions',
  'video_p50_watched_actions',
  'video_p75_watched_actions',
  'video_p95_watched_actions',
  'video_p100_watched_actions',
  'video_avg_time_watched_actions',
  'cost_per_thruplay',
] as const

/**
 * Build the allow-listed provenance snapshot for one raw insight row. Only keys
 * on `INSIGHT_SNAPSHOT_ALLOWLIST` that are actually present (and not `undefined`)
 * are copied; every other field — including anything unexpected — is dropped.
 */
export function buildInsightRawSnapshot(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {}
  for (const key of INSIGHT_SNAPSHOT_ALLOWLIST) {
    if (key in raw && raw[key] !== undefined) {
      snapshot[key] = raw[key]
    }
  }
  return snapshot
}
