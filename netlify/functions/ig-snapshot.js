// Netlify Function: ig-snapshot  (v169)
//
// The follower count, once a day, so the Content page can draw follower growth.
// Instagram's API tells you how many followers you have NOW and nothing about
// yesterday, so the only way to have a growth chart is to write the number down every
// day and keep the list. This function is that list.
//
//   POST  -> read today's followers_count + media_count from the Graph API and record
//            them under today's date (Europe/London). Recording twice in a day just
//            updates today's entry. Returns the history.
//   GET   -> the history, newest last, plus the growth over 7 and 30 days.
//
// It runs itself at 04:30 UTC every day (netlify.toml), AND the Content page asks it to
// record on every visit, so the chart starts filling from the first day the page is
// opened rather than waiting for the first night.
//
// It writes ONE key — `ig-followers` — and nothing else. The Instagram feed function
// keeps its own `ig-cache-` keys; this one never touches them.
//
// Failure is a 200 with a message, never a 500: the card explains itself.
import { getStore } from "@netlify/blobs";

const GRAPH = "https://graph.facebook.com/v21.0";
const KEY = "ig-followers";
const KEEP_DAYS = 400;
const TIMEZONE = "Europe/London";

const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const store = () => getStore({ name: "bodysculpt-kpi", consistency: "strong" });

function todayIso(now) {
  // YYYY-MM-DD in the gym's own timezone — a 4am UTC run is still "today" in Warrington
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now || new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return get("year") + "-" + get("month") + "-" + get("day");
}

async function readHistory() {
  try { return (await store().get(KEY, { type: "json" })) || {}; } catch { return {}; }
}

function shape(map) {
  const days = Object.keys(map).sort().slice(-KEEP_DAYS).map((date) => ({
    date, followers: num(map[date].followers) || 0, media: num(map[date].media) || 0,
  }));
  const last = days[days.length - 1] || null;
  // growth = latest minus the entry N days back (or the earliest we have inside that window)
  const back = (n) => {
    if (!last) return null;
    const cutoff = new Date(last.date + "T00:00:00Z"); cutoff.setUTCDate(cutoff.getUTCDate() - n);
    const iso = cutoff.toISOString().slice(0, 10);
    const older = days.filter((d) => d.date <= iso);
    const ref = older.length ? older[older.length - 1] : (days.length > 1 ? days[0] : null);
    return ref && ref.date !== last.date ? last.followers - ref.followers : null;
  };
  return {
    ok: true, days,
    current: last ? last.followers : null,
    since: days.length ? days[0].date : null,
    weeklyGrowth: back(7), monthlyGrowth: back(30),
  };
}

export default async (req) => {
  const token = process.env.IG_ACCESS_TOKEN || "";
  const igUserId = (process.env.IG_USER_ID || "").replace(/[^0-9]/g, "");
  if (req.method === "GET") return Response.json(shape(await readHistory()));
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!token || !igUserId) {
    return Response.json({ ok: false, configured: false, message: "Instagram is not connected yet.", ...shape(await readHistory()) });
  }
  try {
    const qs = new URLSearchParams({ fields: "followers_count,media_count", access_token: token });
    const res = await fetch(GRAPH + "/" + igUserId + "?" + qs.toString());
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.error) {
      throw new Error((body && body.error && body.error.message) || ("Instagram returned " + res.status));
    }
    const map = await readHistory();
    map[todayIso()] = { followers: num(body.followers_count) || 0, media: num(body.media_count) || 0 };
    // keep the list bounded
    const keys = Object.keys(map).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete map[k];
    await store().set(KEY, JSON.stringify(map));
    return Response.json({ ...shape(map), recorded: todayIso() });
  } catch (e) {
    return Response.json({ ok: false, configured: true, message: String((e && e.message) || "Could not read Instagram").slice(0, 300), ...shape(await readHistory()), ok: false });
  }
};
