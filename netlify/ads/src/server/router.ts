/**
 * Read-API router (Stage 11B → 11C).
 *
 * Responsibilities: GET-only enforcement, authentication (every route), enum
 * validation for `sort`/`family`, routing all nine read endpoints to the
 * repository, `null` → 404 for the single-entity lookups, and the SINGLE error
 * choke point. Date-window validation lives in the repository and surfaces as
 * `ApiError`s the catch maps to safe bodies. No arithmetic, no DTO shaping here.
 */
import type { ApiRequest, ApiResponse } from './http.ts'
import type { Authenticator } from './auth.ts'
import { toCreativeListRow } from '../data/index.ts'
import type { DashboardRepository, CreativeSort } from '../data/index.ts'
import type { ObjectiveFamily } from '../metrics/index.ts'
import {
  ApiError,
  invalidQuery,
  methodNotAllowed,
  notFound,
  toClientSafeError,
  unauthorized,
} from './errors.ts'

/**
 * A redacted server-side log event. It carries NO exception message, stack, SQL,
 * connection string or id — only the safe code and the error class name.
 */
export interface ServerLogEvent {
  level: 'error'
  code: string
  errorName: string
}

export interface RouterDeps {
  repository: DashboardRepository
  authenticator: Authenticator
  /** Optional sink for redacted server logs. Never receives raw error text. */
  logger?: (event: ServerLogEvent) => void
}

export interface ApiRouter {
  handle(req: ApiRequest): Promise<ApiResponse>
}

const BASE_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json',
  'x-content-type-options': 'nosniff',
}

const SORTS: ReadonlySet<string> = new Set(['rank', 'cost', 'volume', 'name'])
const FAMILIES: ReadonlySet<string> = new Set(['leads', 'traffic', 'video'])

function cacheHeaderFor(path: string): string {
  return path === '/api/data-state'
    ? 'no-store'
    : 'private, max-age=60, must-revalidate'
}

function json(
  status: number,
  body: unknown,
  cacheControl: string,
): ApiResponse {
  return {
    status,
    body,
    headers: { ...BASE_HEADERS, 'cache-control': cacheControl },
  }
}

/** Strip a trailing slash so `/api/summary/` routes like `/api/summary`. */
function normalisePath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

/** The date bounds every endpoint shares. */
function dateRange(q: ApiRequest['query']): { start?: string; end?: string } {
  return { start: q.start, end: q.end }
}

/** Validate the optional `sort` param, or throw INVALID_QUERY. */
function parseSort(q: ApiRequest['query']): CreativeSort | undefined {
  if (q.sort === undefined) return undefined
  if (!SORTS.has(q.sort)) throw invalidQuery('Unknown sort order.')
  return q.sort as CreativeSort
}

/** Validate the optional `family` param, or throw INVALID_QUERY. */
function parseFamily(q: ApiRequest['query']): ObjectiveFamily | undefined {
  if (q.family === undefined) return undefined
  if (!FAMILIES.has(q.family)) throw invalidQuery('Unknown objective family.')
  return q.family as ObjectiveFamily
}

/** The `:id` tail after a known collection prefix, decoded; null if none. */
function idAfter(path: string, prefix: string): string | null {
  if (!path.startsWith(prefix)) return null
  const tail = path.slice(prefix.length)
  if (tail === '' || tail.includes('/')) return null
  return decodeURIComponent(tail)
}

export function createApiRouter(deps: RouterDeps): ApiRouter {
  const repo = deps.repository

  async function route(req: ApiRequest): Promise<ApiResponse> {
    if (req.method.toUpperCase() !== 'GET') throw methodNotAllowed()

    const auth = await deps.authenticator.authenticate(req)
    if (auth === null) throw unauthorized()

    const path = normalisePath(req.path)
    const q = req.query
    const ok = (dto: unknown) => json(200, dto, cacheHeaderFor(path))

    if (path === '/api/data-state') return ok(await repo.getDataState())
    if (path === '/api/summary') return ok(await repo.getSummary(dateRange(q)))
    if (path === '/api/campaigns') {
      return ok(await repo.listCampaigns(dateRange(q)))
    }
    if (path === '/api/ad-sets') {
      return ok(
        await repo.listAdSets({ ...dateRange(q), campaignId: q.campaignId }),
      )
    }
    if (path === '/api/ads') {
      return ok(
        await repo.listAds({
          ...dateRange(q),
          campaignId: q.campaignId,
          adSetId: q.adSetId,
        }),
      )
    }
    if (path === '/api/daily') {
      return ok(
        await repo.getDaily({
          ...dateRange(q),
          campaignId: q.campaignId,
          adSetId: q.adSetId,
          adId: q.adId,
          creativeId: q.creativeId,
        }),
      )
    }
    if (path === '/api/creatives') {
      // The LIST is trimmed to what the cards render (see `toCreativeListRow`) so
      // the response stays under Netlify's 6 MB function-response limit; the full
      // per-creative metric set + copy is served by `/api/creatives/:id` below.
      const rows = await repo.listCreatives({
        ...dateRange(q),
        family: parseFamily(q),
        optimizationEvent: q.optimizationEvent,
        sort: parseSort(q),
      })
      return ok(rows.map(toCreativeListRow))
    }

    const adId = idAfter(path, '/api/ads/')
    if (adId !== null) {
      const dto = await repo.getAd(adId, dateRange(q))
      if (dto === null) throw notFound()
      return ok(dto)
    }
    const creativeId = idAfter(path, '/api/creatives/')
    if (creativeId !== null) {
      const dto = await repo.getCreative(creativeId, dateRange(q))
      if (dto === null) throw notFound()
      return ok(dto)
    }

    throw notFound()
  }

  return {
    async handle(req: ApiRequest): Promise<ApiResponse> {
      try {
        return await route(req)
      } catch (err) {
        if (!(err instanceof ApiError)) {
          deps.logger?.({
            level: 'error',
            code: 'INTERNAL',
            errorName: err instanceof Error ? err.name : 'unknown',
          })
        }
        const { status, body } = toClientSafeError(err)
        return json(status, body, 'no-store')
      }
    },
  }
}
