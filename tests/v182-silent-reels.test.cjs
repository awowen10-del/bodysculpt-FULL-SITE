// v182 — the reels Ash actually makes.
//
// Ash: "we don't have enough videos where we're talking. I don't think those types of videos
// are massive in the small group gym world, our prospects value on-screen hooks more with the
// captions doing the heavy lifting. What's the solution to this? Because will this impact the
// hook library and 'write a reel' too?"
//
// The answers were: the hook library is fine, the writer is not, and the voice profile was
// the wrong artefact entirely.
//
//  · THE HOOK LIBRARY was right by luck. It has always read the spoken line and the on-screen
//    text separately and templatised from whichever exists, giving up only when there is
//    neither. Nothing to change — but it is pinned here, because it is the part that would
//    quietly stop working if someone "simplified" the reader.
//
//  · THE WRITER assumed a talking head in three places: it demanded a spoken line as the lead,
//    offered only "to camera" and "walkthrough", and produced a BODY of words he says. For a
//    gym that does not film monologues that is not a weak output, it is an unusable one — and
//    a tool that hands back something you would never film is a tool you stop opening.
//
//  · THE VOICE PROFILE read speech and threw the reel away when there was none, which on this
//    account meant failing at nought while sitting on plenty of readable material. The words
//    on his screen ARE his writing: chosen, edited, and the thing his audience actually reads.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = (f) => path.join(__dirname, "..", f);
const read = (f) => fs.readFileSync(root(f), "utf8");
const SOCIAL = read("social.html");
const HOOKS_LIB = read("netlify/lib/hooks.js");
const VOICE_LIB = read("netlify/lib/voice.js");
const scriptOf = (src) => src.slice(src.lastIndexOf("<script>") + 8, src.lastIndexOf("</script>"));

