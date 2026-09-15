/**
 * Historical-orphan AD resolution (Stage 7).
 *
 * A historical backfill fetches insights over a past window and the CURRENT ad
 * dimensions (`/ads`). Meta drops deleted/archived ads from that listing, so a
 * historical insight can reference an ad that is no longer returned — an
 * EXPECTED lifecycle condition, not a bad request. Left unresolved it trips
 * `assertGraphConsistency` with `ORPHAN_ENTITY: insight references an unknown
 * ad`, and the whole all-or-nothing run fails before writing a single row.
 *
 * This module reconciles those orphan ads BEFORE referential validation, using
 * the safest deterministic resolution available, in order:
 *
 *   A. the ad already exists in the LOCAL database  → reuse the stored dimension;
 *   B. the ad is fetchable DIRECTLY from Meta by id  → fetch + normalise it (and
 *      any parent dimensions the graph is missing);
 *   C. Meta no longer exposes the ad ANYWHERE        → synthesise a minimum-safe
 *      TOMBSTONE ad that preserves the insight, marked `historicalPlaceholder`,
 *      with NO fabricated identity (name/status/creative stay null).
 *
 * It never discards a historical insight, never weakens referential integrity
 * (a genuinely-missing ad SET or campaign still fails loud downstream), and never
 * attaches an insight to the wrong parent (a tombstone's parents are taken from
 * the insight's own references). No id, name, url or token appears in its report.
 */
import type {
  IngestInput,
  NormalizedAd,
  NormalizedAdSet,
  NormalizedCampaign,
  NormalizedCreative,
} from '../types/index.ts'

/** Ads (and their creatives) recovered from the local database — resolution A. */
export interface LocalAdRecovery {
  ads: NormalizedAd[]
  creatives: NormalizedCreative[]
}

/** An ad recovered directly from Meta by id, plus any dimensions it needs — B. */
export interface RecoveredAd {
  ad: NormalizedAd
  creative?: NormalizedCreative | null
  adSet?: NormalizedAdSet | null
  campaign?: NormalizedCampaign | null
}

export interface OrphanAdResolverDeps {
  /**
   * Resolution A. Given the orphan ad ids, return the subset already present in
   * the local `ads` table, reconstructed as normalised dimensions (with the
   * creatives they reference). Absent in dry-run/preflight (no database). Only ids
   * that genuinely exist locally may be returned.
   */
  lookupLocalAds?: (metaAdIds: readonly string[]) => Promise<LocalAdRecovery>
  /**
   * Resolution B. Fetch one ad directly from Meta by id, returning it normalised
   * (with its inline creative and any parent ad set / campaign) or `null` when
   * Meta no longer exposes it at all. Read-only GET.
   */
  recoverFromMeta?: (metaAdId: string) => Promise<RecoveredAd | null>
}

/**
 * Secret-free summary of what the resolver did. Counts, categories and a date
 * range only — never an ad id, name, creative, url or token — so it is safe to
 * print and persist.
 */
export interface OrphanResolutionReport {
  /** Insight rows whose ad was absent from the current `/ads` dimension listing. */
  orphanInsightRows: number
  /** Distinct missing ad ids across those rows. */
  uniqueMissingAds: number
  /** Earliest orphan insight date (YYYY-MM-DD), or null when there are none. */
  dateRangeStart: string | null
  /** Latest orphan insight date (YYYY-MM-DD), or null when there are none. */
  dateRangeEnd: string | null
  /** Resolution A — reused from the local database. */
  resolvedFromLocalDb: number
  /** Resolution B — recovered directly from Meta by id. */
  resolvedFromMeta: number
  /** Resolution C — preserved via a minimum-safe tombstone dimension. */
  tombstoned: number
}

export const EMPTY_ORPHAN_REPORT: Readonly<OrphanResolutionReport> =
  Object.freeze({
    orphanInsightRows: 0,
    uniqueMissingAds: 0,
    dateRangeStart: null,
    dateRangeEnd: null,
    resolvedFromLocalDb: 0,
    resolvedFromMeta: 0,
    tombstoned: 0,
  })

/** The parent references a tombstone inherits — taken from the insight itself. */
interface InsightAdReference {
  metaAdSetId: string
  metaCampaignId: string
  metaAdAccountId: string
}

/**
 * Build a minimum-safe TOMBSTONE ad for an insight whose ad Meta no longer
 * exposes. It carries the insight's OWN parent references (so the fact is never
 * attached to the wrong ad set / campaign / account) and NO fabricated identity.
 */
function tombstoneAd(metaAdId: string, ref: InsightAdReference): NormalizedAd {
  return {
    metaAdId,
    metaAdSetId: ref.metaAdSetId,
    metaCampaignId: ref.metaCampaignId,
    metaAdAccountId: ref.metaAdAccountId,
    name: null,
    status: null,
    effectiveStatus: null,
    metaCreativeId: null,
    createdTime: null,
    updatedTime: null,
    historicalPlaceholder: true,
  }
}

