// Netlify Function: ig-qualify  (v294)
//
// ManyChat's door. Its "Say hi to new followers" automation asks about every new Instagram
// follower before it sends the hello:
//
//   POST { username, name }   (header x-ig-key)
//     1st time: starts the check in the background (ig-qualify-background) and answers
//               { verdict:"pending", send:"yes" } at once — ManyChat only waits ~10 seconds.
//     later:    { verdict:"hot"|"warm"|"skip", send:"yes"|"no", reason }
//
// ManyChat's Condition step sends the hello unless send is "no". See netlify/lib/ig-leads.js.
//
// The site's password gate lets this one address through (netlify/edge-functions/gate.js),
// because ManyChat can't sign in. It checks its own key instead: an HMAC of DASHBOARD_PASSWORD,
// so there's no extra setting, and changing the password changes the key. Ash's signed-in
// browser reads the key from ig-qualify-key. A wrong key gets a 404, like a page that isn't there.
import { createHmac, timingSafeEqual } from "node:crypto";
import { readState, markChecking, answerFor, cleanUser } from "../lib/ig-leads.js";
import { internalHeaders } from "../lib/internal.js";

export function qualifyKey(secret) {
  return secret ? createHmac("sha256", secret).update("ig-qualify").digest("hex") : "";
}
function keyOk(given) {
  const want = Buffer.from(qualifyKey(process.env.DASHBOARD_PASSWORD || ""));
  const got = Buffer.from(String(given || ""));
  return want.length >= 32 && want.length === got.length && timingSafeEqual(want, got);
}
const json = (b, s) => Response.json(b, { status: s || 200, headers: { "Cache-Control": "no-store" } });

export default async (req) => {
  const log = (e) => console.log("[ig-qualify] " + JSON.stringify(e));
  const url = new URL(req.url);
  if (!keyOk(req.headers.get("x-ig-key") || url.searchParams.get("key"))) return new Response("Not found", { status: 404 });
  if (req.method !== "POST") return json({ error: "POST { username, name }" }, 405);
  let body; try { body = await req.json(); } catch { body = {}; }
  const u = cleanUser(body && (body.username || body.ig_username));
  if (!u) return json({ verdict: "pending", send: "yes", error: "no username" });

  const state = await readState();
  const lead = state.leads[u];
  if (lead && lead.verdict && lead.verdict !== "pending") { log({ stage: "answered", username: u, verdict: lead.verdict }); return json(answerFor(lead)); }
  // a check started more than 10 minutes ago that never finished is started again
  const stale = lead && lead.askedAt && Date.now() - Date.parse(lead.askedAt) > 10 * 60 * 1000;
  if (!lead || stale) {
    await markChecking(u, body && (body.name || body.full_name));
    const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
    try {
      await fetch(base + "/.netlify/functions/ig-qualify-background", {
        method: "POST", headers: { ...internalHeaders(), "Content-Type": "application/json", "x-scrape-trigger": (process.env.SYNC_TRIGGER_SECRET || "").trim() },
        body: JSON.stringify({ username: u }),
      });
      log({ stage: "started", username: u });
    } catch (e) { log({ stage: "start_failed", username: u, message: String((e && e.message) || "") }); }
  }
  return json(answerFor(null));
};
