/**
 * Redaction primitives for anything Meta-related.
 *
 * Canonical home (Stage 5): these pure string scrubbers live here in `src/meta/`
 * and are shared by the runtime layer (e.g. defensive scrubbing before any
 * value is persisted) and by the read-only Stage 4 POC scripts, which re-export
 * them from the redact shim under the scripts tree. The dependency only ever
 * points from the scripts into `src/meta/`, never the reverse.
 *
 * Every value that reaches a log line, a thrown error, a persisted snapshot, or
 * the console can pass through here first. Access tokens, app secrets, and any
 * credential-bearing URL query params are replaced with a fixed marker so they
 * can never surface in terminal output, chat, CI logs, or the database.
 */

export const REDACTED = '***redacted***'

/**
 * Replace known secret substrings and credential-looking patterns in free text.
 * Pass any known secrets (e.g. the access token) so they are scrubbed verbatim,
 * on top of the structural patterns below.
 */
export function redactSensitive(
  input: string,
  secrets: readonly string[] = [],
): string {
  let out = input
  for (const secret of secrets) {
    if (secret && secret.length >= 6) {
      out = out.split(secret).join(REDACTED)
    }
  }
  // Credential-bearing query params, even when a URL is embedded in a larger string.
  out = out.replace(
    /([?&](?:access_token|client_secret|appsecret_proof)=)[^&\s"']+/gi,
    `$1${REDACTED}`,
  )
  // "Authorization: Bearer <token>"
  out = out.replace(/(bearer\s+)[A-Za-z0-9._~+/=|-]+/gi, `$1${REDACTED}`)
  return out
}

/** Redact credential query params from a URL, preserving the rest for context. */
export function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    for (const key of ['access_token', 'client_secret', 'appsecret_proof']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, REDACTED)
    }
    return url.toString()
  } catch {
    return redactSensitive(rawUrl)
  }
}

/** Safe, single-line message for any thrown value — never leaks a secret. */
export function redactError(
  err: unknown,
  secrets: readonly string[] = [],
): string {
  const message = err instanceof Error ? err.message : String(err)
  return redactSensitive(message, secrets)
}

/**
 * Mask long digit runs (>= 6 digits) — e.g. business / ad-account IDs that Meta
 * embeds as keys in usage headers — while leaving short numbers (rate-limit
 * percentages) intact.
 */
export function redactLongIds(input: string): string {
  return input.replace(/\d{6,}/g, REDACTED)
}
