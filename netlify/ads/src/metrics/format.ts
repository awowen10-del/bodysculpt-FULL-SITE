/**
 * Presentation formatting for metrics (Stage 10, Phase 2).
 *
 * DISPLAY ONLY. These functions READ a `Metric` and return a display string;
 * they never mutate a metric and never change the maths. Rounding lives here and
 * nowhere else — an available metric is an exact `numerator / denominator`, and
 * `divRound` performs the only rounding, using pure `bigint` integer arithmetic
 * (round half up). An unavailable metric renders as an em dash "—", never as a
 * number and never as a bare zero; its structured reason maps to plain-English
 * copy for a tooltip.
 */
import type { Metric, UnavailableReason } from './types.ts'

/** The single glyph shown for any unavailable metric. */
export const UNAVAILABLE_DISPLAY = '—'

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: '£',
  USD: '$',
  EUR: '€',
}

/**
 * Exact rounded division `numerator / denominator` to `places` decimals, as a
 * string, using only `bigint`. Round half up on magnitude; denominator > 0.
 */
function divRound(
  numerator: bigint,
  denominator: bigint,
  places: number,
  grouped = true,
): string {
  const negative = numerator < 0n
  const mag = negative ? -numerator : numerator
  const scale = 10n ** BigInt(places)
  const scaled = mag * scale
  let q = scaled / denominator
  const remainder = scaled % denominator
  // Round half up: 2 * remainder >= denominator.
  if (remainder * 2n >= denominator) q += 1n

  const digits = q.toString()
  let intPart: string
  let fracPart: string
  if (places === 0) {
    intPart = digits
    fracPart = ''
  } else {
    const padded = digits.padStart(places + 1, '0')
    intPart = padded.slice(0, padded.length - places)
    fracPart = padded.slice(padded.length - places)
  }
  const shownInt = grouped ? group(intPart) : intPart
  const body = fracPart === '' ? shownInt : `${shownInt}.${fracPart}`
  return negative && q !== 0n ? `-${body}` : body
}

/** Insert thousands separators into a non-negative integer digit string. */
function group(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function currencySymbol(currency: string | null): string {
  if (currency === null) return ''
  return CURRENCY_SYMBOLS[currency] ?? `${currency} `
}

/**
 * Render a metric for display. Unavailable → "—". Available →
 * - integer  → grouped whole number
 * - currency → symbol + amount to 2 dp
 * - percent  → magnitude × 100 to 2 dp + '%'
 * - decimal  → magnitude to 2 dp
 */
export function formatMetric(metric: Metric): string {
  if (metric.status === 'unavailable') return UNAVAILABLE_DISPLAY

  const { numerator, denominator, unit } = metric
  switch (unit) {
    case 'integer':
      return divRound(numerator, denominator, 0)
    case 'currency':
      return `${currencySymbol(metric.currency)}${divRound(numerator, denominator, 2)}`
    case 'percent':
      return `${divRound(numerator * 100n, denominator, 2)}%`
    case 'decimal':
      return divRound(numerator, denominator, 2)
  }
}

/**
 * The BARE numeric value of a metric as a JSON-safe string — no currency symbol,
 * no thousands separators, no '%'. Intended for DTOs that need a machine-readable
 * value the UI can sort/plot WITHOUT doing any arithmetic. Unavailable → null.
 *
 * - integer  → exact whole number (e.g. "227655")
 * - currency → amount to 2 dp (e.g. "1918.35")
 * - percent  → the percentage number to 2 dp, WITHOUT '%' (e.g. "1.90")
 * - decimal  → to 2 dp (e.g. "1.28")
 *
 * Same rounding as `formatMetric` (the only rounding lives in `divRound`), so the
 * value and the display never disagree.
 */
export function formatMetricValue(metric: Metric): string | null {
  if (metric.status === 'unavailable') return null

  const { numerator, denominator, unit } = metric
  switch (unit) {
    case 'integer':
      return divRound(numerator, denominator, 0, false)
    case 'currency':
      return divRound(numerator, denominator, 2, false)
    case 'percent':
      return divRound(numerator * 100n, denominator, 2, false)
    case 'decimal':
      return divRound(numerator, denominator, 2, false)
  }
}

const REASON_COPY: Record<UnavailableReason, string> = {
  zero_denominator:
    'Not available — the denominator is zero (no impressions, clicks or leads to divide by).',
  lead_definition_unresolved:
    'Not available — Meta did not report its canonical lead total for part of this selection, and lead types are never added together to fill the gap.',
  not_additive:
    'Not available — this metric cannot be summed across multiple rows (it would double-count).',
  no_data: 'Not available — there is no data for this selection.',
}

/** The structured reason for an unavailable metric, or null when it is available. */
export function unavailableReason(metric: Metric): UnavailableReason | null {
  return metric.status === 'unavailable' ? metric.reason : null
}

/** Plain-English explanation of an unavailable reason (for a tooltip/title). */
export function explainUnavailable(reason: UnavailableReason): string {
  return REASON_COPY[reason]
}

/**
 * Convenience for the UI: the display string plus an optional reason explanation
 * (present only when unavailable). Still display-only — no maths.
 */
export function describeMetric(metric: Metric): {
  display: string
  reason: UnavailableReason | null
  explanation: string | null
} {
  if (metric.status === 'unavailable') {
    return {
      display: UNAVAILABLE_DISPLAY,
      reason: metric.reason,
      explanation: explainUnavailable(metric.reason),
    }
  }
  return { display: formatMetric(metric), reason: null, explanation: null }
}
