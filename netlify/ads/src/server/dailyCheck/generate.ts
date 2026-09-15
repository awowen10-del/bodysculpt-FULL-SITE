/**
 * Generate one Daily Ad Check (SERVER-ONLY orchestration).
 *
 * Wires the shared, deterministic pieces together: read the current ranked
 * creatives from the SAME repository the dashboard uses, diff them against the
 * previously saved checks (the "since your last check" basis), let the AI narrate
 * the result, and persist it. The deterministic engine stays the source of truth;
 * the AI is a pure narrator with a guaranteed fallback.
 */
import type { DashboardRepository } from '../../data/index.ts'
import { ACTIVE_DECISION_SETTINGS } from '../../metrics/index.ts'
import {
  buildChangeSet,
  type DailyCheckRecordDTO,
} from '../../dailyCheck/index.ts'
import type { Completor } from './anthropic.ts'
import { narrateBriefing } from './narrate.ts'
import {
  insertCheck,
  readRecentChecks,
  toPriorChecks,
  type DailyCheckDb,
} from './store.ts'

/** How many prior checks to load — enough to detect a multi-check winner streak. */
const HISTORY_DEPTH = 6

export interface GenerateDeps {
  repository: DashboardRepository
  db: DailyCheckDb
  /** The AI completor, or null to force the deterministic fallback. */
  completor: Completor | null
  /** Optional sink for a redacted reason when the AI is not used. */
  onFallback?: (reason: string) => void
}

/**
 * Run the full pipeline and return the stored record. Any AI failure is absorbed
 * into a deterministic fallback (never thrown), so this rejects only on a genuine
 * data-access failure (repository or database).
 */
export async function generateDailyCheck(
  deps: GenerateDeps,
): Promise<DailyCheckRecordDTO> {
  const { repository, db, completor, onFallback } = deps

  // STRICTLY SEQUENTIAL: these share one pooled (max:1, transaction-mode)
  // connection, where concurrent queries stall — the same constraint materialize
  // enforces. One at a time keeps the single connection healthy.
  const state = await repository.getDataState()
  const campaigns = await repository.listCampaigns()
  const rows = await repository.listCreatives({ sort: 'rank' })
  const recent = await readRecentChecks(db, HISTORY_DEPTH)

  // Verdicts now run per-campaign (launch → newest day), so there is no single
  // window; the ChangeSet carries the synced data range as an honest label.
  const window = { start: state.range.start, end: state.range.end }
  const settingsVersion = ACTIVE_DECISION_SETTINGS.version

  // Scope the briefing to LIVE campaigns (ACTIVE and not schedule-ended — the
  // same test the dashboard's Active badge uses). Completed campaigns get a
  // one-time farewell; paused/archived ones drop out silently. Individual PAUSED
  // ads are stripped inside `buildChangeSet` itself, so they never reach the AI.
  const changeSet = buildChangeSet(
    rows,
    window,
    state.currency,
    settingsVersion,
    toPriorChecks(recent),
    { campaigns, now: new Date() },
  )

  const narration = await narrateBriefing(changeSet, completor, onFallback)

  return insertCheck(db, {
    changeSet,
    briefing: narration.briefing,
    source: narration.source,
    model: narration.model,
    settingsVersion,
  })
}
