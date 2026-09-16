// netlify/lib/hooks.js  (v177)
//
// The Hooks page's back end, shared by three functions:
//   hooks-api.js                 the library: read it, ask for a script, keep the script
//   hooks-mine-background.js     listen to the reels that took off and templatise them (slow)
//   hooks-mine-scheduled.js      the nightly trigger, straight after the competitor scrape
//
// WHAT THIS IS FOR. The Competitors tab already says WHICH reels took off — the flame is a
// post that did at least twice its own account's normal. What it has never said is what was
// actually SAID in them. A flame with no words under it tells Ash that something worked and
// leaves him to guess what. This reads the opening of every flamed reel, writes down the
// line that was spoken, the words that were on the screen, and — the part that makes it
// reusable — the shape underneath both, with the specifics taken out:
//
//     "Everyone thinks cardio burns the most fat. It doesn't."
//   → "Everyone thinks [THING] does [OUTCOME]. It doesn't."
//
// The shape is the asset. It survives being said about a completely different subject,
// which the original sentence does not.
//
// WHY ONLY THE FLAMES. Reading a video costs a Gemini call and about half a minute. Reading
// all fifteen posts from ten accounts every night would be 150 of them for no gain — a post
// that did its account's normal has nothing to teach. Mining only what beat 2× keeps the
// nightly cost near nothing and means every row in the library earned its place.
//
// One blob key, `ig-hooks`:
//   { hooks[], scripts[], skipped[], lastMineAt, lastMineNote }
//   hook   { id, username, isOwn, url, postedAt, views, vsMedian, basis, spoken, onScreen,
//            template, type, why, angle, minedAt }
//   script { id, createdAt, topic, format, hookId, type, spoken, onScreen, body, cta,
//            caption, visual, status, updatedAt }
//   script status: draft → filmed → posted   (binned is a side exit)
//
// Environment: GEMINI_API_KEY (reading the video), ANTHROPIC_API_KEY (the writing). Both
// are already on the site for the Scheduling page. Nothing new to set up.
import { getStore } from "@netlify/blobs";
import Anthropic from "@anthropic-ai/sdk";
import { geminiAsk, voiceBrief } from "./schedule.js";
import { freshOwnVideoUrls, fetchVideo } from "./ig-media.js";
import { preferenceBrief } from "./learn.js";
import { readAbout } from "./ideas.js";

export const KEY = "ig-hooks";
const MAX_HOOKS = 400;
const MAX_SCRIPTS = 200;
// One background run has fifteen minutes and a reel takes thirty to ninety seconds, most of
// it waiting for Google to finish processing the upload. Eight leaves generous headroom; a
// night with more flames than that finishes on the following night, which is fine — nothing
// expires from the queue except the CDN link, and a missed reel simply isn't mined.
const MINE_PER_RUN = 8;
const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

const env = (k) => (process.env[k] || "").trim();
export const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");
export const nowIso = () => new Date().toISOString();
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const store = () => getStore({ name: "bodysculpt-kpi", consistency: "strong" });

/* v183: is this failure worth trying again?
   Found on the live site: the hook library was empty and nothing was waiting, because a busy
   minute at Google ("This model is currently experiencing high demand") had put every
   candidate on the skip list — permanently. v177's reasoning for skipping was sound for the
   case it was written about (a CDN link that has expired is gone tomorrow, so a retry costs
   money to fail identically) and wrong for everything else. A model that was busy at 5am is
   not busy for ever, and nothing should be thrown away because of it. */
const TRANSIENT = /high demand|overloaded|try again later|resource exhausted|unavailable|rate.?limit|timed? ?out|fetch failed|network|ECONN|socket|503|502|504|429/i;
export const isTransient = (message) => TRANSIENT.test(String(message || ""));

export function config() {
  return {
    gemini: !!env("GEMINI_API_KEY"),
    anthropic: !!env("ANTHROPIC_API_KEY"),
    apify: !!env("APIFY_API_TOKEN"),
  };
}

