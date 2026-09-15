/**
 * Data-transfer objects — the JSON-safe boundary between the data layer and the
 * browser (Stage 10, Phase 3).
 *
 * HARD RULE: everything here must survive `JSON.stringify` → `JSON.parse` with no
 * loss and no type errors. That means NO `bigint`, NO `Date`, and NO
 * database-native numeric objects ever cross this boundary. Exact counts and
 * money are carried as STRINGS; timestamps are ISO strings; metrics are already
 * computed and formatted by the metrics layer (the UI does zero arithmetic).
 *
 * This module is pure: type definitions plus total converter functions. The only
 * behaviour it borrows is the metrics layer's display formatting — it never does
 * metric arithmetic of its own.
 */
import type {
  AggregatedMetrics,
  Metric,
  MetricUnit,
  UnavailableReason,
  CreativeDecision,
  CommercialDecision,
  DecisionReason,
  LinkCtrRating,
  ObjectiveFamily,
  CreativeEvaluation,
  IneligibilityReason,
} from '../metrics/index.ts'
import {
  formatMetric,
  formatMetricValue,
  explainUnavailable,
  decisionLabel,
  formatMinor,
  ACTIVE_DECISION_SETTINGS,
  optimizationEventLabel,
} from '../metrics/index.ts'
import type {
  NormalizedCampaign,
  NormalizedAdSet,
  NormalizedAd,
  NormalizedCreative,
} from '../types/index.ts'
import {
  resolveCreativePreview,
  resolveCreativeCopy,
  type PreviewSource,
} from './creativeContent.ts'

// --- metric DTO ------------------------------------------------------------

/**
 * A single metric, pre-computed and pre-formatted. `display` is for humans;
 * `value` is a bare numeric STRING (no symbol/grouping/%) the UI can sort or plot
 * without arithmetic, or null when unavailable. `reason` explains an unavailable
 * metric. All fields are JSON primitives.
 */
export interface MetricDTO {
  available: boolean
  display: string
  value: string | null
  unit: MetricUnit | null
  currency: string | null
  reason: UnavailableReason | null
  explanation: string | null
}

/** Named set of the dashboard's metrics, all as JSON-safe `MetricDTO`s. */
export interface MetricSetDTO {
  spend: MetricDTO
  impressions: MetricDTO
  reach: MetricDTO
  frequency: MetricDTO
  clicks: MetricDTO
  ctr: MetricDTO
  cpc: MetricDTO
  cpm: MetricDTO
  inlineLinkClicks: MetricDTO
  linkCtr: MetricDTO
  outboundClicks: MetricDTO
  landingPageViews: MetricDTO
  leads: MetricDTO
  cpl: MetricDTO
  costPerLinkClick: MetricDTO
  costPerVideoView75: MetricDTO
  videoPlays: MetricDTO
  videoP25: MetricDTO
  videoP50: MetricDTO
  videoP75: MetricDTO
  videoP95: MetricDTO
  videoP100: MetricDTO
}

// --- range / state DTOs ----------------------------------------------------

export interface DateRangeDTO {
  start: string
  end: string
}

/** Dataset provenance + freshness state for the dashboard header. */
export interface DataStateDTO {
  /** Always true for the seed source — a permanent "not real data" marker. */
  illustrative: boolean
  disclaimer: string
  currency: string | null
  range: DateRangeDTO
  /** The date the visible dashboard defaults to (newest seed day). */
  defaultDate: string
  days: number
  counts: {
    campaigns: number
    adSets: number
    ads: number
    insightRows: number
  }
}

// --- entity DTOs -----------------------------------------------------------

export interface SummaryDTO {
  scope: 'account'
  range: DateRangeDTO
  rowCount: number
  currency: string | null
  metrics: MetricSetDTO
}

