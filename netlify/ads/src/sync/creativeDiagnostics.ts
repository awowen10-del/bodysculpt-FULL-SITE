/**
 * Phase A creative-conflict DIAGNOSTIC (pure, offline, read-only).
 *
 * Stage 8's first live dry-run failed with `CONFLICTING_DUPLICATE` for one Meta
 * creative key: two different ads expanded the same creative id inline, and the
 * normalised representations were not deep-equal. This module answers ONE
 * question — WHICH internal fields differ, and roughly what shape they are — so
 * the fix can be chosen from evidence rather than guesswork.
 *
 * SAFETY CONTRACT (enforced by tests/sync/creativeDiagnostics.test.ts):
 * the report is structure ONLY. It never carries creative/ad/account/campaign/
 * ad-set ids, names, body text, headlines, urls, hosts, paths, query-parameter
 * VALUES, nested values, raw payloads, headers, tokens, or trace ids. Only
 * internal field names, Meta's own fixed schema key names, broad shapes, string
 * length buckets, url path/host EQUALITY booleans, and differing query-parameter
 * NAMES ever leave this module.
 *
 * It observes only. It changes no conflict behaviour: `dedupeStrict` and
 * `normalizeCreative` are untouched, and nothing here is on the sync write path.
 */
import { deepEqual } from './dedupe.ts'
import { describeValueShape, type BroadShape } from '../meta/graphClient.ts'
import type { NormalizedCreative } from '../types/index.ts'

/** Broad shape, plus the `''` vs `null` distinction `describeValueShape` folds away. */
export type DiffShape = BroadShape | 'empty-string'

/** Coarse string size — never the string, never a substring. */
export type LengthBucket = '0' | '1-32' | '33-128' | '129-512' | '513+'

export type Classification =
  | 'likely-representational'
  | 'candidate-semantic'
  | 'requires-nested-inspection'

export interface FieldDifference {
  /** Internal field name, or `assetMetadata.<meta-schema-key>`. Never a value. */
  field: string
  shapeA: DiffShape
  shapeB: DiffShape
  lengthBucketA?: LengthBucket
  lengthBucketB?: LengthBucket
  /** True only when BOTH sides parse as http(s) urls. */
  bothUrls: boolean
  /** Path EQUALITY only — the paths themselves are never reported. */
  urlPathsMatch?: boolean
  /** Host EQUALITY only — the hosts themselves are never reported. */
  urlHostsMatch?: boolean
  /** Parameter NAMES whose values differ. Values are never reported. */
  differingQueryParamNames?: string[]
  classification: Classification
}

export interface ConflictGroup {
  /** How many distinct representations of one creative id were seen. */
  representationCount: number
  differences: FieldDifference[]
}

export interface CreativeConflictReport {
  creativesTotal: number
  distinctCreativeIds: number
  conflictingGroups: number
  /** One entry per conflicting id. The id itself is never included. */
  groups: ConflictGroup[]
}

/**
 * Scalar creative fields compared field-by-field. `assetMetadata` is handled
 * separately (nested, key-level only) and `metaCreativeId` is the grouping key.
 *
 * NOTE: `description` is included for completeness but cannot differ in
 * practice — it is never requested (see AD_CREATIVE_SUBFIELDS in
 * src/meta/fields.ts), so it normalises to null on every ad.
 */
const COMPARED_SCALAR_FIELDS = [
  'objectType',
  'primaryText',
  'headline',
  'description',
  'ctaType',
  'destinationUrl',
  'imageUrl',
  'thumbnailUrl',
  'videoId',
] as const satisfies readonly (keyof NormalizedCreative)[]

/** Meta schema keys are structural names; anything unexpected is not echoed. */
const SAFE_KEY_RE = /^[A-Za-z0-9_.-]{1,40}$/
const UNSAFE_KEY_PLACEHOLDER = '<non-standard-key-name>'
const MAX_REPORTED_PARAM_NAMES = 12

/** Echo a key/param NAME only when it is a plain structural identifier. */
function safeKeyName(name: string): string {
  return SAFE_KEY_RE.test(name) ? name : UNSAFE_KEY_PLACEHOLDER
}

