// netlify/lib/ig-leads.js  (v293)
//
// New Instagram followers, sorted into who is worth a DM.
//
// Facebook ads bring 5 to 10 new Instagram followers a week and nobody was talking to them.
// Instagram will not let a business send the FIRST message by API (GHL included), so Ash sends
// that one from his phone. Everything else is done here:
//
//   1. Apify reads @bodysculptwarrington's newest followers. No Instagram login is used —
//      the scraper reads the public list, so Ash's account is never at risk.
//   2. Anyone not seen before has their public profile read (bio, link, business or not).
//   3. Claude sorts each one into hot / warm / skip, says why in a few words, and writes a
//      first message in Ash's voice.
//   4. The Content page's "New followers" tab shows the hot and warm ones with a copy button,
//      and Ash ticks each off once sent.
//
// Hot = an ad was running when they followed + they look local + they look like a 6WC member.
// Skip = PTs, coaches, gym owners, people selling things, businesses, bots, people far away.
// (Ash's rules, 10 Nov 2026.)
//
// It writes ONE key — `ig-leads` — and nothing else. Nothing is sent to anyone.
import { getStore } from "@netlify/blobs";
import Anthropic from "@anthropic-ai/sdk";

export const KEY = "ig-leads";
export const OWN_ACCOUNT = "bodysculptwarrington";
const FOLLOWERS_ACTOR = "scraping_solutions~instagram-scraper-followers-following-no-cookies";
const PROFILE_ACTOR = "apify~instagram-profile-scraper";
const APIFY = "https://api.apify.com/v2/acts/";
// Instagram lists newest followers first. At 5 to 10 a week, the first page is plenty and
// costs about 2p a run.
const FOLLOWERS_PER_RUN = 25;
const MAX_NEW_PER_RUN = 25;
const KEEP_SEEN = 3000;
const KEEP_LEADS_DAYS = 60;

const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const store = () => getStore({ name: "bodysculpt-kpi", consistency: "strong" });
export const cleanUser = (u) => clip(String(u || ""), 40).replace(/^@/, "").replace(/[^A-Za-z0-9._]/g, "").toLowerCase();

export function emptyState() {
  return { seeded: false, seen: [], leads: {}, lastRun: null, lastError: "" };
}
export async function readState() {
  try { return { ...emptyState(), ...((await store().get(KEY, { type: "json" })) || {}) }; }
  catch { return emptyState(); }
}
async function writeState(s) { await store().set(KEY, JSON.stringify(s)); }

/* ---------- Apify ---------- */
async function runActor(token, actor, input, fetchImpl) {
  const res = await (fetchImpl || fetch)(APIFY + actor + "/run-sync-get-dataset-items?token=" + encodeURIComponent(token), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body)) {
    const msg = (body && body.error && body.error.message) || ("Apify returned " + res.status);
    throw new Error(clip(msg, 200));
  }
  return body;
}

// The follower scraper's rows, whatever it calls the fields, cut down to a username list in
// the order Instagram gave them (newest first).
export function followerNames(rows) {
  const out = [];
  for (const r of rows || []) {
    const u = cleanUser(r && (r.username || r.user_name || (r.node && r.node.username) || (r.user && r.user.username)));
    if (u && u !== OWN_ACCOUNT && !out.includes(u)) out.push(u);
  }
  return out;
}

// What the scoring needs from a public profile. Nothing else is kept.
export function shapeProfile(p) {
  const posts = Array.isArray(p.latestPosts) ? p.latestPosts.slice(0, 6) : [];
  return {
    username: cleanUser(p.username),
    fullName: clip(p.fullName || "", 80),
    bio: clip(p.biography || "", 300),
    link: clip(p.externalUrl || "", 200),
    followers: num(p.followersCount),
    following: num(p.followsCount),
    posts: num(p.postsCount),
    private: !!p.private,
    verified: !!p.verified,
    business: !!p.isBusinessAccount,
    category: clip(p.businessCategoryName || "", 60),
    // where their recent posts were tagged, and what they said: the best hints of
    // whether someone is local and what they're into
    places: posts.map((x) => clip(x.locationName || "", 60)).filter(Boolean).slice(0, 4),
    captions: posts.map((x) => clip(x.caption || "", 140)).filter(Boolean).slice(0, 3),
  };
}

