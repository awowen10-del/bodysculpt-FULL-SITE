/**
 * Creative eligibility — the ONE gate that decides whether the lead commercial
 * engine is even allowed to judge a creative.
 *
 * Evaluation eligibility and the commercial decision are SEPARATE concerns. The
 * decision engine (`decision.ts`) answers "keep or turn off?" — but that question
 * is only meaningful for a lead-generation creative. A traffic / video / awareness
 * ad, or a website conversion whose event we can't confirm is a lead, must NEVER be
 * pushed through lead-cost logic (its "leads" would be zero or incidental, and its
 * CPL meaningless). This module resolves that scope, once, for the whole app.
 *
 * The result is a discriminated union so the type system makes invalid states
 * unrepresentable: only an `eligible` resolution can carry a commercial decision;
 * an ineligible one carries a reason and never a fabricated keep/turn-off.
 *
 * Pure, total, config-driven: scope lives in `EligibilitySettings`, never in
 * inline string checks, so offline seed data and production follow the same path.
 */
import type { ObjectiveFamily, EligibilitySettings } from './decisionConfig.ts'
import {
  EVENT_FAMILY_MAP,
  ACTIVE_ELIGIBILITY_SETTINGS,
} from './decisionConfig.ts'
import type { CreativeDecision } from './decision.ts'

/** Whether the lead engine may judge a creative, and if not, the shape of why. */
export type Eligibility =
  'eligible' | 'unsupported_objective' | 'unconfirmed_lead_objective'

/** Why a creative is out of scope. Null only when eligible. */
export type IneligibilityReason =
  /** A known non-lead optimisation (link clicks, landing-page views, thruplay, reach). */
  | 'non_lead_optimisation'
  /** A conversion ad set whose configured event is POSITIVELY a non-lead (e.g. PURCHASE). */
  | 'non_lead_conversion_event'
  /** No / unknown / unmapped optimisation goal — can't confirm it's a lead ad. */
  | 'unknown_optimisation'
  /** A conversion objective whose configured event isn't confirmed to be a lead. */
  | 'conversion_event_unconfirmed'

/** The creative's resolved objective, carried on every evaluation (scope + labels). */
export interface ResolvedObjective {
  /** The ad set `optimization_goal`, or null when unresolved/mixed. */
  optimizationEvent: string | null
  /** The display family for FILTER + labelling only — never the eligibility gate. */
  objectiveFamily: ObjectiveFamily | null
  /** The campaign objective (context only; not a confirmation of a lead event). */
  campaignObjective: string | null
}

/**
 * The pure resolver result — a discriminated union so `reason` is only nullable
 * on the eligible branch, and non-null (present) on every ineligible branch.
 */
export type EligibilityResolution =
  | { eligibility: 'eligible'; objective: ResolvedObjective; reason: null }
  | {
      eligibility: Exclude<Eligibility, 'eligible'>
      objective: ResolvedObjective
      reason: IneligibilityReason
    }

/**
 * Structured, configuration-level evidence of what a conversion ad set optimises
 * for — extracted from `promoted_object`. This is the ONLY thing that can confirm
 * (or refute) a lead objective for OFFSITE_CONVERSIONS; it is never inferred from
 * campaign objective, attributed leads, destination type, or a bare pixel.
 */
export interface ConversionEvidence {
  /**
   * `promoted_object.custom_event_type` — Meta's CLOSED standard-event enum
   * (`LEAD`, `PURCHASE`, `ADD_TO_CART`, …). Authoritative when present: `LEAD`
   * confirms a lead; any other value positively confirms a NON-lead.
   */
  customEventType: string | null
  /**
   * `promoted_object.custom_conversion_id` — a custom conversion whose event type
   * is NOT inline; resolving it needs a separate bounded read (see README/report).
   * Present-but-unresolved is AMBIGUOUS, never assumed to be a lead.
   */
  customConversionId: string | null
  /**
   * The custom conversion's event type, IF a lookup/cache has resolved it. Null
   * until that bounded read is wired — so a custom conversion stays unconfirmed.
   */
  resolvedCustomConversionEventType: string | null
}

