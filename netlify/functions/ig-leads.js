// Netlify Function: ig-leads  (v293)
//
// The Content page's "New followers" tab. See netlify/lib/ig-leads.js.
//   GET                                  the list
//   POST { username, status }            status is todo | sent | skipped (Ash's tick)
//   POST { check: true }                 run the check now (at most once an hour)
import { readState, forPage, setStatus } from "../lib/ig-leads.js";
import { internalHeaders } from "../lib/internal.js";

const json = (b, s) => Response.json(b, { status: s || 200, headers: { "Cache-Control": "no-store" } });

export default async (req) => {
  if (req.method === "GET") return json(forPage(await readState()));
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body; try { body = await req.json(); } catch { body = {}; }

  if (body && body.check) {
    const state = await readState();
    if (state.lastRun && Date.now() - Date.parse(state.lastRun) < 60 * 60 * 1000) return json({ ok: false, error: "Checked in the last hour. Try again later." });
    const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
    const secret = (process.env.SYNC_TRIGGER_SECRET || "").trim();
    if (!base || !secret) return json({ ok: false, error: "Not set up yet." });
    await fetch(base + "/.netlify/functions/ig-leads-background", {
      method: "POST", headers: { ...internalHeaders(), "Content-Type": "application/json", "x-scrape-trigger": secret }, body: "{}",
    });
    return json({ ok: true, started: true });
  }

  const out = await setStatus(body && body.username, body && body.status);
  return out ? json(out) : json({ ok: false, error: "Not found." }, 404);
};
