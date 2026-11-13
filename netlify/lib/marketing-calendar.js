// netlify/lib/marketing-calendar.js  (v277)
//
// The Content Calendar's two halves.
//
//   THE PLAN   what Ash means to do: non-negotiable moments, planned campaigns, and the ticks
//              for the things no feed can see. Lives in its OWN blob store, so nothing in this
//              file can reach the weekly, monthly, quarterly, KPI or finance data.
//   THE PULSE  what actually went out: emails from GoHighLevel, posts from Instagram plus the
//              scheduling queue, paid ads from Meta. Read-only towards all of them.
//
// The calendar starts at START (the week it was switched on) and looks forward. It never reaches
// further back than that, and a week whose detail can no longer be read simply has nothing to
// open: the page greys it out rather than guessing.
import { getStore } from "@netlify/blobs";

export const START = "2026-11-02";
export const CATS = ["moments", "email", "organic", "paid", "engage", "cases", "lead", "referral",
  "upsell", "offline", "magnet", "tests", "other"];
export const TICK_CATS = ["engage", "cases"];       // nothing can see these, Ash ticks them
export const DEFAULT_TARGETS = { email: 1, organic: 3 };

export const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");
export const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (s) => DAY.test(String(s || "")) && !Number.isNaN(Date.parse(s));
export const newId = () => "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Monday of the week holding this UTC date, the same week the weekly planner uses.
export function mondayOf(dateStr) {
  const d = new Date(String(dateStr).slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/* ---------- the plan ---------- */
const store = () => getStore({ name: "bodysculpt-mktcal", consistency: "strong" });
const KEY = "plan";

// What Ash said is non-negotiable, plus the things his own profile says are real. A seed is only
// ever shown until the first save, then it is simply the record, and he can change any of it.
export const SEED = () => ({
  items: [
    { id: "seed-bf", cat: "moments", title: "Black Friday", start: "2026-11-23", end: "2026-11-30", fixed: true, yearly: true, prepWeeks: 8, notes: "" },
    { id: "seed-tff", cat: "moments", title: "Train for free", start: "2026-12-01", end: "2026-12-31", fixed: true, yearly: true, prepWeeks: 8, notes: "" },
    { id: "seed-aug", cat: "moments", title: "End of August campaign", start: "2027-08-16", end: "2027-08-31", fixed: true, yearly: true, prepWeeks: 8, notes: "" },
    { id: "seed-6wc", cat: "lead", title: "6 Week Challenge", start: "2026-11-02", end: "2027-12-31", fixed: false, yearly: false, prepWeeks: 0, notes: "" },
    { id: "seed-meno", cat: "magnet", title: "Menopause guide", start: "2026-11-02", end: "2027-12-31", fixed: false, yearly: false, prepWeeks: 0, notes: "" },
  ],
  ticks: {},
  targets: { ...DEFAULT_TARGETS },
  links: {},     // project id -> calendar row, for projects made from the calendar and nothing else
});

// v296: a plan can be run by a project on the Projects page. Only the id is kept here; the
// project itself, its tasks and its dates stay in the Projects store and are worked through
// that function's own narrow doors.
const PROJ_ID = /^[A-Za-z0-9_-]{1,40}$/;
// v300: a plan's notes are where Ash dumps his ideas and writes up the final plan, so they get
// room: 20,000 characters, not 2,000.
export const NOTES_MAX = 20000;

export function cleanItem(raw) {
  const r = raw || {};
  const cat = CATS.includes(r.cat) ? r.cat : null;
  const title = clip(String(r.title || "").trim(), 80);
  if (!cat || !title || !isDay(r.start)) return null;
  const end = isDay(r.end) && r.end >= r.start ? r.end : r.start;
  const prep = Math.max(0, Math.min(26, Math.round(Number(r.prepWeeks) || 0)));
  return { id: clip(String(r.id || ""), 40) || newId(), cat, title, start: r.start, end,
    fixed: !!r.fixed, yearly: !!r.yearly, prepWeeks: prep, notes: clip(String(r.notes || ""), NOTES_MAX),
    projectId: PROJ_ID.test(String(r.projectId || "")) ? String(r.projectId) : "",
    del: !!r.del };
}

export async function readPlan() {
  const raw = await store().get(KEY, { type: "json" });
  if (!raw) return SEED();
  return { items: Array.isArray(raw.items) ? raw.items : [], ticks: raw.ticks || {},
    targets: { ...DEFAULT_TARGETS, ...(raw.targets || {}) }, links: raw.links || {} };
}
const writePlan = (p) => store().setJSON(KEY, { ...p, updatedAt: new Date().toISOString() });

// Every change is one small edit made against a fresh read, so a stale page can never overwrite
// the whole plan. Deleting flags the item; nothing is ever removed, which is what makes Undo real.
export async function applyOp(body) {
  const plan = await readPlan();
  if (body.op === "saveItem") {
    const item = cleanItem(body.item);
    if (!item) return { error: "A plan needs a name and a start date" };
    const i = plan.items.findIndex((x) => x.id === item.id);
    // a save that doesn't mention the project (an older page, a form without it) keeps the link
    if (i >= 0 && !("projectId" in (body.item || {}))) item.projectId = plan.items[i].projectId || "";
    // v300: the same for notes. The dates form no longer carries them, so it can never wipe them.
    if (i >= 0 && !("notes" in (body.item || {}))) item.notes = plan.items[i].notes || "";
    if (i >= 0) plan.items[i] = item; else plan.items.push(item);
  } else if (body.op === "delItem") {
    const it = plan.items.find((x) => x.id === body.id);
    if (!it) return { error: "That plan is no longer here" };
    it.del = body.del !== false;
  } else if (body.op === "tick") {
    if (!TICK_CATS.includes(body.cat) || !isDay(body.week)) return { error: "Nothing to tick there" };
    const wk = mondayOf(body.week);
    const row = { ...(plan.ticks[body.cat] || {}) };
    if (body.on) row[wk] = true; else delete row[wk];
    plan.ticks[body.cat] = row;
  } else if (body.op === "target") {
    if (!(body.cat in DEFAULT_TARGETS)) return { error: "That row has no weekly target" };
    plan.targets[body.cat] = Math.max(0, Math.min(14, Math.round(Number(body.value) || 0)));
  } else if (body.op === "linkItem") {
    // v296: join a plan to a project, or ("" ) let it go. The project itself is never touched.
    const it = plan.items.find((x) => x.id === body.id && !x.del);
    if (!it) return { error: "That plan is no longer here" };
    const pid = String(body.projectId || "");
    if (pid && !PROJ_ID.test(pid)) return { error: "That project could not be linked" };
    it.projectId = pid;
  } else if (body.op === "noteItem") {
    // v300: the notes and nothing else. `was` is what the page started from: if the notes have
    // changed since (another tab, another laptop), the save is refused rather than writing over them.
    const it = plan.items.find((x) => x.id === body.id && !x.del);
    if (!it) return { error: "That plan is no longer here" };
    if ("was" in body && String(body.was || "") !== (it.notes || "")) return { error: "These notes were changed somewhere else. Copy what you wrote, then open them again." };
    it.notes = clip(String(body.notes || ""), NOTES_MAX);
  } else if (body.op === "linkProject") {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(body.id || "")) || !CATS.includes(body.cat)) return { error: "That project could not be added to the calendar" };
    plan.links = { ...plan.links, [body.id]: body.cat };
  } else return { error: "Unknown change" };
  await writePlan(plan);
  return { ok: true, plan };
}

