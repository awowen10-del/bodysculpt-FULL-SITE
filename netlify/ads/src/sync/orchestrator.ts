/**
 * Stage 7 sync orchestrator (SERVER-ONLY, offline-tested).
 *
 * Wires the runtime read-only Meta fetch → Stage 5 normalisation → Stage 6
 * ingestion, with one `sync_runs` row spanning a live-write workflow. Dry-run
 * never opens a database, never writes, and reports `written = 0`. No live fetch
 * or live Supabase write happens here; tests inject a mock fetch and PGlite.
 */
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type {
  EntityCounts,
  IngestInput,
  NormalizedDailyInsight,
  NormalizedCreative,
  StructuredSyncError,
  SyncRunStatus,
  WindowOutcome,
} from '../types/index.ts'
import { ZERO_ENTITY_COUNTS } from '../types/index.ts'
import {
  emptyRateLimit,
  mergeRateLimit,
  MetaRequestError,
  type FetchLike,
  type SleepLike,
  type SanitisedRateLimit,
} from '../meta/graphClient.ts'
import type { RuntimeMetaConfig } from '../meta/runtimeConfig.ts'
import {
  fetchAdAccount,
  fetchCampaigns,
  fetchAdSets,
  fetchAds,
  fetchInsightsWindow,
  fetchAdById,
  fetchAdSetById,
  fetchCampaignById,
  type FetchDeps,
} from '../meta/fetchEntities.ts'
import {
  normalizeAdAccount,
  normalizeCampaign,
  normalizeAdSet,
  normalizeAd,
  normalizeCreative,
  normalizeDailyInsight,
} from '../meta/normalize.ts'
import {
  resolveOrphanAds,
  EMPTY_ORPHAN_REPORT,
  type OrphanResolutionReport,
  type LocalAdRecovery,
  type RecoveredAd,
} from './orphanAds.ts'
import { normalizeAdAccountId } from '../meta/graphClient.ts'
import { startRun, finishRun, type RunOutcome } from '../db/syncRuns.ts'
import {
  writeDimensions,
  writeInsightWindow,
  computeRunStatus,
} from '../db/ingest/index.ts'
import { toStructuredError, type RetryOptions } from '../db/ingest/dbErrors.ts'
import { SyncError, classifyCause } from './errors.ts'
import { dedupeStrict } from './dedupe.ts'
import { mergeCreativesById } from './creativeMerge.ts'
import {
  canonicalizeAccountIds,
  assertRawSameAccount,
  assertConsistentAccount,
  assertGraphConsistency,
} from './consistency.ts'
import { chunkRange, rollingRange, validateRange } from './dateWindows.ts'
import { validateRequestShape, type SyncRequest } from './request.ts'

export interface SyncCounts {
  fetched: number
  normalised: number
  requested: number
  written: number
}

/**
 * Fixed, secret-free progress markers emitted as the orchestration crosses each
 * phase boundary. They name only the PHASE — never an id, count, token, url or
 * row value — so the CLI can print them verbatim and an operator can read how
 * far a run got before it failed. `*_start` is emitted before the phase begins;
 * `*_complete` only after it fully succeeds, so a missing `*_complete` pins the
 * failing phase.
 */
export type SyncLifecycleStage =
  | 'dimension_fetch_start'
  | 'dimension_fetch_complete'
  | 'dimension_normalise_start'
  | 'dimension_normalise_complete'
  | 'insights_fetch_start'
  | 'insights_fetch_complete'
  | 'database_write_start'
  | 'database_write_complete'

export interface SyncDeps {
  config: RuntimeMetaConfig
  fetchImpl: FetchLike
  sleepImpl?: SleepLike
  /** Injected "today" (YYYY-MM-DD) — no hidden clock. */
  todayIso: string
  /** Retry options for the database write transactions. */
  retry?: RetryOptions
  /** Test override for pages per edge (clamped to the hard maximum). */
  maxPagesPerEdge?: number
  /** Test seam for the finalisation-failure path; defaults to the real finishRun. */
  finishRunImpl?: typeof finishRun
  /**
   * Optional lifecycle progress hook. Receives a fixed, secret-free stage name
   * at each phase boundary; the CLI uses it to print live progress and, on a
   * failure, to show exactly which phase was last entered. Never called with
   * anything but a `SyncLifecycleStage` literal.
   */
  onStage?: (stage: SyncLifecycleStage) => void
  /**
   * Optional retry hook, fired before each transient DATABASE-WRITE retry with
   * SAFE fields only: the write stage, the attempt that just failed, the ceiling,
   * and the classified transient code. The CLI prints it so a pooled-connection
   * reset that IS being retried is visible on the terminal (`database_write retry
   * 1/3 (CONNECTION_CLOSED)`), not silent. Never called with SQL, params, ids,
   * connection details or payload data.
   */
  onRetry?: (info: {
    stage: 'run_start' | 'database_write' | 'insight_window'
    attempt: number
    maxAttempts: number
    code: string
  }) => void
  /**
   * Resolution A of the historical-orphan resolver (src/sync/orphanAds.ts): look
   * up ads that are absent from the current `/ads` listing but ALREADY EXIST in
   * the local database, so a historical insight can be re-attached to its real ad
   * instead of failing the whole backfill with `ORPHAN_ENTITY`. Present only for a
   * live-write (which has a database); absent in dry-run/preflight, where only
   * direct-Meta recovery and tombstoning are available.
   */
  localAdLookup?: (metaAdIds: readonly string[]) => Promise<LocalAdRecovery>
}