/* ---------- the library in the store ---------- */
const empty = () => ({ hooks: [], scripts: [], skipped: [], lastMineAt: "", lastMineNote: "" });

export async function readLib() {
  try {
    const l = await store().get(KEY, { type: "json" });
    if (!l || typeof l !== "object") return empty();
    return {
      hooks: Array.isArray(l.hooks) ? l.hooks : [],
      scripts: Array.isArray(l.scripts) ? l.scripts : [],
      skipped: Array.isArray(l.skipped) ? l.skipped : [],
      lastMineAt: clip(l.lastMineAt, 40),
      lastMineNote: clip(l.lastMineNote, 300),
    };
  } catch { return empty(); }
}

export async function writeLib(lib) {
  const safe = {
    // newest first, and the cap bites at the OLD end: a library that has run for two years
    // should forget the reel from two years ago, not the one from last night.
    hooks: lib.hooks.slice(0, MAX_HOOKS),
    scripts: lib.scripts.slice(0, MAX_SCRIPTS),
    skipped: lib.skipped.slice(-MAX_HOOKS),
    lastMineAt: lib.lastMineAt || "",
    lastMineNote: lib.lastMineNote || "",
  };
  await store().set(KEY, JSON.stringify(safe));
  return safe;
}

/* ---------- which reels took off ----------
   The same rule the Content page draws its flame with, applied to the same stored numbers,
   so the two pages can never disagree about what "took off" means. Median rather than mean,
   because one viral reel would drag a mean up and then hide behind it; four values minimum,
   because a median of two or three is not a normal, it is a coin toss. */
