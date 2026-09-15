/**
 * Deterministic resolution of a creative's PREVIEW, COPY and LINK from the stored
 * Meta structures (Phase 0.2).
 *
 * Real inline-expanded creatives keep the actual ad asset and copy NESTED inside
 * `object_story_spec` (link_data / video_data / photo_data) and `asset_feed_spec`,
 * not at the top level. All of that is already stored (in `creatives.asset_metadata`
 * plus the top-level columns), so this module reads it out at DTO time — read-only,
 * no re-sync. Every accessor is defensive: an unexpected shape yields null, never a
 * throw, and missing vs empty both resolve to null (the UI renders "—").
 *
 * It NEVER guesses: the preview it returns is tagged with the SOURCE it came from,
 * so a weak page/profile image is never silently presented as the ad's real asset.
 */
import type { NormalizedCreative } from '../types/index.ts'

/** Where a resolved preview came from — strongest (real asset) to weakest. */
export type PreviewSource =
  | 'image_asset' // the actual image the ad uses (link/photo data)
  | 'video_thumbnail' // the actual video's poster/thumbnail
  | 'asset_feed' // a dynamic-creative asset-feed image/video thumbnail
  | 'creative_thumbnail' // Meta's generated thumbnail of the creative
  | 'page_profile_fallback' // a weak fallback (may be the page/profile image)
  | 'unavailable' // nothing usable

// --- defensive nested accessors --------------------------------------------

/** The value at `key` if it is a plain (non-array) object, else null. */
export function objectAt(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const inner = (value as Record<string, unknown>)[key]
  return inner !== null && typeof inner === 'object' && !Array.isArray(inner)
    ? (inner as Record<string, unknown>)
    : null
}

/** A non-empty string at `key`, else null (missing and empty both → null). */
export function stringAt(
  obj: Record<string, unknown> | null,
  key: string,
): string | null {
  if (obj === null) return null
  const value = obj[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** The first plain-object element of the array at `key`, else null. */
export function firstObjectAt(
  obj: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  if (obj === null) return null
  const arr = obj[key]
  if (!Array.isArray(arr)) return null
  const first = arr.find(
    (x) => x !== null && typeof x === 'object' && !Array.isArray(x),
  )
  return (first as Record<string, unknown> | undefined) ?? null
}

/** The `.text` of the first object in `key[]` (Meta bodies/titles/descriptions). */
function firstText(
  obj: Record<string, unknown> | null,
  key: string,
): string | null {
  return stringAt(firstObjectAt(obj, key), 'text')
}

// --- preview ----------------------------------------------------------------

export interface ResolvedPreview {
  /** The best available preview URL for the ACTUAL ad asset, or null. */
  previewUrl: string | null
  /** The Meta video id (top-level or nested), or null. */
  videoId: string | null
  /** Which source the preview came from (for diagnostics + a weak-fallback badge). */
  source: PreviewSource
}

/**
 * Resolve the preview that best represents the actual ad asset, in the required
 * order: real image asset → real video thumbnail → asset-feed asset → creative
 * thumbnail → page/profile image (weak) → unavailable.
 */
export function resolveCreativePreview(
  creative: NormalizedCreative,
): ResolvedPreview {
  const oss = objectAt(creative.assetMetadata, 'object_story_spec')
  const afs = objectAt(creative.assetMetadata, 'asset_feed_spec')
  const linkData = objectAt(oss, 'link_data')
  const videoData = objectAt(oss, 'video_data')
  const photoData = objectAt(oss, 'photo_data')
  const feedVideo = firstObjectAt(afs, 'videos')
  const feedImage = firstObjectAt(afs, 'images')

  const videoId =
    creative.videoId ??
    stringAt(videoData, 'video_id') ??
    stringAt(feedVideo, 'video_id')

  // Ordered strongest → weakest; the first hit wins and carries its source.
  const candidates: Array<[string | null, PreviewSource]> = [
    [stringAt(linkData, 'picture'), 'image_asset'],
    [
      stringAt(photoData, 'url') ?? stringAt(photoData, 'image_url'),
      'image_asset',
    ],
    [stringAt(videoData, 'image_url'), 'video_thumbnail'],
    [stringAt(feedVideo, 'thumbnail_url'), 'asset_feed'],
    [stringAt(feedImage, 'url'), 'asset_feed'],
    [creative.thumbnailUrl, 'creative_thumbnail'],
    [creative.imageUrl, 'page_profile_fallback'],
  ]
  for (const [url, source] of candidates) {
    if (url !== null) return { previewUrl: url, videoId, source }
  }
  return { previewUrl: null, videoId, source: 'unavailable' }
}

// --- copy + link ------------------------------------------------------------

export interface ResolvedCopy {
  primaryText: string | null
  headline: string | null
  description: string | null
  ctaType: string | null
  /** The ad's destination URL (from link_data / asset feed), or null. */
  linkUrl: string | null
  /** The host of `linkUrl` (e.g. "bodysculptwarrington.com"), or null. */
  linkDomain: string | null
}

/** The `.type` of a `call_to_action` object at `key`, else null. */
function ctaTypeAt(obj: Record<string, unknown> | null): string | null {
  return stringAt(objectAt(obj, 'call_to_action'), 'type')
}

function hostOf(url: string | null): string | null {
  if (url === null) return null
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}

/**
 * Resolve the ad's copy + destination, preferring the top-level column and
 * falling back through link_data / video_data / asset_feed_spec.
 */
export function resolveCreativeCopy(
  creative: NormalizedCreative,
): ResolvedCopy {
  const oss = objectAt(creative.assetMetadata, 'object_story_spec')
  const afs = objectAt(creative.assetMetadata, 'asset_feed_spec')
  const linkData = objectAt(oss, 'link_data')
  const videoData = objectAt(oss, 'video_data')

  const primaryText =
    creative.primaryText ??
    stringAt(linkData, 'message') ??
    stringAt(videoData, 'message') ??
    firstText(afs, 'bodies')

  const headline =
    creative.headline ??
    stringAt(linkData, 'name') ??
    stringAt(videoData, 'title') ??
    firstText(afs, 'titles')

  const description =
    creative.description ??
    stringAt(linkData, 'description') ??
    firstText(afs, 'descriptions')

  const ctaType =
    creative.ctaType ??
    ctaTypeAt(linkData) ??
    ctaTypeAt(videoData) ??
    stringAt(firstObjectAt(afs, 'call_to_action_types'), 'type') ??
    (Array.isArray((afs ?? {}).call_to_action_types)
      ? (((
          (afs as Record<string, unknown>).call_to_action_types as unknown[]
        ).find((v) => typeof v === 'string' && v !== '') as
          string | undefined) ?? null)
      : null)

  const linkUrl =
    stringAt(linkData, 'link') ??
    stringAt(firstObjectAt(afs, 'link_urls'), 'website_url')

  return {
    primaryText,
    headline,
    description,
    ctaType,
    linkUrl,
    linkDomain: hostOf(linkUrl),
  }
}
