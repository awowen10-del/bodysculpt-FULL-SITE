// netlify/lib/anniversary-card.js  (v314)
//
// The 1-year anniversary. Ash, 27 Nov 2026: "add the 1 year anniversary, again this requires a
// task in GHL and a task in the onboarding tracker under retention. For this they get a card and a
// personalised bottle of champagne or fizz or something, something special, a year is a big deal.
// The two should interlink so if I complete the task on GHL it should tick off on the tracker and
// vice versa. The note should have their full name, address and a recommended personalised
// message to send them."
//
// HOW IT RUNS (from the 5-minute welcome-card-sync, same as the welcome card)
//   WHO   every member on the tracker's TeamUp list (row 'attendance-teamup', GHL `member` tag
//         matched to TeamUp), dated from `since`: the start of their current unbroken run of
//         memberships. Not anyone leaving (cancel approved).
//   WHEN  14 days before the anniversary, so there is time to order a personalised bottle. Up to
//         30 days after it too, so the first run catches anyone whose year has just gone by.
//   WHAT  one GHL task for Ash (due on the day) and a card in the tracker's row 'anniversary-cards':
//         full name, address, how many sessions they did in their year, what the coaches have said
//         about them, a message for the card and a line for the bottle label (Claude, Ash's voice).
//   TICKS Done in the tracker (the card's Sent button, or the member's own 1-year job) completes
//         the GHL task. Completed in GHL ticks it in the tracker. Same decide() as the welcome card.
import { readRow, ghl, addressLines, fullName, contactLink, checklistLines, mentionsOf, readChecklistPosts, decide, ASH_GHL_USER } from "./welcome-card.js";

const DAY = 86400000;
export const LEAD_DAYS = 14;
export const LATE_DAYS = 30;
export const PER_RUN = 2;          // a card is a GHL read, a Slack read and a Claude call; a scheduled run has ~30s
export const CARDS_ROW = "anniversary-cards";
const env = (k) => String(process.env[k] || "").trim();

/* ---------- the tracker's row (same public key the tracker page uses) ---------- */
const DB = "https://wxqnfvvgzqnibrgklbri.supabase.co/rest/v1/bodysculpt";
const DB_KEY = "sb_publishable_4m2hMzluKnsnGtEaddJ7bw_0jHrti6a";
const dbHeaders = { apikey: DB_KEY, Authorization: "Bearer " + DB_KEY, "Content-Type": "application/json" };
export async function readCards() { const r = await readRow(CARDS_ROW); return (r && r.value && r.value.cards) ? r.value : { cards: {} }; }
async function writeCards(v) {
  const r = await fetch(DB + "?on_conflict=key", { method: "POST", headers: { ...dbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ key: CARDS_ROW, value: v, updated_at: new Date().toISOString() }) });
  if (!r.ok) throw new Error("tracker write " + r.status + " " + (await r.text()).slice(0, 200));
}
/* Read the latest row and patch it, so a Sent ticked in the tracker a moment ago is never lost. */
async function patchCards(fn) { const v = await readCards(); fn(v.cards); await writeCards(v); }

