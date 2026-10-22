// Netlify Function: mail-drafts-background  (v244)
//
// The weekday morning run, and the card's "Draft replies" button. A BACKGROUND function
// (15-minute wall): reading thirty threads, one Sonnet sort and an Opus reply per lead or
// client does not fit in 26 seconds.
//   1. the inbox — lib/mail-drafts.js runMorning(): sort, write, save as Gmail DRAFTS
//   2. the money — lib/chase.js buildChase(write): the chase drafts that are due
// NOTHING IS SENT by either. Both write drafts and nothing else.
//
// Locked: only a caller holding SYNC_TRIGGER_SECRET (the scheduled trigger, and mail-ai.js
// on the page's behalf) can start it, in header x-mail-trigger.
import { claimRun, runMorning, readJSON, writeJSON, RUN_KEY, env, clip } from "../lib/mail-drafts.js";
import { buildChase } from "../lib/chase.js";
import { readMoney } from "./stripe-feed.js";

export default async (req) => {
  if (req.method !== "POST") return;
  const secret = env("SYNC_TRIGGER_SECRET");
  const log = (e) => console.log("[mail-drafts] " + JSON.stringify(e));
  if (!secret || req.headers.get("x-mail-trigger") !== secret) { log({ stage: "unauthorized" }); return; }
  if (!env("ANTHROPIC_API_KEY")) { log({ stage: "no-claude" }); return; }
  let body = {};
  try { body = await req.json(); } catch { /* a bare POST */ }
  const trigger = clip(body && body.trigger, 20) || "page";
  if (!(await claimRun(trigger))) { log({ stage: "already-running" }); return; }

  const counts = {};
  const errors = [];
  try { Object.assign(counts, await runMorning({ log })); }
  catch (e) { errors.push("Inbox: " + ((e && e.message) || "failed")); }

  const key = env("STRIPE_SECRET_KEY") || env("STRIPE_API_KEY");
  if (key) {
    try {
      const { views } = await buildChase(await readMoney(key), { write: true });
      counts.chasesDrafted = Object.values(views).filter((v) => v.action === "draft-ready" && !v.error).length;
      counts.chaseErrors = Object.values(views).filter((v) => v.error).length;
    } catch (e) { errors.push("Chases: " + ((e && e.message) || "failed")); }
  }

  const run = await readJSON(RUN_KEY, {});
  await writeJSON(RUN_KEY, { ...run, running: false, finishedAt: Date.now(), counts, error: clip(errors.join(" · "), 400) });
  log({ stage: "done", counts, errors });
};
