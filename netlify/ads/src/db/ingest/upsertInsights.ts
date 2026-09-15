/**
 * Daily-insight upsert for one window (Stage 6). Runs inside a per-window
 * transaction supplied by the caller, so a failure rolls back only this window.
 *
 * For each insight: resolve the four parent UUIDs from the dimension maps (fail
 * loud if unresolved); assert the insight currency matches the resolved account's
 * currency (fail loud on mismatch — never substitute); upsert on `(ad_id, date)`.
 * Lossless `bigint` counts cross the boundary unchanged (schema uses
 * `mode: 'bigint'`). Returns the number of insight rows committed by this window.
 */
import { sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { dailyAdInsights } from '../schema/index.ts'
import { IngestError } from './dbErrors.ts'
import { requireParent } from './resolveIds.ts'
import type { DimensionMaps } from './upsertDimensions.ts'
import type { InsightWindow } from './windows.ts'

export async function upsertInsightWindow<
  Q extends PgQueryResultHKT,
  S extends Record<string, unknown>,
>(
  db: PgDatabase<Q, S>,
  window: InsightWindow,
  maps: DimensionMaps,
): Promise<number> {
  for (const i of window.insights) {
    const account = maps.accounts.get(i.metaAdAccountId)
    if (account === undefined) {
      throw new IngestError(
        'MISSING_PARENT',
        'an insight references an unknown ad account',
      )
    }
    if (i.currency !== account.currency) {
      throw new IngestError(
        'CURRENCY_MISMATCH',
        `insight currency ${i.currency} does not match account currency ${account.currency}`,
      )
    }

    const adId = requireParent(maps.ads, i.metaAdId, 'insight', 'ad')
    const adSetId = requireParent(
      maps.adSets,
      i.metaAdSetId,
      'insight',
      'ad set',
    )
    const campaignId = requireParent(
      maps.campaigns,
      i.metaCampaignId,
      'insight',
      'campaign',
    )
    const adAccountId = account.id

    const metrics = {
      spend: i.spend,
      impressions: i.impressions,
      reach: i.reach,
      clicks: i.clicks,
      inlineLinkClicks: i.inlineLinkClicks,
      outboundClicks: i.outboundClicks,
      videoPlayActions: i.videoPlayActions,
      videoP25WatchedActions: i.videoP25WatchedActions,
      videoP50WatchedActions: i.videoP50WatchedActions,
      videoP75WatchedActions: i.videoP75WatchedActions,
      videoP95WatchedActions: i.videoP95WatchedActions,
      videoP100WatchedActions: i.videoP100WatchedActions,
      leads: i.leads,
      leadsActionType: i.leadsActionType,
      landingPageViews: i.landingPageViews,
      landingPageViewsActionType: i.landingPageViewsActionType,
      reportedFrequency: i.reportedFrequency,
      reportedCpm: i.reportedCpm,
      reportedCtr: i.reportedCtr,
      reportedCpc: i.reportedCpc,
      reportedInlineLinkClickCtr: i.reportedInlineLinkClickCtr,
      reportedCostPerInlineLinkClick: i.reportedCostPerInlineLinkClick,
      reportedOutboundClicksCtr: i.reportedOutboundClicksCtr,
      reportedCostPerOutboundClick: i.reportedCostPerOutboundClick,
      reportedCostPerThruplay: i.reportedCostPerThruplay,
      reportedVideoAvgTimeWatchedActions: i.reportedVideoAvgTimeWatchedActions,
      actions: i.actions,
      actionValues: i.actionValues,
      costPerActionType: i.costPerActionType,
      attributionSetting: i.attributionSetting,
      rawSnapshot: i.rawSnapshot,
    }

    await db
      .insert(dailyAdInsights)
      .values({
        adId,
        adSetId,
        campaignId,
        adAccountId,
        date: i.date,
        currency: i.currency,
        apiVersion: i.apiVersion,
        ...metrics,
        syncedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [dailyAdInsights.adId, dailyAdInsights.date],
        set: {
          adSetId,
          campaignId,
          adAccountId,
          currency: i.currency,
          apiVersion: i.apiVersion,
          ...metrics,
          syncedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      })
  }

  return window.insights.length
}