/* ---------- the pulse ---------- */
const GRAPH = "https://graph.facebook.com/v21.0";
const GHL = "https://services.leadconnectorhq.com";
const CACHE_KEY = "pulse-cache";
const CACHE_MS = 15 * 60 * 1000;
export const feedError = (e) => clip(String((e && e.message) || e || "Could not read this"), 200);

async function getJson(url, headers) {
  const res = await fetch(url, headers ? { headers } : undefined);
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch { /* not json */ }
  if (!res.ok) {
    const why = (body && body.error && body.error.message) || (body && body.message) || text.slice(0, 120);
    const err = new Error(res.status + ": " + why); err.status = res.status; throw err;
  }
  return body;
}

export async function readPosts(env, from, readQueue) {
  const out = { ok: false, items: [], upcoming: [], note: "" };
  const [ig, queue] = await Promise.allSettled([
    (env.IG_ACCESS_TOKEN && env.IG_USER_ID)
      ? getJson(GRAPH + "/" + env.IG_USER_ID + "/media?" + new URLSearchParams({
          fields: "id,caption,media_type,permalink,timestamp", limit: "50", access_token: env.IG_ACCESS_TOKEN }))
      : Promise.reject(new Error("Instagram is not connected")),
    readQueue(),
  ]);
  if (ig.status === "fulfilled") {
    out.ok = true;
    out.items = (ig.value.data || [])
      .filter((m) => String(m.timestamp).slice(0, 10) >= from)
      .map((m) => ({ id: m.id, day: String(m.timestamp).slice(0, 10), title: clip(m.caption || "", 90) || "Post",
        type: clip(m.media_type || "", 24), url: clip(m.permalink || "", 300) }));
  } else out.note = feedError(ig.reason);
  if (queue.status === "fulfilled") {
    out.upcoming = (queue.value || [])
      .filter((q) => q.status === "scheduled" && q.scheduledFor)
      .map((q) => ({ id: q.id, day: String(q.scheduledFor).slice(0, 10), title: clip(q.name || "", 90) || "Scheduled post" }))
      .filter((q) => q.day >= from);
  }
  return out;
}