export interface CampaignDTO {
  id: string
  name: string | null
  objective: string | null
  status: string | null
  effectiveStatus: string | null
  /**
   * The most recent day this campaign actually delivered (`YYYY-MM-DD`), across
   * ALL stored data (not just the window), or null if it never delivered. Drives
   * "most recent delivery" ordering so the daily view surfaces live campaigns
   * instead of old historical ones.
   */
  latestDeliveryDate: string | null
  /**
   * When this campaign's schedule ends (ISO timestamp), or null if it has no
   * scheduled end. Meta has NO "Completed" status — a campaign whose schedule
   * has run out stays `effective_status: ACTIVE` forever, and Ads Manager
   * derives its "Completed" label from the end date. This field carries the
   * same derivation input: the campaign's own `stop_time`, falling back to the
   * latest ad-set `end_time` when every ad set has one (lifetime-budget
   * campaigns schedule their end on the ad set). Judge it with
   * `campaignHasEnded` — never by comparing statuses.
   */
  scheduleEnd: string | null
  metrics: MetricSetDTO
}

export interface AdSetDTO {
  id: string
  campaignId: string | null
  name: string | null
  status: string | null
  effectiveStatus: string | null
  optimizationGoal: string | null
  /** Minor-unit budgets as exact strings (never bigint); null when absent. */
  dailyBudgetMinor: string | null
  lifetimeBudgetMinor: string | null
  metrics: MetricSetDTO
}

export interface AdDTO {
  id: string
  adSetId: string | null
  campaignId: string | null
  name: string | null
  status: string | null
  effectiveStatus: string | null
  creativeId: string | null
  metrics: MetricSetDTO
}

export interface CreativeDTO {
  id: string
  objectType: string | null
  /** Copy fields are resolved from top-level columns OR nested Meta structures. */
  primaryText: string | null
  headline: string | null
  description: string | null
  ctaType: string | null
  /** The ad's destination URL + its host, resolved from link_data/asset feed. */
  linkUrl: string | null
  linkDomain: string | null
  /** The best preview URL for the ACTUAL ad asset (image or video thumbnail). */
  previewUrl: string | null
  /** Which source `previewUrl` came from — drives a weak-fallback badge + diagnostics. */
  previewSource: PreviewSource
  /** Kept for compatibility; both mirror `previewUrl` (the chosen best asset). */
  imageUrl: string | null
  thumbnailUrl: string | null
  videoId: string | null
}

/**
 * A single ad plus its creative (or a safe no-creative state) and its metrics for
 * the requested range. `creative` is null and `hasCreative` false when the ad has
 * no resolvable creative.
 */
export interface AdDetailDTO {
  ad: AdDTO
  hasCreative: boolean
  creative: CreativeDTO | null
}

// --- creative scoring DTOs (Phase 5) ---------------------------------------

/**
 * Reserved slots the LATER AI layer fills in. All null in Phase 5. The AI may only
 * ever write here — it EXPLAINS the deterministic score, it never alters the maths.
 */
export interface CreativeAiAnnotationsDTO {
  explanation: string | null
  detectedPatterns: string | null
  supportingEvidence: string | null
  suggestedExperiment: string | null
  suggestedAction: string | null
}

/** The business thresholds a decision was made against (display + provenance). */
export interface DecisionSettingsDTO {
  version: string
  currency: string
  targetCpl: string
  maxAcceptableCpl: string
  minEvaluationSpend: string
  maxZeroLeadSpend: string
}

/**
 * The commercial recommendation for one creative plus the evidence behind it, so
 * the UI can show ONE clear decision and a plain-English reason without any
 * arithmetic. There is no score and no confidence band — just keep / turn off.
 */
export interface CreativeDecisionDTO {
  decision: CommercialDecision
  /** The human label, e.g. "KEEP ON — WINNER". */
  decisionLabel: string
  reason: DecisionReason
  /** Explanation-only Link CTR rating; null when Link CTR is unavailable. */
  linkCtrRating: LinkCtrRating | null
  /** Decision-driving metrics, carried on the decision so they survive list slimming. */
  spend: MetricDTO
  leads: MetricDTO
  cpl: MetricDTO
  linkCtr: MetricDTO
  /** Objective family/event — used to FILTER and label, never to decide. */
  cohort: {
    objectiveFamily: ObjectiveFamily | null
    optimizationEvent: string
  }
  /** The thresholds this decision was measured against. */
  settings: DecisionSettingsDTO
  window: DateRangeDTO & { days: number }
  /** Deterministic plain-English explanation + next action (not AI). */
  narrative: { explanation: string; nextAction: string }
  ai: CreativeAiAnnotationsDTO
}

