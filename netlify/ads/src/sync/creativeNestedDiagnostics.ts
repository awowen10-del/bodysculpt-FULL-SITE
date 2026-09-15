/**
 * Phase C.1 nested creative DIAGNOSTIC (pure, offline, read-only).
 *
 * Phase B proved, over 800 representations / 741 distinct ids / 28 conflicting
 * groups, that every TOP-LEVEL imageUrl/thumbnailUrl conflict is CDN-signature
 * churn: string vs string, both valid urls, same host, same path, differing only
 * in temporary query params. It also reported `assetMetadata.object_story_spec`
 * conflicts (object vs object) that Phase A deliberately refused to open.
 *
 * This module answers ONE question, for that ONE key: WHICH nested paths differ,
 * and are those differences the same url churn or something semantic? Its output
 * is the evidence that decides Phase C.2's scope. It does NOT decide anything
 * itself.
 *
 * SAFETY CONTRACT (enforced by tests/sync/creativeNestedDiagnostics.test.ts):
 * the report is structure ONLY. It carries allowlisted structural path segments,
 * array indices, broad shapes, url-shaped booleans, host/path EQUALITY booleans,
 * differing query-parameter NAMES, counts, and truncation booleans. It never
 * carries ids, dynamic object keys, text, cta values, urls, hosts, paths, query
 * VALUES, names, raw JSON, headers, or tokens.
 *
 * KEY-NAME SAFETY — the reason this is not Phase A's filter: Phase A only ever
 * echoed TOP-LEVEL assetMetadata keys (object_story_spec / asset_feed_spec), so
 * its `SAFE_KEY_RE` (/^[A-Za-z0-9_.-]{1,40}$/) was sufficient. Nested, that regex
 * is NOT safe — a dynamic key such as an id-keyed map ("120210000000012345") or
 * an image_crops aspect-ratio key ("100x100") passes it and would print account
 * data straight into the report. Nested keys are therefore ALLOWLISTED against
 * the official v25.0 Graph API references; anything else degrades to
 * `<unknown-key>`. An incomplete allowlist can only cost resolution, never leak.
 *
 * TRUNCATION IS LOUD, NEVER SILENT: hitting the depth cap, the per-group
 * difference cap, or the per-difference parameter-name cap sets `truncated` on
 * the group and `anyGroupTruncated` on the report. Incomplete evidence must
 * block the Phase C.2 semantic fix rather than quietly under-report the census
 * that C.2's volatile-parameter list would be built from.
 *
 * It observes only. `dedupeStrict`, `normalizeCreative` and the orchestrator are
 * untouched, and nothing here is on the sync write path.
 */
import { deepEqual } from './dedupe.ts'
import { describeValueShape, type BroadShape } from '../meta/graphClient.ts'
import type { NormalizedCreative } from '../types/index.ts'

/** Broad shape, plus the `''` vs `null` distinction `describeValueShape` folds away. */
export type NestedShape = BroadShape | 'empty-string'

export interface NestedFieldDifference {
  /** Structural path below assetMetadata. Allowlisted segments + array indices. */
  path: string
  shapeA: NestedShape
  shapeB: NestedShape
  /** True only when BOTH sides parse as http(s) urls. */
  bothUrls: boolean
  /** Host EQUALITY only — the hosts themselves are never reported. */
  urlHostsMatch?: boolean
  /** Path EQUALITY only — the paths themselves are never reported. */
  urlPathsMatch?: boolean
  /** Parameter NAMES whose values differ. Values are never reported. */
  differingQueryParamNames?: string[]
}

export interface NestedConflictGroup {
  /** How many distinct object_story_spec values one creative id presented. */
  representationCount: number
  differences: NestedFieldDifference[]
  /** True when a cap was hit; this group's differences may be incomplete. */
  truncated: boolean
}

export interface NestedCreativeConflictReport {
  creativesTotal: number
  distinctCreativeIds: number
  /** Ids whose object_story_spec disagrees. Conflicts elsewhere are not counted. */
  groupsWithObjectStorySpecConflict: number
  /** One entry per conflicting id. The id itself is never included. */
  groups: NestedConflictGroup[]
  /**
   * Every differing query-param NAME seen at any nested depth, across all groups.
   * This is what closes Phase C.2's volatile-parameter list: the Phase B summary
   * said params "such as" _nc_gid/_nc_tpa/oh, which is not an exhaustive basis.
   */
  differingQueryParamNameCensus: string[]
  /** Distinct reported paths containing `<unknown-key>`; a resolution gap only. */
  unknownKeyPathCount: number
  /** True if ANY group truncated — the census is then incomplete and C.2 is blocked. */
  anyGroupTruncated: boolean
}

