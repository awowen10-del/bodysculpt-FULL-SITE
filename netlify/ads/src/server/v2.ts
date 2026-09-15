/**
 * v176: the bridge from Netlify's MODERN function API to the classic event shape the
 * ads handlers were written against.
 *
 * Why: the classic ("Lambda compatibility") style bundles every environment variable
 * into the function, and AWS caps that at 4KB. This site now carries enough keys
 * (Instagram, Meta, Drive, Gemini, Apify, the database…) that the bundle went over and
 * the deploy failed — "Your environment variables exceed the 4KB limit imposed by AWS
 * Lambda". The modern API (`export default async (req: Request) => Response`) has no
 * such limit, and every other function on the site already uses it.
 *
 * The handlers underneath (handleApiEvent, handleDailyCheckRead, …) are untouched and
 * still tested against the classic shape; only the seven entry files changed, each now
 * `export default async (req) => toResponse(await handle(await toEvent(req)))`.
 */
import type { NetlifyEvent, NetlifyResult } from './adapter.ts'

export async function toEvent(req: Request): Promise<NetlifyEvent> {
  const url = new URL(req.url)
  const headers: Record<string, string | undefined> = {}
  req.headers.forEach((v, k) => { headers[k] = v })
  const query: Record<string, string | undefined> = {}
  url.searchParams.forEach((v, k) => { query[k] = v })
  const method = req.method.toUpperCase()
  return {
    httpMethod: method,
    path: url.pathname,
    headers,
    queryStringParameters: Object.keys(query).length ? query : null,
    body: method === 'GET' || method === 'HEAD' ? null : await req.text(),
  }
}

export function toResponse(r: NetlifyResult): Response {
  return new Response(r.body, { status: r.statusCode, headers: r.headers })
}