/** A creative's resolved objective — used to FILTER, label, and scope eligibility. */
export interface ResolvedObjectiveDTO {
  /** The ad set optimisation event (e.g. "LEAD_GENERATION"), or null if unresolved. */
  optimizationEvent: string | null
  /** Display family (leads/traffic/video) for filtering + labelling. */
  objectiveFamily: ObjectiveFamily | null
  /** Campaign objective (context only). */
  campaignObjective: string | null
  /** Human label for the optimisation event, e.g. "Link Clicks". */
  label: string
}

/** A neutral not-evaluated status for an out-of-scope creative (no lead verdict). */
export interface EvaluationStatusDTO {
  /** e.g. "NOT EVALUATED — NON-LEAD OBJECTIVE". */
  label: string
  /** One plain-English sentence on why the lead rules don't apply. */
  explanation: string
}

/**
 * The full evaluation of one creative — a discriminated union on `eligibility` so
 * the UI (and the schema) can NEVER read a commercial decision off a creative that
 * wasn't eligible for one. Only `eligible` carries a `decision`; ineligible
 * variants carry a reason + neutral status and no fabricated keep/turn-off.
 */
export type CreativeEvaluationDTO =
  | {
      eligibility: 'eligible'
      objective: ResolvedObjectiveDTO
      decision: CreativeDecisionDTO
    }
  | {
      eligibility: 'unsupported_objective'
      objective: ResolvedObjectiveDTO
      reason: IneligibilityReason
      status: EvaluationStatusDTO
    }
  | {
      eligibility: 'unconfirmed_lead_objective'
      objective: ResolvedObjectiveDTO
      reason: IneligibilityReason
      status: EvaluationStatusDTO
    }

/**
 * Campaign / ad-set / ad context a creative runs under (for the decision-tool
 * view). Ad-level fields come from the creative's representative (first) ad; a
 * creative that backs several ads reports that ad plus `adCount` on the row.
 */
export interface CreativeContextDTO {
  campaignId: string | null
  campaignName: string | null
  objective: string | null
  adSetId: string | null
  adSetName: string | null
  adSetStatus: string | null
  adId: string | null
  adName: string | null
  adStatus: string | null
}

/**
 * One ranked-view row: a creative, its campaign/ad-set context, how many ads back
 * it, its cohort-scoped aggregated metrics, and its evaluation (eligibility ⊕
 * commercial decision). The full metric set is always present so a not-evaluated
 * creative can still show its objective-appropriate numbers.
 */
export interface CreativeRowDTO {
  /**
   * Stable composite identity (creative × ad set). The SAME creative running in two
   * ad sets yields two rows with two distinct `rowId`s but the same `creative.id`.
   * Routing, the compare/detail URL state and the Daily Ad Check all key on THIS,
   * never on `creative.id`.
   */
  rowId: string
  creative: CreativeDTO
  context: CreativeContextDTO
  adCount: number
  /** Newest day this creative delivered across ALL data (`YYYY-MM-DD`), or null. */
  latestDeliveryDate: string | null
  metrics: MetricSetDTO
  evaluation: CreativeEvaluationDTO
}

/** One day's aggregated metrics for the selected scope. */
export interface DailyRowDTO {
  date: string
  rowCount: number
  metrics: MetricSetDTO
}

// --- converters (pure) -----------------------------------------------------

