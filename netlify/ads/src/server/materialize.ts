/**
 * Materialise a normalised `DashboardDataset` from Postgres (Stage 11C).
 *
 * This is the server's DB-interaction layer: it reads the dimension + fact tables
 * and reconstructs the exact in-memory normalised shapes the shared engine
 * (`createDatasetRepository`) consumes. The heavy lifting is **Meta-ID hydration** —
 * the tables store internal UUID foreign keys, so parent Meta ids are resolved
 * from uuid→meta-id maps (no reliance on Postgres collation, so ordering matches
 * the seed's in-memory JS sorting exactly).
 *
 * SERVER-ONLY (imports the Drizzle schema). Reads the full graph so the engine can
 * compute leave-one-out creative cohorts identically to the seed; at single-owner
 * account scale this is intentional — correctness/parity over micro-efficiency.
 */
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '../db/schema/index.ts'
import type {
  NormalizedCampaign,
  NormalizedAdSet,
  NormalizedAd,
  NormalizedCreative,
  NormalizedDailyInsight,
} from '../types/index.ts'
import type {
  DashboardDataset,
  DashboardMeta,
} from '../data/datasetRepository.ts'
import { inclusiveDays } from './validate.ts'
import { safeErrorFields, type Logger } from './diagnostics.ts'

/** Any Drizzle pg database over our schema (postgres-js in prod, PGlite in tests). */
export type ReadDb = PgDatabase<PgQueryResultHKT, typeof schema>

type CampaignRow = typeof schema.campaigns.$inferSelect
type AdSetRow = typeof schema.adSets.$inferSelect
type AdRow = typeof schema.ads.$inferSelect
type CreativeRow = typeof schema.creatives.$inferSelect
type InsightRow = typeof schema.dailyAdInsights.$inferSelect

function mapCampaign(
  row: CampaignRow,
  accountMeta: Map<string, string>,
): NormalizedCampaign {
  return {
    metaCampaignId: row.metaCampaignId,
    metaAdAccountId: accountMeta.get(row.adAccountId) ?? null,
    name: row.name,
    objective: row.objective,
    status: row.status,
    effectiveStatus: row.effectiveStatus,
    buyingType: row.buyingType,
    createdTime: row.createdTime,
    startTime: row.startTime,
    stopTime: row.stopTime,
    updatedTime: row.updatedTime,
  }
}

function mapAdSet(
  row: AdSetRow,
  campaignMeta: Map<string, string>,
  accountMeta: Map<string, string>,
): NormalizedAdSet {
  return {
    metaAdSetId: row.metaAdSetId,
    metaCampaignId: campaignMeta.get(row.campaignId) ?? null,
    metaAdAccountId: accountMeta.get(row.adAccountId) ?? null,
    name: row.name,
    status: row.status,
    effectiveStatus: row.effectiveStatus,
    dailyBudgetMinor: row.dailyBudgetMinor,
    lifetimeBudgetMinor: row.lifetimeBudgetMinor,
    optimizationGoal: row.optimizationGoal,
    billingEvent: row.billingEvent,
    bidStrategy: row.bidStrategy,
    destinationType: row.destinationType,
    promotedObject: row.promotedObject,
    targetingSummary: row.targetingSummary,
    startTime: row.startTime,
    endTime: row.endTime,
    updatedTime: row.updatedTime,
  }
}

function mapAd(
  row: AdRow,
  adSetMeta: Map<string, string>,
  campaignMeta: Map<string, string>,
  accountMeta: Map<string, string>,
  creativeMeta: Map<string, string>,
): NormalizedAd {
  return {
    metaAdId: row.metaAdId,
    metaAdSetId: adSetMeta.get(row.adSetId) ?? null,
    metaCampaignId: campaignMeta.get(row.campaignId) ?? null,
    metaAdAccountId: accountMeta.get(row.adAccountId) ?? null,
    name: row.name,
    status: row.status,
    effectiveStatus: row.effectiveStatus,
    metaCreativeId:
      row.creativeId === null
        ? null
        : (creativeMeta.get(row.creativeId) ?? null),
    createdTime: row.createdTime,
    updatedTime: row.updatedTime,
    historicalPlaceholder: row.historicalPlaceholder,
  }
}

