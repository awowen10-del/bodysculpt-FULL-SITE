// netlify/lib/voice.js  (v178)
//
// How Ash actually TALKS, learned from his own reels.
//
// Until now the only voice reference on this site was his recent Instagram captions, used
// both by the caption writer and, from v177, by the script writer. It was always the weaker
// half of the job. A caption is typed, edited, and read off a screen; a reel is spoken once
// into a phone. The vocabulary carries across, the rhythm does not — and rhythm is most of
// what makes a script sound like a person rather than like copy.
//
// This transcribes his best-performing reels in full, and asks Claude to describe the
// speech: the words he reaches for and the ones he never uses, how long his sentences run,
// how he opens, how he closes, whether he swears, what he calls the viewer. The output is
// written to be PASTED INTO A PROMPT, not admired — it is an instruction to another model,
// so it is specific and testable ("at least a third of his sentences are under eight words")
// rather than literary ("warm but authoritative").
//
// The banned list matters as much as the profile. Knowing what somebody sounds like is
// useful; knowing which phrases would instantly give the game away is what stops a script
// reading as written-by-a-machine.
//
// One blob key, `ig-voice`:
//   { builtAt, reels[{url,views,words}], words, profile, banned[], note }
// Read by schedule.js's voiceBrief(), which both the caption writer and the script writer
// go through. Built here, called from voice-build-background.js.
import { getStore } from "@netlify/blobs";
import Anthropic from "@anthropic-ai/sdk";
import { geminiAsk, VOICE_KEY } from "./schedule.js";
import { freshOwnVideoUrls, fetchVideo, summariseFailures, igConfigured } from "./ig-media.js";

const env = (k) => (process.env[k] || "").trim();
const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");
const nowIso = () => new Date().toISOString();
const store = () => getStore({ name: "bodysculpt-kpi", consistency: "strong" });

// Ten is the point of diminishing returns: enough to tell a habit from a one-off, few enough
// that a build finishes inside a background function's fifteen minutes with room to spare.
const WANT_REELS = 10;
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
const MIN_REELS = 3;

export async function readVoice() {
  try { const v = await store().get(VOICE_KEY, { type: "json" }); return v && typeof v === "object" ? v : null; }
  catch { return null; }
}
async function writeVoice(v) { await store().set(VOICE_KEY, JSON.stringify(v)); return v; }

/* ---------- which of his reels to learn from ----------
   His BEST ones, not his most recent. A voice profile built from everything would average in
   the reels that did not land; built from the top it describes him at his most watchable,
   which is the version worth reproducing. Views where the feed has them, reach otherwise. */
export async function bestReels(hasLink) {
  const mine = await store().get("ig-cache-mine", { type: "json" });
  const posts = (mine && mine.posts) || [];
  return posts
    .map((p) => ({ id: p.id, url: p.permalink, video: p.video, type: p.type, caption: clip(p.caption, 200),
                   score: p.views != null ? p.views : (p.reach || 0), views: p.views != null ? p.views : p.reach }))
    /* v183: only reels there is actually a video file for, and the caller decides what
       counts as "actually" because it is the one holding the fresh links.
       Found on the live site: of Ash's twenty videos, Instagram's Graph API returns a
       media_url for only six — it simply does not hand over a file for the rest. v180's
       filter let all twenty-five posts through on the strength of having an id, so the top
       ten by views were mostly ones with nothing to download, and the run reported "7 × no
       video link for this post" while three perfectly readable reels sat outside the cut.
       Filtering FIRST and taking the best ten of what is left uses everything there is. */
    .filter((p) => (hasLink ? hasLink(p) : !!p.video))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, WANT_REELS);
}

/* v182: both halves of a reel, not just the spoken one.
   Ash: "our prospects value on-screen hooks more with the captions doing the heavy lifting."
   v178 asked only for speech and threw the reel away when there was none, which on this
   account meant throwing away nearly all of them. The words on the screen ARE his writing —
   chosen, edited, and the thing his audience actually reads — so they are evidence of his
   voice in exactly the way a transcript is. Gemini reads text off a silent video perfectly
   well; nothing new is needed but the asking. */
