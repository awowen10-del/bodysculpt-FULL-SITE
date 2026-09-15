/**
 * Per-ad performance PROFILES for the local seed dataset (Stage 10, Phase 1).
 *
 * ⚠️ EVERY NUMBER IN THIS FILE IS INVENTED, ILLUSTRATIVE SEED DATA. It exists so
 * the local dashboard has something plausible to render offline. It is NOT real
 * Bodysculpt performance, NOT sourced from Meta, and NOT a benchmark of any kind.
 * Nothing here should ever be read as a target, a typical value, or a fact.
 *
 * A profile is the deterministic "shape" of one ad's daily delivery: baseline
 * volumes plus per-1000-impression rates. `generateInsights.ts` turns a profile
 * plus a date into a raw Meta-shaped insight row using a pure integer wobble —
 * there is no randomness, so the same profiles always yield the same rows.
 *
 * This module holds DATA and pure constants only: no network, no database, no
 * server-only imports — it is safe to import into the browser bundle.
 */

/** Currency of the seed account — matches `fixtures/adAccounts.json`. */
export const SEED_CURRENCY = 'GBP'

/** Meta API version stamped onto the normalised seed insights (documented default). */
export { META_API_VERSION as SEED_API_VERSION } from '../config/metaApiVersion.ts'

/** Inclusive last day of the seed window; the visible dashboard defaults here. */
export const SEED_END_DATE = '2026-07-13'

/** Number of consecutive days generated (ending on `SEED_END_DATE`). */
export const SEED_DAYS = 14

/** One honest, reusable label for the invented nature of this data. */
export const SEED_DISCLAIMER =
  'ILLUSTRATIVE SEED DATA — invented figures for local development only. ' +
  'Not real Bodysculpt performance, not sourced from Meta, and not a benchmark.'

/** The three campaign "families" — each shapes which metrics an ad reports. */
export type SeedFamily = 'leads' | 'traffic' | 'awareness'

/**
 * The deterministic delivery shape of a single ad. Rates are expressed per 1000
 * impressions so day-to-day volumes scale coherently with the wobbled impression
 * count. Fields irrelevant to a family are simply left at 0.
 */
export interface AdProfile {
  adId: string
  adSetId: string
  campaignId: string
  creativeId: string
  family: SeedFamily
  /** Illustrative baseline daily impressions, before deterministic day wobble. */
  baseImpressions: number
  /** Illustrative baseline daily spend in whole PENCE, before day wobble. */
  baseSpendPence: number
  /** Reach as a fraction of impressions (unique people ≤ impressions). */
  reachRatio: number
  /** Total clicks per 1000 impressions. */
  clicksPerMille: number
  /** Share of clicks that are inline link clicks. */
  linkClickShare: number
  /** leads family only: native lead-form leads per 1000 impressions. */
  nativeLeadsPerMille: number
  /** leads family only: website Pixel leads per 1000 impressions. */
  websiteLeadsPerMille: number
  /** awareness family only: fraction of impressions that begin a video view. */
  videoStartShare: number
  /**
   * Day indices (0 = first day, 13 = `SEED_END_DATE`) with deliberate ZERO
   * delivery — a paused stretch or a late/early start. A dark day still emits a
   * row (all zeros / empty actions), which is how the dashboard's "—" undefined
   * states get real data to render.
   */
  darkDays: readonly number[]
}

/**
 * The seed ads. Three campaigns, six ad sets. The LEAD_GENERATION ad set
 * (ADS_SEED_LEADS_1) is deliberately ENRICHED to FIVE creatives so the Creative
 * Intelligence screen has a cohort large enough to exercise the leave-one-out peer
 * median (Phase 5 needs ≥3 eligible peers after exclusion); every other cohort
 * keeps two creatives and therefore honestly reads "Need More Data / insufficient
 * peers". IDs and parents mirror the hand-written dimension fixtures exactly. All
 * figures are invented (see the file header).
 */
