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

export const KEY = "ig-ideas";
const WANT = 5;
const MAX_ABOUT = 3000;

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
export async function writeIdeas(v) { await store().set(KEY, JSON.stringify(v)); return v; }

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

export function ideasPrompt({ about, voice, hooks, ownPosts, recentTopics, now }) {
  const winners = (hooks || []).slice(0, 12).map((h) =>
    "· " + (h.angle || h.template || "a reel") + " — @" + h.username +
    (h.vsMedian ? ", " + h.vsMedian.toFixed(1) + "× their normal" : "") +
    (h.why ? ". " + clip(h.why, 160) : "")).join("\n");
  const mine = (ownPosts || []).slice(0, 8).map((p) =>
    "· " + clip((p.caption || "").replace(/\s+/g, " "), 130) + (p.views != null ? "  (" + p.views + " views)" : "")).join("\n");

  return "You are helping Ash decide what to film. He runs Bodysculpt, a small group training gym in Warrington, UK. " +
    "His audience is local people who want to lose weight, get stronger and feel better — busy, ordinary, a lot of " +
    "them nervous about gyms and half-sure it will not work for them.\n\n" +
    (about ? "WHAT ASH SAYS ABOUT THE BUSINESS:\n" + clip(about, MAX_ABOUT) + "\n\n" : "") +
    (voice ? "HOW HE COMMUNICATES (for the subjects he returns to, not for style here):\n" + clip(voice, 2500) + "\n\n" : "") +
    (winners ? "WHAT IS WORKING FOR GYMS HE WATCHES — these beat their own account by double or more:\n" + winners + "\n\n" : "") +
    (mine ? "HIS OWN RECENT POSTS:\n" + mine + "\n\n" : "") +
    (recentTopics && recentTopics.length ? "HE HAS ALREADY WRITTEN THESE — do not repeat them:\n" + recentTopics.map((t) => "· " + clip(t, 120)).join("\n") + "\n\n" : "") +
    "It is " + now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) + " — " + SEASON(now) + ".\n\n" +
    "Give him " + WANT + " reels he could film THIS WEEK.\n\n" +
    "What makes one of these good:\n" +
    "· It is a SUBJECT, not a format. \"Answer the bulky question\" is an idea; \"do a talking head\" is not.\n" +
    "· He could film it in his own gym this week with the people who are already there. No actors, no studio, " +
    "nothing that needs a client to agree to be filmed crying.\n" +
    "· It comes from something real above — a question he already answers, a subject that worked for someone " +
    "else, a post of his own worth a second angle, or the time of year. Never a generic content-calendar filler.\n" +
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
    messages: [{ role: "user", content: ideasPrompt({ ...deps, about: cur.about, now: new Date() }) }],
  });
  console.log("[ideas] " + JSON.stringify({ ms: Date.now() - started, stop: response.stop_reason }));
  if (response.stop_reason === "refusal") throw new Error("Claude declined to suggest ideas.");
  const ideas = parseIdeas(response.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
  if (!ideas.length) throw new Error("No ideas came back. Try again in a moment.");
  return await writeIdeas({ generatedAt: nowIso(), ideas, about: cur.about });
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
  return {
    voice: (v && v.profile) || "",
    hooks: (lib && lib.hooks) || [],
    ownPosts,
    recentTopics: ((lib && lib.scripts) || []).slice(0, 15).map((x) => x.topic).filter(Boolean),
  };
}
