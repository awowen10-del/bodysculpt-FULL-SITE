import { pgTable, uuid, text, boolean } from 'drizzle-orm/pg-core'
import { campaigns } from './campaigns.ts'
import { auditTimestamps } from './columns.ts'

/**
 * Human-entered business context — physically separate from Meta-sourced data
 * and written ONLY by the app UI, never by the Meta sync. CASCADE: if a campaign
 * row is ever removed, its manual context goes with it.
 */
export const manualCampaignContext = pgTable('manual_campaign_context', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaignId: uuid('campaign_id')
    .notNull()
    .unique()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  campaignType: text('campaign_type'), // cold / warm / retargeting / unknown
  offer: text('offer'),
  audiencePurpose: text('audience_purpose'),
  location: text('location'),
  notes: text('notes'),
  knownAnomalies: text('known_anomalies'),
  includeInBenchmarks: boolean('include_in_benchmarks').notNull().default(true),
  ...auditTimestamps(),
}).enableRLS()
