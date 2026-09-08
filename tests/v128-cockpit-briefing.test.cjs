// v128 — the cockpit reads like a briefing.
//
// Ash, on the finance cockpit: "consider if this is high end… if this was presented to a
// client who was paying thousands for it, would you be happy?" It was not, and the faults
// were nameable:
//
//   · FIVE FULL-WIDTH SLABS down a 1500px page. The Meal side card carried three short
//     lines and a screenful of nothing beside them; the checklist ran a tick down the far
//     left of a 1400px row. Content was never as wide as the box holding it.
//   · TITLES TOO SMALL TO READ AS TITLES — 11.5px uppercase grey, the same treatment the
//     page gives a form label. "Unrecognisable almost."
//   · THE INSTRUCTION WAS SUBORDINATE TO ITS BUTTON. "Move £959.07 and £255.75 out before
//     you spend anything" sat as grey text beside "Mark the money as moved", so the thing
//     to DO read as a footnote to the thing that RECORDS it.
//   · JARGON WITH NO WAY IN. "Allocatable income", "Left to run on", "Net movement" — Ash
//     is not an accountant and had no way to find out what they meant.
//
// So: a two-column cockpit (the week's money in the main column, the jobs and the small
// numbers in a rail), real headings with a plain-English line under them, the instruction
// leading its own tinted band above the button, and a ⓘ on anything you would otherwise
// have to already know — hover or tap for a sentence in plain words.
//
// Presentation and copy: the arithmetic, the store keys and the save paths are v122's and
// are not touched here.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/finance-env.cjs");

const FIN = fs.readFileSync(path.join(__dirname, "..", "finances.html"), "utf8");
const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));
const STYLE = styleOf(FIN);
const COCKPIT = FIN.slice(FIN.indexOf('<div class="view" id="v-cockpit">'),
  FIN.indexOf("<!-- ============================= IMPORT ============================= -->"));
const ruleOf = (sel) => {
  const m = new RegExp("\\n  " + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{[^}]*\\}").exec(STYLE);
  return m ? m[0] : null;
};

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log("  ok " + name); };

