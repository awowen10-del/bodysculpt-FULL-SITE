// netlify/lib/followers.js  (v173)
//
// The follower count, once a day, so the Content page can draw follower growth.
// Instagram's API tells you how many followers you have NOW and nothing about yesterday,
// so the only way to have a growth chart is to write the number down every day and keep
// the list. This is that list, shared by two functions:
//   ig-followers.js   GET the history / POST record today — what the page calls
//   ig-snapshot.js    the 04:30 UTC schedule, which records today the same way
// Two functions because Netlify refuses HTTP calls to a scheduled function (403) — v169
// had the page calling the scheduled one, and the card sat on "recording starts…" forever.
//
// It writes ONE key — `ig-followers` — and nothing else.
import { getStore } from "@netlify/blobs";

const GRAPH = "https://graph.facebook.com/v21.0";
const KEY = "ig-followers";
const KEEP_DAYS = 400;
const TIMEZONE = "Europe/London";

const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const store = () => getStore({ name: "bodysculpt-kpi", consistency: "strong" });
export const KEY_NAME = KEY;

export function todayIso(now) {
  // YYYY-MM-DD in the gym's own timezone — a 4am UTC run is still "today" in Warrington
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now || new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return get("year") + "-" + get("month") + "-" + get("day");
}

export async function readHistory() {
  try { return (await store().get(KEY, { type: "json" })) || {}; } catch { return {}; }
}

export function shape(map) {
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


// read today's count from the Graph API and record it; returns the reply the page wants
export async function recordToday() {
  const token = process.env.IG_ACCESS_TOKEN || "";
  const igUserId = (process.env.IG_USER_ID || "").replace(/[^0-9]/g, "");
  if (!token || !igUserId) return { ok: false, configured: false, message: "Instagram is not connected yet.", ...shape(await readHistory()) };
  try {
    const qs = new URLSearchParams({ fields: "followers_count,media_count", access_token: token });
    const res = await fetch(GRAPH + "/" + igUserId + "?" + qs.toString());
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.error) {
      throw new Error((body && body.error && body.error.message) || ("Instagram returned " + res.status));
    }
    const map = await readHistory();
    map[todayIso()] = { followers: num(body.followers_count) || 0, media: num(body.media_count) || 0 };
    const keys = Object.keys(map).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete map[k];
    await store().set(KEY, JSON.stringify(map));
    return { ...shape(map), recorded: todayIso() };
  } catch (e) {
    return { ...shape(await readHistory()), ok: false, configured: true, message: String((e && e.message) || "Could not read Instagram").slice(0, 300) };
  }
}
