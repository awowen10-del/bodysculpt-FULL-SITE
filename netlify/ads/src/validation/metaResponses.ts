/**
 * Validation + safe coercion for Meta Marketing API responses (Stage 5).
 *
 * This is the ONLY place that decides whether a raw Meta scalar is valid, and
 * how it maps into an internal value. The rules are deliberate and strict:
 *
 *   - Genuine ABSENCE (field `undefined` or JSON `null`) maps to `null`.
 *   - A valid ZERO stays zero (`"0"` -> `0n`, `"0.0"` -> `"0.0"`).
 *   - A MALFORMED present value FAILS LOUDLY (throws `MetaValidationError`) — it
 *     is never silently coerced to null or 0.
 *   - Integer counts are parsed LOSSLESSLY into `bigint` and never pass through
 *     JavaScript's `Number` (which is unsafe beyond 2^53). Decimals are kept as
 *     their exact string so no precision is lost.
 *
 * Structural checks (is this a list envelope? does the entity carry an id?) use
 * `zod`; rich value checks use the strict scalar parsers below.
 *
 * No network, no env, no side effects — fully offline and unit-testable.
 */
import { z } from 'zod'

/** Thrown whenever a present Meta value is structurally or semantically wrong. */
export class MetaValidationError extends Error {
  readonly field: string
  constructor(field: string, detail: string) {
    super(`Meta field "${field}": ${detail}`)
    this.name = 'MetaValidationError'
    this.field = field
  }
}

const INTEGER_RE = /^-?\d+$/
const DECIMAL_RE = /^-?\d+(\.\d+)?$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null
}

/**
 * Parse a Meta integer count LOSSLESSLY into `bigint`.
 * Absent -> null. Valid integer string -> bigint (never via Number). A present
 * non-integer, empty, or non-string/number value throws.
 */
export function parseMetaCount(value: unknown, field: string): bigint | null {
  if (isAbsent(value)) return null
  if (typeof value === 'string') {
    const s = value.trim()
    if (!INTEGER_RE.test(s)) {
      throw new MetaValidationError(
        field,
        `"${value}" is not a valid integer count`,
      )
    }
    return BigInt(s) // lossless — no JavaScript Number in the path
  }
  if (typeof value === 'number') {
    // Meta returns counts as strings; a JSON number has already gone through
    // Number, so only accept it when it is provably a safe integer.
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
      throw new MetaValidationError(
        field,
        `numeric ${value} is not a safe integer; counts must arrive as integer strings`,
      )
    }
    return BigInt(value)
  }
  throw new MetaValidationError(
    field,
    `expected an integer string, got ${typeof value}`,
  )
}

/**
 * Parse a Meta decimal LOSSLESSLY, preserving the exact string (e.g. spend,
 * ratios). Absent -> null. A present non-decimal or empty value throws.
 */
export function parseMetaDecimal(value: unknown, field: string): string | null {
  if (isAbsent(value)) return null
  if (typeof value === 'string') {
    const s = value.trim()
    if (!DECIMAL_RE.test(s)) {
      throw new MetaValidationError(field, `"${value}" is not a valid decimal`)
    }
    return s
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new MetaValidationError(field, `numeric ${value} is not finite`)
    }
    return String(value)
  }
  throw new MetaValidationError(
    field,
    `expected a decimal string, got ${typeof value}`,
  )
}

/** Absent -> null. A valid ISO 8601 timestamp string -> Date. Else throws. */
export function parseMetaTimestamp(value: unknown, field: string): Date | null {
  if (isAbsent(value)) return null
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MetaValidationError(field, `expected an ISO timestamp string`)
  }
  const ms = Date.parse(value.trim())
  if (Number.isNaN(ms)) {
    throw new MetaValidationError(field, `"${value}" is not a valid timestamp`)
  }
  return new Date(ms)
}

/**
 * Absent -> null. A real `YYYY-MM-DD` calendar date -> the canonical string.
 * Else throws (including impossible dates like `2026-13-40`).
 */
export function parseMetaDate(value: unknown, field: string): string | null {
  if (isAbsent(value)) return null
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value.trim())) {
    throw new MetaValidationError(field, `"${value}" is not a YYYY-MM-DD date`)
  }
  const s = value.trim()
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new MetaValidationError(field, `"${s}" is not a real calendar date`)
  }
  return s
}

/** Absent -> null. A string -> the string. A present non-string throws. */
export function parseMetaText(value: unknown, field: string): string | null {
  if (isAbsent(value)) return null
  if (typeof value !== 'string') {
    throw new MetaValidationError(
      field,
      `expected a string, got ${typeof value}`,
    )
  }
  return value
}

/** Like `parseMetaText` but the value must be present and non-empty. */
export function requireMetaText(value: unknown, field: string): string {
  const text = parseMetaText(value, field)
  if (text === null || text.trim() === '') {
    throw new MetaValidationError(field, `required value is missing or empty`)
  }
  return text
}

/** Absent -> null. A present value must be an array (else throws); returned as-is. */
export function parseMetaArray(
  value: unknown,
  field: string,
): unknown[] | null {
  if (isAbsent(value)) return null
  if (!Array.isArray(value)) {
    throw new MetaValidationError(
      field,
      `expected an array, got ${typeof value}`,
    )
  }
  return value
}

// --- structural (zod) validation -------------------------------------------

function issuesToString(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ')
}

const listEnvelopeSchema = z.object({ data: z.array(z.unknown()) })
const graphIdSchema = z.object({ id: z.string().min(1) })

/** Validate a `{ data: [...] }` Meta list envelope and return the `data` array. */
export function parseMetaListEnvelope(
  response: unknown,
  context = 'response',
): unknown[] {
  const result = listEnvelopeSchema.safeParse(response)
  if (!result.success) {
    throw new MetaValidationError(
      context,
      `not a Meta list envelope (${issuesToString(result.error)})`,
    )
  }
  return result.data.data
}

/**
 * Assert a value is a Meta object carrying a non-empty `id`, and return it as a
 * typed record for field-by-field parsing. Arrays and non-objects are rejected.
 */
export function asGraphEntity(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MetaValidationError(context, `expected a Meta object`)
  }
  const result = graphIdSchema.safeParse(value)
  if (!result.success) {
    throw new MetaValidationError(
      context,
      `missing/invalid id (${issuesToString(result.error)})`,
    )
  }
  return value as Record<string, unknown>
}

/** Assert a value is a plain Meta object (no id requirement, e.g. an insight row). */
export function asMetaObject(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MetaValidationError(context, `expected a Meta object`)
  }
  return value as Record<string, unknown>
}