function medianOf(values) {
  const v = values.filter((x) => typeof x === "number" && isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length < 4) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/* A competitor's account, from the nightly scrape.
   v183: views WHERE THERE ARE ENOUGH OF THEM, engagement otherwise — which is what the
   Content page has always done, and what this did not. Found by testing against the live
   site: @dm_pt showed five flames on the Competitors tab and produced nought candidates
   here, because only three of its twenty-five posts carry a play count and this function
   gave up when it could not build a median from views. The page and the miner disagreeing
   about which reels took off is exactly the thing v177's test claimed could not happen.

   Raw engagement is the right fallback and not a compromise: inside ONE account the follower
   count is a constant, so ranking likes+comments against that account's own median gives the
   identical answer to ranking engagement RATE against its median. Across accounts it would
   be meaningless — which is why it is never used that way. */
function flamesFromScrape(rec) {
  const posts = (rec && rec.posts) || [];
  const withViews = posts.filter((p) => typeof p.views === "number" && p.views > 0).length;
  const useViews = withViews >= 4;
  const valueOf = (p) => useViews ? p.views : ((p.likes || 0) + (p.comments || 0));
  const median = medianOf(posts.map(valueOf));
  if (!median) return [];
  return posts
    .map((p) => ({ ...p, vsMedian: valueOf(p) > 0 ? valueOf(p) / median : null }))
    .filter((p) => p.vsMedian != null && p.vsMedian >= 2 && p.videoUrl)
    .map((p) => ({
      id: p.shortCode,
      username: rec.username,
      isOwn: false,
      url: p.url || ("https://www.instagram.com/reel/" + p.shortCode + "/"),
      videoUrl: p.videoUrl,
      caption: p.caption || "",
      postedAt: p.timestamp || "",
      views: num(p.views),
      vsMedian: p.vsMedian,
      basis: useViews ? "views" : "engagement",
    }));
}

// Ash's own account, from the feed's cache — it has already marked its own outliers, on
// reach-based engagement, which is the honest measure and only possible on an account you
// own. Taking its flag rather than recomputing keeps one definition of his own normal.
function flamesFromMine(mine) {
  const posts = (mine && mine.posts) || [];
  const handle = (mine && mine.account && mine.account.username) || "you";
  return posts
    .filter((p) => p.outlier && p.video)
    .map((p) => ({
      id: shortCodeOf(p.permalink) || clip(p.id, 40),
      // v180: the MEDIA id as well as the short code. The short code identifies the hook in
      // the library; the media id is what Instagram will trade for a current video link,
      // because the cached one is signed and dies within hours.
      mediaId: clip(p.id, 40),
      username: handle,
      isOwn: true,
      url: p.permalink,
      videoUrl: p.video,
      caption: p.caption || "",
      postedAt: p.timestamp || "",
      views: num(p.views) != null ? num(p.views) : num(p.reach),
      vsMedian: p.vsMedian,
      basis: "engagement",
    }));
}

const shortCodeOf = (permalink) => {
  const m = /instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/.exec(String(permalink || ""));
  return m ? m[1] : "";
};

// Everything flamed that has not already been mined or given up on. Competitors first —
// they are the ones with something new to teach; his own reels confirm what already works.
export async function candidates(lib) {
  const seen = new Set([...(lib.hooks || []).map((h) => h.id), ...(lib.skipped || [])]);
  const out = [];
  try {
    const watched = (await store().get("ig-competitors", { type: "json" })) || [];
    for (const c of watched) {
      const u = clip(String((c && c.username) || ""), 40).toLowerCase();
      if (!u) continue;
      const rec = await store().get("ig-scrape-" + u, { type: "json" });
      for (const f of flamesFromScrape(rec)) if (f.id && !seen.has(f.id)) out.push(f);
    }
  } catch { /* an unreadable watch list means no competitors this run, not a failed run */ }
  try {
    const mine = await store().get("ig-cache-mine", { type: "json" });
    for (const f of flamesFromMine(mine)) if (f.id && !seen.has(f.id)) out.push(f);
  } catch { /* same */ }
  // biggest outliers first, so a capped run spends its budget on the clearest winners
  return out.sort((a, b) => (b.vsMedian || 0) - (a.vsMedian || 0));
}

/* ---------- reading one reel ----------
   Gemini is asked for the opening only. The back half of a reel is where the content is,
   but the hook is the first three seconds, and asking for the whole transcript would bury
   the one line that matters in four hundred words that do not. */
const READ_PROMPT =
  "This is an Instagram reel. Answer about the FIRST THREE SECONDS only, in exactly this format and nothing else:\n" +
  "SPOKEN: the words said in the first three seconds, verbatim. If nothing is said, write: none\n" +
  "ONSCREEN: the text written on the screen at the start, verbatim. If there is none, write: none\n" +
  "ABOUT: what the whole reel is about, in one short sentence.";

const field = (text, name) => {
  const m = new RegExp("^" + name + ":\\s*(.*)$", "im").exec(text || "");
  const v = m ? m[1].trim() : "";
  return /^none$/i.test(v) ? "" : v;
};

export async function readReel(cand, url) {
  // v180: through ig-media's fetchVideo, which sends the headers Instagram's CDN expects and
  // names the reason when it still says no — a bare server fetch gets refused outright.
  const { buffer, mime } = await fetchVideo(url || cand.videoUrl, MAX_VIDEO_BYTES);
  const text = await geminiAsk(buffer, mime, cand.id + ".mp4", READ_PROMPT, 2000);
  return {
    spoken: clip(field(text, "SPOKEN"), 400),
    onScreen: clip(field(text, "ONSCREEN"), 200),
    about: clip(field(text, "ABOUT"), 300),
  };
}

/* ---------- Claude: turning one opening into a template ----------
   The archetypes are a fixed list on purpose. Left to invent a category per hook, the model
   produces four hundred categories and the library cannot be filtered; the whole value of a
   type is that several hooks share it. They are named for what a gym audience actually
   responds to, not for what a tech account posts. */
export const HOOK_TYPES = [
  "Objection killer", "Myth bust", "Transformation reveal", "Viewer callout",
  "Mistake or warning", "Comparison", "Number or framework", "Cost and value",
  "Relatable struggle", "Contrarian take", "Client story", "Behind the scenes",
  "Quick how-to", "Curiosity gap",
];

function templatePrompt(cand, read) {
  return "You analyse Instagram reel hooks for a gym in Warrington, UK.\n\n" +
    "This reel did " + (cand.vsMedian ? cand.vsMedian.toFixed(1) : "well") + "× what @" + cand.username + " normally does, so its opening worked.\n\n" +
    'Spoken in the first three seconds: "' + (read.spoken || "(nothing said)") + '"\n' +
    'Text on screen at the start: "' + (read.onScreen || "(none)") + '"\n' +
    "What the reel is about: " + (read.about || "(unclear)") + "\n" +
    (cand.caption ? 'Caption: "' + clip(cand.caption, 300) + '"\n' : "") +
    "\nAnswer in exactly this format and nothing else:\n" +
    "TYPE: one of — " + HOOK_TYPES.join(", ") + "\n" +
    "TEMPLATE: the reusable shape of the hook with the specifics replaced by [CAPITALS IN BRACKETS]. " +
    "It must be a sentence somebody could say about a different subject. Keep the rhythm and the word order of the original.\n" +
    "WHY: one sentence on why this stops a thumb, in plain British English.\n" +
    "ANGLE: three or four words for the subject.\n\n" +
    "Rules: judge only what is here, never invent a line that was not said. If nothing was spoken, " +
    "build the template from the on-screen text instead.";
}

/* v190: EFFORT, because there is a 26-second wall and this was leaning on it.
   Found by pressing Find openings on the live page: HTTP 504. The same call had squeaked
   through on the command line minutes earlier, which is the worst kind of pass — it means
   the margin is thin rather than the feature working.
   Opus 5 thinks by default and defaults to HIGH effort, and these are not reasoning jobs:
   writing eight variations of a hook, or a caption, is generation. Low effort is the setting
   that matches the task, and it is what puts the call comfortably inside the wall rather than
   a second or two under it. Mining stays at the default — it runs in a background function
   with fifteen minutes and its judgement about what a hook IS deserves the thought. */
async function ask(prompt, maxTokens, effort) {
  if (!env("ANTHROPIC_API_KEY")) throw new Error("ANTHROPIC_API_KEY is not set.");
  const client = new Anthropic();
  const started = Date.now();
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: maxTokens || 1024,
    ...(effort ? { output_config: { effort } } : {}),
    messages: [{ role: "user", content: prompt }],
  });
  console.log("[hooks] " + JSON.stringify({ stage: "claude", ms: Date.now() - started, effort: effort || "default",
    out: response.usage && response.usage.output_tokens }));
  if (response.stop_reason === "refusal") throw new Error("Claude declined to answer.");
  return response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

