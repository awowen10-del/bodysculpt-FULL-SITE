/**
 * Shared creative assembly + ranking.
 *
 * This is the ONE implementation of "group ads by creative → aggregate each
 * creative's in-window metrics → make a commercial decision → attach context",
 * plus the ranked-view comparator. Both the seed repository and the server
 * repository consume it, so the decision can never diverge between the offline and
 * production paths.
 *
 * The decision is COMMERCIAL and per-creative (spend / leads / CPL vs the owner's
 * thresholds) — there is no peer benchmark, no cohort median, no confidence band.
 * The objective family is still resolved, but only to FILTER and label a creative,
 * never to decide keep/turn-off.
 *
 * BROWSER-SAFE and TRANSPORT-FREE: it imports only the metrics layer, the DTO
 * converters' metric projection, shared types and config. No database, no HTTP.
 */
import type {
  NormalizedAd,
  NormalizedCampaign,
  NormalizedAdSet,
  NormalizedCreative,
  NormalizedDailyInsight,
} from '../types/index.ts'
import {
  aggregateInsights,
  decideCreative,
  resolveCreativeEligibility,
  conversionEvidenceOf,
} from '../metrics/index.ts'
import {
  ACTIVE_DECISION_SETTINGS,
  ACTIVE_ELIGIBILITY_SETTINGS,
} from '../metrics/index.ts'
import type {
  AnalysisWindow,
  CommercialDecision,
  CommercialDecisionSettings,
  CreativeEvaluation,
  EligibilitySettings,
  Metric,
} from '../metrics/index.ts'
import { toMetricSetDTO } from './dto.ts'
import type { CreativeContextDTO, MetricSetDTO } from './dto.ts'
import type { CreativeSort } from './repository.ts'

/** Whole-day difference `end − start` for two `YYYY-MM-DD` strings (UTC, exact). */
function dayDiff(start: string, end: string): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/** Separator for the composite row id. `~` is RFC 3986 unreserved (never
 * percent-encoded), so it survives URL paths + query params untouched. */
const ROW_ID_SEP = '~'

/**
 * The STABLE identity of a ranked row = (creative × ad set). This — not the raw
 * creative id — is what routing, the compare/detail URL state, and the Daily Ad
 * Check snapshot key on, because one creative can now back several rows (one per ad
 * set). Each part is `encodeURIComponent`-guarded so a non-numeric id can never
 * corrupt the join or the URL.
 */
export function makeRowId(creativeId: string, adSetId: string | null): string {
  return `${encodeURIComponent(creativeId)}${ROW_ID_SEP}${encodeURIComponent(adSetId ?? '')}`
}

/**
 * Reverse of {@link makeRowId}: split a row id back into its creative + ad-set ids
 * (e.g. so the detail view can scope its daily breakdown to the same composite).
 * Returns null on any malformed id — the encode guard means a bad id yields a safe
 * not-found, never a throw.
 */
export function parseRowId(
  rowId: string,
): { creativeId: string; adSetId: string } | null {
  const i = rowId.indexOf(ROW_ID_SEP)
  if (i < 0) return null
  const rawCreative = rowId.slice(0, i)
  const rawAdSet = rowId.slice(i + 1)
  if (rawAdSet.includes(ROW_ID_SEP)) return null // exactly one separator expected
  try {
    return {
      creativeId: decodeURIComponent(rawCreative),
      adSetId: decodeURIComponent(rawAdSet),
    }
  } catch {
    return null
  }
}

/** A bigint count that is present and strictly positive. */
function positiveCount(value: bigint | null): boolean {
  return value !== null && value > 0n
}

/**
 * Did this ad-day actually deliver? A day counts as delivered when the row
 * carries ANY real activity signal — spend, impressions, clicks, leads, or video
 * — never a single nullable metric. Meta can return a delivering row with spend
 * and video plays but a null/zero `impressions`, so keying delivery on
 * impressions alone mislabels real delivery as "no delivery".
 *
 * Exported so the campaign layer and the diagnostic share ONE definition of
 * delivery with the assembly path (no drift between "delivered" checks).
 */
export function insightHasDelivery(row: NormalizedDailyInsight): boolean {
  return (
    (row.spend !== null && /[1-9]/.test(row.spend)) ||
    positiveCount(row.impressions) ||
    positiveCount(row.clicks) ||
    positiveCount(row.inlineLinkClicks) ||
    positiveCount(row.outboundClicks) ||
    positiveCount(row.leads) ||
    positiveCount(row.landingPageViews) ||
    positiveCount(row.videoPlayActions) ||
    positiveCount(row.videoP25WatchedActions) ||
    positiveCount(row.videoP50WatchedActions) ||
    positiveCount(row.videoP75WatchedActions) ||
    positiveCount(row.videoP95WatchedActions) ||
    positiveCount(row.videoP100WatchedActions)
  )
}

