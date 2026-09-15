/**
 * Stage 9 rollback — undo ONE account's sync writes (SERVER-ONLY, offline-tested).
 *
 * Purpose-built for exactly one job: reversing the Stage 9 controlled live write
 * if it turns out wrong. It is deliberately NOT a general-purpose deletion
 * framework — it takes one Meta ad-account id, and there is no way to ask it for
 * anything broader. Pure of any connection: it operates on any Drizzle handle
 * (PGlite in tests; the migration client in the CLI) and opens nothing itself.
 *
 * Deletes, in FK-safe order, ONLY rows belonging to the named account:
 *   daily_ad_insights → ads → creatives → ad_sets → campaigns → ad_accounts
 *
 * NEVER touched:
 *   - `sync_runs`      — the audit record of what happened, including the very
 *                        run being rolled back. Rows are PRESERVED (see below).
 *   - `metric_definitions`     — reference data, seeded in Stage 3.
 *   - `manual_campaign_context` — human-authored, never re-derivable from Meta.
 *
 * THE manual_campaign_context CASCADE, and why the rollback can REFUSE
 * -------------------------------------------------------------------
 * `manual_campaign_context.campaign_id` references `campaigns` ON DELETE CASCADE
 * — the one cascading FK in the schema (every other is RESTRICT). Deleting this
 * account's campaigns would therefore SILENTLY delete any manual context hanging
 * off them: human-authored text that no re-sync can ever reproduce, destroyed
 * with no error and no trace.
 *
 * "Preserve manual_campaign_context" cannot be honoured by deleting around it —
 * a context row cannot outlive the campaign it points at. So the rollback
 * REFUSES: if any manual context exists for this account's campaigns, it raises
 * MANUAL_CONTEXT_PRESENT and deletes nothing, leaving the decision to a human.
 * As of Stage 9 the table is empty and no UI writes it, so this cannot fire yet
 * — the check exists for the day it can.
 *
 * THE sync_runs FK, and why a preserved row is still UPDATED
 * ---------------------------------------------------------
 * `sync_runs.ad_account_id` references `ad_accounts.id` ON DELETE RESTRICT, so a
 * run row that names this account PINS the account row: the final delete would
 * fail with a foreign-key violation and the whole rollback would abort.
 *
 * So the references are detached first — `ad_account_id` is set to NULL on the
 * affected run rows, inside the same transaction. This PRESERVES every run row
 * and every column that carries evidence (status, counts, errors, dates,
 * rate-limit info); only the pointer to a now-deleted account is cleared, which
 * is simply true once the account no longer exists. A dangling FK is not an
 * option and deleting the audit trail would be worse.
 *
 * Everything runs in ONE transaction: it all reverses, or nothing does.
 */