export async function templatise(cand, read) {
  const text = await ask(templatePrompt(cand, read), 700);
  const type = clip(field(text, "TYPE"), 40);
  return {
    type: HOOK_TYPES.includes(type) ? type : "Curiosity gap",
    template: clip(field(text, "TEMPLATE"), 300),
    why: clip(field(text, "WHY"), 300),
    angle: clip(field(text, "ANGLE"), 80),
  };
}

/* ---------- one candidate, start to finish ---------- */
export async function mineOne(cand, url) {
  const read = await readReel(cand, url);
  if (!read.spoken && !read.onScreen) throw new Error("Nothing was said and there was no text on screen — there is no hook to learn.");
  const t = await templatise(cand, read);
  return {
    id: cand.id,
    username: cand.username,
    isOwn: !!cand.isOwn,
    url: cand.url,
    postedAt: cand.postedAt,
    views: cand.views,
    vsMedian: cand.vsMedian,
    basis: cand.basis,
    spoken: read.spoken,
    onScreen: read.onScreen,
    template: t.template,
    type: t.type,
    why: t.why,
    angle: t.angle,
    minedAt: nowIso(),
  };
}

export async function mine(limit, log) {
  const lib = await readLib();
  const cands = (await candidates(lib)).slice(0, limit || MINE_PER_RUN);
  // Only asked for when one of his own reels is in the batch — competitors' links come from
  // the Apify scrape half an hour earlier and are still warm.
  const fresh = cands.some((c) => c.isOwn) ? await freshOwnVideoUrls(25) : new Map();
  let done = 0, failed = 0;
  for (const c of cands) {
    try {
      const hook = await mineOne(c, (c.isOwn && fresh.get(String(c.mediaId))) || c.videoUrl);
      // v189: named for what it is, and NOT `fresh` — which is the links Map two lines up.
      // A second `const fresh` in this block put the Map in the temporal dead zone, so the
      // line above threw "Cannot access 'fresh' before initialization" for any of Ash's OWN
      // reels. Competitors short-circuit on `c.isOwn &&` and never touch it, which is why
      // every test and the first live run passed while his own reels would have been lost —
      // and lost for good, because a ReferenceError is not transient, so it skipped them.
      const lib2 = await readLib();                        // re-read: a script may have been saved meanwhile
      lib2.hooks = [hook, ...lib2.hooks.filter((h) => h.id !== hook.id)];
      lib2.lastMineAt = nowIso();
      // the last failure goes with it, or a library that filled up fine still carries the
      // note from the night Google was busy, which reads as a live fault
      lib2.lastMineNote = "";
      await writeLib(lib2);
      done++;
      log && log({ stage: "mined", id: c.id, username: c.username, type: hook.type });
    } catch (e) {
      failed++;
      const msg = clip((e && e.message) || "", 200);
      // Only a PERMANENT failure earns a place on the skip list. An expired link is gone
      // tomorrow and retrying it costs money to fail identically; a busy model is not, and
      // burning the candidate over it loses a hook for good.
      const retryable = isTransient(msg);
      const lib2 = await readLib();
      if (!retryable) lib2.skipped = lib2.skipped.concat([c.id]);
      lib2.lastMineAt = nowIso();
      lib2.lastMineNote = msg;
      await writeLib(lib2);
      log && log({ stage: retryable ? "deferred" : "skipped", id: c.id, username: c.username, message: msg });
    }
  }
  return { considered: cands.length, mined: done, skipped: failed };
}

