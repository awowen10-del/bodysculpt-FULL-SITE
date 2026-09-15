/**
 * Source-neutral, in-memory dashboard engine (Stage 11C).
 *
 * This is the ONE implementation of every `DashboardRepository` method. It reads a
 * fully-normalised in-memory `DashboardDataset` and serves it through the DTO
 * boundary, computing every number via the single metrics layer
 * (`aggregateInsights`) and every creative score via the shared `creativeAssembly`.
 *
 * The SEED repository wraps this over the offline seed dataset; the SERVER
 * repository wraps it over a dataset materialised from Postgres. Because both run
 * the identical code, the offline and production paths are behaviourally identical
 * by construction — not merely by test (the parity suite proves it end to end).
 *
 * BROWSER-SAFE and TRANSPORT-FREE: no database, no HTTP, no window validation
 * (that is a server/transport concern applied by the caller).
 */
import type {
  NormalizedCampaign,
  NormalizedAdSet,
  NormalizedAd,
  NormalizedCreative,
  NormalizedDailyInsight,
} from '../types/index.ts'
import { aggregateInsights } from '../metrics/index.ts'
import type {
  DashboardRepository,
  DateRangeQuery,
  AdSetQuery,
  AdQuery,
  DailyQuery,
  CreativeQuery,
} from './repository.ts'
import type {
  DataStateDTO,
  SummaryDTO,
  CampaignDTO,
  AdSetDTO,
  AdDTO,
  AdDetailDTO,
  DailyRowDTO,
  CreativeRowDTO,
} from './dto.ts'
import {
  adSetToDTO,
  adToDTO,
  campaignToDTO,
  creativeRowToDTO,
  creativeToDTO,
  toMetricSetDTO,
} from './dto.ts'
import {
  buildCreativeRows,
  creativeComparator,
  insightHasDelivery,
} from './creativeAssembly.ts'

/** Provenance/rendering metadata about a dataset window. */
export interface DashboardMeta {
  /** True only for the illustrative seed source; false for production data. */
  illustrative: boolean
  disclaimer: string
  currency: string | null
  /** Oldest available day (`YYYY-MM-DD`), or '' when there is no data. */
  startDate: string
  /** Newest available day; the dashboard's default visible date, or ''. */
  endDate: string
  days: number
}

/** The normalised graph the engine serves. Field-compatible with `SeedDataset`. */
export interface DashboardDataset {
  campaigns: readonly NormalizedCampaign[]
  adSets: readonly NormalizedAdSet[]
  ads: readonly NormalizedAd[]
  creatives: readonly NormalizedCreative[]
  insights: readonly NormalizedDailyInsight[]
  meta: DashboardMeta
}

/** A resolved, inclusive date window (defaults to the full dataset range). */
interface Range {
  start: string
  end: string
}

/** Scope filters applied on top of a date range. */
interface Scope {
  campaignId?: string
  adSetId?: string
  adId?: string
  creativeId?: string
}

