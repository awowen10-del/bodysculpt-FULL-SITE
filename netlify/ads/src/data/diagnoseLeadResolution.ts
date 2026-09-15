/**
 * Lead-resolution reconciliation diagnostic (safe).
 *
 * Proves whether the STORED resolved `leads` column agrees with what the shipped
 * production lead definition (`generic_aggregate`) would derive FROM THE SAME
 * ROW'S stored `actions` array. A freshly-ingested row can never disagree — the
 * ingest path computes `leads` from exactly this `actions` value — so any gap is
 * STALE DATA: a row written by an earlier sync under a different lead definition
 * (or the `unresolved` default) that the latest sync did not re-fetch and
 * overwrite. Because aggregation makes an entire group `lead_definition_unresolved`
 * as soon as ONE row's `leads` is null (see `aggregateInsights`), a handful of
 * stale rows silently suppress CPL for every creative that touches them.
 *
 * The "canonical" total here is the value a correct sync WOULD store: the generic
 * `lead` roll-up (Meta's Ads Manager "Results"), recomputed via the one production
 * extractor so the diagnostic and the pipeline can never define a lead differently.
 *
 * SAFE: emits ONLY summed counts, row counts, a signed delta, and the closed set
 * of lead-definition MODE NAMES that stale rows were written under. No ids, names,
 * copy, urls, dates-per-row or raw values. Pure and transport-free.
 */
import type { DashboardDataset } from './datasetRepository.ts'
import { insightHasDelivery } from './creativeAssembly.ts'
import { extractLeads } from '../meta/leadExtraction.ts'
import { DEFAULT_LEAD_DEFINITION } from '../config/leadActionConfig.ts'
import type { DiagnoseRange } from './diagnoseCreatives.ts'

/**
 * Why a stored `leads` value disagrees with the recomputed canonical total —
 * category ONLY, never a row identity.
 */
export type LeadResolutionMismatchCategory =
  /** Stored null (unresolved), but the canonical generic total is present. */
  | 'stored_null_recomputed_present'
  /** Stored a value, but the canonical generic total is absent (now null). */
  | 'stored_present_recomputed_null'
  /** Both present but the numbers differ (written under a non-generic definition). */
  | 'value_differs'

export interface LeadResolutionDiagnostics {
  window: { start: string; end: string }
  /** Delivering rows compared in the window. */
  deliveringRows: number
  /**
   * Canonical generic `lead` total the production definition derives from the
   * stored actions — the figure a correct sync WOULD store, matching Ads Manager.
   */
  canonicalGenericTotal: number
  /** Rows carrying a canonical lead (recomputed value > 0). */
  canonicalRows: number
  /** The total actually stored in the resolved `leads` column. */
  resolvedTotal: number
  /** Rows whose resolved `leads` column is non-null. */
  resolvedRows: number
  /** `canonicalGenericTotal - resolvedTotal`; 0 means the window reconciles. */
  delta: number
  /** Rows where stored `leads` already equals the recomputed canonical value. */
  matchedRows: number
  /** Rows where they disagree (the stale rows to repair). */
  mismatchedRows: number
  /** Mismatch counts by category (safe, closed set). */
  mismatchByCategory: Record<LeadResolutionMismatchCategory, number>
  /**
   * Mismatched-row counts grouped by the lead-definition MODE they were stored
   * under (parsed from `leads_action_type`). Proves staleness: a mismatch under a
   * mode other than `generic_aggregate` is a row an old definition wrote.
   */
  mismatchByStoredMode: Record<string, number>
  /** True when nothing is stale: delta 0 and no mismatched rows. */
  reconciled: boolean
}

/**
 * Parse the stored `leads_action_type` provenance string down to its MODE name
 * only (safe closed-set label). Shapes, from `describeLeadProvenance`:
 *   'unresolved:provisional_unverified'  -> 'unresolved'
 *   'mode=generic_aggregate;status=...'  -> 'generic_aggregate'
 *   null / unrecognised                  -> 'unknown'
 */
export function parseStoredLeadMode(leadsActionType: string | null): string {
  if (leadsActionType === null || leadsActionType.trim() === '')
    return 'unknown'
  if (leadsActionType.startsWith('unresolved')) return 'unresolved'
  const modeMatch = /(?:^|;)mode=([a-z_]+)/.exec(leadsActionType)
  return modeMatch ? modeMatch[1] : 'unknown'
}

