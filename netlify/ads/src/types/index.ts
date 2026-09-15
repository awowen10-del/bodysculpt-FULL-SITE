// Shared TypeScript types for the whole app live here.
//
// Stage 5 populates the NORMALISED Meta shapes: the output of the field-mapping
// layer (`src/meta/normalize.ts`). These are keyed by Meta natural ids (strings)
// — UUID foreign-key resolution and database upserts are deferred to the write
// stage. Integer counts are `bigint` (lossless, never JavaScript `Number`);
// decimals are exact strings; genuine absence is `null`.

// --- lead-definition configuration -----------------------------------------

/**
 * Named, mutually-exclusive lead-definition modes. `unresolved` is the shipped
 * default: no authoritative lead total is computed and `leads` stays null until
 * an explicit, reviewed configuration change selects a working mode.
 */
export type LeadMode =
  | 'unresolved'
  | 'generic_aggregate'
  | 'components'
  | 'native_only'
  | 'website_only'

export type LeadDefinitionStatus = 'provisional_unverified' | 'verified'

/**
 * Why a row has no authoritative lead total.
 *
 * - `definition_unresolved` — the configured mode is `unresolved`.
 * - `generic_lead_absent`  — the canonical generic `lead` action_type is missing
 *   from a row that nevertheless carries component lead events. We refuse to
 *   invent a total by summing components (they may overlap), so the row is
 *   unresolved rather than wrong.
 */
export type LeadUnresolvedReason =
  'definition_unresolved' | 'generic_lead_absent'

/** A lead definition is DATA: the engine reads it; no mode is hard-coded in logic. */
export interface LeadDefinition {
  mode: LeadMode
  /** The exact Meta `action_type` values this mode sums (empty for `unresolved`). */
  actionTypes: readonly string[]
  status: LeadDefinitionStatus
  label: string
}

/**
 * The component lead action_types, tallied for DIAGNOSTICS ONLY. These are never
 * summed into the production total (they may overlap, and Meta already supplies
 * the canonical generic `lead` roll-up).
 *
 * `null` means the action_type was ABSENT from the row — distinct from `0n`,
 * which Meta effectively never emits but which would be a genuine zero.
 */
export interface LeadComponentBreakdown {
  /** `onsite_conversion.lead_grouped` — native Instant Form leads. */
  native: bigint | null
  /** `offsite_conversion.fb_pixel_lead` — website Pixel `Lead` events. */
  website: bigint | null
  /** `onsite_web_lead` — the mixed WEBSITE_AND_LEAD_FORM on-site web lead. */
  onsiteWeb: bigint | null
}

/**
 * Whether the components reconcile against the canonical generic `lead`.
 * `reconciled` when native + website equals generic. A `mismatch` NEVER changes
 * the scoring figure — the generic roll-up still wins; the row is only flagged.
 */
export type LeadReconciliationStatus =
  'reconciled' | 'mismatch' | 'not_applicable'

export interface LeadReconciliation {
  status: LeadReconciliationStatus
  /** Meta's canonical roll-up for the row (null when absent). */
  generic: bigint | null
  /** native + website, for comparison only — never used for scoring. */
  componentSum: bigint | null
  /** `componentSum - generic` (null when either side is absent). */
  delta: bigint | null
}

/** Result of extracting leads for a single insight row. */
export interface LeadExtractionResult {
  /** null when no authoritative total exists — see `unresolvedReason`. */
  value: bigint | null
  /** The exact action_types summed (provenance); empty when unresolved. */
  actionTypesUsed: string[]
  mode: LeadMode
  status: LeadDefinitionStatus
  /** Populated exactly when `value` is null. */
  unresolvedReason: LeadUnresolvedReason | null
  /** Diagnostic component tallies — preserved, never added into `value`. */
  components: LeadComponentBreakdown
  /** Diagnostic reconciliation of components against the canonical roll-up. */
  reconciliation: LeadReconciliation
}

