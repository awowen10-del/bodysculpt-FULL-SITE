// Netlify Function: ig-leads-background  (v293)
//
// The new-follower check: see netlify/lib/ig-leads.js. A BACKGROUND function (202 at once,
// up to fifteen minutes) because it runs two Apify scrapes and a Claude call per new follower.
// Only the scheduled trigger and the ig-leads function (the page's "Check now") hold the
// secret it asks for, so nobody can run up the Apify bill from outside.
import { run, recordError } from "../lib/ig-leads.js";
import { todayIso } from "../lib/followers.js";

export default async (req) => {
  const log = (e) => console.log("[ig-leads] " + JSON.stringify(e));
  if (req.method !== "POST") return;
  const expected = (process.env.SYNC_TRIGGER_SECRET || "").trim();
  if (!expected || req.headers.get("x-scrape-trigger") !== expected) { log({ stage: "unauthorized" }); return; }
  try {
    const out = await run(process.env, todayIso(), log);
    log({ stage: "done", ...out });
  } catch (e) {
    const message = String((e && e.message) || "The check failed.");
    log({ stage: "error", message });
    await recordError(message).catch(() => {});
  }
};