/* ---------- pure: dates ---------- */
export function anniversaryOf(since) {
  const d = new Date(String(since).slice(0, 10) + "T12:00:00Z");
  if (isNaN(d)) return null;
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}
/* Members whose first anniversary is in the window and who have no card yet. Pure. */
export function due(members, cards, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const shift = (day, n) => new Date(Date.parse(day + "T12:00:00Z") + n * DAY).toISOString().slice(0, 10);
  return (members || []).filter((m) => m && m.id && m.since && !m.leaving)
    .map((m) => ({ m, date: anniversaryOf(m.since) }))
    .filter(({ m, date }) => date && today >= shift(date, -LEAD_DAYS) && today <= shift(date, LATE_DAYS) && !(cards[m.id] && cards[m.id].date === date))
    .sort((a, b) => a.date.localeCompare(b.date));
}
/* Sessions in their first year, from the TeamUp weekly counts ('2025-W50': 3). Pure. */
export function isoWeekStart(key) {
  const [y, w] = String(key).split("-W").map(Number);
  const jan4 = Date.UTC(y, 0, 4), dow = (new Date(jan4).getUTCDay() || 7);
  return new Date(jan4 - (dow - 1) * DAY + (w - 1) * 7 * DAY).toISOString().slice(0, 10);
}
export function yearSessions(weeks, since, date) {
  const from = isoWeekStart(isoKeyOf(since)), to = date;
  return Object.entries(weeks || {}).filter(([k]) => { const s = isoWeekStart(k); return s >= from && s < to; })
    .reduce((a, [, n]) => a + (Number(n) || 0), 0);
}
function isoKeyOf(day) {
  const d = new Date(String(day).slice(0, 10) + "T12:00:00Z");
  const t = new Date(d); t.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = t.getUTCFullYear(), w = Math.ceil(((t - Date.UTC(y, 0, 1)) / DAY + 1) / 7);
  return y + "-W" + String(w).padStart(2, "0");
}
/* Someone who joined on the same day with the same surname: likely a couple, maybe one bottle. Pure. */
export function partnerOf(m, members) {
  const sur = (n) => String(n || "").trim().split(/\s+/).slice(-1)[0].toLowerCase();
  const p = (members || []).find((x) => x && x.id !== m.id && x.since === m.since && sur(x.name) === sur(m.name));
  return p ? p.name : "";
}
const niceDay = (day) => new Date(day + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/* ---------- Claude: the card and the label ---------- */
async function writeWords({ name, sessions, mentions, notes, partner }) {
  if (!env("ANTHROPIC_API_KEY")) throw new Error("ANTHROPIC_API_KEY not set");
  const facts = [
    `Member: ${name}`,
    `A year ago they joined Bodysculpt as a full member.`,
    sessions ? `Sessions they trained in their first year: ${sessions}` : "",
    partner ? `They joined on the same day as ${partner}, probably their partner.` : "",
    notes.length ? "What the team has noted about them:\n" + notes.map((n) => "- " + n).join("\n") : "",
    mentions.length ? "The coaches' shift notes that mention them:\n" + mentions.map((m) => `- [${m.day}, ${m.coach || "coach"}] ${m.text}`).join("\n") : "Nothing in the coaches' shift notes.",
  ].filter(Boolean).join("\n\n");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5-5", max_tokens: 4000, output_config: { effort: "low" },
      system: "Ash owns Bodysculpt, a small personal training gym in Warrington, UK. A member has hit one year with the gym. "
        + "He sends them a handwritten card and a personalised bottle of fizz. Write both in his voice: warm, proud of them, plain and spoken, "
        + "UK English, like a mate who is also their coach. Use first name only. Mention one or two true, specific things from the facts "
        + "(the number of sessions is a great one, a lift, a moment the coaches noted). Never invent anything. Never mention weight, size or how "
        + "they look, and leave out anything sad or private (illness, injury, money, family trouble, wanting to cancel). No dashes, no hashtags, "
        + "no corporate words (journey, incredible, amazing, smash). At most one emoji in the card, none on the label. "
        + "Don't open with the formula \"Name, one year in and N sessions done\": start how a person would, e.g. \"Happy one year, Kerry!\" or a line about them, and vary it.\n\n"
        + "Reply with JSON only: {\"card\": \"the card message, 45 to 80 words, ending with a sign-off from Ash and the team\", "
        + "\"label\": \"the bottle label, at most 8 words, e.g. their first name and one year at Bodysculpt\"}",
      messages: [{ role: "user", content: facts }],
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Claude " + r.status + ": " + JSON.stringify(d).slice(0, 200));
  const text = String(((d.content || []).find((b) => b && b.type === "text") || {}).text || "");
  const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const clean = (s) => String(s || "").replace(/\s*[—–]\s*/g, ", ").trim();
  return { card: clean(j.card), label: clean(j.label).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "").trim() };
}

