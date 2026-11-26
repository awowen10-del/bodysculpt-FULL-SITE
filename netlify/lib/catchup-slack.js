// Shared library: monthly catch-up bookings -> #coaches  (v313)
//
// Members book a catch-up on bodysculpt-onboarding.netlify.app/catch-up. That site has no Slack
// key, so this site (which has SLACK_USER_TOKEN) reads the tracker's 'catchup-bookings' row every
// 5 minutes from welcome-card-sync and posts each new booking in #coaches, once.
// Which bookings have been posted lives in this site's own blob, so we never write to the
// tracker's row and can't trip over a booking being saved at the same moment.
import { getStore } from "@netlify/blobs";
import { readRow } from "./welcome-card.js";
import { slack } from "./slack.js";

export const COACHES_CHANNEL = "C06RM572THC";
export const POSTED_KEY = "catchup-slack-posted";
const FRESH_MS = 2 * 24 * 3600 * 1000;   // never post anything older than 2 days (a first run, an outage)
const store = () => getStore({ name: "bodysculpt-welcome-cards", consistency: "strong" });

const WHO = { dan: "in the gym with Dan", ash: "on Zoom with Ash" };
export function niceWhen(date, time) {
  const d = new Date(date + "T12:00:00Z");
  const day = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const h = Number(String(time).slice(0, 2));
  return `${day} at ${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
}
export function message(b) {
  const lines = [
    `*New catch-up booked:* ${b.name}, ${niceWhen(b.date, b.time)}, ${WHO[b.who] || b.who}.`,
    `*What they want to talk about:* ${b.note ? b.note.replace(/\s+/g, " ").trim() : "they didn't say"}`,
  ];
  if (b.who === "ash") lines.push("Ash has a GHL task to send the Zoom link.");
  lines.push("It's on the Catch-ups tab in the tracker.");
  return lines.join("\n");
}
export function toPost(bookings, posted, now) {
  const done = new Set(posted || []);
  return (bookings || []).filter((b) => b && b.id && b.status !== "cancelled" && !done.has(b.id)
    && now - Date.parse(b.createdAt || 0) < FRESH_MS);
}

export async function postNewBookings(now = Date.now()) {
  const row = await readRow("catchup-bookings");
  const bookings = (row && row.value && Array.isArray(row.value.bookings)) ? row.value.bookings : [];
  let saved = null; try { saved = await store().get(POSTED_KEY, { type: "json" }); } catch { saved = null; }
  const posted = (saved && saved.ids) || [];
  const fresh = toPost(bookings, posted, now);
  const out = { posted: [], failed: [] };
  for (const b of fresh) {
    try {
      await slack("chat.postMessage", { channel: COACHES_CHANNEL, text: message(b), unfurl_links: false }, true);
      posted.push(b.id); out.posted.push(b.id);
    } catch (e) { out.failed.push({ id: b.id, error: String((e && e.message) || e).slice(0, 120) }); }
  }
  if (out.posted.length) {
    const live = new Set(bookings.map((b) => b.id));
    await store().setJSON(POSTED_KEY, { ids: posted.filter((id) => live.has(id)), at: new Date(now).toISOString() });
  }
  return out;
}
