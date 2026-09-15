/**
 * Assemble the local SEED DATASET (Stage 10, Phase 1).
 *
 * ⚠️ ILLUSTRATIVE SEED DATA ONLY — see the header of `profiles.ts`. Not real
 * Bodysculpt performance, not sourced from Meta, not a benchmark.
 *
 * This is the one place the seed graph is built. It takes the hand-written raw
 * Meta-shaped dimension fixtures and the deterministically generated raw insight
 * rows and passes ALL of them through the real `src/meta/normalize.ts` layer —
 * the exact mapping the live sync uses. The seed therefore exercises the same
 * validation, null handling, bigint counts and exact-decimal strings as
 * production, with zero bespoke normalisation here.
 *
 * BROWSER-SAFE: imports only the normalisation layer, shared types, config and
 * local seed modules. It never imports the database, Postgres, the sync layer,
 * the graph client, or any server-only module, and opens no connection.
 */
import rawAdAccounts from './fixtures/adAccounts.json'
import rawCampaigns from './fixtures/campaigns.json'
import rawAdSets from './fixtures/adSets.json'
import rawAds from './fixtures/ads.json'
import {
  normalizeAdAccountList,
  normalizeCampaignList,
  normalizeAdSetList,
  normalizeAdList,
  normalizeCreative,
  normalizeDailyInsightList,
} from '../meta/normalize.ts'
import type {
  NormalizedAdAccount,
  NormalizedCampaign,
  NormalizedAdSet,
  NormalizedAd,
  NormalizedCreative,
  NormalizedDailyInsight,
} from '../types/index.ts'
import { generateRawInsights } from './generateInsights.ts'
import { SEED_LEAD_DEFINITION } from '../config/leadActionConfig.ts'
import {
  SEED_CURRENCY,
  SEED_API_VERSION,
  SEED_END_DATE,
  SEED_DAYS,
  SEED_DISCLAIMER,
  seedDates,
} from './profiles.ts'

/** Provenance/rendering metadata about the seed window. */
export interface SeedMeta {
  /** Always true — a permanent, machine-checkable marker that this is not real data. */
  illustrative: true
  disclaimer: string
  currency: string
  apiVersion: string
  /** Oldest generated day (`YYYY-MM-DD`). */
  startDate: string
  /** Newest generated day; the dashboard's default visible date. */
  endDate: string
  days: number
}

/**
 * The fully normalised seed graph. Field-for-field compatible with the write
 * layer's `IngestInput`, plus `meta` describing the invented window. Every entity
 * is a `normalize.ts` output keyed by Meta natural ids.
 */
export interface SeedDataset {
  adAccounts: NormalizedAdAccount[]
  campaigns: NormalizedCampaign[]
  adSets: NormalizedAdSet[]
  creatives: NormalizedCreative[]
  ads: NormalizedAd[]
  insights: NormalizedDailyInsight[]
  meta: SeedMeta
}

/**
 * Derive normalised creatives from the ads' inline `creative` expansion, exactly
 * as the sync layer does (an ad references a creative; one creative can back many
 * ads). Deduped by Meta creative id, first occurrence wins.
 */
function deriveCreatives(adsEnvelope: {
  data: { creative?: unknown }[]
}): NormalizedCreative[] {
  const byId = new Map<string, NormalizedCreative>()
  for (const ad of adsEnvelope.data) {
    if (ad.creative === undefined || ad.creative === null) continue
    const creative = normalizeCreative(ad.creative)
    if (!byId.has(creative.metaCreativeId)) {
      byId.set(creative.metaCreativeId, creative)
    }
  }
  return [...byId.values()]
}

/**
 * Build the deterministic seed dataset. Pure and side-effect-free: the same
 * inputs (fixed fixtures + fixed generator) always produce a deeply equal result.
 */
export function buildSeedDataset(): SeedDataset {
  // The seed uses the SAME production lead definition as the live pipeline
  // (canonical generic `lead`) — there is one lead-resolution contract, not two.
  const ctx = {
    currency: SEED_CURRENCY,
    apiVersion: SEED_API_VERSION,
    leadDefinition: SEED_LEAD_DEFINITION,
  }

  const adAccounts = normalizeAdAccountList(rawAdAccounts)
  const campaigns = normalizeCampaignList(rawCampaigns)
  const adSets = normalizeAdSetList(rawAdSets)
  const ads = normalizeAdList(rawAds)
  const creatives = deriveCreatives(rawAds)
  const insights = normalizeDailyInsightList(
    { data: generateRawInsights() },
    ctx,
  )

  const dates = seedDates()
  const meta: SeedMeta = {
    illustrative: true,
    disclaimer: SEED_DISCLAIMER,
    currency: SEED_CURRENCY,
    apiVersion: SEED_API_VERSION,
    startDate: dates[0],
    endDate: SEED_END_DATE,
    days: SEED_DAYS,
  }

  return { adAccounts, campaigns, adSets, creatives, ads, insights, meta }
}