export async function readAds(env, from, to) {
  const out = { ok: false, campaigns: [], running: [], note: "" };
  const token = String(env.META_ACCESS_TOKEN || "").trim(), acct = env.META_AD_ACCOUNT_ID;
  if (!token || !acct) { out.note = "Meta is not connected"; return out; }
  const act = String(acct).startsWith("act_") ? acct : "act_" + acct;
  const [list, ins] = await Promise.all([
    getJson(GRAPH + "/" + act + "/campaigns?" + new URLSearchParams({
      fields: "id,name,effective_status,start_time,stop_time", limit: "50",
      effective_status: JSON.stringify(["ACTIVE"]), access_token: token })),
    getJson(GRAPH + "/" + act + "/insights?" + new URLSearchParams({
      level: "campaign", fields: "campaign_id,campaign_name,spend", time_increment: "1", limit: "500",
      time_range: JSON.stringify({ since: from, until: to }), access_token: token })),
  ]);
  const now = Date.now();
  const byId = new Map();
  for (const r of ins.data || []) {
    const c = byId.get(r.campaign_id) || { id: r.campaign_id, name: clip(r.campaign_name || "", 90), weeks: {}, spend: 0, last: "" };
    const amt = Number(r.spend) || 0;
    if (amt > 0) {
      const wk = mondayOf(r.date_start);
      c.weeks[wk] = Math.round(((c.weeks[wk] || 0) + amt) * 100) / 100;
      c.spend = Math.round((c.spend + amt) * 100) / 100;
      if (r.date_start > c.last) c.last = r.date_start;
    }
    byId.set(r.campaign_id, c);
  }
  // ACTIVE alone is not "running": Meta leaves a finished campaign ACTIVE forever.
  out.running = (list.data || [])
    .filter((c) => !c.stop_time || Date.parse(c.stop_time) > now)
    .map((c) => ({ id: c.id, name: clip(c.name || "", 90), start: String(c.start_time || "").slice(0, 10),
      end: String(c.stop_time || "").slice(0, 10) }));
  for (const r of out.running) if (!byId.has(r.id)) byId.set(r.id, { id: r.id, name: r.name, weeks: {}, spend: 0, last: "" });
  out.campaigns = [...byId.values()].filter((c) => c.spend > 0 || out.running.some((r) => r.id === c.id));
  out.ok = true;
  return out;
}

// GHL's marketing emails. The schedule list is the campaigns Ash sends by hand; automated
// workflow emails are deliberately NOT counted, a welcome email is not marketing activity.
export async function readEmails(env, from) {
  const out = { ok: false, items: [], upcoming: [], note: "" };
  const key = env.GHL_API_KEY, loc = env.GHL_LOCATION_ID;
  if (!key || !loc) { out.note = "GoHighLevel is not connected"; return out; }
  const headers = { Authorization: "Bearer " + key, Version: env.GHL_API_VERSION || "2021-07-28",
    Accept: "application/json", "User-Agent": "Mozilla/5.0 (bodysculpt-dashboard)" };
  const r = await getJson(GHL + "/emails/schedule?" + new URLSearchParams({ locationId: loc, limit: "100", offset: "0" }), headers);
  const today = new Date().toISOString().slice(0, 10);
  for (const s of r.schedules || []) {
    if (s.deleted || s.archived) continue;
    const row = { id: clip(s.id || s._id || "", 40), title: clip(s.name || s.subject || "Email", 90),
      subject: clip(s.subject || "", 120), status: clip(s.status || "", 24) };
    const when = s.scheduledAt || s.scheduleStartDate || s.startDate || s.sendAt || "";
    if (s.status === "complete") {
      const day = String(s.updatedAt || s.lastUpdatedAt || s.createdAt || "").slice(0, 10);
      if (day >= from) out.items.push({ ...row, day });
    } else if (s.status !== "draft" && s.status !== "cancelled" && String(when).slice(0, 10) >= today) {
      out.upcoming.push({ ...row, day: String(when).slice(0, 10) });
    }
  }
  out.ok = true;
  return out;
}

export async function readPulse(env, deps, { fresh } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const from = START;
  if (!fresh) {
    const c = await store().get(CACHE_KEY, { type: "json" }).catch(() => null);
    if (c && Date.now() - Date.parse(c.fetchedAt) < CACHE_MS) return { ...c, cached: true };
  }
  const settle = (p) => p.catch((e) => ({ ok: false, note: feedError(e),
    needsKey: /access token/i.test(String(e && e.message)), items: [], upcoming: [], campaigns: [], running: [] }));
  const [emails, posts, ads] = await Promise.all([
    settle(readEmails(env, from)), settle(readPosts(env, from, deps.readQueue)), settle(readAds(env, from, today)),
  ]);
  const pulse = { ok: true, from, today, emails, posts, ads, fetchedAt: new Date().toISOString() };
  await store().setJSON(CACHE_KEY, pulse).catch(() => {});
  return pulse;
}