/** Convert a computed `Metric` to a JSON-safe `MetricDTO` (display + value). */
export function metricToDTO(metric: Metric): MetricDTO {
  if (metric.status === 'unavailable') {
    return {
      available: false,
      display: formatMetric(metric),
      value: null,
      unit: null,
      currency: null,
      reason: metric.reason,
      explanation: explainUnavailable(metric.reason),
    }
  }
  return {
    available: true,
    display: formatMetric(metric),
    value: formatMetricValue(metric),
    unit: metric.unit,
    currency: metric.currency,
    reason: null,
    explanation: null,
  }
}

/** Project the aggregated metrics into the named DTO set. */
export function toMetricSetDTO(agg: AggregatedMetrics): MetricSetDTO {
  return {
    spend: metricToDTO(agg.spend),
    impressions: metricToDTO(agg.impressions),
    reach: metricToDTO(agg.reach),
    frequency: metricToDTO(agg.frequency),
    clicks: metricToDTO(agg.clicks),
    ctr: metricToDTO(agg.ctr),
    cpc: metricToDTO(agg.cpc),
    cpm: metricToDTO(agg.cpm),
    inlineLinkClicks: metricToDTO(agg.inlineLinkClicks),
    linkCtr: metricToDTO(agg.linkCtr),
    outboundClicks: metricToDTO(agg.outboundClicks),
    landingPageViews: metricToDTO(agg.landingPageViews),
    leads: metricToDTO(agg.leads),
    cpl: metricToDTO(agg.cpl),
    costPerLinkClick: metricToDTO(agg.costPerLinkClick),
    costPerVideoView75: metricToDTO(agg.costPerVideoView75),
    videoPlays: metricToDTO(agg.videoPlays),
    videoP25: metricToDTO(agg.videoP25),
    videoP50: metricToDTO(agg.videoP50),
    videoP75: metricToDTO(agg.videoP75),
    videoP95: metricToDTO(agg.videoP95),
    videoP100: metricToDTO(agg.videoP100),
  }
}

/** Serialise a possibly-null bigint as an exact string (never a bigint or Number). */
function bigintToString(value: bigint | null): string | null {
  return value === null ? null : value.toString()
}

/**
 * True when an available metric's value is strictly positive (non-zero). Works
 * for counts ("0" vs "50") and money ("0.00" vs "12.50") by scanning for any
 * non-zero digit — no arithmetic, so the UI can delegate "did this deliver?" /
 * "is there video?" judgements here instead of computing them in React.
 */
export function isPositiveMetric(metric: MetricDTO): boolean {
  if (!metric.available || metric.value === null) return false
  for (const ch of metric.value) {
    if (ch >= '1' && ch <= '9') return true
  }
  return false
}

/**
 * The campaign's scheduled end, or null when it runs indefinitely.
 *
 * `stop_time` on the campaign wins; without one, a campaign whose ad sets ALL
 * carry an `end_time` ends when the last of them does (lifetime-budget
 * campaigns hold their schedule on the ad set). One open-ended ad set — or no
 * ad sets at all — means no scheduled end. Pure derivation over synced fields;
 * nothing here asks "did it deliver?".
 */
export function campaignScheduleEnd(
  campaign: NormalizedCampaign,
  adSets: readonly NormalizedAdSet[],
): string | null {
  if (campaign.stopTime !== null) return campaign.stopTime.toISOString()
  const own = adSets.filter((s) => s.metaCampaignId === campaign.metaCampaignId)
  if (own.length === 0) return null
  let latest: Date | null = null
  for (const adSet of own) {
    if (adSet.endTime === null) return null // one open-ended ad set → no end
    if (latest === null || adSet.endTime > latest) latest = adSet.endTime
  }
  return latest === null ? null : latest.toISOString()
}

/**
 * True when Ads Manager would show this campaign as "Completed": Meta still
 * reports it ACTIVE, but its scheduled end has passed. This is THE shared
 * definition of "ended" — cards, filters and the Daily Ad Check must all call
 * this rather than re-deriving it, and none of them may infer "ended" from an
 * absence of recent spend (budget-throttled or in-review campaigns pause
 * delivery without ending).
 */