/* What goes in the GHL task. Pure. */
export function taskBody({ name, address, date, sessions, card, label, partner, link }) {
  const L = [];
  L.push("Name: " + name);
  L.push("Address: " + (address.length ? address.join(", ") : "NOT ON GHL. Ask them for it."));
  L.push("Anniversary: " + niceDay(date) + " (one year as a member)");
  if (sessions) L.push("Sessions in their first year: " + sessions);
  if (partner) L.push("Joined the same day as " + partner + ". One bottle for both?");
  L.push("");
  L.push("Send: a card and a personalised bottle of fizz.");
  L.push("");
  L.push("For the card:");
  L.push(card || "(No message yet. Write your own.)");
  L.push("");
  L.push("For the bottle label: " + (label || name.split(" ")[0] + ", one year at Bodysculpt"));
  if (link) { L.push(""); L.push("GHL: " + link); }
  return L.join("\n");
}

/* ---------- 1. make a card ---------- */
export async function makeCard(m, date, { att, posts, memberNotes, now = Date.now(), dryRun = false } = {}) {
  const { contact: c } = await ghl("GET", "/contacts/" + m.id);
  if (!c) throw new Error("No such GHL contact " + m.id);
  let first = (c.firstName || "").trim(), last = (c.lastName || "").trim();
  if (!last && /\s/.test(String(m.name || "").trim())) { const p = m.name.trim().split(/\s+/); first = first || p[0]; last = p.slice(1).join(" "); }
  const name = fullName({ firstName: first, lastName: last, email: c.email });
  const address = addressLines(c);
  const sessions = m.tid ? yearSessions((att.weeks || {})[m.tid], m.since, date) : 0;
  const partner = partnerOf(m, att.members);
  let mentions = [];
  try { mentions = mentionsOf(checklistLines(posts), first, last).slice(0, 8); } catch { mentions = []; }
  const notes = ((memberNotes || {})[m.id] || []).map((n) => n && n.text).filter(Boolean).slice(-6);
  let words = { card: "", label: "" }, wordsError = "";
  try { words = await writeWords({ name, sessions, mentions, notes, partner }); } catch (e) { wordsError = e.message; }
  const body = taskBody({ name, address, date, sessions, card: words.card, label: words.label, partner, link: contactLink(m.id) });
  const title = "1-year anniversary: card and fizz for " + name;
  if (dryRun) return { ok: true, dryRun: true, title, body, wordsError };

  const dueAt = Math.max(Date.parse(date + "T09:00:00Z"), now + DAY);
  const t = await ghl("POST", `/contacts/${m.id}/tasks`, { title, body, dueDate: new Date(dueAt).toISOString(), completed: false, assignedTo: ASH_GHL_USER });
  const taskId = (t.task && (t.task.id || t.task._id)) || t.id;
  if (!taskId) throw new Error("GHL made no task: " + JSON.stringify(t).slice(0, 200));
  const card = { contactId: m.id, taskId, name, email: String(c.email || "").trim().toLowerCase(), address, date, since: m.since,
    sessions, partner, card: words.card, label: words.label,
    mentions: mentions.slice(0, 4).map((x) => ({ text: x.text, coach: x.coach, day: x.day })),
    createdAt: new Date(now).toISOString(), ghlDone: false, sent: null, closed: false };
  await patchCards((cards) => { cards[m.id] = card; });
  return { ok: true, title, taskId, wordsError };
}

export async function cardsForAnniversaries(now = Date.now(), { dryRun = false, limit = PER_RUN } = {}) {
  const attRow = await readRow("attendance-teamup");
  const att = (attRow && attRow.value) || {};
  const v = await readCards();
  const list = due(att.members, v.cards, now);
  if (!list.length) return { due: 0, made: [] };
  const posts = await readChecklistPosts(now).catch(() => []);
  const notesRow = await readRow("member-notes").catch(() => null);
  const memberNotes = (notesRow && notesRow.value) || {};
  const made = [], errors = [];
  for (const { m, date } of list.slice(0, limit)) {
    try { const r = await makeCard(m, date, { att, posts, memberNotes, now, dryRun }); made.push(dryRun ? r : m.name + " (" + date + ")"); }
    catch (e) { errors.push(m.name + ": " + e.message); }
  }
  return { due: list.length, made, waiting: Math.max(0, list.length - limit), errors };
}