import { eq, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import {
  adAccounts,
  ads,
  adSets,
  campaigns,
  creatives,
  dailyAdInsights,
  manualCampaignContext,
  metricDefinitions,
  syncRuns,
} from './schema/index.ts'

/** Row counts for the tables a rollback deletes from, plus the preserved ones. */
export interface RollbackCounts {
  // deleted, in FK-safe order
  dailyAdInsights: number
  ads: number
  creatives: number
  adSets: number
  campaigns: number
  adAccounts: number
  // preserved — recorded so before/after can PROVE they did not change
  syncRuns: number
  metricDefinitions: number
  manualCampaignContext: number
}

export interface RollbackReport {
  /** The resolved internal UUID of the account that was rolled back. */
  adAccountUuid: string
  /** Counts scoped to this account (except the preserved tables, which are global). */
  before: RollbackCounts
  after: RollbackCounts
  /** Run rows whose `ad_account_id` pointer was cleared (the rows themselves stay). */
  syncRunsDetached: number
}

export type RollbackErrorCode =
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_NOT_UNIQUE'
  | 'INVALID_ACCOUNT_ID'
  | 'MANUAL_CONTEXT_PRESENT'
  | 'ROLLBACK_INCOMPLETE'

export class RollbackError extends Error {
  readonly code: RollbackErrorCode
  constructor(code: RollbackErrorCode, detail: string) {
    super(`${code}: ${detail}`)
    this.name = 'RollbackError'
    this.code = code
  }
}

type AnyDb = PgDatabase<PgQueryResultHKT, Record<string, unknown>>

/**
 * Resolve a Meta ad-account id to its internal UUID.
 *
 * Refuses unless EXACTLY ONE row matches. `meta_ad_account_id` is UNIQUE so two
 * matches should be impossible — the check is kept anyway, because this function
 * authorises deletions and "impossible" is not a safety argument.
 */
export async function resolveAccountUuid(
  db: AnyDb,
  metaAdAccountId: string,
): Promise<string> {
  if (metaAdAccountId.trim() === '') {
    throw new RollbackError('INVALID_ACCOUNT_ID', 'account id is empty')
  }
  const rows = await db
    .select({ id: adAccounts.id })
    .from(adAccounts)
    .where(eq(adAccounts.metaAdAccountId, metaAdAccountId))

  if (rows.length === 0) {
    throw new RollbackError(
      'ACCOUNT_NOT_FOUND',
      'no ad account matches the supplied Meta account id',
    )
  }
  if (rows.length > 1) {
    throw new RollbackError(
      'ACCOUNT_NOT_UNIQUE',
      `the supplied Meta account id matches ${rows.length} rows; refusing to delete`,
    )
  }
  return rows[0].id
}

/**
 * Count manual context rows that a campaign delete would CASCADE away.
 *
 * Scoped through the account's campaigns, which is exactly the blast radius of
 * `delete from campaigns where ad_account_id = $1`.
 */
export async function countManualContextAtRisk(
  db: AnyDb,
  adAccountUuid: string,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(manualCampaignContext)
    .innerJoin(campaigns, eq(manualCampaignContext.campaignId, campaigns.id))
    .where(eq(campaigns.adAccountId, adAccountUuid))
  return rows[0]?.n ?? 0
}

/** Count every rollback-relevant table, scoping the deletable ones to one account. */
export async function countAccountRows(
  db: AnyDb,
  adAccountUuid: string,
): Promise<RollbackCounts> {
  const scalar = async (query: Promise<{ n: number }[]>): Promise<number> => {
    const rows = await query
    return rows[0]?.n ?? 0
  }
  const N = sql<number>`count(*)::int`

  return {
    dailyAdInsights: await scalar(
      db
        .select({ n: N })
        .from(dailyAdInsights)
        .where(eq(dailyAdInsights.adAccountId, adAccountUuid)),
    ),
    ads: await scalar(
      db.select({ n: N }).from(ads).where(eq(ads.adAccountId, adAccountUuid)),
    ),
    creatives: await scalar(
      db
        .select({ n: N })
        .from(creatives)
        .where(eq(creatives.adAccountId, adAccountUuid)),
    ),
    adSets: await scalar(
      db
        .select({ n: N })
        .from(adSets)
        .where(eq(adSets.adAccountId, adAccountUuid)),
    ),
    campaigns: await scalar(
      db
        .select({ n: N })
        .from(campaigns)
        .where(eq(campaigns.adAccountId, adAccountUuid)),
    ),
    adAccounts: await scalar(
      db
        .select({ n: N })
        .from(adAccounts)
        .where(eq(adAccounts.id, adAccountUuid)),
    ),
    // Preserved tables are counted GLOBALLY, not scoped: the point is to prove
    // the rollback changed nothing about them anywhere.
    syncRuns: await scalar(db.select({ n: N }).from(syncRuns)),
    metricDefinitions: await scalar(
      db.select({ n: N }).from(metricDefinitions),
    ),
    manualCampaignContext: await scalar(
      db.select({ n: N }).from(manualCampaignContext),
    ),
  }
}

/**
 * Delete one account's sync-written rows, in FK-safe order, in ONE transaction.
 *
 * `db` must be a top-level handle — the transaction is opened here so that any
 * failure at any step reverses every earlier step.
 */
export async function rollbackAccount(
  db: AnyDb,
  metaAdAccountId: string,
): Promise<RollbackReport> {
  return db.transaction(async (tx) => {
    const adAccountUuid = await resolveAccountUuid(tx, metaAdAccountId)
    const before = await countAccountRows(tx, adAccountUuid)

    // Refuse BEFORE deleting anything: the campaigns delete would cascade these
    // away silently, and no re-sync can reproduce human-authored text. Better to
    // stop and let a person decide than to be quietly destructive.
    const atRisk = await countManualContextAtRisk(tx, adAccountUuid)
    if (atRisk > 0) {
      throw new RollbackError(
        'MANUAL_CONTEXT_PRESENT',
        `${atRisk} manual_campaign_context row(s) belong to this account's ` +
          'campaigns and would be cascade-deleted; refusing. Export or reassign ' +
          'them first, then re-run.',
      )
    }

    // Detach sync_runs FIRST: ON DELETE RESTRICT would otherwise block the
    // ad_accounts delete below. The rows survive; only the pointer is cleared.
    const detached = await tx
      .update(syncRuns)
      .set({ adAccountId: null, updatedAt: sql`now()` })
      .where(eq(syncRuns.adAccountId, adAccountUuid))
      .returning({ id: syncRuns.id })

    // FK-safe order: children before parents, every statement account-scoped.
    await tx
      .delete(dailyAdInsights)
      .where(eq(dailyAdInsights.adAccountId, adAccountUuid))
    await tx.delete(ads).where(eq(ads.adAccountId, adAccountUuid))
    await tx.delete(creatives).where(eq(creatives.adAccountId, adAccountUuid))
    await tx.delete(adSets).where(eq(adSets.adAccountId, adAccountUuid))
    await tx.delete(campaigns).where(eq(campaigns.adAccountId, adAccountUuid))
    await tx.delete(adAccounts).where(eq(adAccounts.id, adAccountUuid))

    const after = await countAccountRows(tx, adAccountUuid)

    // Prove the delete actually emptied this account before committing. If any
    // row survived, something is wrong with the scoping and the whole
    // transaction must reverse rather than leave a half-rolled-back account.
    const remaining =
      after.dailyAdInsights +
      after.ads +
      after.creatives +
      after.adSets +
      after.campaigns +
      after.adAccounts
    if (remaining !== 0) {
      throw new RollbackError(
        'ROLLBACK_INCOMPLETE',
        `${remaining} account-scoped rows survived the rollback; reversing`,
      )
    }
    // The preserved tables must be untouched. Checked inside the transaction so
    // an accidental future edit that deletes reference data reverses itself.
    if (
      after.syncRuns !== before.syncRuns ||
      after.metricDefinitions !== before.metricDefinitions ||
      after.manualCampaignContext !== before.manualCampaignContext
    ) {
      throw new RollbackError(
        'ROLLBACK_INCOMPLETE',
        'a preserved table changed row count; reversing',
      )
    }

    return { adAccountUuid, before, after, syncRunsDetached: detached.length }
  })
}