/** Build a `DashboardRepository` over an in-memory normalised dataset. */
export function createDatasetRepository(
  dataset: DashboardDataset,
): DashboardRepository {
  const fullRange: Range = {
    start: dataset.meta.startDate,
    end: dataset.meta.endDate,
  }

  const creativeIdByAd = new Map(
    dataset.ads.map((a) => [a.metaAdId, a.metaCreativeId]),
  )

  function resolveRange(query?: DateRangeQuery): Range {
    return {
      start: query?.start ?? fullRange.start,
      end: query?.end ?? fullRange.end,
    }
  }

  function select(range: Range, scope: Scope): NormalizedDailyInsight[] {
    return dataset.insights.filter((row) => {
      if (row.date < range.start || row.date > range.end) return false
      if (
        scope.campaignId !== undefined &&
        row.metaCampaignId !== scope.campaignId
      )
        return false
      if (scope.adSetId !== undefined && row.metaAdSetId !== scope.adSetId)
        return false
      if (scope.adId !== undefined && row.metaAdId !== scope.adId) return false
      if (
        scope.creativeId !== undefined &&
        creativeIdByAd.get(row.metaAdId) !== scope.creativeId
      )
        return false
      return true
    })
  }

  function metricsFor(range: Range, scope: Scope) {
    return toMetricSetDTO(aggregateInsights(select(range, scope)))
  }

  function creativeRows() {
    return buildCreativeRows({
      campaigns: dataset.campaigns,
      adSets: dataset.adSets,
      ads: dataset.ads,
      creatives: dataset.creatives,
      insights: dataset.insights,
      // Every verdict runs from its campaign's launch to the newest synced day.
      windowEnd: fullRange.end,
    })
  }

  return {
    async getDataState(): Promise<DataStateDTO> {
      return {
        illustrative: dataset.meta.illustrative,
        disclaimer: dataset.meta.disclaimer,
        currency: dataset.meta.currency,
        range: { start: fullRange.start, end: fullRange.end },
        defaultDate: dataset.meta.endDate,
        days: dataset.meta.days,
        counts: {
          campaigns: dataset.campaigns.length,
          adSets: dataset.adSets.length,
          ads: dataset.ads.length,
          insightRows: dataset.insights.length,
        },
      }
    },

    async getSummary(query?: DateRangeQuery): Promise<SummaryDTO> {
      const range = resolveRange(query)
      const rows = select(range, {})
      return {
        scope: 'account',
        range,
        rowCount: rows.length,
        currency: dataset.meta.currency,
        metrics: toMetricSetDTO(aggregateInsights(rows)),
      }
    },

    async listCampaigns(query?: DateRangeQuery): Promise<CampaignDTO[]> {
      const range = resolveRange(query)
      // Newest delivering day per campaign across ALL data (not the window), so
      // ordering can surface live campaigns over old historical ones.
      const latestByCampaign = new Map<string, string>()
      for (const row of dataset.insights) {
        if (!insightHasDelivery(row)) continue
        const prev = latestByCampaign.get(row.metaCampaignId)
        if (prev === undefined || row.date > prev) {
          latestByCampaign.set(row.metaCampaignId, row.date)
        }
      }
      return [...dataset.campaigns]
        .sort((a, b) => a.metaCampaignId.localeCompare(b.metaCampaignId))
        .map((campaign) =>
          campaignToDTO(
            campaign,
            metricsFor(range, { campaignId: campaign.metaCampaignId }),
            latestByCampaign.get(campaign.metaCampaignId) ?? null,
            // Ad sets carry the schedule end for lifetime-budget campaigns.
            dataset.adSets,
          ),
        )
    },

    async listAdSets(query?: AdSetQuery): Promise<AdSetDTO[]> {
      const range = resolveRange(query)
      return [...dataset.adSets]
        .filter(
          (s) =>
            query?.campaignId === undefined ||
            s.metaCampaignId === query.campaignId,
        )
        .sort((a, b) => a.metaAdSetId.localeCompare(b.metaAdSetId))
        .map((adSet) =>
          adSetToDTO(adSet, metricsFor(range, { adSetId: adSet.metaAdSetId })),
        )
    },

    async listAds(query?: AdQuery): Promise<AdDTO[]> {
      const range = resolveRange(query)
      return [...dataset.ads]
        .filter(
          (a) =>
            (query?.campaignId === undefined ||
              a.metaCampaignId === query.campaignId) &&
            (query?.adSetId === undefined || a.metaAdSetId === query.adSetId),
        )
        .sort((a, b) => a.metaAdId.localeCompare(b.metaAdId))
        .map((ad) => adToDTO(ad, metricsFor(range, { adId: ad.metaAdId })))
    },

    async getAd(
      adId: string,
      query?: DateRangeQuery,
    ): Promise<AdDetailDTO | null> {
      const ad = dataset.ads.find((a) => a.metaAdId === adId)
      if (ad === undefined) return null // deliberate not-found, never a throw

      const range = resolveRange(query)
      const adDTO = adToDTO(ad, metricsFor(range, { adId }))

      const creative =
        ad.metaCreativeId === null
          ? undefined
          : dataset.creatives.find(
              (c) => c.metaCreativeId === ad.metaCreativeId,
            )

      return {
        ad: adDTO,
        hasCreative: creative !== undefined,
        creative: creative === undefined ? null : creativeToDTO(creative),
      }
    },

    async getDaily(query?: DailyQuery): Promise<DailyRowDTO[]> {
      const range = resolveRange(query)
      const rows = select(range, {
        campaignId: query?.campaignId,
        adSetId: query?.adSetId,
        adId: query?.adId,
        creativeId: query?.creativeId,
      })

      const byDate = new Map<string, NormalizedDailyInsight[]>()
      for (const row of rows) {
        const bucket = byDate.get(row.date) ?? []
        bucket.push(row)
        byDate.set(row.date, bucket)
      }

      return [...byDate.keys()]
        .sort((a, b) => a.localeCompare(b))
        .map((date) => {
          const dayRows = byDate.get(date)!
          return {
            date,
            rowCount: dayRows.length,
            metrics: toMetricSetDTO(aggregateInsights(dayRows)),
          }
        })
    },

    async listCreatives(query?: CreativeQuery): Promise<CreativeRowDTO[]> {
      // The window is per-campaign (launch → newest day); the query only filters
      // and sorts. Any start/end it carries no longer moves the verdict.
      let rows = creativeRows()

      if (query?.family !== undefined) {
        rows = rows.filter(
          (r) => r.evaluation.objective.objectiveFamily === query.family,
        )
      }
      if (query?.optimizationEvent !== undefined) {
        rows = rows.filter(
          (r) =>
            r.evaluation.objective.optimizationEvent ===
            query.optimizationEvent,
        )
      }

      rows.sort(creativeComparator(query?.sort ?? 'rank'))

      return rows.map((r) =>
        creativeRowToDTO(
          r.rowId,
          r.creative,
          r.context,
          r.adCount,
          r.latestDeliveryDate,
          r.metrics,
          r.evaluation,
        ),
      )
    },

    async getCreative(rowId: string): Promise<CreativeRowDTO | null> {
      // Keyed on the composite rowId — the same creative can back several rows. The
      // verdict window is per-campaign (launch → newest day), so any range a caller
      // passes is deliberately ignored (the param is dropped from this signature).
      const row = creativeRows().find((r) => r.rowId === rowId)
      if (row === undefined) return null // deliberate not-found, never a throw
      return creativeRowToDTO(
        row.rowId,
        row.creative,
        row.context,
        row.adCount,
        row.latestDeliveryDate,
        row.metrics,
        row.evaluation,
      )
    },
  }
}