/**
 * Documented nested key names, verified against the official Meta Graph API
 * v25.0 references on 2026-07-15. Drafted-from-memory names were WRONG and have
 * been corrected: `instagram_actor_id` is not in the v25.0 spec, the link_data
 * field is `app_link_spec` (not `app_link`), it is `retailer_item_ids` (not
 * `retailer_item_id`), and `product_data` was missing entirely.
 *
 * Sources (all v25.0, developers.facebook.com/docs/marketing-api/reference/):
 *   ad-creative-object-story-spec/       AdCreativeObjectStorySpec
 *   ad-creative-link-data/               AdCreativeLinkData
 *   ad-creative-video-data/              AdCreativeVideoData
 *   ad-creative-photo-data/              AdCreativePhotoData
 *   ad-creative-text-data/               AdCreativeTextData
 *   ad-creative-link-data-call-to-action/        ...CallToAction
 *   ad-creative-link-data-call-to-action-value/  ...CallToActionValue
 *   ad-creative-link-data-child-attachment/      ...ChildAttachment
 *   ad-creative-link-data-app-link-spec/         ...AppLinkSpec
 *
 * `template_data` needs no separate source: the object-story-spec reference
 * declares its type as AdCreativeLinkData, so it reuses link_data's key set.
 *
 * KNOWN RESOLUTION GAP: `product_data` is declared `list<AdCreativeProductData>`
 * but that reference page 404s on both the marketing-api and graph-api paths, so
 * its children resolve to `<unknown-key>`. Safe, just lower resolution.
 *
 * This is a FLAT union, deliberately: the allowlist is a leak guard, and the
 * only question it must answer is "is this a documented Meta schema name
 * anywhere under object_story_spec?". A documented schema name is never itself
 * sensitive, so position does not affect safety.
 */
const OBJECT_STORY_SPEC_KEYS: ReadonlySet<string> = new Set([
  // --- AdCreativeObjectStorySpec ---
  'instagram_user_id',
  'link_data',
  'page_id',
  'photo_data',
  'product_data',
  'template_data',
  'text_data',
  'video_data',
  // --- AdCreativeLinkData (covers link_data AND template_data) ---
  'ad_context',
  'additional_image_index',
  'app_link_spec',
  'attachment_style',
  'boosted_product_set_id',
  'branded_content_shared_to_sponsor_status',
  'branded_content_sponsor_page_id',
  'branded_content_sponsor_relationship',
  'call_to_action',
  'caption',
  'child_attachments',
  'collection_thumbnails',
  'customization_rules_spec',
  'description',
  'event_id',
  'force_single_link',
  'format_option',
  'image_crops',
  'image_hash',
  'image_layer_specs',
  'image_overlay_spec',
  'link',
  'message',
  'multi_share_end_card',
  'multi_share_optimized',
  'name',
  'offer_id',
  'page_welcome_message',
  'picture',
  'post_click_configuration',
  'preferred_image_tags',
  'preferred_video_tags',
  'retailer_item_ids',
  'show_multiple_images',
  'sponsorship_info',
  'static_fallback_spec',
  'use_flexible_image_aspect_ratio',
  // --- AdCreativeVideoData (keys not already listed) ---
  'caption_ids',
  'image_url',
  'link_description',
  'targeting',
  'title',
  'video_id',
  // --- AdCreativePhotoData (keys not already listed; photo uses `url`) ---
  'url',
  // --- AdCreativeTextData: `message`, already listed ---
  // --- AdCreativeLinkDataCallToAction ---
  'type',
  'value',
  // --- AdCreativeLinkDataCallToActionValue (keys not already listed) ---
  'app_destination',
  'app_link',
  'application',
  'lead_gen_form_id',
  'link_caption',
  'link_format',
  'page',
  'product_link',
  // --- AdCreativeLinkDataChildAttachment (keys not already listed) ---
  'referral_id',
  'static_card',
  // --- AdCreativeLinkDataAppLinkSpec ---
  'android',
  'ios',
  'ipad',
  'iphone',
])

const UNKNOWN_KEY_PLACEHOLDER = '<unknown-key>'
const ROOT_PATH = 'assetMetadata.object_story_spec'

/**
 * Deepest documented real path is
 * object_story_spec.link_data.child_attachments[N].call_to_action.value.link
 * — six segments below the root. Eight leaves headroom without unbounded walks.
 */
const MAX_DEPTH = 8
const MAX_DIFFERENCES_PER_GROUP = 40
const MAX_REPORTED_PARAM_NAMES = 12

/** Param names are structural; anything non-structural is not echoed. */
const SAFE_PARAM_RE = /^[A-Za-z0-9_.-]{1,40}$/
const UNSAFE_PARAM_PLACEHOLDER = '<non-standard-param-name>'

