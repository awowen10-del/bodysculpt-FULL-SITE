import { pgTable, uuid, text } from 'drizzle-orm/pg-core'
import { auditTimestamps } from './columns.ts'

/**
 * Machine-readable mirror of docs/METRIC-DICTIONARY-DRAFT.md. Seeded idempotently
 * by src/db/seed.ts (upsert on `key`).
 */
export const metricDefinitions = pgTable('metric_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  meaning: text('meaning'),
  formula: text('formula'),
  metaSource: text('meta_source'),
  validLevel: text('valid_level'),
  origin: text('origin').notNull(), // sourced / calculated / manual
  limitations: text('limitations'),
  ...auditTimestamps(),
}).enableRLS()