/**
 * Resolve every insight whose ad is absent from the current dimension graph,
 * returning an augmented `IngestInput` and a secret-free report. The returned
 * input is safe to hand to `assertGraphConsistency`: a genuinely-unresolved
 * PARENT (ad set / campaign / account) is deliberately left unfilled so it still
 * fails loud there.
 */
export async function resolveOrphanAds(
  input: IngestInput,
  deps: OrphanAdResolverDeps,
): Promise<{ input: IngestInput; report: OrphanResolutionReport }> {
  const presentAdIds = new Set(input.ads.map((a) => a.metaAdId))
  const orphanRows = input.insights.filter((i) => !presentAdIds.has(i.metaAdId))
  if (orphanRows.length === 0) {
    return { input, report: { ...EMPTY_ORPHAN_REPORT } }
  }

  // Deterministic order + one parent reference per missing ad (first occurrence;
  // an ad belongs to exactly one ad set/campaign, so occurrences agree).
  const references = new Map<string, InsightAdReference>()
  const dates: string[] = []
  for (const row of orphanRows) {
    dates.push(row.date)
    if (!references.has(row.metaAdId)) {
      references.set(row.metaAdId, {
        metaAdSetId: row.metaAdSetId,
        metaCampaignId: row.metaCampaignId,
        metaAdAccountId: row.metaAdAccountId,
      })
    }
  }
  const missing = [...references.keys()].sort()
  dates.sort()

  const newAds: NormalizedAd[] = []
  const newCreatives: NormalizedCreative[] = []
  const newAdSets: NormalizedAdSet[] = []
  const newCampaigns: NormalizedCampaign[] = []
  let resolvedFromLocalDb = 0
  let resolvedFromMeta = 0
  let tombstoned = 0

  const unresolved = new Set(missing)

  // --- A. local database -----------------------------------------------------
  if (deps.lookupLocalAds) {
    const local = await deps.lookupLocalAds(missing)
    for (const ad of local.ads) {
      if (!unresolved.has(ad.metaAdId)) continue
      newAds.push(ad)
      unresolved.delete(ad.metaAdId)
      resolvedFromLocalDb += 1
    }
    // Creatives the recovered ads reference, so the ad→creative edge resolves.
    for (const creative of local.creatives) newCreatives.push(creative)
  }

  // --- B. direct Meta fetch --------------------------------------------------
  if (deps.recoverFromMeta) {
    for (const metaAdId of missing) {
      if (!unresolved.has(metaAdId)) continue
      const recovered = await deps.recoverFromMeta(metaAdId)
      if (recovered === null || recovered === undefined) continue
      newAds.push(recovered.ad)
      if (recovered.creative) newCreatives.push(recovered.creative)
      if (recovered.adSet) newAdSets.push(recovered.adSet)
      if (recovered.campaign) newCampaigns.push(recovered.campaign)
      unresolved.delete(metaAdId)
      resolvedFromMeta += 1
    }
  }

  // --- C. tombstone (Meta no longer exposes the ad anywhere) -----------------
  for (const metaAdId of missing) {
    if (!unresolved.has(metaAdId)) continue
    const ref = references.get(metaAdId)
    if (ref === undefined) continue
    newAds.push(tombstoneAd(metaAdId, ref))
    unresolved.delete(metaAdId)
    tombstoned += 1
  }

  const merged: IngestInput = {
    ...input,
    ads: [...input.ads, ...newAds],
    // Recovered parents/creatives are added only when the current listing did NOT
    // already return them — a fresh listing entry always wins over a recovered one.
    creatives: mergeById(
      input.creatives,
      newCreatives,
      (c) => c.metaCreativeId,
    ),
    adSets: mergeById(input.adSets, newAdSets, (s) => s.metaAdSetId),
    campaigns: mergeById(
      input.campaigns,
      newCampaigns,
      (c) => c.metaCampaignId,
    ),
  }

  return {
    input: merged,
    report: {
      orphanInsightRows: orphanRows.length,
      uniqueMissingAds: missing.length,
      dateRangeStart: dates[0] ?? null,
      dateRangeEnd: dates[dates.length - 1] ?? null,
      resolvedFromLocalDb,
      resolvedFromMeta,
      tombstoned,
    },
  }
}

/** Append `additions` to `base`, skipping any whose key already exists in base. */
function mergeById<T>(
  base: readonly T[],
  additions: readonly T[],
  key: (item: T) => string,
): T[] {
  const seen = new Set(base.map(key))
  const out = [...base]
  for (const item of additions) {
    const k = key(item)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}