function mapCreative(row: CreativeRow): NormalizedCreative {
  return {
    metaCreativeId: row.metaCreativeId,
    objectType: row.objectType,
    primaryText: row.primaryText,
    headline: row.headline,
    description: row.description,
    ctaType: row.ctaType,
    destinationUrl: row.destinationUrl,
    imageUrl: row.imageUrl,
    thumbnailUrl: row.thumbnailUrl,
    videoId: row.videoId,
    assetMetadata: row.assetMetadata,
  }
}

function mapInsight(
  row: InsightRow,
  adMeta: Map<string, string>,
  adSetMeta: Map<string, string>,
  campaignMeta: Map<string, string>,
  accountMeta: Map<string, string>,
): NormalizedDailyInsight {
  return {
    metaAdId: adMeta.get(row.adId) ?? '',
    metaAdSetId: adSetMeta.get(row.adSetId) ?? '',
    metaCampaignId: campaignMeta.get(row.campaignId) ?? '',
    metaAdAccountId: accountMeta.get(row.adAccountId) ?? '',
    date: row.date,
    currency: row.currency,
    apiVersion: row.apiVersion,
    spend: row.spend,
    impressions: row.impressions,
    reach: row.reach,
    clicks: row.clicks,
    inlineLinkClicks: row.inlineLinkClicks,
    outboundClicks: row.outboundClicks,
    videoPlayActions: row.videoPlayActions,
    videoP25WatchedActions: row.videoP25WatchedActions,
    videoP50WatchedActions: row.videoP50WatchedActions,
    videoP75WatchedActions: row.videoP75WatchedActions,
    videoP95WatchedActions: row.videoP95WatchedActions,
    videoP100WatchedActions: row.videoP100WatchedActions,
    leads: row.leads,
    leadsActionType: row.leadsActionType,
    landingPageViews: row.landingPageViews,
    landingPageViewsActionType: row.landingPageViewsActionType,
    reportedFrequency: row.reportedFrequency,
    reportedCpm: row.reportedCpm,
    reportedCtr: row.reportedCtr,
    reportedCpc: row.reportedCpc,
    reportedInlineLinkClickCtr: row.reportedInlineLinkClickCtr,
    reportedCostPerInlineLinkClick: row.reportedCostPerInlineLinkClick,
    reportedOutboundClicksCtr: row.reportedOutboundClicksCtr,
    reportedCostPerOutboundClick: row.reportedCostPerOutboundClick,
    reportedCostPerThruplay: row.reportedCostPerThruplay,
    reportedVideoAvgTimeWatchedActions: row.reportedVideoAvgTimeWatchedActions,
    actions: row.actions,
    actionValues: row.actionValues,
    costPerActionType: row.costPerActionType,
    attributionSetting: row.attributionSetting,
    rawSnapshot: (row.rawSnapshot as Record<string, unknown> | null) ?? {},
  }
}

/** Options for materialisation: an optional per-query diagnostic logger. */
export interface MaterializeOptions {
  logger?: Logger
  now?: () => number
}

/**
 * Read the full graph from the database into the engine's `DashboardDataset`.
 * Currency comes from the (single owner) account; the window extent comes from the
 * min/max insight date. An empty database yields an empty-string window and zero
 * counts — the same safe "no data" state the engine renders.
 *
 * The six table reads run STRICTLY SERIALLY. postgres.js runs with `max: 1` against
 * Supavisor TRANSACTION mode, where concurrent queries multiplexed onto a single
 * pooled connection stall (or nondeterministically error) — the cause of the live
 * 20s timeouts. One query at a time keeps the single connection healthy. Each read
 * is wrapped with `query_start` / `query_complete` / `query_error` diagnostics
 * carrying only the table label + elapsed ms (never SQL, params, ids or rows), so a
 * failing query is identified safely and its Postgres error is surfaced.
 */
