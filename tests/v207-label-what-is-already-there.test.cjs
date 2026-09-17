// v207 — labelling what is already on the shelf.
//
// Ash, the morning after v206 went up: "It has not labelled all of the previous ideas from
// the last 2 days. Can we back track and do this?"
//
// v206 gave every NEW suggestion its job and left everything already written down bare. That
// reads as reasonable — an idea two days from ageing off hardly needs a badge — and it is
// wrong for the one thing the badge exists for. He plans Friday off the whole week's shelf.
// A week with two days of it unlabelled is a week he cannot count the mix on, which is the
// entire point of putting the mix on the screen.
//
// WHAT THIS FILE PINS:
//  1. Blanks only. A stage he has already seen is never overwritten — the badge on an idea he
//     picked is the badge his choice was made on.
//  2. Matched back by id, never by position. An answer that slips by one would relabel every
//     reel after it, silently and plausibly.
//  3. An answer about an id that was never sent, or a word outside the four, is discarded.
//  4. The scripts are covered too — the To-film list is planned off as well, and half the
//     feature labelled is worse than a button pressed twice.
//  5. The button exists only while something is missing a badge, says how many, and takes
//     itself off the page when there are none.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = (f) => path.join(__dirname, "..", f);
const read = (f) => fs.readFileSync(root(f), "utf8");
const SOCIAL = read("social.html");
const API = read("netlify/functions/hooks-api.js");
const scriptOf = (src) => src.slice(src.lastIndexOf("<script>") + 8, src.lastIndexOf("</script>"));

