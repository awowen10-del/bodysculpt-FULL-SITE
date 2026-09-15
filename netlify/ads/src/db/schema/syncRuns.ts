import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core'
import { adAccounts } from './adAccounts.ts'
import { auditTimestamps } from './columns.ts'

/**
 * `scope` is central to safe reconciliation: only a run with scope='full' AND
 * status='success' may record an entity as missing. Partial/failed/filtered/
 * incremental runs must never alter presence state.
 */
export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adAccountId: uuid('ad_account_id').references(() => adAccounts.id, {
      onDelete: 'restrict',
    }),
    level: text('level').notNull(), // backfill / daily / manual / reconciliation
    scope: text('scope').notNull().default('incremental'), // full / incremental / filtered
    dateRangeStart: date('date_range_start'),
    dateRangeEnd: date('date_range_end'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    recordsRequested: integer('records_requested'),
    recordsWritten: integer('records_written'),
    status: text('status').notNull().default('running'), // running/success/partial/failed
    errors: jsonb('errors'), // error types only — never secrets
    rateLimitInfo: jsonb('rate_limit_info'),
    ...auditTimestamps(),
  },
  (t) => [
    index('idx_sync_runs_started_at').on(t.startedAt),
    index('idx_sync_runs_status').on(t.status),
    index('idx_sync_runs_scope').on(t.scope),
    index('idx_sync_runs_ad_account_id').on(t.adAccountId),
  ],
).enableRLS()