/**
 * Merge the caller's retry options with an `onRetry` that tags each retry with
 * the write stage and forwards it to `deps.onRetry`, without dropping any
 * `onRetry` already present on `deps.retry`. This is the single seam that makes
 * the bounded transient retry OBSERVABLE across every DB-write call below.
 */
function retryForStage(
  deps: SyncDeps,
  stage: 'run_start' | 'database_write' | 'insight_window',
): RetryOptions {
  return {
    ...deps.retry,
    onRetry: (info) => {
      deps.retry?.onRetry?.(info)
      deps.onRetry?.({ stage, ...info })
    },
  }
}

interface WindowResult {
  since: string
  until: string
  status: 'success' | 'failed'
  insights: NormalizedDailyInsight[]
  error?: unknown
}

interface FetchNormalizeResult {
  input: IngestInput
  windowOutcomes: WindowResult[]
  counts: Omit<SyncCounts, 'written'>
  entitiesRequested: EntityCounts
  rateLimit: SanitisedRateLimit
  orphanResolution: OrphanResolutionReport
}

/**
 * Per-entity breakdown of the records assembled for persistence.
 *
 * Every list is already deduped by Meta natural key upstream (`dedupeRawById`,
 * `deriveCreatives`, `dedupeStrict` on insights), so these lengths are distinct
 * record counts and their sum is exactly `counts.requested`.
 */
function entitiesOf(input: IngestInput): EntityCounts {
  return {
    adAccounts: input.adAccounts.length,
    campaigns: input.campaigns.length,
    adSets: input.adSets.length,
    creatives: input.creatives.length,
    ads: input.ads.length,
    dailyInsights: input.insights.length,
  }
}

// --- raw helpers -----------------------------------------------------------

function rawRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SyncError('MALFORMED_RESPONSE', `${label} is not a Meta object`)
  }
  return value as Record<string, unknown>
}

/** Page-dedupe raw entities by `id`; conflicting duplicates fail loud. */
function dedupeRawById(records: readonly unknown[], label: string): unknown[] {
  return dedupeStrict(
    records,
    (r) => {
      const id = rawRecord(r, label).id
      if (typeof id !== 'string' || id === '') {
        throw new SyncError('MALFORMED_RESPONSE', `${label} is missing its id`)
      }
      return id
    },
    { label },
  )
}

/** Page-dedupe raw insights by (ad_id, date_start); conflicts fail loud. */
function dedupeRawInsights(records: readonly unknown[]): unknown[] {
  return dedupeStrict(
    records,
    (r) => {
      const rec = rawRecord(r, 'insight')
      const ad = rec.ad_id
      const date = rec.date_start
      if (typeof ad !== 'string' || typeof date !== 'string') {
        throw new SyncError(
          'MALFORMED_RESPONSE',
          'insight is missing ad_id/date_start',
        )
      }
      return JSON.stringify([ad, date])
    },
    { label: 'insight' },
  )
}

function deriveCreatives(rawAds: readonly unknown[]): NormalizedCreative[] {
  const creatives: NormalizedCreative[] = []
  for (const rawAd of rawAds) {
    const ad = rawRecord(rawAd, 'ad')
    if (ad.creative === undefined || ad.creative === null) continue
    creatives.push(normalizeCreative(ad.creative))
  }
  // Fold every representation of one creative id into ONE canonical record.
  //
  // Meta expands the same creative inline on several ads, projecting a different
  // field subset per ad and re-minting CDN urls per response, so two ads
  // describing ONE creative differ on omitted/null fields and url churn alone.
  // `mergeCreativesById` fills missing/null from a populated occurrence, merges
  // objects key-by-key, and ignores only proven-volatile url params — while a
  // real immutable-field disagreement still fails closed with
  // `CONFLICTING_DUPLICATE` (carrying a secret-safe structural diagnostic).
  // Scoped to creatives: `dedupeStrict` stays byte-strict for every other entity.
  return mergeCreativesById(creatives)
}

const INSIGHT_KEY = (i: NormalizedDailyInsight): string =>
  JSON.stringify([i.metaAdId, i.date])

// --- fetch + normalise (shared; no database) -------------------------------