// --- normalised dimension entities -----------------------------------------

export interface NormalizedAdAccount {
  metaAdAccountId: string
  name: string | null
  currency: string
  timezoneName: string
  accountStatus: string | null
}

export interface NormalizedCampaign {
  metaCampaignId: string
  metaAdAccountId: string | null
  name: string | null
  objective: string | null
  status: string | null
  effectiveStatus: string | null
  buyingType: string | null
  createdTime: Date | null
  startTime: Date | null
  stopTime: Date | null
  updatedTime: Date | null
}

export interface NormalizedAdSet {
  metaAdSetId: string
  metaCampaignId: string | null
  metaAdAccountId: string | null
  name: string | null
  status: string | null
  effectiveStatus: string | null
  /** Meta returns budgets as minor-unit integer strings (e.g. pence). */
  dailyBudgetMinor: bigint | null
  lifetimeBudgetMinor: bigint | null
  optimizationGoal: string | null
  billingEvent: string | null
  bidStrategy: string | null
  /**
   * Where the ad set sends conversions (`WEBSITE`, `ON_AD` for Instant Form, …).
   * Supporting context for eligibility; never the sole proof of a lead.
   */
  destinationType: string | null
  /**
   * The raw `promoted_object` as returned — the AUTHORITATIVE source for whether a
   * conversion ad set optimises for a lead. Stored structured (JSONB) so the exact
   * `custom_event_type` / `custom_conversion_id` / `pixel_rule` survive for central
   * eligibility resolution and future reclassification (never collapsed to a boolean).
   */
  promotedObject: unknown
  /** The raw `targeting` object as returned — unknown JSON, stored as JSONB. */
  targetingSummary: unknown
  startTime: Date | null
  endTime: Date | null
  updatedTime: Date | null
}

export interface NormalizedAd {
  metaAdId: string
  metaAdSetId: string | null
  metaCampaignId: string | null
  metaAdAccountId: string | null
  name: string | null
  status: string | null
  effectiveStatus: string | null
  /** Reference to the backing creative by Meta id (an ad references a creative). */
  metaCreativeId: string | null
  createdTime: Date | null
  updatedTime: Date | null
  /**
   * TRUE only for a minimum-safe TOMBSTONE ad synthesised by the historical-orphan
   * resolver to preserve a historical insight whose ad Meta no longer exposes
   * anywhere (see src/sync/orphanAds.ts). Such an ad carries no fabricated
   * identity — name/status/creative stay null; this flag is the honest
   * "unavailable/deleted historical inventory" signal. Absent/false for every ad
   * fetched live, recovered from the local DB, or recovered directly from Meta.
   */
  historicalPlaceholder?: boolean
}

export interface NormalizedCreative {
  metaCreativeId: string
  objectType: string | null
  primaryText: string | null
  headline: string | null
  description: string | null
  ctaType: string | null
  destinationUrl: string | null
  imageUrl: string | null
  thumbnailUrl: string | null
  videoId: string | null
  /** Object-shaped creative specs (object_story_spec / asset_feed_spec), as JSONB. */
  assetMetadata: unknown
}

// --- normalised daily fact --------------------------------------------------

export interface NormalizedDailyInsight {
  // identity (Meta natural keys; UUID resolution deferred to the write stage)
  metaAdId: string
  metaAdSetId: string
  metaCampaignId: string
  metaAdAccountId: string
  date: string // YYYY-MM-DD; date_start == date_stop is enforced
  currency: string
  apiVersion: string

  // additive base metrics (source of truth)
  spend: string | null // major-unit decimal, exact
  impressions: bigint | null
  reach: bigint | null
  clicks: bigint | null
  inlineLinkClicks: bigint | null
  outboundClicks: bigint | null // reduced from the outbound_clicks action-stat array
  videoPlayActions: bigint | null
  videoP25WatchedActions: bigint | null
  videoP50WatchedActions: bigint | null
  videoP75WatchedActions: bigint | null
  videoP95WatchedActions: bigint | null
  videoP100WatchedActions: bigint | null

