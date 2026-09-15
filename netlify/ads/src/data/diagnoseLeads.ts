/**
 * Lead-provenance diagnostic (safe): proves whether Meta's lead "Results" reach our
 * database and, if so, WHICH `action_type` carries them — the fact needed to choose
 * the correct live lead-definition mode WITHOUT guessing.
 *
 * The live pipeline resolves leads under the `unresolved` default (see
 * `src/config/leadActionConfig.ts`), which stores `leads = null` even though the raw
 * `actions` array is fetched and stored. This reads the STORED `actions` back and
 * sums each recognised lead action_type across the window, alongside the resolved
 * `leads` column the pipeline actually wrote — so the gap is explicit.
 *
 * SAFE: emits ONLY summed counts, row counts, and Meta's closed-set action_type
 * NAMES (not ids/values/creatives). Pure and transport-free.
 */
import type { DashboardDataset } from './datasetRepository.ts'
import { insightHasDelivery } from './creativeAssembly.ts'
import {
  GENERIC_LEAD_ACTION_TYPE,
  NATIVE_LEAD_ACTION_TYPE,
  ONSITE_WEB_LEAD_ACTION_TYPE,
  WEBSITE_LEAD_ACTION_TYPE,
  isExcludedLeadActionType,
} from '../config/leadActionConfig.ts'
import type { DiagnoseRange } from './diagnoseCreatives.ts'

/** One action_type's tally across the window. */
interface ActionTally {
  /** Summed action value across delivering rows in the window. */
  total: number
  /** How many rows carried this action_type. */
  rows: number
}

export interface LeadActionDiagnostics {
  window: { start: string; end: string }
  rowsInWindow: number
  rowsWithActionsArray: number
  /** Meta's own `lead` roll-up. */
  generic: ActionTally
  /** Native Instant Form leads (`onsite_conversion.lead_grouped`). */
  native: ActionTally
  /** Website Pixel `Lead` events (`offsite_conversion.fb_pixel_lead`). */
  website: ActionTally
  /** Mixed WEBSITE_AND_LEAD_FORM on-site web leads (`onsite_web_lead`). */
  onsiteWeb: ActionTally
  /** Excluded custom conversion(s) (`offsite_conversion.custom.*`). */
  customExcluded: ActionTally
  /** What the LIVE pipeline actually stored in the resolved `leads` column. */
  rowsWithResolvedLeads: number
  resolvedLeadsTotal: number
  /** Any other action_type containing "lead" we don't yet recognise (names only). */
  otherLeadishTypes: string[]
  /**
   * Reconciliation diagnostic (native + website vs the canonical generic `lead`).
   * A mismatch NEVER changes the scoring figure — the generic roll-up stays
   * authoritative; the rows are only flagged for review.
   */
  reconciliation: LeadReconciliationSummary
}

export interface LeadReconciliationSummary {
  /** Rows where native + website equals the generic roll-up. */
  reconciledRows: number
  /** Rows where they disagree — FLAGGED FOR REVIEW, still scored on generic. */
  mismatchedRows: number
  /** Rows with nothing to compare (no generic roll-up, or no components). */
  notApplicableRows: number
  /** Rows where the canonical `lead` was absent but components were present. */
  genericAbsentWithComponentsRows: number
  /** Window totals, for eyeballing against Ads Manager. */
  genericTotal: number
  componentSumTotal: number
  /** `componentSumTotal - genericTotal`; 0 means the window reconciles. */
  delta: number
  /** True when the whole window reconciles and nothing was flagged. */
  windowReconciled: boolean
}

function emptyTally(): ActionTally {
  return { total: 0, rows: 0 }
}

/** Read a stored `actions` JSON value as [{action_type, value}] defensively. */
function actionEntries(
  actions: unknown,
): Array<{ type: string; value: number }> {
  if (!Array.isArray(actions)) return []
  const out: Array<{ type: string; value: number }> = []
  for (const a of actions) {
    if (
      a !== null &&
      typeof a === 'object' &&
      typeof (a as { action_type?: unknown }).action_type === 'string'
    ) {
      const n = Number((a as { value?: unknown }).value)
      out.push({
        type: (a as { action_type: string }).action_type,
        value: Number.isFinite(n) ? n : 0,
      })
    }
  }
  return out
}

/**
 * Tally lead action_types from the STORED actions across delivering rows in the
 * window, next to the resolved `leads` column the live pipeline wrote.
 */
