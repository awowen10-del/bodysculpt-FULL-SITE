/**
 * The one authoritative Meta -> internal field-mapping layer (Stage 5).
 *
 * Converts raw Meta campaign / ad-set / ad / creative / daily-insight responses
 * (the shapes verified in docs/STAGE-4-LIVE-VERIFICATION.md) into typed internal
 * objects keyed by Meta natural ids. It performs NO network calls and NO database
 * writes — UUID foreign-key resolution and upserts are deferred to the write
 * stage.
 *
 * Rules (enforced via src/validation/metaResponses.ts): genuine absence -> null;
 * valid zero stays zero; malformed present values fail loudly; integer counts are
 * lossless `bigint`; decimals are exact strings; unknown extra fields are ignored
 * unless explicitly allow-listed into `raw_snapshot`.
 */
import type {
  NormalizedAdAccount,
  NormalizedCampaign,
  NormalizedAdSet,
  NormalizedAd,
  NormalizedCreative,
  NormalizedDailyInsight,
  LeadDefinition,
} from '../types/index.ts'
import {
  asGraphEntity,
  asMetaObject,
  parseMetaListEnvelope,
  parseMetaText,
  requireMetaText,
  parseMetaDecimal,
  parseMetaCount,
  parseMetaTimestamp,
  parseMetaDate,
  parseMetaArray,
  MetaValidationError,
} from '../validation/metaResponses.ts'
import { readActionStats } from './actions.ts'
import {
  extractLeads,
  extractLandingPageViews,
  describeLeadProvenance,
} from './leadExtraction.ts'
import { DEFAULT_LEAD_DEFINITION } from '../config/leadActionConfig.ts'
import { buildInsightRawSnapshot } from './rawSnapshot.ts'

/** Absent -> null; scalar (string/number/boolean) -> string; object/array -> throw. */
function optionalEnumScalar(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  throw new MetaValidationError(field, 'expected a scalar enum value')
}

// --- dimension entities -----------------------------------------------------

export function normalizeAdAccount(raw: unknown): NormalizedAdAccount {
  const rec = asGraphEntity(raw, 'ad_account')
  return {
    metaAdAccountId: requireMetaText(rec.id, 'ad_account.id'),
    name: parseMetaText(rec.name, 'ad_account.name'),
    currency: requireMetaText(rec.currency, 'ad_account.currency'),
    timezoneName: requireMetaText(
      rec.timezone_name,
      'ad_account.timezone_name',
    ),
    accountStatus: optionalEnumScalar(
      rec.account_status,
      'ad_account.account_status',
    ),
  }
}

export function normalizeCampaign(raw: unknown): NormalizedCampaign {
  const rec = asGraphEntity(raw, 'campaign')
  return {
    metaCampaignId: requireMetaText(rec.id, 'campaign.id'),
    metaAdAccountId: parseMetaText(rec.account_id, 'campaign.account_id'),
    name: parseMetaText(rec.name, 'campaign.name'),
    objective: parseMetaText(rec.objective, 'campaign.objective'),
    status: parseMetaText(rec.status, 'campaign.status'),
    effectiveStatus: parseMetaText(
      rec.effective_status,
      'campaign.effective_status',
    ),
    buyingType: parseMetaText(rec.buying_type, 'campaign.buying_type'),
    createdTime: parseMetaTimestamp(rec.created_time, 'campaign.created_time'),
    startTime: parseMetaTimestamp(rec.start_time, 'campaign.start_time'),
    stopTime: parseMetaTimestamp(rec.stop_time, 'campaign.stop_time'),
    updatedTime: parseMetaTimestamp(rec.updated_time, 'campaign.updated_time'),
  }
}

