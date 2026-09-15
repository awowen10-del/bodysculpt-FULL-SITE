/**
 * Runtime `zod` schemas mirroring the DTOs the API returns (Stage 11B).
 *
 * BROWSER-SAFE: this module imports only `zod` and DTO *types*. The client
 * repository parses every server response against these schemas so a malformed or
 * unexpected body becomes a controlled error, never a bad object reaching React.
 *
 * The `satisfies` checks below make the compiler prove each schema's inferred type
 * matches the corresponding DTO exactly — the schema cannot silently drift from
 * the contract.
 */
import { z } from 'zod'
import type {
  AdDTO,
  AdDetailDTO,
  CampaignDTO,
  AdSetDTO,
  CreativeDTO,
  CreativeRowDTO,
  CreativeDecisionDTO,
  CreativeEvaluationDTO,
  DailyRowDTO,
  DataStateDTO,
  MetricDTO,
  MetricSetDTO,
  SummaryDTO,
} from './dto.ts'

const metricUnitSchema = z.enum(['integer', 'currency', 'percent', 'decimal'])
const unavailableReasonSchema = z.enum([
  'zero_denominator',
  'lead_definition_unresolved',
  'not_additive',
  'no_data',
])

export const metricDtoSchema = z.object({
  available: z.boolean(),
  display: z.string(),
  value: z.string().nullable(),
  unit: metricUnitSchema.nullable(),
  currency: z.string().nullable(),
  reason: unavailableReasonSchema.nullable(),
  explanation: z.string().nullable(),
})

export const metricSetDtoSchema = z.object({
  spend: metricDtoSchema,
  impressions: metricDtoSchema,
  reach: metricDtoSchema,
  frequency: metricDtoSchema,
  clicks: metricDtoSchema,
  ctr: metricDtoSchema,
  cpc: metricDtoSchema,
  cpm: metricDtoSchema,
  inlineLinkClicks: metricDtoSchema,
  linkCtr: metricDtoSchema,
  outboundClicks: metricDtoSchema,
  landingPageViews: metricDtoSchema,
  leads: metricDtoSchema,
  cpl: metricDtoSchema,
  costPerLinkClick: metricDtoSchema,
  costPerVideoView75: metricDtoSchema,
  videoPlays: metricDtoSchema,
  videoP25: metricDtoSchema,
  videoP50: metricDtoSchema,
  videoP75: metricDtoSchema,
  videoP95: metricDtoSchema,
  videoP100: metricDtoSchema,
})

const dateRangeDtoSchema = z.object({
  start: z.string(),
  end: z.string(),
})

export const dataStateDtoSchema = z.object({
  illustrative: z.boolean(),
  disclaimer: z.string(),
  currency: z.string().nullable(),
  range: dateRangeDtoSchema,
  defaultDate: z.string(),
  days: z.number(),
  counts: z.object({
    campaigns: z.number(),
    adSets: z.number(),
    ads: z.number(),
    insightRows: z.number(),
  }),
})

export const summaryDtoSchema = z.object({
  scope: z.literal('account'),
  range: dateRangeDtoSchema,
  rowCount: z.number(),
  currency: z.string().nullable(),
  metrics: metricSetDtoSchema,
})

// --- entity DTOs (Stage 11C) ------------------------------------------------

export const campaignDtoSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  objective: z.string().nullable(),
  status: z.string().nullable(),
  effectiveStatus: z.string().nullable(),
  latestDeliveryDate: z.string().nullable(),
  scheduleEnd: z.string().nullable(),
  metrics: metricSetDtoSchema,
})

export const adSetDtoSchema = z.object({
  id: z.string(),
  campaignId: z.string().nullable(),
  name: z.string().nullable(),
  status: z.string().nullable(),
  effectiveStatus: z.string().nullable(),
  optimizationGoal: z.string().nullable(),
  dailyBudgetMinor: z.string().nullable(),
  lifetimeBudgetMinor: z.string().nullable(),
  metrics: metricSetDtoSchema,
})

export const adDtoSchema = z.object({
  id: z.string(),
  adSetId: z.string().nullable(),
  campaignId: z.string().nullable(),
  name: z.string().nullable(),
  status: z.string().nullable(),
  effectiveStatus: z.string().nullable(),
  creativeId: z.string().nullable(),
  metrics: metricSetDtoSchema,
})

const previewSourceSchema = z.enum([
  'image_asset',
  'video_thumbnail',
  'asset_feed',
  'creative_thumbnail',
  'page_profile_fallback',
  'unavailable',
])

export const creativeDtoSchema = z.object({
  id: z.string(),
  objectType: z.string().nullable(),
  primaryText: z.string().nullable(),
  headline: z.string().nullable(),
  description: z.string().nullable(),
  ctaType: z.string().nullable(),
  linkUrl: z.string().nullable(),
  linkDomain: z.string().nullable(),
  previewUrl: z.string().nullable(),
  previewSource: previewSourceSchema,
  imageUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  videoId: z.string().nullable(),
})

export const adDetailDtoSchema = z.object({
  ad: adDtoSchema,
  hasCreative: z.boolean(),
  creative: creativeDtoSchema.nullable(),
})

export const dailyRowDtoSchema = z.object({
  date: z.string(),
  rowCount: z.number(),
  metrics: metricSetDtoSchema,
})

// --- creative decision DTOs -------------------------------------------------

const commercialDecisionSchema = z.enum([
  'winner',
  'needs_more_time',
  'turn_off',
])
const decisionReasonSchema = z.enum([
  'below_min_spend',
  'gathering_no_leads_yet',
  'zero_leads_over_budget',
  'cpl_at_or_below_target',
  'cpl_within_acceptable',
  'cpl_above_max',
  'leads_unresolved',
  'currency_mismatch',
])
const linkCtrRatingSchema = z.enum(['Poor', 'Weak', 'Good', 'Excellent'])
const objectiveFamilySchema = z.enum(['leads', 'traffic', 'video'])

