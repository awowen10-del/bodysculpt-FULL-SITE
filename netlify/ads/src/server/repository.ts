/**
 * Server-side read repository (Stage 11B → 11C) — the full `DashboardRepository`.
 *
 * It owns database interaction ONLY: on each call it materialises the current
 * normalised graph from Postgres (`materializeDataset`) and delegates every query
 * to the SHARED in-memory engine (`createDatasetRepository`). It therefore contains
 * NO arithmetic, NO DTO construction and NO creative scoring — those live once, in
 * the engine + metrics + creativeAssembly, shared with the seed repository. This is
 * what makes the server behaviourally identical to the seed by construction.
 *
 * The one server-specific concern it adds is the transport window policy: date
 * bounds are validated and clamped (`parseDateRange` + `resolveWindow`) before the
 * engine sees them — malformed/inverted → INVALID_QUERY, explicit over-cap →
 * RANGE_TOO_LARGE, open-ended → clamped. The seed repository has no such policy;
 * the parity suite compares only valid windows and asserts rejection separately.
 *
 * SERVER-ONLY: imports the Drizzle schema via `materializeDataset`. Never
 * browser-reachable (enforced by the boundary tests).
 */
import type {
  DashboardRepository,
  DateRangeQuery,
  AdSetQuery,
  AdQuery,
  DailyQuery,
  CreativeQuery,
} from '../data/index.ts'
import { createDatasetRepository } from '../data/datasetRepository.ts'
import type { DashboardDataset } from '../data/datasetRepository.ts'
import {
  materializeDataset,
  type MaterializeOptions,
  type ReadDb,
} from './materialize.ts'
import { parseDateRange, resolveWindow, type DataExtent } from './validate.ts'

export type { ReadDb }

function extentOf(dataset: DashboardDataset): DataExtent | null {
  return dataset.meta.startDate === ''
    ? null
    : { start: dataset.meta.startDate, end: dataset.meta.endDate }
}

/** Validate + clamp the query's date bounds against the dataset extent. */
function windowOf(
  dataset: DashboardDataset,
  query: DateRangeQuery | undefined,
): { start: string; end: string } {
  const bounds = parseDateRange(query ?? {})
  return resolveWindow(bounds, extentOf(dataset))
}

export function createServerReadRepository(
  db: ReadDb,
  materializeOptions: MaterializeOptions = {},
): DashboardRepository {
  const logger = materializeOptions.logger
  const clock = materializeOptions.now ?? (() => Date.now())

  /** Materialise the current graph and build the shared engine over it. */
  async function load(): Promise<{
    engine: DashboardRepository
    dataset: DashboardDataset
  }> {
    const dataset = await materializeDataset(db, materializeOptions)
    return { engine: createDatasetRepository(dataset), dataset }
  }

  return {
    async getDataState() {
      const { engine } = await load()
      return engine.getDataState()
    },

    async getSummary(query?: DateRangeQuery) {
      const { engine, dataset } = await load()
      return engine.getSummary(windowOf(dataset, query))
    },

    async listCampaigns(query?: DateRangeQuery) {
      const { engine, dataset } = await load()
      return engine.listCampaigns(windowOf(dataset, query))
    },

    async listAdSets(query?: AdSetQuery) {
      const { engine, dataset } = await load()
      const w = windowOf(dataset, query)
      return engine.listAdSets({ campaignId: query?.campaignId, ...w })
    },

    async listAds(query?: AdQuery) {
      const { engine, dataset } = await load()
      const w = windowOf(dataset, query)
      return engine.listAds({
        campaignId: query?.campaignId,
        adSetId: query?.adSetId,
        ...w,
      })
    },

    async getAd(adId: string, query?: DateRangeQuery) {
      const { engine, dataset } = await load()
      return engine.getAd(adId, windowOf(dataset, query))
    },

    async getDaily(query?: DailyQuery) {
      const { engine, dataset } = await load()
      const w = windowOf(dataset, query)
      return engine.getDaily({
        campaignId: query?.campaignId,
        adSetId: query?.adSetId,
        adId: query?.adId,
        creativeId: query?.creativeId,
        ...w,
      })
    },

    async listCreatives(query?: CreativeQuery) {
      // Stage timing so a slow /creatives request is diagnosable from logs: how
      // long materialise took (repository_loaded) vs the SYNCHRONOUS creative
      // assembly (rows_assembled). If the function is killed mid-assembly, the
      // logs end at repository_loaded with no rows_assembled — that gap IS the
      // signature of the assembly exceeding the platform's function time limit.
      const t0 = clock()
      const { engine, dataset } = await load()
      const tLoaded = clock()
      logger?.({
        stage: 'repository_loaded',
        path: '/api/creatives',
        ms: tLoaded - t0,
        counts: {
          creatives: dataset.creatives.length,
          ads: dataset.ads.length,
          insightRows: dataset.insights.length,
        },
      })
      const w = windowOf(dataset, query)
      const rows = await engine.listCreatives({
        family: query?.family,
        optimizationEvent: query?.optimizationEvent,
        sort: query?.sort,
        ...w,
      })
      logger?.({
        stage: 'rows_assembled',
        path: '/api/creatives',
        ms: clock() - tLoaded,
        counts: { rows: rows.length },
      })
      return rows
    },

    async getCreative(creativeId: string, query?: DateRangeQuery) {
      const { engine, dataset } = await load()
      return engine.getCreative(creativeId, windowOf(dataset, query))
    },
  }
}
