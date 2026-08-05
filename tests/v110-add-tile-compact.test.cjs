// v110: the "+ Add …" cell sizes to itself, not to its row.
//
// v109 put the focus and personal items on a 3-across grid whose rows stretch, so no tile
// in a row is shorter than its neighbours. The add control is a cell of that same grid, so
// it stretched too — and a stretched add control reads as a large empty card rather than a
// button, worst of all when it lands alone on the last row next to nothing.
//
// The fix is one declaration: the add cell takes align-self:start. That is deliberately the
// ONLY exception in the grid — this test exists mainly to pin that it stays the only one,
// because an align-self that spread to .mp-item would quietly undo v109's equal heights.
// CSS only: same markup, same handlers, same writes.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, openPlan } = require("./lib/monthly-env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const WEEKLY = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const AUG = "2026-08";

const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));
const STYLE = styleOf(HTML);
const ruleOf = (sel) => {
  const m = new RegExp("\\n\\s*" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{([^}]*)\\}").exec(STYLE);
  assert.ok(m, "stylesheet defines " + sel);
  return m[1];
};

(async () => {
  /* ================= 0. the build stamp ================= */
  assert.ok(/<!-- build v110 · add-tile-compact -->/.test(HTML), "monthly.html stamped v110 · add-tile-compact");
  assert.ok(/build v110 · add-tile-compact/.test(WEEKLY), "index.html carries the same stamp");

  /* ================= 1. the add cell opts out of the stretch ================= */
  {
    const add = ruleOf(".mp-tiles .mp-add");
    assert.ok(/align-self:start/.test(add),
      "the add cell sizes to its own content instead of the row's height");
    assert.ok(!/height:100%/.test(add), "…and is not stretched back by a height of its own");
    // it stays a comfortable target rather than collapsing to a thin strip
    const min = /min-height:(\d+)px/.exec(add);
    assert.ok(min, "the add cell keeps a minimum height");
    assert.ok(Number(min[1]) >= 40 && Number(min[1]) <= 56,
      "…a tap-target floor (" + min[1] + "px), not a tile's worth of empty card");
  }

  /* ================= 2. …and nothing else does ================= */
  {
    assert.ok(/align-items:stretch/.test(ruleOf(".mp-tiles")),
      "the grid still stretches its cells by default — that is v109's equal-height promise");
    assert.ok(!/align-self/.test(ruleOf(".mp-tiles .mp-item")),
      "an item tile takes no align-self, so item tiles still stretch to their row");
    assert.ok(!/align-self/.test(ruleOf(".mp-tiles .mp-rock")), "…nor does a Rock card");
    assert.ok(/margin-top:auto/.test(ruleOf(".mp-tile-foot")),
      "…and a tile's footer is still pinned to its bottom edge");
    // exactly one align-self inside the tile grid's rules
    const gridRules = STYLE.split("\n").filter((l) => /^\s*\.mp-tiles/.test(l)).join("\n");
    assert.strictEqual((gridRules.match(/align-self/g) || []).length, 1,
      "the add cell is the only exception to the stretch");
  }

  /* ================= 3. CSS only — markup, handlers and writes unmoved ============== */
  {
    // the add controls are emitted exactly as v109 emitted them, still inside the grid
    assert.ok(/<div class="mp-tiles">\$\{focusTiles\}<button class="mp-add" onclick="mpAddFocus\(\)">\+ Add focus item<\/button>/.test(HTML),
      "the focus add control is unchanged and still the grid's last cell");
    assert.ok(/<div class="mp-tiles">\$\{prTiles\}<button class="mp-add" onclick="mpAddPrio\(\)">\+ Add priority<\/button>/.test(HTML),
      "…and so is the personal one");

    const env = await boot({
      plans: { [AUG]: { ym: AUG, focus: [{ id: "f1", title: "Retention push", rockRef: "", notes: "", done: false }],
        priorities: [{ id: "p1", title: "Three gym sessions", owner: "Ash", status: "In Progress", notes: "" }] } },
      rocks: [{ title: "Retention above 92%" }],
    });
    await openPlan(env, AUG);
    const before = env.body.innerHTML;

    // adding still adds, still renders as a tile, still doesn't write an empty item (v100)
    env.ctx.mpAddFocus();
    assert.strictEqual(env.ctx.__mpState.plan.focus.length, 2, "the add control still adds a focus item");
    assert.strictEqual((env.body.innerHTML.match(/data-focus="/g) || []).length, 2, "…rendered as a tile");
    env.ctx.mpAddPrio();
    assert.strictEqual(env.ctx.__mpState.plan.priorities.length, 2, "…and the personal one still adds too");
    assert.strictEqual(env.posts.length, 0, "…neither writing an empty item");

    // and the rendered plan is byte-identical to before once the added rows are gone again
    env.ctx.__mpState.plan.focus = env.ctx.__mpState.plan.focus.slice(0, 1);
    env.ctx.__mpState.plan.priorities = env.ctx.__mpState.plan.priorities.slice(0, 1);
    env.ctx.drawMonthlyPlan();
    assert.strictEqual(env.body.innerHTML, before,
      "the same plan renders the same markup — v110 changed the stylesheet and nothing else");
  }

  console.log("v110-add-tile-compact.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
