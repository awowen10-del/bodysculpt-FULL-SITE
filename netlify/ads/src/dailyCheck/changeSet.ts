/**
 * The deterministic Daily Ad Check comparison (browser-safe, pure).
 *
 * `buildChangeSet` reduces the current ranked-creative rows plus prior stored
 * snapshots into a `ChangeSet` — the single source of truth the AI narrates. It
 * performs NO metric arithmetic of its own: every number comes pre-computed from
 * the metrics layer (via `CreativeRowDTO`). The only arithmetic here is comparing
 * two already-computed values to describe a move (a display delta), which is a
 * presentation concern, never a re-derivation of a metric.
 *
 * It depends only on the data-layer DTOs + metrics types, so it runs identically
 * on the seed repository (tests) and the live server repository.
 */
import type { CampaignDTO, CreativeRowDTO } from '../data/index.ts'
import { adIsPaused, campaignHasEnded, campaignIsLive } from '../data/index.ts'
import type { CommercialDecision } from '../metrics/index.ts'
import type {
  CampaignFarewell,
  ChangeSet,
  CplMove,
  CreativeIdentity,
  CreativeSnapshot,
  DecisionChange,
  DecisionStreak,
  DecisionTotals,
  SnapshotMetric,
} from './types.ts'

/** A prior stored check reduced to what the diff needs. Newest first. */
export interface PriorCheck {
  generatedAt: string
  snapshots: CreativeSnapshot[]
}

/**
 * The live-campaign scope for a check. When provided, the briefing covers ONLY
 * campaigns that pass `campaignIsLive` (ACTIVE and not schedule-ended — the same
 * test the dashboard's Active badge uses), and any campaign that just completed
 * gets its one-time farewell. `now` is injected (never read from the clock here)
 * so the builder stays pure and deterministic.
 */
export interface CampaignScope {
  campaigns: readonly CampaignDTO[]
  now: Date
}

/** Commercial rank so "improved" vs "deteriorated" is unambiguous and total. */
const DECISION_RANK: Record<CommercialDecision, number> = {
  winner: 2,
  needs_more_time: 1,
  turn_off: 0,
}

/** A CPL move counts as "material" at ≥ £2 absolute OR ≥ 15% relative. */
const MATERIAL_ABS = 2
const MATERIAL_REL = 0.15
/** Only surface a streak once a recommendation has held for this many checks. */
const MIN_STREAK = 2

function metricOf(m: {
  value: string | null
  display: string
  available: boolean
}): SnapshotMetric {
  const value =
    m.available && m.value !== null && m.value !== '' ? Number(m.value) : null
  return {
    display: m.display === '' ? '—' : m.display,
    value: value !== null && Number.isFinite(value) ? value : null,
  }
}

function identityOf(row: CreativeRowDTO): CreativeIdentity {
  return {
    rowId: row.rowId,
    creativeId: row.creative.id,
    campaignName: row.context.campaignName,
    adSetName: row.context.adSetName,
    adName: row.context.adName,
    headline: row.creative.headline,
  }
}

/** The identity subset of a snapshot (for building change entries). */
function pickIdentity(s: CreativeSnapshot): CreativeIdentity {
  return {
    rowId: s.rowId,
    creativeId: s.creativeId,
    campaignName: s.campaignName,
    adSetName: s.adSetName,
    adName: s.adName,
    headline: s.headline,
  }
}

/** Reduce one ranked row to its stored snapshot. Reads only pre-computed values. */
export function snapshotOf(row: CreativeRowDTO): CreativeSnapshot {
  const evaluation = row.evaluation
  const decision =
    evaluation.eligibility === 'eligible' ? evaluation.decision : null
  return {
    ...identityOf(row),
    evaluated: decision !== null,
    decision: decision ? decision.decision : null,
    decisionLabel: decision ? decision.decisionLabel : null,
    reason: decision ? decision.reason : null,
    // The decision carries its own metric copies (they survive list slimming); fall
    // back to the row's metric set for a not-evaluated creative.
    spend: metricOf(decision ? decision.spend : row.metrics.spend),
    leads: metricOf(decision ? decision.leads : row.metrics.leads),
    cpl: metricOf(decision ? decision.cpl : row.metrics.cpl),
    linkCtr: metricOf(decision ? decision.linkCtr : row.metrics.linkCtr),
    latestDeliveryDate: row.latestDeliveryDate,
  }
}

/** The leading currency/symbol run of a display string, e.g. "£23.50" → "£". */
function symbolPrefix(display: string): string {
  const m = display.match(/^[^\d.-]*/)
  return m ? m[0] : ''
}

