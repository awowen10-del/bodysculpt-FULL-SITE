/**
 * Metric value model — the single authoritative shape for every displayed number
 * (Stage 10, Phase 2).
 *
 * A `Metric` is either AVAILABLE (an exact rational magnitude plus a display
 * unit) or UNAVAILABLE (a structured reason — never a silent zero, never a
 * fabricated value). The metrics layer NEVER stores a rounded floating-point
 * number: an available metric keeps its exact `numerator` and `denominator` as
 * `bigint`, and rounding happens ONLY at format time (`format.ts`). This keeps
 * ratios exact-until-display and lets the UI show honest "—" states with a cause.
 *
 * Design rules enforced across the layer:
 * - Ratios are summed-numerator ÷ summed-denominator; row-level ratios are never
 *   averaged (see `aggregate.ts`).
 * - Money is summed with exact scaled-integer arithmetic (`ExactDecimal`), never
 *   IEEE-754 floats.
 * - Counts stay `bigint` end-to-end and never pass through `Number`.
 */

/** Why a metric cannot be shown as a number. Closed set — the UI maps each to copy. */
export type UnavailableReason =
  'zero_denominator' | 'lead_definition_unresolved' | 'not_additive' | 'no_data'

/** How an available magnitude should be rendered (format only — not part of maths). */
export type MetricUnit = 'integer' | 'currency' | 'percent' | 'decimal'

/**
 * An available metric as an EXACT rational `numerator / denominator`, both
 * `bigint`. `denominator` is always > 0. The magnitude is unit-natural:
 * - integer  → whole count (denominator is 1)
 * - currency → major currency units (e.g. pounds); `currency` is set
 * - percent  → a fraction; format multiplies by 100 and appends '%'
 * - decimal  → a plain ratio (e.g. frequency)
 */
export interface MetricAvailable {
  readonly status: 'available'
  readonly unit: MetricUnit
  readonly numerator: bigint
  readonly denominator: bigint
  /** ISO currency code for `currency` unit; null otherwise. */
  readonly currency: string | null
}

/** An unavailable metric — carries the cause, never a number. */
export interface MetricUnavailable {
  readonly status: 'unavailable'
  readonly reason: UnavailableReason
}

export type Metric = MetricAvailable | MetricUnavailable

/**
 * A decimal represented as an exact scaled integer: `value = units / 10^scale`.
 * Used to sum money with zero floating-point drift. `scale >= 0`.
 */
export interface ExactDecimal {
  readonly units: bigint
  readonly scale: number
}

/**
 * The full set of aggregated metrics for one group of daily insight rows
 * (account total, a campaign, an ad set, a single ad, a single ad-day, …).
 *
 * `spend` and the counts are additive sums. `reach`/`frequency` are only
 * meaningful for a single row and become `not_additive` across many rows.
 * `leads`/`cpl` become `lead_definition_unresolved` whenever any contributing
 * row has null leads (the shipped default lead definition). Ratios become
 * `zero_denominator` when their summed denominator is zero.
 */
export interface AggregatedMetrics {
  /** Number of daily insight rows that fed this aggregate. */
  readonly rowCount: number
  /** Currency of the money metrics (from the rows), or null when there are none. */
  readonly currency: string | null

  // --- additive base sums ---
  readonly spend: Metric
  readonly impressions: Metric
  readonly clicks: Metric
  readonly inlineLinkClicks: Metric
  readonly outboundClicks: Metric
  readonly landingPageViews: Metric
  readonly leads: Metric
  readonly videoPlays: Metric
  readonly videoP25: Metric
  readonly videoP50: Metric
  readonly videoP75: Metric
  readonly videoP95: Metric
  readonly videoP100: Metric

  // --- single-row-only base values ---
  readonly reach: Metric

  // --- derived ratios (summed numerator ÷ summed denominator) ---
  readonly ctr: Metric
  readonly linkCtr: Metric
  readonly cpc: Metric
  readonly cpm: Metric
  readonly cpl: Metric
  /** Cost per inline link click = spend ÷ inlineLinkClicks (traffic primary metric). */
  readonly costPerLinkClick: Metric
  /**
   * Cost per 75% video view = spend ÷ videoP75WatchedActions (video primary
   * metric). ThruPlay has no additive count in the schema, so the honest,
   * summed-numerator ÷ summed-denominator video cost is built on the P75 count.
   */
  readonly costPerVideoView75: Metric
  readonly frequency: Metric
}
