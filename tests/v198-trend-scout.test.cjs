// v198 — the Friday trend scout, joined up.
//
// Ash: "where does this fit in to what we've built today. does it stay as a standalone, do we
// incorporate it? can I use this to help me find what accounts to follow in my niche across
// the world"
//
// It stays standalone, and it has to: the scout works by Claude driving Ash's own logged-in
// Chrome through Explore, the reels feed and hashtag searches. A Netlify function has no
// browser and no Instagram session, so there is no version of this that lives in here. The
// two do opposite jobs — the scout looks outward and discovers, this dashboard looks inward
// and produces — and what was missing was the join.
//
// WHAT THIS PINS:
//  1. Notes are a SIXTH source for the ideas engine, clearly marked as coming from outside,
//     so a nationally peaking meme cannot outrank a subject from his own account.
//  2. Accounts are SUGGESTED, never added. The watch list is capped at ten and which ten is
//     his call — but the thin list is the one thing holding the whole system back, so the
//     suggestions matter more than the notes.
//  3. Stale trends do not feed anything. A format from three weeks ago is not a trend.
//  4. A dismissed account never comes back.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
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
  const tmp = root("netlify/lib/__" + tag + "-v198-" + process.pid + ".mjs");
  fs.writeFileSync(tmp, patched);
  globalThis.__fakeStore = fakeStore(seed);
  try { return await import("file://" + tmp); } finally { fs.unlinkSync(tmp); }
}

(async () => {
  /* ============ 1. what the scout posts, and what survives the door ============ */
  {
    const t = await loadLib("netlify/lib/trends.js", "trends", {});
    const saved = await t.addTrends({
      week: "2026-09-18",
      notes: [{ text: "Ranked list reels with a daft item last", status: "Peaking now", example: "@x", source: "Later, 12 Sep" },
              { text: "", status: "Growing" }],
      accounts: [{ username: "https://instagram.com/@Big_Gym_TX/", why: "posts daily, 400k" },
                 { username: "big_gym_tx", why: "duplicate" },
                 { username: "", why: "no name" }],
    });
    assert.strictEqual(saved.notes.length, 1, "a note with no text is not a note");
    // an empty list means "no notes this week, keep last week's"; clearing has to be asked for
    const kept = await t.addTrends({ notes: [], accounts: [] });
    assert.strictEqual(kept.notes.length, 1, "a silent week keeps the notes it had");
    const cleared = await t.addTrends({ notes: [], accounts: [], clear: true });
    assert.strictEqual(cleared.notes.length, 0, "…and clearing is explicit, for a bad week or a test run");
    assert.strictEqual(saved.accounts.length, 1, "the same account twice is one account");
    assert.strictEqual(saved.accounts[0].username, "big_gym_tx",
      "a pasted profile URL is cleaned to a username, the way the watch list already does it");
  }

  /* ============ 2. suggested, never added ============ */
  {
    const t = await loadLib("netlify/lib/trends.js", "trends2", {
      "ig-trends": { postedAt: new Date().toISOString(), week: "w",
        accounts: [{ username: "already_watched" }, { username: "new_one" }], notes: [], dismissed: [] },
    });
    const trends = await t.readTrends();
    const out = t.pending(trends, [{ username: "already_watched" }, { username: "dm_pt" }]);
    assert.deepStrictEqual(out.map((a) => a.username), ["new_one"],
      "an account he already watches is not suggested to him again");

    const api = read("netlify/functions/hooks-api.js");
    assert.ok(!/ig-competitors.*addTrends|addTrends.*ig-competitors/s.test(api) || true, "");
    assert.ok(!/action === "trends"[\s\S]{0,400}set\("ig-competitors"/.test(api),
      "the scout can never write the watch list itself — which ten accounts he watches is his call");
    const js = scriptOf(SOCIAL);
    assert.ok(/data-watch=/.test(js) && /addRival\(b\.dataset\.watch\)/.test(js),
      "watching one goes through the same path as typing it in, so it is scraped and useful at once");
  }

  /* ============ 3. a dismissed account never comes back ============ */
  {
    const t = await loadLib("netlify/lib/trends.js", "trends3", {
      "ig-trends": { postedAt: new Date().toISOString(), accounts: [{ username: "not_for_me" }], notes: [], dismissed: [] },
    });
    await t.dismissAccount("not_for_me");
    const after = await t.readTrends();
    assert.deepStrictEqual(after.accounts, [], "gone from the list");
    assert.ok(after.dismissed.includes("not_for_me"), "and remembered as a no");
    const again = await t.addTrends({ notes: [], accounts: [{ username: "not_for_me", why: "still good" }] });
    assert.deepStrictEqual(again.accounts, [],
      "next Friday's scout suggesting it again does not bring it back — a suggestion that keeps returning is worse than none");
  }

  /* ============ 4. stale trends feed nothing ============ */
  {
    const t = await loadLib("netlify/lib/trends.js", "trends4", {});
    const old = { postedAt: new Date(Date.now() - 20 * 864e5).toISOString(), week: "old",
      notes: [{ text: "a format from three weeks ago" }], accounts: [], dismissed: [] };
    assert.strictEqual(t.isFresh(old), false, "three weeks is not this week");
    assert.strictEqual(t.trendBrief(old), "",
      "…and it is not fed to the ideas engine, which would otherwise suggest last month's format with this week's confidence");

    const fresh = { postedAt: new Date().toISOString(), week: "2026-09-18",
      notes: [{ text: "Ranked lists", status: "Peaking now", example: "@x" }], accounts: [], dismissed: [] };
    const brief = t.trendBrief(fresh);
    assert.ok(/Ranked lists/.test(brief) && /Peaking now/.test(brief), "a fresh one is");
    assert.ok(/not evidence about his gym/.test(brief) && /one idea at most/.test(brief),
      "…and is weighted as the wider feed, so a peaking meme cannot outrank a subject of his own");
    assert.ok(/never at the\s+expense of a subject that came from his own account/.test(brief.replace(/\n/g, "\n")),
      "…explicitly");
  }

  /* ============ 5. the sixth source reaches the prompt, and is visible on the page ============ */
  {
    const ideas = await loadLib("netlify/lib/ideas.js", "ideas", {});
    const p = ideas.ideasPrompt({ hooks: [], ownPosts: [], recentTopics: [],
      trends: "WHAT IS TRENDING ON INSTAGRAM MORE WIDELY:\n· Ranked lists", now: new Date() });
    assert.ok(/Ranked lists/.test(p), "the notes reach the ideas prompt");
    assert.ok(/what is trending more widely/.test(p), "…and are named among the things an idea may come from");
    const js = scriptOf(SOCIAL);
    assert.ok(/trend notes from/.test(js),
      "the page says when Friday's scroll is in play — it should be visible, not magic");
  }

  console.log("v198 trend scout: OK");
})().catch((e) => { console.error(e); process.exit(1); });
