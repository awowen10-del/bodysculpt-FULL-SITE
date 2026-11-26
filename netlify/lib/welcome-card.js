// netlify/lib/welcome-card.js  (v312)
//
// The welcome card. Ash: "Task in GHL and also a task in the dashboard; and, if either are
// ticked, they get ticked off in both places. It should include their full name, home address
// AND something personal about them scraped from Slack (post-shift notes from coaches)."
//
// HOW IT RUNS
//   v312.10, Ash: "I meant to have it on the Onboarding dashboard, the one the team have access
//   to." So the job is the onboarding tracker's own day-0 "Welcome card" (Cards & gifts to
//   send), and this code lives here only because this site holds the Slack and Claude keys.
//   1. Every 5 minutes (welcome-card-sync) anyone newly tagged `member start` in GHL gets a
//      card: name, address, a personal line from the coaches' Post-Shift Checklist posts.
//      It makes ONE GHL task (assigned to Ash) and writes the card to the tracker's Supabase
//      row 'welcome-cards', which the tracker shows inside the Welcome card job.
//   2. The same run keeps the ticks matched. Done in the tracker (the journey item, or the
//      card's own "Card sent" for someone not on the member list) -> GHL task completed.
//      GHL task completed -> card.ghlDone, and the tracker ticks its own job when it next loads.
//
// STORES: the tracker's 'welcome-cards' row (written here and by the tracker's Card sent
// button) and its 'retention' row (READ only, never written from here). The "who was tagged
// last time" list is this site's own blob.
import { getStore } from "@netlify/blobs";

export const ASH_GHL_USER = "JDb3t1lKcxPLjclX2WXd";
export const GENERAL_CHANNEL = "C05H1U54JKU";       // #general, where the checklist posts land
export const LOOK_BACK_DAYS = 120;                  // a 6-week challenge and then some
const GHL = "https://services.leadconnectorhq.com";
const SLACK = "https://slack.com/api/";
const SHIFT_RE = /post[- ]?shift checklist/i;
const env = (k) => String(process.env[k] || "").trim();

const store = () => getStore({ name: "bodysculpt-welcome-cards", consistency: "strong" });

/* ---------- the onboarding tracker's rows (Supabase, the same public key its page uses) ---------- */
const DB = "https://wxqnfvvgzqnibrgklbri.supabase.co/rest/v1/bodysculpt";
const DB_KEY = "sb_publishable_4m2hMzluKnsnGtEaddJ7bw_0jHrti6a";
const dbHeaders = { apikey: DB_KEY, Authorization: "Bearer " + DB_KEY, "Content-Type": "application/json" };
export const CARDS_ROW = "welcome-cards";
export async function readRow(key, select = "value") {
  const r = await fetch(`${DB}?key=eq.${encodeURIComponent(key)}&select=${select}`, { headers: dbHeaders });
  if (!r.ok) throw new Error("tracker read " + key + " " + r.status);
  const rows = await r.json();
  return rows[0] || null;
}
export async function readCards() { const r = await readRow(CARDS_ROW); return (r && r.value && r.value.cards) ? r.value : { cards: {} }; }
export async function writeCards(v) {
  const r = await fetch(DB + "?on_conflict=key", { method: "POST", headers: { ...dbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ key: CARDS_ROW, value: v, updated_at: new Date().toISOString() }) });
  if (!r.ok) throw new Error("tracker write " + r.status + " " + (await r.text()).slice(0, 200));
}
/* Patch some cards without losing a Card sent the tracker wrote a moment ago. */
export async function patchCards(fn) {
  const v = await readCards();
  fn(v.cards);
  await writeCards(v);
}

/* ---------- GHL ---------- */
const ghlHeaders = () => ({ Authorization: "Bearer " + env("GHL_API_KEY"), Version: "2021-07-28", Accept: "application/json",
  "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (bodysculpt-dashboard)" });