/** Echo a nested key ONLY if it is a documented Meta schema key. */
function safeSegment(key: string): string {
  return OBJECT_STORY_SPEC_KEYS.has(key) ? key : UNKNOWN_KEY_PLACEHOLDER
}

function safeParamName(name: string): string {
  return SAFE_PARAM_RE.test(name) ? name : UNSAFE_PARAM_PLACEHOLDER
}

function nestedShape(value: unknown): NestedShape {
  if (value === '') return 'empty-string'
  return describeValueShape(value)
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An http(s) URL, or null. Used for comparison only, never reported. */
function asUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value === '') return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/**
 * NAMES of params present on one side only, or whose values differ.
 *
 * `truncated` matters: the census that Phase C.2's ignore list is built from is
 * assembled from these names, so a silently sliced list would mean an ignore
 * list built on partial evidence. Hitting the cap therefore truncates the group.
 */
function differingQueryParamNames(
  a: URL,
  b: URL,
): { names: string[]; truncated: boolean } {
  const names = new Set([...a.searchParams.keys(), ...b.searchParams.keys()])
  const differing = new Set<string>()
  for (const name of names) {
    const av = a.searchParams.getAll(name).join('\x00')
    const bv = b.searchParams.getAll(name).join('\x00')
    if (av !== bv) differing.add(safeParamName(name))
  }
  const sorted = [...differing].sort()
  return {
    names: sorted.slice(0, MAX_REPORTED_PARAM_NAMES),
    truncated: sorted.length > MAX_REPORTED_PARAM_NAMES,
  }
}

interface WalkContext {
  out: NestedFieldDifference[]
  truncated: boolean
}

function describeLeaf(
  path: string,
  a: unknown,
  b: unknown,
  ctx: WalkContext,
): NestedFieldDifference {
  const urlA = asUrl(a)
  const urlB = asUrl(b)
  const diff: NestedFieldDifference = {
    path,
    shapeA: nestedShape(a),
    shapeB: nestedShape(b),
    bothUrls: urlA !== null && urlB !== null,
  }
  if (urlA !== null && urlB !== null) {
    diff.urlHostsMatch = urlA.host === urlB.host
    diff.urlPathsMatch = urlA.pathname === urlB.pathname
    const params = differingQueryParamNames(urlA, urlB)
    diff.differingQueryParamNames = params.names
    if (params.truncated) ctx.truncated = true
  }
  return diff
}