export function campaignHasEnded(
  campaign: Pick<CampaignDTO, 'status' | 'effectiveStatus' | 'scheduleEnd'>,
  now: Date = new Date(),
): boolean {
  const status = (
    campaign.effectiveStatus ??
    campaign.status ??
    ''
  ).toUpperCase()
  if (status !== 'ACTIVE') return false
  if (campaign.scheduleEnd === null) return false
  return new Date(campaign.scheduleEnd) <= now
}

/**
 * True when this campaign is genuinely live: Meta reports it ACTIVE AND its
 * schedule has not ended. THE shared definition of "live" — the dashboard's
 * Active badge and the Daily Ad Check's briefing scope both call this, so a
 * completed campaign can never read as live anywhere.
 */
export function campaignIsLive(
  campaign: Pick<CampaignDTO, 'status' | 'effectiveStatus' | 'scheduleEnd'>,
  now: Date = new Date(),
): boolean {
  const status = (
    campaign.effectiveStatus ??
    campaign.status ??
    ''
  ).toUpperCase()
  return status === 'ACTIVE' && !campaignHasEnded(campaign, now)
}

/**
 * True when THIS ad is paused — i.e. it is not delivering because it (or the ad
 * set / campaign above it) has been switched off. THE shared definition of
 * "paused": the card's greyed-out treatment and the Daily Ad Check's exclusion
 * both call this, so a paused ad can never read as live in one place and dead in
 * another.
 *
 * It reads `adStatus`, which is Meta's `effective_status` (falling back to the
 * plain status) — the exact value the card shows under "Status". Meta rolls the
 * hierarchy into that field, so `PAUSED`, `ADSET_PAUSED` and `CAMPAIGN_PAUSED`
 * all count; a substring test covers all three without hard-coding Meta's list.
 */
export function adIsPaused(
  context: Pick<CreativeContextDTO, 'adStatus'>,
): boolean {
  return (context.adStatus ?? '').toUpperCase().includes('PAUSED')
}

export function campaignToDTO(
  campaign: NormalizedCampaign,
  metrics: MetricSetDTO,
  latestDeliveryDate: string | null = null,
  adSets: readonly NormalizedAdSet[] = [],
): CampaignDTO {
  return {
    id: campaign.metaCampaignId,
    name: campaign.name,
    objective: campaign.objective,
    status: campaign.status,
    effectiveStatus: campaign.effectiveStatus,
    latestDeliveryDate,
    scheduleEnd: campaignScheduleEnd(campaign, adSets),
    metrics,
  }
}

export function adSetToDTO(
  adSet: NormalizedAdSet,
  metrics: MetricSetDTO,
): AdSetDTO {
  return {
    id: adSet.metaAdSetId,
    campaignId: adSet.metaCampaignId,
    name: adSet.name,
    status: adSet.status,
    effectiveStatus: adSet.effectiveStatus,
    optimizationGoal: adSet.optimizationGoal,
    dailyBudgetMinor: bigintToString(adSet.dailyBudgetMinor),
    lifetimeBudgetMinor: bigintToString(adSet.lifetimeBudgetMinor),
    metrics,
  }
}

export function adToDTO(ad: NormalizedAd, metrics: MetricSetDTO): AdDTO {
  return {
    id: ad.metaAdId,
    adSetId: ad.metaAdSetId,
    campaignId: ad.metaCampaignId,
    name: ad.name,
    status: ad.status,
    effectiveStatus: ad.effectiveStatus,
    creativeId: ad.metaCreativeId,
    metrics,
  }
}

export function creativeToDTO(creative: NormalizedCreative): CreativeDTO {
  // Preview and copy may live nested in the stored asset metadata when the
  // top-level columns are null — recover them so the card and detail are never
  // blank for a creative whose assets/copy Meta only returned inline (read-time,
  // no re-sync). The preview is tagged with its source so a weak page/profile
  // image is never presented as the real ad asset.
  const preview = resolveCreativePreview(creative)
  const copy = resolveCreativeCopy(creative)
  return {
    id: creative.metaCreativeId,
    objectType: creative.objectType,
    primaryText: copy.primaryText,
    headline: copy.headline,
    description: copy.description,
    ctaType: copy.ctaType,
    linkUrl: copy.linkUrl,
    linkDomain: copy.linkDomain,
    previewUrl: preview.previewUrl,
    previewSource: preview.source,
    imageUrl: preview.previewUrl,
    thumbnailUrl: preview.previewUrl,
    videoId: preview.videoId,
  }
}

