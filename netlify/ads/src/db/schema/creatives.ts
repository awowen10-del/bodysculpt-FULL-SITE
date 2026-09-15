import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core'
import { adAccounts } from './adAccounts.ts'
import { auditTimestamps, presenceColumns } from './columns.ts'

export const creatives = pgTable(
  'creatives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adAccountId: uuid('ad_account_id')
      .notNull()
      .references(() => adAccounts.id, { onDelete: 'restrict' }),
    metaCreativeId: text('meta_creative_id').notNull().unique(),
    objectType: text('object_type'),
    primaryText: text('primary_text'),
    headline: text('headline'),
    description: text('description'),
    ctaType: text('cta_type'),
    destinationUrl: text('destination_url'),
    imageUrl: text('image_url'),
    thumbnailUrl: text('thumbnail_url'),
    videoId: text('video_id'),
    // fb/ig identity refs are [POC] (exact field names unconfirmed) — kept in
    // asset_metadata / raw until verified, then promoted via a reviewed migration.
    assetMetadata: jsonb('asset_metadata'),
    originalAssetRef: text('original_asset_ref'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    ...presenceColumns(),
    ...auditTimestamps(),
  },
  (t) => [index('idx_creatives_ad_account_id').on(t.adAccountId)],
).enableRLS()
