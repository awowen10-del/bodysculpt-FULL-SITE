/**
 * Lead-definition configuration — DATA ONLY (Stage 5).
 *
 * The lead metric is a MAPPING CHOICE, not a fact. It lives here as configuration
 * so the engine (`src/meta/leadExtraction.ts`) reads it; no mode is compiled into
 * logic.
 *
 * APPROVED PRODUCT DECISION (2026-07-20, owner): for deciding whether a lead-ad
 * creative should be turned off, kept or scaled, the ROUTE a lead arrived by does
 * not change the decision. A lead attributed by Meta counts whether it came via a
 * Facebook Instant Form, a website/Pixel conversion, or a mixed
 * WEBSITE_AND_LEAD_FORM destination. The production metric therefore matches Meta
 * Ads Manager's "Results" figure: the canonical generic `lead` action_type.
 *
 * The shipped default is consequently `generic_aggregate`, marked `verified`.
 * Component action_types are preserved and reported for DIAGNOSTICS ONLY — they
 * are never added together in production (they may overlap, and Meta already
 * supplies the roll-up), and website leads are never subtracted. The custom
 * conversion remains hard-excluded.
 */
import type { LeadDefinition, LeadMode } from '../types/index.ts'

/** Meta's canonical roll-up — the Ads Manager "Results" figure for lead campaigns. */
export const GENERIC_LEAD_ACTION_TYPE = 'lead'
/** Native Meta lead-form (Instant Form) leads. */
export const NATIVE_LEAD_ACTION_TYPE = 'onsite_conversion.lead_grouped'
/** Website Pixel `Lead` events. */
export const WEBSITE_LEAD_ACTION_TYPE = 'offsite_conversion.fb_pixel_lead'
/** On-site web lead from a mixed WEBSITE_AND_LEAD_FORM destination. */
export const ONSITE_WEB_LEAD_ACTION_TYPE = 'onsite_web_lead'

/** The recognised component lead action_types (native + website). */
export const COMPONENT_LEAD_ACTION_TYPES = [
  NATIVE_LEAD_ACTION_TYPE,
  WEBSITE_LEAD_ACTION_TYPE,
] as const

/**
 * Every component action_type tallied for diagnostics alongside the canonical
 * roll-up. DIAGNOSTIC ONLY — this list is never a countable lead definition, so
 * adding to it can never change a production total.
 */
export const DIAGNOSTIC_LEAD_COMPONENT_ACTION_TYPES = [
  NATIVE_LEAD_ACTION_TYPE,
  WEBSITE_LEAD_ACTION_TYPE,
  ONSITE_WEB_LEAD_ACTION_TYPE,
] as const

/**
 * Action_types that must NEVER be counted as leads until explicitly verified.
 * The Stage 4 custom conversion (`offsite_conversion.custom.<id>`) is excluded by
 * PREFIX so no account-specific id is hard-coded; it may duplicate the website
 * Pixel lead (identical Stage 4 totals). See docs/STAGE-4-LIVE-VERIFICATION.md.
 */
export const EXCLUDED_ACTION_TYPE_PREFIXES = [
  'offsite_conversion.custom.',
] as const

/** True when an action_type is on the hard exclusion list (never counted). */
export function isExcludedLeadActionType(actionType: string): boolean {
  return EXCLUDED_ACTION_TYPE_PREFIXES.some((prefix) =>
    actionType.startsWith(prefix),
  )
}

/**
 * The four working modes plus the `unresolved` fallback. Only
 * `generic_aggregate` is `verified` — it carries the owner's approved product
 * decision (match Ads Manager "Results"). The rest stay
 * `provisional_unverified`: they exist for diagnostics and history, and none may
 * be adopted as the business metric without a further reviewed change.
 */
export const LEAD_DEFINITIONS: Record<LeadMode, LeadDefinition> = {
  unresolved: {
    mode: 'unresolved',
    actionTypes: [],
    status: 'provisional_unverified',
    label:
      'Unresolved (default) — no authoritative lead total; leads stay null until reviewed',
  },
  generic_aggregate: {
    mode: 'generic_aggregate',
    actionTypes: [GENERIC_LEAD_ACTION_TYPE],
    status: 'verified',
    label:
      "Generic aggregate — Meta's canonical `lead` roll-up (matches Ads Manager Results)",
  },
  components: {
    mode: 'components',
    actionTypes: [...COMPONENT_LEAD_ACTION_TYPES],
    status: 'provisional_unverified',
    label:
      'Explicit components — native lead-form + website Pixel leads summed',
  },
  native_only: {
    mode: 'native_only',
    actionTypes: [NATIVE_LEAD_ACTION_TYPE],
    status: 'provisional_unverified',
    label: 'Native only — Meta lead-form (Instant Form) leads',
  },
  website_only: {
    mode: 'website_only',
    actionTypes: [WEBSITE_LEAD_ACTION_TYPE],
    status: 'provisional_unverified',
    label: 'Website only — website Pixel `Lead` events',
  },
}

/**
 * The shipped production lead definition — used by the LIVE pipeline and by every
 * consumer of the resolved lead value (cost per lead, the evidence threshold,
 * creative classification, campaign/ad-set/ad aggregation, recommendations).
 *
 * `generic_aggregate`: Meta's canonical `lead` action_type, matching the Ads
 * Manager "Results" figure regardless of lead route.
 */
export const DEFAULT_LEAD_DEFINITION: LeadDefinition =
  LEAD_DEFINITIONS.generic_aggregate

/**
 * The lead definition applied to the offline seed dataset. Deliberately IDENTICAL
 * to the production default: there is exactly ONE lead-resolution contract, so the
 * seed dashboard and the live dashboard can never disagree about what a lead is.
 */
export const SEED_LEAD_DEFINITION: LeadDefinition = DEFAULT_LEAD_DEFINITION