/* ---------- 2. keep the ticks matched ---------- */
/* Done in the tracker: the card's own Sent, or the member's 1-year job on the Members tab. Pure. */
export function trackerDone(card, retention) {
  if (card.sent) return true;
  const norm = (x) => String(x || "").trim().toLowerCase().replace(/\s+/g, " ");
  const m = (retention || []).find((r) => r && ((card.email && norm(r.email) === card.email) || norm(r.name) === norm(card.name)));
  return !!(m && (m.completed || []).includes("anniversary"));
}
export async function syncCards() {
  const v = await readCards();
  const open = Object.values(v.cards).filter((x) => x && !x.closed);
  if (!open.length) return { ok: true, open: 0 };
  const retRow = await readRow("retention");
  const retention = (retRow && Array.isArray(retRow.value)) ? retRow.value : [];
  const changes = {};
  const out = { ok: true, open: open.length, ghlCompleted: [], trackerTicked: [], closed: [], errors: [] };
  for (const card of open) {
    try {
      // v314.1: no address when the card was made? GHL may have one now (address-sync copies them from TeamUp)
      if (!(card.address || []).length) {
        const { contact: c } = await ghl("GET", "/contacts/" + card.contactId).catch(() => ({}));
        const address = c ? addressLines(c) : [];
        if (address.length) {
          const body = taskBody({ ...card, address, link: contactLink(card.contactId) });
          const cur = await ghl("GET", `/contacts/${card.contactId}/tasks/${card.taskId}`).catch(() => ({}));
          const ct = cur.task || cur;
          if (ct && ct.title && !ct.completed) await ghl("PUT", `/contacts/${card.contactId}/tasks/${card.taskId}`, { title: ct.title, body, dueDate: ct.dueDate, completed: false, assignedTo: ct.assignedTo || ASH_GHL_USER }).catch(() => null);
          changes[card.contactId] = { ...(changes[card.contactId] || {}), address };
          out.addressAdded = (out.addressAdded || []).concat(card.name);
        }
      }
      const t = await ghl("GET", `/contacts/${card.contactId}/tasks/${card.taskId}`).catch((e) => (/404/.test(e.message) ? { gone: true } : Promise.reject(e)));
      const task = t.task || t;
      const ghlDone = !t.gone && task.completed === true;
      const what = t.gone ? "gone" : decide(trackerDone(card, retention), ghlDone);
      if (what === "complete-ghl") { await ghl("PUT", `/contacts/${card.contactId}/tasks/${card.taskId}/completed`, { completed: true }); out.ghlCompleted.push(card.name); changes[card.contactId] = { ...(changes[card.contactId] || {}), ghlDone: true, closed: true }; }
      if (what === "tick-dashboard") { out.trackerTicked.push(card.name); changes[card.contactId] = { ...(changes[card.contactId] || {}), ghlDone: true, closed: true }; }
      if (what === "close") changes[card.contactId] = { ...(changes[card.contactId] || {}), ghlDone: true, closed: true };
      if (what === "gone") changes[card.contactId] = { ...(changes[card.contactId] || {}), closed: true, closedWhy: "task deleted in GHL" };
      if (changes[card.contactId] && changes[card.contactId].closed) out.closed.push(card.name);
    } catch (e) { out.errors.push(card.name + ": " + e.message); }
  }
  if (Object.keys(changes).length) await patchCards((cards) => { for (const [id, ch] of Object.entries(changes)) if (cards[id]) Object.assign(cards[id], ch); });
  return out;
}
