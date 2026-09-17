// v206 — what job the post is doing.
//
// Ash: "The only thing I want adding to the 'Content' > 'Make a reel' is the suggestion of
// whether the suggested post sits as an ATTRACT, NURTURE, POSITION or CONVERT post."
//
// His own content model, from Bodysculpt_Content_Model_Explanation: "Not every post has the
// same job." Four jobs, and a posting week is a fixed mix of them — 2 ATTRACT, 2 NURTURE,
// 2 POSITION, 1 CONVERT. The ideas engine was suggesting eight reels a week with no idea which
// job any of them did, which means a Friday planning session could pick seven ATTRACT posts
// and call it a week. Seven posts all doing the same job is one post, filmed seven times.
//
// WHAT THIS FILE PINS:
//  1. The model is defined ONCE. Two prompts and one page have to mean the same thing by
//     "nurture", and a definition kept in three places drifts in two of them.
//  2. Unknown means unknown. A stage outside the model renders no badge, never a wrong one —
//     the badge is the thing he plans a week around.
//  3. The generator is asked for the weekly MIX, not just for eight labels.
//  4. The badge is on the idea, on the script, and still on it in the To-film list.
//  5. A stage he was shown on an idea is the stage that idea's script keeps.
//  6. A topic typed into the box starts clean — it does not inherit the last idea's badge,
//     nor (a bug that has been there since v200) the last idea's id.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = (f) => path.join(__dirname, "..", f);
const read = (f) => fs.readFileSync(root(f), "utf8");
const SOCIAL = read("social.html");
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
  const tmp = root("netlify/lib/__" + tag + "-v206-" + process.pid + ".mjs");
  fs.writeFileSync(tmp, patched);
  globalThis.__fakeStore = fakeStore(seed);
  try { return await import("file://" + tmp); } finally { fs.unlinkSync(tmp); }
}

