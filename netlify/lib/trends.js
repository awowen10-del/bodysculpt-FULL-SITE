// netlify/lib/trends.js  (v198)
//
// The inbox for Ashley's Friday trend scout.
//
// Every Friday a scheduled Claude session drives Ash's own logged-in Chrome: Explore, the
// Reels feed, hashtag and seasonal searches, then cross-checks against published trend
// roundups, writes up a report and DMs him the link. It sees things this dashboard never
// could — what is happening OUTSIDE his two watched gyms, and outside fitness altogether.
//
// It cannot move in here and it should not try. The scout works because Claude is driving a
// browser with his Instagram session in it; a Netlify function has no browser and no session,
// and never will. So the two stay separate and do opposite jobs: the scout looks outward and
// discovers, this dashboard looks inward and produces.
//
// What was missing is the join between them. The report landed in Slack, Ash read it, and
// nothing carried across — so a format peaking on Friday was unknown to the ideas engine on
// Monday, and he would have had to remember it and type it in himself, which is the exact
// friction that kills a tool. Now the scout posts its findings here on its way out.
//
// Two things arrive, and the second is the more valuable:
//   NOTES    — what is working out there this week. A sixth source for the ideas engine,
//              alongside competitor flames, his own posts, his captions and the season.
//   ACCOUNTS — gyms worth watching, found while scrolling. The thin watch list is the one
//              thing holding the whole system back: two competitors, one of which returns no
//              view data, and a hook library with a single entry. Suggested, never added —
//              the list is capped at ten and which ten is his call.
//
// One blob key, `ig-trends`: { postedAt, week, notes[], accounts[], dismissed[] }
import { getStore } from "@netlify/blobs";

export const KEY = "ig-trends";
const MAX_NOTES = 14;
const MAX_ACCOUNTS = 20;
// A fortnight. A trend from three weeks ago is not a trend, and feeding stale ones to the
// ideas engine would have it suggesting last month's format with this week's confidence.
const FRESH_DAYS = 14;

const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");
const nowIso = () => new Date().toISOString();
const store = () => getStore({ name: "bodysculpt-kpi", consistency: "strong" });

export const cleanUser = (u) => clip(String(u || ""), 40)
  .replace(/^.*instagram\.com\//i, "").replace(/^@/, "").replace(/[^A-Za-z0-9._]/g, "").toLowerCase();

const empty = () => ({ postedAt: "", week: "", notes: [], accounts: [], dismissed: [] });

export async function readTrends() {
  try {
    const t = await store().get(KEY, { type: "json" });
    if (!t || typeof t !== "object") return empty();
    return {
      postedAt: clip(t.postedAt, 40), week: clip(t.week, 40),
      notes: Array.isArray(t.notes) ? t.notes : [],
      accounts: Array.isArray(t.accounts) ? t.accounts : [],
      dismissed: Array.isArray(t.dismissed) ? t.dismissed : [],
    };
  } catch { return empty(); }
}
export async function writeTrends(t) { await store().set(KEY, JSON.stringify(t)); return t; }

/* The scout posts once a week, so NOTES are replaced wholesale — last week's are last week's.
   ACCOUNTS accumulate, because a good suggestion Ash has not got round to is still a good
   suggestion, and one he has dismissed must never come back. */
export async function addTrends({ week, notes, accounts, clear }) {
  const cur = await readTrends();
  const dismissed = new Set(cur.dismissed);

  const cleanNotes = (Array.isArray(notes) ? notes : []).map((n) => ({
    text: clip(n && n.text, 240),
    status: clip(n && n.status, 30),
    example: clip(n && n.example, 300),
    source: clip(n && n.source, 120),
  })).filter((n) => n.text).slice(0, MAX_NOTES);

  const seen = new Set();
  const incoming = (Array.isArray(accounts) ? accounts : []).map((a) => ({
    username: cleanUser(a && a.username),
    why: clip(a && a.why, 200),
    source: clip(a && a.source, 120),
    addedAt: nowIso(),
  })).filter((a) => a.username && !dismissed.has(a.username) && !seen.has(a.username) && seen.add(a.username) !== false);

  const kept = cur.accounts.filter((a) => !incoming.some((x) => x.username === a.username));
  return await writeTrends({
    postedAt: nowIso(),
    week: clip(week, 40) || nowIso().slice(0, 10),
    // an empty list normally means "the scout sent no notes this week, keep last week's";
    // `clear` is the explicit way to say the stored ones should go, which is what you want
    // after a test run or when a week's findings turn out to be wrong
    notes: cleanNotes.length ? cleanNotes : (clear ? [] : cur.notes),
    accounts: incoming.concat(kept).slice(0, MAX_ACCOUNTS),
    dismissed: cur.dismissed.slice(-200),
  });
}

// Dismissed for good: he has looked at it and said no, and a suggestion that keeps coming
// back is worse than none.
export async function dismissAccount(username) {
  const u = cleanUser(username);
  const cur = await readTrends();
  cur.accounts = cur.accounts.filter((a) => a.username !== u);
  if (u && !cur.dismissed.includes(u)) cur.dismissed = cur.dismissed.concat([u]);
  return await writeTrends(cur);
}

export function isFresh(t) {
  if (!t || !t.postedAt) return false;
  return Date.now() - Date.parse(t.postedAt) < FRESH_DAYS * 864e5;
}

/* What the ideas engine is told. Kept short and clearly labelled as coming from outside:
   these are things happening in the wider feed, not things that have worked for Bodysculpt,
   and the writer should weigh them accordingly rather than treating a peaking meme format as
   evidence about a gym in Warrington. */
export function trendBrief(t) {
  if (!isFresh(t) || !(t.notes || []).length) return "";
  const lines = t.notes.slice(0, 10).map((n) =>
    "· " + n.text + (n.status ? "  [" + n.status + "]" : "") + (n.example ? "  e.g. " + clip(n.example, 120) : ""));
  return "WHAT IS TRENDING ON INSTAGRAM MORE WIDELY, from a scroll of Explore, the reels feed and " +
    "hashtag searches on " + (t.week || t.postedAt.slice(0, 10)) + ":\n" + lines.join("\n") +
    "\nThis is the wider feed, not evidence about his gym. Use AT MOST TWO of the five ideas on it, " +
    "and only where a trend genuinely suits a small-group gym in Warrington — the other three must come " +
    "from his own account, the gyms he watches, or his own note about the business. The best use of one " +
    "of these is not to copy the trend but to marry it to something of his: a format peaking nationally " +
    "against a subject only he has.";
}

// Suggestions he has not already got, minus anyone he is already watching.
export function pending(trends, watched) {
  const have = new Set((watched || []).map((c) => cleanUser(c && c.username)));
  return (trends.accounts || []).filter((a) => !have.has(a.username));
}
