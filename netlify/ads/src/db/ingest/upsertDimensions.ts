/**
 * Dimension upserts for the Stage 6 write layer (account → campaign → ad set →
 * creative → ad, FK-safe order). Runs inside ONE transaction supplied by the
 * caller. Every level is upserted (conflict on its Meta natural id), then its
 * `metaId → uuid` map is built from an explicit SELECT (covering pre-existing and
 * newly-inserted rows). Upserting an entity marks it "seen": `last_seen_at = now`,
 * `missing_since = null`, `consecutive_full_scope_misses = 0` (the seen branch of
 * reconciliation) — no miss-inference happens here.
 *
 * NOTE (documented schema gap): ad-set `attribution_spec` (a Meta array) has no
 * column and is NEVER written or flattened into `attribution_setting`.
 */
import { sql, inArray } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import {
  adAccounts,
  campaigns,
  adSets,
  creatives,
  ads,
} from '../schema/index.ts'
import type { DimensionEntityCounts, IngestInput } from '../../types/index.ts'
import {
  buildIdMap,
  assertComplete,
  dedupeByKey,
  requireParent,
  optionalParent,
  type IdMap,
} from './resolveIds.ts'

export interface AccountRef {
  id: string
  currency: string
}

export interface DimensionMaps {
  accounts: Map<string, AccountRef>
  campaigns: IdMap
  adSets: IdMap
  creatives: IdMap
  ads: IdMap
  /** Distinct dimension records committed by this transaction. */
  written: number
  /**
   * Per-entity breakdown of `written` (Stage 9): `written` is exactly its sum.
   * Input-record counts, not measured row changes — see `EntityCounts`.
   */
  counts: DimensionEntityCounts
}

/** On-conflict fragment for the "seen" reconciliation branch. */
const seenUpdate = {
  lastSeenAt: sql`now()`,
  missingSince: null,
  consecutiveFullScopeMisses: 0,
  updatedAt: sql`now()`,
}

function mapFrom(
  rows: readonly { meta: string; id: string }[],
  metaIds: readonly string[],
  entity: string,
): IdMap {
  const map = buildIdMap(rows, entity)
  assertComplete(map, metaIds, entity)
  return map
}

export async function upsertDimensions<
  Q extends PgQueryResultHKT,
  S extends Record<string, unknown>,
