/**
 * Phase C.2 creative-scoped SEMANTIC COMPARATOR (pure, offline, read-only).
 *
 * Meta expands the same creative id inline on several ads and re-mints its CDN
 * urls per response, so two representations of one creative can disagree on
 * bytes while describing the same asset. Phase C.1 measured this live and found
 * the churn confined to a closed set of query parameters:
 *
 *   top-level (28 groups) — imageUrl / thumbnailUrl only, hosts and paths equal,
 *                           differing params: _nc_gid, _nc_tpa, oh
 *   nested   (13 groups) — assetMetadata.object_story_spec.video_data.image_url
 *                           only, hosts and paths equal, differing param: d
 *
 * No semantic field difference was observed in either census, and the nested
 * census was exhaustive. This module therefore compares two normalised creatives
 * with those four parameters — and ONLY those four — canonicalised away.
 *
 * SCOPE CONTRACT (enforced by tests/boundaries/metaScriptsReadOnly.test.ts):
 * this module is imported by the sync orchestrator and its own test file, and
 * nowhere else. It is a COMPARISON aid only:
 *   - `normalizeCreative` is untouched, so stored values keep every parameter;
 *   - `dedupeStrict` is untouched, so it still fails loud on real conflicts and
 *     still retains the FIRST original creative object with its original urls;
 *   - the fingerprint is transient — never logged, never persisted, never
 *     returned to a caller.
 */
import { deepEqual } from './dedupe.ts'
import type { NormalizedCreative } from '../types/index.ts'

/**
 * The ONLY query parameters this comparator may ignore. Each was proven volatile
 * by the Phase C.1 live census; nothing is matched by wildcard or prefix, so a
 * parameter absent from this list — including one that merely looks like CDN
 * churn — is always compared. Adding an entry requires new live evidence.
 */
export const VOLATILE_URL_PARAMS: readonly string[] = [
  '_nc_gid',
  '_nc_tpa',
  'oh',
  'd',
]

/** JSON-shaped object: a `{}` literal, as produced by parsing a Meta response. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Canonicalise ONE url string for comparison: drop the proven-volatile params
 * and sort the rest, so parameter order alone is not a difference.
 *
 * Anything that is not an http(s) url — a non-url string, an id, free text, an
 * `ftp:`/`mailto:` url, a malformed url-like string — is returned byte-identical.
 * Host, path and every non-volatile parameter survive, so a real difference in
 * any of them still compares unequal.
 */
export function canonicalizeUrlForComparison(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return value
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return value
  for (const param of VOLATILE_URL_PARAMS) url.searchParams.delete(param)
  url.searchParams.sort()
  return url.toString()
}

/** A url-shaped string canonicalised; every other value returned as-is. */
function canonicalizeIfUrl(value: unknown): unknown {
  return typeof value === 'string' ? canonicalizeUrlForComparison(value) : value
}

/**
 * Recursively canonicalise the url-shaped strings inside `assetMetadata`.
 *
 * Only strings that parse as http(s) urls are transformed. Ids, text, CTA
 * values, numbers, booleans and null pass through untouched; object keys and
 * array order and length are preserved; the input is never mutated.
 */
export function canonicalizeAssetMetadataForComparison(
  value: unknown,
): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeAssetMetadataForComparison)
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      out[key] = canonicalizeAssetMetadataForComparison(value[key])
    }
    return out
  }
  return canonicalizeIfUrl(value)
}

/**
 * The transient comparison view of a creative: identical to the input except
 * that url churn is canonicalised away. Never stored, never logged — it exists
 * only for the length of one `creativeSemanticEquals` call.
 */
function fingerprint(creative: NormalizedCreative): NormalizedCreative {
  return {
    ...creative,
    imageUrl:
      creative.imageUrl === null
        ? null
        : canonicalizeUrlForComparison(creative.imageUrl),
    thumbnailUrl:
      creative.thumbnailUrl === null
        ? null
        : canonicalizeUrlForComparison(creative.thumbnailUrl),
    assetMetadata: canonicalizeAssetMetadataForComparison(
      creative.assetMetadata,
    ),
  }
}

/**
 * True when two representations of one creative id describe the same creative,
 * ignoring only the four proven-volatile url parameters.
 *
 * Every other difference — host, path, any non-volatile parameter or its value,
 * primaryText, headline, description, ctaType, objectType, videoId,
 * destinationUrl, any non-url `assetMetadata` value, object structure, array
 * order or length — remains a conflict.
 */
export function creativeSemanticEquals(
  a: NormalizedCreative,
  b: NormalizedCreative,
): boolean {
  return deepEqual(fingerprint(a), fingerprint(b))
}
