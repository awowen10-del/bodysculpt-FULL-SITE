// netlify/lib/ideas.js  (v192)
//
// What to film today.
//
// Ash, looking at the Hooks tab: "I'll be honest I'm confused by this screen and what it's
// doing. I don't load this up and immediately feel inspired or know what to post for a reel."
//
// He was right, and the miss was mine from the first conversation. The page opened with an
// empty box asking "what is the reel about?" — a question he does not have the answer to,
// because if he did he would not need the page. The blank page had not been solved, only
// moved from a notes app into his dashboard. Everything built so far is the SECOND half of
// the job: given a topic, find a proven opening and write it well. This is the first half.
//
// WHERE AN IDEA COMES FROM. Nothing invented, and nothing scraped from the wider internet —
// five things the dashboard already knows:
//   · the SUBJECTS behind the reels that took off for the accounts he watches (the hook
//     library stores the angle, not just the sentence shape)
//   · his own posts that beat his normal, worth a second angle
//   · the questions he already answers in his own captions, which the voice profile reads
//   · the time of year — September is back-to-routine, January is not
//   · what he has already written, so it does not repeat itself
//
// One blob key, `ig-ideas`: { generatedAt, ideas[], about }
//   idea { id, title, why, source, format }
// `about` is his own note about the business — services, the objections he actually hears,
// what he is pushing this season. Optional, and the single biggest lever on quality: without
// it the ideas are good in general, with it they are about his gym.
import { getStore } from "@netlify/blobs";
import Anthropic from "@anthropic-ai/sdk";
import { readVoice } from "./schedule.js";
import { readTrends, trendBrief } from "./trends.js";

export const KEY = "ig-ideas";
/* v202: eight, not five. Ash: "From the playbook, the accounts I follow and the scouting
   report… how are we only getting 10 to choose from?" Five was picked before there was
   anything much to draw on; with a full playbook, a week of trend notes and twenty-five of his
   own posts in front of it, it was the output that was thin rather than the material. */
const WANT = 8;
/* His own note about the business is the single richest source there is, and this cap was
   silently eating it — his playbook arrived at exactly 3000 characters, cut off mid-sentence
   at "with weekly check-ins", with nothing anywhere to say so. A limit that truncates the best
   input without a word is worse than no limit.
   v204: 40,000, because Ash asked for room for 35,000 and a cap should sit above the thing it
   is capping rather than on top of it. The whole of it goes into the ideas prompt: that runs
   once a day and has the time, and the playbook is the difference between ideas that are good
   in general and ideas that are about this gym. */
const MAX_ABOUT = 40000;
/* v200: ideas ACCUMULATE through the week instead of being replaced each morning.
   Ash: "I write all my content ideas / decide what they are on a Friday. I don't want the
   suggestions from the rest of the week to have gone." They were going — each 5:30am run
   overwrote the lot, so by Friday he was looking at Friday's five and Monday to Thursday had
   never existed as far as he was concerned. Five a day for a working week is about
   twenty-five, which is what a planning session wants in front of it. */
const SHELF_DAYS = 10;      // after that an unused idea is stale, and staleness reads as noise
const MAX_SHELF = 44;       // a week of eight, plus room for what he has pinned

const env = (k) => (process.env[k] || "").trim();
const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");
const nowIso = () => new Date().toISOString();
const store = () => getStore({ name: "bodysculpt-kpi", consistency: "strong" });

const empty = () => ({ generatedAt: "", ideas: [], about: "" });

export async function readIdeas() {
  try {
    const v = await store().get(KEY, { type: "json" });
    if (!v || typeof v !== "object") return empty();
    return { generatedAt: clip(v.generatedAt, 40), ideas: Array.isArray(v.ideas) ? v.ideas : [], about: clip(v.about, MAX_ABOUT) };
  } catch { return empty(); }
}

/* Two ideas are the same idea when they say the same thing, not when they match character for
   character — the generator will phrase yesterday's suggestion slightly differently tomorrow,
   and a shelf with the same reel on it five times is worse than no shelf. */
const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
export function sameIdea(a, b) {
  const A = norm(a), B = norm(b);
  if (!A || !B) return false;
  if (A === B) return true;
  /* "Rank the September restarts" and "Ranking September restarts worst to best" are the same
     idea, and comparing them word for word says they are not — rank/ranking and
     restart/restarts miss. Stemming the endings off is the honest fix; loosening the
     threshold instead would start merging ideas that genuinely differ, and a false merge
     silently loses a suggestion, which is the worse of the two mistakes. */
  const stem = (w) => w.replace(/(ings?|ing|ed|es|s)$/, "");
  const words = (t) => new Set(t.split(" ").map(stem).filter((w) => w.length > 3));
  const wa = words(A), wb = words(B);
  if (!wa.size || !wb.size) return false;
  let hit = 0;
  for (const w of wa) if (wb.has(w)) hit++;
  return hit / Math.min(wa.size, wb.size) >= 0.7;
}

/* What survives a new morning: everything he has kept, anything used (it stays visible so he
   can see what became a script), and everything else until it is ten days old or the shelf is
   full. Kept ideas never age out — keeping one is him saying it is still on. */
