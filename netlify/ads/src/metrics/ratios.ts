/**
 * Metric value constructors and the exact-decimal helpers (Stage 10, Phase 2).
 *
 * This is where the ratio rules live: every derived metric is built as an EXACT
 * `numerator / denominator` of `bigint`s, and a zero denominator yields a
 * structured `zero_denominator` unavailable — never a numeric zero. Money ratios
 * (CPC/CPM/CPL) fold the spend's decimal scale into the denominator so the result
 * stays exact until `format.ts` rounds it for display.
 *
 * Pure arithmetic only: no `Number`, no floats, no I/O.
 */
import type {
  ExactDecimal,
  Metric,
  MetricUnit,
  UnavailableReason,
} from './types.ts'

/** Build an unavailable metric with a structured reason. */
export function unavailable(reason: UnavailableReason): Metric {
  return { status: 'unavailable', reason }
}

/** An exact whole-count metric (denominator 1). A genuine zero stays a zero. */
export function count(value: bigint): Metric {
  return {
    status: 'available',
    unit: 'integer',
    numerator: value,
    denominator: 1n,
    currency: null,
  }
}

/**
 * A ratio metric. Returns `zero_denominator` (never a number) when the summed
 * denominator is zero. `numerator`/`denominator` are kept exact for format-time
 * rounding.
 */
export function ratio(
  numerator: bigint,
  denominator: bigint,
  unit: MetricUnit,
  currency: string | null = null,
): Metric {
  if (denominator === 0n) return unavailable('zero_denominator')
  // Normalise the sign so the denominator is always positive.
  const flip = denominator < 0n
  return {
    status: 'available',
    unit,
    numerator: flip ? -numerator : numerator,
    denominator: flip ? -denominator : denominator,
    currency,
  }
}

/** A percentage ratio (e.g. CTR): fraction now, `× 100` and '%' at format time. */
export function percent(numerator: bigint, denominator: bigint): Metric {
  return ratio(numerator, denominator, 'percent')
}

/** A plain decimal ratio (e.g. frequency = impressions ÷ reach). */
export function decimalRatio(numerator: bigint, denominator: bigint): Metric {
  return ratio(numerator, denominator, 'decimal')
}

/** An exact money amount (e.g. summed spend) as a currency metric. */
export function money(amount: ExactDecimal, currency: string | null): Metric {
  // value = units / 10^scale major units.
  return ratio(amount.units, pow10(amount.scale), 'currency', currency)
}

/**
 * A money-per-unit ratio (CPC/CPM/CPL): `spend × factor ÷ denom`. The spend's
 * decimal scale is folded into the denominator so the magnitude stays in major
 * currency units and remains exact. `denom === 0` → `zero_denominator`.
 */
export function moneyPerUnit(
  spend: ExactDecimal,
  denom: bigint,
  currency: string | null,
  factor: bigint = 1n,
): Metric {
  return ratio(
    spend.units * factor,
    denom * pow10(spend.scale),
    'currency',
    currency,
  )
}

// --- exact decimal arithmetic ----------------------------------------------

/** `10 ** n` as a bigint (n >= 0). */
export function pow10(n: number): bigint {
  return 10n ** BigInt(n)
}

/** Parse a Meta decimal string (e.g. "12.34", "0", "1.230000") into `ExactDecimal`. */
export function parseExactDecimal(text: string): ExactDecimal {
  const negative = text.startsWith('-')
  const body = negative ? text.slice(1) : text
  const dot = body.indexOf('.')
  const intPart = dot === -1 ? body : body.slice(0, dot)
  const fracPart = dot === -1 ? '' : body.slice(dot + 1)
  const digits = `${intPart}${fracPart}` || '0'
  const magnitude = BigInt(digits)
  return { units: negative ? -magnitude : magnitude, scale: fracPart.length }
}

/** Exact sum of two decimals, aligning scales via integer scaling (no floats). */
export function addExactDecimal(
  a: ExactDecimal,
  b: ExactDecimal,
): ExactDecimal {
  const scale = Math.max(a.scale, b.scale)
  const ua = a.units * pow10(scale - a.scale)
  const ub = b.units * pow10(scale - b.scale)
  return { units: ua + ub, scale }
}

/** The exact-decimal additive identity (0). */
export const ZERO_DECIMAL: ExactDecimal = { units: 0n, scale: 0 }
