/**
 * v167: the ads tool moved into the Bodysculpt dashboard, which has no login — Ash:
 * "Drop the login, it's fine." The whole dashboard (KPIs, finances, mail) is one
 * private site, and the ads screens live under the same roof on the same terms.
 *
 * The Authenticator SEAM stays: every handler still asks "who is this?" before it
 * opens a connection, and this is the one place that answers. If a login is ever
 * wanted again, it is reintroduced here and nowhere else — no router or handler
 * changes. The password/cookie implementation this replaced is in the ad-intelligence
 * repository's history (src/server/session.ts).
 *
 * The sync WRITE path is not affected: sync-background is still locked to
 * SYNC_TRIGGER_SECRET, which only the scheduled function and sync-trigger hold.
 */
import type { Authenticator } from './auth.ts'

export function createOpenAuthenticator(): Authenticator {
  return {
    async authenticate() {
      return { subject: 'owner' }
    },
  }
}
