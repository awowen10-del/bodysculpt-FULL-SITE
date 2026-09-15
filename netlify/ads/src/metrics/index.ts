/**
 * `metrics/` — the single authoritative metrics/aggregation layer (Stage 10,
 * Phase 2). Every displayed number originates here; no other layer, and no React
 * component, performs metric arithmetic.
 *
 * Public surface:
 * - `aggregateInsights(rows)` → `AggregatedMetrics` (summed components, exact
 *   money, structured unavailable reasons).
 * - `formatMetric` / `describeMetric` / `explainUnavailable` — display only.
 * - value constructors and `ExactDecimal` helpers for callers that build metrics
 *   directly.
 */
export type {
  Metric,
  MetricAvailable,
  MetricUnavailable,
  MetricUnit,
  UnavailableReason,
  ExactDecimal,
  AggregatedMetrics,
} from './types.ts'

export { aggregateInsights } from './aggregate.ts'

export {
  unavailable,
  count,
  ratio,
  percent,
  decimalRatio,
  money,
  moneyPerUnit,
  parseExactDecimal,
  addExactDecimal,
  pow10,
  ZERO_DECIMAL,
} from './ratios.ts'

export {
  formatMetric,
  formatMetricValue,
  describeMetric,
  unavailableReason,
  explainUnavailable,
  UNAVAILABLE_DISPLAY,
} from './format.ts'

export type {
  ObjectiveFamily,
  LinkCtrRating,
  LinkCtrBands,
  CommercialDecisionSettings,
  EligibilitySettings,
} from './decisionConfig.ts'

export {
  ACTIVE_DECISION_SETTINGS,
  DECISION_SETTINGS_V1,
  EVENT_FAMILY_MAP,
  validateDecisionSettings,
  minorToMoney,
  formatMinor,
  ELIGIBILITY_SETTINGS_V1,
  ACTIVE_ELIGIBILITY_SETTINGS,
} from './decisionConfig.ts'

export type {
  Eligibility,
  IneligibilityReason,
  ResolvedObjective,
  EligibilityResolution,
  EligibilityInput,
  ConversionEvidence,
  EligibleEvaluation,
  IneligibleEvaluation,
  CreativeEvaluation,
} from './eligibility.ts'

export {
  resolveCreativeEligibility,
  optimizationEventLabel,
  conversionEvidenceOf,
} from './eligibility.ts'

export type {
  CommercialDecision,
  DecisionReason,
  DecisionInput,
  DecisionNarrative,
  CreativeDecision,
  AnalysisWindow,
} from './decision.ts'

export { decideCreative, decisionLabel, rateLinkCtr } from './decision.ts'