const creativeAiAnnotationsSchema = z.object({
  explanation: z.string().nullable(),
  detectedPatterns: z.string().nullable(),
  supportingEvidence: z.string().nullable(),
  suggestedExperiment: z.string().nullable(),
  suggestedAction: z.string().nullable(),
})

const decisionSettingsSchema = z.object({
  version: z.string(),
  currency: z.string(),
  targetCpl: z.string(),
  maxAcceptableCpl: z.string(),
  minEvaluationSpend: z.string(),
  maxZeroLeadSpend: z.string(),
})

export const creativeDecisionDtoSchema = z.object({
  decision: commercialDecisionSchema,
  decisionLabel: z.string(),
  reason: decisionReasonSchema,
  linkCtrRating: linkCtrRatingSchema.nullable(),
  spend: metricDtoSchema,
  leads: metricDtoSchema,
  cpl: metricDtoSchema,
  linkCtr: metricDtoSchema,
  cohort: z.object({
    objectiveFamily: objectiveFamilySchema.nullable(),
    optimizationEvent: z.string(),
  }),
  settings: decisionSettingsSchema,
  window: z.object({
    start: z.string(),
    end: z.string(),
    days: z.number(),
  }),
  narrative: z.object({ explanation: z.string(), nextAction: z.string() }),
  ai: creativeAiAnnotationsSchema,
})

const ineligibilityReasonSchema = z.enum([
  'non_lead_optimisation',
  'non_lead_conversion_event',
  'unknown_optimisation',
  'conversion_event_unconfirmed',
])

const resolvedObjectiveDtoSchema = z.object({
  optimizationEvent: z.string().nullable(),
  objectiveFamily: objectiveFamilySchema.nullable(),
  campaignObjective: z.string().nullable(),
  label: z.string(),
})

const evaluationStatusDtoSchema = z.object({
  label: z.string(),
  explanation: z.string(),
})

/**
 * The evaluation is a DISCRIMINATED UNION on `eligibility`, so the wire schema
 * rejects impossible combinations: only the `eligible` variant may carry a
 * `decision`; the two ineligible variants carry a reason + status and no decision.
 */
export const creativeEvaluationDtoSchema = z.discriminatedUnion('eligibility', [
  z.object({
    eligibility: z.literal('eligible'),
    objective: resolvedObjectiveDtoSchema,
    decision: creativeDecisionDtoSchema,
  }),
  z.object({
    eligibility: z.literal('unsupported_objective'),
    objective: resolvedObjectiveDtoSchema,
    reason: ineligibilityReasonSchema,
    status: evaluationStatusDtoSchema,
  }),
  z.object({
    eligibility: z.literal('unconfirmed_lead_objective'),
    objective: resolvedObjectiveDtoSchema,
    reason: ineligibilityReasonSchema,
    status: evaluationStatusDtoSchema,
  }),
])

const creativeContextDtoSchema = z.object({
  campaignId: z.string().nullable(),
  campaignName: z.string().nullable(),
  objective: z.string().nullable(),
  adSetId: z.string().nullable(),
  adSetName: z.string().nullable(),
  adSetStatus: z.string().nullable(),
  adId: z.string().nullable(),
  adName: z.string().nullable(),
  adStatus: z.string().nullable(),
})

export const creativeRowDtoSchema = z.object({
  rowId: z.string(),
  creative: creativeDtoSchema,
  context: creativeContextDtoSchema,
  adCount: z.number(),
  latestDeliveryDate: z.string().nullable(),
  metrics: metricSetDtoSchema,
  evaluation: creativeEvaluationDtoSchema,
})

export const campaignListSchema = z.array(campaignDtoSchema)
export const adSetListSchema = z.array(adSetDtoSchema)
export const adListSchema = z.array(adDtoSchema)
export const dailyListSchema = z.array(dailyRowDtoSchema)
export const creativeRowListSchema = z.array(creativeRowDtoSchema)

// --- compile-time contract locks: schema output must equal the DTO exactly ------
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const _metric: Exact<z.infer<typeof metricDtoSchema>, MetricDTO> = true
const _metricSet: Exact<z.infer<typeof metricSetDtoSchema>, MetricSetDTO> = true
const _dataState: Exact<z.infer<typeof dataStateDtoSchema>, DataStateDTO> = true
const _summary: Exact<z.infer<typeof summaryDtoSchema>, SummaryDTO> = true
const _campaign: Exact<z.infer<typeof campaignDtoSchema>, CampaignDTO> = true
const _adSet: Exact<z.infer<typeof adSetDtoSchema>, AdSetDTO> = true
const _ad: Exact<z.infer<typeof adDtoSchema>, AdDTO> = true
const _creative: Exact<z.infer<typeof creativeDtoSchema>, CreativeDTO> = true
const _adDetail: Exact<z.infer<typeof adDetailDtoSchema>, AdDetailDTO> = true
const _daily: Exact<z.infer<typeof dailyRowDtoSchema>, DailyRowDTO> = true
const _decision: Exact<
  z.infer<typeof creativeDecisionDtoSchema>,
  CreativeDecisionDTO
> = true
const _evaluation: Exact<
  z.infer<typeof creativeEvaluationDtoSchema>,
  CreativeEvaluationDTO
> = true
const _row: Exact<z.infer<typeof creativeRowDtoSchema>, CreativeRowDTO> = true
// Reference the checks so `noUnusedLocals` is satisfied without side effects.
void _metric
void _metricSet
void _dataState
void _summary
void _campaign
void _adSet
void _ad
void _creative
void _adDetail
void _daily
void _decision
void _evaluation
void _row
