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
export async function bestReels() {
  const mine = await store().get("ig-cache-mine", { type: "json" });
  const posts = (mine && mine.posts) || [];
  return posts
    // v180: a post with a cached link OR an id is a candidate — the id is what gets a fresh
    // link below, and a cache written before v177 has no `video` field at all.
    .filter((p) => p.video || p.id)
    .map((p) => ({ id: p.id, url: p.permalink, video: p.video, caption: clip(p.caption, 200),
                   score: p.views != null ? p.views : (p.reach || 0), views: p.views != null ? p.views : p.reach }))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, WANT_REELS);
}

const TRANSCRIBE_PROMPT =
  "Transcribe everything said in this video, word for word, as plain text. Keep the false starts, " +
  "the repeated words and the filler — they are the point. Do not tidy the grammar. If nothing is said, answer: none";

async function transcribeReel(url) {
  const { buffer, mime } = await fetchVideo(url, MAX_VIDEO_BYTES);
  let text;
  try { text = await geminiAsk(buffer, mime, "voice.mp4", TRANSCRIBE_PROMPT, 8000); }
  catch (e) { throw new Error("Gemini could not read it (" + clip((e && e.message) || "", 90) + ")"); }
  if (!text || /^none$/i.test(text.trim())) throw new Error("nobody speaks in it");
  return text.trim();
}

/* ---------- Claude: describing the speech ---------- */
export function profilePrompt(samples) {
  return "Below are transcripts of Instagram reels by Ash, who runs Bodysculpt, a gym in Warrington, UK. " +
    "They are verbatim — the filler and false starts are deliberate.\n\n" +
    samples.map((s, i) => "--- REEL " + (i + 1) + " (" + (s.views != null ? s.views + " views" : "") + ") ---\n" + clip(s.transcript, 4000)).join("\n\n") +
    "\n\nWrite a description of how this person TALKS, to be pasted into the prompt of another model that has to " +
    "write scripts he will read out loud. You are writing an instruction, not a character study.\n\n" +
    "Every claim must be something you can point at in the transcripts, and every claim must be checkable by " +
    "someone reading a draft. \"Short, punchy sentences\" is useless. \"At least a third of his sentences are " +
    "under eight words\" can be checked. Quote him where a quote says it faster than a rule.\n\n" +
    "Cover, under these exact headings, and nothing else:\n" +
    "HOW HE SOUNDS — three or four sentences. The specific version.\n" +
    "WORDS HE USES — the ones he actually reaches for, with a real example each.\n" +
    "WORDS HE NEVER USES — what is conspicuously absent, and what he says instead.\n" +
    "SENTENCE SHAPE — length, fragments, how he joins clauses, how he emphasises.\n" +
    "HOW HE OPENS — the pattern, with two real examples.\n" +
    "HOW HE CLOSES — the pattern, with two real examples.\n" +
    "THE VIEWER — what he calls them and how he addresses them.\n" +
    "SWEARING AND EDGE — honestly. If he does not swear, say so plainly.\n" +
    "CHECKS — six numbered rules a draft must pass to sound like him, each one specific enough " +
    "to answer yes or no by looking at the draft. Derive them from the transcripts, not from general advice.\n\n" +
    "Then, after a line reading BANNED, list eight to twelve phrases that would immediately give away that a " +
    "script was not written by him. Draw them from what is ABSENT in the transcripts — the marketing and " +
    "AI-copy reflexes he never once reaches for. One per line, no bullets, no numbering, no explanation.";
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

  const reels = await bestReels();
  if (!reels.length) throw new Error("No reels of yours to learn from yet. Open the Content page and press Refresh, then try again.");

  // v180: a CURRENT link for each, asked of Instagram now. The cached one in `ig-cache-mine`
  // is a signed url that expires within hours, which is why every reel failed before this —
  // the run was replaying links that had already died. The cached link stays as the fallback
  // for a post the fresh list does not cover (it returns the most recent 25).
  const fresh = await freshOwnVideoUrls(25);
  note({ stage: "links", fresh: fresh.size, configured: igConfigured() });

  const samples = [], failures = [];
  for (const r of reels) {
    const url = fresh.get(String(r.id)) || r.video;
    const usedCached = !fresh.get(String(r.id));
    try {
      const transcript = await transcribeReel(url);
      samples.push({ url: r.url, views: r.views, transcript, words: transcript.split(/\s+/).length });
      note({ stage: "transcribed", url: r.url, words: transcript.split(/\s+/).length, usedCached });
    } catch (e) {
      const why = clip((e && e.message) || "unknown", 120);
      failures.push(why);
      note({ stage: "skipped", url: r.url, usedCached, message: why });
    }
  }

  // Three is the floor. Below it the model is describing one performance, not a voice, and a
  // confident profile drawn from two reels would be worse than the captions it replaces.
  if (samples.length < MIN_REELS) {
    // v180: say what actually happened. The old message asserted "Instagram's video links go
    // stale" without having checked — which was a guess that happened to be right, and sent
    // Ash to press a button that could not have fixed it. Now it reports the reasons it was
    // actually given, and names the likely fix only when it knows which one applies.
    const why = failures.length ? summariseFailures(failures) : "no reason given";
    const hint = !igConfigured()
      ? " IG_ACCESS_TOKEN and IG_USER_ID are not both set in Netlify, so a current video link could not be fetched."
      : /expired|403|CDN/i.test(why)
        ? " Instagram would not hand over the files even with a fresh link — worth retrying in a few minutes."
        : /Gemini/i.test(why)
          ? " That is Google's transcription service, not Instagram — usually temporary."
          : "";
    throw new Error(
      (samples.length ? "Only " + samples.length + " of your " : "None of your ") +
      reels.length + " reels could be transcribed" + (samples.length ? "" : "") +
      " — at least " + MIN_REELS + " are needed to describe a voice. What went wrong: " + why + "." + hint);
  }

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 4000,
    messages: [{ role: "user", content: profilePrompt(samples) }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to write the profile.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const { profile, banned } = parseProfile(text);
  if (!profile) throw new Error("Claude returned no profile.");

  return await writeVoice({
    builtAt: nowIso(),
    reels: samples.map((s) => ({ url: s.url, views: s.views, words: s.words })),
    words: samples.reduce((n, s) => n + s.words, 0),
    profile, banned,
    // a successful build that still lost some reels says so, rather than quietly describing
    // a voice from half the evidence
    note: failures.length ? "Read " + samples.length + " of " + reels.length + " reels. The others: " + summariseFailures(failures) + "." : "",
  });
}