// his own recent captions, straight from the feed's cache — the one piece of evidence that
// needs no video, no link and no transcription
async function captionEvidence() {
  try {
    const mine = await store().get("ig-cache-mine", { type: "json" });
    const caps = ((mine && mine.posts) || []).map((p) => p.caption).filter((c) => c && c.length > 30).slice(0, 12);
    return caps.map((c, i) => (i + 1) + ". " + clip(c, 400)).join("\n\n");
  } catch { return ""; }
}

const READ_PROMPT =
  "Answer about this Instagram reel in exactly this format and nothing else:\n" +
  "SPOKEN: everything said out loud, word for word. Keep the false starts, repeated words and filler — they are the point. " +
  "Do not tidy the grammar. If nobody speaks, write: none\n" +
  "ONSCREEN: every line of text that appears on screen, in the order it appears, one per line, verbatim including " +
  "capitalisation and punctuation. If there is no text on screen, write: none";

const field = (text, name) => {
  const m = new RegExp("^" + name + ":\\s*([\\s\\S]*?)(?=\\n[A-Z]+:|$)").exec(text || "");
  const v = m ? m[1].trim() : "";
  return /^none$/i.test(v) ? "" : v;
};

async function readReel(url) {
  const { buffer, mime } = await fetchVideo(url, MAX_VIDEO_BYTES);
  let text;
  try { text = await geminiAsk(buffer, mime, "voice.mp4", READ_PROMPT, 8000); }
  // 90 characters used to cut Google's message off mid-word — "You exceeded your current
  // quota, please check your plan a" — in the one sentence whose whole job is to say why
  catch (e) { throw new Error("Gemini could not read it (" + clip((e && e.message) || "", 170) + ")"); }
  const spoken = clip(field(text, "SPOKEN"), 4000);
  const onScreen = clip(field(text, "ONSCREEN"), 1500);
  if (!spoken && !onScreen) throw new Error("no words in it at all — nothing said and nothing on screen");
  return { spoken, onScreen };
}