export function normalizeAdSet(raw: unknown): NormalizedAdSet {
  const rec = asGraphEntity(raw, 'ad_set')
  return {
    metaAdSetId: requireMetaText(rec.id, 'ad_set.id'),
    metaCampaignId: parseMetaText(rec.campaign_id, 'ad_set.campaign_id'),
    metaAdAccountId: parseMetaText(rec.account_id, 'ad_set.account_id'),
    name: parseMetaText(rec.name, 'ad_set.name'),
    status: parseMetaText(rec.status, 'ad_set.status'),
    effectiveStatus: parseMetaText(
      rec.effective_status,
      'ad_set.effective_status',
    ),
    dailyBudgetMinor: parseMetaCount(rec.daily_budget, 'ad_set.daily_budget'),
    lifetimeBudgetMinor: parseMetaCount(
      rec.lifetime_budget,
      'ad_set.lifetime_budget',
    ),
    optimizationGoal: parseMetaText(
      rec.optimization_goal,
      'ad_set.optimization_goal',
    ),
    billingEvent: parseMetaText(rec.billing_event, 'ad_set.billing_event'),
    bidStrategy: parseMetaText(rec.bid_strategy, 'ad_set.bid_strategy'),
    destinationType: parseMetaText(
      rec.destination_type,
      'ad_set.destination_type',
    ),
    // Kept as the raw structured object (like `targeting`) so the exact
    // custom_event_type / custom_conversion_id / pixel_rule survive for central
    // eligibility resolution. `undefined` (field absent) normalises to null.
    promotedObject:
      rec.promoted_object === undefined ? null : rec.promoted_object,
    targetingSummary: rec.targeting === undefined ? null : rec.targeting,
    startTime: parseMetaTimestamp(rec.start_time, 'ad_set.start_time'),
    endTime: parseMetaTimestamp(rec.end_time, 'ad_set.end_time'),
    updatedTime: parseMetaTimestamp(rec.updated_time, 'ad_set.updated_time'),
  }
}

export function normalizeCreative(raw: unknown): NormalizedCreative {
  const rec = asGraphEntity(raw, 'creative')
  return {
    metaCreativeId: requireMetaText(rec.id, 'creative.id'),
    objectType: parseMetaText(rec.object_type, 'creative.object_type'),
    primaryText: parseMetaText(rec.body, 'creative.body'),
    headline: parseMetaText(rec.title, 'creative.title'),
    description: parseMetaText(rec.description, 'creative.description'),
    ctaType: parseMetaText(
      rec.call_to_action_type,
      'creative.call_to_action_type',
    ),
    destinationUrl: parseMetaText(
      rec.effective_object_story_id,
      'creative.effective_object_story_id',
    ),
    imageUrl: parseMetaText(rec.image_url, 'creative.image_url'),
    thumbnailUrl: parseMetaText(rec.thumbnail_url, 'creative.thumbnail_url'),
    videoId: parseMetaText(rec.video_id, 'creative.video_id'),
    assetMetadata: buildCreativeAssetMetadata(rec),
  }
}

function buildCreativeAssetMetadata(
  rec: Record<string, unknown>,
): Record<string, unknown> | null {
  const meta: Record<string, unknown> = {}
  if (rec.object_story_spec !== undefined) {
    meta.object_story_spec = rec.object_story_spec
  }
  if (rec.asset_feed_spec !== undefined) {
    meta.asset_feed_spec = rec.asset_feed_spec
  }
  return Object.keys(meta).length > 0 ? meta : null
}

export function normalizeAd(raw: unknown): NormalizedAd {
  const rec = asGraphEntity(raw, 'ad')
  return {
    metaAdId: requireMetaText(rec.id, 'ad.id'),
    metaAdSetId: parseMetaText(rec.adset_id, 'ad.adset_id'),
    metaCampaignId: parseMetaText(rec.campaign_id, 'ad.campaign_id'),
    metaAdAccountId: parseMetaText(rec.account_id, 'ad.account_id'),
    name: parseMetaText(rec.name, 'ad.name'),
    status: parseMetaText(rec.status, 'ad.status'),
    effectiveStatus: parseMetaText(rec.effective_status, 'ad.effective_status'),
    metaCreativeId: extractCreativeId(rec.creative),
    createdTime: parseMetaTimestamp(rec.created_time, 'ad.created_time'),
    updatedTime: parseMetaTimestamp(rec.updated_time, 'ad.updated_time'),
  }
}

