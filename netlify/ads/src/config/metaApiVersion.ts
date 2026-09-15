/**
 * Single source of truth for the Meta Marketing / Graph API version.
 *
 * Meta expires API versions on a roughly yearly cycle, so every Meta request in
 * the codebase routes through this one constant — a version bump is a one-line
 * change here, never a scattered find-and-replace.
 *
 * Baseline: v25.0 (released 2026-02-18). Confirmed against official Meta docs on
 * 2026-07-14. On the server this can be overridden by the META_API_VERSION env
 * var; this constant is the documented default.
 */
export const META_API_VERSION = 'v25.0' as const