/* ---------- Claude: the hook options, then the script ----------
   v178: the voice reference goes through schedule.js's voiceBrief(), which hands back the
   SPOKEN profile when one has been built — transcripts of his own best reels, describing how
   he actually talks — and falls back to his captions when it has not. The block arrives
   pre-labelled, because a profile is an instruction and a list of captions is only evidence;
   these prompts embed it verbatim and add no heading of their own. */
const AUDIENCE =
  "Bodysculpt is a gym in Warrington, UK, run by Ash. The audience is local people who want to lose weight, " +
  "get stronger and feel better — busy, ordinary, a lot of them nervous about gyms and half-sure it will not work for them. " +
  "Plain British English. No hype, no American gym-bro language, no emojis.";

/* v182: THREE formats, and the silent one is the default.
   Ash: "we don't have enough videos where we're talking … those types of videos aren't
   massive in the small group gym world, our prospects value on-screen hooks more with the
   captions doing the heavy lifting."
   v177 wrote a monologue and only a monologue. For a gym that does not make talking-head
   reels that is not a weak output, it is an unusable one — and a tool that hands back
   something you would never film is a tool you stop opening. The hook library was already
   fine (it reads on-screen text separately and templatises from it when nothing is spoken);
   it was the WRITER that assumed a person talking to camera. */
export const FORMATS = {
  onscreen: { label: "On-screen reel", lead: "onScreen" },
  talking:  { label: "To camera",      lead: "spoken" },
  demo:     { label: "Walkthrough",    lead: "spoken" },
};
export const isFormat = (f) => Object.prototype.hasOwnProperty.call(FORMATS, f);
export const normFormat = (f) => (isFormat(f) ? f : "onscreen");
// which line the reel actually opens with — the one the option is chosen on
export const leadOf = (option, format) =>
  (normFormat(format) === "onscreen" ? (option.onScreen || option.spoken) : (option.spoken || option.onScreen)) || "";

