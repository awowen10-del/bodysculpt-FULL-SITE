/**
 * Local-database recovery for historical-orphan ads (resolution A of
 * src/sync/orphanAds.ts).
 *
 * Given the Meta ids of ads referenced by historical insights but absent from the
 * current `/ads` listing, return the subset that ALREADY EXISTS in the local
 * `ads` table — reconstructed as the exact normalised dimensions the write layer
 * consumes, together with the creatives they reference (so the ad→creative edge
 * still resolves). Parent Meta ids are hydrated from uuid→meta-id maps, mirroring
 * `materializeDataset`. Ads not present locally are simply omitted.
 *
 * SERVER-ONLY (imports the Drizzle schema). Read-only: a single set of SELECTs,
 * no writes, no reconciliation side effects.
 */
import { inArray } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema/index.ts'
import type { NormalizedAd, NormalizedCreative } from '../types/index.ts'
import type { LocalAdRecovery } from '../sync/orphanAds.ts'

type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>

function reconstructCreative(
  row: typeof schema.creatives.$inferSelect,
): NormalizedCreative {
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

/**
 * Reconstruct the locally-stored ads (and their creatives) for the given Meta ad
 * ids. The returned lists contain ONLY ads that exist locally; a caller treats a
 * missing id as "not resolvable from the database" and falls through to Meta
 * recovery or a tombstone.
 */
export async function lookupLocalAds(
  db: AnyDb,
  metaAdIds: readonly string[],
): Promise<LocalAdRecovery> {
  if (metaAdIds.length === 0) return { ads: [], creatives: [] }

  const adRows = await db
    .select()
    .from(schema.ads)
    .where(inArray(schema.ads.metaAdId, [...metaAdIds]))
  if (adRows.length === 0) return { ads: [], creatives: [] }

  const adSetUuids = [...new Set(adRows.map((r) => r.adSetId))]
  const campaignUuids = [...new Set(adRows.map((r) => r.campaignId))]
  const accountUuids = [...new Set(adRows.map((r) => r.adAccountId))]
  const creativeUuids = [
    ...new Set(
      adRows.map((r) => r.creativeId).filter((id): id is string => id !== null),
    ),
  ]

  const adSetRows = await db
    .select({ id: schema.adSets.id, meta: schema.adSets.metaAdSetId })
    .from(schema.adSets)
    .where(inArray(schema.adSets.id, adSetUuids))
  const campaignRows = await db
    .select({ id: schema.campaigns.id, meta: schema.campaigns.metaCampaignId })
    .from(schema.campaigns)
    .where(inArray(schema.campaigns.id, campaignUuids))
  const accountRows = await db
    .select({
      id: schema.adAccounts.id,
      meta: schema.adAccounts.metaAdAccountId,
    })
    .from(schema.adAccounts)
    .where(inArray(schema.adAccounts.id, accountUuids))
  const creativeRows =
    creativeUuids.length > 0
      ? await db
          .select()
          .from(schema.creatives)
          .where(inArray(schema.creatives.id, creativeUuids))
      : []

  const adSetMeta = new Map(adSetRows.map((r) => [r.id, r.meta]))
  const campaignMeta = new Map(campaignRows.map((r) => [r.id, r.meta]))
  const accountMeta = new Map(accountRows.map((r) => [r.id, r.meta]))
  const creativeMeta = new Map(
    creativeRows.map((r) => [r.id, r.metaCreativeId]),
  )

  const ads: NormalizedAd[] = adRows.map((row) => ({
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
  }))

  return { ads, creatives: creativeRows.map(reconstructCreative) }
}
