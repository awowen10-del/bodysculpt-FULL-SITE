// Netlify Function: hooks-mine-scheduled  (v177)
//
// The nightly trigger for the hook mining — the same shape as the competitor scrape and the
// ads sync before it: a tiny scheduled function (30s wall) asks the background one (15-min
// wall) to do the work, carrying the shared secret that { all } demands. 05:30 UTC, half an
// hour after the scrape, so the flames it reads are last night's and Instagram's video links
// are still warm. See netlify.toml.
export default async () => {
  const log = (e) => console.log("[hooks-mine-scheduled] " + JSON.stringify(e));
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  const secret = (process.env.SYNC_TRIGGER_SECRET || "").trim();
  const hasKeys = !!(process.env.GEMINI_API_KEY || "").trim() && !!(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!base || !secret || !hasKeys) {
    log({ stage: "skipped", hasBase: !!base, hasSecret: !!secret, hasKeys });
    return Response.json({ ok: true, skipped: true });
  }
  try {
    const res = await fetch(base + "/.netlify/functions/hooks-mine-background", {
      method: "POST", headers: { "Content-Type": "application/json", "x-mine-trigger": secret }, body: JSON.stringify({ all: true }),
    });
    log({ stage: "triggered", status: res.status });
  } catch (e) { log({ stage: "trigger_failed", message: String((e && e.message) || "") }); }
  return Response.json({ ok: true });
};