  // extracted, config-driven (null while lead definition is `unresolved`)
  leads: bigint | null
  leadsActionType: string | null
  landingPageViews: bigint | null
  landingPageViewsActionType: string | null

  // Meta-reported ratios/costs — PROVENANCE ONLY (exact decimal strings)
  reportedFrequency: string | null
  reportedCpm: string | null
  reportedCtr: string | null
  reportedCpc: string | null
  reportedInlineLinkClickCtr: string | null
  reportedCostPerInlineLinkClick: string | null
  reportedOutboundClicksCtr: string | null
  reportedCostPerOutboundClick: string | null
  reportedCostPerThruplay: string | null
  reportedVideoAvgTimeWatchedActions: string | null

  // raw nested arrays (aggregate counts by action_type — no PII) + provenance
  actions: unknown
  actionValues: unknown
  costPerActionType: unknown
  attributionSetting: string | null
  /** Strict allow-listed provenance snapshot — never ids/urls/headers/PII. */
  rawSnapshot: Record<string, unknown>
}

// --- Stage 6 ingestion (write layer) ---------------------------------------

/** `sync_runs.level` — mirrors the schema's documented values. */
export type SyncRunLevel = 'backfill' | 'daily' | 'manual' | 'reconciliation'
/** `sync_runs.scope` — only a full+success run may ever drive miss-reconciliation. */
export type SyncRunScope = 'full' | 'incremental' | 'filtered'
/** `sync_runs.status` — terminal states (success/partial/failed) are never reopened. */
export type SyncRunStatus = 'running' | 'success' | 'partial' | 'failed'

/**
 * The normalised graph presented to the write layer for one ingestion run. All
 * entities are Stage 5 outputs keyed by Meta natural ids; UUIDs are resolved
 * during ingestion.
 */
export interface IngestInput {
  adAccounts: NormalizedAdAccount[]
  campaigns: NormalizedCampaign[]
  adSets: NormalizedAdSet[]
  creatives: NormalizedCreative[]
  ads: NormalizedAd[]
  insights: NormalizedDailyInsight[]
}

/** Descriptive metadata for the `sync_runs` row. */
export interface IngestRunMeta {
  level: SyncRunLevel
  scope: SyncRunScope
  dateRangeStart?: string | null
  dateRangeEnd?: string | null
}

/**
 * Per-entity breakdown of a run's records (Stage 9).
 *
 * These are INPUT-record counts, in the same currency as `recordsRequested` /
 * `recordsWritten` — NOT independently measured database row counts. They exist
 * so a dry-run can state the row count each table is expected to reach, giving a
 * per-table expectation to compare live `SELECT count(*)` against. See the count
 * semantics on `IngestResult`.
 */
export interface EntityCounts {
  adAccounts: number
  campaigns: number
  adSets: number
  creatives: number
  ads: number
  dailyInsights: number
}

/** The five dimension entities, without the daily fact. */
export type DimensionEntityCounts = Omit<EntityCounts, 'dailyInsights'>

export const ZERO_ENTITY_COUNTS: Readonly<EntityCounts> = Object.freeze({
  adAccounts: 0,
  campaigns: 0,
  adSets: 0,
  creatives: 0,
  ads: 0,
  dailyInsights: 0,
})

/** Sum a breakdown; must always equal the matching aggregate. */
export function totalEntityCounts(counts: EntityCounts): number {
  return (
    counts.adAccounts +
    counts.campaigns +
    counts.adSets +
    counts.creatives +
    counts.ads +
    counts.dailyInsights
  )
}

/**
 * How an underlying exception was classified, without retaining the exception.
 *
 * `DIMENSION_FETCH_FAILED` is raised for ANY non-SyncError thrown while fetching
 * or normalising dimensions, so the code alone cannot distinguish a throttled
 * request from an expired token from a schema drift. This kind is the smallest
 * fact that separates them.
 */
