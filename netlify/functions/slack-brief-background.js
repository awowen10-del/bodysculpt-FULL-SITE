// Netlify Function: slack-brief-background  (v223)
//
// Reads the team Slack and has Claude sort it — see netlify/lib/slack.js. A BACKGROUND
// function (the -background suffix): Netlify answers 202 at once and lets this run for up
// to fifteen minutes, because reading a week of nine channels and their threads and then
// one long Claude call does not fit in the 26 seconds an ordinary function gets. The page
// polls slack-feed until `building` clears.
//   POST { trigger }   "page" (Refresh / first visit of the day) or "schedule" (the cron)
//
// It writes ONE key, `slack-brief`, in its own store `bodysculpt-slack`. A failed build
// keeps the last good brief and adds the reason, so a bad morning shows yesterday's card
// with a line saying why it is old, not an empty one.
import { claimBuild, buildBrief, readBrief, writeJSON, BRIEF_KEY, env, clip } from "../lib/slack.js";

export default async (req) => {
  if (req.method !== "POST") return;
  if (!env("SLACK_USER_TOKEN") || !env("ANTHROPIC_API_KEY")) return;
  let body = {};
  try { body = await req.json(); } catch { /* a bare POST is a page refresh */ }
  const trigger = clip(body && body.trigger, 20) || "page";
  if (!(await claimBuild(trigger))) return;            // one already running
  const log = (e) => console.log("[slack-brief] " + JSON.stringify(e));
  try {
    const brief = await buildBrief(Date.now());
    await writeJSON(BRIEF_KEY, { ...brief, building: false, buildError: "", trigger });
    log({ stage: "built", actions: brief.actions.length, sessions: brief.sessions.length, unread: brief.unreadTotal });
  } catch (e) {
    const prev = (await readBrief()) || {};
    await writeJSON(BRIEF_KEY, { ...prev, building: false, buildError: clip((e && e.message) || "The read failed.", 300), buildFailedAt: Date.now() });
    log({ stage: "failed", message: String((e && e.message) || "") });
  }
};