/**
 * The earliest day each campaign actually DELIVERED, keyed by campaign id — the
 * honest "went live" date. Meta's planned `start_time` can precede real delivery
 * by weeks (a scheduled-but-dormant campaign), so we key off the first day spend/
 * impressions actually appear instead. Non-delivering days never count.
 */
export function campaignLaunchDates(
  insights: readonly NormalizedDailyInsight[],
): Map<string, string> {
  const launch = new Map<string, string>()
  for (const row of insights) {
    if (!insightHasDelivery(row)) continue
    const current = launch.get(row.metaCampaignId)
    if (current === undefined || row.date < current) {
      launch.set(row.metaCampaignId, row.date)
    }
  }
  return launch
}

/** Exact `numerator/denominator` of an available metric, or null when unavailable. */
function rationalOf(metric: Metric): { n: bigint; d: bigint } | null {
  return metric.status === 'available'
    ? { n: metric.numerator, d: metric.denominator }
    : null
}

/** Ascending compare of two exact rationals; nulls (unavailable) sort last. */
function compareRationalAsc(
  a: { n: bigint; d: bigint } | null,
  b: { n: bigint; d: bigint } | null,
): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  const lhs = a.n * b.d
  const rhs = b.n * a.d
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0
}

/**
 * Ranked-view decision order: winners first (what to double down on), then the
 * ads still gathering evidence, then the ads to turn off. Within a decision the
 * comparator breaks ties by cost per lead so the most/least profitable surface
 * predictably.
 */
const DECISION_ORDER: Record<CommercialDecision, number> = {
  winner: 0,
  needs_more_time: 1,
  turn_off: 2,
}

/** One assembled ranked-view row before DTO conversion. */
export interface CreativeRow {
  /** Stable composite identity (creative × ad set) — see {@link makeRowId}. */
  rowId: string
  creative: NormalizedCreative
  context: CreativeContextDTO
  adCount: number
  /** Newest delivering day across ALL data for this creative's ads, or null. */
  latestDeliveryDate: string | null
  metrics: MetricSetDTO
  /** Eligibility ⊕ decision — ineligible rows carry NO commercial decision. */
  evaluation: CreativeEvaluation
}

/**
 * A row's rank bucket: the three commercial decisions come first (winners →
 * needs-more-time → turn-off), then every ineligible (not-evaluated) creative,
 * so the ranked list keeps the actionable lead creatives on top.
 */
function rankBucket(row: CreativeRow): number {
  return row.evaluation.eligibility === 'eligible'
    ? DECISION_ORDER[row.evaluation.decision.decision]
    : 3
}

/**
 * The row's cost-per-lead / lead-count metrics for SORTING. Eligible rows use the
 * decision's exact metrics; ineligible (not-evaluated) rows have no lead verdict,
 * so they read as unavailable and tie-break by id within the not-evaluated bucket.
 */
const UNAVAILABLE_FOR_SORT: Metric = {
  status: 'unavailable',
  reason: 'no_data',
}

function rowCpl(row: CreativeRow): Metric {
  return row.evaluation.eligibility === 'eligible'
    ? row.evaluation.decision.cpl
    : UNAVAILABLE_FOR_SORT
}

function rowLeads(row: CreativeRow): Metric {
  return row.evaluation.eligibility === 'eligible'
    ? row.evaluation.decision.leads
    : UNAVAILABLE_FOR_SORT
}

/** Build the row comparator for a requested sort order. */
export function creativeComparator(
  sort: CreativeSort,
): (a: CreativeRow, b: CreativeRow) => number {
  const byId = (a: CreativeRow, b: CreativeRow) =>
    a.rowId.localeCompare(b.rowId)
  const cplAsc = (a: CreativeRow, b: CreativeRow) =>
    compareRationalAsc(rationalOf(rowCpl(a)), rationalOf(rowCpl(b)))
  const leadsDesc = (a: CreativeRow, b: CreativeRow) =>
    -compareRationalAsc(rationalOf(rowLeads(a)), rationalOf(rowLeads(b)))

  if (sort === 'cost') {
    return (a, b) => cplAsc(a, b) || byId(a, b)
  }
  if (sort === 'volume') {
    return (a, b) => leadsDesc(a, b) || byId(a, b)
  }
  if (sort === 'name') {
    return (a, b) =>
      (a.creative.headline ?? '').localeCompare(b.creative.headline ?? '') ||
      byId(a, b)
  }
  // 'rank' (default): eligible decisions first (winner→turn-off), then not-
  // evaluated; then cheapest CPL, then most leads, then id.
  return (a, b) => {
    const byBucket = rankBucket(a) - rankBucket(b)
    if (byBucket !== 0) return byBucket
    return cplAsc(a, b) || leadsDesc(a, b) || byId(a, b)
  }
}