/** The creative is expanded inline on the ad; pull its id if present. */
function extractCreativeId(creative: unknown): string | null {
  if (creative === undefined || creative === null) return null
  const rec = asMetaObject(creative, 'ad.creative')
  return parseMetaText(rec.id, 'ad.creative.id')
}

// --- daily insight fact -----------------------------------------------------

export interface InsightNormalizationContext {
  /** The ad account's currency (insights are not requested with a currency field). */
  currency: string
  /** The Meta API version the response was fetched under. */
  apiVersion: string
  /** Lead definition to apply; defaults to the shipped production definition. */
  leadDefinition?: LeadDefinition
}

/**
 * Reduce a Meta action-stat ARRAY to a single lossless COUNT (bigint) by summing
 * every entry's value. Absent -> null; a present non-array -> throws; a present
 * (possibly empty) array -> the bigint sum (empty -> 0n).
 */
function reduceActionStatCount(value: unknown, field: string): bigint | null {
  const arr = parseMetaArray(value, field)
  if (arr === null) return null
  let total = 0n
  for (const { rawValue } of readActionStats(arr)) {
    const n = parseMetaCount(rawValue, field)
    if (n !== null) total += n
  }
  return total
}

/**
 * Reduce a Meta action-stat ARRAY to a single provenance DECIMAL string. Absent
 * -> null; a single entry -> its exact decimal; MULTIPLE entries are ambiguous
 * for one reported scalar, so we store null and keep the raw array in
 * `raw_snapshot` instead. A present non-array -> throws.
 */
function reduceActionStatDecimal(value: unknown, field: string): string | null {
  const arr = parseMetaArray(value, field)
  if (arr === null) return null
  const stats = readActionStats(arr)
  if (stats.length === 0) return null
  if (stats.length === 1) return parseMetaDecimal(stats[0].rawValue, field)
  return null
}

