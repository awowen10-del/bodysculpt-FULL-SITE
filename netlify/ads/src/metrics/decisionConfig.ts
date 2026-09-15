/**
 * Commercial decision settings — DATA ONLY.
 *
 * The creative recommendation is a COMMERCIAL judgement made against fixed
 * business thresholds, not a relative score against peers. Those thresholds are
 * the owner's numbers, so they live here as versioned, immutable configuration
 * that the engine (`src/metrics/decision.ts`) reads — no threshold is compiled
 * into logic. This mirrors the lead-definition and (former) scoring config
 * pattern: the engine reads a record, it never hard-codes one.
 *
 * Money is stored as exact MINOR units (e.g. pence) so every comparison is exact
 * bigint arithmetic with zero floating-point drift. Link CTR bands are stored as
 * basis points (1% = 100 bp) for the same reason.
 *
 * Owner-approved thresholds (2026-07-20) for the 6-Week Transformation Challenge
 * lead ads — the "Balanced" preset. All remain configurable.
 */
import type { Metric } from './types.ts'
import { money } from './ratios.ts'
import { formatMetric } from './format.ts'
import { MetaValidationError } from '../validation/metaResponses.ts'

/**
 * Objective families a creative can be filtered/displayed under. Retained from the
 * former scoring config because the objective FILTER and the API `family` param
 * still use it — but it no longer drives the decision (that is purely commercial).
 */
export type ObjectiveFamily = 'leads' | 'traffic' | 'video'

/**
 * Map a Meta optimisation event (ad set `optimization_goal`) to a family. Used to
 * label/filter a creative by objective; NOT used to decide keep/turn-off.
 */
export const EVENT_FAMILY_MAP: Readonly<Record<string, ObjectiveFamily>> = {
  LEAD_GENERATION: 'leads',
  OFFSITE_CONVERSIONS: 'leads',
  LINK_CLICKS: 'traffic',
  LANDING_PAGE_VIEWS: 'traffic',
  THRUPLAY: 'video',
  REACH: 'video',
}

/** Link CTR is an EXPLANATION-only rating; it can never change a decision. */
export type LinkCtrRating = 'Poor' | 'Weak' | 'Good' | 'Excellent'

/**
 * Link CTR band floors, in basis points (1% = 100 bp). A value at or above a
 * floor earns that rating; below the weak floor is `Poor`. Owner spec:
 * Poor < 0.10% ≤ Weak < 0.40% ≤ Good < 0.80% ≤ Excellent.
 */
export interface LinkCtrBands {
  weakMinBasisPoints: number
  goodMinBasisPoints: number
  excellentMinBasisPoints: number
}

/**
 * The commercial decision thresholds. Every consumer of the creative
 * recommendation reads these: the keep/turn-off decision, cost per lead, the
 * minimum-evaluation-spend gate, the zero-lead ceiling and the Link CTR rating.
 */
export interface CommercialDecisionSettings {
  version: string
  /** ISO date the version was authored. Static literal — never `Date.now()`. */
  createdAt: string
  status: 'active'
  /** ISO currency the money thresholds are expressed in. */
  currency: string
  /** At or below this cost per lead → WINNER. */
  targetCplMinor: bigint
  /** Above this cost per lead → TURN OFF. Between target and this → NEEDS MORE TIME. */
  maxAcceptableCplMinor: bigint
  /** Below this spend, never judge on results → NEEDS MORE TIME. */
  minEvaluationSpendMinor: bigint
  /** At or above this spend with zero leads → TURN OFF. */
  maxZeroLeadSpendMinor: bigint
  linkCtr: LinkCtrBands
}

/**
 * Fail-closed validation: a misconfigured settings record can never silently
 * produce a wrong recommendation. Throws on any ordering or positivity breach.
 * Returns the same record for ergonomic `const X = validate({...})` use.
 */
export function validateDecisionSettings(
  s: CommercialDecisionSettings,
): CommercialDecisionSettings {
  const amounts = {
    targetCplMinor: s.targetCplMinor,
    maxAcceptableCplMinor: s.maxAcceptableCplMinor,
    minEvaluationSpendMinor: s.minEvaluationSpendMinor,
    maxZeroLeadSpendMinor: s.maxZeroLeadSpendMinor,
  }
  for (const [field, value] of Object.entries(amounts)) {
    if (typeof value !== 'bigint' || value <= 0n) {
      throw new MetaValidationError(
        `decisionSettings.${field}`,
        'must be a positive bigint amount in minor units',
      )
    }
  }
  if (s.targetCplMinor > s.maxAcceptableCplMinor) {
    throw new MetaValidationError(
      'decisionSettings.targetCplMinor',
      'target CPL must not exceed the maximum acceptable CPL',
    )
  }
  if (s.minEvaluationSpendMinor > s.maxZeroLeadSpendMinor) {
    throw new MetaValidationError(
      'decisionSettings.minEvaluationSpendMinor',
      'minimum evaluation spend must not exceed the maximum zero-lead spend',
    )
  }
  const { weakMinBasisPoints, goodMinBasisPoints, excellentMinBasisPoints } =
    s.linkCtr
  if (!(
    0 < weakMinBasisPoints &&
    weakMinBasisPoints < goodMinBasisPoints &&
    goodMinBasisPoints < excellentMinBasisPoints
  )) {
    throw new MetaValidationError(
      'decisionSettings.linkCtr',
      'link CTR band floors must be strictly ascending and positive',
    )
  }
  return s
}