/* ---------- Claude: describing how he communicates ---------- */
// The headings follow the EVIDENCE. Asking "how he opens when speaking" of an account that
// never speaks produces a confident paragraph of invention, and a profile that invents is
// worse than none because everything downstream then follows it.
export function profilePrompt(samples, captions) {
  const spoken = samples.filter((s) => s.spoken);
  const onScreen = samples.filter((s) => s.onScreen);
  const speechLed = spoken.length >= 3;

  const evidence = samples.map((s, i) =>
    "--- REEL " + (i + 1) + (s.views != null ? " (" + s.views + " views)" : "") + " ---" +
    (s.spoken ? "\nSPOKEN: " + clip(s.spoken, 3000) : "") +
    (s.onScreen ? "\nON SCREEN:\n" + clip(s.onScreen, 1200) : "")).join("\n\n");

  return "Below is the content of Instagram reels by Ash, who runs Bodysculpt, a gym in Warrington, UK. " +
    "Where somebody speaks, the transcript is verbatim and the filler is deliberate. " +
    "Where there is text on screen, it is copied exactly as written.\n\n" +
    evidence +
    (captions ? "\n\n--- HIS RECENT CAPTIONS ---\n" + clip(captions, 4000) : "") +
    "\n\nWrite a description of how this person COMMUNICATES, to be pasted into the prompt of another model that " +
    "has to write reels for him. You are writing an instruction, not a character study.\n\n" +
    (speechLed
      ? "He does speak to camera, and there are " + spoken.length + " transcripts here. Cover his speech AND his writing.\n\n"
      : "IMPORTANT: he almost never speaks to camera — " + spoken.length + " of these " + samples.length +
        " reels have any speech in them at all. His voice lives in the TEXT ON SCREEN and in his CAPTIONS. " +
        "Describe those. Do not write a section about how he talks out loud, and do not invent one from the captions: " +
        "say plainly that there is not enough speech to describe.\n\n") +
    "Every claim must be something you can point at above, and every claim must be checkable by someone reading a " +
    "draft. \"Short, punchy lines\" is useless. \"On-screen lines are almost never longer than six words\" can be " +
    "checked. Quote him where a quote says it faster than a rule.\n\n" +
    "Keep each section to what a person would actually read before writing: a handful of bullets or a short " +
    "paragraph, never an essay. This is pasted into every prompt that writes for him, so length here is a cost " +
    "paid on every reel and every caption.\n\n" +
    "Cover, under these exact headings, and nothing else:\n" +
    "HOW HE COMES ACROSS — three or four sentences. The specific version, not the flattering one.\n" +
    "WORDS HE USES — the ones he actually reaches for, with a real example each.\n" +
    "WORDS HE NEVER USES — what is conspicuously absent, and what he says instead.\n" +
    "ON-SCREEN LINES — length, capitalisation, punctuation, whether they are sentences or fragments, how a " +
    "sequence of them builds. This is the most important section" + (speechLed ? "." : " and should be the longest.") + "\n" +
    "CAPTIONS — how they open, how long they run, how they are broken up, how they close, what he does with hashtags.\n" +
    "SPEAKING — " + (speechLed ? "how he talks out loud: sentence length, fillers, how he opens and closes." :
      "one line only, saying there is too little to go on. Do not invent this.") + "\n" +
    "THE VIEWER — what he calls them and how he addresses them.\n" +
    "SWEARING AND EDGE — honestly. If he does not swear, say so plainly.\n" +
    "CHECKS — six numbered rules a draft must pass to sound like him, each specific enough to answer yes or no by " +
    "looking at the draft. At least three must be about on-screen lines or captions. Derive them from the evidence " +
    "above, not from general advice.\n\n" +
    "Then — and do not stop before this, it is the most useful part — after a line reading BANNED, list eight to twelve phrases that would immediately give away that a reel " +
    "was not written by him. Draw them from what is ABSENT above — the marketing and AI-copy reflexes he never once " +
    "reaches for. One per line, no bullets, no numbering, no explanation.";
}

