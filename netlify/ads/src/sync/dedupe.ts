/**
 * Strict, conflict-aware de-duplication for Stage 7.
 *
 * Exact semantic duplicates (same key, deep-equal content) collapse to one;
 * CONFLICTING duplicates (same key, different content) FAIL LOUD. There is no
 * unconditional last-wins. `ignoreKeys` may drop only fields explicitly
 * documented as non-semantic; meaningful content differences are never ignored.
 */
import { SyncError } from './errors.ts'

/** Structural deep equality (handles primitives, bigint, Date, arrays, objects). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true // covers primitives incl. bigint === bigint
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false
    }
    return a.every((x, i) => deepEqual(x, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const ak = Object.keys(ao)
    const bk = Object.keys(bo)
    if (ak.length !== bk.length) return false
    return ak.every(
      (k) =>
        Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]),
    )
  }
  return false
}

function withoutKeys(value: unknown, ignoreKeys: readonly string[]): unknown {
  if (ignoreKeys.length === 0) return value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!ignoreKeys.includes(k)) out[k] = v
  }
  return out
}

export interface DedupeOptions<T> {
  /** Human label for error messages (never include raw ids). */
  label: string
  /** Fields to ignore in the conflict comparison (documented non-semantic only). */
  ignoreKeys?: readonly string[]
  /** Custom equality; defaults to deepEqual over (item minus ignoreKeys). */
  equals?: (a: T, b: T) => boolean
}

/**
 * De-duplicate by key. First occurrence is kept; a later exact-equal duplicate is
 * dropped; a later CONFLICTING duplicate throws `CONFLICTING_DUPLICATE`.
 */
export function dedupeStrict<T>(
  items: readonly T[],
  keyFn: (item: T) => string,
  opts: DedupeOptions<T>,
): T[] {
  const ignore = opts.ignoreKeys ?? []
  const equals =
    opts.equals ??
    ((a: T, b: T): boolean =>
      deepEqual(withoutKeys(a, ignore), withoutKeys(b, ignore)))
  const map = new Map<string, T>()
  for (const item of items) {
    const key = keyFn(item)
    const existing = map.get(key)
    if (existing === undefined) {
      map.set(key, item)
      continue
    }
    if (!equals(existing, item)) {
      throw new SyncError(
        'CONFLICTING_DUPLICATE',
        `conflicting duplicate ${opts.label} for one Meta key`,
      )
    }
    // exact semantic duplicate -> keep the first, drop this one
  }
  return [...map.values()]
}