function lengthBucket(length: number): LengthBucket {
  if (length === 0) return '0'
  if (length <= 32) return '1-32'
  if (length <= 128) return '33-128'
  if (length <= 512) return '129-512'
  return '513+'
}

function diffShape(value: unknown): DiffShape {
  if (value === '') return 'empty-string'
  return describeValueShape(value)
}

/** Absent, null, or an empty/whitespace-only string — i.e. "no content". */
function isEmptyish(value: unknown): boolean {
  if (value === undefined || value === null) return true
  return typeof value === 'string' && value.trim() === ''
}

function isNested(value: unknown): boolean {
  return typeof value === 'object' && value !== null
}

/** An http(s) URL, or null. The URL is used for comparison only, never reported. */
function asUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value === '') return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/** Names of params present on one side only, or whose values differ. NAMES only. */
function differingQueryParamNames(a: URL, b: URL): string[] {
  const names = new Set([...a.searchParams.keys(), ...b.searchParams.keys()])
  const differing = new Set<string>()
  for (const name of names) {
    const av = a.searchParams.getAll(name).join('\x00')
    const bv = b.searchParams.getAll(name).join('\x00')
    if (av !== bv) differing.add(safeKeyName(name))
  }
  return [...differing].sort().slice(0, MAX_REPORTED_PARAM_NAMES)
}

function classify(
  a: unknown,
  b: unknown,
  urls: { a: URL; b: URL } | null,
): Classification {
  // One (or both) sides carry no content: missing / null / "" are equivalent-ish
  // representations of absence, not a semantic disagreement.
  if (isEmptyish(a) || isEmptyish(b)) return 'likely-representational'
  if (isNested(a) || isNested(b)) return 'requires-nested-inspection'
  if (urls !== null) {
    // Same asset path => the difference lives in the signed/cache params or the
    // CDN host, both of which Meta re-mints per response.
    return urls.a.pathname === urls.b.pathname
      ? 'likely-representational'
      : 'candidate-semantic'
  }
  return 'candidate-semantic'
}

function describeDifference(
  field: string,
  a: unknown,
  b: unknown,
): FieldDifference {
  const urlA = asUrl(a)
  const urlB = asUrl(b)
  const urls = urlA !== null && urlB !== null ? { a: urlA, b: urlB } : null

  const diff: FieldDifference = {
    field,
    shapeA: diffShape(a),
    shapeB: diffShape(b),
    bothUrls: urls !== null,
    classification: classify(a, b, urls),
  }
  if (typeof a === 'string') diff.lengthBucketA = lengthBucket(a.length)
  if (typeof b === 'string') diff.lengthBucketB = lengthBucket(b.length)
  if (urls !== null) {
    diff.urlPathsMatch = urls.a.pathname === urls.b.pathname
    diff.urlHostsMatch = urls.a.host === urls.b.host
    diff.differingQueryParamNames = differingQueryParamNames(urls.a, urls.b)
  }
  return diff
}

/**
 * Compare `assetMetadata` at TOP-LEVEL KEY granularity only (e.g.
 * `object_story_spec`, `asset_feed_spec`). Phase A never recurses into the
 * nested objects, so no nested value can reach the report; a differing key is
 * reported as `requires-nested-inspection` for a later, separately-approved pass.
 */