/* ---------- was an ad running? ---------- */
// Ad spend per day comes from the ads sync's own table. A follower counts as "after an ad" if
// there was spend on the day they were first seen or the day before (the check runs in the
// morning, so most follows happened yesterday).
export async function adDays(env, sinceIso) {
  const url = env.DATABASE_URL;
  if (!url) return null;
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 5 });
  try {
    const rows = await sql`select date::text as d, sum(spend)::float as s from daily_ad_insights where date >= ${sinceIso} group by date`;
    return new Set(rows.filter((r) => (r.s || 0) > 0).map((r) => r.d));
  } finally { await sql.end({ timeout: 2 }).catch(() => {}); }
}
export function adRunningOn(days, dayIso) {
  if (!days) return null;   // unknown, not "no"
  const prev = new Date(Date.parse(dayIso + "T12:00:00Z") - 86400000).toISOString().slice(0, 10);
  return days.has(dayIso) || days.has(prev);
}

/* ---------- Claude ---------- */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "reason", "local", "opener"],
  properties: {
    verdict: { type: "string", enum: ["hot", "warm", "skip"] },
    reason: { type: "string" },
    local: { type: "string", enum: ["yes", "maybe", "no"] },
    opener: { type: "string" },
  },
};

export function scorePrompt(profile, adRunning) {
  return [
    "Bodysculpt is a small-group personal training gym in Warrington, UK. Its main offer is the 6 Week Challenge, for busy everyday adults who want to lose fat or get stronger, often people who have joined big gyms before and stopped going.",
    "This Instagram account has just followed Bodysculpt. Decide whether the owner, Ash, should send them a friendly DM.",
    "",
    "PROFILE (public data only):",
    JSON.stringify(profile),
    "Was a Facebook/Instagram ad running when they followed: " + (adRunning === null ? "unknown" : adRunning ? "yes" : "no"),
    "",
    "VERDICT RULES:",
    "- skip: personal trainers, coaches, gym owners, anyone in the fitness industry; anyone selling something (supplements, coaching, marketing, MLM, apps); businesses and brands; bots, spam or empty accounts; people clearly far from Warrington or outside the UK.",
    "- hot: an ad was running (yes), they look local (Warrington, Cheshire, St Helens, Wigan, Leigh, Widnes, Runcorn, Liverpool or Manchester edges), AND they look like an everyday adult who could join a gym.",
    "- warm: an everyday person who could be a member but one of the hot signs is missing or unclear. A private account with a normal-looking name and no red flags is warm.",
    "When unsure between skip and warm, choose warm. Never guess someone's age, health or body from their photos.",
    "",
    "reason: a few plain words Ash can read in a second, e.g. 'Local mum, ad running' or 'PT in Leeds'.",
    "local: yes, maybe or no.",
    "opener: the first DM Ash will send. One short line, UK English, warm and curious, ending in exactly one easy question. Thank them for the follow. Use their first name if the profile gives a real one, otherwise no name. Never mention the 6 Week Challenge, prices or offers. Never use dashes. No exclamation marks. Use Ash's own opener almost word for word: 'Hey Sarah, thanks for the follow 💪🏼 How's your training going at the moment?' (no name if there isn't a real one: 'Hey, thanks for the follow 💪🏼 How's your training going at the moment?'). For a skip, opener can be an empty string.",
  ].join("\n");
}

export function cleanVerdict(raw) {
  const v = raw && typeof raw === "object" ? raw : {};
  return {
    verdict: ["hot", "warm", "skip"].includes(v.verdict) ? v.verdict : "warm",
    reason: clip(String(v.reason || ""), 120),
    local: ["yes", "maybe", "no"].includes(v.local) ? v.local : "maybe",
    opener: clip(String(v.opener || ""), 300).replace(/[—–]/g, ","),
  };
}

async function score(profile, adRunning) {
  const client = new Anthropic();
  const res = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: scorePrompt(profile, adRunning) }],
  });
  if (res.stop_reason === "refusal") return cleanVerdict({ verdict: "warm", reason: "Couldn't check, have a look" });
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return cleanVerdict(JSON.parse(text));
}

