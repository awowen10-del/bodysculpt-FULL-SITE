/**
 * Daily Ad Check persistence (SERVER-ONLY — imports the Drizzle schema).
 *
 * Reads the most recent saved checks (for the card and for the "since your last
 * check" diff + streaks) and inserts a freshly generated one. It stores the exact
 * deterministic `ChangeSet` in `input_snapshot`, so history is reconstructed with
 * zero recomputation: a stored check's snapshots ARE the baseline the next check
 * diffs against. No arithmetic, no scoring — pure read/write.
 */
import { desc } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from '../../db/schema/index.ts'
import type {
  Briefing,
  BriefingSource,
  ChangeSet,
  DailyCheckRecordDTO,
} from '../../dailyCheck/index.ts'
import type { PriorCheck } from '../../dailyCheck/index.ts'

/** Any Drizzle pg database over our schema (postgres-js in prod, PGlite in tests). */
export type DailyCheckDb = PgDatabase<PgQueryResultHKT, typeof schema>

type CheckRow = typeof schema.dailyAdChecks.$inferSelect

/** Map a stored row to the JSON-safe DTO the card consumes. */
function toRecordDTO(row: CheckRow): DailyCheckRecordDTO {
  return {
    id: row.id,
    generatedAt: row.generatedAt.toISOString(),
    window: { start: row.windowStart ?? null, end: row.windowEnd ?? null },
    briefing: row.briefing as Briefing,
    changeSet: row.inputSnapshot as ChangeSet,
    source: row.source as BriefingSource,
    model: row.model ?? null,
    settingsVersion: row.settingsVersion ?? null,
  }
}

/** The most recent `limit` saved checks, newest first. */
export async function readRecentChecks(
  db: DailyCheckDb,
  limit: number,
): Promise<DailyCheckRecordDTO[]> {
  const rows = await db
    .select()
    .from(schema.dailyAdChecks)
    .orderBy(desc(schema.dailyAdChecks.generatedAt))
    .limit(limit)
  return rows.map(toRecordDTO)
}

/** The single most recent saved check, or null when none exist yet. */
export async function readLatestCheck(
  db: DailyCheckDb,
): Promise<DailyCheckRecordDTO | null> {
  const rows = await readRecentChecks(db, 1)
  return rows[0] ?? null
}

/** Reduce saved records to the newest-first `PriorCheck[]` the diff/streaks need. */
export function toPriorChecks(records: DailyCheckRecordDTO[]): PriorCheck[] {
  return records.map((r) => ({
    generatedAt: r.generatedAt,
    snapshots: r.changeSet.snapshots,
  }))
}

/** A generated check ready to persist (before it has an id / generatedAt). */
export interface NewCheck {
  changeSet: ChangeSet
  briefing: Briefing
  source: BriefingSource
  model: string | null
  settingsVersion: string
}

/** Insert a generated check and return the stored record. */
export async function insertCheck(
  db: DailyCheckDb,
  check: NewCheck,
): Promise<DailyCheckRecordDTO> {
  const [row] = await db
    .insert(schema.dailyAdChecks)
    .values({
      windowStart: check.changeSet.window.start || null,
      windowEnd: check.changeSet.window.end || null,
      inputSnapshot: check.changeSet,
      briefing: check.briefing,
      source: check.source,
      model: check.model,
      settingsVersion: check.settingsVersion,
    })
    .returning()
  return toRecordDTO(row)
}