export function diagnoseLeadActions(
  dataset: DashboardDataset,
  range: DiagnoseRange = {
    start: dataset.meta.startDate,
    end: dataset.meta.endDate,
  },
): LeadActionDiagnostics {
  const rows = dataset.insights.filter(
    (i) =>
      i.date >= range.start && i.date <= range.end && insightHasDelivery(i),
  )

  const generic = emptyTally()
  const native = emptyTally()
  const website = emptyTally()
  const onsiteWeb = emptyTally()
  const customExcluded = emptyTally()
  const otherLeadish = new Set<string>()

  let rowsWithActionsArray = 0
  let rowsWithResolvedLeads = 0
  let resolvedLeadsTotal = 0
  let reconciledRows = 0
  let mismatchedRows = 0
  let notApplicableRows = 0
  let genericAbsentWithComponentsRows = 0

  for (const row of rows) {
    const entries = actionEntries(row.actions)
    if (entries.length > 0) rowsWithActionsArray += 1

    if (row.leads !== null) {
      rowsWithResolvedLeads += 1
      resolvedLeadsTotal += Number(row.leads)
    }

    const seen = {
      generic: false,
      native: false,
      website: false,
      onsiteWeb: false,
      custom: false,
    }
    // Per-row totals for the reconciliation verdict (never used for scoring).
    let rowGeneric = 0
    let rowComponents = 0
    for (const { type, value } of entries) {
      if (type === GENERIC_LEAD_ACTION_TYPE) {
        generic.total += value
        rowGeneric += value
        seen.generic = true
      } else if (type === NATIVE_LEAD_ACTION_TYPE) {
        native.total += value
        rowComponents += value
        seen.native = true
      } else if (type === WEBSITE_LEAD_ACTION_TYPE) {
        website.total += value
        rowComponents += value
        seen.website = true
      } else if (type === ONSITE_WEB_LEAD_ACTION_TYPE) {
        // Reported separately; deliberately NOT part of the native+website sum.
        onsiteWeb.total += value
        seen.onsiteWeb = true
      } else if (isExcludedLeadActionType(type)) {
        customExcluded.total += value
        seen.custom = true
      } else if (type.includes('lead')) {
        otherLeadish.add(type)
      }
    }
    if (seen.generic) generic.rows += 1
    if (seen.native) native.rows += 1
    if (seen.website) website.rows += 1
    if (seen.onsiteWeb) onsiteWeb.rows += 1
    if (seen.custom) customExcluded.rows += 1

    const hasComponents = seen.native || seen.website
    if (!seen.generic || !hasComponents) {
      notApplicableRows += 1
      if (!seen.generic && (hasComponents || seen.onsiteWeb)) {
        genericAbsentWithComponentsRows += 1
      }
    } else if (rowComponents === rowGeneric) {
      reconciledRows += 1
    } else {
      mismatchedRows += 1
    }
  }

  const componentSumTotal = native.total + website.total
  return {
    window: { start: range.start, end: range.end },
    rowsInWindow: rows.length,
    rowsWithActionsArray,
    generic,
    native,
    website,
    onsiteWeb,
    customExcluded,
    rowsWithResolvedLeads,
    resolvedLeadsTotal,
    otherLeadishTypes: [...otherLeadish].sort(),
    reconciliation: {
      reconciledRows,
      mismatchedRows,
      notApplicableRows,
      genericAbsentWithComponentsRows,
      genericTotal: generic.total,
      componentSumTotal,
      delta: componentSumTotal - generic.total,
      windowReconciled:
        mismatchedRows === 0 &&
        genericAbsentWithComponentsRows === 0 &&
        componentSumTotal === generic.total,
    },
  }
}

/** Render the lead-action diagnostics as aligned, secret-free terminal lines. */
export function formatLeadActions(d: LeadActionDiagnostics): string {
  const windowLabel =
    d.window.start === '' ? '(no data)' : `${d.window.start} .. ${d.window.end}`
  const line = (label: string, t: ActionTally): string =>
    `  ${label.padEnd(30)}${String(t.total).padStart(6)}   (${t.rows} rows)`
  return [
    `Lead provenance (stored actions vs resolved column)   window: ${windowLabel}`,
    `  delivering rows in window:    ${d.rowsInWindow}`,
    `  rows with an actions array:   ${d.rowsWithActionsArray}`,
    `  --- lead totals BY action_type (from the raw stored actions) ---`,
    line('generic  lead (CANONICAL):', d.generic),
    line('native   lead_grouped:', d.native),
    line('website  fb_pixel_lead:', d.website),
    line('onsite   onsite_web_lead:', d.onsiteWeb),
    line('custom   (excluded):', d.customExcluded),
    `  other lead-ish types seen:    ${d.otherLeadishTypes.length === 0 ? '(none)' : d.otherLeadishTypes.join(', ')}`,
    `  --- reconciliation (native + website vs canonical generic lead) ---`,
    `  reconciled rows:              ${d.reconciliation.reconciledRows}`,
    `  MISMATCHED rows (review):     ${d.reconciliation.mismatchedRows}`,
    `  not applicable:               ${d.reconciliation.notApplicableRows}`,
    `  generic absent w/ components: ${d.reconciliation.genericAbsentWithComponentsRows}`,
    `  generic / component sum:      ${d.reconciliation.genericTotal} / ${d.reconciliation.componentSumTotal}  (delta ${d.reconciliation.delta})`,
    `  window verdict:               ${d.reconciliation.windowReconciled ? 'RECONCILED' : 'FLAGGED FOR REVIEW'}`,
    `  --- what the pipeline stored (production = canonical generic lead) ---`,
    `  rows with a resolved lead:    ${d.rowsWithResolvedLeads}`,
    `  resolved leads total:         ${d.resolvedLeadsTotal}`,
    `  => the resolved total should equal the canonical generic total above, and`,
    `     that is the figure Ads Manager reports as "Results". Components are shown`,
    `     for diagnosis only and are never added together or subtracted.`,
  ].join('\n')
}
