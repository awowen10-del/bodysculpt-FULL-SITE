// v192 — what to film.
//
// Ash, looking at the finished Hooks tab: "I'll be honest I'm confused by this screen and
// what it's doing. I don't load this up and immediately feel inspired or know what to post
// for a reel."
//
// He was right, and the miss goes back to the first conversation. Everything built so far is
// the SECOND half of the job — given a topic, find a proven opening and write it well. The
// page opened on an empty box asking "what is the reel about?", which is a question he does
// not have the answer to, because if he did he would not need the page. The blank page had
// not been solved, only moved from a notes app into his dashboard.
//
// WHAT THIS FILE PINS:
//  1. An idea is a SUBJECT he could film, not a format and not a sentence shape. The hook
//     library's "WHAT [WE] [DO]" is useful to the machine and meaningless to him as a prompt.
//  2. Ideas come from what the dashboard already knows — reels that took off for accounts he
//     watches, his own posts, his captions, the season — never invented, never scraped.
//  3. Pressing one takes it INTO the writer. The step he could not take on his own is the
//     step he no longer has to take.
//  4. They are generated once a day, not on every page load.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = (f) => path.join(__dirname, "..", f);
const read = (f) => fs.readFileSync(root(f), "utf8");
const SOCIAL = read("social.html");
const IDEAS = read("netlify/lib/ideas.js");
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
  const tmp = root("netlify/lib/__" + tag + "-v192-" + process.pid + ".mjs");
  fs.writeFileSync(tmp, patched);
  globalThis.__fakeStore = fakeStore(seed);
  try { return await import("file://" + tmp); } finally { fs.unlinkSync(tmp); }
}

