/**
 * Lead + landing-page-view extraction from a Meta insight row's `actions` array
 * (Stage 5). Config-driven and FAIL-CLOSED: an invalid lead definition throws
 * before any extraction, the custom conversion can never be counted, and the
 * generic `lead` aggregate can never be combined with its components.
 *
 * Counts are summed LOSSLESSLY into `bigint` (never JavaScript `Number`). A
 * present-but-malformed action value fails loudly; a genuinely absent `actions`
 * array yields null for landing-page views; and `unresolved` yields null leads.
 */
import type {
  LeadComponentBreakdown,
  LeadDefinition,
  LeadExtractionResult,
  LeadMode,
  LeadReconciliation,
} from '../types/index.ts'
import { readActionStats } from './actions.ts'
import {
  parseMetaCount,
  MetaValidationError,
} from '../validation/metaResponses.ts'
import {
  GENERIC_LEAD_ACTION_TYPE,
  NATIVE_LEAD_ACTION_TYPE,
  ONSITE_WEB_LEAD_ACTION_TYPE,
  WEBSITE_LEAD_ACTION_TYPE,
  isExcludedLeadActionType,
} from '../config/leadActionConfig.ts'
import { LANDING_PAGE_VIEW_ACTION_TYPE } from './fields.ts'

const KNOWN_MODES: readonly LeadMode[] = [
  'unresolved',
  'generic_aggregate',
  'components',
  'native_only',
  'website_only',
]

/**
 * Validate a lead definition. Throws (fail-closed) on any problem so a bad
 * configuration can never silently produce a wrong lead total.
 */
export function validateLeadDefinition(def: LeadDefinition): void {
  if (!KNOWN_MODES.includes(def.mode)) {
    throw new MetaValidationError(
      'leadDefinition.mode',
      `unknown mode "${def.mode}"`,
    )
  }
  if (
    !Array.isArray(def.actionTypes) ||
    def.actionTypes.some((t) => typeof t !== 'string' || t.trim() === '')
  ) {
    throw new MetaValidationError(
      'leadDefinition.actionTypes',
      'must be an array of non-empty action_type strings',
    )
  }
  const types = def.actionTypes

  if (def.mode === 'unresolved') {
    if (types.length !== 0) {
      throw new MetaValidationError(
        'leadDefinition.actionTypes',
        'the unresolved default must have no action types',
      )
    }
    return
  }

  if (types.length === 0) {
    throw new MetaValidationError(
      'leadDefinition.actionTypes',
      `mode "${def.mode}" requires at least one action type`,
    )
  }
  if (new Set(types).size !== types.length) {
    throw new MetaValidationError(
      'leadDefinition.actionTypes',
      'duplicate action types are not allowed',
    )
  }
  const excluded = types.filter(isExcludedLeadActionType)
  if (excluded.length > 0) {
    throw new MetaValidationError(
      'leadDefinition.actionTypes',
      `excluded action types must never be counted: ${excluded.join(', ')}`,
    )
  }
  // Double-count guard: the generic aggregate already rolls up its components,
  // so it can never be combined with any other action type.
  if (types.includes(GENERIC_LEAD_ACTION_TYPE) && types.length > 1) {
    throw new MetaValidationError(
      'leadDefinition.actionTypes',
      'the generic "lead" aggregate cannot be combined with component action types (double-count)',
    )
  }
}

/**
 * Sum, losslessly, the values of every `actions` entry whose action_type is in
 * `wanted`. Duplicate entries for the same action_type within one row are summed
 * once through this deterministic pass. A present-but-malformed value throws.
 */
function sumActionValues(
  actions: unknown,
  wanted: ReadonlySet<string>,
  fieldLabel: string,
): { total: bigint; present: boolean } {
  let total = 0n
  let present = false
  for (const { actionType, rawValue } of readActionStats(actions)) {
    if (!wanted.has(actionType)) continue
    present = true
    const n = parseMetaCount(rawValue, `${fieldLabel}[${actionType}]`)
    if (n !== null) total += n
  }
  return { total, present }
}

/** Sum one action_type; `null` when it is absent from the row entirely. */
function tallyActionType(actions: unknown, actionType: string): bigint | null {
  const { total, present } = sumActionValues(
    actions,
    new Set([actionType]),
    'actions',
  )
  return present ? total : null
}

/**
 * Tally the component lead action_types for DIAGNOSTICS. These are preserved and
 * exposed separately; they are NEVER added together to form a production total,
 * and website leads are never subtracted from the canonical roll-up.
 */
export function extractLeadComponents(
  actions: unknown,
): LeadComponentBreakdown {
  return {
    native: tallyActionType(actions, NATIVE_LEAD_ACTION_TYPE),
    website: tallyActionType(actions, WEBSITE_LEAD_ACTION_TYPE),
    onsiteWeb: tallyActionType(actions, ONSITE_WEB_LEAD_ACTION_TYPE),
  }
}