export function shelve(existing, fresh) {
  const now = Date.now();
  const alive = (existing || []).filter((i) =>
    i.kept || !i.addedAt || (now - Date.parse(i.addedAt)) < SHELF_DAYS * 864e5);
  const added = (fresh || []).filter((n) => !alive.some((o) => sameIdea(o.title, n.title)));
  const all = added.concat(alive);
  const kept = all.filter((i) => i.kept);
  const rest = all.filter((i) => !i.kept);
  return kept.concat(rest).slice(0, MAX_SHELF);
}

export async function setIdeaFlag(id, patch) {
  const cur = await readIdeas();
  cur.ideas = (patch && patch.drop)
    ? cur.ideas.filter((i) => i.id !== id)
    : cur.ideas.map((i) => (i.id === id ? { ...i, ...patch } : i));
  return await writeIdeas(cur);
}

// when a script gets kept, the idea it came from is marked rather than removed — he should be
// able to see on Friday which of the week's suggestions he actually turned into something
export async function markIdeaUsed(id, scriptId) {
  if (!id) return null;
  return await setIdeaFlag(id, { used: clip(scriptId, 40) || "yes" });
}
export async function writeIdeas(v) { await store().set(KEY, JSON.stringify(v)); return v; }

// v205: the writer and the checker need this too, so it gets a door of its own rather than
// each of them reading the ideas blob and hoping the shape stays put.
export async function readAbout() {
  try { return clip(((await readIdeas()) || {}).about, MAX_ABOUT); } catch { return ""; }
}

export async function setAbout(about) {
  const cur = await readIdeas();
  cur.about = clip(about, MAX_ABOUT);
  return await writeIdeas(cur);
}

// Ideas made today are today's ideas. Regenerating on every page load would spend money to
// hand him a different five every time he switched tabs, which is its own kind of noise.
export const isFresh = (v) => !!(v && v.generatedAt && v.generatedAt.slice(0, 10) === nowIso().slice(0, 10));

const SEASON = (d) => {
  const m = d.getMonth();
  if (m === 0) return "January — the busiest month of the year for gyms, and the one everybody else is shouting in";
  if (m === 1) return "February — when January's intake starts dropping off";
  if (m >= 2 && m <= 4) return "spring — people starting to think about summer";
  if (m >= 5 && m <= 7) return "summer — holidays, broken routines, quieter gyms";
  if (m === 8) return "September — back to routine after the summer, the second January";
  if (m === 9 || m === 10) return "autumn — dark evenings, motivation dipping";
  return "December — write-off month, and the run-up to January";
};

export function ideasPrompt({ about, voice, hooks, ownPosts, recentTopics, onShelf, trends, now }) {
  const winners = (hooks || []).slice(0, 12).map((h) =>
    "· " + (h.angle || h.template || "a reel") + " — @" + h.username +
    (h.vsMedian ? ", " + h.vsMedian.toFixed(1) + "× their normal" : "") +
    (h.why ? ". " + clip(h.why, 160) : "")).join("\n");
  const mine = (ownPosts || []).slice(0, 16).map((p) =>
    "· " + clip((p.caption || "").replace(/\s+/g, " "), 130) + (p.views != null ? "  (" + p.views + " views)" : "")).join("\n");

  return "You are helping Ash decide what to film. He runs Bodysculpt, a small group training gym in Warrington, UK. " +
    "His audience is local people who want to lose weight, get stronger and feel better — busy, ordinary, a lot of " +
    "them nervous about gyms and half-sure it will not work for them.\n\n" +
    (about ? "WHAT ASH SAYS ABOUT THE BUSINESS:\n" + clip(about, MAX_ABOUT) + "\n\n" : "") +
    (voice ? "HOW HE COMMUNICATES (for the subjects he returns to, not for style here):\n" + clip(voice, 4500) + "\n\n" : "") +
    (winners ? "WHAT IS WORKING FOR GYMS HE WATCHES — these beat their own account by double or more:\n" + winners + "\n\n" : "") +
    (mine ? "HIS OWN RECENT POSTS:\n" + mine + "\n\n" : "") +
    // v198: the sixth source — Friday's scroll of the wider feed, clearly labelled as coming
    // from outside so a nationally peaking meme cannot outrank a subject of his own
    (trends ? trends + "\n\n" : "") +
    (recentTopics && recentTopics.length ? "HE HAS ALREADY WRITTEN THESE — do not repeat them:\n" + recentTopics.map((t) => "· " + clip(t, 120)).join("\n") + "\n\n" : "") +
    // v200: the shelf builds up over the week, so today's five have to be five he has not
    // already been offered — otherwise Friday's planning session is the same idea five times
    (onShelf && onShelf.length ? "ALREADY SUGGESTED THIS WEEK AND STILL ON HIS LIST — give him five DIFFERENT ones:\n" +
      onShelf.map((t) => "· " + clip(t, 120)).join("\n") + "\n\n" : "") +
    "It is " + now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) + " — " + SEASON(now) + ".\n\n" +
    "Give him " + WANT + " reels he could film THIS WEEK. Use the material above properly — there is a lot of it, " +
    "and eight genuinely different angles are in there.\n\n" +
    "What makes one of these good:\n" +
    "· It is a SUBJECT, not a format. \"Answer the bulky question\" is an idea; \"do a talking head\" is not.\n" +
    "· He could film it in his own gym this week with the people who are already there. No actors, no studio, " +
    "nothing that needs a client to agree to be filmed crying.\n" +
    "· It comes from something real above — a question he already answers, a subject that worked for someone " +
    "else, a post of his own worth a second angle, what is trending more widely, or the time of year. " +
    "Never a generic content-calendar filler.\n" +
    "· It is specific enough that he knows what to point the camera at before he has read the second sentence.\n" +
    "· Between them they cover different ground: do not give five versions of one idea.\n\n" +
    "Answer as exactly " + WANT + " blocks in this format and nothing else:\n" +
    "---IDEA---\n" +
    "TITLE: the idea in plain words, as one line he would say out loud. Under twelve words. Not a headline, not a hook.\n" +
    "WHY: one sentence on why this one is worth his time this week.\n" +
    "SOURCE: where it came from, in a few words — e.g. \"@dm_pt got 30× with this\", \"your reel on X did 9.6k\", " +
    "\"you answer this in your captions\", \"it is September\".\n" +
    "FORMAT: one of these three, and it must not contradict the title.\n" +
    "  onscreen — footage with text over it, nobody speaks. He makes these most.\n" +
    "  talking  — he speaks to camera.\n" +
    "  demo     — he speaks while showing something.\n" +
    "If the idea is about showing rather than saying, it is onscreen. An idea whose title says " +
    "\"no talking\" and whose format says talking or demo is a contradiction, and the writer will " +
    "follow the format and write him a monologue for a silent reel.\n";
}