/**
 * The two labelled failure modes of the dimension phase, each with the code the
 * CLI and `sync_runs.errors` should carry.
 *
 * They exist so a NETWORK/transport failure (`DIMENSION_FETCH_FAILED`) and a
 * post-fetch SCHEMA drift (`DIMENSION_NORMALISE_FAILED`) can never wear each
 * other's label. The old single wrapper collapsed both into
 * `DIMENSION_FETCH_FAILED`, so a run whose fetches all succeeded but whose ad or
 * campaign record failed `normalize*` was reported — and diagnosed — as a fetch
 * failure. `meta:diagnose-dimensions` only exercises the four fetchers and the
 * inline-creative parse, so it reports "healthy" for exactly that case; this
 * split is what lets the sync itself name the real step.
 */
type DimensionStage = 'dimension_fetch' | 'dimension_normalise'
const DIMENSION_CODE: Record<
  DimensionStage,
  'DIMENSION_FETCH_FAILED' | 'DIMENSION_NORMALISE_FAILED'
> = {
  dimension_fetch: 'DIMENSION_FETCH_FAILED',
  dimension_normalise: 'DIMENSION_NORMALISE_FAILED',
}

/**
 * Run one labelled dimension operation. A `SyncError` — our own fail-loud codes
 * (`MALFORMED_RESPONSE`, `CROSS_ACCOUNT`, `CONFLICTING_DUPLICATE`, …) — keeps its
 * precise code and message, but is STAMPED with this step's stage if it has none
 * of its own, so a structural fault raised deep in the step (e.g. a creative
 * `CONFLICTING_DUPLICATE` from `mergeCreativesById`) is recorded under
 * `dimension_normalise` rather than the catch-all `fetch`. Anything else (a
 * `MetaRequestError` in a fetch step, a `MetaValidationError` in a normalise
 * step) is classified and rewrapped with THIS stage's code and name.
 */
async function dimensionStep<T>(
  stage: DimensionStage,
  detail: string,
  run: () => Promise<T> | T,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof SyncError) throw error.stampStage(stage)
    // Carry Meta's own sanitised classifiers (type/code/subcode/fbtrace/redacted
    // message) onto the wrapper when the cause is a failing Meta request, so a
    // read-only preflight can surface the REAL reason behind the generic
    // DIMENSION_FETCH_FAILED — the exact fields the diagnostic already prints.
    const metaError =
      error instanceof MetaRequestError ? error.metaError : undefined
    // Retain the raw underlying error as the wrapper's native `Error.cause` for
    // EVERY dimension operation — the account, campaign, ad-set and ad fetches
    // and all five normalisers — not just the account fetch. Diagnosis-only; the
    // sanitised classifiers above are what the CLI and `sync_runs.errors` read.
    throw new SyncError(
      DIMENSION_CODE[stage],
      detail,
      classifyCause(error),
      stage,
      metaError,
      error,
    )
  }
}

interface DimensionOutcome {
  input: IngestInput // insights: [] — this phase never touches the insights edge
  currency: string
  fetched: number
  normalised: number
  rateLimit: SanitisedRateLimit
}

/**
 * Fetch, page-dedupe, account-check and normalise the four account dimensions
 * plus the inline creatives. NEVER touches the insights edge or the database, so
 * it is the exact orchestration a read-only preflight can stop at.
 *
 * The phase is split into an explicit FETCH span and an explicit NORMALISE span
 * with lifecycle markers between them: every `fetch*` call is wrapped with the
 * fetch label, every `normalize*` with the normalise label. The raw-shape guards
 * in between (`dedupeRawById`, `assertRawSameAccount`, the empty-account check)
 * raise their own `SyncError` codes and are intentionally left unwrapped so they
 * bubble with their precise meaning.
 */