/**
 * Reconciliation diagnostic: compare native + website against the canonical
 * generic `lead`. Where they are equal the row is `reconciled`; where they differ
 * it is a `mismatch` and is FLAGGED FOR REVIEW ONLY — the generic roll-up remains
 * the scoring figure either way. `not_applicable` when the generic roll-up or
 * both components are absent, so there is nothing to compare.
 */
export function reconcileLeads(
  generic: bigint | null,
  components: LeadComponentBreakdown,
): LeadReconciliation {
  const componentSum =
    components.native === null && components.website === null
      ? null
      : (components.native ?? 0n) + (components.website ?? 0n)

  if (generic === null || componentSum === null) {
    return {
      status: 'not_applicable',
      generic,
      componentSum,
      delta: null,
    }
  }
  const delta = componentSum - generic
  return {
    status: delta === 0n ? 'reconciled' : 'mismatch',
    generic,
    componentSum,
    delta,
  }
}

/**
 * Extract the lead total for one insight row under a given definition, plus the
 * diagnostic component breakdown and reconciliation.
 *
 * - `unresolved` -> value null.
 * - A working mode -> the lossless bigint sum of its own action_types.
 * - `generic_aggregate` (the production mode) adds one fail-closed rule: when the
 *   canonical `lead` action_type is ABSENT but component lead events ARE present,
 *   we refuse to invent a total by summing the components (they may overlap), so
 *   the row is unresolved and reported as `generic_lead_absent`. When no lead
 *   event of any kind is present, the row is a genuine zero (Meta omits zero-value
 *   action types), which stays 0n.
 *
 * The component tallies are ALWAYS computed, under every mode, and are never
 * folded into `value`.
 */
export function extractLeads(
  actions: unknown,
  def: LeadDefinition,
): LeadExtractionResult {
  validateLeadDefinition(def)

  const components = extractLeadComponents(actions)
  const genericTally = tallyActionType(actions, GENERIC_LEAD_ACTION_TYPE)
  const reconciliation = reconcileLeads(genericTally, components)

  if (def.mode === 'unresolved') {
    return {
      value: null,
      actionTypesUsed: [],
      mode: def.mode,
      status: def.status,
      unresolvedReason: 'definition_unresolved',
      components,
      reconciliation,
    }
  }

  const wanted = new Set(def.actionTypes)
  const { total, present } = sumActionValues(actions, wanted, 'actions')

  // Fail-closed: never substitute components for a missing canonical roll-up.
  if (def.mode === 'generic_aggregate' && !present) {
    const componentsPresent =
      components.native !== null ||
      components.website !== null ||
      components.onsiteWeb !== null
    if (componentsPresent) {
      return {
        value: null,
        actionTypesUsed: [...def.actionTypes],
        mode: def.mode,
        status: def.status,
        unresolvedReason: 'generic_lead_absent',
        components,
        reconciliation,
      }
    }
  }

  return {
    value: total,
    actionTypesUsed: [...def.actionTypes],
    mode: def.mode,
    status: def.status,
    unresolvedReason: null,
    components,
    reconciliation,
  }
}

/**
 * Extract landing-page views (a CONFIRMED structure, not config-driven): the
 * `landing_page_view` action_type inside `actions`. Absent `actions` -> null
 * (unknown); present -> the lossless count (0n is a real zero).
 */
export function extractLandingPageViews(actions: unknown): {
  value: bigint | null
  actionType: string | null
} {
  if (!Array.isArray(actions)) return { value: null, actionType: null }
  let total = 0n
  for (const { actionType, rawValue } of readActionStats(actions)) {
    if (actionType !== LANDING_PAGE_VIEW_ACTION_TYPE) continue
    const n = parseMetaCount(
      rawValue,
      `actions[${LANDING_PAGE_VIEW_ACTION_TYPE}]`,
    )
    if (n !== null) total += n
  }
  return { value: total, actionType: LANDING_PAGE_VIEW_ACTION_TYPE }
}

/**
 * A compact, human-readable provenance string recording exactly how a row's lead
 * value was derived — persisted to `leads_action_type`. Even an unresolved row
 * records its state so the absence of a total is explicit, not accidental.
 *
 * The reconciliation verdict rides along here so a flagged row is reviewable
 * straight from the stored fact, with no schema change and no re-derivation.
 */
export function describeLeadProvenance(result: LeadExtractionResult): string {
  if (result.mode === 'unresolved') return 'unresolved:provisional_unverified'
  const parts = [
    `mode=${result.mode}`,
    `status=${result.status}`,
    `types=${result.actionTypesUsed.join('+')}`,
    `recon=${result.reconciliation.status}`,
  ]
  if (result.unresolvedReason !== null) {
    parts.push(`unresolved=${result.unresolvedReason}`)
  }
  return parts.join(';')
}
