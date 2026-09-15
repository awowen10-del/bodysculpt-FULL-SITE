// Netlify Function: ig-snapshot  (v169, split in v173)
//
// The 04:30 UTC schedule (netlify.toml) that records today's follower count. Netlify does
// not let a scheduled function be called over HTTP, so the page uses ig-followers.js; both
// do the same recording through netlify/lib/followers.js.
import { recordToday } from "../lib/followers.js";

export default async () => {
  const r = await recordToday();
  console.log("[ig-snapshot] " + JSON.stringify({ ok: r.ok, recorded: r.recorded || null, message: r.message || null }));
  return Response.json({ ok: true });
};