export type SyncErrorCauseKind = 'network' | 'http' | 'validation' | 'unknown'

/**
 * A SANITISED classification of the exception underlying a StructuredSyncError.
 *
 * This is a CLASSIFICATION, never a copy: the original exception's message,
 * stack, url, headers and body are all discarded before this is built. Only the
 * fields below may ever be recorded — a numeric HTTP status, the retryability of
 * that status, and how many retries were actually performed. Nothing here can
 * carry a token, url, header, Meta id or response body.
 */
export interface SanitisedCause {
  kind: SyncErrorCauseKind
  /** HTTP only: the numeric status (e.g. 401, 429). Never a url/body/header. */
  status?: number
  /** Whether the graph client's retry policy treats this failure as retryable. */
  retryable?: boolean
  /** Retries actually performed before the failure (0 = failed on first try). */
  retryCount?: number
}

/**
 * A structured, SANITISED error stored in `sync_runs.errors`. It never contains
 * connection strings, DATABASE_URL, tokens, headers, SQL text, stack traces,
 * raw payloads, or personal lead data.
 */
export interface StructuredSyncError {
  stage: string
  /** A safe code (SQLSTATE, or an ingest-level code like CURRENCY_MISMATCH). */
  code: string
  /** Present only for insight-window failures. */
  windowStart?: string
  windowEnd?: string
  /** Redacted, single-line, truncated message. */
  message: string
  /** How many transient retries were attempted before this failure (0 if none). */
  retryCount: number
  /**
   * Sanitised classification of the underlying exception, when one was
   * classified. Optional: absent on errors raised by our own layers, which
   * already carry a meaningful `code`.
   */
  cause?: SanitisedCause
}

/** Per-window outcome for observability/tests. */
export interface WindowOutcome {
  start: string
  end: string
  status: 'success' | 'failed'
  /** Insight rows committed by this window (0 if it failed/rolled back). */
  written: number
}

/**
 * The result of one ingestion run.
 *
 * COUNT SEMANTICS (documented, tested):
 * - `recordsRequested` = distinct INPUT records intended for persistence, counted
 *   ONCE before any retries: deduped dimension records (accounts + campaigns +
 *   ad sets + creatives + ads, by Meta id) PLUS deduped daily-insight rows (by
 *   `(metaAdId, date)`).
 * - `recordsWritten` = distinct INPUT records SUBMITTED TO UPSERT OPERATIONS THAT
 *   THEN COMMITTED, counted ONCE regardless of retries: dimension records from a
 *   committed dimension transaction PLUS insight rows from committed windows. A
 *   rolled-back window contributes 0. Retried attempts, database statements, and
 *   RETURNING rows are never counted as extra.
 *
 * WHAT `recordsWritten` IS NOT (Stage 9 — read before trusting it):
 *   It is NOT an independently measured count of rows inserted or updated. It is
 *   derived from the INPUT lists, not from the database's own report of what
 *   changed: an upsert that inserts a row, an upsert that updates a row, and an
 *   upsert that rewrites a row with identical values all count exactly 1. Nothing
 *   reads `rowCount` or `RETURNING`.
 *
 *   Consequently, on a fully successful run `recordsWritten === recordsRequested`
 *   BY CONSTRUCTION — the two cannot disagree, so their agreement proves nothing
 *   and is not evidence that any row reached the database.
 *
 *   Post-write verification MUST therefore use direct `SELECT count(*)` against
 *   each table (see docs/STAGE-9-RUNBOOK.md), never this field. `EntityCounts`
 *   gives the per-table expectation to compare those counts against; it shares
 *   these same semantics and carries the same caveat.
 */
export interface IngestResult {
  syncRunId: string
  status: SyncRunStatus
  recordsRequested: number
  recordsWritten: number
  windows: WindowOutcome[]
  errors: StructuredSyncError[]
}
