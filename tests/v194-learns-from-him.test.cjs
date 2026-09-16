// v194 — learning from what he picks, and from what actually worked.
//
// Ash, after reading back through the bundle he was originally sent: "are we missing anything
// from this folder/skills that would be unreal for us?"
//
// Most of it we had passed. One idea we had not taken, and it was its best: it logged every
// session — the hooks offered, the one chosen, what was changed — and read it back next time,
// on the principle that the user's real picks beat the model's assumptions. Without it, a man
// who chooses "Behind the scenes" eleven times running and never once takes a myth bust goes
// on being offered myth busts for ever.
//
// We can beat the bundle at its own idea, because we have his numbers. He posts through
// Zernio, the reel lands in his feed, and instagram-feed already reads its reach and views.
//
// AND: his voice profile ends in six specific, yes-or-no rules, and until now nothing ever sat
// that test. Generating a rubric and never marking against it is the kind of thing that looks
// thorough and changes nothing.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = (f) => path.join(__dirname, "..", f);
const read = (f) => fs.readFileSync(root(f), "utf8");
const SOCIAL = read("social.html");
const scriptOf = (src) => src.slice(src.lastIndexOf("<script>") + 8, src.lastIndexOf("</script>"));

(async () => {
  const learn = await import("file://" + root("netlify/lib/learn.js"));

  /* ============ 1. a script is tied to the reel it became ============ */
  {
    const scripts = [
      { id: "a", status: "posted", lead: "x", caption: "Nobody tells you what happens when you walk in.\n\nmore words" },
      { id: "b", status: "draft",  lead: "y", caption: "Nobody tells you what happens when you walk in." },
      { id: "c", status: "posted", lead: "z", caption: "Something completely unrelated about protein timing." },
    ];
    const posts = [
      { caption: "Nobody tells you what happens when you walk in!! 💪", views: 8200, permalink: "p/AAA" },
      { caption: "A totally different post about the weather", views: 100, permalink: "p/BBB" },
    ];
    const out = learn.matchPerformance(scripts, posts);
    assert.strictEqual(out[0].postViews, 8200, "a posted script finds its reel despite emoji and punctuation — captions get tweaked on the way out");
    assert.strictEqual(out[0].postUrl, "p/AAA");
    assert.strictEqual(out[1].postViews, undefined, "a DRAFT has not been anywhere and is never matched");
    assert.strictEqual(out[2].postViews, undefined,
      "a posted script with no convincing match stays unmatched — a wrong match would teach the library the opposite of the truth");
    assert.deepStrictEqual(learn.matchPerformance(null, null), [], "nothing in, nothing out");
  }

  /* ============ 2. what he goes for, and what he never takes ============ */
  {
    assert.strictEqual(learn.preferenceBrief([{ type: "A" }, { type: "A" }]), "",
      "two picks is not a taste, it is two picks");

    const scripts = [];
    for (let i = 0; i < 5; i++) scripts.push({
      type: "Behind the scenes", status: "posted", lead: "lead " + i, postViews: 1000 * (i + 1),
      shown: [{ type: "Behind the scenes" }, { type: "Myth bust" }, { type: "Contrarian take" }],
    });
    const brief = learn.preferenceBrief(scripts);
    assert.ok(/He usually picks: Behind the scenes \(5\)/.test(brief), "what he reaches for");
    assert.ok(/never once chosen/.test(brief) && /Myth bust/.test(brief),
      "offered repeatedly and never taken is a real signal, not a gap in the data");
    assert.ok(/did best/.test(brief) && /5000 views/.test(brief), "and what those reels then did");
    assert.ok(/not a rule/.test(brief) && /give him the range/.test(brief),
      "…given as evidence about taste, never as an instruction to repeat himself into a rut");

    const binned = learn.preferenceBrief(scripts.concat([{ type: "Myth bust", status: "binned" }]));
    assert.ok(!/Myth bust \(/.test(binned), "a binned script is not a preference");
  }

  /* ============ 3. the rules his own profile set are finally marked against ============ */
  {
    const profile = "HOW HE COMES ACROSS\nDry.\n\nCAPTIONS\nZero hashtags.\n\nCHECKS\n1. No hashtags at all.\n2. Nothing in capitals.\n\nTHE VIEWER\nOverhearing.";
    const p = learn.checkPrompt("HOOK: WHAT BULKY TAKES\n\nbody\n\n#warrington", profile, ["game changer"]);
    assert.ok(/1\. No hashtags at all/.test(p), "the CHECKS section is pulled out of the profile and handed over as the rules");
    assert.ok(!/HOW HE COMES ACROSS/.test(p), "…and only that section — the rest of the profile is not the test");
    assert.ok(/game changer/.test(p), "the banned phrases come too");
    assert.ok(/It's not X\. It's Y\./.test(p) && /lumpier/.test(p),
      "and the structural tells the bundle called a humanizer pass");
    assert.ok(/changing NOTHING else/.test(p), "a fix is a fix, not a rewrite");

    const ok = learn.parseCheck("---FAILED---\nnone\n---FIXED---\nthe draft\n");
    assert.deepStrictEqual(ok.failed, [], "a clean draft fails nothing");
    const bad = learn.parseCheck("---FAILED---\n- Rule 1: uses #warrington\n2. Rule 2: 'WHAT BULKY TAKES' is in capitals\n---FIXED---\nHOOK: What bulky takes\n");
    assert.deepStrictEqual(bad.failed, ["Rule 1: uses #warrington", "Rule 2: 'WHAT BULKY TAKES' is in capitals"],
      "bullets and numbering stripped, the failures kept");
    assert.ok(/What bulky takes/.test(bad.fixed), "and the tightened version comes back");
    assert.deepStrictEqual(learn.parseCheck("gibberish").failed, [], "junk in, nothing claimed");
  }

  /* ============ 4. the page keeps what it showed him, and marks the draft ============ */
  {
    const js = scriptOf(SOCIAL);
    assert.ok(/hkScript\.shown = hkOptions\.map/.test(js),
      "the seven he passed over are kept — which archetypes he declines says as much as the one he takes");
    assert.ok(/checkScript\(\);/.test(js) && /action: "check"/.test(js), "the draft is marked after it arrives");
    assert.ok(/hkChecking/.test(js) && /Marking it against your own rules/.test(js),
      "…visibly, so he watches it tighten rather than waiting longer for a clean one");
    assert.ok(/hkScript\.id === forScript/.test(js),
      "a check that comes back after he has moved on is discarded, not applied to the wrong script");
    assert.ok(/hk-perf/.test(js) && /postViews/.test(js), "and what a posted reel did shows on its row");
    const api = read("netlify/functions/hooks-api.js");
    assert.ok(/action === "ban" \|\| action === "unban"/.test(api), "he can kill a phrase himself");
    assert.ok(/userBanned/.test(read("netlify/lib/schedule.js")),
      "…and his own bans ride with the profile into every caption and every reel");
  }

  console.log("v194 learns from him: OK");
})().catch((e) => { console.error(e); process.exit(1); });
