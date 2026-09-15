import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
  numeric,
  bigint,
  jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core'
import { ads } from './ads.ts'
import { adSets } from './adSets.ts'
import { campaigns } from './campaigns.ts'
import { adAccounts } from './adAccounts.ts'
import { auditTimestamps } from './columns.ts'

/**
 * One row per (ad, date). Additive base metrics keep plain names and ARE the
 * source of truth for period aggregation. `reported_*` columns are Meta's own
 * daily ratios/costs, retained for provenance/reconciliation ONLY — the metrics
 * layer must never aggregate them; it recomputes from summed base columns.
 *
 * `spend` is stored in MAJOR currency units (Meta returns a decimal string).
 * `video_thruplay_watched_actions` is intentionally absent ([POC] field name) —
 * it survives in `actions` / `raw_snapshot` until verified.
 */
export const dailyAdInsights = pgTable(
  'daily_ad_insights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adId: uuid('ad_id')
      .notNull()
      .references(() => ads.id, { onDelete: 'restrict' }),
    adSetId: uuid('ad_set_id')
      .notNull()
      .references(() => adSets.id, { onDelete: 'restrict' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),
    adAccountId: uuid('ad_account_id')
      .notNull()
      .references(() => adAccounts.id, { onDelete: 'restrict' }),
    date: date('date').notNull(),
    currency: text('currency').notNull(),

    // --- additive base metrics (source of truth) ---
    // NOTE: bigint columns use `mode: 'bigint'` (Stage 6) so Stage 5's lossless
    // bigint values cross the write boundary WITHOUT passing through JavaScript
    // `Number` (unsafe > 2^53). The underlying PostgreSQL type is unchanged
    // (bigint/int8); this is a driver-representation change only.
    spend: numeric('spend', { precision: 18, scale: 6 }),
    impressions: bigint('impressions', { mode: 'bigint' }),
    reach: bigint('reach', { mode: 'bigint' }), // NON-additive across dates
    clicks: bigint('clicks', { mode: 'bigint' }),
    inlineLinkClicks: bigint('inline_link_clicks', { mode: 'bigint' }),
    outboundClicks: bigint('outbound_clicks', { mode: 'bigint' }),
    videoPlayActions: bigint('video_play_actions', { mode: 'bigint' }),
    videoP25WatchedActions: bigint('video_p25_watched_actions', {
      mode: 'bigint',
    }),
    videoP50WatchedActions: bigint('video_p50_watched_actions', {
      mode: 'bigint',
    }),
    videoP75WatchedActions: bigint('video_p75_watched_actions', {
      mode: 'bigint',
    }),
    videoP95WatchedActions: bigint('video_p95_watched_actions', {
      mode: 'bigint',
    }),
    videoP100WatchedActions: bigint('video_p100_watched_actions', {
      mode: 'bigint',
    }),
    leads: bigint('leads', { mode: 'bigint' }), // null until action_type chosen
    landingPageViews: bigint('landing_page_views', { mode: 'bigint' }),

    // --- Meta-reported ratios/costs (provenance ONLY, not source of truth) ---
    reportedFrequency: numeric('reported_frequency', {
      precision: 14,
      scale: 6,
    }),
    reportedCpm: numeric('reported_cpm', { precision: 18, scale: 6 }),
    reportedCtr: numeric('reported_ctr', { precision: 14, scale: 6 }),
    reportedCpc: numeric('reported_cpc', { precision: 18, scale: 6 }),
    reportedInlineLinkClickCtr: numeric('reported_inline_link_click_ctr', {
      precision: 14,
      scale: 6,
    }),
    reportedCostPerInlineLinkClick: numeric(
      'reported_cost_per_inline_link_click',
      { precision: 18, scale: 6 },
    ),
    reportedOutboundClicksCtr: numeric('reported_outbound_clicks_ctr', {
      precision: 14,
      scale: 6,
    }),
    reportedCostPerOutboundClick: numeric('reported_cost_per_outbound_click', {
      precision: 18,
      scale: 6,
    }),
    reportedCostPerThruplay: numeric('reported_cost_per_thruplay', {
      precision: 18,
      scale: 6,
    }),
    reportedVideoAvgTimeWatchedActions: numeric(
      'reported_video_avg_time_watched_actions',
      { precision: 14, scale: 6 },
    ),

    // --- provenance for extracted actions ---
    leadsActionType: text('leads_action_type'),
    landingPageViewsActionType: text('landing_page_views_action_type'),

    // --- raw nested arrays + metadata ---
    actions: jsonb('actions'),
    actionValues: jsonb('action_values'),
    costPerActionType: jsonb('cost_per_action_type'),
    attributionSetting: text('attribution_setting'),
    apiVersion: text('api_version').notNull(),
    rawSnapshot: jsonb('raw_snapshot'),
    syncedAt: timestamp('synced_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...auditTimestamps(),
  },
  (t) => [
    unique('daily_ad_insights_ad_id_date_unq').on(t.adId, t.date),
    index('idx_dai_date').on(t.date),
    index('idx_dai_campaign_date').on(t.campaignId, t.date),
    index('idx_dai_ad_set_date').on(t.adSetId, t.date),
    index('idx_dai_ad_account_date').on(t.adAccountId, t.date),
  ],
).enableRLS()
