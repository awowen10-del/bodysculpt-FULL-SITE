// v178 — how Ash actually TALKS, and the model table catching up.
//
// v177 shipped the Hooks tab with a caveat stated out loud on the page and in the commit:
// scripts were written against his recent CAPTIONS, because that was the only voice
// reference the site had. Ash: "Happy to do both now."
//
// The caveat mattered. A caption is typed, edited, and read off a screen; a reel is spoken
// once into a phone. The vocabulary carries across, the rhythm does not — and rhythm is most
// of what makes a script sound like a person rather than like copy.
//
// THE THINGS THIS FILE EXISTS TO PIN:
//
//  1. ONE VOICE, TWO WRITERS. The caption writer and the script writer both go through
//     voiceBrief(). A profile built once must improve BOTH, or the build is worth half what
//     it costs and the two halves of the site drift apart in tone.
//
//  2. THE FALLBACK SURVIVES. voiceBrief() returns captions when no profile has been built,
//     so v170's caption writer keeps working untouched on a site where nobody ever presses
//     the button. The two sources are LABELLED DIFFERENTLY — a profile is an instruction, a
//     list of captions is evidence — and the prompts embed the block verbatim so the label
//     travels with it.
//
//  3. THREE REELS IS THE FLOOR. Below it the model is describing one performance, not a
//     voice, and a confident profile drawn from two reels is worse than the captions it
//     replaces, because it will be followed.
//
//  4. A FAILED BUILD NEVER EATS A GOOD PROFILE. The note is written where the page shows it;
//     the profile that was already there stays.
//
//  5. THE MODEL TABLE IS ONE TABLE. Callers name a tier, never an id — so the suite moves
//     generation by editing mentor-ai's map, and no page can pin itself to an old model.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = (f) => path.join(__dirname, "..", f);
const read = (f) => fs.readFileSync(root(f), "utf8");
const SOCIAL = read("social.html");
const SCHEDULE_LIB = read("netlify/lib/schedule.js");
const HOOKS_LIB = read("netlify/lib/hooks.js");
const VOICE_LIB = read("netlify/lib/voice.js");
const MENTOR = read("netlify/functions/mentor-ai.js");
const scriptOf = (src) => src.slice(src.lastIndexOf("<script>") + 8, src.lastIndexOf("</script>"));