function totalsOf(snapshots: CreativeSnapshot[]): DecisionTotals {
  const totals: DecisionTotals = {
    winner: 0,
    needsMoreTime: 0,
    turnOff: 0,
    notEvaluated: 0,
  }
  for (const s of snapshots) {
    if (s.decision === 'winner') totals.winner += 1
    else if (s.decision === 'needs_more_time') totals.needsMoreTime += 1
    else if (s.decision === 'turn_off') totals.turnOff += 1
    else totals.notEvaluated += 1
  }
  return totals
}

/** True when a creative delivered (non-zero spend) over the window. */
function isDelivering(s: CreativeSnapshot): boolean {
  return s.spend.value !== null && s.spend.value > 0
}

function decisionChangeOf(
  now: CreativeSnapshot,
  before: CreativeSnapshot,
): DecisionChange | null {
  if (now.decision === null || before.decision === null) return null
  if (now.decision === before.decision) return null
  const direction =
    DECISION_RANK[now.decision] > DECISION_RANK[before.decision]
      ? 'improved'
      : 'deteriorated'
  return {
    ...pickIdentity(now),
    from: before.decision,
    to: now.decision,
    direction,
    cplNow: now.cpl.display,
    cplBefore: before.cpl.display,
  }
}

function cplMoveOf(
  now: CreativeSnapshot,
  before: CreativeSnapshot,
): CplMove | null {
  if (now.cpl.value === null || before.cpl.value === null) return null
  const delta = now.cpl.value - before.cpl.value
  const abs = Math.abs(delta)
  const material =
    abs >= MATERIAL_ABS ||
    (before.cpl.value > 0 && abs / before.cpl.value >= MATERIAL_REL)
  if (!material) return null
  const prefix = symbolPrefix(now.cpl.display)
  const sign = delta > 0 ? '+' : '-'
  return {
    ...pickIdentity(now),
    before: before.cpl.display,
    now: now.cpl.display,
    direction: delta > 0 ? 'up' : 'down',
    deltaDisplay: `${sign}${prefix}${abs.toFixed(2)}`,
  }
}

/**
 * Consecutive checks (including the current one) this creative has held `decision`,
 * walking `history` newest-first and stopping at the first check where it differs
 * or is absent. Deterministic, from stored snapshots only.
 */
function streakLength(
  rowId: string,
  decision: CommercialDecision,
  history: PriorCheck[],
): number {
  let checks = 1
  for (const prior of history) {
    // Pre-split checks have no `rowId`, so they never match — the streak stops
    // cleanly at the format boundary instead of counting across it.
    const prev = prior.snapshots.find((s) => s.rowId === rowId)
    if (!prev || prev.decision !== decision) break
    checks += 1
  }
  return checks
}

/**
 * Build the deterministic day-over-day ChangeSet.
 *
 * Paused ads (`adIsPaused`) are excluded unconditionally, on both the current and
 * the prior side, so they appear in NO section of the briefing.
 *
 * @param rows   the current ranked creative rows (from `repo.listCreatives`)
 * @param window the trailing analysis window the rows were judged over
 * @param currency account currency (for display context), or null
 * @param settingsVersion the active decision-settings version
 * @param history prior stored checks, NEWEST FIRST (empty on the first ever check)
 * @param scope  live-campaign scope (see `CampaignScope`). When omitted, every
 *               row is in scope and no farewell is derived (legacy behaviour,
 *               kept for callers without campaign data).
 */