(async () => {
  const lib = await loadLib("netlify/lib/ideas.js", "ideas", {});

  /* ============ 1. the prompt asks for subjects, from real things ============ */
  {
    const p = lib.ideasPrompt({
      about: "Small group coaching, 20 per session. People worry it will be too hard.",
      voice: "He answers the same questions in captions.",
      hooks: [{ angle: "Inside the coaching programme", username: "dm_pt", vsMedian: 30.9, why: "promises a look inside" }],
      ownPosts: [{ caption: "Three clients, same session, three different ways", views: 9682 }],
      recentTopics: ["will I get bulky"],
      now: new Date("2026-09-16T12:00:00Z"),
    });
    assert.ok(/It is a SUBJECT, not a format/.test(p),
      "an idea is a thing to film, not 'do a talking head' — the distinction is the whole point");
    assert.ok(/Inside the coaching programme/.test(p) && /30\.9× their normal/.test(p),
      "what took off for the accounts he watches goes in, as a SUBJECT rather than a sentence shape");
    assert.ok(/Three clients, same session/.test(p), "his own posts go in");
    assert.ok(/do not repeat them/.test(p) && /will I get bulky/.test(p), "and what he has already written is excluded");
    assert.ok(/September/.test(p) && /second January/.test(p), "the time of year is real context, not decoration");
    assert.ok(/Small group coaching, 20 per session/.test(p), "his own note about the business carries through");
    assert.ok(/film it in his own gym this week/.test(p), "nothing suggested that he cannot actually shoot");
    assert.ok(/do not give five versions of one idea/.test(p), "five ideas, not one idea five ways");

    // the season is genuinely computed, not a fixed string
    const jan = lib.ideasPrompt({ hooks: [], ownPosts: [], recentTopics: [], now: new Date("2026-01-08T12:00:00Z") });
    assert.ok(/busiest month/.test(jan) && !/second January/.test(jan), "January is not September");
  }

  /* ============ 2. parsing, and the shape an idea has to have ============ */
  {
    const out = lib.parseIdeas(
      "---IDEA---\nTITLE: Answer the bulky question on camera\nWHY: Every consult ends with it.\nSOURCE: you answer this in your captions\nFORMAT: onscreen\n" +
      "---IDEA---\nTITLE: What 20 people in one session actually looks like\nWHY: It is the thing nobody believes.\nSOURCE: @dm_pt got 30×\nFORMAT: demo\n" +
      "---IDEA---\nWHY: no title here\nFORMAT: talking\n");
    assert.strictEqual(out.length, 2, "an idea with no title is not an idea");
    assert.strictEqual(out[0].title, "Answer the bulky question on camera");
    assert.strictEqual(out[0].source, "you answer this in your captions", "where it came from is kept — it is what earns trust");
    assert.strictEqual(out[1].format, "demo", "the format it suits");
    assert.strictEqual(lib.parseIdeas("nothing here").length, 0, "junk in, nothing out");
    const bad = lib.parseIdeas("---IDEA---\nTITLE: x\nFORMAT: interpretive dance\n");
    assert.strictEqual(bad[0].format, "onscreen", "an unknown format falls back to the one he actually films");
  }

  /* ============ 3. once a day, not once a page load ============ */
  {
    const today = new Date().toISOString();
    assert.ok(lib.isFresh({ generatedAt: today }), "ideas made today are today's ideas");
    assert.ok(!lib.isFresh({ generatedAt: "2026-09-01T10:00:00Z" }), "…and yesterday's are not");
    assert.ok(!lib.isFresh({}) && !lib.isFresh(null), "never fresh by accident");
    const api = read("netlify/functions/hooks-api.js");
    assert.ok(/if \(!body\.force && isFresh\(cur\) && cur\.ideas\.length\)/.test(api),
      "a cached set is served unless he asks for new ones — regenerating on every visit would hand him a different five each time he changed tabs");
    assert.ok(/output_config: \{ effort: "low" \}/.test(IDEAS), "and it runs inside the 26-second wall");
  }

  /* ============ 4. his note is the lever, and it is his ============ */
  {
    const seeded = await loadLib("netlify/lib/ideas.js", "ideas2", {});
    await seeded.setAbout("  We do small group coaching.  ");
    assert.strictEqual((await seeded.readIdeas()).about, "  We do small group coaching.  ", "saved as written");
    const long = "x".repeat(5000);
    await seeded.setAbout(long);
    assert.strictEqual((await seeded.readIdeas()).about.length, 3000, "bounded, like everything else that reaches a blob");
  }

  /* ============ 5. the page leads with them, and one press is the whole journey ============ */
  {
    const js = scriptOf(SOCIAL);
    assert.ok(SOCIAL.indexOf('id="hkIdeas"') < SOCIAL.indexOf('id="hkWriter"'),
      "the ideas come BEFORE the box — the box was the front door and should never have been");
    /* v197 renamed it. "Write something else" read as an afterthought and did not say what it
       wanted from you; with the team in here, a label has to explain itself. */
    assert.ok(/Or write your own idea/.test(SOCIAL), "…and the box is plainly the fallback, in words a newcomer can act on");
    assert.ok(!/data-view="hooks">Hooks</.test(SOCIAL),
      "the tab is not called Hooks — nobody new to marketing knows what a hook is");
    assert.ok(/Film one of these/.test(SOCIAL), "the heading says what to do with them");
    // v193: what this used to assert — that the source contained `hkTopic = i.title` and a
    // call to askOptions() — was true of code that did nothing at all. The claim is now made
    // in section 6 by running it. What is worth pinning HERE is the shape that made the bug
    // possible: the topic is handed over explicitly and never left for the box to supply.
    assert.ok(/askOptions\(i\.title/.test(js),
      "pressing an idea hands the topic straight to the writer rather than relying on the box having it");
    assert.ok(/async function askOptions\(topic\)/.test(js) && /if \(topic == null\)/.test(js),
      "…and the writer only reads the box when nothing was handed to it");
    assert.ok(/hkFormat = i\.format/.test(js), "…in the format that idea suits");
    assert.ok(/scrollIntoView/.test(js), "…and takes him to it");
    assert.ok(/renderIdeas\(\);/.test(js), "drawn on every render");
    assert.ok(/hkAboutIn/.test(js) && /action: "about"/.test(js), "and he can tell it about his gym");
  }

  /* ============ 6. v193: pressing Write it actually does something ============
     Ash: "When I press it, it doesn't do anything."

     askOptions() began by reading the topic textarea and overwriting whatever it had been
     given, then returned on an empty-topic guard — silently, because an empty box is a
     perfectly ordinary reason not to go. So the one path the whole of v192 exists to provide
     was the one path that could not work.

     The v192 assertions above passed throughout, because they matched SOURCE TEXT: `hkTopic =
     i.title` was present and `askOptions()` was called. Both true, neither sufficient. This
     one runs the function and looks at what goes over the wire. */
  {
    const vm = require("vm");
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
        return { ok: true, status: 200, json: async () => ({ ok: true, options: [{ spoken: "", onScreen: "x", caption: "c", lead: "x" }] }) };
      },
    };
    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(js, sb);
    vm.runInContext('hkLib = ' + JSON.stringify({ ok: true, configured: true, scripts: [], waiting: 0, skipped: 0,
      hooks: [{ id: "h1", type: "Myth bust", template: "T", vsMedian: 3 }],
      ideas: [{ id: "i1", title: "Answer the bulky question on camera", why: "Every consult ends with it.", source: "s", format: "talking" }],
    }) + "; renderHooks();", sb);

    // the topic box is empty, exactly as it is when he presses Write it
    assert.strictEqual(nodes.hkTopicIn.value, "", "the box starts empty — this is the condition the bug needed");

    await vm.runInContext('askOptions("Answer the bulky question on camera — Every consult ends with it.")', sb);
    const ask = sent.find((r) => r.body && r.body.action === "options");
    assert.ok(ask, "a topic handed in explicitly reaches the server — before v193 this request was never made at all");
    assert.strictEqual(ask.body.topic, "Answer the bulky question on camera — Every consult ends with it.",
      "…and it is the IDEA's words, not the empty box's");

    // and the box still works on its own
    sent.length = 0;
    nodes.hkTopicIn.value = "something I typed myself";
    await vm.runInContext("askOptions()", sb);
    const typed = sent.find((r) => r.body && r.body.action === "options");
    assert.ok(typed && typed.topic !== "", "typing in the box still works");
    assert.strictEqual(typed.body.topic, "something I typed myself", "…and takes what is in it");

    // an empty box with no idea still goes nowhere, quietly, as it should
    sent.length = 0;
    nodes.hkTopicIn.value = "   ";
    await vm.runInContext("askOptions()", sb);
    assert.strictEqual(sent.filter((r) => r.body && r.body.action === "options").length, 0,
      "an empty box asks for nothing — that guard was right, it was only ever reached wrongly");
  }

  console.log("v192/v193 what to film: OK");
})().catch((e) => { console.error(e); process.exit(1); });
