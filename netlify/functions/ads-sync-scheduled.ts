/**
 * Netlify SCHEDULED entry for the nightly sync (cron).
 *
 * Scheduled functions have a HARD 30-second wall, and a live-write can exceed it
 * on a slow Meta night — so this stays tiny: it just triggers the `-background`
 * function (15-min budget, 202 immediately) and returns. This is Netlify's
 * documented pattern for long-running scheduled work
 * (https://docs.netlify.com/build/functions/scheduled-functions/).
 *
 * The schedule is declared in `netlify.toml` (`0 4 * * *` = 04:00 UTC). Netlify
 * cron is UTC and does NOT track DST, so this fires at 05:00 UK during BST
 * (summer) and 04:00 UK during GMT (winter) — both early morning, before the
 * owner's first check, which is all that matters.
 *
 * The background function WRITES to production, so it only accepts a request that
 * carries the shared `SYNC_TRIGGER_SECRET`; this trigger presents it in the
 * `x-sync-trigger` header. Required env: URL (Netlify-provided), SYNC_TRIGGER_SECRET.
 */

function log(event: { stage: string; [key: string]: unknown }): void {
  console.log(`[ads-sync-scheduled] ${JSON.stringify(event)}`)
}

const OK = () => Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })

// v176: the modern function API (no 4KB env limit)
export default async (): Promise<Response> => {
  const base =
    process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? process.env.DEPLOY_URL
  const secret = process.env.SYNC_TRIGGER_SECRET
  if (base === undefined || secret === undefined || secret === '') {
    log({
      stage: 'misconfigured',
      hasBase: base !== undefined,
      hasSecret: secret !== undefined && secret !== '',
    })
    return OK()
  }

  try {
    const res = await fetch(`${base}/.netlify/functions/ads-sync-background`, {
      method: 'POST',
      headers: { 'x-sync-trigger': secret },
    })
    // A background function replies 202 immediately; anything else means the
    // trigger did not land, which the logs will show.
    log({ stage: 'triggered', status: res.status })
  } catch (err) {
    log({
      stage: 'trigger_failed',
      message: err instanceof Error ? err.message : String(err),
    })
  }
  return OK()
}
