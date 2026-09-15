/**
 * Daily Ad Check — shared, JSON-safe types (browser-safe).
 *
 * These types cross the API boundary and are imported by both the deterministic
 * core (`changeSet.ts`, `fallback.ts`), the server narrator, and the UI card. Like
 * `data/dto.ts`, everything here must survive `JSON.stringify` → `JSON.parse`: no
 * `bigint`, no `Date`. Money/counts are carried as display strings plus an optional
 * bare numeric string for deterministic diffing.
 *
 * The design principle: the deterministic layer computes EVERYTHING factual (the
 * `ChangeSet`); the AI only turns that into the plain-English `Briefing`. Nothing
 * here lets the AI introduce a number that the ChangeSet didn't already contain.
 */
import type { CommercialDecision, DecisionReason } from '../metrics/index.ts'

/** One metric captured for diffing: the human display plus a bare numeric value. */
export interface SnapshotMetric {
  /** Human display, e.g. "£23.50" or "12" or "—" when unavailable. */
  display: string
  /** Bare numeric value for deterministic comparison, or null when unavailable. */
  value: number | null
}

/** Identity fields shared by every creative-scoped change entry. */
export interface CreativeIdentity {
  /**
   * Stable composite id (creative × ad set) — the key the diff and streaks match
   * on. The SAME creative in two ad sets has two distinct `rowId`s. Its presence
   * also distinguishes a new-format snapshot from a pre-split stored one.
   */
  rowId: string
  creativeId: string
  campaignName: string | null
  /** The ad set (audience) this row ran in — used to label otherwise same-named ads. */
  adSetName: string | null
  adName: string | null
  headline: string | null
}

/**
 * A single creative's decision + key metrics at one point in time. The full list
 * of these IS the audit snapshot stored on a check, and the basis the NEXT check
 * diffs against ("since your last check") and reads streaks from.
 */
export interface CreativeSnapshot extends CreativeIdentity {
  /** True when the lead commercial engine actually judged this creative. */
  evaluated: boolean
  /** The commercial recommendation, or null when not evaluated (out of scope). */
  decision: CommercialDecision | null
  /** Human label, e.g. "KEEP ON — WINNER", or null when not evaluated. */
  decisionLabel: string | null
  /** Why the decision was reached, or null when not evaluated. */
  reason: DecisionReason | null
  spend: SnapshotMetric
  leads: SnapshotMetric
  cpl: SnapshotMetric
  linkCtr: SnapshotMetric
  /** Newest day this creative delivered across all data, or null. */
  latestDeliveryDate: string | null
}

/** A creative whose commercial recommendation crossed a boundary since last check. */
export interface DecisionChange extends CreativeIdentity {
  from: CommercialDecision | null
  to: CommercialDecision | null
  /** Whether the move is better (`improved`) or worse (`deteriorated`) commercially. */
  direction: 'improved' | 'deteriorated'
  cplNow: string
  cplBefore: string | null
}

/** A material cost-per-lead move for a creative that stayed evaluated across checks. */
export interface CplMove extends CreativeIdentity {
  before: string
  now: string
  /** `up` = CPL rose (worse); `down` = CPL fell (better). */
  direction: 'up' | 'down'
  /** Signed display delta, e.g. "+£4.20" / "-£3.10". */
  deltaDisplay: string
}

/** A creative that has held the same commercial recommendation for N checks running. */
export interface DecisionStreak extends CreativeIdentity {
  decision: CommercialDecision
  /** Consecutive checks (including the current one) at this recommendation. */
  checks: number
  cpl: string
}

/** How many creatives fall into each commercial recommendation this check. */
export interface DecisionTotals {
  winner: number
  needsMoreTime: number
  turnOff: number
  notEvaluated: number
}

/** One ad's final recorded position inside a completed campaign's farewell. */
export interface FarewellAd extends CreativeIdentity {
  /** The last recorded cost-per-lead display, lifted from the stored snapshot. */
  cpl: string
}

/**
 * The one-time send-off for a campaign that finished its scheduled run. Emitted
 * on exactly one check: the first where the campaign is Completed (schedule
 * ended while Meta still reports it ACTIVE) but the PREVIOUS check still
 * contained its rows. Because completed campaigns are excluded from stored
 * snapshots from that check onward, the trigger can never fire twice — the
 * stored snapshots themselves are the "already said goodbye" marker; there is
 * no extra state. Every figure is lifted verbatim from the last stored
 * snapshots (no re-computation).
 */
export interface CampaignFarewell {
  campaignId: string
  campaignName: string | null
  /** Final recorded mix, from the last check that contained this campaign. */
  totals: DecisionTotals
  /** Final winners, with their last recorded cost per lead. */
  winners: FarewellAd[]
  /** Ads that ended on a turn-off verdict (context only — nothing to act on). */
  turnOffs: FarewellAd[]
}

/**
 * The deterministic day-over-day comparison — the single source of truth the AI
 * narrates. Computed purely from the current creative rows plus prior stored
 * snapshots; contains no arithmetic the metrics layer didn't already do.
 */
export interface ChangeSet {
  /** The trailing analysis window the recommendations were judged over. */
  window: { start: string; end: string }
  currency: string | null
  /** True on the very first check (no prior snapshot to diff against). */
  isFirstCheck: boolean
  /** ISO timestamp of the previous check this diff is measured against, or null. */
  previousCheckAt: string | null
  totals: DecisionTotals
  /** Creatives whose recommendation crossed a boundary since last check. */
  decisionChanges: DecisionChange[]
  /** Material CPL moves among creatives that stayed evaluated. */
  cplMoves: CplMove[]
  /** Creatives delivering now that weren't in the previous check. */
  newlyDelivering: CreativeIdentity[]
  /** Creatives in the previous check that aren't delivering now. */
  stoppedDelivering: CreativeIdentity[]
  /**
   * Campaigns that finished their scheduled run since the previous check — the
   * one-time farewell (see `CampaignFarewell`). Empty when nothing completed.
   */
  campaignsCompleted: CampaignFarewell[]
  /** Winners on a multi-check streak (2+). */
  winnerStreaks: DecisionStreak[]
  /** The full current snapshot — stored so the next check can diff against it. */
  snapshots: CreativeSnapshot[]
  /** The decision-settings version the recommendations were judged under. */
  settingsVersion: string
}

/**
 * The plain-English briefing. Either Claude writes it (interpreting the ChangeSet)
 * or the deterministic fallback renders it from the ChangeSet directly. The shape
 * is identical so the UI never knows or cares which produced it.
 */
export interface Briefing {
  /** One-line summary of the day, e.g. "A quiet day — nothing needs changing." */
  headline: string
  /** What actually changed since the last check (empty on a quiet day). */
  whatChanged: string[]
  /** What to keep an eye on but not act on yet. */
  watch: string[]
  /** What is working and should simply be left running. */
  leaveAlone: string[]
  /** The concrete things to actually do today (may be empty). */
  doToday: string[]
}

/** How a briefing was produced — for provenance + an honest UI note on fallback. */
export type BriefingSource = 'ai' | 'fallback'

/** A saved Daily Ad Check as returned to the dashboard card. */
export interface DailyCheckRecordDTO {
  id: string
  /** ISO timestamp the check was generated. */
  generatedAt: string
  window: { start: string | null; end: string | null }
  briefing: Briefing
  /** The deterministic ChangeSet the briefing was built from (audit + detail). */
  changeSet: ChangeSet
  source: BriefingSource
  /** The Claude model that wrote it, or null for a pure fallback. */
  model: string | null
  settingsVersion: string | null
}
