// v96 regression: even vertical rhythm in the Monthly Plan header — heading → rule pill →
// "Last saved" → first panel. CSS only; the header's content and the plan itself are
// unchanged, and the other views' headers must not be touched.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, openPlan } = require("./lib/monthly-env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const AUG = "2026-08";

const ruleOf = (sel) => {
  const m = new RegExp("\\n  " + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{([^}]*)\\}").exec(HTML);
  assert.ok(m, "rule exists: " + sel);
  return m[1];
};
const px = (css, prop) => {
  const m = new RegExp("(?:^|;)" + prop + ":(\\d+)px").exec(css);
  return m ? Number(m[1]) : null;
};

(async () => {
  /* ---------- build stamp ---------- */
  assert.ok(/<!-- build v96 · monthly-header-spacing -->/.test(HTML),
    "build stamp is v96 · monthly-header-spacing");

  /* ---------- 1. the header stack has a deliberate, even rhythm ---------- */
  {
    const head = ruleOf(".mp-head");
    const heading = px(ruleOf(".mp-head .ctitle"), "margin-bottom");   // heading → pill
    const saved = px(ruleOf(".mp-head .mp-saved"), "margin-top");      // pill → last saved
    const toPanel = px(head, "margin-bottom");                          // last saved → panel

    assert.strictEqual(heading, saved, "the steps through the header are even");
    assert.ok(toPanel > 0, "the saved line is no longer flush against the panel below");
    assert.ok(toPanel > saved, "…and the header/content break is the larger step");
    assert.ok(toPanel <= saved * 2, "…without opening up an excessive gap (" + toPanel + "px)");
    assert.ok(heading >= 6 && heading <= 12, "the header steps stay compact (" + heading + "px)");

    // the pill's inline-block line box was the source of the loose gap under it
    assert.ok(/\.mp-head \.rule-pill\{[^}]*display:block/.test(HTML),
      "the rule pill is block-level, so no line-box descender pads beneath it");
    assert.ok(/\.mp-head \.rule-pill\{[^}]*width:fit-content/.test(HTML),
      "…while still shrink-wrapping to its text");
    assert.ok(/\.mp-head \.rule-pill\{[^}]*margin-top:0/.test(HTML),
      "…and its own margin no longer stacks on the heading's");

    // an unsaved plan must not leave an orphaned gap where the saved line would be
    assert.ok(/\.mp-head \.mp-saved:empty\{[^}]*display:none/.test(HTML),
      "an empty 'Last saved' line collapses, so the rhythm holds before the first save");

    assert.ok(px(head, "margin-top") > 0, "the header still clears the tab bar above it");
  }

  /* ---------- 2. scoped to the Monthly Plan; other views untouched ---------- */
  {
    assert.ok(/<div class="view" id="view-plan" hidden>\s*\n\s*<div class="home-head mp-head">/.test(HTML),
      "the Monthly Plan header opts in via .mp-head");
    assert.strictEqual((HTML.match(/class="home-head mp-head"/g) || []).length, 1,
      "exactly one header takes the new rhythm");
    assert.strictEqual((HTML.match(/class="home-head"/g) || []).length, 2,
      "the KPIs and Expenses headers are unchanged");
    assert.ok(/\n  \.home-head\{margin-top:18px;\}/.test(HTML), "the shared .home-head rule is untouched");
    assert.ok(/\n  \.home-head \.rule-pill\{display:inline-block;margin-top:4px;\}/.test(HTML),
      "…as is its rule-pill rule");
  }

  /* ---------- 3. content and behaviour unchanged ---------- */
  {
    const env = await boot({ plans: { [AUG]: { ym: AUG, focus: [
      { id: "f1", title: "Retention push", rockRef: "0", notes: "", done: false },
    ], lastUpdated: "2026-08-04T09:46:00.000Z" } }, rocks: [{ title: "Retention above 92%" }] });
    await openPlan(env, AUG);

    assert.ok(HTML.includes('<div class="ctitle ctitle-white">Monthly Plan — <span id="mpMonthLabel"></span></div>'),
      "the heading is unchanged");
    assert.ok(HTML.includes('<div class="rule-pill">Turn this quarter\'s Rocks into this month\'s focus</div>'),
      "the rule pill text is unchanged");
    assert.ok(HTML.includes('<div class="mp-saved" id="mpSavedMsg"></div>'), "the saved line is unchanged");

    assert.ok(/^Last saved /.test(env.ctx.document.getElementById("mpSavedMsg").textContent),
      "the saved line still reports the save state");
    assert.strictEqual(env.ctx.document.getElementById("mpMonthLabel").textContent, "August 2026",
      "the month label still renders");
    assert.ok(env.body.innerHTML.includes("This Quarter's Rocks"), "the panel below still renders");
    assert.strictEqual(env.body.focusRows().length, 1, "…and the plan itself is unaffected");
  }

  console.log("v96-monthly-header-spacing.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