(async () => {
  const stages = await import("file://" + root("netlify/lib/stages.js"));

  /* ============ 1. the model, defined once ============ */
  {
    assert.deepStrictEqual(stages.STAGE_KEYS, ["attract", "nurture", "position", "convert"],
      "the four jobs, in the order his own document lists them");
    assert.deepStrictEqual(stages.STAGE_KEYS.map((k) => stages.STAGES[k].perWeek), [2, 2, 2, 1],
      "and the week he actually posts: 2 attract, 2 nurture, 2 position, 1 convert");

    const brief = stages.stagesBrief();
    for (const k of stages.STAGE_KEYS) {
      assert.ok(new RegExp("· " + k.toUpperCase() + " —").test(brief), k + " is explained to the model, not just named");
    }
    assert.ok(/reach and shares|passed on/.test(stages.STAGES.attract.what), "attract is about reach");
    assert.ok(/asks/.test(stages.STAGES.convert.what) && /never more/.test(stages.STAGES.convert.what),
      "convert is the one that asks, and there is one a week");

    // the same words reach both prompts — neither gets to invent its own "position"
    const IDEAS = read("netlify/lib/ideas.js"), HOOKS = read("netlify/lib/hooks.js");
    assert.ok(/from "\.\/stages\.js"/.test(IDEAS), "the ideas engine reads the model from the one file");
    assert.ok(/from "\.\/stages\.js"/.test(HOOKS), "…and so does the writer");
    assert.ok(!/relatable or funny content built to be passed on/.test(IDEAS + HOOKS),
      "and neither of them keeps its own copy of the definition");
  }

  /* ============ 2. unknown means unknown ============ */
  {
    assert.strictEqual(stages.normStage("ATTRACT"), "attract", "case and spacing do not matter");
    assert.strictEqual(stages.normStage("  convert\n"), "convert");
    assert.strictEqual(stages.normStage("sell"), "", "a word outside the model is not a stage");
    assert.strictEqual(stages.normStage(""), "");
    assert.strictEqual(stages.normStage(null), "", "never a stage by accident");
    assert.strictEqual(stages.normStage("attract2"), "", "and no near-misses");
  }

  /* ============ 3. asked for the MIX, not just for labels ============ */
  {
    assert.deepStrictEqual(stages.mixFor(8), { attract: 3, nurture: 2, position: 2, convert: 1 },
      "eight a day, in the proportions of the week he posts — the slack goes on attract");
    assert.deepStrictEqual(stages.mixFor(7), { attract: 2, nurture: 2, position: 2, convert: 1 },
      "seven is exactly his week");
    for (const n of [4, 5, 6, 7, 8, 9, 12, 14, 20]) {
      const mix = stages.mixFor(n);
      const total = stages.STAGE_KEYS.reduce((t, k) => t + mix[k], 0);
      assert.strictEqual(total, n, "the mix for " + n + " adds up to " + n);
      assert.ok(stages.STAGE_KEYS.every((k) => mix[k] >= 1),
        "every job is asked for at " + n + " — a set with no convert in it is a week that never asks");
    }
    assert.ok(/1 CONVERT$/.test(stages.mixLine(8)), "and it reads as a sentence, for the prompt");

    const lib = await loadLib("netlify/lib/ideas.js", "ideas", {});
    const p = lib.ideasPrompt({ hooks: [], ownPosts: [], recentTopics: [], now: new Date("2026-09-17T10:00:00Z") });
    assert.ok(/THE CONTENT MODEL/.test(p), "the model goes in the prompt");
    for (const k of stages.STAGE_KEYS) assert.ok(new RegExp(k.toUpperCase()).test(p), k + " is in there");
    assert.ok(/3 ATTRACT, 2 NURTURE, 2 POSITION and 1 CONVERT/.test(p),
      "…and it is told to cover the mix, because he plans a week off one day's suggestions");
    assert.ok(/^STAGE: which of the four jobs/m.test(p), "every idea comes back with its job named");
    assert.ok(/not the one you would like it to do/.test(p),
      "judged on what the post does, or everything becomes a convert");
  }

  /* ============ 4. and it survives the round trip ============ */
  {
    const lib = await loadLib("netlify/lib/ideas.js", "ideas2", {});
    const out = lib.parseIdeas(
      "---IDEA---\nTITLE: Rank the September restarts\nSTAGE: ATTRACT\nFORMAT: onscreen\n" +
      "---IDEA---\nTITLE: What a first session actually looks like\nSTAGE: position\nFORMAT: demo\n" +
      "---IDEA---\nTITLE: Ask them to message the word start\nSTAGE: convert\nFORMAT: talking\n" +
      "---IDEA---\nTITLE: One with a made-up stage\nSTAGE: engagement\nFORMAT: onscreen\n" +
      "---IDEA---\nTITLE: One from before any of this existed\nFORMAT: onscreen\n");
    assert.deepStrictEqual(out.map((i) => i.stage), ["attract", "position", "convert", "", ""],
      "read, lower-cased, and blank for anything the model does not recognise or did not send");

    // a script written from the box gets one from the writer instead
    const hooks = await loadLib("netlify/lib/hooks.js", "hooks", {});
    for (const [fmt, opt] of [["onscreen", { onScreen: "X" }], ["talking", { spoken: "Y" }], ["demo", { spoken: "Y" }]]) {
      const sp = hooks.scriptPrompt("will I get bulky", opt, fmt, "", "");
      assert.ok(/THE CONTENT MODEL/.test(sp), "a " + fmt + " script is written knowing the model");
      assert.ok(/---STAGE---/.test(sp), "…and says which job it just wrote (" + fmt + ")");
    }
    assert.ok(/stage: normStage\(part\("STAGE"\)\)/.test(read("netlify/lib/hooks.js")),
      "the writer's answer is held to the model on the way into the script");
    assert.ok(/stage: normStage\(s\.stage\)/.test(read("netlify/functions/hooks-api.js")),
      "…and again on the way into the blob, because a saved script is just a request that arrived");
  }

  /* ============ 5. what the page actually draws ============ */
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
        return { ok: true, status: 200, json: async () => ({ ok: true, options: [{ onScreen: "x", lead: "x" }] }) };
      },
    };
    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(js, sb);

    const IDEAS = [
      { id: "i1", title: "Rank the September restarts", why: "It is September.", source: "it is September", format: "onscreen", stage: "attract" },
      { id: "i2", title: "What a first session actually looks like", why: "Nobody believes it.", source: "@dm_pt got 30×", format: "demo", stage: "position" },
      { id: "i3", title: "One from before any of this existed", why: "", source: "", format: "onscreen" },
    ];
    vm.runInContext("hkLib = " + JSON.stringify({ ok: true, configured: true, waiting: 0, skipped: 0,
      hooks: [{ id: "h1", type: "Myth bust", template: "T", vsMedian: 3 }],
      ideas: IDEAS,
      scripts: [{ id: "s1", status: "draft", topic: "t", lead: "L", onScreen: "L", format: "onscreen", stage: "convert" }],
    }) + "; renderHooks();", sb);

    const ideasHtml = nodes.hkIdeas.innerHTML;
    assert.ok(/class="hk-stage attract">Attract</.test(ideasHtml), "the attract idea is badged ATTRACT");
    assert.ok(/class="hk-stage position">Position</.test(ideasHtml), "…and the position one POSITION");
    assert.ok(/reach and shares/.test(ideasHtml) && /experienced and different/.test(ideasHtml),
      "in plain English beside it — nobody should have to learn four new words to read their own content plan");
    assert.strictEqual((ideasHtml.match(/class="hk-stage /g) || []).length, 2,
      "and the idea from before this existed gets no badge at all, rather than a guessed one");
    assert.ok(ideasHtml.indexOf("hk-stage") < ideasHtml.indexOf("Rank the September restarts"),
      "the badge sits above the idea — it is what he sorts a week by");

    // still there once it is a script waiting to be filmed
    assert.ok(/class="hk-stage convert">Convert</.test(nodes.hkScripts.innerHTML),
      "the label survives the decision to film it — the To-film list is planned off too");

    /* ---- 6. the stage he was shown is the stage it keeps ---- */
    // pressing an idea carries its stage into the writer
    vm.runInContext('hkStage = ""; hkFromIdea = "";', sb);
    assert.strictEqual(vm.runInContext("hkStage", sb), "");
    vm.runInContext('hkFormat = "onscreen"; hkFromIdea = "i2"; hkStage = "position";', sb);
    await vm.runInContext('askOptions("What a first session actually looks like")', sb);
    assert.strictEqual(vm.runInContext("hkStage", sb), "position",
      "a topic handed over from an idea keeps that idea's badge");
    assert.strictEqual(vm.runInContext("hkFromIdea", sb), "i2");

    // and a topic typed into the box does NOT inherit it
    sent.length = 0;
    nodes.hkTopicIn.value = "something else entirely that I typed myself";
    await vm.runInContext("askOptions()", sb);
    assert.strictEqual(vm.runInContext("hkStage", sb), "",
      "a reel he typed himself does not wear the last idea's badge");
    assert.strictEqual(vm.runInContext("hkFromIdea", sb), "",
      "…and is not saved against the last idea either, which would have marked a suggestion " +
      "as written when it never was");

    assert.ok(/if \(hkStage\) hkScript\.stage = hkStage;/.test(js),
      "the idea's own stage wins over the writer's guess — he picked it on the strength of that badge");
    /* Found on the first look at it: draft is amber, filmed is indigo, posted is green — the
       same three hues as the stages. ATTRACT beside DRAFT was two amber pills reading as two
       statuses. In that list the stage is outlined instead: same hue, different weight. */
    assert.ok(/\.hk-sc \.hk-stage\{background:none;border:1px solid currentColor/.test(SOCIAL),
      "in the To-film list the stage is outlined, because the filled pill there already means draft/filmed/posted");

        assert.ok(/ATTRACT is relatable or funny/.test(SOCIAL) && /two attract, two nurture, two position and one convert/.test(SOCIAL),
      "and the tip explains all four and the shape of a week, because a coloured badge is not a definition");
  }

  console.log("v206 what-job-the-post-does: OK");
})().catch((e) => { console.error(e); process.exit(1); });
