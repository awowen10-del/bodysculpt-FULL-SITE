/**
 * The single authoritative aggregation entry point (Stage 10, Phase 2).
 *
 * `aggregateInsights(rows)` reduces a group of normalised daily insight rows —
 * an account total, a campaign, an ad set, a single ad, or one ad-day — into the
 * `AggregatedMetrics` the dashboard renders. Every rule from the metric
 * dictionary is enforced HERE, so no other layer (and certainly no React
 * component) ever does metric arithmetic:
 *
 * - Ratios (CTR/CPC/CPM/CPL/frequency) are computed as SUMMED numerator ÷ SUMMED
 *   denominator — row-level ratios are never averaged.
 * - Spend is summed with exact scaled-integer arithmetic (`ExactDecimal`).
 * - Counts are summed as `bigint` and never pass through `Number`.
 * - A null count contributes nothing (Meta semantics: an absent action = 0
 *   recorded events), EXCEPT leads, where a null means no authoritative lead
 *   total exists for that row (Meta did not report its canonical `lead` figure,
 *   and component lead types are never summed to fill the gap) → leads and CPL
 *   are `lead_definition_unresolved`.
 * - `reach`/`frequency` are only meaningful for a single row; across multiple
 *   rows they are `not_additive`.
 * - No rows at all → every metric is `no_data`.
 */
import type { NormalizedDailyInsight } from '../types/index.ts'
import type { AggregatedMetrics, ExactDecimal, Metric } from './types.ts'
import {
  addExactDecimal,
  count,
  decimalRatio,
  money,
  moneyPerUnit,
  parseExactDecimal,
  percent,
  unavailable,
  ZERO_DECIMAL,
} from './ratios.ts'

/** Running totals accumulated in one exact pass over the rows. */
interface Totals {
  rowCount: number
  currency: string | null
  spend: ExactDecimal
  impressions: bigint
  clicks: bigint
  inlineLinkClicks: bigint
  outboundClicks: bigint
  landingPageViews: bigint
  videoPlays: bigint
  videoP25: bigint
  videoP50: bigint
  videoP75: bigint
  videoP95: bigint
  videoP100: bigint
  /** Leads sum — only trusted when `leadsResolved` stays true. */
  leads: bigint
  /** False as soon as ANY row has null leads (unresolved lead definition). */
  leadsResolved: boolean
  /** The single row's reach, kept only while exactly one row has been seen. */
  soleReach: bigint | null
}

/** Add a possibly-null bigint count into an accumulator (null → +0). */
function addCount(acc: bigint, value: bigint | null): bigint {
  return value === null ? acc : acc + value
}

function reduceTotals(rows: readonly NormalizedDailyInsight[]): Totals {
  const totals: Totals = {
    rowCount: rows.length,
    currency: rows.length > 0 ? rows[0].currency : null,
    spend: ZERO_DECIMAL,
    impressions: 0n,
    clicks: 0n,
    inlineLinkClicks: 0n,
    outboundClicks: 0n,
    landingPageViews: 0n,
    videoPlays: 0n,
    videoP25: 0n,
    videoP50: 0n,
    videoP75: 0n,
    videoP95: 0n,
    videoP100: 0n,
    leads: 0n,
    leadsResolved: true,
    soleReach: null,
  }

  for (const row of rows) {
    if (row.spend !== null) {
      totals.spend = addExactDecimal(totals.spend, parseExactDecimal(row.spend))
    }
    totals.impressions = addCount(totals.impressions, row.impressions)
    totals.clicks = addCount(totals.clicks, row.clicks)
    totals.inlineLinkClicks = addCount(
      totals.inlineLinkClicks,
      row.inlineLinkClicks,
    )
    totals.outboundClicks = addCount(totals.outboundClicks, row.outboundClicks)
    totals.landingPageViews = addCount(
      totals.landingPageViews,
      row.landingPageViews,
    )
    totals.videoPlays = addCount(totals.videoPlays, row.videoPlayActions)
    totals.videoP25 = addCount(totals.videoP25, row.videoP25WatchedActions)
    totals.videoP50 = addCount(totals.videoP50, row.videoP50WatchedActions)
    totals.videoP75 = addCount(totals.videoP75, row.videoP75WatchedActions)
    totals.videoP95 = addCount(totals.videoP95, row.videoP95WatchedActions)
    totals.videoP100 = addCount(totals.videoP100, row.videoP100WatchedActions)

    if (row.leads === null) totals.leadsResolved = false
    else totals.leads += row.leads
  }

  if (rows.length === 1) totals.soleReach = rows[0].reach
  return totals
}

