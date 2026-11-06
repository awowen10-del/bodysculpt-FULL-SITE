// v286 — competitors' reels are read from Apify's transcript.
//
// Instagram's video links only work for whoever asked for them, so the download fails with a
// 403 however fresh the link is. Tested on a real reel: the words came back in 28 seconds.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = (f) => path.join(__dirname, "..", f);
const src = fs.readFileSync(root("netlify/lib/hooks.js"), "utf8");

(async () => {
  const h = await import("file://" + root("netlify/lib/hooks.js"));
  assert.strictEqual(h.reelLink({ id: "DfU1ftPMrlJ" }), "https://www.instagram.com/reel/DfU1ftPMrlJ/");
  const r = h.readFromTranscript({ transcript: "What is your favourite meal?   Tacos.  Pizza.", caption: "food" });
  assert.strictEqual(r.spoken, "What is your favourite meal?", "the opening is the first sentence");
  assert.ok(/^Said in the reel: What is your/.test(r.watched), "the words are kept");
  assert.strictEqual(r.about, "food");
  const silent = h.readFromTranscript({ transcript: "", caption: "x" });
  assert.strictEqual(silent.watched, "", "a silent reel has nothing to read");
  assert.ok(/TRANSCRIPTS_PER_RUN = 6/.test(src), "capped, because it costs money per reel");
  assert.ok(/!cand\.isOwn && env\("APIFY_API_TOKEN"\)/.test(src), "only competitors use it");
  assert.ok(!/reelTest/.test(fs.readFileSync(root("netlify/functions/ig-scrape-background.js"), "utf8")), "the one-off test has gone");
  console.log("v286 passed");
})().catch((e) => { console.error(e); process.exit(1); });