async function fetchNormalizeDimensions(
  deps: SyncDeps,
): Promise<DimensionOutcome> {
  const expected = deps.config.adAccountId
  const fetchDeps: FetchDeps = {
    config: deps.config,
    fetchImpl: deps.fetchImpl,
    sleepImpl: deps.sleepImpl,
    maxPagesPerEdge: deps.maxPagesPerEdge,
  }
  const emit = (s: SyncLifecycleStage): void => deps.onStage?.(s)
  let rateLimit = emptyRateLimit()

  // --- FETCH span: only the four network edges throw here ---
  emit('dimension_fetch_start')
  const acc = await dimensionStep(
    'dimension_fetch',
    'the account dimension could not be fetched from Meta',
    () => fetchAdAccount(fetchDeps),
  )
  rateLimit = mergeRateLimit(rateLimit, acc.rateLimit)
  const rawAccounts = dedupeRawById(acc.data, 'account')
  if (rawAccounts.length === 0) {
    throw new SyncError('MALFORMED_RESPONSE', 'ad account was not returned')
  }

  const camp = await dimensionStep(
    'dimension_fetch',
    'the campaign dimension could not be fetched from Meta',
    () => fetchCampaigns(fetchDeps),
  )
  rateLimit = mergeRateLimit(rateLimit, camp.rateLimit)
  assertRawSameAccount(camp.data, expected, 'campaign')
  const rawCampaigns = dedupeRawById(camp.data, 'campaign')

  const sets = await dimensionStep(
    'dimension_fetch',
    'the ad set dimension could not be fetched from Meta',
    () => fetchAdSets(fetchDeps),
  )
  rateLimit = mergeRateLimit(rateLimit, sets.rateLimit)
  assertRawSameAccount(sets.data, expected, 'ad set')
  const rawAdSets = dedupeRawById(sets.data, 'ad set')

  const adsRes = await dimensionStep(
    'dimension_fetch',
    'the ad dimension could not be fetched from Meta',
    () => fetchAds(fetchDeps),
  )
  rateLimit = mergeRateLimit(rateLimit, adsRes.rateLimit)
  assertRawSameAccount(adsRes.data, expected, 'ad')
  const rawAds = dedupeRawById(adsRes.data, 'ad')
  emit('dimension_fetch_complete')

  // --- NORMALISE span: only the offline validators throw here ---
  emit('dimension_normalise_start')
  const adAccounts = await dimensionStep(
    'dimension_normalise',
    'the account dimension failed normalisation/validation',
    () => rawAccounts.map(normalizeAdAccount),
  )
  const currency = adAccounts[0].currency
  const campaigns = await dimensionStep(
    'dimension_normalise',
    'the campaign dimension failed normalisation/validation',
    () => rawCampaigns.map(normalizeCampaign),
  )
  const adSets = await dimensionStep(
    'dimension_normalise',
    'the ad set dimension failed normalisation/validation',
    () => rawAdSets.map(normalizeAdSet),
  )
  const ads = await dimensionStep(
    'dimension_normalise',
    'the ad dimension failed normalisation/validation',
    () => rawAds.map(normalizeAd),
  )
  // `deriveCreatives` runs `normalizeCreative` (a MetaValidationError → this
  // stage) AND the semantic dedupe (a CONFLICTING_DUPLICATE SyncError → passes
  // through with its own code). Both are correct outcomes of this label.
  const creatives = await dimensionStep(
    'dimension_normalise',
    'the creative dimension failed normalisation/validation',
    () => deriveCreatives(rawAds),
  )
  emit('dimension_normalise_complete')

  const fetched =
    rawAccounts.length + rawCampaigns.length + rawAdSets.length + rawAds.length
  const normalised =
    adAccounts.length +
    campaigns.length +
    adSets.length +
    ads.length +
    creatives.length

  return {
    input: { adAccounts, campaigns, adSets, creatives, ads, insights: [] },
    currency,
    fetched,
    normalised,
    rateLimit,
  }
}

/**
 * A `MetaRequestError` that means "this specific node no longer exists / is not
 * visible" — a non-retryable client status (400/404). ONLY these are treated as
 * "Meta no longer exposes the ad", so recovery falls through to a tombstone. Auth
 * (401/403), throttling (429), server (5xx) and transport failures are NOT
 * swallowed: they rethrow, so a genuine infra problem fails the run loudly rather
 * than silently tombstoning live inventory.
 */
function isNodeGoneError(error: unknown): boolean {
  return (
    error instanceof MetaRequestError &&
    error.retryable === false &&
    (error.status === 400 || error.status === 404)
  )
}

/**
 * Build resolution B: recover one orphan ad directly from Meta by id (with its
 * inline creative and any parent dimensions the current graph lacks). Returns
 * `null` when Meta reports the ad as gone, so the resolver tombstones it. Parent
 * ad set / campaign are fetched ONLY when absent from the current listing.
 */
function metaAdRecovery(
  fetchDeps: FetchDeps,
  present: { adSets: ReadonlySet<string>; campaigns: ReadonlySet<string> },
  onRateLimit: (rl: SanitisedRateLimit) => void,
): (metaAdId: string) => Promise<RecoveredAd | null> {
  return async (metaAdId) => {
    let adNode: unknown
    try {
      const res = await fetchAdById(fetchDeps, metaAdId)
      onRateLimit(res.rateLimit)
      if (res.node === null) return null
      adNode = res.node
    } catch (error) {
      if (isNodeGoneError(error)) return null
      throw error
    }

    const ad = normalizeAd(adNode)
    const rawCreative = (adNode as Record<string, unknown>).creative
    const creative =
      rawCreative === undefined || rawCreative === null
        ? null
        : normalizeCreative(rawCreative)

    let adSet: RecoveredAd['adSet']
    if (ad.metaAdSetId !== null && !present.adSets.has(ad.metaAdSetId)) {
      try {
        const res = await fetchAdSetById(fetchDeps, ad.metaAdSetId)
        onRateLimit(res.rateLimit)
        adSet = res.node === null ? undefined : normalizeAdSet(res.node)
      } catch (error) {
        if (!isNodeGoneError(error)) throw error
      }
    }

    let campaign: RecoveredAd['campaign']
    if (
      ad.metaCampaignId !== null &&
      !present.campaigns.has(ad.metaCampaignId)
    ) {
      try {
        const res = await fetchCampaignById(fetchDeps, ad.metaCampaignId)
        onRateLimit(res.rateLimit)
        campaign = res.node === null ? undefined : normalizeCampaign(res.node)
      } catch (error) {
        if (!isNodeGoneError(error)) throw error
      }
    }

    return { ad, creative, adSet, campaign }
  }
}

