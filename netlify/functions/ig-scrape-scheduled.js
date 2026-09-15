// Netlify Function: ig-scrape-scheduled  (v172)
//
// The nightly trigger for the competitor scrape — the same shape as the ads sync: a tiny
// scheduled function (30s wall) that asks the background one (15-min wall) to do the work,
// carrying the shared secret that { all } demands. 05:00 UTC, after the ads sync and the
// follower snapshot. See netlify.toml.
export default async () => {
  const log = (e) => console.log("[ig-scrape-scheduled] " + JSON.stringify(e));
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  const secret = (process.env.SYNC_TRIGGER_SECRET || "").trim();
  if (!base || !secret || !(process.env.APIFY_API_TOKEN || "").trim()) {
    log({ stage: "skipped", hasBase: !!base, hasSecret: !!secret, hasApify: !!(process.env.APIFY_API_TOKEN || "").trim() });
    return Response.json({ ok: true, skipped: true });
  }
  try {
    const res = await fetch(base + "/.netlify/functions/ig-scrape-background", {
      method: "POST", headers: { "Content-Type": "application/json", "x-scrape-trigger": secret }, body: JSON.stringify({ all: true }),
    });
    log({ stage: "triggered", status: res.status });
  } catch (e) { log({ stage: "trigger_failed", message: String((e && e.message) || "") }); }
  return Response.json({ ok: true });
};
