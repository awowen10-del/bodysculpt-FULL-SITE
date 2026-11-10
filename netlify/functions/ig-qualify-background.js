// Netlify Function: ig-qualify-background  (v294)
//
// Checks one new follower for ig-qualify (ManyChat's door): reads their public profile and has
// Claude decide hot / warm / skip. Background, because the Apify read and Claude take longer
// than ManyChat will wait. Only callers holding the scrape secret get in.
import { qualifyOne } from "../lib/ig-leads.js";
import { todayIso } from "../lib/followers.js";

export default async (req) => {
  const log = (e) => console.log("[ig-qualify-bg] " + JSON.stringify(e));
  if (req.method !== "POST") return;
  const expected = (process.env.SYNC_TRIGGER_SECRET || "").trim();
  if (!expected || req.headers.get("x-scrape-trigger") !== expected) { log({ stage: "unauthorized" }); return; }
  let body; try { body = await req.json(); } catch { body = {}; }
  try {
    const lead = await qualifyOne(process.env, body && body.username, todayIso(), log);
    log({ stage: "done", username: lead.username, verdict: lead.verdict, reason: lead.reason });
  } catch (e) { log({ stage: "error", message: String((e && e.message) || "") }); }
};