>(db: PgDatabase<Q, S>, input: IngestInput): Promise<DimensionMaps> {
  const accountList = dedupeByKey(input.adAccounts, (a) => a.metaAdAccountId)
  const campaignList = dedupeByKey(input.campaigns, (c) => c.metaCampaignId)
  const adSetList = dedupeByKey(input.adSets, (s) => s.metaAdSetId)
  const creativeList = dedupeByKey(input.creatives, (c) => c.metaCreativeId)
  const adList = dedupeByKey(input.ads, (a) => a.metaAdId)

  // --- 1. ad accounts -------------------------------------------------------
  for (const a of accountList) {
    await db
      .insert(adAccounts)
      .values({
        metaAdAccountId: a.metaAdAccountId,
        name: a.name,
        currency: a.currency,
        timezoneName: a.timezoneName,
        lastSeenAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: adAccounts.metaAdAccountId,
        set: {
          name: a.name,
          currency: a.currency,
          timezoneName: a.timezoneName,
          ...seenUpdate,
        },
      })
  }
  const accountMetaIds = accountList.map((a) => a.metaAdAccountId)
  const accountRows = accountMetaIds.length
    ? await db
        .select({
          meta: adAccounts.metaAdAccountId,
          id: adAccounts.id,
          currency: adAccounts.currency,
        })
        .from(adAccounts)
        .where(inArray(adAccounts.metaAdAccountId, accountMetaIds))
    : []
  // buildIdMap enforces no ambiguity; then require completeness.
  mapFrom(accountRows, accountMetaIds, 'ad account')
  const accounts = new Map<string, AccountRef>(
    accountRows.map((r) => [r.meta, { id: r.id, currency: r.currency }]),
  )
  const accountIdMap: IdMap = new Map(accountRows.map((r) => [r.meta, r.id]))

  // --- 2. campaigns ---------------------------------------------------------
  for (const c of campaignList) {
    const adAccountId = requireParent(
      accountIdMap,
      c.metaAdAccountId,
      'campaign',
      'ad account',
    )
    const values = {
      metaCampaignId: c.metaCampaignId,
      adAccountId,
      name: c.name,
      objective: c.objective,
      status: c.status,
      effectiveStatus: c.effectiveStatus,
      buyingType: c.buyingType,
      createdTime: c.createdTime,
      startTime: c.startTime,
      stopTime: c.stopTime,
      updatedTime: c.updatedTime,
    }
    await db
      .insert(campaigns)
      .values({ ...values, lastSeenAt: sql`now()` })
      .onConflictDoUpdate({
        target: campaigns.metaCampaignId,
        set: { ...values, ...seenUpdate },
      })
  }
  const campaignMetaIds = campaignList.map((c) => c.metaCampaignId)
  const campaignRows = campaignMetaIds.length
    ? await db
        .select({ meta: campaigns.metaCampaignId, id: campaigns.id })
        .from(campaigns)
        .where(inArray(campaigns.metaCampaignId, campaignMetaIds))
    : []
  const campaignsMap = mapFrom(campaignRows, campaignMetaIds, 'campaign')

  // --- 3. ad sets -----------------------------------------------------------
  for (const s of adSetList) {
    const campaignId = requireParent(
      campaignsMap,
      s.metaCampaignId,
      'ad set',
      'campaign',
    )
    const adAccountId = requireParent(
      accountIdMap,
      s.metaAdAccountId,
      'ad set',
      'ad account',
    )
    const values = {
      metaAdSetId: s.metaAdSetId,
      campaignId,
      adAccountId,
      name: s.name,
      status: s.status,
      effectiveStatus: s.effectiveStatus,
      dailyBudgetMinor: s.dailyBudgetMinor,
      lifetimeBudgetMinor: s.lifetimeBudgetMinor,
      optimizationGoal: s.optimizationGoal,
      billingEvent: s.billingEvent,
      bidStrategy: s.bidStrategy,
      destinationType: s.destinationType,
      promotedObject: s.promotedObject,
      targetingSummary: s.targetingSummary,
      startTime: s.startTime,
      endTime: s.endTime,
      updatedTime: s.updatedTime,
    }
    await db
      .insert(adSets)
      .values({ ...values, lastSeenAt: sql`now()` })
      .onConflictDoUpdate({
        target: adSets.metaAdSetId,
        set: { ...values, ...seenUpdate },
      })
  }
  const adSetMetaIds = adSetList.map((s) => s.metaAdSetId)
  const adSetRows = adSetMetaIds.length
    ? await db
        .select({ meta: adSets.metaAdSetId, id: adSets.id })
        .from(adSets)
        .where(inArray(adSets.metaAdSetId, adSetMetaIds))
    : []
  const adSetsMap = mapFrom(adSetRows, adSetMetaIds, 'ad set')

  // --- 4. creatives ---------------------------------------------------------
  // NormalizedCreative carries no account id (a creative is expanded inline on
  // an ad), so link each creative to its account via the ads that reference it.
  const creativeAccount = new Map<string, string>()
  for (const a of adList) {
    if (a.metaCreativeId !== null && a.metaAdAccountId !== null) {
      if (!creativeAccount.has(a.metaCreativeId)) {
        creativeAccount.set(a.metaCreativeId, a.metaAdAccountId)
      }
    }
  }
  for (const c of creativeList) {
    const adAccountId = requireParent(
      accountIdMap,
      creativeAccount.get(c.metaCreativeId) ?? null,
      'creative',
      'ad account',
    )
    const values = {
      metaCreativeId: c.metaCreativeId,
      adAccountId,
      objectType: c.objectType,
      primaryText: c.primaryText,
      headline: c.headline,
      description: c.description,
      ctaType: c.ctaType,
      destinationUrl: c.destinationUrl,
      imageUrl: c.imageUrl,
      thumbnailUrl: c.thumbnailUrl,
      videoId: c.videoId,
      assetMetadata: c.assetMetadata,
      lastSyncedAt: sql`now()`,
    }
    await db
      .insert(creatives)
      .values({ ...values, lastSeenAt: sql`now()` })
      .onConflictDoUpdate({
        target: creatives.metaCreativeId,
        set: { ...values, ...seenUpdate },
      })
  }
  const creativeMetaIds = creativeList.map((c) => c.metaCreativeId)
  const creativeRows = creativeMetaIds.length
    ? await db
        .select({ meta: creatives.metaCreativeId, id: creatives.id })
        .from(creatives)
        .where(inArray(creatives.metaCreativeId, creativeMetaIds))
    : []
  const creativesMap = mapFrom(creativeRows, creativeMetaIds, 'creative')

  // --- 5. ads ---------------------------------------------------------------
  for (const a of adList) {
    const adSetId = requireParent(adSetsMap, a.metaAdSetId, 'ad', 'ad set')
    const campaignId = requireParent(
      campaignsMap,
      a.metaCampaignId,
      'ad',
      'campaign',
    )
    const adAccountId = requireParent(
      accountIdMap,
      a.metaAdAccountId,
      'ad',
      'ad account',
    )
    const creativeId = optionalParent(
      creativesMap,
      a.metaCreativeId,
      'ad',
      'creative',
    )
    const values = {
      metaAdId: a.metaAdId,
      adSetId,
      campaignId,
      adAccountId,
      creativeId,
      name: a.name,
      status: a.status,
      effectiveStatus: a.effectiveStatus,
      createdTime: a.createdTime,
      updatedTime: a.updatedTime,
      // A real ad (from the live listing, local DB or direct Meta fetch) writes
      // FALSE, so a later real appearance self-heals a prior tombstone; only a
      // synthesised tombstone writes TRUE. Undefined → false (the common case).
      historicalPlaceholder: a.historicalPlaceholder ?? false,
    }
    await db
      .insert(ads)
      .values({ ...values, lastSeenAt: sql`now()` })
      .onConflictDoUpdate({
        target: ads.metaAdId,
        set: { ...values, ...seenUpdate },
      })
  }
  const adMetaIds = adList.map((a) => a.metaAdId)
  const adRows = adMetaIds.length
    ? await db
        .select({ meta: ads.metaAdId, id: ads.id })
        .from(ads)
        .where(inArray(ads.metaAdId, adMetaIds))
    : []
  const adsMap = mapFrom(adRows, adMetaIds, 'ad')

  // The breakdown is the source; `written` is its sum, so the two can never drift.
  const counts: DimensionEntityCounts = {
    adAccounts: accountList.length,
    campaigns: campaignList.length,
    adSets: adSetList.length,
    creatives: creativeList.length,
    ads: adList.length,
  }
  const written =
    counts.adAccounts +
    counts.campaigns +
    counts.adSets +
    counts.creatives +
    counts.ads

  return {
    accounts,
    campaigns: campaignsMap,
    adSets: adSetsMap,
    creatives: creativesMap,
    ads: adsMap,
    written,
    counts,
  }
}
