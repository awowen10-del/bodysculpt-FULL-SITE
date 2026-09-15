import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  jsonb,
  index,
} from 'drizzle-orm/pg-core'
import { adAccounts } from './adAccounts.ts'
import { auditTimestamps } from './columns.ts'

/**
 * One row per generated **Daily Ad Check** — the AI morning briefing.
 *
 * The deterministic engine stays the source of truth: `input_snapshot` stores the
 * exact, computed `ChangeSet` the AI was shown (per-creative decisions + day-over-
 * day diff), so a briefing is fully auditable AND the next check can diff against
 * this snapshot ("since your last check") and read streaks without recomputation.
 * `briefing` is the plain-English output; `source` records whether the AI wrote it
 * or the deterministic fallback did (the AI never invents numbers — see
 * src/server/dailyCheck/narrate.ts). Nothing here is a metric the metrics layer
 * must aggregate; these are display artefacts + provenance only.
 */
export const dailyAdChecks = pgTable(
  'daily_ad_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adAccountId: uuid('ad_account_id').references(() => adAccounts.id, {
      onDelete: 'restrict',
    }),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** The trailing analysis window the check was computed over. */
    windowStart: date('window_start'),
    windowEnd: date('window_end'),
    /** The deterministic ChangeSet shown to the AI (audit trail + next-check diff basis). */
    inputSnapshot: jsonb('input_snapshot').notNull(),
    /** The plain-English briefing (headline + sections). */
    briefing: jsonb('briefing').notNull(),
    /** 'ai' when Claude wrote the briefing; 'fallback' when the deterministic renderer did. */
    source: text('source').notNull(),
    /** The Claude model that produced the briefing (or null for a pure fallback). */
    model: text('model'),
    /** The decision-settings version the ChangeSet was judged under (provenance). */
    settingsVersion: text('settings_version'),
    ...auditTimestamps(),
  },
  (t) => [
    index('idx_daily_ad_checks_generated_at').on(t.generatedAt),
    index('idx_daily_ad_checks_ad_account_id').on(t.adAccountId),
  ],
).enableRLS()
