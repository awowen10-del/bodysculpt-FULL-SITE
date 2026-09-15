import { sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { metricDefinitions } from './schema/index.ts'

/**
 * Idempotent seed for `metric_definitions` — mirrors docs/METRIC-DICTIONARY-DRAFT.md.
 *
 * Pure of any connection: `seedMetricDefinitions` takes a Drizzle db handle and
 * upserts on `key`. Running it twice changes nothing (no duplicates). The
 * connecting CLI runner is added in the Supabase connect sub-stage; this module
 * makes no connection when imported.
 */
export interface MetricDefinitionSeed {
  key: string
  label: string
  meaning: string
  formula: string | null
  metaSource: string | null
  validLevel: string | null
  origin: 'sourced' | 'calculated' | 'manual'
  limitations: string | null
}

const ALL_LEVELS = 'ad/adset/campaign/account'

export const METRIC_DEFINITIONS: MetricDefinitionSeed[] = [
  // --- Sourced (direct from Meta) ---
  {
    key: 'spend',
    label: 'Spend',
    meaning: 'Amount spent, in the account currency (major units).',
    formula: null,
    metaSource: 'spend',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'Recent values may be restated as attribution settles. [POC]',
  },
  {
    key: 'impressions',
    label: 'Impressions',
    meaning: 'Number of times ads were shown.',
    formula: null,
    metaSource: 'impressions',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: null,
  },
  {
    key: 'reach',
    label: 'Reach',
    meaning: 'Unique people reached.',
    formula: null,
    metaSource: 'reach',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'NOT additive across dates — summing daily reach overcounts.',
  },
  {
    key: 'frequency',
    label: 'Frequency (reported)',
    meaning: 'Average times each person saw an ad (Meta-reported daily value).',
    formula: null,
    metaSource: 'frequency',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations:
      'Provenance only; period frequency needs care (reach non-additive).',
  },
  {
    key: 'clicks',
    label: 'Clicks (all)',
    meaning: 'All clicks of any type.',
    formula: null,
    metaSource: 'clicks',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'Not the same as link clicks; includes non-link interactions.',
  },
  {
    key: 'inline_link_clicks',
    label: 'Link clicks',
    meaning: "Clicks on the ad's link.",
    formula: null,
    metaSource: 'inline_link_clicks',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'Use this, not `clicks`, for link performance.',
  },
  {
    key: 'outbound_clicks',
    label: 'Outbound clicks',
    meaning: 'Clicks leaving Meta (e.g. to your site).',
    formula: null,
    metaSource: 'outbound_clicks',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'Nested type; may differ from link clicks.',
  },
  {
    key: 'reported_cpm',
    label: 'CPM (reported)',
    meaning: 'Cost per 1,000 impressions, as reported by Meta.',
    formula: null,
    metaSource: 'cpm',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations:
      'Provenance only; recompute for period totals (see cpm_period).',
  },
  {
    key: 'reported_cpc',
    label: 'CPC — all clicks (reported)',
    meaning: 'Cost per click (any click), as reported by Meta.',
    formula: null,
    metaSource: 'cpc',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'Based on all clicks, not link clicks. Provenance only.',
  },
  {
    key: 'reported_ctr',
    label: 'CTR — all clicks (reported)',
    meaning: 'Click-through rate (any click), as reported by Meta.',
    formula: null,
    metaSource: 'ctr',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'Not link CTR. Provenance only.',
  },
  {
    key: 'reported_inline_link_click_ctr',
    label: 'Link CTR (reported)',
    meaning: 'Link click-through rate, as reported by Meta.',
    formula: null,
    metaSource: 'inline_link_click_ctr',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'Provenance only; recompute for period totals.',
  },
  {
    key: 'reported_cost_per_inline_link_click',
    label: 'Cost per link click (reported)',
    meaning: 'Cost per inline link click, as reported by Meta.',
    formula: null,
    metaSource: 'cost_per_inline_link_click',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'Provenance only.',
  },
  {
    key: 'reported_outbound_clicks_ctr',
    label: 'Outbound CTR (reported)',
    meaning: 'Outbound click-through rate, as reported by Meta.',
    formula: null,
    metaSource: 'outbound_clicks_ctr',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'Nested type. Provenance only.',
  },
  {
    key: 'reported_cost_per_outbound_click',
    label: 'Cost per outbound click (reported)',
    meaning: 'Cost per outbound click, as reported by Meta.',
    formula: null,
    metaSource: 'cost_per_outbound_click',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'Nested type. Provenance only.',
  },
  {
    key: 'video_play_actions',
    label: 'Video plays (started)',
    meaning: 'Video play actions (plays started).',
    formula: null,
    metaSource: 'video_play_actions',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations:
      '"Plays" is not necessarily a 3-second view. [POC] confirm meaning.',
  },
  {
    key: 'video_thruplay_watched_actions',
    label: 'ThruPlays',
    meaning: 'Plays to completion or ≥15s.',
    formula: null,
    metaSource: 'video_thruplay_watched_actions',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations:
      '[POC] exact field name unconfirmed — kept in raw JSON, no column yet.',
  },
  {
    key: 'video_p25_watched_actions',
    label: 'Video watched 25%',
    meaning: 'Views reaching 25% of the video.',
    formula: null,
    metaSource: 'video_p25_watched_actions',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'Extracted from list<AdsActionStats>.',
  },
  {
    key: 'video_p50_watched_actions',
    label: 'Video watched 50%',
    meaning: 'Views reaching 50% of the video.',
    formula: null,
    metaSource: 'video_p50_watched_actions',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'Extracted from list<AdsActionStats>.',
  },
  {
    key: 'video_p75_watched_actions',
    label: 'Video watched 75%',
    meaning: 'Views reaching 75% of the video.',
    formula: null,
    metaSource: 'video_p75_watched_actions',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'Extracted from list<AdsActionStats>.',
  },
  {
    key: 'video_p95_watched_actions',
    label: 'Video watched 95%',
    meaning: 'Views reaching 95% of the video.',
    formula: null,
    metaSource: 'video_p95_watched_actions',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'Extracted from list<AdsActionStats>.',
  },
  {
    key: 'video_p100_watched_actions',
    label: 'Video watched 100%',
    meaning: 'Views reaching 100% of the video.',
    formula: null,
    metaSource: 'video_p100_watched_actions',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'Extracted from list<AdsActionStats>.',
  },
  {
    key: 'reported_video_avg_time_watched_actions',
    label: 'Avg video watch time (reported)',
    meaning: 'Average seconds watched, as reported by Meta.',
    formula: null,
    metaSource: 'video_avg_time_watched_actions',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'Averaging across rows needs care. Provenance only.',
  },
  {
    key: 'reported_cost_per_thruplay',
    label: 'Cost per ThruPlay (reported)',
    meaning: 'Cost per ThruPlay, as reported by Meta.',
    formula: null,
    metaSource: 'cost_per_thruplay',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'Provenance only.',
  },
  {
    key: 'leads',
    label: 'Leads',
    meaning: 'Count of the chosen lead action from the nested actions list.',
    formula: null,
    metaSource: 'actions[action_type = (chosen)]',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations:
      'action_type is [POC — deferred]; each row records which type was used.',
  },
  {
    key: 'landing_page_views',
    label: 'Landing-page views',
    meaning: 'Landing-page view actions.',
    formula: null,
    metaSource: 'actions[action_type = landing_page_view]',
    validLevel: ALL_LEVELS,
    origin: 'sourced',
    limitations: 'Requires the LP-view event firing. [POC] confirm presence.',
  },

  // --- Calculated (computed locally from summed components) ---
  {
    key: 'cpm_period',
    label: 'CPM (period)',
    meaning: 'Cost per 1,000 impressions across the selected period.',
    formula: '(Σ spend ÷ Σ impressions) × 1000',
    metaSource: 'spend, impressions',
    validLevel: ALL_LEVELS,
    origin: 'calculated',
    limitations: 'Recompute for totals; never average daily CPMs.',
  },
  {
    key: 'cpc_link_period',
    label: 'CPC — link (period)',
    meaning: 'Cost per link click across the selected period.',
    formula: 'Σ spend ÷ Σ inline_link_clicks',
    metaSource: 'spend, inline_link_clicks',
    validLevel: ALL_LEVELS,
    origin: 'calculated',
    limitations: 'Undefined if link clicks = 0 → shown as "—", not 0.',
  },
  {
    key: 'link_ctr_period',
    label: 'Link CTR (period)',
    meaning: 'Link click-through rate across the selected period.',
    formula: 'Σ inline_link_clicks ÷ Σ impressions',
    metaSource: 'inline_link_clicks, impressions',
    validLevel: ALL_LEVELS,
    origin: 'calculated',
    limitations: 'Never average row-level CTRs.',
  },
  {
    key: 'cpl_period',
    label: 'CPL (period)',
    meaning: 'Cost per lead across the selected period.',
    formula: 'Σ spend ÷ Σ leads',
    metaSource: 'spend, chosen lead action',
    validLevel: ALL_LEVELS,
    origin: 'calculated',
    limitations:
      'Depends on [POC] lead action_type; undefined if leads = 0 → "—".',
  },
  {
    key: 'landing_page_view_rate',
    label: 'Landing-page-view rate',
    meaning: 'Landing-page views per link click.',
    formula: 'Σ landing_page_views ÷ Σ inline_link_clicks',
    metaSource: 'landing_page_view action, inline_link_clicks',
    validLevel: ALL_LEVELS,
    origin: 'calculated',
    limitations:
      '[POC] requires LP-view events; denominator choice documented.',
  },
  {
    key: 'video_play_rate',
    label: 'Video play rate',
    meaning: 'Video plays per impression.',
    formula: 'Σ video_play_actions ÷ Σ impressions',
    metaSource: 'video_play_actions, impressions',
    validLevel: ALL_LEVELS,
    origin: 'calculated',
    limitations:
      'Labelled "play rate", not "3-second rate". [POC] confirm meaning.',
  },
  {
    key: 'frequency_period',
    label: 'Frequency (period)',
    meaning:
      'Average impressions per person across a period — handled carefully.',
    formula:
      'Requires a valid unique-reach figure; summed daily reach is wrong',
    metaSource: 'impressions, reach',
    validLevel: ALL_LEVELS,
    origin: 'calculated',
    limitations:
      'Reach is not additive; shown with a caveat or a valid reach figure.',
  },

  // --- Manual (entered by Ash, in the business-context layer) ---
  {
    key: 'campaign_type',
    label: 'Campaign type',
    meaning: 'cold / warm / retargeting / unknown.',
    formula: null,
    metaSource: null,
    validLevel: 'campaign',
    origin: 'manual',
    limitations: 'Kept in manual_campaign_context, separate from Meta data.',
  },
  {
    key: 'offer',
    label: 'Offer',
    meaning: '6-Week Challenge / membership / lead magnet / custom.',
    formula: null,
    metaSource: null,
    validLevel: 'campaign',
    origin: 'manual',
    limitations: null,
  },
  {
    key: 'audience_purpose',
    label: 'Audience purpose',
    meaning: 'Free-text description of the audience intent.',
    formula: null,
    metaSource: null,
    validLevel: 'campaign',
    origin: 'manual',
    limitations: null,
  },
  {
    key: 'include_in_benchmarks',
    label: 'Include in benchmarks',
    meaning: 'Whether this campaign is eligible for later benchmarking.',
    formula: null,
    metaSource: null,
    validLevel: 'campaign',
    origin: 'manual',
    limitations: 'Not used in Phase 1 analysis.',
  },
  {
    key: 'known_anomalies',
    label: 'Known anomalies',
    meaning:
      'Free-text notes, e.g. tracking failure or operational disruption.',
    formula: null,
    metaSource: null,
    validLevel: 'campaign',
    origin: 'manual',
    limitations: null,
  },
]

export async function seedMetricDefinitions<
  TQuery extends PgQueryResultHKT,
  TFull extends Record<string, unknown>,
>(db: PgDatabase<TQuery, TFull>): Promise<void> {
  await db
    .insert(metricDefinitions)
    .values(METRIC_DEFINITIONS)
    .onConflictDoUpdate({
      target: metricDefinitions.key,
      set: {
        label: sql`excluded.label`,
        meaning: sql`excluded.meaning`,
        formula: sql`excluded.formula`,
        metaSource: sql`excluded.meta_source`,
        validLevel: sql`excluded.valid_level`,
        origin: sql`excluded.origin`,
        limitations: sql`excluded.limitations`,
        updatedAt: sql`now()`,
      },
    })
}