(async () => {
  /* ================= 0. the stamp — the newest test pins it ================= */
  ok("every page carries the v128 stamp", () => {
    const S = "build v128 · cockpit-briefing";
    assert.ok(FIN.includes("<!-- " + S + " -->"), "finances.html stamped v128");
    const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    assert.ok(read("monthly.html").includes('<span class="mp-stage">' + S + "</span>"), "monthly shows it");
    assert.ok(read("index.html").includes(S), "index carries it");
  });

  /* ================= 1. it is composed, not stacked ================= */
  ok("the cockpit is a main column and a rail, and nothing is stretched", () => {
    assert.ok(/<section class="ck-grid">/.test(COCKPIT), "the week sits in a two-column section");
    assert.ok(/<div class="ck-main">/.test(COCKPIT) && /<aside class="ck-rail">/.test(COCKPIT),
      "a main column and a rail beside it");
    const grid = ruleOf(".ck-grid");
    assert.ok(/grid-template-columns:minmax\(0,1\.62fr\) minmax\(320px,1fr\)/.test(grid),
      "the main column leads and the rail is held to a readable width");
    assert.ok(/@media\(max-width:1080px\)\{ \.ck-grid\{grid-template-columns:1fr;\} \}/.test(STYLE),
      "…and they stack rather than squeeze on a narrow screen");

    // the small stuff went to the rail; the week's money stayed in the main column
    const main = COCKPIT.slice(COCKPIT.indexOf('<div class="ck-main">'), COCKPIT.indexOf('<aside class="ck-rail">'));
    const rail = COCKPIT.slice(COCKPIT.indexOf('<aside class="ck-rail">'));
    assert.ok(/Profit First — this week/.test(main), "Profit First holds the main column");
    assert.ok(/id="pfLines"/.test(main) && /id="pfPots"/.test(main), "…with the week's figures");
    assert.ok(/This week's checklist/.test(rail), "the checklist moved to the rail");
    assert.ok(/Meal side/.test(rail), "so did the meal side");
    assert.ok(!/Meal side/.test(main), "…and the meal side is no longer a full-width slab");
  });

  /* ================= 2. a heading that reads as a heading ================= */
  ok("every cockpit card announces itself in words you can read", () => {
    const heads = [...COCKPIT.matchAll(/<div class="chead">([\s\S]*?)<\/div>/g)].map((m) =>
      m[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim());
    assert.deepStrictEqual(heads,
      ["One cashflow action", "Profit First — this week", "This week's checklist", "Meal side"],
      "four cards, four real headings");
    // one plain-English line under each — the cards explain themselves
    assert.strictEqual((COCKPIT.match(/<div class="csub">/g) || []).length, 4, "each carries a sub-line");
    // and the tiny uppercase label style is gone from the cockpit entirely
    assert.ok(!/class="ctitle"/.test(COCKPIT), "no cockpit card is titled like a form field any more");

    const chead = ruleOf(".chead");
    assert.ok(/font-size:16px/.test(chead), "a heading is 16px, not 11.5px");
    assert.ok(/color:var\(--ink-strong\)/.test(chead), "…in the darkest ink, not grey");
    assert.ok(/font-weight:700/.test(chead), "…and actually bold");
    assert.ok(/font-size:12\.5px/.test(ruleOf(".csub")), "the sub-line is quieter than its heading");
  });

  /* ================= 3. the instruction leads its own button ================= */
  ok("what to do is stated above the button that records it", () => {
    const band = /<div class="pf-do" id="pfDo">([\s\S]*?)<\/div>\s*<div class="hint" id="pfHint">/.exec(COCKPIT);
    assert.ok(band, "the do-this band exists");
    const b = band[1];
    assert.ok(b.indexOf('id="pfDoK"') < b.indexOf('id="pfMovedMsg"'), "a kicker, then the instruction");
    assert.ok(b.indexOf('id="pfMovedMsg"') < b.indexOf('id="pfMoved"'), "…and the button comes after both");
    const rule = ruleOf(".pf-do");
    assert.ok(/background:rgba\(var\(--orange-rgb\)/.test(rule), "the band is tinted, so it reads as the ask");
    assert.ok(/font-size:14\.5px/.test(ruleOf(".pf-do .v")), "the instruction is bigger than a hint");
    assert.ok(ruleOf(".pf-do.done") && ruleOf(".pf-do.idle"), "…and it has a done and a nothing-to-do state");
  });

  /* ================= 4. nothing is jargon without a way in ================= */
  ok("every term you would have to already know carries an explainer", () => {
    const tips = /const TIPS = \{([\s\S]*?)\n\};/.exec(FIN);
    assert.ok(tips, "the explainers live in one place");
    const keys = [...tips[1].matchAll(/^\s{2}([a-z]+):/gm)].map((m) => m[1]);
    for (const k of ["cash", "in", "out", "net", "action", "pf", "alloc", "tax", "inv", "ops", "seen", "meal"]) {
      assert.ok(keys.includes(k), k + " is explained");
    }
    // …in plain English: no accounting words, and a real sentence each
    const bodies = [...tips[1].matchAll(/"[^"]+", "([^"]+)"\]/g)].map((m) => m[1]);
    assert.strictEqual(bodies.length, keys.length, "every entry is [term, explanation]");
    for (const t of bodies) {
      assert.ok(t.length > 60, "an explanation is a real sentence, not a restatement: " + t);
      assert.ok(!/\b(accrual|reconcil|ledger|EBITDA|gross margin|liabilit)/i.test(t),
        "…and free of accounting words: " + t);
    }
    // every mark on the page resolves to one of them
    const used = new Set([...FIN.matchAll(/data-tip="([a-z]+)"/g)].map((m) => m[1]));
    used.forEach((k) => assert.ok(keys.includes(k), "#" + k + " is used and defined"));
    assert.deepStrictEqual([...used].sort(), ["action", "meal", "pf"],
      "the three marks written into the markup are the ones the headings need");
    // everything else is rendered, so it comes through the one helper
    assert.ok(/function tipBtn\(key\) \{\n\s*return TIPS\[key\] \?/.test(FIN),
      "a rendered mark only exists when there is an explanation behind it");

    // the box is fixed-position, or the stat tiles would clip it
    assert.ok(/\.tipbox\{[^}]*position:fixed/.test(STYLE), "the tip floats above everything");
    assert.ok(/\.fin-stat\{[^}]*overflow:hidden/.test(STYLE), "…which the stat tiles require");
    assert.ok(/<symbol id="ic-help"/.test(FIN), "the sprite carries the help mark");
    assert.ok(/document\.addEventListener\("click"/.test(FIN), "tapping works where there is no hover");
  });

  /* ================= 5. it renders that way, on real rows ================= */
  const AUG = [
    { id: "s1", date: "2026-08-06", dir: "in", amount: 2000, desc: "FASTER PAYMENTS RECEIPT REF.STRIPE FROM Stripe Payments UK Ltd", src: "stripe", cat: "", km: "", hash: "s1" },
    { id: "m1", date: "2026-08-07", dir: "in", amount: 500, desc: "SUMUP PAYMENTS", src: "sumup", cat: "", km: "", hash: "m1" },
    { id: "m2", date: "2026-08-07", dir: "out", amount: 300, desc: "NUTRAPREP LTD", cat: "Other", km: "", hash: "m2" },
  ];

  {
    const { el, settle } = await boot({ txns: { "2026-08": AUG }, now: "2026-08-10" });
    ok("the explainers reach the rendered figures", () => {
      assert.ok(/data-tip="alloc"/.test(el("pfLines").innerHTML), "allocatable income carries one");
      const pots = el("pfPots").innerHTML;
      ["tax", "inv", "ops"].forEach((k) => assert.ok(new RegExp('data-tip="' + k + '"').test(pots), k + " carries one"));
      assert.ok(/data-tip="cash"/.test(el("statRow").innerHTML), "so does every headline number");
    });

    ok("the meal side leads with the answer, not the arithmetic", () => {
      assert.strictEqual(el("mealProfit").textContent, "£200.00", "profit is what came in minus what went out");
      const lines = el("mealLines").innerHTML;
      assert.ok(lines.includes("£500.00") && lines.includes("£300.00"), "the two halves are still shown");
      assert.ok(!/pf-line total/.test(lines), "…but the total moved up into the headline");
    });

    ok("the checklist reports itself as a bar as well as a count", () => {
      assert.strictEqual(el("ckProgress").textContent, "0 of 9 done");
      assert.strictEqual(el("ckBar").style.width, "0%");
    });

    ok("the do-this band names the two amounts, then the button records them", async () => {
      assert.strictEqual(el("pfDoK").textContent, "Do this now");
      assert.strictEqual(el("pfDo").className, "pf-do");
      const msg = el("pfMovedMsg").textContent;
      assert.ok(msg.includes("£300.00") && msg.includes("£80.00"), "15% and 4% of £2,000: " + msg);
      assert.ok(/before you spend anything else/.test(msg), "…and says when to do it");
    });

    await el("pfMoved").onclick();
    await settle();
    ok("…and once it is done, it says so instead of asking again", () => {
      assert.strictEqual(el("pfDoK").textContent, "Done this week");
      assert.strictEqual(el("pfDo").className, "pf-do done");
      assert.ok(/^Moved £300\.00 to the tax pot and £80\.00 to the investment pot\./.test(el("pfMovedMsg").textContent));
      assert.strictEqual(el("ckProgress").textContent, "1 of 9 done", "ticking it moves the bar too");
      assert.strictEqual(el("ckBar").style.width, "11%");
    });
  }

  {
    // a week with nothing to split must not read as a job left undone
    const { el } = await boot({ txns: { "2026-08": [
      { id: "x", date: "2026-08-07", dir: "out", amount: 50, desc: "COSTA", cat: "Other", km: "", hash: "x" },
    ] }, now: "2026-08-10" });
    ok("a week with no allocatable income says so, quietly", () => {
      assert.strictEqual(el("pfDoK").textContent, "Nothing to move");
      assert.strictEqual(el("pfDo").className, "pf-do idle");
      assert.ok(/No income has landed this week that gets split\./.test(el("pfMovedMsg").textContent));
    });
  }

  /* ================= 6. Needs Review became a job, not a number ================= */
  {
    const { el } = await boot({ txns: { "2026-08": [
      { id: "n1", date: "2026-08-06", dir: "out", amount: 120, desc: "A SHOP NOBODY HAS SEEN", cat: "", km: "", hash: "n1" },
    ] }, now: "2026-08-10" });
    ok("Needs Review reads as one sentence you can act on", () => {
      const html = el("statRow").innerHTML;
      assert.ok(/class="fin-alert"/.test(html), "it is a strip, not a fifth headline tile");
      assert.ok(/Needs review[\s\S]*?>1</.test(html), "…still surfacing the count");
      assert.ok(/Sort them out/.test(html), "…and saying where to go");
      assert.ok(!/fin-stat watch/.test(html), "the lonely-digit tile is gone");
      assert.ok(/grid-column:1\/-1/.test(ruleOf(".fin-alert")), "it spans the whole numbers row");
    });
  }

  console.log("v128-cockpit-briefing.test: " + pass + " checks passed");
})();