function emptyCategoryCounts(): Record<LeadResolutionMismatchCategory, number> {
  return {
    stored_null_recomputed_present: 0,
    stored_present_recomputed_null: 0,
    value_differs: 0,
  }
}

/**
 * Reconcile the stored resolved `leads` column against the production definition
 * recomputed from each row's stored `actions`, across delivering rows in the
 * window. Uses the ONE production extractor so "a lead" is defined identically to
 * the live pipeline.
 */
export function diagnoseLeadResolution(
  dataset: DashboardDataset,
  range: DiagnoseRange = {
    start: dataset.meta.startDate,
    end: dataset.meta.endDate,
  },
): LeadResolutionDiagnostics {
  const rows = dataset.insights.filter(
    (i) =>
      i.date >= range.start && i.date <= range.end && insightHasDelivery(i),
  )

  let canonicalGenericTotal = 0n
  let canonicalRows = 0
  let resolvedTotal = 0n
  let resolvedRows = 0
  let matchedRows = 0
  let mismatchedRows = 0
  const mismatchByCategory = emptyCategoryCounts()
  const mismatchByStoredMode: Record<string, number> = {}

  for (const row of rows) {
    // What a correct sync WOULD store for this row, from ITS OWN stored actions.
    const recomputed = extractLeads(row.actions, DEFAULT_LEAD_DEFINITION).value
    if (recomputed !== null && recomputed > 0n) {
      canonicalGenericTotal += recomputed
      canonicalRows += 1
    }

    const stored = row.leads
    if (stored !== null) {
      resolvedTotal += stored
      resolvedRows += 1
    }

    const isMatch =
      stored === null ? recomputed === null : recomputed === stored
    if (isMatch) {
      matchedRows += 1
      continue
    }

    mismatchedRows += 1
    if (stored === null) {
      mismatchByCategory.stored_null_recomputed_present += 1
    } else if (recomputed === null) {
      mismatchByCategory.stored_present_recomputed_null += 1
    } else {
      mismatchByCategory.value_differs += 1
    }
    const mode = parseStoredLeadMode(row.leadsActionType)
    mismatchByStoredMode[mode] = (mismatchByStoredMode[mode] ?? 0) + 1
  }

  const delta = Number(canonicalGenericTotal - resolvedTotal)
  return {
    window: { start: range.start, end: range.end },
    deliveringRows: rows.length,
    canonicalGenericTotal: Number(canonicalGenericTotal),
    canonicalRows,
    resolvedTotal: Number(resolvedTotal),
    resolvedRows,
    delta,
    matchedRows,
    mismatchedRows,
    mismatchByCategory,
    mismatchByStoredMode,
    reconciled: delta === 0 && mismatchedRows === 0,
  }
}

/** Render the reconciliation as aligned, secret-free terminal lines. */
export function formatLeadResolution(d: LeadResolutionDiagnostics): string {
  const windowLabel =
    d.window.start === '' ? '(no data)' : `${d.window.start} .. ${d.window.end}`
  const modes = Object.keys(d.mismatchByStoredMode).sort()
  const modeLines =
    modes.length === 0
      ? ['  mismatched rows by stored mode: (none)']
      : modes.map(
          (m) =>
            `    ${m.padEnd(20)}${String(d.mismatchByStoredMode[m]).padStart(5)}`,
        )
  return [
    `Lead resolution reconciliation (stored leads vs canonical)   window: ${windowLabel}`,
    `  delivering rows in window:    ${d.deliveringRows}`,
    `  --- totals ---`,
    `  canonical generic total:      ${d.canonicalGenericTotal}   (${d.canonicalRows} rows)`,
    `  resolved (stored) total:      ${d.resolvedTotal}   (${d.resolvedRows} rows non-null)`,
    `  delta (canonical - resolved): ${d.delta}`,
    `  --- reconciliation ---`,
    `  matched rows:                 ${d.matchedRows}`,
    `  MISMATCHED rows:              ${d.mismatchedRows}`,
    `    stored null / recomputed:   ${d.mismatchByCategory.stored_null_recomputed_present}`,
    `    stored value / recomp null: ${d.mismatchByCategory.stored_present_recomputed_null}`,
    `    value differs:              ${d.mismatchByCategory.value_differs}`,
    `  mismatched rows by stored mode:`,
    ...modeLines,
    `  window verdict:               ${d.reconciled ? 'RECONCILED (delta 0)' : 'STALE — repair required'}`,
  ].join('\n')
}