/**
 * Reach across multiple rows double-counts unique people, so it is only reported
 * for a single row (`not_additive` otherwise). A single row with absent reach is
 * `no_data`.
 */
function reachMetric(totals: Totals): Metric {
  if (totals.rowCount === 0) return unavailable('no_data')
  if (totals.rowCount > 1) return unavailable('not_additive')
  if (totals.soleReach === null) return unavailable('no_data')
  return count(totals.soleReach)
}

/** Frequency = impressions ÷ reach, single-row-only (else `not_additive`). */
function frequencyMetric(totals: Totals): Metric {
  if (totals.rowCount === 0) return unavailable('no_data')
  if (totals.rowCount > 1) return unavailable('not_additive')
  if (totals.soleReach === null) return unavailable('no_data')
  return decimalRatio(totals.impressions, totals.soleReach)
}

/** Leads honour the shipped lead definition: any null contributor → unresolved. */
function leadsMetric(totals: Totals): Metric {
  if (totals.rowCount === 0) return unavailable('no_data')
  if (!totals.leadsResolved) return unavailable('lead_definition_unresolved')
  return count(totals.leads)
}

/** CPL = spend ÷ leads; unresolved leads propagate; zero leads → zero_denominator. */
function cplMetric(totals: Totals): Metric {
  if (totals.rowCount === 0) return unavailable('no_data')
  if (!totals.leadsResolved) return unavailable('lead_definition_unresolved')
  return moneyPerUnit(totals.spend, totals.leads, totals.currency)
}

/**
 * Reduce daily insight rows to the dashboard's metric set. Pure and total: the
 * same rows always produce the same metrics, and it never throws on empty input.
 */
export function aggregateInsights(
  rows: readonly NormalizedDailyInsight[],
): AggregatedMetrics {
  const totals = reduceTotals(rows)
  const noData = rows.length === 0

  const asCount = (value: bigint): Metric =>
    noData ? unavailable('no_data') : count(value)

  return {
    rowCount: totals.rowCount,
    currency: totals.currency,

    spend: noData
      ? unavailable('no_data')
      : money(totals.spend, totals.currency),
    impressions: asCount(totals.impressions),
    clicks: asCount(totals.clicks),
    inlineLinkClicks: asCount(totals.inlineLinkClicks),
    outboundClicks: asCount(totals.outboundClicks),
    landingPageViews: asCount(totals.landingPageViews),
    leads: leadsMetric(totals),
    videoPlays: asCount(totals.videoPlays),
    videoP25: asCount(totals.videoP25),
    videoP50: asCount(totals.videoP50),
    videoP75: asCount(totals.videoP75),
    videoP95: asCount(totals.videoP95),
    videoP100: asCount(totals.videoP100),

    reach: reachMetric(totals),

    ctr: noData
      ? unavailable('no_data')
      : percent(totals.clicks, totals.impressions),
    linkCtr: noData
      ? unavailable('no_data')
      : percent(totals.inlineLinkClicks, totals.impressions),
    cpc: noData
      ? unavailable('no_data')
      : moneyPerUnit(totals.spend, totals.clicks, totals.currency),
    cpm: noData
      ? unavailable('no_data')
      : moneyPerUnit(totals.spend, totals.impressions, totals.currency, 1000n),
    cpl: cplMetric(totals),
    costPerLinkClick: noData
      ? unavailable('no_data')
      : moneyPerUnit(totals.spend, totals.inlineLinkClicks, totals.currency),
    costPerVideoView75: noData
      ? unavailable('no_data')
      : moneyPerUnit(totals.spend, totals.videoP75, totals.currency),
    frequency: frequencyMetric(totals),
  }
}