async function fetchAndNormalize(
  request: SyncRequest,
  deps: SyncDeps,
): Promise<FetchNormalizeResult> {
  const expected = deps.config.adAccountId
  const fetchDeps: FetchDeps = {
    config: deps.config,
    fetchImpl: deps.fetchImpl,
    sleepImpl: deps.sleepImpl,
    maxPagesPerEdge: deps.maxPagesPerEdge,
  }
  const emit = (s: SyncLifecycleStage): void => deps.onStage?.(s)

  const windows =
    request.level === 'daily'
      ? [rollingRange(deps.todayIso, request.limits?.windowDays)]
      : chunkRange(assertRange(request), request.limits)

  // --- dimensions (any failure here fails the whole run) ---
  const dim = await fetchNormalizeDimensions(deps)
  let rateLimit = dim.rateLimit
  let fetched = dim.fetched
  let normalised = dim.normalised
  const currency = dim.currency
  let input: IngestInput = dim.input

  // --- insight windows (independent; a failure is skippable) ---
  emit('insights_fetch_start')
  const windowOutcomes: WindowResult[] = []
  for (const win of windows) {
    try {
      const res = await fetchInsightsWindow(fetchDeps, win.since, win.until)
      rateLimit = mergeRateLimit(rateLimit, res.rateLimit)
      assertRawSameAccount(res.data, expected, 'insight')
      const rawDeduped = dedupeRawInsights(res.data)
      fetched += rawDeduped.length // accepted after page dedup
      let normWin: NormalizedDailyInsight[]
      try {
        normWin = rawDeduped.map((r) =>
          normalizeDailyInsight(r, {
            currency,
            apiVersion: deps.config.apiVersion,
          }),
        )
      } catch {
        throw new SyncError(
          'MALFORMED_RESPONSE',
          'insight window failed validation',
        )
      }
      const deduped = dedupeStrict(normWin, INSIGHT_KEY, { label: 'insight' })
      // Canonicalise the account id so window insights match the account key
      // used when the dimension graph is written.
      const canonical = deduped.map((i) => ({
        ...i,
        metaAdAccountId: normalizeAdAccountId(i.metaAdAccountId),
      }))
      normalised += canonical.length
      windowOutcomes.push({
        since: win.since,
        until: win.until,
        status: 'success',
        insights: canonical,
      })
    } catch (error) {
      // Conflicting duplicates and cross-account are hard failures — rethrow.
      if (
        error instanceof SyncError &&
        (error.code === 'CONFLICTING_DUPLICATE' ||
          error.code === 'CROSS_ACCOUNT')
      ) {
        throw error
      }
      windowOutcomes.push({
        since: win.since,
        until: win.until,
        status: 'failed',
        insights: [],
        error,
      })
    }
  }

  emit('insights_fetch_complete')

  const allInsights = windowOutcomes
    .filter((w) => w.status === 'success')
    .flatMap((w) => w.insights)

  // Reconcile historical-orphan ads BEFORE referential validation. A historical
  // insight can reference an ad Meta has dropped from the current `/ads` listing
  // (deleted/archived) — an expected lifecycle condition, not a fatal fault. The
  // resolver re-attaches it to the real ad (local DB, then direct Meta fetch) or,
  // when Meta no longer exposes it anywhere, a minimum-safe tombstone. A genuinely
  // unresolved PARENT (ad set/campaign/account) is left unfilled, so it still
  // fails loud in `assertGraphConsistency` below. Runs BEFORE canonicalisation so
  // recovered/tombstone account ids are canonicalised with everything else.
  const present = {
    adSets: new Set(input.adSets.map((s) => s.metaAdSetId)),
    campaigns: new Set(input.campaigns.map((c) => c.metaCampaignId)),
  }
  const resolution = await resolveOrphanAds(
    { ...input, insights: allInsights },
    {
      lookupLocalAds: deps.localAdLookup,
      recoverFromMeta: metaAdRecovery(fetchDeps, present, (rl) => {
        rateLimit = mergeRateLimit(rateLimit, rl)
      }),
    },
  )

  input = canonicalizeAccountIds(resolution.input)
  assertConsistentAccount(input, expected)
  assertGraphConsistency(input)

  const entitiesRequested = entitiesOf(input)
  const requested =
    entitiesRequested.adAccounts +
    entitiesRequested.campaigns +
    entitiesRequested.adSets +
    entitiesRequested.creatives +
    entitiesRequested.ads +
    entitiesRequested.dailyInsights

  return {
    input,
    windowOutcomes,
    counts: { fetched, normalised, requested },
    entitiesRequested,
    rateLimit,
    orphanResolution: resolution.report,
  }
}

