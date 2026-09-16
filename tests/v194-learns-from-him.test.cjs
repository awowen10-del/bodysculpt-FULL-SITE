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
    assert.ok(/1\. No hashtags at all/.test(p), "the numbered checks are named as the explicit test");
    /* v195: and the WHOLE profile goes with them. The first live run caught five real things
       and left three hashtags standing, for a man whose profile says "Zero hashtags… don't add
       any" — a rule that lives under CAPTIONS, not under CHECKS. Passing only the summary to
       save tokens on a call that had tokens to spare cost the most concrete rule he has. */
    assert.ok(/HOW HE COMES ACROSS/.test(p) && /Zero hashtags/.test(p),
      "the rest of the profile is the rulebook, not decoration — every line of it is a rule");
    assert.ok(/not only the numbered ones/.test(p) && /line by line/.test(p),
      "…and the marker is told so, because a numbered list looks like the whole test when it is not");
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

  /* ============ 5. v196: two things a live run-through found ============ */
  {
    /* (a) The checker decided "sculpt" was a banned word and took @bodysculptwarrington out of
       the CTA — a checker that edits away the name of the business is worse than none, because
       it looks like care while costing the caption the only thing that says where to go. */
    const p = learn.checkPrompt("draft", "CHECKS\n1. No marketing words.", ["sculpt"]);
    assert.ok(/NEVER flag or remove/.test(p), "his own name is off limits to the marker");
    assert.ok(/@bodysculptwarrington/.test(p) && /Bodysculpt/.test(p) && /Warrington/.test(p),
      "…by name, because a rule about words he avoids will otherwise catch the word in his own brand");
    assert.ok(/name of any client/.test(p), "and a client's name is not marketing language either");

    /* (b) An idea came back titled "…start to finish, no talking" with its format set to demo,
       and the writer did as the format said and wrote him a monologue for a silent reel. */
    const ideas = await import("file://" + root("netlify/lib/ideas.js"));
    const out = ideas.parseIdeas(
      "---IDEA---\nTITLE: Walk through one full session, start to finish, no talking\nWHY: w\nSOURCE: s\nFORMAT: demo\n" +
      "---IDEA---\nTITLE: A silent look round the gym at 6am\nWHY: w\nSOURCE: s\nFORMAT: talking\n" +
      "---IDEA---\nTITLE: Answer the bulky question on camera\nWHY: w\nSOURCE: s\nFORMAT: talking\n");
    assert.strictEqual(out[0].format, "onscreen", "a title that rules speech out overrules a format that puts it back");
    assert.strictEqual(out[1].format, "onscreen", "…however it is worded");
    assert.strictEqual(out[2].format, "talking", "and an idea that genuinely is to camera keeps its format");
    const prompt = ideas.ideasPrompt({ hooks: [], ownPosts: [], recentTopics: [], now: new Date() });
    assert.ok(/must not contradict the title/.test(prompt), "the model is told, as well as corrected");
    assert.ok(/write him a monologue for a silent reel/.test(prompt), "…and told what the contradiction costs");
  }

  /* ============ 6. v205: the playbook reaches the writer, and the facts get checked ============
     The playbook fed the IDEAS and nothing else, so it would suggest "what happens on your
     first 6 Week Challenge session" and then write that script with no idea what is in the
     6 Week Challenge — writing around the gap instead of with the detail. */
  {
    const hooks = await import("file://" + root("netlify/lib/hooks.js"));
    const about = "The 6 Week Challenge is £195. Everyone starts on it, no exceptions. Sessions are capped at 20.";

    const script = hooks.scriptPrompt("first session", { onScreen: "x" }, "onscreen", "", about);
    assert.ok(/£195/.test(script) && /capped at 20/.test(script), "the writer knows what the gym actually does");
    assert.ok(/only source of fact/.test(script) && /never state anything about the gym that is not in it/.test(script),
      "…and is told it is the only source of fact, not background colour");

    /* The options call deliberately does NOT get it: eight opening lines touch no facts, and
       it is the one call that has already hit the 26-second wall once. */
    const opts = hooks.optionsPrompt("first session", [{ type: "T", template: "t" }], "", "onscreen");
    assert.ok(!/£195/.test(opts),
      "the options call is left alone — it touches no facts and it is the one that has already timed out");

    // and the checker marks the claims, not just the voice
    const check = learn.checkPrompt("Only £99 and you are in a group of 40", "CHECKS\n1. x", [], about);
    assert.ok(/£195/.test(check), "the checker is given the facts");
    assert.ok(/Check every factual claim about the gym/.test(check), "…and told to mark the draft against them");
    assert.ok(/Do not invent a replacement fact/.test(check),
      "…and not to paper over a wrong number with a different wrong number");
    assert.ok(!/£195/.test(learn.checkPrompt("d", "CHECKS\n1. x", [])),
      "with no playbook it still runs, on voice alone");
  }

  console.log("v194-v205 learns from him: OK");
})().catch((e) => { console.error(e); process.exit(1); });