export function optionsPrompt(topic, hooks, voice, format, prefs) {
  const fmt = normFormat(format);
  const silent = fmt === "onscreen";
  const lines = hooks.map((h, i) =>
    (i + 1) + '. [' + h.type + '] "' + h.template + '"' +
    // for a silent reel the evidence that matters is what the winning reel PUT ON SCREEN,
    // not what its presenter said — so that is what gets shown to the writer first
    (silent && h.onScreen ? '  — on screen: "' + clip(h.onScreen, 120) + '"' : "") +
    (h.spoken ? '  — said: "' + clip(h.spoken, 120) + '"' : "") +
    (h.vsMedian ? "  (" + h.vsMedian.toFixed(1) + "× for @" + h.username + ")" : "")).join("\n");

  const parts = silent
    ? "  ONSCREEN — the words on the screen in the first second. Three to eight words. This is the whole hook: nobody is speaking, so it carries the reel on its own. Write it as something you would read, not say.\n" +
      "  CAPTION — the first line of the caption. Five to fifteen words. On a silent reel the caption does the heavy lifting, so this line has to earn the tap on 'more'.\n"
    : "  SPOKEN — what Ash says in the first three seconds. Three to twelve words. It is a sentence a person says out loud, not a headline.\n" +
      "  ONSCREEN — the words on the screen. Three to eight words. It ADDS to the spoken line, it does not repeat it.\n" +
      "  CAPTION — a short first line for the caption. Three to ten words. Punchy or curious, never a summary.\n";

  return AUDIENCE + "\n\n" +
    (silent
      ? "This is a SILENT reel: footage with text over it, no talking head, and a caption underneath. Nobody speaks. Do not write a spoken line.\n\n"
      : "") +
    "These hook shapes are proven: each one is taken from a reel that beat its own account's normal by at least double.\n\n" +
    lines + "\n\n" +
    (voice ? voice + "\n\n" : "") +
    // v194: what he actually goes for, from what he has picked and what those reels then did
    (prefs ? prefs + "\n\n" : "") +
    'The reel is about: "' + clip(topic, 400) + '"\n\n' +
    "Write EIGHT hook options for this topic, each one built on a different shape from the list above.\n" +
    /* v189: with one shape in the library, all eight came back opening on the same word —
       faithful to the template and useless as a choice. A template is a structure to borrow,
       not a phrase to repeat, and when there are fewer shapes than options that has to be
       said out loud or the model will copy the words. */
    (hooks.length < 8
      ? "There are only " + hooks.length + (hooks.length === 1 ? " shape" : " shapes") +
        " here, so you will have to reuse them. A shape is a STRUCTURE to borrow, not a phrase to copy: " +
        "no two of the eight may open on the same word, and each must take a genuinely different angle on the topic.\n"
      : "") +
    "For each, the parts must work together and must not repeat each other:\n" + parts + "\n" +
    "Answer as exactly eight blocks in this format and nothing else:\n" +
    "---HOOK---\nN: (the number of the shape you used)\n" +
    (silent ? "" : "SPOKEN: ...\n") +
    "ONSCREEN: ...\nCAPTION: ...\nWHY: (one short sentence: why this stops a Warrington thumb)\n";
}

export function parseOptions(text, hooks, format) {
  return text.split("---HOOK---").slice(1).map((block) => {
    const n = parseInt(field(block, "N"), 10);
    const src = hooks[n - 1];
    return {
      spoken: clip(field(block, "SPOKEN"), 200),
      onScreen: clip(field(block, "ONSCREEN"), 120),
      caption: clip(field(block, "CAPTION"), 200),
      why: clip(field(block, "WHY"), 300),
      hookId: src ? src.id : "",
      type: src ? src.type : "",
      template: src ? src.template : "",
    };
    // v182: the option is kept on whichever line OPENS the reel. A silent reel has no spoken
    // line at all, and filtering on `spoken` threw every one of them away.
  }).map((o) => ({ ...o, lead: leadOf(o, format) })).filter((o) => o.lead);
}