function assertRange(request: SyncRequest): { since: string; until: string } {
  if (request.range === undefined) {
    throw new SyncError('INVALID_REQUEST', 'a date range is required')
  }
  return request.range
}

// --- dry-run (no database, written always 0) -------------------------------

export interface DryRunResult {
  mode: 'dry-run'
  status: SyncRunStatus
  counts: SyncCounts
  /**
   * Per-entity breakdown of `counts.requested` — the row count each table is
   * EXPECTED to reach. This is the dry-run's per-table prediction, to be compared
   * against live `SELECT count(*)` after a write (docs/STAGE-9-RUNBOOK.md).
   */
  entitiesRequested: EntityCounts
  /** All zeros: a dry-run writes nothing, so `counts.written` is always 0. */
  entitiesWritten: EntityCounts
  windows: { since: string; until: string; status: 'success' | 'failed' }[]
  warnings: StructuredSyncError[]
  rateLimit: SanitisedRateLimit
  /**
   * Secret-free summary of historical-orphan ad resolution (see
   * src/sync/orphanAds.ts): how many insight rows referenced an ad absent from the
   * current `/ads` listing and how each was resolved. NOTE: a dry-run has no
   * database, so resolution A (local reuse) never runs here — a dry-run reports
   * such ads under Meta-recovery or tombstone, where a live-write would reuse the
   * local row. All zeros when the run has no orphans.
   */
  orphanResolution: OrphanResolutionReport
}

export async function dryRunSync(
  request: SyncRequest,
  deps: SyncDeps,
): Promise<DryRunResult> {
  validateRequestShape(request)
  if (request.range) validateRange(request.range, deps.todayIso, request.limits)

  const fn = await fetchAndNormalize(request, deps)

  const succeeded = fn.windowOutcomes.filter((w) => w.status === 'success')
  const failed = fn.windowOutcomes.filter((w) => w.status === 'failed')

  // Fail loud on malformed data.
  for (const f of failed) {
    if (f.error instanceof SyncError && f.error.code === 'MALFORMED_RESPONSE') {
      throw f.error
    }
  }
  // All requested windows failing must fail the dry-run.
  if (fn.windowOutcomes.length > 0 && succeeded.length === 0) {
    throw failed[0].error
  }

  const status = computeRunStatus(
    true,
    fn.windowOutcomes.map((w) => w.status),
  )
  return {
    mode: 'dry-run',
    status,
    counts: { ...fn.counts, written: 0 },
    entitiesRequested: fn.entitiesRequested,
    entitiesWritten: { ...ZERO_ENTITY_COUNTS },
    windows: fn.windowOutcomes.map((w) => ({
      since: w.since,
      until: w.until,
      status: w.status,
    })),
    warnings: failed.map((f) =>
      toStructuredError('insight_window', f.error, {
        windowStart: f.since,
        windowEnd: f.until,
        retryCount: 0,
      }),
    ),
    rateLimit: fn.rateLimit,
    orphanResolution: fn.orphanResolution,
  }
}

// --- preflight (read-only: fetch + normalise + validate; no insights, no db) --

export interface PreflightResult {
  mode: 'preflight'
  ok: true
  /**
   * Distinct record counts per dimension table. `dailyInsights` is always 0 —
   * the preflight deliberately never requests the insights edge.
   */
  entities: EntityCounts
  counts: { fetched: number; normalised: number }
  rateLimit: SanitisedRateLimit
}

/**
 * Read-only dress rehearsal of the sync's dimension phase. Fetches, page-dedupes,
 * account-checks, normalises and referential-checks the four dimensions plus the
 * inline creatives — the SAME orchestration a live-write runs — then STOPS: it
 * never requests the insights edge, never opens a database, never writes.
 *
 * A failure surfaces with the identical precise stage/code split as the live run
 * (`DIMENSION_FETCH_FAILED` for a fetch, `DIMENSION_NORMALISE_FAILED` for a
 * post-fetch schema drift, and the fail-loud `CROSS_ACCOUNT` / `ORPHAN_ENTITY` /
 * `CONFLICTING_DUPLICATE` codes for structural faults). So this is the command
 * that exposes the real failing step with no live side effect whatsoever.
 */
export async function preflightSync(
  request: SyncRequest,
  deps: SyncDeps,
): Promise<PreflightResult> {
  validateRequestShape(request)
  if (request.range) validateRange(request.range, deps.todayIso, request.limits)

  const dim = await fetchNormalizeDimensions(deps)

  // The same referential validation the full run applies, over the
  // dimension-only graph (insights empty). Cross-account and orphan
  // relationships fail loud here exactly as they would in a live run.
  const input = canonicalizeAccountIds(dim.input)
  assertConsistentAccount(input, deps.config.adAccountId)
  assertGraphConsistency(input)

  return {
    mode: 'preflight',
    ok: true,
    entities: entitiesOf(input),
    counts: { fetched: dim.fetched, normalised: dim.normalised },
    rateLimit: dim.rateLimit,
  }
}

