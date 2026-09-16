// v177 — the hook library: what was actually SAID in the reels that took off.
//
// Ash, on the bundle of scripting skills he had been sent: "do I need to go back to the
// terminal … or can you access it from this generic open chat?" — and before that, the
// question this page is the answer to: whether a content workflow belongs in a standalone
// tool or in the cockpit. It belongs here, because two thirds of it was already here. The
// nightly Apify scrape already found the reels that beat their own account; Gemini was
// already transcribing video for the caption writer; Claude was already writing in his
// voice. The one thing missing was the middle: nothing listened to the winning reels.
//
// THE THINGS THIS FILE EXISTS TO PIN:
//
//  1. ONE DEFINITION OF "TOOK OFF". The flame on the Content page means a post that did at
//     least 2× its own account's median, on a median of at least four values. The miner must
//     use the same rule on the same stored numbers, or the Hooks tab will disagree with the
//     Competitors tab about which reels mattered and neither will be trustworthy.
//
//  2. A COMPETITOR'S NORMAL IS THEIR OWN. Never a comparison across accounts: a small gym's
//     good night and a national account's good night are different numbers, and the only
//     thing that travels between them is the SHAPE of the sentence.
//
//  3. MINING COSTS MONEY, SO IT IS BOUNDED. Only flames are read, never the whole feed; a
//     reel already in the library is never read twice; a reel that failed goes on the skip
//     list rather than being retried nightly for ever against a link that is already dead.
//
//  4. THE PAGE WRITES NOTHING IT WAS NOT ASKED TO. social.html's only writes are to
//     /api/hooks and the mine trigger — v136's claim about the blob store still has to hold
//     with a third tab on the page.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = (f) => path.join(__dirname, "..", f);
const read = (f) => fs.readFileSync(root(f), "utf8");
const SOCIAL = read("social.html");
const TOML = read("netlify.toml");
const scriptOf = (src) => src.slice(src.lastIndexOf("<script>") + 8, src.lastIndexOf("</script>"));
const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));

/* ---------- the blob store, faked (the v136 shape) ---------- */
function fakeStore(seed) {
  const m = new Map(Object.entries(seed || {}).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return {
    _m: m,
    async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list(o) { const p = (o && o.prefix) || ""; return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })), directories: [] }; },
  };
}

// The module is written into netlify/lib/ rather than a temp dir, because it imports
// ./schedule.js by a relative path and that has to keep resolving.
async function loadHooks(seed) {
  const src = read("netlify/lib/hooks.js");
  assert.ok(/^import \{ getStore \} from "@netlify\/blobs";$/m.test(src),
    "hooks.js: the store import is the single line this test swaps");
  const patched = src.replace(/^import \{ getStore \} from "@netlify\/blobs";$/m,
    "const getStore = () => globalThis.__fakeStore;");
  const tmp = root("netlify/lib/__hooks-test-" + process.pid + ".mjs");
  fs.writeFileSync(tmp, patched);
  globalThis.__fakeStore = fakeStore(seed);
  try { return { mod: await import("file://" + tmp), store: globalThis.__fakeStore }; }
  finally { fs.unlinkSync(tmp); }
}

// fifteen posts whose views make a median of 100, plus whatever is passed in
const normalPosts = () => Array.from({ length: 10 }, (_, i) => ({
  shortCode: "n" + i, url: "https://instagram.com/reel/n" + i + "/", type: "Video",
  timestamp: "2026-09-0" + (i % 9 + 1) + "T10:00:00Z", videoUrl: "https://cdn/n" + i + ".mp4",
  caption: "normal", likes: 10, comments: 1, views: 100,
}));