function fakeStore(seed) {
  const m = new Map(Object.entries(seed || {}).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return {
    async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
    async list() { return { blobs: [...m.keys()].map((key) => ({ key })), directories: [] }; },
  };
}
async function loadLib(file, tag, seed) {
  const patched = read(file).replace(/^import \{ getStore \} from "@netlify\/blobs";$/m,
    "const getStore = () => globalThis.__fakeStore;");
  const tmp = root("netlify/lib/__" + tag + "-v182-" + process.pid + ".mjs");
  fs.writeFileSync(tmp, patched);
  globalThis.__fakeStore = fakeStore(seed);
  try { return await import("file://" + tmp); } finally { fs.unlinkSync(tmp); }
}

(async () => {
  const hooks = await loadLib("netlify/lib/hooks.js", "hooks", {});

  /* ============ 1. a silent option survives the parser ============ */
  {
    const src = [{ id: "h1", type: "Myth bust", template: "T1" }];
    const silent = hooks.parseOptions(
      "---HOOK---\nN: 1\nONSCREEN: 3 years, no cardio\nCAPTION: what actually changed\nWHY: it contradicts the belief\n",
      src, "onscreen");
    assert.strictEqual(silent.length, 1, "an option with NO spoken line is kept — v177 filtered on `spoken` and threw every silent reel away");
    assert.strictEqual(silent[0].spoken, "", "…it genuinely has none");
    assert.strictEqual(silent[0].lead, "3 years, no cardio", "…and the line it opens with is the on-screen card");

    const spoken = hooks.parseOptions(
      "---HOOK---\nN: 1\nSPOKEN: You won't get bulky\nONSCREEN: three years of lifting\nCAPTION: the myth\nWHY: names the fear\n",
      src, "talking");
    assert.strictEqual(spoken[0].lead, "You won't get bulky", "on a talking reel the lead is still the spoken line");
    assert.strictEqual(hooks.parseOptions("---HOOK---\nN: 1\nCAPTION: nothing\n", src, "onscreen").length, 0,
      "an option with neither line is dropped — there is no hook in it");
  }

  /* ============ 2. the script is a shot list, not a monologue ============ */
  {
    const p = hooks.scriptPrompt("will I get bulky", { onScreen: "3 years, no cardio", spoken: "" }, "onscreen", "");
    assert.ok(/SILENT reel/.test(p) && /Nobody speaks/i.test(p) === false || /no talking head/.test(p),
      "the model is told what it is writing for");
    assert.ok(/---BEATS---/.test(p) && !/---BODY---/.test(p), "it asks for beats, never a body of words he says");
    assert.ok(/under nine words/.test(p), "a beat has to be readable while the clip is moving");
    assert.ok(/caption is the long half/.test(p), "…and the caption carries the reel, which is the whole point");
    assert.ok(/stand on its own for somebody who\s+watched with the sound off/.test(p.replace(/\n/g, " ")) || /stand on its own/.test(p),
      "the caption has to work for someone who never read the screen");

    const t = hooks.scriptPrompt("x", { spoken: "You won't get bulky" }, "talking", "");
    assert.ok(/---BODY---/.test(t) && !/---BEATS---/.test(t), "the talking format is untouched and still writes a monologue");
  }

  /* ============ 3. beats parse out of what the model returns ============ */
  {
    const beats = hooks.parseBeats("She trained 3x a week | gym floor, wide\n- Ate the same food | kitchen\n3. No cardio\n\n");
    assert.deepStrictEqual(beats, [
      { text: "She trained 3x a week", shot: "gym floor, wide" },
      { text: "Ate the same food", shot: "kitchen" },
      { text: "No cardio", shot: "" },
    ], "bullets and numbering are stripped, the shot note is optional, blank lines are dropped");
    assert.strictEqual(hooks.parseBeats("").length, 0, "nothing in, nothing out");
    assert.ok(hooks.parseBeats(Array.from({ length: 20 }, (_, i) => "line " + i).join("\n")).length <= 6,
      "capped — a silent reel with twenty cards on it is not a reel");
  }

  /* ============ 4. the hook library still reads silent reels ============ */
  {
    assert.ok(/ONSCREEN: the text written on the screen at the start/.test(HOOKS_LIB),
      "the miner asks for on-screen text separately from speech");
    assert.ok(/If nothing was spoken, /.test(HOOKS_LIB) && /build the template from the on-screen text instead/.test(HOOKS_LIB),
      "…and templatises from it when nothing was said — this is why the library was never the problem");
    assert.ok(/if \(!read\.spoken && !read\.onScreen\)/.test(HOOKS_LIB),
      "it gives up only when there is NEITHER — a reel with no hook at all");
  }

  /* ============ 5. the voice profile follows the evidence ============ */
  {
    const voice = await loadLib("netlify/lib/voice.js", "voice", {});
    assert.ok(/ONSCREEN: every line of text that appears on screen/.test(VOICE_LIB),
      "it reads the screen as well as the soundtrack");
    assert.ok(/no words in it at all/.test(VOICE_LIB),
      "a reel is only lost when it has neither — v178 lost every reel that merely had nobody talking");
    assert.ok(/captionEvidence/.test(VOICE_LIB), "his captions are evidence too, and need no video at all");

    // the kind recorded, and the label it earns downstream
    const SCHED = read("netlify/lib/schedule.js");
    assert.ok(/kind: spokenCount >= 3/.test(VOICE_LIB), "the profile records what it learned from");
    assert.ok(/HOW ASH WRITES/.test(SCHED) && /He rarely speaks to camera/.test(SCHED),
      "a written profile is introduced as writing — calling it 'how Ash talks on camera' would invite the very monologue v182 exists to stop");
    assert.ok(/HOW ASH COMMUNICATES/.test(SCHED), "…and a mixed one says so");

    const brief = await (await loadLib("netlify/lib/schedule.js", "sched", {
      "ig-voice": { profile: "ON-SCREEN LINES\nShort. Capitals.", kind: "written", banned: ["game changer"] },
    })).voiceBrief();
    assert.ok(/HOW ASH WRITES/.test(brief) && !/TALKS ON CAMERA/.test(brief),
      "the brief handed to the writer names the right thing");
  }

  /* ============ 6. the page offers it, and defaults to it ============ */
  {
    const js = scriptOf(SOCIAL);
    assert.ok(/let hkFormat = "onscreen"/.test(js), "the default is the format Ash actually films");
    assert.ok(/On-screen reel — text over footage, no talking/.test(js), "…and it is named in plain words");
    assert.ok(/value="talking"/.test(js) && /value="demo"/.test(js), "the talking formats stay — they will work the day he films one");
    assert.ok(/if \(hkOptions \|\| hkScript\) \{ hkOptions = null/.test(js),
      "switching format clears options written for the other one, which would otherwise be written up as the wrong kind of reel");
    assert.ok(/hk-beats/.test(js), "beats are laid out as a numbered shot list");
    assert.ok(/ON SCREEN, FIRST: /.test(js), "…and copy out as one too, for reading off a phone while filming");
    assert.ok(/action: "options", topic: hkTopic, format: hkFormat/.test(js), "the format reaches the writer");
    assert.ok(/this is doing the heavy lifting/.test(js), "the caption is labelled as the workhorse it is on a silent reel");
  }

  console.log("v182 silent reels: OK");
})().catch((e) => { console.error(e); process.exit(1); });
