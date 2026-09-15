/**
 * Safe read-only summary of `daily_ad_insights` (Stage 11E backfill verification).
 *
 * Aggregate counts + the date range ONLY. It never returns (and its callers never
 * print) Meta ids, internal UUIDs, ad copy, URLs, tokens or row contents — only
 * numbers and `YYYY-MM-DD` dates. Shared by the sync CLI's post-write read-back and
 * the standalone `db:verify-insights` script so both report identically.
 *
 * SERVER-ONLY (imports the Drizzle schema). It takes an injected db handle, so it
 * opens no connection of its own and is unit-testable on PGlite.
 */
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema/index.ts'

export type ReadableDb = PgDatabase<PgQueryResultHKT, typeof schema>

export interface InsightsTableSummary {
  /** Total `daily_ad_insights` rows. */
  rows: number
  /** Distinct calendar dates present (this is what a 14-day backfill must reach). */
  distinctDays: number
  /** Earliest/latest date present, or null when the table is empty. */
  dateRange: { min: string; max: string } | null
  /** Distinct ads with at least one insight row. */
  uniqueAds: number
  rowsWithSpend: number
  rowsWithClicks: number
  /** Rows with a resolved lead total (null while the lead definition is unresolved). */
  rowsWithLeads: number
  rowsWithVideo: number
  /** Row count per date, ascending — proves the days are distinct and populated. */
  perDate: { date: string; rows: number }[]
}

/** True for a non-null count strictly greater than zero. */
function gt0(value: bigint | null): boolean {
  return value !== null && value > 0n
}

/**
 * Read `daily_ad_insights` and reduce it to a safe aggregate summary. The internal
 * `ad_id` UUID is read solely to count distinct ads — it is never returned.
 */
export async function summariseInsightsTable(
  db: ReadableDb,
): Promise<InsightsTableSummary> {
  const rows = await db
    .select({
      date: schema.dailyAdInsights.date,
      adId: schema.dailyAdInsights.adId,
      spend: schema.dailyAdInsights.spend,
      clicks: schema.dailyAdInsights.clicks,
      inlineLinkClicks: schema.dailyAdInsights.inlineLinkClicks,
      leads: schema.dailyAdInsights.leads,
      videoPlayActions: schema.dailyAdInsights.videoPlayActions,
    })
    .from(schema.dailyAdInsights)

  const perDate = new Map<string, number>()
  const ads = new Set<string>()
  let rowsWithSpend = 0
  let rowsWithClicks = 0
  let rowsWithLeads = 0
  let rowsWithVideo = 0

  for (const r of rows) {
    perDate.set(r.date, (perDate.get(r.date) ?? 0) + 1)
    ads.add(r.adId)
    if (r.spend !== null) rowsWithSpend += 1
    if (gt0(r.clicks) || gt0(r.inlineLinkClicks)) rowsWithClicks += 1
    if (r.leads !== null) rowsWithLeads += 1
    if (gt0(r.videoPlayActions)) rowsWithVideo += 1
  }

  const dates = [...perDate.keys()].sort((a, b) => a.localeCompare(b))

  return {
    rows: rows.length,
    distinctDays: dates.length,
    dateRange:
      dates.length > 0 ? { min: dates[0], max: dates[dates.length - 1] } : null,
    uniqueAds: ads.size,
    rowsWithSpend,
    rowsWithClicks,
    rowsWithLeads,
    rowsWithVideo,
    perDate: dates.map((d) => ({ date: d, rows: perDate.get(d)! })),
  }
}