export function parseProfile(text) {
  const i = text.search(/^BANNED\s*$/mi);
  const profile = clip((i < 0 ? text : text.slice(0, i)).trim(), 6000);
  const banned = i < 0 ? [] : text.slice(i).split("\n").slice(1)
    .map((l) => l.replace(/^[-*•\d.\s"']+/, "").replace(/["']\s*$/, "").trim())
    .filter((l) => l.length > 2 && l.length < 90)
    .slice(0, 14);
  return { profile, banned };
}

export async function buildVoice(log) {
  const note = (t) => log && log(t);
  if (!env("ANTHROPIC_API_KEY")) throw new Error("ANTHROPIC_API_KEY is not set.");
  if (!env("GEMINI_API_KEY")) throw new Error("GEMINI_API_KEY is not set, so the reels cannot be transcribed.");

  // v180: CURRENT links, asked of Instagram now. The cached one in `ig-cache-mine` is a
  // signed url that expires within hours, which is why every reel failed before that — the
  // run was replaying links that had already died. v183 fetches them BEFORE choosing which
  // reels to use, so the choice is made from what can actually be downloaded.
  const fresh = await freshOwnVideoUrls(25);
  note({ stage: "links", fresh: fresh.size, configured: igConfigured() });

  const reels = await bestReels((p) => fresh.has(String(p.id)) || !!p.video);
  if (!reels.length) {
    throw new Error(igConfigured()
      ? "Instagram is not giving out a video file for any of your posts. That is its own limit, not a setting here — it withholds the file for a lot of reels. Nothing can be learned until it hands one over."
      : "IG_ACCESS_TOKEN and IG_USER_ID are not both set in Netlify, so no video link could be fetched.");
  }
  note({ stage: "chose", reels: reels.length });

  const samples = [], failures = [];
  for (const r of reels) {
    const url = fresh.get(String(r.id)) || r.video;
    const usedCached = !fresh.get(String(r.id));
    try {
      const read = await readReel(url);
      samples.push({ url: r.url, views: r.views, spoken: read.spoken, onScreen: read.onScreen,
                     words: (read.spoken + " " + read.onScreen).trim().split(/\s+/).length });
      note({ stage: "read", url: r.url, spoken: !!read.spoken, onScreen: !!read.onScreen, usedCached });
    } catch (e) {
      const why = clip((e && e.message) || "unknown", 200);
      failures.push(why);
      note({ stage: "skipped", url: r.url, usedCached, message: why });
    }
  }

  // v182: his CAPTIONS are evidence too, and always available. On an account that does not
  // talk to camera they are most of the voice, not a consolation prize.
  const captions = await captionEvidence();

  // The floor is three reels that yielded WORDS — spoken or on screen — not three transcripts.
  // v178 counted only speech, which on this account meant failing at nought every time while
  // sitting on plenty of readable material.
  if (samples.length < MIN_REELS) {
    const why = failures.length ? summariseFailures(failures) : "no reason given";
    const hint = !igConfigured()
      ? " IG_ACCESS_TOKEN and IG_USER_ID are not both set in Netlify, so a current video link could not be fetched."
      : /expired|403|CDN/i.test(why)
        ? " Instagram would not hand over the files even with a fresh link — worth retrying in a few minutes."
        : /quota/i.test(why)
          ? " That is Google's free Gemini allowance used up, not a fault here. It resets on its own; to stop it recurring, turn on billing for the Gemini key in Google AI Studio."
        : /Gemini/i.test(why)
          ? " That is Google's transcription service, not Instagram — usually temporary."
          : /no words in it at all/.test(why)
            ? " These reels have no speech and no text on screen, so there is nothing to learn a voice from."
            : "";
    throw new Error(
      (samples.length ? "Only " + samples.length + " of your " : "None of your ") +
      reels.length + " reels could be read — at least " + MIN_REELS +
      " are needed to describe a voice. What went wrong: " + why + "." + hint);
  }

  const client = new Anthropic();
  /* v191: 4,000 tokens was not enough and the failure was silent. The first real profile
     stopped mid-sentence — "When he does write to the viewer it's 'you' in" — and because
     BANNED comes last, the banned list came back empty and looked like a model that had
     simply not found any. A truncated profile is worse than a short one: it is injected into
     every caption and every reel this site writes, and it would have gone on being trusted. */
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 8000,
    messages: [{ role: "user", content: profilePrompt(samples, captions) }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to write the profile.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const { profile, banned } = parseProfile(text);
  if (!profile) throw new Error("Claude returned no profile.");
  if (response.stop_reason === "max_tokens") {
    throw new Error("The profile ran past its limit and came back half-written. Press Learn my voice again — if it happens twice, say so.");
  }

  const spokenCount = samples.filter((x) => x.spoken).length;
  return await writeVoice({
    builtAt: nowIso(),
    reels: samples.map((s) => ({ url: s.url, views: s.views, words: s.words, spoken: !!s.spoken, onScreen: !!s.onScreen })),
    words: samples.reduce((n, s) => n + s.words, 0),
    // what it actually learned from, so the page and the prompts can say so honestly rather
    // than every profile claiming to describe how he talks
    kind: spokenCount >= 3 ? (spokenCount === samples.length ? "spoken" : "mixed") : "written",
    spokenReels: spokenCount,
    captions: !!captions,
    profile, banned,
    // a successful build that still lost some reels says so, rather than quietly describing
    // a voice from half the evidence
    note: failures.length ? "Read " + samples.length + " of " + reels.length + " reels. The others: " + summariseFailures(failures) + "." : "",
  });
}