(async () => {
  /* ============ 1. the same rule as the flame ============ */
  {
    const posts = normalPosts().concat([
      { shortCode: "big", url: "u/big", type: "Video", timestamp: "2026-09-10T10:00:00Z", videoUrl: "https://cdn/big.mp4", caption: "c", likes: 90, comments: 9, views: 400 },
      { shortCode: "mid", url: "u/mid", type: "Video", timestamp: "2026-09-11T10:00:00Z", videoUrl: "https://cdn/mid.mp4", caption: "c", likes: 20, comments: 2, views: 199 },
      { shortCode: "edge", url: "u/edge", type: "Video", timestamp: "2026-09-12T10:00:00Z", videoUrl: "https://cdn/edge.mp4", caption: "c", likes: 20, comments: 2, views: 200 },
    ]);
    const { mod } = await loadHooks({
      "ig-competitors": [{ username: "puregym" }],
      "ig-scrape-puregym": { username: "puregym", fetchedAt: "2026-09-16T05:00:00Z", posts },
    });
    const c = await mod.candidates(await mod.readLib());
    const ids = c.map((x) => x.id);
    assert.ok(ids.includes("big"), "4× the median is a flame and must be mined");
    assert.ok(ids.includes("edge"), "exactly 2× is a flame — the Content page's boundary is >=, not >");
    assert.ok(!ids.includes("mid"), "1.99× is not a flame and must NOT be read: reading it costs money and teaches nothing");
    assert.ok(!ids.includes("n0"), "a post at its account's normal is never read");
    assert.strictEqual(c[0].id, "big", "the biggest outlier is mined first, so a capped run spends its budget on the clearest winner");
    assert.strictEqual(c[0].basis, "views", "a competitor is judged on views — the one number their public page gives");
  }

  /* ============ 2. too few posts is not a normal ============ */
  {
    const { mod } = await loadHooks({
      "ig-competitors": [{ username: "tiny" }],
      "ig-scrape-tiny": { username: "tiny", fetchedAt: "x", posts: [
        { shortCode: "a", videoUrl: "v", views: 10, url: "u" }, { shortCode: "b", videoUrl: "v", views: 10, url: "u" },
        { shortCode: "c", videoUrl: "v", views: 1000, url: "u" },
      ] },
    });
    assert.strictEqual((await mod.candidates(await mod.readLib())).length, 0,
      "three posts cannot establish a median — a 'normal' from three values is a coin toss, and the Content page needs four too");
  }

  /* ============ 3. each account against its own normal ============ */
  {
    const small = normalPosts().map((p) => ({ ...p, shortCode: "s" + p.shortCode, views: 50 }));
    small.push({ shortCode: "s-hit", url: "u", videoUrl: "v", views: 150, caption: "c", timestamp: "t" });   // 3× of 50
    const big = normalPosts().map((p) => ({ ...p, shortCode: "b" + p.shortCode, views: 5000 }));
    big.push({ shortCode: "b-flat", url: "u", videoUrl: "v", views: 6000, caption: "c", timestamp: "t" });    // 1.2× of 5000
    const { mod } = await loadHooks({
      "ig-competitors": [{ username: "small" }, { username: "big" }],
      "ig-scrape-small": { username: "small", posts: small },
      "ig-scrape-big": { username: "big", posts: big },
    });
    const ids = (await mod.candidates(await mod.readLib())).map((x) => x.id);
    assert.ok(ids.includes("s-hit"), "150 views is a hit for an account that normally gets 50");
    assert.ok(!ids.includes("b-flat"), "6,000 views is NOT a hit for an account that normally gets 5,000 — an absolute number would have said the opposite");
  }

  /* ============ 4. nothing is read twice, and failures are not retried for ever ============ */
  {
    const posts = normalPosts().concat([{ shortCode: "big", url: "u", videoUrl: "v", views: 400, caption: "c", timestamp: "t" }]);
    const seed = { "ig-competitors": [{ username: "g" }], "ig-scrape-g": { username: "g", posts } };

    const a = await loadHooks({ ...seed, "ig-hooks": { hooks: [{ id: "big" }], scripts: [], skipped: [] } });
    assert.strictEqual((await a.mod.candidates(await a.mod.readLib())).length, 0,
      "a reel already in the library is never downloaded and read a second time");

    const b = await loadHooks({ ...seed, "ig-hooks": { hooks: [], scripts: [], skipped: ["big"] } });
    assert.strictEqual((await b.mod.candidates(await b.mod.readLib())).length, 0,
      "a reel that could not be read goes on the skip list — Instagram's link is dead by tomorrow, so a nightly retry would fail identically and bill identically");
  }

  /* ============ 5. his own reels come from the feed's own verdict ============ */
  {
    const { mod } = await loadHooks({
      "ig-cache-mine": { account: { username: "bodysculptwarrington" }, posts: [
        { id: "1", permalink: "https://www.instagram.com/reel/AAA/", video: "https://cdn/a.mp4", outlier: true, vsMedian: 3.2, views: 900, reach: 800, caption: "c", timestamp: "t" },
        { id: "2", permalink: "https://www.instagram.com/reel/BBB/", video: "https://cdn/b.mp4", outlier: false, vsMedian: 1.1, views: 300, caption: "c", timestamp: "t" },
        { id: "3", permalink: "https://www.instagram.com/reel/CCC/", video: "", outlier: true, vsMedian: 4, views: 900, caption: "c", timestamp: "t" },
      ] },
    });
    const c = await mod.candidates(await mod.readLib());
    assert.deepStrictEqual(c.map((x) => x.id), ["AAA"], "only his flagged outlier, and only the one with a video to read");
    assert.strictEqual(c[0].isOwn, true);
    assert.strictEqual(c[0].basis, "engagement", "his own posts are judged on reach-based engagement, which is the honest measure and only possible on an account you own");
  }

  /* ============ 6. the writer is given a spread, not eight of one idea ============ */
  {
    const { mod } = await loadHooks({});
    const many = [];
    for (let i = 0; i < 12; i++) many.push({ id: "a" + i, type: "Myth bust", template: "t", vsMedian: 10 - i * 0.1 });
    many.push({ id: "b1", type: "Objection killer", template: "t", vsMedian: 2.1 });
    many.push({ id: "c1", type: "Client story", template: "t", vsMedian: 2.0 });
    const picked = mod.forWriting(many, 6);
    const types = new Set(picked.map((h) => h.type));
    assert.ok(types.size >= 3, "a library dominated by one archetype must still offer the others — otherwise all eight options are the same idea in different words");
    assert.ok(picked.some((h) => h.id === "a0"), "the biggest outlier is still in there");
    assert.ok(!mod.forWriting([{ id: "x", type: "Myth bust", vsMedian: 9 }], 6).length,
      "a hook with no template is no use to the writer — the template is the reusable part");
  }

  /* ============ 7. the archetypes are a fixed list ============ */
  {
    const { mod } = await loadHooks({});
    assert.ok(mod.HOOK_TYPES.length >= 10, "enough archetypes to be worth filtering by");
    assert.ok(mod.HOOK_TYPES.includes("Objection killer") && mod.HOOK_TYPES.includes("Transformation reveal"),
      "the list is named for what a gym audience responds to, not for what a tech account posts");
    const prompt = mod.optionsPrompt("bulky", [{ type: "Myth bust", template: "Everyone thinks [X]", spoken: "s", username: "u", vsMedian: 3 }], "");
    assert.ok(/Warrington/.test(prompt), "the audience is stated to the model, every time");
    assert.ok(/EIGHT hook options/.test(prompt), "eight, not ten: the call has to land inside the 26s function timeout");
    assert.ok(/does not repeat/.test(prompt), "the on-screen line must ADD to the spoken one — repeating it wastes the only two seconds that matter");
  }

  /* ============ 8. a script is parsed out of what Claude returns ============ */
  {
    const { mod } = await loadHooks({});
    const options = mod.parseOptions(
      "---HOOK---\nN: 1\nSPOKEN: You will not get bulky\nONSCREEN: three years of lifting\nCAPTION: the bulky myth\nWHY: it names the fear\n" +
      "---HOOK---\nN: 2\nSPOKEN: Second one\nONSCREEN: x\nCAPTION: y\nWHY: z\n",
      [{ id: "h1", type: "Myth bust", template: "T1" }, { id: "h2", type: "Client story", template: "T2" }]
    );
    assert.strictEqual(options.length, 2);
    assert.strictEqual(options[0].spoken, "You will not get bulky");
    assert.strictEqual(options[0].hookId, "h1", "each option is traceable back to the proven reel it was built on");
    assert.strictEqual(options[1].type, "Client story");
    assert.strictEqual(mod.parseOptions("nothing useful here", []).length, 0, "junk in, nothing out — never a half-parsed hook");
  }

  /* ============ 9. the page still writes only where it should ============ */
  {
    // v136's claim, restated for a third tab: a READ goes through jget(url) and carries no
    // options; anything carrying a method is a write, and every write on this page names one
    // of the page's own four endpoints. A new tab must not widen that surface.
    const js = scriptOf(SOCIAL);
    const writes = [...js.matchAll(/fetch\(([^,]+),\s*\{[\s\S]{0,200}?method:/g)].map((m) => m[1].trim());
    assert.ok(writes.length >= 3, "the page does write — otherwise this test proves nothing");
    const allowed = new Set(["API", "IG_SCRAPE", "IG_SNAP", "HOOKS", "HOOKS_MINE"]);
    for (const w of writes) assert.ok(allowed.has(w), "every write names one of the page's own endpoints; found " + w);
    assert.ok(writes.includes("HOOKS"), "the Hooks tab writes through /api/hooks");
    assert.ok(/const HOOKS = "\/api\/hooks"/.test(js), "the page talks to /api/hooks, which netlify.toml routes");
    assert.ok(/\[\[redirects\]\][\s\S]*?from = "\/api\/hooks"/.test(TOML), "…and that route exists");
    assert.ok(/\[functions\."hooks-api"\]\s*\n\s*timeout = 26/.test(TOML), "the writing calls need the raised timeout");
    assert.ok(/\[functions\."hooks-mine-scheduled"\]\s*\n\s*schedule = "30 5 \* \* \*"/.test(TOML),
      "mining runs at 05:30, AFTER the 05:00 scrape it reads and while Instagram's video links are still warm");
  }

  /* ============ 10. the tab is part of the page, not bolted on ============ */
  {
    const js = scriptOf(SOCIAL), css = styleOf(SOCIAL);
    assert.ok(/data-view="hooks"/.test(SOCIAL) && /id="v-hooks"/.test(SOCIAL), "a third tab and a third view");
    assert.ok(/\$\("v-hooks"\)\.hidden = v !== "hooks"/.test(js), "the toggle knows about it");
    assert.ok(/\$\("vtRight"\)\.hidden = v === "hooks"/.test(js),
      "sorting and 'only the ones that took off' belong to a grid of posts; the Hooks tab has none, so its toolbar goes with it");
    assert.ok(/v === "hooks" && !hkLib/.test(js), "the library is fetched when the tab is first opened, not on every page load");
    // the suite's one rule about colour: every value resolves to a token
    const hk = css.split("v177: HOOKS")[1] || "";
    assert.ok(hk.length > 500, "the Hooks styles are in the stylesheet, under their own heading");
    const literals = hk.match(/:\s*#[0-9a-f]{3,8}\b/gi) || [];
    assert.deepStrictEqual(literals, [], "no literal colours — every one is a var() from the theme block, so the tab restyles with the rest of the suite");
  }

  console.log("v177 hook library: OK");
})().catch((e) => { console.error(e); process.exit(1); });
