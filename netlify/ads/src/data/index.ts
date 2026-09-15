/**
 * `data/` — the repository + DTO boundary the browser depends on (Stage 10,
 * Phase 3).
 *
 * The UI imports the `DashboardRepository` contract and DTO types from here and
 * nothing deeper. The default implementation is seed-backed and fully offline;
 * swapping in an API/database-backed repository later requires no UI changes.
 *
 * This module (and everything it re-exports) is browser-safe: no database, no
 * Postgres/Drizzle, no sync layer, no Meta graph client, no node built-ins, no
 * credentials — enforced by `tests/boundaries/uiNoDbImports.test.ts`.
 */
export type {
  DashboardRepository,
  DateRangeQuery,
  AdSetQuery,
  AdQuery,
  DailyQuery,
  CreativeQuery,
  CreativeSort,
} from './repository.ts'

export type {
  MetricDTO,
  MetricSetDTO,
  DateRangeDTO,
  DataStateDTO,
  SummaryDTO,
  CampaignDTO,
  AdSetDTO,
  AdDTO,
  CreativeDTO,
  AdDetailDTO,
  DailyRowDTO,
  CreativeAiAnnotationsDTO,
  CreativeDecisionDTO,
  DecisionSettingsDTO,
  CreativeRowDTO,
  CreativeContextDTO,
  ResolvedObjectiveDTO,
  EvaluationStatusDTO,
  CreativeEvaluationDTO,
} from './dto.ts'

export type {
  ObjectiveFamily,
  CommercialDecision,
  DecisionReason,
  LinkCtrRating,
  Eligibility,
  IneligibilityReason,
} from '../metrics/index.ts'

export {
  isPositiveMetric,
  toCreativeListRow,
  campaignHasEnded,
  campaignIsLive,
  adIsPaused,
} from './dto.ts'
export { makeRowId, parseRowId } from './creativeAssembly.ts'
export {
  resolveCreativePreview,
  resolveCreativeCopy,
  type PreviewSource,
} from './creativeContent.ts'

export { createSeedRepository } from './seedRepository.ts'

/**
 * API-backed repository (Stage 11B, partial — `getDataState` + `getSummary`).
 * Not yet the UI default; browser-safe (fetch + zod + DTO types only).
 */
export {
  createApiRepository,
  repositoryDiagnostics,
  RepositoryError,
  RepositoryUnauthorizedError,
  RepositoryUnavailableError,
  RepositoryResponseError,
  RepositoryNotImplementedError,
} from './apiRepository.ts'
export type {
  ApiRepositoryOptions,
  FetchLike,
  FetchResponseLike,
  RepositoryDiagnostics,
} from './apiRepository.ts'