function fakeStore(seed) {
  const m = new Map(Object.entries(seed || {}).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return {
    _m: m,
    async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list() { return { blobs: [...m.keys()].map((key) => ({ key })), directories: [] }; },
  };
}

async function loadLib(file, tag, seed) {
  const src = read(file);
  assert.ok(/^import \{ getStore \} from "@netlify\/blobs";$/m.test(src), tag + ": the store import is the single line this test swaps");
  const patched = src.replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => globalThis.__fakeStore;");
  const tmp = root("netlify/lib/__" + tag + "-test-" + process.pid + ".mjs");
  fs.writeFileSync(tmp, patched);
  globalThis.__fakeStore = fakeStore(seed);
  try { return await import("file://" + tmp); }
  finally { fs.unlinkSync(tmp); }
}

const CAPTIONS = { "ig-cache-mine": { account: { username: "bodysculptwarrington" }, posts: [
  { caption: "This is a caption long enough to count as a real one for the voice reference.", video: "", permalink: "p1" },
  { caption: "Another caption that is comfortably over the twenty character floor it uses.", video: "", permalink: "p2" },
] } };

(async () => {
  /* ============ 1. a profile, when there is one ============ */
  {
    const lib = await loadLib("netlify/lib/schedule.js", "sched", {
      ...CAPTIONS,
      "ig-voice": { builtAt: "2026-09-16T10:00:00Z", profile: "HOW HE SOUNDS\nShort sentences. Says 'right' a lot.",
                    banned: ["game changer", "unlock your potential"], reels: [{}, {}, {}], words: 900 },
    });
    const brief = await lib.voiceBrief();
    assert.ok(/HOW ASH TALKS ON CAMERA/.test(brief), "the spoken profile is labelled as an instruction about speech");
    assert.ok(/Says 'right' a lot/.test(brief), "…and carries the profile itself");
    assert.ok(/game changer/.test(brief), "the banned phrases travel with it — knowing what would give the game away is half the value");
    assert.ok(!/recent captions/.test(brief), "captions are NOT also sent: the profile supersedes them, and sending both would have the model average two different voices");
  }

  /* ============ 2. captions, when there is not ============ */
  {
    const lib = await loadLib("netlify/lib/schedule.js", "sched", CAPTIONS);
    const brief = await lib.voiceBrief();
    assert.ok(/recent captions/.test(brief), "with no profile it falls back to captions, so v170's caption writer keeps working on a site where nobody presses the button");
    assert.ok(/written, not spoken/.test(brief), "…and says which it is, so the model does not copy caption rhythm into speech");
    assert.ok(/twenty character floor/.test(brief), "…carrying the actual captions");

    const bare = await loadLib("netlify/lib/schedule.js", "sched", {});
    assert.strictEqual(await bare.voiceBrief(), "", "no captions and no profile is an empty brief, not the word 'undefined' in a prompt");
  }

  /* ============ 3. one voice, both writers ============ */
  {
    assert.ok(/export async function voiceBrief/.test(SCHEDULE_LIB), "voiceBrief is the one way in");
    assert.ok(/const voice = await voiceBrief\(\);/.test(SCHEDULE_LIB), "the CAPTION writer goes through it");
    assert.ok(/optionsPrompt\(topic, hooks, await voiceBrief\(\), format\)/.test(HOOKS_LIB), "the hook writer goes through it");
    assert.ok(/scriptPrompt\(topic, option, fmt, await voiceBrief\(\)\)/.test(HOOKS_LIB), "the SCRIPT writer goes through it");
    assert.ok(!/voiceReference\(\)/.test(HOOKS_LIB), "nothing reaches past it to the captions directly — that is how the two writers stay in one voice");
    // The prompts must not re-label the block: only voiceBrief knows which source came back,
    // so a heading pasted on at the prompt would eventually describe a spoken profile as
    // "recent captions". The heading itself is fine where it lives — inside voiceBrief.
    for (const [src, tag] of [[SCHEDULE_LIB, "captionPrompt"], [HOOKS_LIB, "the hook prompts"]]) {
      assert.ok(!/captions[^"\n]*:\\n"\s*\+\s*voice/.test(src),
        tag + " no longer concatenates a caption heading onto a block that may be a spoken profile");
    }
    assert.ok(/recent captions/.test(SCHEDULE_LIB), "…the heading still exists, inside voiceBrief, where it is chosen with the source");
    assert.ok(/\(voice \? voice \+ "\\n\\n" : ""\)/.test(SCHEDULE_LIB), "captionPrompt embeds the brief verbatim");
  }

  /* ============ 4. the import runs one way ============ */
  {
    assert.ok(/from "\.\/schedule\.js"/.test(VOICE_LIB), "voice.js reads schedule.js (geminiAsk, the key)");
    assert.ok(!/from "\.\/voice\.js"/.test(SCHEDULE_LIB), "…and schedule.js never reads voice.js back — a cycle between the two would be fragile for no gain");
    assert.ok(/export const VOICE_KEY = "ig-voice"/.test(SCHEDULE_LIB), "one name for the key, defined where the read side lives");
  }

  /* ============ 5. three reels is the floor ============ */
  {
    assert.ok(/const MIN_REELS = 3;/.test(VOICE_LIB), "the floor is stated as a constant, not buried in a condition");
    assert.ok(/samples\.length < MIN_REELS/.test(VOICE_LIB), "…and enforced before Claude is asked for a profile");
    // v180 rewrote this message. It used to assert "Instagram's video links go stale" without
    // having checked — a guess that happened to be right, and which sent Ash to press a
    // Refresh button that could not have fixed it. It now reports the reasons it was actually
    // given, and only names a likely fix once it knows which one applies.
    assert.ok(/needed to describe a voice/.test(VOICE_LIB), "…with a reason Ash can act on");
    assert.ok(/What went wrong: " \+ why/.test(VOICE_LIB), "…which is what actually happened, not a guess");
    assert.ok(!/press Refresh on the Content page and try again/.test(VOICE_LIB),
      "the old blanket advice is gone — a fresh link is now fetched by the server, so pressing Refresh was never the fix");
    assert.ok(/WANT_REELS = 10/.test(VOICE_LIB) && /\.slice\(0, WANT_REELS\)/.test(VOICE_LIB), "ten reels: enough to tell a habit from a one-off");
    assert.ok(/sort\(\(a, b\) => \(b\.score \|\| 0\) - \(a\.score \|\| 0\)\)/.test(VOICE_LIB),
      "his BEST reels, not his most recent — a profile averaged over the ones that did not land describes a worse version of him");
  }

  /* ============ 6. the profile is written to be used, not admired ============ */
  {
    const lib = await loadLib("netlify/lib/voice.js", "voice", {});
    const spokenSamples = [1, 2, 3].map((n) => ({ views: 900, spoken: "Right, so listen. Number " + n, onScreen: "" }));
    const p = lib.profilePrompt(spokenSamples, "1. a caption");
    assert.ok(/instruction, not a character study/.test(p), "the output's job is stated");
    assert.ok(/never longer than six words/.test(p), "…with an example of checkable versus useless, because 'short punchy lines' is not a rule anyone can apply");
    assert.ok(/WORDS HE NEVER USES/.test(p) && /CHECKS/.test(p), "the headings the parser depends on");
    assert.ok(/If he does not swear, say so plainly/.test(p), "an honest answer is allowed — a profile that invents edge would put words in his mouth");
    assert.ok(/He does speak to camera, and there are 3 transcripts/.test(p), "with speech present it says so");

    /* v182: the account that does NOT talk to camera — Ash's actual case. Ash: "we don't have
       enough videos where we're talking … our prospects value on-screen hooks more with the
       captions doing the heavy lifting." The prompt must stop the model writing a confident
       paragraph about how he speaks, because the only evidence for it would be his captions,
       and a profile that invents is worse than none: everything downstream follows it. */
    const silentSamples = [1, 2, 3, 4].map((n) => ({ views: 900, spoken: "", onScreen: "3 YEARS\nNO CARDIO " + n }));
    const q = lib.profilePrompt(silentSamples, "1. a caption long enough to matter");
    assert.ok(/he almost never speaks to camera — 0 of these 4/.test(q), "it counts the speech it actually has");
    assert.ok(/Do not write a section about how he talks out loud/.test(q), "…and forbids inventing the missing half");
    assert.ok(/do not invent one from the captions/.test(q), "…including from the captions, which are writing, not speech");
    assert.ok(/should be the longest/.test(q), "on-screen lines become the main section, because that is where his voice actually lives");
    assert.ok(/At least three must be about on-screen lines or captions/.test(q), "…and the checks follow the evidence");

    const { profile, banned } = lib.parseProfile(
      "HOW HE SOUNDS\nShort. Direct.\n\nCHECKS\n1. Under eight words often.\n\nBANNED\ngame changer\n- unlock your potential\n3. \"take it to the next level\"\n");
    assert.ok(/Short. Direct./.test(profile) && !/game changer/.test(profile), "the profile stops at BANNED");
    assert.deepStrictEqual(banned, ["game changer", "unlock your potential", "take it to the next level"],
      "bullets, numbering and quotes are stripped — the phrase is what gets matched against, not its decoration");
    assert.deepStrictEqual(lib.parseProfile("no banned line here").banned, [], "no BANNED section is an empty list, never a crash");
  }

  /* ============ 7. a failed build never eats a good profile ============ */
  {
    const fn = read("netlify/functions/voice-build-background.js");
    assert.ok(/\{ \.\.\.prev, note: message/.test(fn), "a failure spreads over what was there — the previous good profile survives its own failed rebuild");
    assert.ok(/stage: "error", message/.test(fn), "…and is logged");
    assert.ok(!/schedule = /.test(fn) && !/hooks-mine-scheduled/.test(fn), "no nightly rebuild: a voice does not drift week to week, and rebuilding nightly would spend money describing the same person");
  }

  /* ============ 8. the page shows it, and can start it ============ */
  {
    const js = scriptOf(SOCIAL);
    /* v188 turned the card into one line. Ash: "not much is showing, but there's so much text
       on there." The voice is not a workflow, it is a setting that governs how everything on
       this tab is written, so it reads as a status line and opens only when asked. */
    assert.ok(/id="hkVoiceBar"/.test(SOCIAL), "the voice is a line at the foot of the writer, not a card of its own");
    assert.ok(!/id="hkVoice"[^B]/.test(SOCIAL), "…and the card it used to live in is gone");
    assert.ok(/renderVoiceBar\(\);/.test(js), "drawn as part of every Hooks render");
    assert.ok(/hk-vprofile/.test(js) && /hkVoiceOpen/.test(js),
      "the profile is still shown IN FULL — one he cannot read is one he cannot tell is wrong — but behind 'Read it'");
    assert.ok(/hkBusy === "voice"/.test(js), "the control locks while it runs");
    assert.ok(/tipBtn\("voice"\)/.test(js) && /voice: \["Your voice"/.test(js),
      "the paragraph that used to sit on the page is in the suite's own tooltip instead");
    const writes = [...js.matchAll(/fetch\(([^,]+),\s*\{[\s\S]{0,200}?method:/g)].map((m) => m[1].trim());
    const allowed = new Set(["API", "IG_SCRAPE", "IG_SNAP", "HOOKS", "HOOKS_MINE", "VOICE_BUILD"]);
    for (const w of writes) assert.ok(allowed.has(w), "v136's write surface still holds; found " + w);
  }

  /* ============ 9. one model table, current generation ============ */
  {
    assert.ok(/"opus": "claude-opus-5"/.test(MENTOR), "opus is Opus 5");
    assert.ok(/"sonnet": "claude-sonnet-5"/.test(MENTOR), "sonnet is Sonnet 5");
    assert.ok(/"haiku": "claude-haiku-4-5"/.test(MENTOR), "haiku is Haiku 4.5, and the id carries no date suffix");
    assert.ok(!/claude-opus-4-8|claude-sonnet-4-6|claude-haiku-4-5-2025/.test(MENTOR),
      "no previous-generation id is left behind in the table");
    // The indirection is the point: a page ASKS for a tier, so this table is the only edit
    // needed to move the whole suite a generation.
    for (const page of ["daily.html", "quarterly.html", "index.html", "monthly.html"]) {
      const src = read(page);
      for (const call of src.match(/model\s*:\s*["'][^"']+["']/g) || []) {
        assert.ok(/["'](opus|sonnet|haiku)["']/.test(call) || /claude-opus-5/.test(call),
          page + " asks mentor-ai for a tier, never a model id: " + call);
      }
    }
    // quarterly.html stamps each stored analysis with what generated it, and that label is
    // shown on the version chip. It is the one place a page legitimately names an id — and it
    // has to move with the table above, or an Opus 5 analysis would be filed as an Opus 4.8 one.
    assert.ok(/status: "complete", model: "claude-opus-5"/.test(read("quarterly.html")),
      "the quarterly provenance label matches the model the opus tier now resolves to");
    assert.ok(/thinking is ON by default/.test(MENTOR),
      "the one behavioural change from 4.8 is written down where the next person will look for it");
    // lib/schedule.js has been on Opus 5 since v170; the proxy is now on the same generation
    assert.ok(/model: "claude-opus-5"/.test(SCHEDULE_LIB) && /model: "claude-opus-5"/.test(VOICE_LIB) && /model: "claude-opus-5"/.test(HOOKS_LIB),
      "the SDK callers agree with the proxy");
  }

  /* ============ 10. a declined answer never shows as a blank panel ============
     The trap: a refusal is not an error. The call succeeds, HTTP 200, a normal body — with
     no text and a flag saying why. Read literally it is an empty string, and the review panel
     rendered nothing at all, with no way to tell a refusal from a bug. */
  {
    const savedFetch = globalThis.fetch, savedKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const handler = (await import("file://" + root("netlify/functions/mentor-ai.js"))).default;
    const call = async (apiBody) => {
      globalThis.fetch = async () => new Response(JSON.stringify(apiBody), { status: 200, headers: { "Content-Type": "application/json" } });
      const res = await handler(new Request("https://x/mentor-ai", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Review the month." }) }));
      return await res.json();
    };
    try {
      const ok = await call({ stop_reason: "end_turn", content: [{ type: "text", text: "Revenue is up 8%." }] });
      assert.strictEqual(ok.text, "Revenue is up 8%.", "a normal answer is untouched");
      assert.ok(!ok.error, "…and carries no error");

      const refused = await call({ stop_reason: "refusal", stop_details: { explanation: "Declined." }, content: [] });
      assert.ok(refused.error && /declined/i.test(refused.error),
        "a refusal comes back as an error — the shape every page already knows how to display");
      assert.strictEqual(refused.refusal, true, "…flagged, so a caller can tell it from a network fault");
      assert.ok(/not a fault with the dashboard/.test(refused.detail || ""),
        "…and says so plainly, or Ash spends the afternoon checking Netlify for a break that is not there");
      assert.ok(!refused.text, "no empty text field to render as a blank panel");

      const empty = await call({ stop_reason: "max_tokens", content: [] });
      assert.ok(empty.error, "any other way of arriving with nothing is also said out loud");

      const cut = await call({ stop_reason: "max_tokens", content: [{ type: "text", text: "Revenue is up 8% and" }] });
      assert.strictEqual(cut.text, "Revenue is up 8% and", "a TRUNCATED answer still has text and is left alone — the pages handle truncation themselves");
      assert.ok(!cut.error, "…and is not turned into an error");
    } finally {
      globalThis.fetch = savedFetch;
      if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey;
    }

    // the streaming path is parsed in the page, so the same claim is checked there
    const q = read("quarterly.html");
    assert.ok(/const REFUSAL_MSG = /.test(q), "one message, shared by both SSE readers on the page");
    assert.ok(/if\(evt\.delta\.stop_reason === "refusal"\) refused = true;/.test(q), "the first reader notices");
    assert.ok(/if\(stopReason === "refusal"\)\{/.test(q), "the second reader notices");
    const tail = q.slice(q.indexOf('if(stopReason === "refusal")'));
    assert.ok(tail.indexOf('kind="empty"') > 0 && tail.indexOf('kind="truncated"') > 0,
      "…and it is checked BEFORE the empty and cut-off cases, which would otherwise report a refusal as a server time limit and send him hunting for a fault that is not there");
  }

  /* ============ 11. v180: the link is fetched fresh, not replayed from a cache ============
     The bug Ash hit: "Only 0 of your reels could be transcribed." It had found his reels and
     failed on every one, because it was transcribing from `ig-cache-mine` — the Content
     page's cached copy of the feed — and Instagram's media_url is a SIGNED link that expires
     within hours. The cached blob can be days old, so every download was 403ing.

     The fix is not to ask him to press Refresh first. The server holds IG_ACCESS_TOKEN, so it
     asks Instagram for a current link at the moment it needs one. A cache is for saving a
     round trip, never for holding a credential that rots. */
  {
    const IGM = read("netlify/lib/ig-media.js");
    assert.ok(/export async function freshOwnVideoUrls/.test(IGM), "there is one way to get a current link");
    assert.ok(/const fresh = await freshOwnVideoUrls\(25\);/.test(VOICE_LIB), "the voice build asks for one");
    assert.ok(/fresh\.get\(String\(r\.id\)\) \|\| r\.video/.test(VOICE_LIB),
      "…and falls back to the cached link only for a post the fresh list does not cover");
    assert.ok(/c\.isOwn && fresh\.get\(String\(c\.mediaId\)\)/.test(HOOKS_LIB),
      "the hook miner does the same for HIS OWN reels — same cache, same rot, and it would have failed the same way");
    assert.ok(/cands\.some\(\(c\) => c\.isOwn\) \? await freshOwnVideoUrls/.test(HOOKS_LIB),
      "…asked for only when one of his own reels is actually in the batch; competitors' links come from the scrape half an hour earlier");
    assert.ok(/mediaId: clip\(p\.id, 40\)/.test(HOOKS_LIB),
      "an own candidate carries the media id as well as the short code — the short code names the hook, the media id buys a link");

    // Instagram's CDN refuses a bare server fetch, which is the other half of why every reel failed
    assert.ok(/"User-Agent": "Mozilla/.test(IGM), "the download looks like a browser, because a bare `User-Agent: node` gets refused");
    assert.ok(/Referer/.test(IGM), "…with the referer it expects");
    assert.ok(!/await fetch\(cand\.videoUrl\)/.test(HOOKS_LIB) && !/await fetch\(reel\.video\)/.test(VOICE_LIB),
      "neither library does its own bare fetch any more — one door, one set of headers, one place the reasons are worded");

    // and the failure reasons are named rather than guessed at
    assert.ok(/the link had expired \(403\)/.test(IGM), "403 is named for what it is — the link was fine when stored and is not now");
    assert.ok(/export function summariseFailures/.test(IGM), "repeated reasons are counted, not listed five times");
    const igm = await import("file://" + root("netlify/lib/ig-media.js"));
    assert.strictEqual(
      igm.summariseFailures(["the link had expired (403)", "the link had expired (403)", "nobody speaks in it"]),
      "2 × the link had expired (403); nobody speaks in it",
      "…so the message reads as a diagnosis rather than a list");
    assert.strictEqual(igm.summariseFailures([]), "", "nothing to summarise is an empty string, not the word undefined");
    await assert.rejects(() => igm.fetchVideo(""), /no video link/, "a missing link says so rather than fetching undefined");
  }

  console.log("v178 spoken voice: OK");
})().catch((e) => { console.error(e); process.exit(1); });