// The library, ranked for the writer: the biggest outliers, but spread across archetypes so
// eight options cannot all turn out to be the same idea wearing different words.
export function forWriting(hooks, want) {
  const byType = new Map();
  for (const h of [...hooks].sort((a, b) => (b.vsMedian || 0) - (a.vsMedian || 0))) {
    if (!h.template) continue;
    if (!byType.has(h.type)) byType.set(h.type, []);
    byType.get(h.type).push(h);
  }
  const out = [];
  for (let round = 0; out.length < (want || 16); round++) {
    let added = 0;
    for (const list of byType.values()) if (list[round]) { out.push(list[round]); added++; }
    if (!added) break;
  }
  return out.slice(0, want || 16);
}

export async function hookOptions(topic, format) {
  const lib = await readLib();
  const hooks = forWriting(lib.hooks, 16);
  if (!hooks.length) throw new Error("There are no hooks in the library yet. Press Find hooks once the competitor scrape has run.");
  const text = await ask(optionsPrompt(topic, hooks, await voiceBrief(), format, preferenceBrief(lib.scripts)), 3000, "low");
  const options = parseOptions(text, hooks, format);
  if (!options.length) throw new Error("Claude returned no usable hooks. Try wording the topic differently.");
  return options;
}

export function scriptPrompt(topic, option, format, voice, about) {
  const fmt = normFormat(format);
  /* v205: the playbook rides with the script prompt but NOT with the options prompt.
     The script is where facts land — the 6 Week Challenge, the accountability coach, what is
     and is not included — and writing one without them means writing around the gap. The
     options call only needs to produce eight opening lines, does not touch a fact, and is the
     one call that has already hit the 26-second wall once; nine thousand tokens of playbook is
     the last thing it needs. */
  const playbook = about
    ? "WHAT THE GYM ACTUALLY DOES — his own words, and the only source of fact here. Use it for " +
      "detail, and never state anything about the gym that is not in it:\n" + clip(about, 40000) + "\n\n"
    : "";
  const common =
    "How it has to read:\n" +
    "· Like one person talking to one other person, not a brand addressing a market. Lumpy, not balanced.\n" +
    "· Speak to the viewer directly — you, your.\n" +
    "· Say what happens, not how it works. The detail is what they come in for.\n" +
    "· Never promise a result, a timescale or a price that is not in the topic above. This is a real gym and it has to be true.\n\n" +
    "Banned, because they are what marketing sounds like and not what Ash sounds like: " +
    '"Let me break this down", "What if I told you", "Here is the thing", "The truth is", "In today\'s world", ' +
    '"game changer", "unlock", "dive in", "journey", "transform your life", and any sentence that starts with "So,".\n' +
    "Do not write three short lines in a row with the same shape. Do not write \"It's not X. It's Y.\"\n\n";

  if (fmt === "onscreen") {
    /* The silent reel. There is no monologue to write, and pretending otherwise is what made
       v177 useless here. What Ash actually needs off this page is: the card that opens it,
       the handful of lines that carry it, what to point the camera at for each, and a caption
       that can stand on its own — because on a silent reel the caption is where the selling
       happens, not a label under the video. */
    return AUDIENCE + "\n\n" +
      "This is a SILENT reel: footage with text over it, no talking head, no voiceover. Every word is either " +
      "ON THE SCREEN or in the CAPTION.\n\n" +
      playbook +
      (voice ? voice + "\n\n" : "") +
      'The reel is about: "' + clip(topic, 400) + '"\n' +
      'It opens with this on the screen: "' + (option.onScreen || option.spoken) + '"\n\n' +
      "Write the rest of it.\n\n" +
      common +
      "The beats are what appears on screen after the opening card, in order. Two to five of them — fewer is " +
      "usually better. Each is ONE line a person can read while the clip is moving: under nine words, no " +
      "semicolons, no sentence that needs reading twice. They have to make sense read straight through, " +
      "because that is how they will be read.\n\n" +
      "The caption is the long half of this reel and the only place anything can be explained. Open with a line " +
      "that earns the tap on 'more', then two or three short paragraphs, then the call to action, then 3 to 5 " +
      "lowercase hashtags relevant to the video and to Warrington. It must stand on its own for somebody who " +
      "watched with the sound off and never read the screen.\n\n" +
      "Answer in exactly this format and nothing else:\n" +
      "---BEATS---\n(one per line, as: the on-screen line | what is on camera under it)\n" +
      "---CAPTION---\n(the full caption, as described above)\n" +
      "---CTA---\n(one line: what you want them to do. If it suits, comment a word; otherwise follow @bodysculptwarrington for more. Never \"link in bio\".)\n" +
      "---VISUAL---\n(one line: what is on camera behind the opening card)\n";
  }

  const shape = fmt === "demo" ? "a walkthrough — show the thing, 150 to 200 words" : "a piece to camera — one strong point, about 100 words";
  return AUDIENCE + "\n\n" +
    playbook +
    (voice ? voice + "\n\n" : "") +
    'The reel is about: "' + clip(topic, 400) + '"\n' +
    'It opens with him saying: "' + (option.spoken || option.onScreen) + '"\n' +
    (option.onScreen ? 'On the screen at that moment: "' + option.onScreen + '"\n' : "") +
    "\nWrite the rest of it as " + shape + ".\n\n" +
    common +
    "Answer in exactly this format and nothing else:\n" +
    "---BODY---\n(what he says after the hook)\n" +
    "---CTA---\n(one line: what he asks them to do. If it suits, comment a word; otherwise follow @bodysculptwarrington for more. Never \"link in bio\".)\n" +
    "---CAPTION---\n(the caption: the first line, then a blank line, then 3 to 5 lowercase hashtags relevant to the video and to Warrington)\n" +
    "---VISUAL---\n(one line: what is on screen while he says the hook)\n";
}