export async function ghl(method, path, body) {
  const r = await fetch(GHL + path, { method, headers: ghlHeaders(), body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`GHL ${r.status} on ${path}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : {};
}
export const contactLink = (id) => `https://app.gohighlevel.com/v2/location/${env("GHL_LOCATION_ID")}/contacts/detail/${id}`;

/* ---------- pure: the pieces of the card ---------- */
const titleCase = (s) => String(s || "").trim().toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (x) => x.toUpperCase());
export function fullName(c) {
  return titleCase([c.firstName, c.lastName].filter(Boolean).join(" ")) || c.email || "New member";
}
export function addressLines(c) {
  const lines = [c.address1, c.city, c.state, c.postalCode].map((x) => String(x || "").trim()).filter(Boolean);
  return lines;
}

export const unescapeSlack = (t) => String(t || "").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");

/* Every line of a checklist post as plain text, with who posted it and when. Pure. */
export function checklistLines(messages) {
  const out = [];
  for (const m of messages || []) {
    const parts = [m.text || ""];
    for (const b of m.blocks || []) {
      if (b.text && b.text.text) parts.push(b.text.text);
      for (const e of b.elements || []) if (e && e.text) parts.push(e.text);
    }
    const all = parts.join("\n");
    if (!SHIFT_RE.test(all)) continue;
    const coach = (all.match(/\*([^*\n]+)\*\s+•/) || [])[1] || "";
    const day = new Date(Number(m.ts) * 1000).toISOString().slice(0, 10);
    for (const line of all.split("\n")) {
      const l = unescapeSlack(line).replace(/^>\s?/, "").replace(/:[a-z_]+:/g, "").replace(/[*_]/g, "").trim();
      if (l) out.push({ day, coach, text: l });
    }
  }
  return out;
}

/* The lines that name this person: the full name, or the first name as a whole word. Pure. */
export function mentionsOf(lines, first, last) {
  const f = String(first || "").trim(), l = String(last || "").trim();
  if (f.length < 2) return [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fullRe = l ? new RegExp("\\b" + esc(f) + "\\s+" + esc(l) + "\\b", "i") : null;
  const firstRe = new RegExp("\\b" + esc(f) + "\\b", "i");
  const seen = new Set();
  // "Jodie Gould" or "Jodie G." is a different Jodie when we know this one is Jodie Wane
  const someoneElse = (t) => {
    if (!l) return false;
    const re = new RegExp("\\b" + esc(f) + "\\s+([A-Z][a-z]*\\.?)", "g"); let mm, anyOther = false, anyOurs = false;
    while ((mm = re.exec(t))) { const nx = mm[1].replace(".", ""); if (l.toLowerCase().startsWith(nx.toLowerCase())) anyOurs = true; else if (nx.length === 1 || /^[A-Z][a-z]+$/.test(nx) && !/^(And|Was|Is|Has|Had|Did|Came|Back|Said|Smashed|Loved|Loving|Got|Hit|Did)$/.test(nx)) anyOther = true; }
    return anyOther && !anyOurs;
  };
  return lines.filter((x) => firstRe.test(x.text) && !/^(Post-Shift Checklist|Anyone at risk|Any )/i.test(x.text) && !someoneElse(x.text))
    .map((x) => ({ ...x, full: !!(fullRe && fullRe.test(x.text)) }))
    .filter((x) => { const k = x.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.full - a.full) || b.day.localeCompare(a.day))
    .slice(0, 12);
}

/* What goes in both tasks. Pure. */
export function cardBody({ name, address, personal, mentions, link }) {
  const lines = [];
  lines.push("Name: " + name);
  lines.push("Address: " + (address.length ? address.join(", ") : "NOT ON GHL. Ask them for it."));
  lines.push("");
  lines.push("Something personal: " + (personal || "Nothing in the coaches' shift notes yet. Ask the coaches."));
  if (mentions && mentions.length) {
    lines.push("");
    lines.push("From the coaches' shift notes:");
    mentions.slice(0, 4).forEach((m) => lines.push(`- ${m.text} (${m.coach || "coach"}, ${m.day})`));
  }
  if (link) { lines.push(""); lines.push("GHL: " + link); }
  return lines.join("\n");
}

/* GHL sometimes has a first name only. The onboarding tracker's TeamUp list has the full name,
   keyed by GHL contact id. Public read, the same key the tracker page itself uses. */
export async function trackerName(contactId) {
  try {
    const row = await readRow("attendance-teamup", "members:value->members");
    const m = ((row && row.members) || []).find((x) => x && x.id === contactId);
    return m && /\s/.test(String(m.name || "").trim()) ? String(m.name).trim() : "";
  } catch { return ""; }
}

/* ---------- Slack: the coaches' checklist posts ---------- */
async function slackGet(method, params) {
  const qs = new URLSearchParams(params);
  const r = await fetch(SLACK + method + "?" + qs, { headers: { Authorization: "Bearer " + env("SLACK_USER_TOKEN") } });
  const d = await r.json().catch(() => ({}));
  if (!d.ok) throw new Error("Slack " + method + ": " + (d.error || r.status));
  return d;
}
export async function readChecklistPosts(nowMs = Date.now()) {
  const oldest = String(Math.floor(nowMs / 1000 - LOOK_BACK_DAYS * 86400));
  const msgs = []; let cursor = "";
  for (let i = 0; i < 20; i++) {
    const d = await slackGet("conversations.history", { channel: GENERAL_CHANNEL, oldest, limit: "200", ...(cursor ? { cursor } : {}) });
    msgs.push(...(d.messages || []));
    cursor = d.response_metadata && d.response_metadata.next_cursor;
    if (!d.has_more || !cursor) break;
  }
  return msgs;
}

let lastNoteRaw = "";
/* One warm, true detail for the card, from what the coaches wrote. Never invents. */
export async function personalNote(name, mentions) {
  if (!mentions.length) return "";
  if (!env("ANTHROPIC_API_KEY")) throw new Error("ANTHROPIC_API_KEY not set");
  const notes = mentions.map((m) => `[${m.day}, ${m.coach || "coach"}${m.full ? ", full name used" : ", first name only"}] ${m.text}`).join("\n");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5-5", max_tokens: 4000, output_config: { effort: "low" },   // room to think, then answer
      system: "You help a gym owner write a handwritten welcome card to a new member. From the coaches' shift notes, "
        + "pick the ONE most personal thing about this person (family, job, a goal, a win, something they mentioned). "
        + "Use only what the notes say, never add anything. Write it as a short plain note to the owner, one or two sentences, "
        + "UK English, no dashes. This goes on a happy welcome card, so leave out anything sad or private "
        + "(break-ups, illness, grief, money worries, wanting to cancel). If a note only uses the first name and it may be someone else, start with \"Check it's them:\". "
        + "A training win counts (a PB, a lift they did well, coming back stronger). "
        + "Only if the notes have nothing usable at all (just a name, attendance or admin), reply with exactly: NONE",
      messages: [{ role: "user", content: `New member: ${name}\n\nCoaches' notes that mention them:\n${notes}` }],
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Claude " + r.status + ": " + JSON.stringify(d).slice(0, 200));
  lastNoteRaw = JSON.stringify(d.content || d).slice(0, 600);
  const text = String(((d.content || []).find((b) => b && b.type === "text") || {}).text || "").trim();
  return !text || /^NONE\b/.test(text) ? "" : text;
}

/* ---------- 1. make the card ---------- */
export async function makeCard(contactId, { dryRun = false, now = Date.now(), posts = null, force = false } = {}) {
  const existing = (await readCards()).cards[contactId];
  if (existing && now - Date.parse(existing.createdAt) < 60 * 86400000 && !dryRun && !force) return { ok: true, skipped: "already has a card from the last 60 days" };

  const { contact: c } = await ghl("GET", "/contacts/" + contactId);
  if (!c) throw new Error("No such GHL contact " + contactId);
  let first = (c.firstName || "").trim(), last = (c.lastName || "").trim();
  if (!last) { const tn = await trackerName(contactId); if (tn) { const parts = tn.split(/\s+/); first = first || parts[0]; last = parts.slice(1).join(" "); } }
  const name = fullName({ firstName: first, lastName: last, email: c.email });
  let mentions = [], slackError = "";
  try { mentions = mentionsOf(checklistLines(posts || await readChecklistPosts(now)), first, last); }
  catch (e) { slackError = e.message; }
  let noteError = "";
  const personal = await personalNote(name, mentions).catch((e) => { noteError = e.message; return ""; });
  const body = cardBody({ name, address: addressLines(c), personal, mentions, link: contactLink(contactId) });
  const title = "Send welcome card: " + name;
  if (dryRun) return { ok: true, dryRun: true, title, body, slackError, noteError, noteRaw: lastNoteRaw, mentionCount: mentions.length };

  const due = new Date(now + 2 * 86400000);
  const t = await ghl("POST", `/contacts/${contactId}/tasks`, { title, body, dueDate: due.toISOString(), completed: false, assignedTo: ASH_GHL_USER });
  const taskId = (t.task && (t.task.id || t.task._id)) || t.id;
  if (!taskId) throw new Error("GHL made no task: " + JSON.stringify(t).slice(0, 200));

  const card = { contactId, taskId, name, email: String(c.email || "").trim().toLowerCase(), address: addressLines(c),
    personal, mentions: mentions.slice(0, 4).map((m) => ({ text: m.text, coach: m.coach, day: m.day })),
    createdAt: new Date(now).toISOString(), ghlDone: false, sent: null, closed: false };
  await patchCards((cards) => { cards[contactId] = card; });
  return { ok: true, title, taskId, slackError };
}

/* ---------- 1b. who has just started. ----------
   The 5-minute run looks at everyone GHL tags `member start` (the Member journey's own tag)
   and makes a card for anyone who wasn't tagged last time. The first run only learns who is
   already there, so nobody who joined weeks ago gets a card. Someone who leaves loses the tag
   (the Cancelled workflow), so if they come back they get a new card. Pure. */
export function newStarters(current, seen) {
  if (!Array.isArray(seen)) return { make: [], seed: true };
  const was = new Set(seen);
  return { make: current.filter((id) => !was.has(id)), seed: false };
}
export const SEEN_KEY = "welcome-card-seen";
export const PER_RUN = 2;     // a card is a Slack read and a Claude call; a scheduled run has ~30s
async function taggedStarters() {
  const ids = [];
  for (let page = 1; page <= 10; page++) {
    const r = await ghl("POST", "/contacts/search", { locationId: env("GHL_LOCATION_ID"), page, pageLimit: 100,
      filters: [{ field: "tags", operator: "contains", value: ["member start"] }] });
    const cs = r.contacts || [];
    ids.push(...cs.map((c) => c.id));
    if (cs.length < 100) break;
  }
  return ids;
}
export async function cardsForNewStarters(now = Date.now()) {
  const current = await taggedStarters();
  let seen = null; try { seen = await store().get(SEEN_KEY, { type: "json" }); } catch { seen = null; }
  const { make, seed } = newStarters(current, seen && seen.ids);
  const done = [], errors = [];
  if (!seed && make.length) {
    const posts = await readChecklistPosts(now).catch(() => []);
    for (const id of make.slice(0, PER_RUN)) {
      try { const r = await makeCard(id, { now, posts }); done.push(id + ": " + (r.title || r.skipped)); }
      catch (e) { errors.push(id + ": " + e.message); }
    }
  }
  // remember: everyone tagged now, except the new ones this run didn't reach (they go next run)
  const later = new Set(seed ? [] : make.slice(PER_RUN));
  const errored = new Set(errors.map((x) => x.split(":")[0]));
  await store().setJSON(SEEN_KEY, { ids: current.filter((id) => !later.has(id) && !errored.has(id)), at: new Date(now).toISOString() });
  return { tagged: current.length, seeded: seed, made: done, waiting: later.size, errors };
}

/* ---------- 2. keep the ticks matched. decide() is pure. ---------- */
export function decide(stepDone, ghlDone) {
  if (stepDone && ghlDone) return "close";
  if (stepDone) return "complete-ghl";
  if (ghlDone) return "tick-dashboard";
  return "wait";
}
/* Is this card's job done in the tracker? The journey item on the member (matched by email,
   then name), or the card's own Card sent. Pure. */
export function trackerDone(card, retention) {
  if (card.sent) return true;
  const norm = (x) => String(x || "").trim().toLowerCase().replace(/\s+/g, " ");
  const m = (retention || []).find((r) => r && ((card.email && norm(r.email) === card.email) || norm(r.name) === norm(card.name)));
  return !!(m && (m.completed || []).includes("welcome_card"));
}
export async function syncCards() {
  const v = await readCards();
  const open = Object.values(v.cards).filter((x) => x && !x.closed);
  if (!open.length) return { ok: true, open: 0 };
  const retRow = await readRow("retention");
  const retention = (retRow && Array.isArray(retRow.value)) ? retRow.value : [];
  const out = { ok: true, open: open.length, ghlCompleted: [], trackerTicked: [], closed: [], errors: [] };
  const changes = {};
  for (const card of open) {
    try {
      const t = await ghl("GET", `/contacts/${card.contactId}/tasks/${card.taskId}`).catch((e) => (/404/.test(e.message) ? { gone: true } : Promise.reject(e)));
      const task = t.task || t;
      const ghlDone = !t.gone && task.completed === true;
      const what = t.gone ? "gone" : decide(trackerDone(card, retention), ghlDone);
      if (what === "complete-ghl") { await ghl("PUT", `/contacts/${card.contactId}/tasks/${card.taskId}/completed`, { completed: true }); out.ghlCompleted.push(card.name); changes[card.contactId] = { ghlDone: true, closed: true }; }
      if (what === "tick-dashboard") { out.trackerTicked.push(card.name); changes[card.contactId] = { ghlDone: true, closed: true }; }
      if (what === "close") changes[card.contactId] = { ghlDone: true, closed: true };
      if (what === "gone") changes[card.contactId] = { closed: true, closedWhy: "task deleted in GHL" };
      if (changes[card.contactId] && changes[card.contactId].closed) out.closed.push(card.name);
    } catch (e) { out.errors.push(card.name + ": " + e.message); }
  }
  if (Object.keys(changes).length) await patchCards((cards) => { for (const [id, ch] of Object.entries(changes)) if (cards[id]) Object.assign(cards[id], ch); });
  return out;
}
