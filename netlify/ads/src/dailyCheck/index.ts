/**
 * `dailyCheck/` — the browser-safe deterministic core of the Daily Ad Check feature.
 *
 * Types, the day-over-day ChangeSet builder, and the plain-English fallback renderer.
 * Everything here imports only the data-layer DTOs, the metrics types, and zod — no
 * database, no server, no Anthropic SDK — so it is safe for the UI to import types
 * from, and is unit-testable against the seed repository. The AI narrator, storage,
 * and orchestration are SERVER-ONLY and live under `src/server/dailyCheck/`.
 */
export type {
  SnapshotMetric,
  CreativeIdentity,
  CreativeSnapshot,
  DecisionChange,
  CplMove,
  DecisionStreak,
  DecisionTotals,
  FarewellAd,
  CampaignFarewell,
  ChangeSet,
  Briefing,
  BriefingSource,
  DailyCheckRecordDTO,
} from './types.ts'

export {
  buildChangeSet,
  snapshotOf,
  type PriorCheck,
  type CampaignScope,
} from './changeSet.ts'
export { briefingSchema, fallbackBriefing, creativeLabel } from './briefing.ts'