export const AD_PROFILES: readonly AdProfile[] = [
  // --- Campaign CMP_SEED_LEADS · ad set ADS_SEED_LEADS_1 -------------------
  {
    adId: 'AD_SEED_01',
    adSetId: 'ADS_SEED_LEADS_1',
    campaignId: 'CMP_SEED_LEADS',
    creativeId: 'CRV_SEED_01',
    family: 'leads',
    baseImpressions: 900,
    baseSpendPence: 1500,
    reachRatio: 0.78,
    clicksPerMille: 30,
    linkClickShare: 0.8,
    nativeLeadsPerMille: 1,
    websiteLeadsPerMille: 0,
    videoStartShare: 0,
    darkDays: [],
  },
  {
    adId: 'AD_SEED_02',
    adSetId: 'ADS_SEED_LEADS_1',
    campaignId: 'CMP_SEED_LEADS',
    creativeId: 'CRV_SEED_02',
    family: 'leads',
    baseImpressions: 650,
    baseSpendPence: 1400,
    reachRatio: 0.8,
    clicksPerMille: 25,
    linkClickShare: 0.75,
    nativeLeadsPerMille: 1,
    websiteLeadsPerMille: 0,
    videoStartShare: 0,
    darkDays: [10, 11],
  },
  // --- Campaign CMP_SEED_LEADS · ad set ADS_SEED_LEADS_2 -------------------
  {
    adId: 'AD_SEED_03',
    adSetId: 'ADS_SEED_LEADS_2',
    campaignId: 'CMP_SEED_LEADS',
    creativeId: 'CRV_SEED_03',
    family: 'leads',
    baseImpressions: 500,
    baseSpendPence: 1000,
    reachRatio: 0.75,
    clicksPerMille: 35,
    linkClickShare: 0.82,
    nativeLeadsPerMille: 1,
    websiteLeadsPerMille: 1,
    videoStartShare: 0,
    darkDays: [],
  },
  {
    adId: 'AD_SEED_04',
    adSetId: 'ADS_SEED_LEADS_2',
    campaignId: 'CMP_SEED_LEADS',
    creativeId: 'CRV_SEED_04',
    family: 'leads',
    baseImpressions: 350,
    baseSpendPence: 700,
    reachRatio: 0.85,
    clicksPerMille: 20,
    linkClickShare: 0.7,
    nativeLeadsPerMille: 1,
    websiteLeadsPerMille: 0,
    videoStartShare: 0,
    darkDays: [0, 1, 2],
  },
  // --- Campaign CMP_SEED_TRAFFIC · ad set ADS_SEED_TRAFFIC_1 ---------------
  {
    adId: 'AD_SEED_05',
    adSetId: 'ADS_SEED_TRAFFIC_1',
    campaignId: 'CMP_SEED_TRAFFIC',
    creativeId: 'CRV_SEED_05',
    family: 'traffic',
    baseImpressions: 1500,
    baseSpendPence: 1800,
    reachRatio: 0.72,
    clicksPerMille: 45,
    linkClickShare: 0.9,
    nativeLeadsPerMille: 0,
    websiteLeadsPerMille: 0,
    videoStartShare: 0,
    darkDays: [],
  },
  {
    adId: 'AD_SEED_06',
    adSetId: 'ADS_SEED_TRAFFIC_1',
    campaignId: 'CMP_SEED_TRAFFIC',
    creativeId: 'CRV_SEED_06',
    family: 'traffic',
    baseImpressions: 1100,
    baseSpendPence: 1400,
    reachRatio: 0.74,
    clicksPerMille: 40,
    linkClickShare: 0.88,
    nativeLeadsPerMille: 0,
    websiteLeadsPerMille: 0,
    videoStartShare: 0,
    darkDays: [],
  },
  // --- Campaign CMP_SEED_TRAFFIC · ad set ADS_SEED_TRAFFIC_2 ---------------
  {
    adId: 'AD_SEED_07',
    adSetId: 'ADS_SEED_TRAFFIC_2',
    campaignId: 'CMP_SEED_TRAFFIC',
    creativeId: 'CRV_SEED_07',
    family: 'traffic',
    baseImpressions: 800,
    baseSpendPence: 900,
    reachRatio: 0.76,
    clicksPerMille: 38,
    linkClickShare: 0.85,
    nativeLeadsPerMille: 0,
    websiteLeadsPerMille: 0,
    videoStartShare: 0,
    darkDays: [7],
  },
  {
    adId: 'AD_SEED_08',
    adSetId: 'ADS_SEED_TRAFFIC_2',
    campaignId: 'CMP_SEED_TRAFFIC',
    creativeId: 'CRV_SEED_08',
    family: 'traffic',
    baseImpressions: 500,
    baseSpendPence: 600,
    reachRatio: 0.8,
    clicksPerMille: 30,
    linkClickShare: 0.8,
    nativeLeadsPerMille: 0,
    websiteLeadsPerMille: 0,
    videoStartShare: 0,
    darkDays: [],
  },
  // --- Campaign CMP_SEED_AWARE · ad set ADS_SEED_AWARE_1 ------------------
  {
    adId: 'AD_SEED_09',
    adSetId: 'ADS_SEED_AWARE_1',
    campaignId: 'CMP_SEED_AWARE',
    creativeId: 'CRV_SEED_09',
    family: 'awareness',
    baseImpressions: 2500,
    baseSpendPence: 1200,
    reachRatio: 0.68,
    clicksPerMille: 8,
    linkClickShare: 0.6,
    nativeLeadsPerMille: 0,
    websiteLeadsPerMille: 0,
    videoStartShare: 0.55,
    darkDays: [],
  },
  {
    adId: 'AD_SEED_10',
    adSetId: 'ADS_SEED_AWARE_1',
    campaignId: 'CMP_SEED_AWARE',
    creativeId: 'CRV_SEED_10',
    family: 'awareness',
    baseImpressions: 2000,
    baseSpendPence: 1000,
    reachRatio: 0.7,
    clicksPerMille: 6,
    linkClickShare: 0.5,
    nativeLeadsPerMille: 0,
    websiteLeadsPerMille: 0,
    videoStartShare: 0.6,
    darkDays: [],
  },
  // --- Campaign CMP_SEED_AWARE · ad set ADS_SEED_AWARE_2 ------------------
  {
    adId: 'AD_SEED_11',
    adSetId: 'ADS_SEED_AWARE_2',
    campaignId: 'CMP_SEED_AWARE',
    creativeId: 'CRV_SEED_11',
    family: 'awareness',
    baseImpressions: 1800,
    baseSpendPence: 900,
    reachRatio: 0.71,
    clicksPerMille: 5,
    linkClickShare: 0.5,
    nativeLeadsPerMille: 0,
    websiteLeadsPerMille: 0,
    videoStartShare: 0.5,
    darkDays: [12, 13],
  },
  {
    adId: 'AD_SEED_12',
    adSetId: 'ADS_SEED_AWARE_2',
    campaignId: 'CMP_SEED_AWARE',
    creativeId: 'CRV_SEED_12',
    family: 'awareness',
    baseImpressions: 3000,
    baseSpendPence: 1500,
    reachRatio: 0.66,
    clicksPerMille: 7,
    linkClickShare: 0.55,
    nativeLeadsPerMille: 0,
    websiteLeadsPerMille: 0,
    videoStartShare: 0.65,
    darkDays: [],
  },
  // --- Campaign CMP_SEED_LEADS · ad set ADS_SEED_LEADS_1 (enrichment) -------
  // ⚠️ INVENTED illustrative volumes, NOT a benchmark. Tuned for a saturated local
  // gym account where 10–20 combined leads is a mature sample and ~25–30 is an
  // exceptional result. The cohort demonstrates the commercial decisions
  // deterministically against the £20 target / £35 maximum CPL:
  //   AD_13/01/02/14/16 KEEP ON — WINNER (CPL ~£11–16, at or below target) ·
  //   AD_15/17 KEEP ON — NEEDS MORE TIME (CPL ~£26 / £30, between target and max).
  //   Absolute CPL vs the owner's thresholds drives each decision — no peer ranking.
  {
    adId: 'AD_SEED_13',
    adSetId: 'ADS_SEED_LEADS_1',
    campaignId: 'CMP_SEED_LEADS',
    creativeId: 'CRV_SEED_13',
    family: 'leads',
    baseImpressions: 1800,
    baseSpendPence: 2000,
    reachRatio: 0.78,
    clicksPerMille: 30,
    linkClickShare: 0.8,
    nativeLeadsPerMille: 1,
    websiteLeadsPerMille: 0,
    videoStartShare: 0,
    darkDays: [],
  },
  {
    adId: 'AD_SEED_14',
    adSetId: 'ADS_SEED_LEADS_1',
    campaignId: 'CMP_SEED_LEADS',
    creativeId: 'CRV_SEED_14',
    family: 'leads',
    baseImpressions: 1000,
    baseSpendPence: 1600,
    reachRatio: 0.79,
    clicksPerMille: 28,
    linkClickShare: 0.8,
    nativeLeadsPerMille: 1,
    websiteLeadsPerMille: 0,
    videoStartShare: 0,
    darkDays: [],
  },
  {
    adId: 'AD_SEED_15',
    adSetId: 'ADS_SEED_LEADS_1',
    campaignId: 'CMP_SEED_LEADS',
    creativeId: 'CRV_SEED_15',
    family: 'leads',
    baseImpressions: 700,
    baseSpendPence: 2650,
    reachRatio: 0.8,
    clicksPerMille: 25,
    linkClickShare: 0.78,
    nativeLeadsPerMille: 1,
    websiteLeadsPerMille: 0,
    videoStartShare: 0,
    darkDays: [],
  },
  {
    adId: 'AD_SEED_16',
    adSetId: 'ADS_SEED_LEADS_1',
    campaignId: 'CMP_SEED_LEADS',
    creativeId: 'CRV_SEED_16',
    family: 'leads',
    baseImpressions: 520,
    baseSpendPence: 950,
    reachRatio: 0.8,
    clicksPerMille: 24,
    linkClickShare: 0.78,
    nativeLeadsPerMille: 1,
    websiteLeadsPerMille: 0,
    videoStartShare: 0,
    darkDays: [],
  },
  {
    adId: 'AD_SEED_17',
    adSetId: 'ADS_SEED_LEADS_1',
    campaignId: 'CMP_SEED_LEADS',
    creativeId: 'CRV_SEED_17',
    family: 'leads',
    baseImpressions: 470,
    baseSpendPence: 700,
    reachRatio: 0.82,
    clicksPerMille: 22,
    linkClickShare: 0.75,
    nativeLeadsPerMille: 1,
    websiteLeadsPerMille: 0,
    videoStartShare: 0,
    darkDays: [],
  },
]

/**
 * The `SEED_DAYS` calendar dates ending on `SEED_END_DATE`, oldest first, as
 * `YYYY-MM-DD` strings. Pure UTC arithmetic — deterministic, timezone-agnostic,
 * and free of `Date.now()`.
 */
export function seedDates(): string[] {
  const end = new Date(`${SEED_END_DATE}T00:00:00Z`)
  const dates: string[] = []
  for (let i = SEED_DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(end)
    d.setUTCDate(end.getUTCDate() - i)
    dates.push(d.toISOString().slice(0, 10))
  }
  return dates
}