export function buildChangeSet(
  rows: CreativeRowDTO[],
  window: { start: string; end: string },
  currency: string | null,
  settingsVersion: string,
  history: PriorCheck[],
  scope?: CampaignScope,
): ChangeSet {
  // PAUSED ADS ARE NOT IN THE CHECK AT ALL. The owner already switched them off,
  // so a briefing that writes them up — worst of all under "do today: turn off X"
  // — is noise about a decision already taken. They are stripped HERE, at the data
  // level, before any section is derived, so no prompt wording (and no AI slip)
  // can bring them back: if it isn't in the ChangeSet, it cannot be narrated.
  // Applies whether or not a campaign scope was supplied.
  const pausedRowIds = new Set(
    rows.filter((r) => adIsPaused(r.context)).map((r) => r.rowId),
  )

  // Scope the check to LIVE campaigns only. A row that cannot be tied to a live
  // campaign (null campaignId, or a campaign absent from the list) is excluded
  // fail-closed — a row we can't prove live must never drive an action. Paused /
  // archived campaigns drop out silently (the owner paused them deliberately);
  // only a COMPLETED campaign (schedule ended while ACTIVE) earns a farewell.
  let scopedRows = rows.filter((r) => !pausedRowIds.has(r.rowId))
  let completedCampaigns: readonly CampaignDTO[] = []
  let liveCampaignNames: Set<string> | null = null // null = unscoped (legacy)
  if (scope !== undefined) {
    const live = scope.campaigns.filter((c) => campaignIsLive(c, scope.now))
    const liveIds = new Set(live.map((c) => c.id))
    scopedRows = scopedRows.filter(
      (r) => r.context.campaignId !== null && liveIds.has(r.context.campaignId),
    )
    completedCampaigns = scope.campaigns.filter((c) =>
      campaignHasEnded(c, scope.now),
    )
    liveCampaignNames = new Set(
      live.map((c) => c.name).filter((n): n is string => n !== null),
    )
  }

  const snapshots = scopedRows.map(snapshotOf)
  const previous = history[0] ?? null
  const isFirstCheck = previous === null

  // A pre-split check (snapshots without a `rowId`) can't be diffed against the new
  // composite rows. Rather than emit a wall of spurious "started/stopped
  // delivering", we BASELINE: treat the first post-change check as a fresh start —
  // no deltas, streaks reset — which reads as a normal quiet morning.
  const previousComparable =
    previous !== null &&
    previous.snapshots.every((s) => typeof s.rowId === 'string')
  // Paused ads are stripped from the PRIOR side as well. Without this, an ad the
  // owner paused since yesterday would leave the current rows and immediately
  // resurface as "stopped delivering" (or inside a completed campaign's
  // farewell) — the exact mention the exclusion exists to prevent.
  const prevSnapshots = (previousComparable ? previous.snapshots : []).filter(
    (s) => !pausedRowIds.has(s.rowId),
  )

  const prevById = new Map(prevSnapshots.map((s) => [s.rowId, s]))
  const currIds = new Set(snapshots.map((s) => s.rowId))

  const decisionChanges: DecisionChange[] = []
  const cplMoves: CplMove[] = []
  const winnerStreaks: DecisionStreak[] = []

  for (const now of snapshots) {
    const before = prevById.get(now.rowId)
    if (before) {
      const dc = decisionChangeOf(now, before)
      if (dc) decisionChanges.push(dc)
      const move = cplMoveOf(now, before)
      if (move) cplMoves.push(move)
    }
    if (now.decision === 'winner') {
      const checks = streakLength(now.rowId, 'winner', history)
      if (checks >= MIN_STREAK) {
        winnerStreaks.push({
          ...pickIdentity(now),
          decision: 'winner',
          checks,
          cpl: now.cpl.display,
        })
      }
    }
  }

  // Delivery deltas only make sense against a comparable baseline — on the first
  // check (or the first post-split check) there is nothing "new" or "stopped".
  const newlyDelivering: CreativeIdentity[] = !previousComparable
    ? []
    : snapshots
        .filter((s) => isDelivering(s) && !prevById.has(s.rowId))
        .map(pickIdentity)

  // "Stopped delivering" is only news for a campaign that is still live: rows
  // that left the check because their campaign completed, was paused, or was
  // archived are scope changes, not delivery changes — reporting them would
  // produce a wall of spurious "stopped delivering" the day the scope shifts.
  // Stored snapshots carry no campaignId, so prior rows are tied to their
  // campaign by name (both sides come from the same sync, so names agree).
  const stoppedDelivering: CreativeIdentity[] = prevSnapshots
    .filter((s) => isDelivering(s) && !currIds.has(s.rowId))
    .filter(
      (s) =>
        liveCampaignNames === null ||
        (s.campaignName !== null && liveCampaignNames.has(s.campaignName)),
    )
    .map(pickIdentity)

  // The one-time farewell: a campaign that is Completed NOW whose rows were
  // still present in the previous check. From this check onward its rows are
  // excluded from the stored snapshots, so the condition can never hold again —
  // the snapshots themselves are the "already said goodbye" marker.
  const campaignsCompleted: CampaignFarewell[] = []
  for (const c of completedCampaigns) {
    if (c.name === null) continue // unmatchable against stored snapshots
    const finalRows = prevSnapshots.filter((s) => s.campaignName === c.name)
    if (finalRows.length === 0) continue
    campaignsCompleted.push({
      campaignId: c.id,
      campaignName: c.name,
      totals: totalsOf(finalRows),
      winners: finalRows
        .filter((s) => s.decision === 'winner')
        .map((s) => ({ ...pickIdentity(s), cpl: s.cpl.display })),
      turnOffs: finalRows
        .filter((s) => s.decision === 'turn_off')
        .map((s) => ({ ...pickIdentity(s), cpl: s.cpl.display })),
    })
  }

  return {
    window,
    currency,
    isFirstCheck,
    previousCheckAt: previousComparable ? previous.generatedAt : null,
    totals: totalsOf(snapshots),
    decisionChanges,
    cplMoves,
    newlyDelivering,
    stoppedDelivering,
    campaignsCompleted,
    winnerStreaks,
    snapshots,
    settingsVersion,
  }
}