const field = (block, name) => {
  const m = new RegExp("^" + name + ":\\s*(.*)$", "im").exec(block || "");
  return m ? m[1].trim() : "";
};

export function parseIdeas(text) {
  return text.split("---IDEA---").slice(1).map((b, i) => {
    const format = field(b, "FORMAT").toLowerCase();
    return {
      id: "i" + Date.now().toString(36) + i,
      addedAt: nowIso(),
      kept: false,
      used: "",
      title: clip(field(b, "TITLE"), 160),
      why: clip(field(b, "WHY"), 300),
      source: clip(field(b, "SOURCE"), 120),
      format: ["onscreen", "talking", "demo"].includes(format) ? format : "onscreen",
    };
  }).map((x) => {
    /* v196: found in testing — an idea came back titled "…start to finish, no talking" with
       its format set to demo, and the writer did as the format said and wrote a monologue for
       a silent reel. A title that rules speech out overrules a format that puts it back. */
    const silent = /\bno talking\b|\bno voice ?over\b|\bsilent\b|\bwithout (?:talking|speaking)\b/i.test(x.title);
    return silent && x.format !== "onscreen" ? { ...x, format: "onscreen" } : x;
  }).filter((x) => x.title);
}

export async function generate(deps) {
  if (!env("ANTHROPIC_API_KEY")) throw new Error("ANTHROPIC_API_KEY is not set.");
  const cur = await readIdeas();
  const client = new Anthropic();
  const started = Date.now();
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 2000,
    // the 26-second wall: choosing five subjects is judgement, not deep reasoning
    output_config: { effort: "low" },
    messages: [{ role: "user", content: ideasPrompt({ ...deps, about: cur.about,
      onShelf: (cur.ideas || []).filter((i) => !i.used).map((i) => i.title), now: new Date() }) }],
  });
  console.log("[ideas] " + JSON.stringify({ ms: Date.now() - started, stop: response.stop_reason }));
  if (response.stop_reason === "refusal") throw new Error("Claude declined to suggest ideas.");
  const ideas = parseIdeas(response.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  if (!ideas.length) throw new Error("No ideas came back. Try again in a moment.");
  // v200: added to the shelf, not swapped for it
  return await writeIdeas({ generatedAt: nowIso(), ideas: shelve(cur.ideas, ideas), about: cur.about });
}

/* Everything the generator reads, gathered in one place so both the API and the nightly run
   assemble it identically. */
export async function gather(lib) {
  const s = store();
  let ownPosts = [];
  try {
    const mine = await s.get("ig-cache-mine", { type: "json" });
    ownPosts = ((mine && mine.posts) || [])
      .filter((p) => p.caption)
      .sort((a, b) => ((b.views != null ? b.views : b.reach) || 0) - ((a.views != null ? a.views : a.reach) || 0));
  } catch { /* no cache is a thinner prompt, not a failure */ }
  const v = await readVoice();
  const t = await readTrends();
  return {
    trends: trendBrief(t),
    voice: (v && v.profile) || "",
    hooks: (lib && lib.hooks) || [],
    ownPosts,
    recentTopics: ((lib && lib.scripts) || []).slice(0, 15).map((x) => x.topic).filter(Boolean),
  };
}
