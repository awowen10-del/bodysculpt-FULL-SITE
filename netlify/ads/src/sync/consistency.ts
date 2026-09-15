/**
 * Account-id canonicalisation and referential consistency for Stage 7.
 *
 * Meta returns the ad-account NODE id as `act_<digits>` but child `account_id`
 * fields as bare digits. We canonicalise every entity's account id to
 * `act_<digits>` (reusing the shared validator) so the one account key matches
 * everywhere. Cross-account entities and orphan relationships FAIL LOUD, before
 * ingestion, in both dry-run and live-write. Raw account ids never appear in
 * error messages.
 */
import { normalizeAdAccountId } from '../meta/graphClient.ts'
import { SyncError } from './errors.ts'
import type { IngestInput } from '../types/index.ts'

function canonAccount(id: string | null): string | null {
  return id === null ? null : normalizeAdAccountId(id)
}

/** Raw pre-normalisation check: no record may belong to another account. */
export function assertRawSameAccount(
  records: readonly unknown[],
  expectedActId: string,
  label: string,
): void {
  for (const record of records) {
    if (typeof record !== 'object' || record === null) continue
    const acc = (record as Record<string, unknown>).account_id
    if (acc === undefined || acc === null) continue
    let normalised: string
    try {
      normalised = normalizeAdAccountId(String(acc))
    } catch {
      throw new SyncError(
        'CROSS_ACCOUNT',
        `${label} has an unreadable account id`,
      )
    }
    if (normalised !== expectedActId) {
      throw new SyncError(
        'CROSS_ACCOUNT',
        `${label} belongs to a different account`,
      )
    }
  }
}

/** Rewrite every entity's account id to the canonical `act_<digits>` form. */
export function canonicalizeAccountIds(input: IngestInput): IngestInput {
  return {
    adAccounts: input.adAccounts.map((a) => ({
      ...a,
      metaAdAccountId: normalizeAdAccountId(a.metaAdAccountId),
    })),
    campaigns: input.campaigns.map((c) => ({
      ...c,
      metaAdAccountId: canonAccount(c.metaAdAccountId),
    })),
    adSets: input.adSets.map((s) => ({
      ...s,
      metaAdAccountId: canonAccount(s.metaAdAccountId),
    })),
    creatives: input.creatives,
    ads: input.ads.map((a) => ({
      ...a,
      metaAdAccountId: canonAccount(a.metaAdAccountId),
    })),
    insights: input.insights.map((i) => ({
      ...i,
      metaAdAccountId: normalizeAdAccountId(i.metaAdAccountId),
    })),
  }
}

/** Post-normalisation cross-account check over canonicalised entities. */
export function assertConsistentAccount(
  input: IngestInput,
  expectedActId: string,
): void {
  const check = (id: string | null, label: string): void => {
    if (id !== null && id !== expectedActId) {
      throw new SyncError(
        'CROSS_ACCOUNT',
        `${label} belongs to a different account`,
      )
    }
  }
  for (const a of input.adAccounts) {
    if (a.metaAdAccountId !== expectedActId) {
      throw new SyncError(
        'CROSS_ACCOUNT',
        'account is not the configured account',
      )
    }
  }
  for (const c of input.campaigns) check(c.metaAdAccountId, 'campaign')
  for (const s of input.adSets) check(s.metaAdAccountId, 'ad set')
  for (const a of input.ads) check(a.metaAdAccountId, 'ad')
  for (const i of input.insights) check(i.metaAdAccountId, 'insight')
}

/** Fail loud on any orphan parent relationship (never silently discard). */
export function assertGraphConsistency(input: IngestInput): void {
  const accounts = new Set(input.adAccounts.map((a) => a.metaAdAccountId))
  const campaigns = new Set(input.campaigns.map((c) => c.metaCampaignId))
  const adSets = new Set(input.adSets.map((s) => s.metaAdSetId))
  const ads = new Set(input.ads.map((a) => a.metaAdId))
  const creatives = new Set(input.creatives.map((c) => c.metaCreativeId))

  const need = (present: boolean, label: string, parent: string): void => {
    if (!present) {
      throw new SyncError(
        'ORPHAN_ENTITY',
        `${label} references an unknown ${parent}`,
      )
    }
  }

  for (const c of input.campaigns) {
    need(
      c.metaAdAccountId !== null && accounts.has(c.metaAdAccountId),
      'campaign',
      'account',
    )
  }
  for (const s of input.adSets) {
    need(
      s.metaCampaignId !== null && campaigns.has(s.metaCampaignId),
      'ad set',
      'campaign',
    )
    need(
      s.metaAdAccountId !== null && accounts.has(s.metaAdAccountId),
      'ad set',
      'account',
    )
  }
  for (const a of input.ads) {
    need(a.metaAdSetId !== null && adSets.has(a.metaAdSetId), 'ad', 'ad set')
    need(
      a.metaCampaignId !== null && campaigns.has(a.metaCampaignId),
      'ad',
      'campaign',
    )
    need(
      a.metaAdAccountId !== null && accounts.has(a.metaAdAccountId),
      'ad',
      'account',
    )
    if (a.metaCreativeId !== null) {
      need(creatives.has(a.metaCreativeId), 'ad', 'creative')
    }
  }
  for (const i of input.insights) {
    need(ads.has(i.metaAdId), 'insight', 'ad')
    need(adSets.has(i.metaAdSetId), 'insight', 'ad set')
    need(campaigns.has(i.metaCampaignId), 'insight', 'campaign')
    need(accounts.has(i.metaAdAccountId), 'insight', 'account')
  }
}
