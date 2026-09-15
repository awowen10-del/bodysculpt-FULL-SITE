import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  index,
} from 'drizzle-orm/pg-core'
import { adSets } from './adSets.ts'
import { campaigns } from './campaigns.ts'
import { adAccounts } from './adAccounts.ts'
import { creatives } from './creatives.ts'
import { auditTimestamps, presenceColumns } from './columns.ts'

export const ads = pgTable(
  'ads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adSetId: uuid('ad_set_id')
      .notNull()
      .references(() => adSets.id, { onDelete: 'restrict' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'restrict' }),
    adAccountId: uuid('ad_account_id')
      .notNull()
      .references(() => adAccounts.id, { onDelete: 'restrict' }),
    metaAdId: text('meta_ad_id').notNull().unique(),
    name: text('name'),
    status: text('status'),
    effectiveStatus: text('effective_status'),
    // RESTRICT: creatives are soft-deleted/preserved, never hard-deleted, so an
    // ad can never be silently severed from its creative history. Nullable only
    // because an ad may not yet have a captured creative.
    creativeId: uuid('creative_id').references(() => creatives.id, {
      onDelete: 'restrict',
    }),
    createdTime: timestamp('created_time', { withTimezone: true }),
    updatedTime: timestamp('updated_time', { withTimezone: true }),
    // Historical backfill tombstone marker. TRUE only for a minimum-safe ad row
    // synthesised to preserve a historical insight whose ad Meta no longer exposes
    // ANYWHERE (absent from the /ads listing, absent locally, and un-fetchable by
    // id). Such a row carries NO fabricated identity (name/status/creative stay
    // null) — the flag is the honest "unavailable/deleted historical inventory"
    // signal. A later /ads listing that returns the ad upserts this back to FALSE
    // (self-healing). Never true for an ad recovered from the local DB or Meta.
    historicalPlaceholder: boolean('historical_placeholder')
      .notNull()
      .default(false),
    ...presenceColumns(),
    ...auditTimestamps(),
  },
  (t) => [
    index('idx_ads_ad_set_id').on(t.adSetId),
    index('idx_ads_campaign_id').on(t.campaignId),
    index('idx_ads_creative_id').on(t.creativeId),
  ],
).enableRLS()
