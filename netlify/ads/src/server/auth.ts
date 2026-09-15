/**
 * Authentication seam for the read API (Stage 11B).
 *
 * The router depends ONLY on the `Authenticator` interface — it never knows which
 * mechanism verifies a request. Every endpoint rejects a request whose
 * `authenticate` returns `null`.
 *
 * A production authenticator (e.g. Netlify Identity verifying the caller's JWT) is
 * DELIBERATELY NOT implemented here: the deployed auth vendor must be explicitly
 * approved and verified first (see docs/STAGE-11-API-PLAN.md §5). Stage 11B ships
 * only the interface plus an injectable bearer-token authenticator used by the
 * automated tests and, optionally, local development.
 */
import type { ApiRequest } from './http.ts'

/** The minimal identity a successful authentication yields. */
export interface AuthContext {
  /** Opaque subject id of the authenticated owner. Never a secret. */
  subject: string
}

/** Pluggable authentication strategy. Returns `null` to reject the request. */
export interface Authenticator {
  authenticate(req: ApiRequest): Promise<AuthContext | null>
}

/** Constant-time-ish string comparison to avoid trivial timing leaks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1)
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * A simple bearer-token authenticator: accepts a request carrying
 * `Authorization: Bearer <token>` whose token matches `expectedToken`. Intended
 * for tests and single-owner local development, NOT as the deployed production
 * mechanism.
 */
export function createBearerTokenAuthenticator(
  expectedToken: string,
): Authenticator {
  if (expectedToken.length === 0) {
    throw new Error('bearer token must be non-empty')
  }
  return {
    async authenticate(req: ApiRequest): Promise<AuthContext | null> {
      const header = req.headers['authorization']
      if (header === undefined) return null
      const match = /^Bearer (.+)$/.exec(header)
      if (match === null) return null
      return safeEqual(match[1], expectedToken) ? { subject: 'owner' } : null
    },
  }
}

/** An authenticator that rejects everything — a safe default / explicit "no auth". */
export function createDenyAllAuthenticator(): Authenticator {
  return {
    async authenticate() {
      return null
    },
  }
}