/** The normalised graph slice the creative assembly reads. */
export interface CreativeAssemblyInput {
  campaigns: readonly NormalizedCampaign[]
  adSets: readonly NormalizedAdSet[]
  ads: readonly NormalizedAd[]
  creatives: readonly NormalizedCreative[]
  insights: readonly NormalizedDailyInsight[]
  /**
   * The newest synced day (the dataset's latest insight date). Every verdict runs
   * from a campaign's first-delivery day up to THIS day — "since the campaign went
   * live, through the most recent synced data". Empty string when there is no data.
   */
  windowEnd: string
  settings?: CommercialDecisionSettings
  eligibilitySettings?: EligibilitySettings
}

/**
 * Assemble every creative's evaluation row (aggregate BY creative, resolve its
 * objective, gate eligibility, decide keep/turn-off ONLY for eligible lead
 * creatives, attach campaign/ad-set context). Shared by both repositories'
 * `listCreatives` and `getCreative` so the result is identical offline and in
 * production.
 */
export function buildCreativeRows(input: CreativeAssemblyInput): CreativeRow[] {
  const settings = input.settings ?? ACTIVE_DECISION_SETTINGS
  const eligibilitySettings =
    input.eligibilitySettings ?? ACTIVE_ELIGIBILITY_SETTINGS
  const { windowEnd } = input

  // The honest per-campaign launch date (first day it delivered). Every row's
  // verdict runs from its campaign's launch to `windowEnd`.
  const launchByCampaign = campaignLaunchDates(input.insights)

  const campaignNameById = new Map(
    input.campaigns.map((c) => [c.metaCampaignId, c.name]),
  )
  const adSetNameById = new Map(
    input.adSets.map((s) => [s.metaAdSetId, s.name]),
  )
  const eventByAdSet = new Map(
    input.adSets.map((s) => [s.metaAdSetId, s.optimizationGoal]),
  )
  const promotedObjectByAdSet = new Map(
    input.adSets.map((s) => [s.metaAdSetId, s.promotedObject]),
  )
  const adSetStatusById = new Map(
    input.adSets.map((s) => [s.metaAdSetId, s.effectiveStatus ?? s.status]),
  )
  const campaignObjectiveById = new Map(
    input.campaigns.map((c) => [c.metaCampaignId, c.objective]),
  )
  const creativeById = new Map(
    input.creatives.map((c) => [c.metaCreativeId, c]),
  )

  // Group by (creative, ad set) — the composite unit of analysis. The SAME creative
  // running in two ad sets (e.g. a Men vs a Women audience) becomes two rows, each
  // judged on its own, instead of one blended row that averages the difference away.
  interface RowBucket {
    rowId: string
    creativeId: string
    adSetId: string | null
    ads: NormalizedAd[]
  }
  const adsByRow = new Map<string, RowBucket>()
  for (const ad of input.ads) {
    if (ad.metaCreativeId === null) continue
    const rowId = makeRowId(ad.metaCreativeId, ad.metaAdSetId)
    const bucket = adsByRow.get(rowId) ?? {
      rowId,
      creativeId: ad.metaCreativeId,
      adSetId: ad.metaAdSetId,
      ads: [],
    }
    bucket.ads.push(ad)
    adsByRow.set(rowId, bucket)
  }

  // Bucket insights by ad in ONE O(insights) pass, so each creative reads only its
  // own ads' rows instead of re-scanning the whole insights array per creative.
  const insightsByAd = new Map<string, NormalizedDailyInsight[]>()
  for (const row of input.insights) {
    const list = insightsByAd.get(row.metaAdId)
    if (list !== undefined) list.push(row)
    else insightsByAd.set(row.metaAdId, [row])
  }

  const rows: CreativeRow[] = []
  for (const bucket of adsByRow.values()) {
    const creative = creativeById.get(bucket.creativeId)
    if (creative === undefined) continue
    const ads = bucket.ads

    // Every row in a campaign shares that campaign's launch date; the verdict runs
    // from launch → newest synced day. A row whose campaign never delivered gets a
    // zero-length window (its aggregate is empty → "needs more time").
    const campaignId = ads[0]?.metaCampaignId ?? null
    const launch =
      campaignId === null ? null : (launchByCampaign.get(campaignId) ?? null)
    const winStart = launch ?? windowEnd
    const window: AnalysisWindow = {
      start: winStart,
      end: windowEnd,
      days:
        winStart === '' || windowEnd === ''
          ? 0
          : dayDiff(winStart, windowEnd) + 1,
    }

    // This row's insight rows only (all its ads share one ad set).
    const adRows: NormalizedDailyInsight[] = []
    for (const a of ads) {
      const list = insightsByAd.get(a.metaAdId)
      if (list !== undefined) for (const r of list) adRows.push(r)
    }
    // ONE aggregation over the since-launch window drives BOTH the verdict and the
    // displayed metric set — they are the same window, so nothing can disagree.
    const windowRows = adRows.filter(
      (r) => r.date >= winStart && r.date <= windowEnd,
    )
    const agg = aggregateInsights(windowRows)

    // Newest delivering day across ALL data (not just the window) — powers the
    // "Last delivery" fact and recency ordering.
    const allDeliveringDates = adRows
      .filter(insightHasDelivery)
      .map((r) => r.date)
    const latestDeliveryDate =
      allDeliveringDates.length === 0
        ? null
        : allDeliveringDates.reduce((max, d) => (d > max ? d : max))

    // Resolve the single optimisation event backing this creative. A single
    // recognised event yields a family (for labelling/filtering); mixed or none
    // leaves it null. This is also the eligibility gate's input.
    const events = new Set<string>()
    for (const ad of ads) {
      const ev =
        ad.metaAdSetId === null
          ? null
          : (eventByAdSet.get(ad.metaAdSetId) ?? null)
      if (ev !== null) events.add(ev)
    }
    const singleEvent = events.size === 1 ? [...events][0] : null

    // Prefer an ad that actually delivered in the window as the representative ad,
    // so the card's ad name/status describe the live ad.
    const inWindowAdIds = new Set(windowRows.map((r) => r.metaAdId))
    const firstAd = ads.find((a) => inWindowAdIds.has(a.metaAdId)) ?? ads[0]
    const campaignObjective =
      firstAd.metaCampaignId === null
        ? null
        : (campaignObjectiveById.get(firstAd.metaCampaignId) ?? null)

    // ELIGIBILITY GATE — before any lead logic. For an OFFSITE_CONVERSIONS ad set,
    // the authoritative proof is its `promoted_object.custom_event_type`; we read it
    // from the representative ad's ad set. A custom conversion is left unresolved
    // (needs a bounded lookup), so it stays `unconfirmed_lead_objective` — never
    // assumed to be a lead. Missing promoted_object → unconfirmed (fail-closed).
    const promotedObject =
      firstAd.metaAdSetId === null
        ? null
        : (promotedObjectByAdSet.get(firstAd.metaAdSetId) ?? null)
    const eligibilityResolution = resolveCreativeEligibility(
      {
        optimizationEvent: singleEvent,
        campaignObjective,
        conversion: conversionEvidenceOf(promotedObject),
      },
      eligibilitySettings,
    )

    // Only eligible lead creatives are pushed through the commercial hierarchy.
    // Everything else keeps its objective + reason and carries NO decision.
    const evaluation: CreativeEvaluation =
      eligibilityResolution.eligibility === 'eligible'
        ? {
            eligibility: 'eligible',
            objective: eligibilityResolution.objective,
            decision: decideCreative(
              {
                spend: agg.spend,
                leads: agg.leads,
                cpl: agg.cpl,
                linkCtr: agg.linkCtr,
              },
              window,
              {
                objectiveFamily:
                  eligibilityResolution.objective.objectiveFamily,
                optimizationEvent: singleEvent ?? '',
              },
              settings,
            ),
          }
        : {
            eligibility: eligibilityResolution.eligibility,
            objective: eligibilityResolution.objective,
            reason: eligibilityResolution.reason,
          }

    const context: CreativeContextDTO = {
      campaignId: firstAd.metaCampaignId,
      campaignName:
        firstAd.metaCampaignId === null
          ? null
          : (campaignNameById.get(firstAd.metaCampaignId) ?? null),
      objective: campaignObjective,
      adSetId: firstAd.metaAdSetId,
      adSetName:
        firstAd.metaAdSetId === null
          ? null
          : (adSetNameById.get(firstAd.metaAdSetId) ?? null),
      adSetStatus:
        firstAd.metaAdSetId === null
          ? null
          : (adSetStatusById.get(firstAd.metaAdSetId) ?? null),
      adId: firstAd.metaAdId,
      adName: firstAd.name,
      adStatus: firstAd.effectiveStatus ?? firstAd.status,
    }

    rows.push({
      rowId: bucket.rowId,
      creative,
      context,
      adCount: ads.length,
      latestDeliveryDate,
      metrics: toMetricSetDTO(agg),
      evaluation,
    })
  }

  return rows
}
