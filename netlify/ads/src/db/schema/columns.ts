import { integer, timestamp } from 'drizzle-orm/pg-core'

/**
 * created_at / updated_at — present on every table. Factory functions return
 * fresh column builders per table (safe to reuse across pgTable definitions).
 */
export const auditTimestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/**
 * Reconciliation / presence tracking — on dimension tables only.
 *
 * `deleted_at` is NEVER set by absence alone. A missing entity accrues
 * `consecutive_full_scope_misses` (only via a successful, full-scope
 * reconciliation) and a `missing_since` timestamp; deletion requires an explicit
 * Meta signal or a future reviewed business rule. See src/db/reconciliation.ts.
 */
export const presenceColumns = () => ({
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  missingSince: timestamp('missing_since', { withTimezone: true }),
  consecutiveFullScopeMisses: integer('consecutive_full_scope_misses')
    .notNull()
    .default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})
