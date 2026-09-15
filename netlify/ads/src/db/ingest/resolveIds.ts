/**
 * Meta-ID → UUID resolution helpers for the Stage 6 write layer.
 *
 * Maps are ALWAYS built from an explicit SELECT after upsert (never from an
 * upsert's RETURNING batch, which can omit pre-existing rows), so newly inserted
 * and pre-existing rows resolve identically. Every helper FAILS LOUD on missing,
 * duplicate, or ambiguous mappings, and never places raw Meta ids in an error
 * message (they could be account-identifying).
 */
import { IngestError } from './dbErrors.ts'

export type IdMap = Map<string, string>

/** Build a `metaId → uuid` map from selected rows; a repeated Meta id is ambiguous. */
export function buildIdMap(
  rows: readonly { meta: string; id: string }[],
  entity: string,
): IdMap {
  const map: IdMap = new Map()
  for (const row of rows) {
    if (map.has(row.meta)) {
      throw new IngestError(
        'AMBIGUOUS_ID',
        `more than one ${entity} row resolved for a single Meta id`,
      )
    }
    map.set(row.meta, row.id)
  }
  return map
}

/** Assert every requested Meta id resolved (fail loud; no raw ids in the message). */
export function assertComplete(
  map: ReadonlyMap<string, unknown>,
  requested: readonly string[],
  entity: string,
): void {
  let missing = 0
  for (const id of requested) if (!map.has(id)) missing += 1
  if (missing > 0) {
    throw new IngestError(
      'UNRESOLVED_ID',
      `${missing} of ${requested.length} ${entity} ids did not resolve after upsert`,
    )
  }
}

/** Deterministic de-duplication by a Meta natural key — the LAST occurrence wins. */
export function dedupeByKey<T>(
  items: readonly T[],
  key: (item: T) => string,
): T[] {
  const map = new Map<string, T>()
  for (const item of items) map.set(key(item), item)
  return [...map.values()]
}

/** Resolve a REQUIRED parent uuid from a map, or fail loud. */
export function requireParent(
  map: IdMap,
  metaId: string | null,
  entity: string,
  parent: string,
): string {
  if (metaId === null) {
    throw new IngestError(
      'MISSING_PARENT',
      `a ${entity} is missing its ${parent} Meta id`,
    )
  }
  const uuid = map.get(metaId)
  if (uuid === undefined) {
    throw new IngestError(
      'UNRESOLVED_ID',
      `a ${entity} references an unknown ${parent}`,
    )
  }
  return uuid
}

/** Resolve an OPTIONAL parent uuid (null id → null); present-but-unknown fails loud. */
export function optionalParent(
  map: IdMap,
  metaId: string | null,
  entity: string,
  parent: string,
): string | null {
  if (metaId === null) return null
  const uuid = map.get(metaId)
  if (uuid === undefined) {
    throw new IngestError(
      'UNRESOLVED_ID',
      `a ${entity} references an unknown ${parent}`,
    )
  }
  return uuid
}
