// v172 — competitors' views.
//
// Ash: "how does the competition work? It's clearly possible." — and, on the answer:
// "Yes, let's cook this. Copy their setup, I like it."
//
// The content-dashboard template's second competitor source: Apify's Instagram Scraper
// reads a competitor's PUBLIC page and returns the play count printed on each reel, which
// the official API never hands over for someone else's account. So v136's "no tool at any
// price" was wrong about views (it stays right about reach, saves and shares), and the
// feed's comment and SOCIAL-SETUP.md now say so.
//
// ig-scrape-background runs it (one account per run, as the template notes — several at
// once lose the play counts), keeps the result under ig-scrape-<username>, and clears the
// feed's cache of that account so the next read merges the views in by short code. When
// four or more posts have views, the flame is judged on views against the account's
// median; otherwise on engagement as before. Nightly at 05:00 UTC, and on Refresh.
//
// Guards, run here: a username off the watch list is never scraped (a scrape costs money
// and the site has no login); one account is not scraped twice within an hour; { all }
// needs the shared secret; no token, no call.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const SOCIAL = read("social.html");
const scriptOf = (src) => src.slice(src.lastIndexOf("<script>") + 8, src.lastIndexOf("</script>"));

function fakeStore(seed) {
  const m = new Map(Object.entries(seed || {}));
  return { _m: m, async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; }, async set(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
async function loadFn(file, tag) {
  const src = read("netlify/functions/" + file).replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => globalThis.__fakeStore;");
  const tmp = path.join(os.tmpdir(), tag + "-v172-" + process.pid + ".mjs");
  fs.writeFileSync(tmp, src);
  const mod = await import("file://" + tmp);
  fs.unlinkSync(tmp);
  return mod.default;
}
const post = (code, views, likes) => ({ shortCode: code, url: "https://www.instagram.com/reel/" + code + "/", type: "Video", timestamp: "2026-09-01T10:00:00.000Z", likesCount: likes, commentsCount: 3, videoPlayCount: views, ownerUsername: "rival_gym" });

(async () => {
  /* ================= 0. the stamp ================= */
  const text = "build v173 · the-page-may-not-call-the-schedule";
  for (const f of ["monthly.html", "index.html", "finances.html", "daily.html", "social.html", "ads.html", "schedule.html"]) {
    assert.ok(read(f).includes(text), f + " carries the stamp");
  }

  /* ================= 1. the scrape, run ================= */
  {
    const handler = await loadFn("ig-scrape-background.js", "scrape");
    const savedFetch = globalThis.fetch, savedEnv = { ...process.env };
    const calls = [];
    globalThis.fetch = async (u, o) => {
      calls.push({ url: String(u), body: o && o.body ? JSON.parse(o.body) : null });
      return { ok: true, status: 200, json: async () => [post("AAA", 12000, 300), post("BBB", 900, 40), { ...post("CCC", null, 20), type: "Image", videoPlayCount: undefined }, { ...post("ZZZ", 1, 1), ownerUsername: "someone_else" }] };
    };
    const call = (body, headers) => handler(new Request("https://x/f", { method: "POST", headers: { "Content-Type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) }));
    const watched = JSON.stringify([{ username: "rival_gym", label: "Rival" }, { username: "other_gym", label: "Other" }]);
    try {
      // no token: nothing happens
      delete process.env.APIFY_API_TOKEN; delete process.env.SYNC_TRIGGER_SECRET;
      globalThis.__fakeStore = fakeStore({ "ig-competitors": watched });
      await call({ username: "rival_gym" });
      assert.strictEqual(calls.length, 0, "no token, no call"); assert.strictEqual(globalThis.__fakeStore._m.size, 1, "…and nothing written");
      process.env.APIFY_API_TOKEN = "apify-tok";
      // a username that is not watched is never scraped, however it is spelled
      await call({ username: "https://www.instagram.com/stranger/" });
      assert.strictEqual(calls.length, 0, "an unwatched account is never scraped");
      // a watched one is: one Apify run, one account, fifteen posts
      globalThis.__fakeStore = fakeStore({ "ig-competitors": watched, "ig-cache-u-rival_gym": JSON.stringify({ stale: true }) });
      await call({ username: "@rival_gym" });
      assert.strictEqual(calls.length, 1, "one Apify run");
      assert.ok(/apify~instagram-scraper\/run-sync-get-dataset-items\?token=apify-tok$/.test(calls[0].url), "…the Instagram Scraper actor, synchronous");
      assert.deepStrictEqual(calls[0].body, { directUrls: ["https://www.instagram.com/rival_gym/"], resultsType: "posts", resultsLimit: 15 }, "…one account, fifteen posts");
      assert.deepStrictEqual([...globalThis.__fakeStore._m.keys()].sort(), ["ig-competitors", "ig-scrape-rival_gym"], "its own key written, and the feed's cache of that account cleared");
      const rec = JSON.parse(globalThis.__fakeStore._m.get("ig-scrape-rival_gym"));
      assert.deepStrictEqual(rec.posts.map((p) => [p.shortCode, p.views, p.likes]), [["AAA", 12000, 300], ["BBB", 900, 40], ["CCC", null, 20]], "the play count per reel; a photo has none; another account's post is dropped");
      // too soon: an hour must pass before the same account is read again
      await call({ username: "rival_gym" });
      assert.strictEqual(calls.length, 1, "not scraped twice within an hour");
      // { all } needs the secret
      await call({ all: true });
      assert.strictEqual(calls.length, 1, "{ all } without the secret does nothing");
      process.env.SYNC_TRIGGER_SECRET = "s3cret";
      await call({ all: true }, { "x-scrape-trigger": "wrong" });
      assert.strictEqual(calls.length, 1, "…nor with the wrong one");
      await call({ all: true }, { "x-scrape-trigger": "s3cret" });
      assert.strictEqual(calls.length, 3, "the nightly run reads every watched account, and ignores the hour rule");
      assert.deepStrictEqual(calls.slice(1).map((c) => c.body.directUrls[0]), ["https://www.instagram.com/rival_gym/", "https://www.instagram.com/other_gym/"]);
      // Apify failing is logged, not thrown, and the old record stays
      globalThis.fetch = async () => ({ ok: false, status: 402, json: async () => ({ error: { message: "Monthly usage hard limit exceeded" } }) });
      globalThis.__fakeStore = fakeStore({ "ig-competitors": watched });
      await call({ username: "other_gym" });
      assert.strictEqual(globalThis.__fakeStore._m.size, 1, "a failed run writes nothing");
    } finally {
      globalThis.fetch = savedFetch;
      for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
      Object.assign(process.env, savedEnv);
      delete globalThis.__fakeStore;
    }
    const toml = read("netlify.toml");
    assert.ok(/\[functions\."ig-scrape-scheduled"\]\n  schedule = "0 5 \* \* \*"/.test(toml), "nightly at 05:00 UTC");
    assert.ok(/x-scrape-trigger": secret/.test(read("netlify/functions/ig-scrape-scheduled.js")) && /all: true/.test(read("netlify/functions/ig-scrape-scheduled.js")), "the trigger carries the secret and asks for all");
  }

  /* ================= 2. the feed merges the views in, and judges the flame on them ================= */
  {
    const handler = await loadFn("instagram-feed.js", "feed");
    const savedFetch = globalThis.fetch, savedEnv = { ...process.env };
    const media = ["AAA", "BBB", "CCC", "DDD", "EEE"].map((c, i) => ({ id: "m" + i, caption: "Post " + c, media_type: "VIDEO", permalink: "https://www.instagram.com/reel/" + c + "/", timestamp: "2026-09-0" + (i + 1) + "T10:00:00+0000", like_count: 50, comments_count: 5 }));
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ business_discovery: { username: "rival_gym", name: "Rival", followers_count: 10000, media_count: 300, media: { data: media } } }) });
    try {
      process.env.IG_ACCESS_TOKEN = "t"; process.env.IG_USER_ID = "17841400000000000";
      // no scrape on record: as before — views a dash, flame on engagement (all equal, so none)
      globalThis.__fakeStore = fakeStore();
      let r = await handler(new Request("https://x/f?mode=competitor&username=rival_gym")); let b = await r.json();
      assert.strictEqual(b.account.viewsBasis, ""); assert.strictEqual(b.outlierBasis, "er");
      assert.ok(b.posts.every((p) => p.views === null), "no scrape: views stay a dash");
      // a scrape on record: views merged by short code; the flame on views, 2× the median
      const scrape = { username: "rival_gym", fetchedAt: "2026-09-15T05:00:00Z", posts: [
        { shortCode: "AAA", views: 20000, likes: 300, comments: 3, shares: 12 }, { shortCode: "BBB", views: 1000, likes: 40, comments: 3, shares: null },
        { shortCode: "CCC", views: 1200, likes: 40, comments: 3, shares: null }, { shortCode: "DDD", views: 900, likes: 40, comments: 3, shares: null }] };
      globalThis.__fakeStore = fakeStore({ "ig-scrape-rival_gym": JSON.stringify(scrape) });
      r = await handler(new Request("https://x/f?mode=competitor&username=rival_gym")); b = await r.json();
      assert.strictEqual(b.account.viewsBasis, "scraped"); assert.strictEqual(b.account.scrapedAt, "2026-09-15T05:00:00Z");
      assert.deepStrictEqual(b.posts.map((p) => p.views), [20000, 1000, 1200, 900, null], "views by short code; the fifth reel was not in the scrape");
      assert.strictEqual(b.posts[0].shares, 12, "shares too, where the scrape had them");
      assert.strictEqual(b.outlierBasis, "views"); assert.strictEqual(b.median, 1100, "the median play count (1000, 1200 → 1100)");
      assert.deepStrictEqual(b.posts.map((p) => p.outlier), [true, false, false, false, false], "one reel did 2× the account's normal views");
      assert.ok(Math.abs(b.posts[0].vsMedian - 20000 / 1100) < 1e-9);
      assert.ok(b.posts[0].er > 0 && b.posts[0].erBasis === "followers", "engagement is still likes + comments ÷ followers — the scrape did not change it");
      // fewer than four with views: back to engagement
      globalThis.__fakeStore = fakeStore({ "ig-scrape-rival_gym": JSON.stringify({ ...scrape, posts: scrape.posts.slice(0, 2) }) });
      r = await handler(new Request("https://x/f?mode=competitor&username=rival_gym")); b = await r.json();
      assert.strictEqual(b.outlierBasis, "er", "three or fewer reels with views is too few to judge by views");
      assert.strictEqual(b.posts[0].views, 20000, "…though the views still show");
    } finally {
      globalThis.fetch = savedFetch;
      for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
      Object.assign(process.env, savedEnv);
      delete globalThis.__fakeStore;
    }
  }

  /* ================= 3. the page ================= */
  {
    const js = scriptOf(SOCIAL);
    assert.ok(/const IG_SCRAPE = "\/\.netlify\/functions\/ig-scrape-background";/.test(js), "the scrape's address is fixed");
    assert.ok(/if \(force\) \{[\s\S]*?fetch\(IG_SCRAPE, \{ method: "POST"[\s\S]*?body: JSON\.stringify\(\{ username \}\)/.test(js), "Refresh asks for a fresh read of that one account");
    assert.ok(/setTimeout\(async \(\) => \{[\s\S]*?\}, 35000\);/.test(js), "…and reads the account again half a minute later");
    assert.ok(/"Average views", nfmt\(Math\.round\(avg\(withViews, \(p\) => p\.views\)/.test(js), "the stats show average views when the scrape has them");
    assert.ok(/statTile\("", "Best post"/.test(js), "…and the old best-post tile otherwise");
    assert.ok(/rivalViews: \["Average views"/.test(js), "the new tile explains itself");
    assert.ok(/on views where there are views, on engagement otherwise/.test(SOCIAL), "the note under the toggle says which the flame is judged on");
    assert.ok(!/at any price/.test(SOCIAL), "the old 'at any price' claim is gone from the page");
    const doc = read("SOCIAL-SETUP.md");
    assert.ok(/APIFY_API_TOKEN/.test(doc) && /Views are the exception/.test(doc) && !/neither can any other\ntool, at any price/.test(doc), "the setup doc is corrected and has Part 5");
  }

  console.log("v172-competitor-views.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
