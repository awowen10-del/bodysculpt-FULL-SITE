// v282 — the competitor scrape runs twice a week.
//
// Every night used up Apify's free $5 a month by 28 Oct, and then nothing updated. Ash agreed
// to twice a week. The miner still runs nightly because it also writes the day's ideas, so
// it must leave an old scrape alone: its video links have expired, and an expired link puts
// a reel on the skip list for good.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = (f) => path.join(__dirname, "..", f);
const read = (f) => fs.readFileSync(root(f), "utf8");

(async () => {
  const toml = read("netlify.toml");
  assert.ok(/\[functions\."ig-scrape-scheduled"\]\n  schedule = "0 5 \* \* 1,4"/.test(toml), "scrape on Mondays and Thursdays");
  assert.ok(/\[functions\."hooks-mine-scheduled"\]\n  schedule = "30 5 \* \* \*"/.test(toml), "miner and ideas still nightly");

  const patched = read("netlify/lib/hooks.js").replace(/^import \{ getStore \} from "@netlify\/blobs";$/m,
    "const getStore = () => globalThis.__fakeStore;");
  const tmp = root("netlify/lib/__hooks-v282-" + process.pid + ".mjs");
  fs.writeFileSync(tmp, patched);
  const now = Date.now(), iso = (h) => new Date(now - h * 36e5).toISOString();
  const posts = [1000, 1000, 1000, 1000, 9000].map((views, i) => ({ shortCode: "p" + i, views, likes: 1, comments: 1, videoUrl: "https://v/" + i }));
  const blobs = {
    "ig-competitors": [{ username: "fresh" }, { username: "old" }],
    "ig-scrape-fresh": { username: "fresh", fetchedAt: iso(1), posts },
    "ig-scrape-old": { username: "old", fetchedAt: iso(30), posts: posts.map((p) => ({ ...p, shortCode: "o" + p.shortCode })) },
  };
  globalThis.__fakeStore = { async get(k) { return blobs[k] === undefined ? null : blobs[k]; } };
  try {
    const h = await import("file://" + tmp);
    assert.strictEqual(h.linksExpired({ fetchedAt: iso(13) }), true, "13 hours old has expired");
    assert.strictEqual(h.linksExpired({ fetchedAt: iso(1) }), false, "an hour old is fine");
    assert.strictEqual(h.linksExpired(null), false, "no scrape is not an expired one");
    const ids = (await h.candidates({ hooks: [], skipped: [] })).map((c) => c.id);
    assert.deepStrictEqual(ids, ["p4"], "only the fresh scrape's flame is a candidate");
    console.log("v282 passed");
  } finally { fs.unlinkSync(tmp); }
})().catch((e) => { console.error(e); process.exit(1); });