/** Everything the resolver needs — no I/O, no ad-set object. */
export interface EligibilityInput {
  /** The single resolved optimisation event (ad set goal), or null if none/mixed. */
  optimizationEvent: string | null
  /** Campaign objective (context only). */
  campaignObjective: string | null
  /**
   * Structured conversion evidence from `promoted_object`, or null when the ad set
   * carries none. Only consulted for goals that need confirmation (OFFSITE_CONVERSIONS).
   */
  conversion: ConversionEvidence | null
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const textOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null

/**
 * Extract structured conversion evidence from a raw `promoted_object`. Reads only
 * the authoritative structured fields — no substring matching, no name guessing.
 * A custom conversion's event type is left unresolved (needs a bounded lookup).
 */
export function conversionEvidenceOf(
  promotedObject: unknown,
  resolvedCustomConversionEventType: string | null = null,
): ConversionEvidence {
  if (!isRecord(promotedObject)) {
    return {
      customEventType: null,
      customConversionId: null,
      resolvedCustomConversionEventType,
    }
  }
  return {
    customEventType: textOrNull(promotedObject.custom_event_type),
    customConversionId: textOrNull(promotedObject.custom_conversion_id),
    resolvedCustomConversionEventType,
  }
}

/**
 * Resolve whether the lead engine may judge this creative. Order matters:
 *  1. A supported lead event (LEAD_GENERATION) is eligible outright.
 *  2. A conversion goal (OFFSITE_CONVERSIONS) is eligible ONLY with a confirmed
 *     lead conversion event; otherwise it is `unconfirmed_lead_objective`.
 *  3. A known non-lead optimisation is `unsupported_objective` (non-lead).
 *  4. Anything else (null / unknown / unmapped) is `unsupported_objective`.
 */
export function resolveCreativeEligibility(
  input: EligibilityInput,
  settings: EligibilitySettings = ACTIVE_ELIGIBILITY_SETTINGS,
): EligibilityResolution {
  const event = input.optimizationEvent
  const objectiveFamily =
    event === null ? null : (EVENT_FAMILY_MAP[event] ?? null)
  const objective: ResolvedObjective = {
    optimizationEvent: event,
    objectiveFamily,
    campaignObjective: input.campaignObjective,
  }
  const eligible = (): EligibilityResolution => ({
    eligibility: 'eligible',
    objective,
    reason: null,
  })
  const ineligible = (
    eligibility: Exclude<Eligibility, 'eligible'>,
    reason: IneligibilityReason,
  ): EligibilityResolution => ({ eligibility, objective, reason })

  if (event !== null && settings.supportedLeadEvents.includes(event)) {
    return eligible()
  }
  if (
    event !== null &&
    settings.conversionEventsNeedingConfirmation.includes(event)
  ) {
    // The authoritative configured event: the standard-event enum, or a resolved
    // custom-conversion event type. A custom_conversion_id that is present but
    // unresolved yields no event → stays ambiguous (fail-closed).
    const configuredEvent =
      input.conversion?.customEventType ??
      input.conversion?.resolvedCustomConversionEventType ??
      null
    if (configuredEvent !== null) {
      return settings.confirmedLeadConversionEvents.includes(configuredEvent)
        ? eligible() // positively a lead conversion
        : ineligible('unsupported_objective', 'non_lead_conversion_event') // positively NON-lead
    }
    // No configured event we can trust (missing promoted_object, or an unresolved
    // custom conversion) → never assume a lead.
    return ineligible(
      'unconfirmed_lead_objective',
      'conversion_event_unconfirmed',
    )
  }
  if (event !== null && objectiveFamily !== null) {
    // A recognised non-lead optimisation (traffic / video).
    return ineligible('unsupported_objective', 'non_lead_optimisation')
  }
  // Null, unknown or unmapped optimisation goal.
  return ineligible('unsupported_objective', 'unknown_optimisation')
}

/** Human label for a Meta optimisation event, for neutral UI copy. */
export function optimizationEventLabel(event: string | null): string {
  if (event === null) return 'an unknown objective'
  const labels: Record<string, string> = {
    LEAD_GENERATION: 'Lead Generation',
    OFFSITE_CONVERSIONS: 'Website Conversions',
    LINK_CLICKS: 'Link Clicks',
    LANDING_PAGE_VIEWS: 'Landing Page Views',
    THRUPLAY: 'ThruPlay',
    REACH: 'Reach',
  }
  return labels[event] ?? event
}

// --- domain evaluation (eligibility ⊕ decision) -------------------------------

/** An in-scope creative: it carries exactly one commercial decision. */
export interface EligibleEvaluation {
  eligibility: 'eligible'
  objective: ResolvedObjective
  decision: CreativeDecision
}

/** An out-of-scope creative: a reason, and NO fabricated commercial decision. */
export interface IneligibleEvaluation {
  eligibility: 'unsupported_objective' | 'unconfirmed_lead_objective'
  objective: ResolvedObjective
  reason: IneligibilityReason
}

/**
 * The full evaluation of one creative. A discriminated union on `eligibility`:
 * the compiler forbids reading `.decision` off an ineligible creative, so a
 * non-lead ad can never carry a keep/turn-off recommendation.
 */
export type CreativeEvaluation = EligibleEvaluation | IneligibleEvaluation