(async () => {
  const stages = await import("file://" + root("netlify/lib/stages.js"));

  /* ============ 1. what it asks, and how it asks it ============ */
  {
    const items = [
      { id: "i1", text: "Rank the September restarts — everyone is starting again" },
      { id: "s7", text: "Ask them to message the word START" },
    ];
    const p = stages.classifyPrompt(items, "Small group coaching, 20 a session. Six Week Challenge.");
    assert.ok(/THE CONTENT MODEL/.test(p), "the same four definitions as everything else — not a second opinion on them");
    assert.ok(/Small group coaching, 20 a session/.test(p), "his own words about the gym help tell position from nurture");
    assert.ok(/^i1: Rank the September restarts/m.test(p) && /^s7: Ask them to message/m.test(p),
      "every reel goes in on one line with its id in front of it");
    assert.ok(/do not label half of these convert/.test(p),
      "…and it is warned off the flattering answer, or everything becomes a convert");
    assert.ok(/Use the ids exactly as they are given/.test(p), "because the answer is matched back by id");

    // long text and newlines are flattened, or one reel's description becomes two answers
    const messy = stages.classifyPrompt([{ id: "x", text: "one\nline\nbroken\nup " + "y".repeat(400) }], "");
    const line = messy.split("\n").find((l) => l.startsWith("x: "));
    assert.ok(line && !/\n/.test(line) && line.length < 220, "one reel is one line, however it was written down");
  }

  /* ============ 2. only the ids asked about, only the four words ============ */
  {
    const ids = ["i1", "i2", "i3"];
    const got = stages.parseClassify(
      "i1: attract\n" +
      "i2: NURTURE\n" +              // case is not the model's problem
      "- i3 = convert\n" +           // nor is a bullet or an equals sign
      "i9: position\n" +             // never sent
      "i1: convert\n",               // a second line about one it has already answered
      ids);
    assert.strictEqual(got.i1, "attract",
      "the first answer per id stands — a repeated line is the model repeating itself, not changing its " +
      "mind, and last-wins would make the label depend on stray output");
    assert.strictEqual(got.i2, "nurture");
    assert.strictEqual(got.i3, "convert");
    assert.ok(!("i9" in got), "an answer about something that was never sent is an answer about nothing");

    assert.deepStrictEqual(stages.parseClassify("i1: engagement\ni2: awareness", ["i1", "i2"]), {},
      "a word outside the model is not a stage, and no badge beats a made-up one");
    assert.deepStrictEqual(stages.parseClassify("", ["i1"]), {}, "nothing in, nothing out");
    assert.deepStrictEqual(stages.parseClassify("attract\nnurture\nposition", ["i1", "i2", "i3"]), {},
      "an answer with no ids in it is thrown away whole — it would otherwise be matched by POSITION, " +
      "and a list that has quietly slipped by one is the worst possible outcome here");
    assert.ok(stages.MAX_CLASSIFY >= 44, "one press has to cover a full shelf");
  }

  /* ============ 3. the function fills blanks and nothing else ============ */
  {
    assert.ok(/if \(action === "stages"\)/.test(API), "there is a door for it");
    assert.ok(/if \(!normStage\(i\.stage\) && i\.id\)/.test(API), "the shelf's blanks go in");
    assert.ok(/sc\.status !== "binned"/.test(API), "the scripts' blanks too, except the binned ones");
    assert.ok(/if \(!map\[x\.id\] \|\| normStage\(x\.stage\)\) return x;/.test(API),
      "and a stage that is already there is left exactly as it is — he chose that idea on that badge");
    assert.ok(/parseClassify\(r\.content[\s\S]{0,180}items\.map\(\(i\) => i\.id\)\)/.test(API),
      "the answer is held to the ids that were actually sent");
    assert.ok(/if \(labelled\) \{ await writeIdeas\(cur\); await writeLib\(lib\); \}/.test(API),
      "nothing is written when nothing changed");
    assert.ok(/if \(!bare\.length\) return json\(\{ ok: true, labelled: 0/.test(API),
      "and with nothing to label it costs nothing — no call, no write");
    assert.ok(/left: bare\.length - labelled/.test(API), "what it could not do is reported, not swallowed");
  }

  /* ============ 4. the button, and when it is not there ============ */
  {
    const js = scriptOf(SOCIAL);
    const el = () => ({ innerHTML: "", textContent: "", hidden: false, disabled: false, value: "",
      querySelectorAll: () => [], addEventListener() {}, insertAdjacentHTML() {}, scrollIntoView() {},
      setAttribute() {}, classList: { toggle() {}, contains: () => false } });
    const nodes = {}, cl = () => ({ toggle() {}, add() {}, remove() {}, contains: () => false });
    const sent = [];
    const sb = {
      document: { getElementById: (id) => (nodes[id] = nodes[id] || el()), querySelectorAll: () => [],
        addEventListener() {}, activeElement: null, body: { classList: cl() }, documentElement: { classList: cl() } },
      window: { innerWidth: 1200, innerHeight: 800, addEventListener() {} },
      navigator: { clipboard: { writeText: () => Promise.resolve() } },
      localStorage: { getItem: () => null, setItem() {} }, setTimeout: (f) => f && 0, console,
      fetch: async (url, opts) => {
        sent.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      },
    };
    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(js, sb);

    const libWith = (ideas, scripts) => JSON.stringify({ ok: true, configured: true, waiting: 0, skipped: 0,
      hooks: [{ id: "h1", type: "Myth bust", template: "T", vsMedian: 3 }], trends: { notes: [] },
      voice: null, ideas, scripts });

    // two days of bare ideas, and a script from before any of it existed
    vm.runInContext("hkLib = " + libWith(
      [{ id: "i1", title: "Badged already", format: "onscreen", stage: "attract" },
       { id: "i2", title: "Bare one", format: "onscreen" },
       { id: "i3", title: "Bare two", format: "onscreen" }],
      [{ id: "s1", status: "draft", topic: "t", lead: "L", format: "onscreen" },
       { id: "s2", status: "binned", topic: "t", lead: "L", format: "onscreen" }]) + "; renderHooks();", sb);

    /* In the card head beside New ideas, not down in the foot with the small print. This is
       something he presses once to fix a whole week, and the foot is where the things he
       rarely touches live — he would not have found it there. */
    assert.ok(/id="hkStagesSlot"/.test(SOCIAL) &&
      SOCIAL.indexOf('id="hkStagesSlot"') < SOCIAL.indexOf('id="hkIdeasNew"'),
      "the button lives in the card head, with the other actions on the whole set");
    assert.ok(/Label the 3 without a badge/.test(nodes.hkStagesSlot.innerHTML),
      "three things have no badge — the two ideas and the live script, not the binned one and not the badged idea");

    await vm.runInContext('(function(){ return hkPost({ action: "stages" }); })()', sb);
    assert.ok(sent.some((r) => r.body && r.body.action === "stages"), "and the press asks for them to be labelled");

    // once everything has one, the button is gone rather than sitting there doing nothing
    vm.runInContext("hkLib = " + libWith(
      [{ id: "i1", title: "Badged already", format: "onscreen", stage: "attract" },
       { id: "i2", title: "Now badged", format: "onscreen", stage: "nurture" }],
      [{ id: "s1", status: "draft", topic: "t", lead: "L", format: "onscreen", stage: "convert" }]) + "; renderHooks();", sb);
    assert.ok(!/without a badge/.test(nodes.hkStagesSlot.innerHTML),
      "with nothing left to label the button takes itself off the page");

    // and one is "one", not "1"
    vm.runInContext("hkLib = " + libWith([{ id: "i2", title: "The only bare one", format: "onscreen" }], []) + "; renderHooks();", sb);
    assert.ok(/Label the one without a badge/.test(nodes.hkStagesSlot.innerHTML), "written the way a person would say it");
  }

  console.log("v207 label-what-is-already-there: OK");
})().catch((e) => { console.error(e); process.exit(1); });
