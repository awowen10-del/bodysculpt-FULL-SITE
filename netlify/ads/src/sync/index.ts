// Stage 7 sync orchestrator — public surface.
export {
  dryRunSync,
  liveWriteSync,
  preflightSync,
  type SyncDeps,
  type SyncCounts,
  type SyncLifecycleStage,
  type DryRunResult,
  type LiveWriteResult,
  type PreflightResult,
} from './orchestrator.ts'
export {
  type EntityCounts,
  ZERO_ENTITY_COUNTS,
  totalEntityCounts,
} from '../types/index.ts'
export {
  type SyncRequest,
  type SyncMode,
  validateRequestShape,
  readLiveWriteGates,
  assertLiveWriteAllowed,
  type LiveWriteGates,
} from './request.ts'
export {
  MAX_BACKFILL_DAYS,
  MAX_WINDOWS_PER_RUN,
  FETCH_WINDOW_DAYS,
  validateRange,
  chunkRange,
  rollingRange,
  type DateRange,
  type WindowLimits,
} from './dateWindows.ts'
export { SyncError, type SyncErrorCode } from './errors.ts'
export {
  resolveOrphanAds,
  EMPTY_ORPHAN_REPORT,
  type OrphanResolutionReport,
  type OrphanAdResolverDeps,
  type LocalAdRecovery,
  type RecoveredAd,
} from './orphanAds.ts'