/** Empty AI annotations — the reserved slots the later AI layer fills in. */
function emptyAiAnnotations(): CreativeAiAnnotationsDTO {
  return {
    explanation: null,
    detectedPatterns: null,
    supportingEvidence: null,
    suggestedExperiment: null,
    suggestedAction: null,
  }
}

/** The active business thresholds as a display-ready DTO. */
function decisionSettingsDTO(): DecisionSettingsDTO {
  const s = ACTIVE_DECISION_SETTINGS
  return {
    version: s.version,
    currency: s.currency,
    targetCpl: formatMinor(s.targetCplMinor),
    maxAcceptableCpl: formatMinor(s.maxAcceptableCplMinor),
    minEvaluationSpend: formatMinor(s.minEvaluationSpendMinor),
    maxZeroLeadSpend: formatMinor(s.maxZeroLeadSpendMinor),
  }
}

/** Convert a computed `CreativeDecision` to its JSON-safe DTO (metrics pre-formatted). */
export function creativeDecisionToDTO(
  decision: CreativeDecision,
): CreativeDecisionDTO {
  return {
    decision: decision.decision,
    decisionLabel: decisionLabel(decision.decision),
    reason: decision.reason,
    linkCtrRating: decision.linkCtrRating,
    spend: metricToDTO(decision.spend),
    leads: metricToDTO(decision.leads),
    cpl: metricToDTO(decision.cpl),
    linkCtr: metricToDTO(decision.linkCtr),
    cohort: {
      objectiveFamily: decision.cohort.objectiveFamily,
      optimizationEvent: decision.cohort.optimizationEvent,
    },
    settings: decisionSettingsDTO(),
    window: {
      start: decision.window.start,
      end: decision.window.end,
      days: decision.window.days,
    },
    narrative: {
      explanation: decision.narrative.explanation,
      nextAction: decision.narrative.nextAction,
    },
    ai: emptyAiAnnotations(),
  }
}

/** The resolved objective as a display-ready DTO (with a human label). */
function resolvedObjectiveToDTO(
  objective: CreativeEvaluation['objective'],
): ResolvedObjectiveDTO {
  return {
    optimizationEvent: objective.optimizationEvent,
    objectiveFamily: objective.objectiveFamily,
    campaignObjective: objective.campaignObjective,
    label: optimizationEventLabel(objective.optimizationEvent),
  }
}

/**
 * The neutral not-evaluated status + reason sentence for an out-of-scope creative.
 * It never mentions leads, CPL, or a keep/turn-off verdict — the whole point is
 * that the lead rules don't apply here.
 */
function evaluationStatusDTO(
  eligibility: 'unsupported_objective' | 'unconfirmed_lead_objective',
  reason: IneligibilityReason,
  objectiveLabel: string,
): EvaluationStatusDTO {
  if (eligibility === 'unconfirmed_lead_objective') {
    return {
      label: 'NOT EVALUATED — UNCONFIRMED LEAD OBJECTIVE',
      explanation:
        `This creative optimises for ${objectiveLabel}, but its conversion event ` +
        `isn’t confirmed to be a lead, so the lead-cost decision rules do not apply.`,
    }
  }
  const because =
    reason === 'unknown_optimisation'
      ? 'its objective could not be identified as lead generation'
      : reason === 'non_lead_conversion_event'
        ? `it optimises for a confirmed non-lead conversion event`
        : `it is optimised for ${objectiveLabel}`
  return {
    label: 'NOT EVALUATED — NON-LEAD OBJECTIVE',
    explanation: `This creative is not a lead ad — ${because}, so the lead-cost decision rules do not apply.`,
  }
}