function describeAssetMetadataDifferences(
  a: unknown,
  b: unknown,
): FieldDifference[] {
  if (!isNested(a) || !isNested(b)) {
    return [describeDifference('assetMetadata', a, b)]
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const keys = [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort()
  const out: FieldDifference[] = []
  for (const key of keys) {
    if (deepEqual(ao[key], bo[key])) continue
    const nested = describeDifference(
      `assetMetadata.${safeKeyName(key)}`,
      ao[key],
      bo[key],
    )
    // Both sides nested => key-level only; never recurse in Phase A.
    if (isNested(ao[key]) && isNested(bo[key])) {
      nested.classification = 'requires-nested-inspection'
    }
    out.push(nested)
  }
  return out
}

function describeRepresentationDifferences(
  a: NormalizedCreative,
  b: NormalizedCreative,
): FieldDifference[] {
  const out: FieldDifference[] = []
  for (const field of COMPARED_SCALAR_FIELDS) {
    if (deepEqual(a[field], b[field])) continue
    out.push(describeDifference(field, a[field], b[field]))
  }
  if (!deepEqual(a.assetMetadata, b.assetMetadata)) {
    out.push(
      ...describeAssetMetadataDifferences(a.assetMetadata, b.assetMetadata),
    )
  }
  return out
}

/**
 * Group normalised creatives by Meta creative id and describe, for every id with
 * more than one distinct representation, exactly which fields disagree.
 *
 * Pure: no network, no database, no env, no clock. The input is never mutated
 * and no part of it is copied into the output.
 */
export function describeCreativeConflicts(
  creatives: readonly NormalizedCreative[],
): CreativeConflictReport {
  const byId = new Map<string, NormalizedCreative[]>()
  for (const creative of creatives) {
    const bucket = byId.get(creative.metaCreativeId)
    if (bucket === undefined) byId.set(creative.metaCreativeId, [creative])
    else bucket.push(creative)
  }

  const groups: ConflictGroup[] = []
  for (const representations of byId.values()) {
    // Collapse exact duplicates the way dedupeStrict would; only genuinely
    // distinct representations of one id are a conflict.
    const distinct: NormalizedCreative[] = []
    for (const rep of representations) {
      if (!distinct.some((seen) => deepEqual(seen, rep))) distinct.push(rep)
    }
    if (distinct.length < 2) continue

    // Compare the first representation against every other, then merge by field
    // so one field is reported once per group.
    const byField = new Map<string, FieldDifference>()
    for (let i = 1; i < distinct.length; i++) {
      for (const diff of describeRepresentationDifferences(
        distinct[0],
        distinct[i],
      )) {
        if (!byField.has(diff.field)) byField.set(diff.field, diff)
      }
    }
    groups.push({
      representationCount: distinct.length,
      differences: [...byField.values()].sort((x, y) =>
        x.field.localeCompare(y.field),
      ),
    })
  }

  return {
    creativesTotal: creatives.length,
    distinctCreativeIds: byId.size,
    conflictingGroups: groups.length,
    groups,
  }
}

/**
 * Render the report as plain text. Every token in the output is either a fixed
 * label, a count, or a value that already passed the structural filters above.
 */
export function formatCreativeConflictReport(
  report: CreativeConflictReport,
): string {
  const lines: string[] = [
    'CREATIVE CONFLICT DIAGNOSTIC  (read-only · no database · no insights)',
    '',
    `creatives normalised:     ${report.creativesTotal}`,
    `distinct creative ids:    ${report.distinctCreativeIds}`,
    `conflicting id groups:    ${report.conflictingGroups}`,
    '',
  ]

  if (report.groups.length === 0) {
    lines.push('No conflicting creative representations in this fetch.')
    return lines.join('\n')
  }

  report.groups.forEach((group, index) => {
    lines.push(
      `group ${index + 1} of ${report.groups.length} — ${group.representationCount} representations of one creative id`,
      '',
    )
    for (const diff of group.differences) {
      lines.push(`  field: ${diff.field}`)
      lines.push(
        `    shape:          ${diff.shapeA} / ${diff.shapeB}${
          diff.bothUrls ? '        (both parse as URLs)' : ''
        }`,
      )
      if (
        diff.lengthBucketA !== undefined ||
        diff.lengthBucketB !== undefined
      ) {
        lines.push(
          `    length bucket:  ${diff.lengthBucketA ?? 'n/a'} / ${diff.lengthBucketB ?? 'n/a'}`,
        )
      }
      if (diff.bothUrls) {
        lines.push(
          `    url paths:      ${diff.urlPathsMatch === true ? 'match' : 'differ'}`,
        )
        lines.push(
          `    url hosts:      ${diff.urlHostsMatch === true ? 'match' : 'differ'}`,
        )
        const names = diff.differingQueryParamNames ?? []
        lines.push(
          `    differing query param names: ${names.length > 0 ? names.join(', ') : '(none)'}`,
        )
      } else {
        lines.push('    both urls:      no')
      }
      lines.push(`    classification: ${diff.classification}`)
      lines.push('')
    }
  })

  lines.push('Values are never printed — field names, shapes and buckets only.')
  return lines.join('\n')
}
