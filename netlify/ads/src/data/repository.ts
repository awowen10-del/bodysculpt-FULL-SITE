/**
 * The dashboard repository contract (Stage 10, Phase 3).
 *
 * The UI depends ONLY on this interface — never on the seed, the metrics layer,
 * the database, or Meta. Every method returns a `Promise` FROM DAY ONE, so the
 * offline seed-backed implementation and a future async API/database-backed
 * implementation are drop-in interchangeable with zero call-site changes.
 *
 * Every value returned is a JSON-safe DTO (see `dto.ts`): no `bigint`, no `Date`,
 * no database-native objects cross this boundary.
 */
import type {
  DataStateDTO,
  SummaryDTO,
  CampaignDTO,
  AdSetDTO,
  AdDTO,
  AdDetailDTO,
  DailyRowDTO,
  CreativeRowDTO,
  CreativeContextDTO,
} from './dto.ts'

export type { CreativeContextDTO }
import type { ObjectiveFamily } from '../metrics/index.ts'

/** How the ranked creative list is ordered. `rank` is the default decision-first order. */
export type CreativeSort = 'rank' | 'cost' | 'volume' | 'name'

/** Query for the ranked creative view: window + optional cohort filter + sort. */
export interface CreativeQuery extends DateRangeQuery {
  family?: ObjectiveFamily
  optimizationEvent?: string
  sort?: CreativeSort
}

/** An inclusive `YYYY-MM-DD` date filter; omit a bound to open that end. */
export interface DateRangeQuery {
  start?: string
  end?: string
}

export interface AdSetQuery extends DateRangeQuery {
  campaignId?: string
}

export interface AdQuery extends DateRangeQuery {
  campaignId?: string
  adSetId?: string
}

export interface DailyQuery extends DateRangeQuery {
  campaignId?: string
  adSetId?: string
  adId?: string
  creativeId?: string
}

/**
 * Read-only dashboard data access. Implementations must be side-effect free from
 * the caller's perspective and must never throw on unknown ids — they return an
 * empty list or a not-found (`null`) result instead.
 */
export interface DashboardRepository {
  /** Dataset provenance, window, default visible date and entity counts. */
  getDataState(): Promise<DataStateDTO>

  /** Account-level totals/ratios for the range (default: the full seed window). */
  getSummary(query?: DateRangeQuery): Promise<SummaryDTO>

  /** Every campaign with its aggregated metrics for the range. */
  listCampaigns(query?: DateRangeQuery): Promise<CampaignDTO[]>

  /** Ad sets, optionally filtered to a campaign, each with aggregated metrics. */
  listAdSets(query?: AdSetQuery): Promise<AdSetDTO[]>

  /** Ads, optionally filtered to a campaign and/or ad set, with aggregated metrics. */
  listAds(query?: AdQuery): Promise<AdDTO[]>

  /** One ad with its creative (or a safe no-creative state); null if unknown. */
  getAd(adId: string, query?: DateRangeQuery): Promise<AdDetailDTO | null>

  /** Per-day aggregated metrics for the selected scope, in ascending date order. */
  getDaily(query?: DailyQuery): Promise<DailyRowDTO[]>

  /**
   * Every ranked row with its metrics + deterministic verdict, aggregated BY
   * (creative × ad set) — the same creative running in two ad sets yields two rows,
   * each with its own `rowId` and its own verdict.
   */
  listCreatives(query?: CreativeQuery): Promise<CreativeRowDTO[]>

  /**
   * One row by its composite `rowId` (see `makeRowId`), or null if unknown. For the
   * creative detail view. The `rowId` — not `creative.id` — is the stable key.
   */
  getCreative(
    rowId: string,
    query?: DateRangeQuery,
  ): Promise<CreativeRowDTO | null>
}