/** Convert a domain `CreativeEvaluation` to its JSON-safe discriminated-union DTO. */
export function creativeEvaluationToDTO(
  evaluation: CreativeEvaluation,
): CreativeEvaluationDTO {
  const objective = resolvedObjectiveToDTO(evaluation.objective)
  if (evaluation.eligibility === 'eligible') {
    return {
      eligibility: 'eligible',
      objective,
      decision: creativeDecisionToDTO(evaluation.decision),
    }
  }
  return {
    eligibility: evaluation.eligibility,
    objective,
    reason: evaluation.reason,
    status: evaluationStatusDTO(
      evaluation.eligibility,
      evaluation.reason,
      objective.label,
    ),
  }
}

export function creativeRowToDTO(
  rowId: string,
  creative: NormalizedCreative,
  context: CreativeContextDTO,
  adCount: number,
  latestDeliveryDate: string | null,
  metrics: MetricSetDTO,
  evaluation: CreativeEvaluation,
): CreativeRowDTO {
  return {
    rowId,
    creative: creativeToDTO(creative),
    context,
    adCount,
    latestDeliveryDate,
    metrics,
    evaluation: creativeEvaluationToDTO(evaluation),
  }
}

/**
 * A shared compact placeholder for a metric the LIST/CARDS never read. Shipping
 * the full 24-metric set for every one of hundreds of creatives is what pushed the
 * `/api/creatives` response past Netlify's 6 MB function-response limit; the cards
 * read only `spend` (and the campaign grouping also `impressions`). Detail and
 * compare fetch the FULL metric set per creative via `getCreative`. Schema-valid:
 * `reason` is nullable, so this needs no client-schema or UI change.
 */
const OMITTED_METRIC: MetricDTO = {
  available: false,
  display: '',
  value: null,
  unit: null,
  currency: null,
  reason: null,
  explanation: null,
}

/**
 * Slim a full creative row to only what the ranked LIST/CARDS render, so the
 * `/api/creatives` collection response stays well under Netlify's 6 MB cap. Keeps
 * `spend` + `impressions` and the identity/preview fields the cards use; blanks
 * every heavy field they never read (the other 20 metrics, and the ad copy / URLs
 * shown only on the detail + compare screens, which fetch the full row separately).
 *
 * Type- and schema-preserving: every blanked field is already nullable, and the
 * metric set keeps all 22 keys — so the client's `CreativeRowDTO` schema, the seed
 * path, and the UI are all unchanged. Applied ONLY at the API list boundary (the
 * router), so the repository still returns full rows (parity + diagnostics intact).
 */
export function toCreativeListRow(row: CreativeRowDTO): CreativeRowDTO {
  return {
    ...row,
    creative: {
      ...row.creative,
      objectType: null,
      primaryText: null,
      description: null,
      ctaType: null,
      linkUrl: null,
      linkDomain: null,
      imageUrl: null,
      thumbnailUrl: null,
    },
    metrics: {
      ...row.metrics,
      // Keep spend + impressions (read by the cards / campaign grouping); blank
      // the rest — detail/compare fetch the full set via getCreative.
      reach: OMITTED_METRIC,
      frequency: OMITTED_METRIC,
      clicks: OMITTED_METRIC,
      ctr: OMITTED_METRIC,
      cpc: OMITTED_METRIC,
      cpm: OMITTED_METRIC,
      inlineLinkClicks: OMITTED_METRIC,
      linkCtr: OMITTED_METRIC,
      outboundClicks: OMITTED_METRIC,
      landingPageViews: OMITTED_METRIC,
      leads: OMITTED_METRIC,
      cpl: OMITTED_METRIC,
      costPerLinkClick: OMITTED_METRIC,
      costPerVideoView75: OMITTED_METRIC,
      videoPlays: OMITTED_METRIC,
      videoP25: OMITTED_METRIC,
      videoP50: OMITTED_METRIC,
      videoP75: OMITTED_METRIC,
      videoP95: OMITTED_METRIC,
      videoP100: OMITTED_METRIC,
    },
  }
}
