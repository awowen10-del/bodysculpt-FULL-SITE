// v169 — Content.
//
// Ash: "change our own Instagram section to 'Content' where it shows us all of our best
// performing content — basically copy everything from the content-dashboard and put it in
// our own dashboard, including the ability to see competitors."
//
// The content-dashboard template (tenfoldmarc) was cloned but never connected — every key
// in it a placeholder — so there was nothing to move, only a design to take from. What
// this page did not have and now does: the standouts pulled to the top (Best performers),
// four more sort orders (views / likes / saves / shares) and FOLLOWER GROWTH, which needs
// a number Instagram does not keep for you: yesterday's count. netlify/functions/
// ig-snapshot.js writes it down once a day (and whenever the page is opened), under one
// key, and the page draws the last 30 days of change. Competitors were already here, on
// the official API, and stay.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const SOCIAL = read("social.html");
const scriptOf = (src) => src.slice(src.lastIndexOf("<script>") + 8, src.lastIndexOf("</script>"));
const FILES = ["index.html", "monthly.html", "quarterly.html", "finances.html", "daily.html", "social.html", "ads.html", "schedule.html"];

function fakeStore(seed) {
  const m = new Map(Object.entries(seed || {}));
  return { _m: m, async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; }, async set(k, v) { m.set(k, v); } };
}
async function loadSnapshot() {
  // v173: the recording moved to netlify/lib/followers.js; ig-followers.js is what the page calls
  const tmpDir = path.join(os.tmpdir(), "ig-followers-v169-" + process.pid);
  fs.mkdirSync(path.join(tmpDir, "lib"), { recursive: true }); fs.mkdirSync(path.join(tmpDir, "functions"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "lib", "followers.js"), read("netlify/lib/followers.js").replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => globalThis.__fakeStore;"));
  fs.writeFileSync(path.join(tmpDir, "functions", "ig-followers.js"), read("netlify/functions/ig-followers.js"));
  const mod = await import("file://" + path.join(tmpDir, "functions", "ig-followers.js"));
  return mod.default;
}

(async () => {
  /* ================= 0. the stamp ================= */
  const text = "build v174 · the-sprite-cannot-be-inflated";
  for (const f of ["monthly.html", "index.html", "finances.html", "daily.html", "social.html", "ads.html"]) {
    assert.ok(read(f).includes(text), f + " carries the stamp");
  }

  /* ================= 1. the rail says Content, everywhere ================= */
  for (const f of FILES) {
    assert.ok(/<a href="\/social.html" class="sn-link(?: active)?" title="Content"><svg class="ic"><use href="#ic-camera"\/><\/svg><span class="sn-lbl">Content<\/span><\/a>/.test(read(f)),
      f + ": the Instagram link reads Content");
    assert.ok(!/sn-lbl">Instagram</.test(read(f)), f + ": …and nothing reads Instagram in the rail");
  }
  assert.ok(/<title>Bodysculpt Content<\/title>/.test(SOCIAL), "the page is titled Content");

  /* ================= 2. the page: sort orders, standouts, growth ================= */
  {
    const js = scriptOf(SOCIAL);
    const opts = /<select id="sortSel">([\s\S]*?)<\/select>/.exec(SOCIAL)[1];
    assert.deepStrictEqual([...opts.matchAll(/value="([a-z]+)"/g)].map((m) => m[1]),
      ["new", "er", "reach", "views", "likes", "saves", "shares"], "seven sort orders, the four new ones after the three old");
    assert.ok(/const SORT_KEYS = \{ views: "views", likes: "likes", saves: "saves", shares: "shares" \};/.test(js), "the four new orders are one table");
    assert.ok(/\(b\[k\] != null \? b\[k\] : b\.likes\)/.test(js), "…and a private number falls back to likes on a competitor's post");
    // best performers: the three that reached the most, by the number the account has
    assert.ok(/const reachOf = \(p\) => \(p\.views != null \? p\.views : p\.reach != null \? p\.reach : p\.likes\) \|\| 0;/.test(js),
      "reach is views for a reel, reach otherwise, likes as a last resort");
    assert.ok(/sort\(\(a, b\) => reachOf\(b\) - reachOf\(a\)\)\.slice\(0, 3\)/.test(js), "the best three, by that");
    // v171: Ash, with a screenshot of one reel filling the page: "why is this reel so big?"
    // .post-im is position:absolute inside a tile; a Best performers thumbnail that borrowed
    // the class had no positioned parent and filled the page. It has its own class only.
    assert.ok(/<img class="best-img" src=/.test(js) && !/class="best-img post-im"/.test(js), "a best-performer thumbnail never carries .post-im");
    assert.ok(/img\.classList\.contains\("best-img"\)/.test(js), "…and still hides itself when the picture link has gone stale");
    assert.ok(/<section class="card ct-best" id="bestCard" hidden>/.test(SOCIAL) && /<section class="card ct-growth" id="growthCard" hidden>/.test(SOCIAL),
      "the two cards start hidden and appear with the account");
    assert.ok(/\$\("bestCard"\)\.hidden = true; \$\("growthCard"\)\.hidden = true;/.test(js), "…and hide again on a setup/error state");
    // growth: recorded on every visit, then read; drawn as daily change
    assert.ok(/const IG_SNAP = "\/\.netlify\/functions\/ig-followers";/.test(js), "the page calls ig-followers — NOT the scheduled function, which Netlify 403s (v173)");
    assert.ok(/import \{ recordToday \} from "\.\.\/lib\/followers\.js";/.test(read("netlify/functions/ig-snapshot.js")), "the schedule records through the same lib");
    assert.ok(/fetch\(IG_SNAP, \{ method: "POST" \}\)/.test(js), "opening the page records today's count");
    assert.ok(/const changes = days\.slice\(1\)\.map\(\(d, i\) => \(\{ date: d\.date, v: d\.followers - days\[i\]\.followers \}\)\);/.test(js),
      "the bars are the daily CHANGE");
    assert.ok(/if \(days\.length < 2\) return html \+ '<p class="muted">One day on record so far/.test(js), "one day on record draws no chart, and says why");
    assert.ok(/Recording starts the first time this page is opened/.test(js), "no record at all says so");
    // the chart is drawn from tokens, not literal colour
    const style = SOCIAL.slice(SOCIAL.indexOf("<style>"), SOCIAL.indexOf("</style>"));
    assert.ok(/\.gr-bar\{fill:var\(--orange\)/.test(style), "bars take the brand token");
    assert.strictEqual(style.slice(style.indexOf("v169: CONTENT"), style.indexOf("v136: SOCIAL")).match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g), null, "no literal colour in the new block");
  }

  /* ================= 3. ig-snapshot, run ================= */
  {
    const handler = await loadSnapshot();
    const savedFetch = globalThis.fetch, savedEnv = { ...process.env };
    const calls = [];
    globalThis.fetch = async (u) => { calls.push(String(u)); return { ok: true, status: 200, json: async () => ({ followers_count: 4229, media_count: 612 }) }; };
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    try {
      // not connected: a 200 with a message, nothing written, nothing called
      delete process.env.IG_ACCESS_TOKEN; delete process.env.IG_USER_ID;
      globalThis.__fakeStore = fakeStore();
      let r = await handler(new Request("https://x/f", { method: "POST" }));
      let b = await r.json();
      assert.strictEqual(r.status, 200); assert.strictEqual(b.configured, false); assert.strictEqual(globalThis.__fakeStore._m.size, 0);
      assert.strictEqual(calls.length, 0, "…and Instagram is not called");
      // GET with nothing on record
      r = await handler(new Request("https://x/f", { method: "GET" })); b = await r.json();
      assert.deepStrictEqual(b.days, []); assert.strictEqual(b.current, null); assert.strictEqual(b.weeklyGrowth, null);
      // connected: POST records today, once
      process.env.IG_ACCESS_TOKEN = "tok"; process.env.IG_USER_ID = "17841400000000000";
      r = await handler(new Request("https://x/f", { method: "POST" })); b = await r.json();
      assert.strictEqual(b.recorded, today, "today's date, in the gym's timezone");
      assert.strictEqual(b.current, 4229);
      assert.deepStrictEqual([...globalThis.__fakeStore._m.keys()], ["ig-followers"], "one key, its own");
      assert.ok(/fields=followers_count%2Cmedia_count/.test(calls[0]) && /access_token=tok/.test(calls[0]), "one small Graph call");
      r = await handler(new Request("https://x/f", { method: "POST" })); b = await r.json();
      assert.strictEqual(b.days.length, 1, "recording twice in a day is one entry");
      // growth maths over a planted history
      const map = {}; const d0 = new Date(today + "T00:00:00Z");
      for (let i = 40; i >= 1; i--) { const d = new Date(d0); d.setUTCDate(d.getUTCDate() - i); map[d.toISOString().slice(0, 10)] = { followers: 4000 + (40 - i) * 5, media: 600 }; }
      map[today] = { followers: 4229, media: 612 };
      globalThis.__fakeStore = fakeStore({ "ig-followers": JSON.stringify(map) });
      r = await handler(new Request("https://x/f", { method: "GET" })); b = await r.json();
      assert.strictEqual(b.days.length, 41);
      assert.strictEqual(b.weeklyGrowth, 4229 - (4000 + (40 - 7) * 5), "growth over 7 days = today minus the entry 7 days back");
      assert.strictEqual(b.monthlyGrowth, 4229 - (4000 + (40 - 30) * 5), "…and over 30");
      // Instagram failing is a sentence, and the history still comes back
      globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Error validating access token" } }) });
      r = await handler(new Request("https://x/f", { method: "POST" })); b = await r.json();
      assert.strictEqual(r.status, 200); assert.strictEqual(b.ok, false); assert.ok(/access token/.test(b.message)); assert.strictEqual(b.days.length, 41);
    } finally {
      globalThis.fetch = savedFetch;
      for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
      Object.assign(process.env, savedEnv);
      delete globalThis.__fakeStore;
    }
    assert.ok(/\[functions\."ig-snapshot"\]\n  schedule = "30 4 \* \* \*"/.test(read("netlify.toml")), "it runs itself daily at 04:30 UTC");
  }

  console.log("v169-content.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