// --- live-write (one sync_runs row spanning fetch → write) -----------------

export interface LiveWriteResult {
  mode: 'live-write'
  syncRunId: string
  status: SyncRunStatus
  counts: SyncCounts
  /** Per-entity breakdown of `counts.requested`; its sum is `counts.requested`. */
  entitiesRequested: EntityCounts
  /**
   * Per-entity breakdown of `counts.written`; its sum is `counts.written`.
   *
   * Same semantics as `recordsWritten`: input records submitted to upserts that
   * committed — NOT measured row changes. Dimensions are all-or-nothing (one
   * transaction), so they are either the full requested breakdown or all zeros.
   */
  entitiesWritten: EntityCounts
  /**
   * The internal ad-account UUID recorded on the `sync_runs` row, or null when
   * the dimension transaction never committed (so no account was resolved).
   */
  adAccountId: string | null
  windows: WindowOutcome[]
  errors: StructuredSyncError[]
  rateLimit: SanitisedRateLimit
  finalised: boolean
  finalisationError?: StructuredSyncError
  /**
   * Secret-free summary of historical-orphan ad resolution (see
   * src/sync/orphanAds.ts): counts of insight rows whose ad was absent from the
   * current `/ads` listing and how each was resolved (local reuse / direct Meta
   * fetch / tombstone). All zeros when the run has no orphans, or when it failed
   * before resolution ran.
   */
  orphanResolution: OrphanResolutionReport
  /**
   * Secret-safe STRUCTURAL diagnostics for the operator, carried off any caught
   * `SyncError` that could pinpoint its own cause (today: a creative merge
   * conflict — field names, presence buckets, counts and categories only). Empty
   * on success. Never persisted to `sync_runs.errors`; the CLI prints them so a
   * `CONFLICTING_DUPLICATE` is actionable instead of opaque.
   */
  diagnostics: string[]
}

export async function liveWriteSync<
  Q extends PgQueryResultHKT,
  S extends Record<string, unknown>,
