import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'
import { adAccounts } from './adAccounts.ts'
import { auditTimestamps, presenceColumns } from './columns.ts'

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adAccountId: uuid('ad_account_id')
      .notNull()
      .references(() => adAccounts.id, { onDelete: 'restrict' }),
    metaCampaignId: text('meta_campaign_id').notNull().unique(),
    name: text('name'),
    objective: text('objective'),
    status: text('status'),
    effectiveStatus: text('effective_status'),
    buyingType: text('buying_type'),
    createdTime: timestamp('created_time', { withTimezone: true }),
    startTime: timestamp('start_time', { withTimezone: true }),
    stopTime: timestamp('stop_time', { withTimezone: true }),
    updatedTime: timestamp('updated_time', { withTimezone: true }),
    ...presenceColumns(),
    ...auditTimestamps(),
  },
  (t) => [index('idx_campaigns_ad_account_id').on(t.adAccountId)],
).enableRLS()