export async function materializeDataset(
  db: ReadDb,
  options: MaterializeOptions = {},
): Promise<DashboardDataset> {
  const logger = options.logger
  const clock = options.now ?? (() => Date.now())

  async function readTable<T>(
    label: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const start = clock()
    logger?.({ stage: 'query_start', label })
    try {
      const rows = await run()
      logger?.({ stage: 'query_complete', label, ms: clock() - start })
      return rows
    } catch (err) {
      logger?.({
        stage: 'query_error',
        label,
        ms: clock() - start,
        ...safeErrorFields(err),
      })
      throw err
    }
  }

  const accountRows = await readTable('ad_accounts', async () =>
    db.select().from(schema.adAccounts),
  )
  const campaignRows = await readTable('campaigns', async () =>
    db.select().from(schema.campaigns),
  )
  const adSetRows = await readTable('ad_sets', async () =>
    db.select().from(schema.adSets),
  )
  const creativeRows = await readTable('creatives', async () =>
    db.select().from(schema.creatives),
  )
  const adRows = await readTable('ads', async () =>
    db.select().from(schema.ads),
  )
  const insightRows = await readTable('daily_ad_insights', async () =>
    db.select().from(schema.dailyAdInsights),
  )

  const accountMeta = new Map(accountRows.map((r) => [r.id, r.metaAdAccountId]))
  const campaignMeta = new Map(
    campaignRows.map((r) => [r.id, r.metaCampaignId]),
  )
  const adSetMeta = new Map(adSetRows.map((r) => [r.id, r.metaAdSetId]))
  const creativeMeta = new Map(
    creativeRows.map((r) => [r.id, r.metaCreativeId]),
  )
  const adMeta = new Map(adRows.map((r) => [r.id, r.metaAdId]))

  const campaigns = campaignRows.map((r) => mapCampaign(r, accountMeta))
  const adSets = adSetRows.map((r) => mapAdSet(r, campaignMeta, accountMeta))
  const ads = adRows.map((r) =>
    mapAd(r, adSetMeta, campaignMeta, accountMeta, creativeMeta),
  )
  const creatives = creativeRows.map(mapCreative)
  const insights = insightRows.map((r) =>
    mapInsight(r, adMeta, adSetMeta, campaignMeta, accountMeta),
  )

  const dates = insights.map((i) => i.date).sort((a, b) => a.localeCompare(b))
  const startDate = dates.length > 0 ? dates[0] : ''
  const endDate = dates.length > 0 ? dates[dates.length - 1] : ''
  const meta: DashboardMeta = {
    illustrative: false,
    disclaimer: '',
    currency: accountRows.length > 0 ? accountRows[0].currency : null,
    startDate,
    endDate,
    days: startDate === '' ? 0 : inclusiveDays(startDate, endDate),
  }

  // Safe aggregate diagnostics (counts + date range only — never ids/copy/rows).
  if (logger) {
    const adIdsInInsights = new Set(insights.map((i) => i.metaAdId))
    const gt0 = (v: bigint | null): boolean => v !== null && v > 0n
    logger({
      stage: 'materialize_summary',
      label: startDate === '' ? '(no data)' : `${startDate}..${endDate}`,
      counts: {
        insightRows: insights.length,
        distinctDays: dates.length === 0 ? 0 : new Set(dates).size,
        uniqueAds: adIdsInInsights.size,
        campaigns: campaigns.length,
        ads: ads.length,
        creatives: creatives.length,
        adsWithCreative: ads.filter((a) => a.metaCreativeId !== null).length,
        adsMissingCreative: ads.filter((a) => a.metaCreativeId === null).length,
        adsWithInsights: ads.filter((a) => adIdsInInsights.has(a.metaAdId))
          .length,
        adsMissingInsights: ads.filter((a) => !adIdsInInsights.has(a.metaAdId))
          .length,
        rowsWithSpend: insights.filter((i) => i.spend !== null).length,
        rowsWithResolvedLeads: insights.filter((i) => i.leads !== null).length,
        rowsWithVideo: insights.filter((i) => gt0(i.videoPlayActions)).length,
        rowsWithClicks: insights.filter(
          (i) => gt0(i.clicks) || gt0(i.inlineLinkClicks),
        ).length,
      },
    })
  }

  return { campaigns, adSets, ads, creatives, insights, meta }
}