// "line | what is on camera" — the shot note is optional, because sometimes the footage is
// obvious and inventing a direction for it would be noise.
export function parseBeats(text) {
  return String(text || "").split("\n")
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("|");
      return i < 0
        ? { text: clip(l, 120), shot: "" }
        : { text: clip(l.slice(0, i).trim(), 120), shot: clip(l.slice(i + 1).trim(), 160) };
    })
    .filter((b) => b.text)
    .slice(0, 6);
}

export async function writeScript(topic, option, format) {
  const fmt = normFormat(format);
  const text = await ask(scriptPrompt(topic, option, fmt, await voiceBrief(), await readAbout()), 2000, "low");
  const part = (name) => {
    const m = new RegExp("---" + name + "---\\s*([\\s\\S]*?)(?=---[A-Z]+---|$)").exec(text);
    return m ? m[1].trim() : "";
  };

  const beats = fmt === "onscreen" ? parseBeats(part("BEATS")) : [];
  // `body` stays the plain-text rendering of whatever was written, silent or spoken, so the
  // To-film list, the copy button and the saved record all keep working without knowing which
  // format produced them. `beats` is the structured version, for the page to lay out properly.
  const body = fmt === "onscreen"
    ? beats.map((b) => b.text + (b.shot ? "   [" + b.shot + "]" : "")).join("\n")
    : clip(part("BODY"), 3000);
  if (!body) throw new Error(fmt === "onscreen" ? "Claude returned no on-screen lines." : "Claude returned no script.");

  return {
    id: "s" + Date.now().toString(36),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    topic: clip(topic, 400),
    format: fmt,
    hookId: option.hookId || "",
    type: option.type || "",
    spoken: clip(option.spoken || "", 200),
    onScreen: clip(option.onScreen || "", 120),
    lead: leadOf(option, fmt),
    beats,
    body: clip(body, 3000),
    cta: clip(part("CTA"), 300),
    caption: clip(part("CAPTION"), 1500),
    visual: clip(part("VISUAL"), 300),
    status: "draft",
  };
}

export const json = (body, status) => Response.json(body, { status: status || 200 });