/**
 * Decision settings **v1** — the shipped active configuration ("Balanced").
 * Owner-approved 2026-07-20 for the 6-Week Transformation Challenge lead ads.
 */
export const DECISION_SETTINGS_V1: CommercialDecisionSettings =
  validateDecisionSettings({
    version: 'decision-v1',
    createdAt: '2026-07-20',
    status: 'active',
    currency: 'GBP',
    targetCplMinor: 2000n, // £20.00
    maxAcceptableCplMinor: 3500n, // £35.00
    minEvaluationSpendMinor: 5000n, // £50.00
    maxZeroLeadSpendMinor: 7500n, // £75.00
    linkCtr: {
      weakMinBasisPoints: 10, // 0.10%
      goodMinBasisPoints: 40, // 0.40%
      excellentMinBasisPoints: 80, // 0.80%
    },
  })

/** The single ACTIVE decision settings the engine reads. */
export const ACTIVE_DECISION_SETTINGS: CommercialDecisionSettings =
  DECISION_SETTINGS_V1

/** A money threshold (minor units) as an exact display Metric, e.g. "£20.00". */
export function minorToMoney(
  minor: bigint,
  settings: CommercialDecisionSettings = ACTIVE_DECISION_SETTINGS,
): Metric {
  return money({ units: minor, scale: 2 }, settings.currency)
}

/** A money threshold formatted for humans, e.g. "£20.00". */
export function formatMinor(
  minor: bigint,
  settings: CommercialDecisionSettings = ACTIVE_DECISION_SETTINGS,
): string {
  return formatMetric(minorToMoney(minor, settings))
}

// --- eligibility settings -----------------------------------------------------

/**
 * Which creatives the lead commercial engine is even allowed to judge — DATA ONLY.
 *
 * The commercial decision (`decision.ts`) is a lead-cost judgement, so it is only
 * valid for creatives whose intended optimisation outcome is lead generation.
 * Everything else (traffic, video, awareness, or a conversion whose event we can't
 * confirm is a lead) is OUT OF SCOPE and must never be forced into keep/turn-off.
 *
 * Scope is versioned config, not scattered string checks: the canonical resolver
 * (`src/metrics/eligibility.ts`) reads this record, so "what counts as a lead ad"
 * lives in exactly one place and changes without touching logic.
 */
export interface EligibilitySettings {
  version: string
  /** ISO date the version was authored. Static literal — never `Date.now()`. */
  createdAt: string
  /**
   * Optimisation goals that ARE lead generation with no further confirmation
   * needed (native Instant Form). Owner-confirmed supported path.
   */
  supportedLeadEvents: readonly string[]
  /**
   * Optimisation goals that COULD be lead generation but only when the promoted /
   * configured conversion event is confirmed to be a lead (e.g. OFFSITE_CONVERSIONS
   * — a website conversion could be a purchase, a view, or a lead). These are
   * `unconfirmed_lead_objective` until a confirming conversion event is present.
   */
  conversionEventsNeedingConfirmation: readonly string[]
  /**
   * Conversion events (Meta `promoted_object.custom_event_type`, or a resolved lead
   * action type) that POSITIVELY confirm a lead objective. Only when a creative's
   * configured conversion event is one of these is a `needsConfirmation` goal
   * treated as eligible. Confirmation is CONFIGURATION-level, never inferred from
   * incidentally-attributed leads.
   */
  confirmedLeadConversionEvents: readonly string[]
}

/**
 * Eligibility settings **v1** (owner-approved 2026-07-20). Only LEAD_GENERATION is
 * unconditionally in scope; OFFSITE_CONVERSIONS needs a confirmed lead conversion
 * event; everything else is out of scope. `promoted_object`/`destination_type` are
 * NOT yet persisted by the sync, so in production OFFSITE_CONVERSIONS currently
 * resolves as `unconfirmed_lead_objective` until that field is synced.
 */
export const ELIGIBILITY_SETTINGS_V1: EligibilitySettings = {
  version: 'eligibility-v1',
  createdAt: '2026-07-20',
  supportedLeadEvents: ['LEAD_GENERATION'],
  conversionEventsNeedingConfirmation: ['OFFSITE_CONVERSIONS'],
  // `LEAD` is the promoted_object.custom_event_type for a lead conversion; the two
  // action types are accepted so a future resolver can confirm from either source.
  confirmedLeadConversionEvents: [
    'LEAD',
    'onsite_conversion.lead_grouped',
    'offsite_conversion.fb_pixel_lead',
  ],
}

/** The single ACTIVE eligibility settings the resolver reads. */
export const ACTIVE_ELIGIBILITY_SETTINGS: EligibilitySettings =
  ELIGIBILITY_SETTINGS_V1
