/**
 * The single, central list of Meta fields we request.
 *
 * Canonical home (Stage 5): this list lives here in `src/meta/` and is the one
 * authoritative field list for both the runtime mapping layer and the read-only
 * Stage 4 POC scripts — the fields shim under the scripts tree re-exports from
 * here. The boundary rule still holds: the dependency only ever points from the
 * scripts into `src/meta/`, never the reverse.
 *
 * Only fields CONFIRMED against the official v25.0 reference on 2026-07-14 are
 * listed. Object / list / uncertain fields are requested where officially
 * supported but are treated as unknown JSON at read time — no permanent typed
 * mapping is created until the live proof confirms the shape.
 */

// --- Dimension nodes -------------------------------------------------------

export const AD_ACCOUNT_FIELDS = [
  'id',
  'name',
  'currency',
  'timezone_name',
  'account_status',
] as const

export const CAMPAIGN_FIELDS = [
  'id',
  'account_id', // numeric string (bare digits — the NODE id is `act_<digits>`)
  'name',
  'objective', // open string — current ODAX + legacy values both possible
  'status',
  'effective_status',
  'buying_type',
  'created_time',
  'start_time', // read-only roll-up of child ad-set times
  'stop_time', // read-only roll-up of child ad-set times
  'updated_time',
] as const

export const AD_SET_FIELDS = [
  'id',
  'campaign_id',
  'account_id',
  'name',
  'status',
  'effective_status',
  'daily_budget', // minor currency units (string)
  'lifetime_budget', // minor currency units (string)
  'optimization_goal',
  'billing_event',
  'bid_strategy',
  'destination_type', // WEBSITE / ON_AD (Instant Form) / … — conversion destination
  'promoted_object', // object — the AUTHORITATIVE lead-vs-non-lead conversion evidence
  'start_time',
  'end_time', // ad-set schedule end (NOT stop_time)
  'updated_time',
  'targeting', // object — inspect raw
  'attribution_spec', // list<object> — lives on the AD SET node (not attribution_setting)
] as const

export const AD_FIELDS = [
  'id',
  'account_id',
  'campaign_id',
  'adset_id',
  'name',
  'status',
  'effective_status',
  'created_time',
  'updated_time',
] as const

/**
 * Creative is expanded inline on the Ad via field expansion, so we read it in
 * the same call. object_story_spec / asset_feed_spec are objects — inspect raw.
 */
export const AD_CREATIVE_SUBFIELDS = [
  'id',
  'name',
  'object_type',
  'body',
  'title',
  'call_to_action_type',
  'object_story_spec',
  'asset_feed_spec',
  'image_url',
  'thumbnail_url',
  'video_id',
  'effective_object_story_id',
] as const

export const AD_FIELDS_WITH_CREATIVE = [
  ...AD_FIELDS,
  `creative{${AD_CREATIVE_SUBFIELDS.join(',')}}`,
] as const

// --- Insights (ad level) ---------------------------------------------------

/**
 * Scalars — safe to read directly. `attribution_setting` is an INSIGHTS-only
 * field (the ad-set node exposes `attribution_spec` instead).
 */
export const INSIGHTS_SCALAR_FIELDS = [
  'date_start',
  'date_stop',
  'account_id',
  'campaign_id',
  'adset_id',
  'ad_id',
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
  'attribution_setting',
] as const

/**
 * list<AdsActionStats> fields — arrays of { action_type, value, ... }. Treated
 * as unknown JSON; NOT mapped to typed columns in Stage 4.
 *
 * NOTE: `landing_page_views` is deliberately ABSENT — it is not a top-level
 * field. It is discovered inside `actions` as action_type "landing_page_view".
 */
export const INSIGHTS_ACTION_STAT_FIELDS = [
  'actions',
  'action_values',
  'cost_per_action_type',
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

export const INSIGHTS_FIELDS = [
  ...INSIGHTS_SCALAR_FIELDS,
  ...INSIGHTS_ACTION_STAT_FIELDS,
] as const

/** Minimal field set for lead-action discovery. */
export const INSIGHTS_ACTION_DISCOVERY_FIELDS = [
  'campaign_id',
  'ad_id',
  'actions',
  'action_values',
  'cost_per_action_type',
] as const

/** The action_type carrying landing-page views (NOT a top-level field). */
export const LANDING_PAGE_VIEW_ACTION_TYPE = 'landing_page_view'