/* ---------- one run ---------- */
// today: YYYY-MM-DD (UK). Returns a short summary for the log.
export async function run(env, today, log) {
  const token = (env.APIFY_API_TOKEN || "").trim();
  if (!token) throw new Error("APIFY_API_TOKEN is not set.");
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set.");
  const state = await readState();
  const seen = new Set(state.seen);

  const rows = await runActor(token, FOLLOWERS_ACTOR, { Account: [OWN_ACCOUNT], resultsLimit: FOLLOWERS_PER_RUN, dataToScrape: "Followers" });
  const names = followerNames(rows);
  const fresh = names.filter((u) => !seen.has(u) && !state.leads[u]).slice(0, MAX_NEW_PER_RUN);
  log({ stage: "followers", got: names.length, fresh: fresh.length, seeded: state.seeded });

  let days = null;
  try { days = await adDays(env, new Date(Date.parse(today + "T12:00:00Z") - 3 * 86400000).toISOString().slice(0, 10)); }
  catch (e) { log({ stage: "ad_days_failed", message: clip((e && e.message) || "", 160) }); }
  const adRunning = adRunningOn(days, today);

  let profiles = [];
  if (fresh.length) {
    const prow = await runActor(token, PROFILE_ACTOR, { usernames: fresh });
    profiles = prow.map(shapeProfile).filter((p) => p.username);
  }
  const byName = new Map(profiles.map((p) => [p.username, p]));

  let added = 0;
  for (const u of fresh) {
    const p = byName.get(u) || { username: u, fullName: "", bio: "", private: true };
    let v;
    try { v = await score(p, adRunning); }
    catch (e) { log({ stage: "score_failed", username: u, message: clip((e && e.message) || "", 160) }); v = cleanVerdict({ verdict: "warm", reason: "Couldn't check, have a look" }); }
    state.leads[u] = {
      username: u, fullName: p.fullName, bio: p.bio, private: !!p.private,
      firstSeen: today, adRunning, ...v,
      status: v.verdict === "skip" ? "skipped" : "todo",
      // the very first run finds people who followed weeks ago: say so, so Ash knows
      backlog: !state.seeded,
    };
    added++;
  }
  for (const u of names) seen.add(u);
  for (const u of fresh) seen.add(u);
  state.seen = [...seen].slice(-KEEP_SEEN);
  state.seeded = true;

  // forget leads older than two months that are no longer waiting on Ash
  const cutoff = new Date(Date.parse(today + "T12:00:00Z") - KEEP_LEADS_DAYS * 86400000).toISOString().slice(0, 10);
  for (const [u, l] of Object.entries(state.leads)) if (l.firstSeen < cutoff && l.status !== "todo") delete state.leads[u];

  state.lastRun = new Date().toISOString();
  state.lastError = "";
  await writeState(state);
  return { found: names.length, added };
}

/* ---------- v294: one follower at a time, asked by ManyChat ----------
   ManyChat's "Say hi to new followers" automation asks the cockpit about each new follower
   before it sends the hello (see netlify/functions/ig-qualify.js). The first ask starts this
   in the background; a couple of minutes later ManyChat asks again and reads the verdict.
   A follower ManyChat has asked about is recorded here, so the Content page's New followers
   tab shows who was messaged and who was skipped, and the daily scrape never scores them twice. */
export async function markChecking(username, fullName) {
  const u = cleanUser(username);
  if (!u) return null;
  const state = await readState();
  if (!state.leads[u]) {
    state.leads[u] = { username: u, fullName: clip(fullName || "", 80), status: "checking", verdict: "pending", via: "manychat", askedAt: new Date().toISOString() };
    if (!state.seen.includes(u)) state.seen.push(u);
    await writeState(state);
  }
  return state.leads[u];
}

/* ---------- v295: already a lead in GHL? ----------
   Ash: "if they opt in via GHL, either via landing page or facebook ad, they don't get the
   message". Instagram only gives a username and a display name, so the match is by full name:
   a GHL contact whose first + last name equals the Instagram name, and who has an email or a
   phone (so they came in through a form, an ad or the website, not an Instagram DM). A
   one-word Instagram name is never matched: "Sarah" alone would skip half of Warrington. */
export const normName = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

export async function ghlLeadByName(env, fullName, fetchImpl) {
  const want = normName(fullName);
  if (want.split(" ").length < 2) return null;
  const key = env.GHL_API_KEY, loc = env.GHL_LOCATION_ID;
  if (!key || !loc) return null;
  const res = await (fetchImpl || fetch)("https://services.leadconnectorhq.com/contacts/search", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, Version: env.GHL_API_VERSION || "2021-07-28", Accept: "application/json",
      "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (bodysculpt-dashboard)" },
    body: JSON.stringify({ locationId: loc, page: 1, pageLimit: 20, query: fullName }),
  });
  if (!res.ok) throw new Error("GHL " + res.status + " on contact search");
  const body = await res.json();
  const hit = (body.contacts || []).find((c) =>
    normName([c.firstName, c.lastName].filter(Boolean).join(" ") || c.contactName || c.name) === want && (c.email || c.phone));
  return hit ? { id: hit.id, name: [hit.firstName, hit.lastName].filter(Boolean).join(" "), tags: hit.tags || [] } : null;
}

