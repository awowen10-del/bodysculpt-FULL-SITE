/**
 * Presence / reconciliation state transitions for Meta dimension entities.
 *
 * Pure functions only — NO database, NO network. The sync engine (a later stage)
 * will call these; Stage 2 tests them directly.
 *
 * HARD RULE: `deletedAt` is NEVER set by absence alone. Repeated absence yields a
 * `suspected_missing` / `reconciliation_required` state for human or automated
 * review — never a confirmed deletion in Stage 2.
 */

export type SyncScope = 'full' | 'incremental' | 'filtered'
export type SyncStatus = 'running' | 'success' | 'partial' | 'failed'

export interface PresenceFields {
  lastSeenAt: Date | null
  missingSince: Date | null
  consecutiveFullScopeMisses: number
  deletedAt: Date | null
}

export interface ReconciliationInput {
  /** Did this sync response include the entity? */
  seen: boolean
  run: { scope: SyncScope; status: SyncStatus; at: Date }
  /** True ONLY when Meta explicitly signals the entity is deleted/archived. */
  metaDeletedSignal?: boolean
}

export type PresenceState =
  'present' | 'suspected_missing' | 'reconciliation_required' | 'deleted'

/** Only a successful, full-scope reconciliation may record a miss. */
export function isQualifyingReconciliation(run: {
  scope: SyncScope
  status: SyncStatus
}): boolean {
  return run.scope === 'full' && run.status === 'success'
}

/**
 * Compute the next presence fields. Rules:
 * 1. Seen        → set lastSeenAt, clear missingSince, reset misses to 0.
 * 2. Not seen + qualifying (full+success) run → set missingSince if first miss,
 *    increment consecutiveFullScopeMisses.
 * 3. Not seen + any non-qualifying run → presence fields untouched.
 * 4. deletedAt is set ONLY by an explicit Meta deleted/archived signal (or, in a
 *    future reviewed rule, real account evidence) — never by absence.
 */
export function applyReconciliation(
  current: PresenceFields,
  input: ReconciliationInput,
): PresenceFields {
  const { seen, run, metaDeletedSignal } = input

  // Explicit deletion signal is the only thing (in Stage 2) that may set
  // deletedAt; it can arrive whether or not the entity is in the response.
  const deletedAt = metaDeletedSignal
    ? (current.deletedAt ?? run.at)
    : current.deletedAt

  if (seen) {
    return {
      lastSeenAt: run.at,
      missingSince: null,
      consecutiveFullScopeMisses: 0,
      deletedAt,
    }
  }

  // Not seen: only a qualifying run may record a miss.
  if (!isQualifyingReconciliation(run)) {
    return { ...current, deletedAt }
  }

  return {
    lastSeenAt: current.lastSeenAt,
    missingSince: current.missingSince ?? run.at,
    consecutiveFullScopeMisses: current.consecutiveFullScopeMisses + 1,
    deletedAt,
  }
}

/**
 * Derived, DISPLAY-ONLY state (never persisted). Crossing
 * `reconciliationRequiredThreshold` flags the entity for review — it still does
 * NOT imply deletion.
 */
export function derivePresenceState(
  fields: PresenceFields,
  reconciliationRequiredThreshold = 3,
): PresenceState {
  if (fields.deletedAt) return 'deleted'
  if (fields.consecutiveFullScopeMisses >= reconciliationRequiredThreshold) {
    return 'reconciliation_required'
  }
  if (fields.missingSince) return 'suspected_missing'
  return 'present'
}