export function normalizeDailyInsight(
  raw: unknown,
  ctx: InsightNormalizationContext,
): NormalizedDailyInsight {
  const rec = asMetaObject(raw, 'insight')

  const dateStart = parseMetaDate(rec.date_start, 'insight.date_start')
  const dateStop = parseMetaDate(rec.date_stop, 'insight.date_stop')
  if (dateStart === null) {
    throw new MetaValidationError('insight.date_start', 'required')
  }
  if (dateStop === null) {
    throw new MetaValidationError('insight.date_stop', 'required')
  }
  if (dateStart !== dateStop) {
    throw new MetaValidationError(
      'insight.date',
      `date_start (${dateStart}) != date_stop (${dateStop}) — not a single daily row`,
    )
  }

  const leadDefinition = ctx.leadDefinition ?? DEFAULT_LEAD_DEFINITION
  const leadResult = extractLeads(rec.actions, leadDefinition)
  const lpv = extractLandingPageViews(rec.actions)

  return {
    metaAdId: requireMetaText(rec.ad_id, 'insight.ad_id'),
    metaAdSetId: requireMetaText(rec.adset_id, 'insight.adset_id'),
    metaCampaignId: requireMetaText(rec.campaign_id, 'insight.campaign_id'),
    metaAdAccountId: requireMetaText(rec.account_id, 'insight.account_id'),
    date: dateStart,
    currency: ctx.currency,
    apiVersion: ctx.apiVersion,

    spend: parseMetaDecimal(rec.spend, 'insight.spend'),
    impressions: parseMetaCount(rec.impressions, 'insight.impressions'),
    reach: parseMetaCount(rec.reach, 'insight.reach'),
    clicks: parseMetaCount(rec.clicks, 'insight.clicks'),
    inlineLinkClicks: parseMetaCount(
      rec.inline_link_clicks,
      'insight.inline_link_clicks',
    ),
    outboundClicks: reduceActionStatCount(
      rec.outbound_clicks,
      'insight.outbound_clicks',
    ),
    videoPlayActions: reduceActionStatCount(
      rec.video_play_actions,
      'insight.video_play_actions',
    ),
    videoP25WatchedActions: reduceActionStatCount(
      rec.video_p25_watched_actions,
      'insight.video_p25_watched_actions',
    ),
    videoP50WatchedActions: reduceActionStatCount(
      rec.video_p50_watched_actions,
      'insight.video_p50_watched_actions',
    ),
    videoP75WatchedActions: reduceActionStatCount(
      rec.video_p75_watched_actions,
      'insight.video_p75_watched_actions',
    ),
    videoP95WatchedActions: reduceActionStatCount(
      rec.video_p95_watched_actions,
      'insight.video_p95_watched_actions',
    ),
    videoP100WatchedActions: reduceActionStatCount(
      rec.video_p100_watched_actions,
      'insight.video_p100_watched_actions',
    ),

    leads: leadResult.value,
    leadsActionType: describeLeadProvenance(leadResult),
    landingPageViews: lpv.value,
    landingPageViewsActionType: lpv.actionType,

    reportedFrequency: parseMetaDecimal(rec.frequency, 'insight.frequency'),
    reportedCpm: parseMetaDecimal(rec.cpm, 'insight.cpm'),
    reportedCtr: parseMetaDecimal(rec.ctr, 'insight.ctr'),
    reportedCpc: parseMetaDecimal(rec.cpc, 'insight.cpc'),
    reportedInlineLinkClickCtr: parseMetaDecimal(
      rec.inline_link_click_ctr,
      'insight.inline_link_click_ctr',
    ),
    reportedCostPerInlineLinkClick: parseMetaDecimal(
      rec.cost_per_inline_link_click,
      'insight.cost_per_inline_link_click',
    ),
    reportedOutboundClicksCtr: reduceActionStatDecimal(
      rec.outbound_clicks_ctr,
      'insight.outbound_clicks_ctr',
    ),
    reportedCostPerOutboundClick: reduceActionStatDecimal(
      rec.cost_per_outbound_click,
      'insight.cost_per_outbound_click',
    ),
    reportedCostPerThruplay: reduceActionStatDecimal(
      rec.cost_per_thruplay,
      'insight.cost_per_thruplay',
    ),
    reportedVideoAvgTimeWatchedActions: reduceActionStatDecimal(
      rec.video_avg_time_watched_actions,
      'insight.video_avg_time_watched_actions',
    ),

    actions: parseMetaArray(rec.actions, 'insight.actions'),
    actionValues: parseMetaArray(rec.action_values, 'insight.action_values'),
    costPerActionType: parseMetaArray(
      rec.cost_per_action_type,
      'insight.cost_per_action_type',
    ),
    attributionSetting: parseMetaText(
      rec.attribution_setting,
      'insight.attribution_setting',
    ),
    rawSnapshot: buildInsightRawSnapshot(rec),
  }
}

// --- list helpers (validate the `{ data: [...] }` envelope, then map) -------

export function normalizeAdAccountList(
  response: unknown,
): NormalizedAdAccount[] {
  return parseMetaListEnvelope(response, 'ad_accounts').map(normalizeAdAccount)
}

export function normalizeCampaignList(response: unknown): NormalizedCampaign[] {
  return parseMetaListEnvelope(response, 'campaigns').map(normalizeCampaign)
}

export function normalizeAdSetList(response: unknown): NormalizedAdSet[] {
  return parseMetaListEnvelope(response, 'ad_sets').map(normalizeAdSet)
}

export function normalizeAdList(response: unknown): NormalizedAd[] {
  return parseMetaListEnvelope(response, 'ads').map(normalizeAd)
}

export function normalizeCreativeList(response: unknown): NormalizedCreative[] {
  return parseMetaListEnvelope(response, 'creatives').map(normalizeCreative)
}

export function normalizeDailyInsightList(
  response: unknown,
  ctx: InsightNormalizationContext,
): NormalizedDailyInsight[] {
  return parseMetaListEnvelope(response, 'insights').map((row) =>
    normalizeDailyInsight(row, ctx),
  )
}
