/**
 * Lead-resolution repair planner (pure).
 *
 * Recomputes each stored insight row's resolved `leads` + `leads_action_type` from
 * that row's OWN stored `actions` array under the shipped production lead
 * definition (`generic_aggregate`), and returns the exact set of rows whose stored
 * values drifted from it. This is the safe remedy for STALE ROWS: rows an earlier
 * sync wrote under the `unresolved` (or any non-production) definition and that the
 * latest sync did not re-fetch and overwrite, so their resolved lead stayed null
 * even though the canonical `lead` roll-up sits in their stored actions.
 *
 * It is a READ of `actions` and a rewrite of the DERIVED lead columns ONLY — it
 * never touches raw actions, spend, or any other metric, and it uses the ONE
 * production extractor so the repaired value is byte-for-byte what a correct sync
 * would have written. Idempotent: re-running on already-correct rows plans nothing.
 *
 * PURE: no database, no IO. The `db:repair-leads` CLI supplies rows and applies
 * the plan inside a transaction.
 */
import { extractLeads, describeLeadProvenance } from '../meta/leadExtraction.ts'
import { DEFAULT_LEAD_DEFINITION } from '../config/leadActionConfig.ts'

/** The minimal stored fields the planner reads. */
export interface LeadRepairRow {
  id: string
  actions: unknown
  leads: bigint | null
  leadsActionType: string | null
}

/** One row's recomputed derived lead columns, ready to UPDATE. */
export interface LeadRepairUpdate {
  id: string
  leads: bigint | null
  leadsActionType: string
}

export interface LeadRepairPlan {
  totalRows: number
  /** Rows whose derived lead columns need rewriting. */
  updates: LeadRepairUpdate[]
  /** Rows going null -> a resolved value (the stale-`unresolved` rows). */
  nullFilledRows: number
  /** Rows whose non-null lead VALUE changed. */
  valueChangedRows: number
  /** Rows where only the provenance string changed (value already correct). */
  provenanceOnlyRows: number
  /** Net leads recovered: Σ(new − old) treating null as 0. Safe aggregate. */
  leadsRecovered: number
}

function needsUpdate(row: LeadRepairRow): LeadRepairUpdate | null {
  const result = extractLeads(row.actions, DEFAULT_LEAD_DEFINITION)
  const newLeads = result.value
  const newProvenance = describeLeadProvenance(result)

  const valueSame =
    row.leads === null ? newLeads === null : newLeads === row.leads
  const provenanceSame = row.leadsActionType === newProvenance
  if (valueSame && provenanceSame) return null

  return { id: row.id, leads: newLeads, leadsActionType: newProvenance }
}

/** Plan the repair over a set of stored rows. Pure and deterministic. */
export function planLeadRepair(rows: readonly LeadRepairRow[]): LeadRepairPlan {
  const updates: LeadRepairUpdate[] = []
  let nullFilledRows = 0
  let valueChangedRows = 0
  let provenanceOnlyRows = 0
  let leadsRecovered = 0

  for (const row of rows) {
    const update = needsUpdate(row)
    if (update === null) continue
    updates.push(update)

    const oldVal = row.leads
    const newVal = update.leads
    const valueChanged =
      oldVal === null ? newVal !== null : newVal === null || newVal !== oldVal
    if (!valueChanged) {
      provenanceOnlyRows += 1
    } else if (oldVal === null) {
      nullFilledRows += 1
    } else {
      valueChangedRows += 1
    }
    leadsRecovered += Number(newVal ?? 0n) - Number(oldVal ?? 0n)
  }

  return {
    totalRows: rows.length,
    updates,
    nullFilledRows,
    valueChangedRows,
    provenanceOnlyRows,
    leadsRecovered,
  }
}

/** Render the plan as aligned, secret-free terminal lines (no ids or values). */
export function formatLeadRepairPlan(
  plan: LeadRepairPlan,
  applied: boolean,
): string {
  return [
    `Lead-resolution repair plan  (${applied ? 'APPLIED' : 'DRY RUN — no writes'})`,
    `  rows scanned:                 ${plan.totalRows}`,
    `  rows needing repair:          ${plan.updates.length}`,
    `    null -> resolved value:     ${plan.nullFilledRows}`,
    `    value corrected:            ${plan.valueChangedRows}`,
    `    provenance-only rewrite:    ${plan.provenanceOnlyRows}`,
    `  net leads recovered:          ${plan.leadsRecovered}`,
    applied
      ? `  => derived lead columns rewritten from stored actions under the production definition.`
      : `  => re-run with --apply to write these ${plan.updates.length} rows.`,
  ].join('\n')
}
