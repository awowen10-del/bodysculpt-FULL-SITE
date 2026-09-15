import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  jsonb,
  index,
} from 'drizzle-orm/pg-core'
import { campaigns } from './campaigns.ts'
import { adAccounts } from './adAccounts.ts'
import { auditTimestamps, presenceColumns } from './columns.ts'

export const adSets = pgTable(
  'ad_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),
    adAccountId: uuid('ad_account_id')
      .notNull()
      .references(() => adAccounts.id, { onDelete: 'restrict' }),
    metaAdSetId: text('meta_ad_set_id').notNull().unique(),
    name: text('name'),
    status: text('status'),
    effectiveStatus: text('effective_status'),
    // Meta returns budgets as int64 in the account currency's MINOR unit
    // (pence for GBP). Stored raw; major-unit value is derived at read time.
    // `mode: 'bigint'` (Stage 6) keeps the int64 lossless across the write
    // boundary; the underlying PostgreSQL type is unchanged (bigint/int8).
    dailyBudgetMinor: bigint('daily_budget_minor', { mode: 'bigint' }),
    lifetimeBudgetMinor: bigint('lifetime_budget_minor', { mode: 'bigint' }),
    budgetCurrency: text('budget_currency'),
    optimizationGoal: text('optimization_goal'),
    billingEvent: text('billing_event'),
    bidStrategy: text('bid_strategy'),
    attributionSetting: text('attribution_setting'),
    // Conversion-destination + the raw `promoted_object`. The latter is the
    // authoritative evidence for whether an OFFSITE_CONVERSIONS ad set optimises
    // for a lead; stored structured so `custom_event_type` / `custom_conversion_id`
    // survive for central eligibility resolution and future reclassification.
    destinationType: text('destination_type'),
    promotedObject: jsonb('promoted_object'),
    targetingSummary: jsonb('targeting_summary'),
    startTime: timestamp('start_time', { withTimezone: true }),
    endTime: timestamp('end_time', { withTimezone: true }),
    updatedTime: timestamp('updated_time', { withTimezone: true }),
    ...presenceColumns(),
    ...auditTimestamps(),
  },
  (t) => [
    index('idx_ad_sets_campaign_id').on(t.campaignId),
    index('idx_ad_sets_ad_account_id').on(t.adAccountId),
  ],
).enableRLS()
