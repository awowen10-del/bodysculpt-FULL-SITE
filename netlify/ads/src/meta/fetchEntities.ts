/**
 * Runtime read-only Meta fetchers (Stage 7). Each returns the raw `data` array
 * for an edge plus the aggregated, sanitised rate-limit snapshot for that fetch.
 * GET-only, cursor pagination, Bearer header — all via the promoted graph client.
 * Never touches the `/leads` edge.
 */
import {
  metaGetPaged,
  emptyRateLimit,
  mergeRateLimit,
  HARD_MAX_PAGES_PER_EDGE,
  type FetchLike,
  type SleepLike,
  type SanitisedRateLimit,
} from './graphClient.ts'
import {
  AD_ACCOUNT_FIELDS,
  CAMPAIGN_FIELDS,
  AD_SET_FIELDS,
  AD_FIELDS_WITH_CREATIVE,
  INSIGHTS_FIELDS,
} from './fields.ts'

/** One raw node fetched directly by id, or null when Meta no longer exposes it. */
export interface NodeResult {
  node: unknown | null
  rateLimit: SanitisedRateLimit
}

const RUNTIME_PAGE_SIZE = 25
const DEFAULT_MAX_PAGES_PER_EDGE = 200

export interface FetchConfig {
  accessToken: string
  adAccountId: string
  apiVersion: string
}

export interface FetchDeps {
  config: FetchConfig
  fetchImpl: FetchLike
  sleepImpl?: SleepLike
  /** Test override; clamped to the hard maximum, never above. */
  maxPagesPerEdge?: number
}

export interface EdgeResult {
  data: unknown[]
  rateLimit: SanitisedRateLimit
}

async function fetchEdge(
  deps: FetchDeps,
  path: string,
  params: Record<string, string | number>,
  maxRecords: number,
): Promise<EdgeResult> {
  const maxPages = Math.min(
    deps.maxPagesPerEdge ?? DEFAULT_MAX_PAGES_PER_EDGE,
    HARD_MAX_PAGES_PER_EDGE,
  )
  const result = await metaGetPaged(
    {
      accessToken: deps.config.accessToken,
      adAccountId: deps.config.adAccountId,
    },
    {
      path,
      params,
      maxPages,
      maxRecords,
      fetchImpl: deps.fetchImpl,
      sleepImpl: deps.sleepImpl,
      version: deps.config.apiVersion,
    },
  )
  let rateLimit = emptyRateLimit()
  for (const m of result.meta)
    rateLimit = mergeRateLimit(rateLimit, m.rateLimit)
  return { data: result.data, rateLimit }
}

function edgeCap(deps: FetchDeps): number {
  const maxPages = Math.min(
    deps.maxPagesPerEdge ?? DEFAULT_MAX_PAGES_PER_EDGE,
    HARD_MAX_PAGES_PER_EDGE,
  )
  return RUNTIME_PAGE_SIZE * maxPages
}

export function fetchAdAccount(deps: FetchDeps): Promise<EdgeResult> {
  return fetchEdge(
    deps,
    deps.config.adAccountId,
    { fields: AD_ACCOUNT_FIELDS.join(',') },
    1,
  )
}

export function fetchCampaigns(deps: FetchDeps): Promise<EdgeResult> {
  return fetchEdge(
    deps,
    `${deps.config.adAccountId}/campaigns`,
    { fields: CAMPAIGN_FIELDS.join(','), limit: RUNTIME_PAGE_SIZE },
    edgeCap(deps),
  )
}

export function fetchAdSets(deps: FetchDeps): Promise<EdgeResult> {
  return fetchEdge(
    deps,
    `${deps.config.adAccountId}/adsets`,
    { fields: AD_SET_FIELDS.join(','), limit: RUNTIME_PAGE_SIZE },
    edgeCap(deps),
  )
}

export function fetchAds(deps: FetchDeps): Promise<EdgeResult> {
  return fetchEdge(
    deps,
    `${deps.config.adAccountId}/ads`,
    { fields: AD_FIELDS_WITH_CREATIVE.join(','), limit: RUNTIME_PAGE_SIZE },
    edgeCap(deps),
  )
}

/**
 * Fetch a single graph node directly by its id (not an account edge). Returns the
 * raw node object, or `null` when Meta returns it as absent (empty payload). Any
 * transport / HTTP / rate-limit failure still throws — the caller decides whether
 * a specific "does not exist" error means the node is permanently gone.
 */
async function fetchNodeById(
  deps: FetchDeps,
  nodeId: string,
  fields: readonly string[],
): Promise<NodeResult> {
  const result = await fetchEdge(deps, nodeId, { fields: fields.join(',') }, 1)
  return { node: result.data[0] ?? null, rateLimit: result.rateLimit }
}

/** Direct-by-id recovery for one ad (with its inline creative) — resolution B. */
export function fetchAdById(
  deps: FetchDeps,
  metaAdId: string,
): Promise<NodeResult> {
  return fetchNodeById(deps, metaAdId, AD_FIELDS_WITH_CREATIVE)
}

/** Direct-by-id recovery for one ad set — a recovered ad's parent, if missing. */
export function fetchAdSetById(
  deps: FetchDeps,
  metaAdSetId: string,
): Promise<NodeResult> {
  return fetchNodeById(deps, metaAdSetId, AD_SET_FIELDS)
}

/** Direct-by-id recovery for one campaign — a recovered ad's parent, if missing. */
export function fetchCampaignById(
  deps: FetchDeps,
  metaCampaignId: string,
): Promise<NodeResult> {
  return fetchNodeById(deps, metaCampaignId, CAMPAIGN_FIELDS)
}

export function fetchInsightsWindow(
  deps: FetchDeps,
  since: string,
  until: string,
): Promise<EdgeResult> {
  return fetchEdge(
    deps,
    `${deps.config.adAccountId}/insights`,
    {
      level: 'ad',
      time_range: JSON.stringify({ since, until }),
      time_increment: 1,
      fields: INSIGHTS_FIELDS.join(','),
      limit: RUNTIME_PAGE_SIZE,
    },
    edgeCap(deps),
  )
}