>(
  db: PgDatabase<Q, S>,
  request: SyncRequest,
  deps: SyncDeps,
): Promise<LiveWriteResult> {
  // Validate everything BEFORE creating the run row or fetching.
  validateRequestShape(request)
  if (request.range) validateRange(request.range, deps.todayIso, request.limits)

  // The run row is created before the first Meta request. This is the FIRST
  // database round-trip, and it sits OUTSIDE the try below by necessity: without
  // a run row there is nothing to record a failure against and nothing to
  // finalise. So a connection failure here (e.g. an unreachable direct-5432
  // endpoint, or the pooler refusing the connection) must be turned into a
  // fail-loud SyncError the CLI prints in full — otherwise it escapes as a raw
  // driver error and prints only the generic `sync failed (see sanitised
  // sync_runs errors)`, pointing the operator at a row that was never created.
  let syncRunId: string
  try {
    syncRunId = await startRun(
      db,
      {
        level: request.level,
        scope: request.scope,
        dateRangeStart: request.range?.since ?? null,
        dateRangeEnd: request.range?.until ?? null,
      },
      // Same bounded transient-retry policy the main write path uses, so a
      // pooler connection drop at run_start is retried rather than surfacing as
      // the terminal RUN_START_FAILED on the first blip.
      retryForStage(deps, 'run_start'),
    )
  } catch (error) {
    throw new SyncError(
      'RUN_START_FAILED',
      'the sync run could not be created — the database connection failed before any write (check the DATABASE_URL host/port is reachable; the runtime client targets the Supavisor transaction pooler on 6543)',
      classifyCause(error),
      'run_start',
      undefined,
      error,
    )
  }

  const errors: StructuredSyncError[] = []
  const diagnostics: string[] = []
  const windows: WindowOutcome[] = []
  const counts: SyncCounts = {
    fetched: 0,
    normalised: 0,
    requested: 0,
    written: 0,
  }
  let entitiesRequested: EntityCounts = { ...ZERO_ENTITY_COUNTS }
  const entitiesWritten: EntityCounts = { ...ZERO_ENTITY_COUNTS }
  // Stays null unless the dimension transaction COMMITS: the UUID is read from
  // the maps that transaction returns, so a rolled-back attempt can never
  // contribute one. A failure before/at dimensions leaves the run row's
  // ad_account_id NULL.
  let resolvedAdAccountId: string | null = null
  let rateLimit = emptyRateLimit()
  let status: SyncRunStatus = 'failed'
  let orphanResolution: OrphanResolutionReport = { ...EMPTY_ORPHAN_REPORT }
  const emit = (s: SyncLifecycleStage): void => deps.onStage?.(s)

  try {
    const fn = await fetchAndNormalize(request, deps)
    rateLimit = fn.rateLimit
    counts.fetched = fn.counts.fetched
    counts.normalised = fn.counts.normalised
    counts.requested = fn.counts.requested
    entitiesRequested = fn.entitiesRequested
    orphanResolution = fn.orphanResolution

    // Fetch-failed windows are failed outcomes carried into the combined status.
    for (const w of fn.windowOutcomes) {
      if (w.status === 'failed') {
        errors.push(
          toStructuredError('insight_window', w.error, {
            windowStart: w.since,
            windowEnd: w.until,
            retryCount: 0,
          }),
        )
        windows.push({
          start: w.since,
          end: w.until,
          status: 'failed',
          written: 0,
        })
      }
    }

    emit('database_write_start')
    const dimResult = await writeDimensions(
      db,
      fn.input,
      retryForStage(deps, 'database_write'),
    )
    if (!dimResult.ok) {
      errors.push(
        toStructuredError('dimensions', dimResult.error, {
          retryCount: dimResult.attempts - 1,
        }),
      )
      status = 'failed'
    } else {
      counts.written += dimResult.value.written
      const maps = dimResult.value
      // The dimension transaction committed, so these UUIDs name rows that
      // really exist. Assign the per-entity dimension breakdown wholesale: the
      // transaction is all-or-nothing, so there is no partial dimension state.
      Object.assign(entitiesWritten, maps.counts)
      // assertConsistentAccount has already proven a single account, so the
      // account list holds exactly one canonicalised entry.
      const account = fn.input.adAccounts[0]
      resolvedAdAccountId =
        account === undefined
          ? null
          : (maps.accounts.get(account.metaAdAccountId)?.id ?? null)
      for (const w of fn.windowOutcomes) {
        if (w.status !== 'success') continue
        const res = await writeInsightWindow(
          db,
          { start: w.since, end: w.until, insights: w.insights },
          maps,
          retryForStage(deps, 'insight_window'),
        )
        if (res.ok) {
          counts.written += res.value
          entitiesWritten.dailyInsights += res.value
          windows.push({
            start: w.since,
            end: w.until,
            status: 'success',
            written: res.value,
          })
        } else {
          errors.push(
            toStructuredError('insight_window', res.error, {
              windowStart: w.since,
              windowEnd: w.until,
              retryCount: res.attempts - 1,
            }),
          )
          windows.push({
            start: w.since,
            end: w.until,
            status: 'failed',
            written: 0,
          })
        }
      }
      status = computeRunStatus(
        true,
        windows.map((w) => w.status),
      )
      emit('database_write_complete')
    }
  } catch (error) {
    // Dimension fetch/normalise failure, conflict, orphan, cross-account.
    //
    // retryCount comes from the classified cause, NOT a constant: the graph
    // client retries internally (429/5xx/transport) and those retries are
    // invisible here. A hardcoded 0 previously reported "no retries" for a run
    // that had exhausted the full ladder. Errors we raise ourselves carry no
    // cause and were genuinely not retried, so they still record 0.
    const cause =
      error instanceof SyncError ? error.sanitisedCause : classifyCause(error)
    // Record the phase the error names itself with (e.g. `dimension_normalise`)
    // rather than a single catch-all `fetch`, so the stored error and the CLI
    // agree on which step failed. Errors without a stage keep the old default.
    const stage =
      error instanceof SyncError && error.stage !== undefined
        ? error.stage
        : 'fetch'
    errors.push(
      toStructuredError(stage, error, {
        retryCount: cause?.retryCount ?? 0,
        cause,
      }),
    )
    // Carry the error's own secret-safe structural diagnostic (e.g. the creative
    // merge conflict's differing fields) to the operator. It is not persisted —
    // `toStructuredError` above never reads it — only surfaced by the CLI.
    if (error instanceof SyncError && error.diagnostic !== undefined) {
      diagnostics.push(error.diagnostic)
    }
    status = 'failed'
  }

  // Finalisation is always attempted; a finalisation failure is surfaced
  // separately and never overwrites the earlier data errors.
  const outcome: RunOutcome = {
    status,
    recordsRequested: counts.requested,
    recordsWritten: counts.written,
    errors,
    rateLimitInfo: rateLimit,
    adAccountId: resolvedAdAccountId,
  }
  const finishImpl = deps.finishRunImpl ?? finishRun
  let finalised = true
  let finalisationError: StructuredSyncError | undefined
  try {
    await finishImpl(db, syncRunId, outcome)
  } catch {
    finalised = false
    finalisationError = toStructuredError(
      'finalise',
      new SyncError('FINALISE_FAILED', 'sync run finalisation failed'),
      { retryCount: 0 },
    )
  }

  return {
    mode: 'live-write',
    syncRunId,
    status,
    counts,
    entitiesRequested,
    entitiesWritten,
    adAccountId: resolvedAdAccountId,
    windows,
    errors,
    rateLimit,
    finalised,
    finalisationError,
    diagnostics,
    orphanResolution,
  }
}