function walk(
  path: string,
  a: unknown,
  b: unknown,
  depth: number,
  ctx: WalkContext,
): void {
  if (deepEqual(a, b)) return
  if (ctx.out.length >= MAX_DIFFERENCES_PER_GROUP) {
    ctx.truncated = true
    return
  }
  if (depth >= MAX_DEPTH) {
    ctx.truncated = true
    ctx.out.push(describeLeaf(path, a, b, ctx))
    return
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const keys = [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort()
    for (const key of keys) {
      walk(`${path}.${safeSegment(key)}`, ao[key], bo[key], depth + 1, ctx)
    }
    return
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    for (let i = 0; i < a.length; i++) {
      walk(`${path}[${i}]`, a[i], b[i], depth + 1, ctx)
    }
    return
  }
  // Scalars, mismatched shapes, or arrays of differing length: describe the
  // difference at this path and stop. Recursing into arrays of differing length
  // would compare unrelated positions and report noise.
  ctx.out.push(describeLeaf(path, a, b, ctx))
}

function objectStorySpecOf(creative: NormalizedCreative): unknown {
  const meta = creative.assetMetadata
  if (!isPlainObject(meta)) return undefined
  return (meta as Record<string, unknown>).object_story_spec
}

/**
 * Group normalised creatives by Meta creative id and, for every id whose
 * `object_story_spec` disagrees across representations, describe exactly which
 * nested paths differ and whether those differences are url churn.
 *
 * Pure: no network, no database, no env, no clock. The input is never mutated
 * and no part of it is copied into the output.
 */
export function describeNestedCreativeConflicts(
  creatives: readonly NormalizedCreative[],
): NestedCreativeConflictReport {
  const byId = new Map<string, NormalizedCreative[]>()
  for (const creative of creatives) {
    const bucket = byId.get(creative.metaCreativeId)
    if (bucket === undefined) byId.set(creative.metaCreativeId, [creative])
    else bucket.push(creative)
  }

  const groups: NestedConflictGroup[] = []
  const census = new Set<string>()
  const unknownKeyPaths = new Set<string>()
  let anyGroupTruncated = false

  for (const representations of byId.values()) {
    // Collapse exact-equal specs the way dedupeStrict would; only genuinely
    // distinct object_story_spec values are a conflict worth walking.
    const distinct: unknown[] = []
    for (const rep of representations) {
      const spec = objectStorySpecOf(rep)
      if (!distinct.some((seen) => deepEqual(seen, spec))) distinct.push(spec)
    }
    if (distinct.length < 2) continue

    // Compare the first spec against every other. The cap is cumulative across
    // pairs, so it bounds the group rather than each pair.
    const ctx: WalkContext = { out: [], truncated: false }
    for (let i = 1; i < distinct.length; i++) {
      walk(ROOT_PATH, distinct[0], distinct[i], 0, ctx)
    }

    // Merge by path so one path is reported once per group.
    const byPath = new Map<string, NestedFieldDifference>()
    for (const diff of ctx.out) {
      if (!byPath.has(diff.path)) byPath.set(diff.path, diff)
      for (const name of diff.differingQueryParamNames ?? []) census.add(name)
      if (diff.path.includes(UNKNOWN_KEY_PLACEHOLDER)) {
        unknownKeyPaths.add(diff.path)
      }
    }

    if (ctx.truncated) anyGroupTruncated = true
    groups.push({
      representationCount: distinct.length,
      truncated: ctx.truncated,
      differences: [...byPath.values()].sort((x, y) =>
        x.path.localeCompare(y.path),
      ),
    })
  }

  return {
    creativesTotal: creatives.length,
    distinctCreativeIds: byId.size,
    groupsWithObjectStorySpecConflict: groups.length,
    groups,
    differingQueryParamNameCensus: [...census].sort(),
    unknownKeyPathCount: unknownKeyPaths.size,
    anyGroupTruncated,
  }
}

/**
 * Render the report as plain text. Every token in the output is either a fixed
 * label, a count, or a value that already passed the structural filters above.
 */
export function formatNestedCreativeConflictReport(
  report: NestedCreativeConflictReport,
): string {
  const lines: string[] = [
    'NESTED CREATIVE DIAGNOSTIC — object_story_spec ONLY  (read-only · no database · no insights)',
    '',
    `creatives normalised:        ${report.creativesTotal}`,
    `distinct creative ids:       ${report.distinctCreativeIds}`,
    `groups w/ spec conflict:     ${report.groupsWithObjectStorySpecConflict}`,
    '',
  ]

  if (report.groups.length === 0) {
    lines.push('No object_story_spec disagreements in this fetch.')
    return lines.join('\n')
  }

  report.groups.forEach((group, index) => {
    lines.push(
      `group ${index + 1} of ${report.groups.length} — ${group.representationCount} distinct specs for one creative id${
        group.truncated ? '   (TRUNCATED — a cap was hit)' : ''
      }`,
      '',
    )
    for (const diff of group.differences) {
      lines.push(`  path: ${diff.path}`)
      lines.push(
        `    shape:      ${diff.shapeA} / ${diff.shapeB}${
          diff.bothUrls ? '        (both parse as URLs)' : ''
        }`,
      )
      if (diff.bothUrls) {
        lines.push(
          `    url hosts:  ${diff.urlHostsMatch === true ? 'match' : 'differ'}`,
        )
        lines.push(
          `    url paths:  ${diff.urlPathsMatch === true ? 'match' : 'differ'}`,
        )
        const names = diff.differingQueryParamNames ?? []
        lines.push(
          `    differing query param names: ${names.length > 0 ? names.join(', ') : '(none)'}`,
        )
      } else {
        lines.push('    both urls:  no')
      }
      lines.push('')
    }
  })

  lines.push(
    'differing query param name census (nested, all groups):',
    `  ${report.differingQueryParamNameCensus.join(', ') || '(none)'}`,
    '',
  )

  if (report.unknownKeyPathCount > 0) {
    lines.push(
      `resolution note: ${report.unknownKeyPathCount} reported path(s) contain ${UNKNOWN_KEY_PLACEHOLDER}.`,
      '  Those keys are dynamic or undocumented and are withheld by design.',
      '',
    )
  }

  lines.push(
    report.anyGroupTruncated
      ? 'VERDICT: EVIDENCE INCOMPLETE — a group truncated, so the param census may be\n' +
          '         partial. Phase C.2 (semantic fingerprint) stays BLOCKED until the\n' +
          '         caps are raised and this run is repeated cleanly.'
      : 'VERDICT: evidence complete — no group truncated, so the param census above is\n' +
          '         exhaustive for the nested url differences observed in this fetch.',
    '',
    'Values are never printed — paths, shapes, counts and param names only.',
  )
  return lines.join('\n')
}