export async function qualifyOne(env, username, today, log, fetchImpl) {
  const u = cleanUser(username);
  if (!u) throw new Error("No username.");
  const token = (env.APIFY_API_TOKEN || "").trim();
  if (!token) throw new Error("APIFY_API_TOKEN is not set.");

  // already a lead or member in GHL? Then skip before spending anything on the profile read.
  const known = (await readState()).leads[u];
  if (known && known.fullName) {
    let hit = null;
    try { hit = await ghlLeadByName(env, known.fullName, fetchImpl); }
    catch (e) { log({ stage: "ghl_check_failed", username: u, message: clip((e && e.message) || "", 160) }); }
    if (hit) return saveVerdict(u, today, { username: u, fullName: known.fullName, bio: "", private: false }, null,
      cleanVerdict({ verdict: "skip", reason: "Already in GHL as " + clip(hit.name, 60) }), log);
  }

  let p = { username: u, fullName: "", bio: "", private: true };
  try {
    const rows = await runActor(token, PROFILE_ACTOR, { usernames: [u] });
    const found = rows.map(shapeProfile).find((x) => x.username === u);
    if (found) p = found;
  } catch (e) { log({ stage: "profile_failed", username: u, message: clip((e && e.message) || "", 160) }); }

  let days = null;
  try { days = await adDays(env, new Date(Date.parse(today + "T12:00:00Z") - 3 * 86400000).toISOString().slice(0, 10)); }
  catch (e) { log({ stage: "ad_days_failed", message: clip((e && e.message) || "", 160) }); }
  const adRunning = adRunningOn(days, today);

  // the profile's own name may differ from the one ManyChat sent: check GHL with that one too
  if (p.fullName && normName(p.fullName) !== normName(known && known.fullName)) {
    let hit = null;
    try { hit = await ghlLeadByName(env, p.fullName, fetchImpl); }
    catch (e) { log({ stage: "ghl_check_failed", username: u, message: clip((e && e.message) || "", 160) }); }
    if (hit) return saveVerdict(u, today, p, adRunning, cleanVerdict({ verdict: "skip", reason: "Already in GHL as " + clip(hit.name, 60) }), log);
  }

  let v;
  try { v = await score(p, adRunning); }
  catch (e) { log({ stage: "score_failed", username: u, message: clip((e && e.message) || "", 160) }); v = cleanVerdict({ verdict: "warm", reason: "Couldn't check, messaged anyway" }); }
  return saveVerdict(u, today, p, adRunning, v, log);
}

async function saveVerdict(u, today, p, adRunning, v, log) {
  const state = await readState();
  const prev = state.leads[u] || {};
  state.leads[u] = {
    ...prev, username: u, fullName: p.fullName || prev.fullName || "", bio: p.bio, private: !!p.private,
    firstSeen: prev.firstSeen || today, adRunning, ...v, via: "manychat",
    // ManyChat sends the hello itself, so a hot or warm follower is already messaged
    status: v.verdict === "skip" ? "skipped" : "sent",
    checkedAt: new Date().toISOString(),
  };
  if (!state.seen.includes(u)) state.seen.push(u);
  await writeState(state);
  return state.leads[u];
}

// What ManyChat reads back. "send" is the only thing its Condition step looks at: anything but
// a finished "skip" verdict says yes, so a slow or failed check never costs a real lead.
export function answerFor(lead) {
  if (!lead || !lead.verdict || lead.verdict === "pending") return { verdict: "pending", send: "yes" };
  return { verdict: lead.verdict, send: lead.verdict === "skip" ? "no" : "yes", reason: lead.reason || "" };
}

export async function recordError(message) {
  const state = await readState();
  state.lastError = clip(message, 200);
  state.lastRun = new Date().toISOString();
  await writeState(state);
}

/* ---------- what the page sees, and the one thing it can change ---------- */
export function forPage(state) {
  const leads = Object.values(state.leads || {}).sort((a, b) => (b.firstSeen || "").localeCompare(a.firstSeen || ""));
  return { ok: true, lastRun: state.lastRun, lastError: state.lastError, leads };
}

const STATUSES = new Set(["todo", "sent", "skipped"]);
export async function setStatus(username, status) {
  const u = cleanUser(username);
  if (!u || !STATUSES.has(status)) return null;
  const state = await readState();
  const lead = state.leads[u];
  if (!lead) return null;
  lead.status = status;
  if (status === "sent") lead.sentAt = new Date().toISOString();
  await writeState(state);
  return forPage(state);
}
