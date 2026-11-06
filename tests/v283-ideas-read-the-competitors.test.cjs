// v283 — the ideas engine reads the competitors directly.
//
// Ash: "all of the suggested posts are pulling in from 'my' stuff, and hardly anything from
// the competitors we're actually scraping." 37 of 44 were. Ideas only saw competitors through
// the hook library, which held one reel from 2024.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = (f) => path.join(__dirname, "..", f);
const read = (f) => fs.readFileSync(root(f), "utf8");

(async () => {
  const ideas = await import("file://" + root("netlify/lib/ideas.js"));
  const hooks = await import("file://" + root("netlify/lib/hooks.js"));
  const now = Date.parse("2026-11-06T12:00:00Z");
  const rec = (username, big, ts) => ({ username, fetchedAt: "2026-11-06T05:00:00Z", posts: [
    ...[100, 100, 100, 100, 100, 100].map((views, i) => ({ shortCode: username + i, views, likes: 1, comments: 0, videoUrl: "v", caption: "normal", timestamp: "2026-11-01T10:00:00Z" })),
    ...big.map((views, i) => ({ shortCode: username + "b" + i, views, likes: 1, comments: 0, videoUrl: "v", caption: "big " + i, timestamp: ts })),
  ] });

  const w = hooks.rivalWinners([rec("busy", [900, 800, 700, 600, 500], "2026-11-01T10:00:00Z"), rec("small", [300], "2026-11-01T10:00:00Z")], now);
  assert.strictEqual(w.filter((x) => x.username === "busy").length, 3, "capped per account");
  assert.ok(w.some((x) => x.username === "small"), "a smaller gym still gets a look in");
  assert.ok(!w.some((x) => x.caption === "normal"), "only what beat its own normal");
  assert.strictEqual(hooks.rivalWinners([rec("old", [900], "2026-01-01T10:00:00Z")], now).length, 0, "old winners are not news");

  const date = new Date(now);
  const withRivals = ideas.ideasPrompt({ hooks: [], ownPosts: [], recentTopics: [], now: date, rivals: w });
  assert.ok(/REELS THAT JUST TOOK OFF/.test(withRivals) && /@busy, 9\.0× their normal/.test(withRivals), "the winners reach the prompt");
  assert.ok(/At least HALF/.test(withRivals) && /No more than TWO/.test(withRivals), "the prompt sets the split");
  const without = ideas.ideasPrompt({ hooks: [], ownPosts: [], recentTopics: [], now: date });
  assert.ok(!/At least HALF/.test(without), "no scrape, no quota it could not meet");
  assert.ok(/rivals,/.test(read("netlify/lib/ideas.js")), "gather hands them over");
  console.log("v283 passed");
})().catch((e) => { console.error(e); process.exit(1); });
