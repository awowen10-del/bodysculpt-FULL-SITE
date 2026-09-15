import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core'
import { auditTimestamps, presenceColumns } from './columns.ts'

export const adAccounts = pgTable('ad_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  metaAdAccountId: text('meta_ad_account_id').notNull().unique(),
  name: text('name'),
  currency: text('currency').notNull(),
  timezoneName: text('timezone_name').notNull(),
  connectionStatus: text('connection_status').notNull().default('unknown'),
  lastSuccessfulSyncAt: timestamp('last_successful_sync_at', {
    withTimezone: true,
  }),
  ...presenceColumns(),
  ...auditTimestamps(),
}).enableRLS()
