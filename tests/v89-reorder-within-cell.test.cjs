// v89 regression: drag-to-reorder WITHIN a grid cell. The order is a per-week hint
// (wpPlan.cellOrder) applied as the LAST step of wpEffectivePlacements — after v83 schedule
// derivation and v82 exceptions. It only ever sorts what a cell already holds: it never adds,
// removes, moves between cells, or touches a schedule/exception/done tick, and it never rolls
// over into another week. Dropping in a DIFFERENT cell is still the v82 move (with prompt).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/env.cjs");

const WEEK = "2026-03-16"; // a Monday inside NAV_WEEKS
const NEXT = "2026-03-23";
const CELL = "10-12:tue";  // Tuesday 9 – 11.30, the cell from the bug report
const REVIEW = "recurring:r1";   // "Monthly Review"
const LEADS = "recurring:r2";    // "Lead Generation"

const dragEv = () => ({ dataTransfer: { setData() {} } });
// A drop on a chip: clientY in the top or bottom half of a 20px-tall chip.
const chipEv = (before) => ({
  preventDefault() {}, stopPropagation() {},
  clientY: before ? 3 : 17,
  currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 20 }), classList: { add() {}, remove() {} } },
  dataTransfer: { dropEffect: "", getData: () => "" },
});
const cellEv = () => ({
  preventDefault() {}, currentTarget: { classList: { remove() {} } }, dataTransfer: { getData: () => "" },
});
const cell = (P, k) => Array.from(P[k] || []);
const order = (ctx, k) => cell(ctx.wpEffectivePlacements(), k);
const weeklyPosts = (posts) => posts.filter((p) => p.body && p.body.weeklyPlan);
// chip order as actually rendered in the grid
function renderedOrder(ctx, cellKey) {
  const html = ctx.document.getElementById("wpBody").innerHTML;
  const out = [];
  const re = /wpChipDrop\(event,'([^']+)','([^']+)'\)/g;
  let m;
  while ((m = re.exec(html))) if (m[1] === cellKey) out.push(m[2]);
  return out;
}

// Two scheduled tasks sharing Tuesday 9–11.30, derived from their schedules (v83).
function world(extra) {
  return {
    defaults: [
      { id: "r1", title: "Monthly Review", days: ["tue"], time: "10-12" },
      { id: "r2", title: "Lead Generation", days: ["tue", "thu"], time: "10-12" },
    ],
    plans: Object.assign({ [WEEK]: { weekEnding: WEEK, placements: {} }, [NEXT]: null }, extra || {}),
  };
}

(async () => {
  // ---------- 1: dragging a chip within its cell reorders it, and it persists ----------
  {
    const { ctx, posts } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    assert.deepStrictEqual(order(ctx, CELL), [REVIEW, LEADS], "derived order to start with");
    assert.deepStrictEqual(renderedOrder(ctx, CELL), [REVIEW, LEADS], "…and that's what renders");

    // drag Lead Generation onto the top half of Monthly Review → above it
    ctx.wpChipDragStart(dragEv(), LEADS, CELL);
    await ctx.wpChipDrop(chipEv(true), CELL, REVIEW);

    assert.deepStrictEqual(order(ctx, CELL), [LEADS, REVIEW], "Lead Generation is now on top");
    assert.deepStrictEqual(renderedOrder(ctx, CELL), [LEADS, REVIEW], "…and renders that way");
    assert.deepStrictEqual(Array.from(ctx.__wpState.plan.cellOrder[CELL]), [LEADS, REVIEW], "stored as a hint for this cell");
    const saved = weeklyPosts(posts).pop().body.weeklyPlan;
    assert.deepStrictEqual(saved.cellOrder[CELL], [LEADS, REVIEW], "persisted on the timeBlocks save");
    assert.strictEqual(saved.weekEnding, WEEK, "against this week only");

    // and back again, dropping on the bottom half
    ctx.wpChipDragStart(dragEv(), LEADS, CELL);
    await ctx.wpChipDrop(chipEv(false), CELL, REVIEW);
    assert.deepStrictEqual(order(ctx, CELL), [REVIEW, LEADS], "dropping below puts it back underneath");

    // dropping a chip on itself changes nothing
    const before = JSON.stringify(ctx.__wpState.plan.cellOrder);
    ctx.wpChipDragStart(dragEv(), LEADS, CELL);
    await ctx.wpChipDrop(chipEv(true), CELL, LEADS);
    assert.strictEqual(JSON.stringify(ctx.__wpState.plan.cellOrder), before, "no-op drop writes nothing");
  }

  // ---------- 2: ordering sits ON TOP of derivation + exceptions, altering neither ----------
  {
    const { ctx } = await boot(world({
      [WEEK]: {
        weekEnding: WEEK, placements: {},
        // a one-off buffer task hand-placed in the same cell, plus a v82 move exception
        bufferItems: [{ id: "b1", title: "Emails", done: false }],
        recurringDone: { "r2:tue": true },
      },
    }));
    await ctx.loadWeeklyPlan(WEEK);
    ctx.__wpState.plan.placements[CELL] = ["buffer:b1"];
    ctx.renderWeeklyPlan();
    assert.deepStrictEqual(order(ctx, CELL), ["buffer:b1", REVIEW, LEADS], "one-off + derived tasks share the cell");

    const schedBefore = JSON.stringify(ctx.__wpState.defaults);
    ctx.wpChipDragStart(dragEv(), LEADS, CELL);
    await ctx.wpChipDrop(chipEv(true), CELL, "buffer:b1");
    assert.deepStrictEqual(order(ctx, CELL), [LEADS, "buffer:b1", REVIEW], "any mix of tasks can be ordered");

    assert.strictEqual(JSON.stringify(ctx.__wpState.defaults), schedBefore, "no schedule was touched");
    assert.deepStrictEqual(Array.from(ctx.__wpState.plan.placements[CELL]), ["buffer:b1"],
      "no frozen placements introduced — the derived tasks are still not stored");
    assert.strictEqual(ctx.__wpState.plan.recurringDone["r2:tue"], true, "done-state untouched");

    // now add a v82 skip: ordering must not resurrect or hide anything
    ctx.__wpState.plan.exceptions[LEADS] = { type: "skip", from: CELL };
    ctx.renderWeeklyPlan();
    assert.deepStrictEqual(order(ctx, CELL), ["buffer:b1", REVIEW], "the skipped task is gone, order applies to the rest");
    assert.strictEqual(ctx.__wpState.plan.exceptions[LEADS].type, "skip", "the exception itself is unchanged");
    delete ctx.__wpState.plan.exceptions[LEADS];
    ctx.renderWeeklyPlan();
    assert.deepStrictEqual(order(ctx, CELL), [LEADS, "buffer:b1", REVIEW], "un-skipping restores it in its ordered position");
  }

  // ---------- 3: partial / stale hints never drop a task ----------
  {
    const { ctx } = await boot(world({
      [WEEK]: {
        weekEnding: WEEK, placements: {},
        cellOrder: {
          [CELL]: [LEADS, "recurring:gone"],          // one real ref + one that isn't there
          "6-9:mon": ["recurring:r1"],                 // a cell that holds nothing
          "bogus:cell": [LEADS],                       // invalid key
        },
      },
    }));
    await ctx.loadWeeklyPlan(WEEK);
    assert.deepStrictEqual(order(ctx, CELL), [LEADS, REVIEW], "hinted ref first, unhinted keeps its derived place");
    assert.ok(order(ctx, CELL).includes(REVIEW), "a task missing from the hint is never dropped");
    assert.ok(!Array.from(ctx.wpEffectivePlacements()["6-9:mon"] || []).includes("recurring:gone"),
      "a hint can't put a task into a cell");
    assert.ok(!("bogus:cell" in ctx.__wpState.plan.cellOrder), "invalid cell keys stripped on load");

    // a hint listing only the second task pushes it to the top, the first falls in behind
    ctx.__wpState.plan.cellOrder[CELL] = [REVIEW];
    assert.deepStrictEqual(order(ctx, CELL), [REVIEW, LEADS], "single-ref hint still orders deterministically");
    // an empty hint is inert
    ctx.__wpState.plan.cellOrder[CELL] = [];
    assert.deepStrictEqual(order(ctx, CELL), [REVIEW, LEADS], "empty hint falls back to the derived order");
  }

  // ---------- 4: ordering never rolls over into another week ----------
  {
    const { ctx } = await boot(world({
      [WEEK]: { weekEnding: WEEK, placements: {}, cellOrder: { [CELL]: [LEADS, REVIEW] } },
    }));
    await ctx.loadWeeklyPlan(WEEK);
    assert.deepStrictEqual(order(ctx, CELL), [LEADS, REVIEW], "this week is ordered");

    await ctx.loadWeeklyPlan(NEXT);
    assert.strictEqual(Object.keys(ctx.__wpState.plan.cellOrder).length, 0, "a fresh week inherits no ordering");
    assert.deepStrictEqual(order(ctx, CELL), [REVIEW, LEADS], "next week comes up in plain derived order");

    await ctx.loadWeeklyPlan(WEEK);
    assert.deepStrictEqual(order(ctx, CELL), [LEADS, REVIEW], "…and this week still has its own");
  }

  // ---------- 5: a drop in ANOTHER cell is still the v82 move (never a reorder) ----------
  {
    const { ctx } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    let asked = 0;
    ctx.wpAsk = async () => { asked++; return "week"; };

    // chip-level drop, but the drag started in a different cell → the chip handler declines
    ctx.wpChipDragStart(dragEv(), LEADS, CELL);
    await ctx.wpChipDrop(chipEv(true), "6-9:mon", "recurring:r1");
    assert.strictEqual(asked, 0, "the chip handler does nothing for a cross-cell drag…");
    assert.strictEqual(Object.keys(ctx.__wpState.plan.cellOrder).length, 0, "…and writes no ordering");
    assert.ok(ctx.__wpState.plan.exceptions[LEADS] === undefined, "…and no exception yet");

    // …it falls through to the cell, which runs the normal v82 move prompt
    await ctx.wpCellDrop(cellEv(), "6-9", "mon");
    assert.strictEqual(asked, 1, "the move prompt was shown");
    assert.strictEqual(ctx.__wpState.plan.exceptions[LEADS].type, "move", "a one-week move exception was written");
    assert.strictEqual(ctx.__wpState.plan.exceptions[LEADS].to, "6-9:mon");
    assert.strictEqual(Object.keys(ctx.__wpState.plan.cellOrder).length, 0, "moving between cells writes no ordering");

    // a same-cell drop on the CELL (not on a chip) is still the v82 no-op
    ctx.wpChipDragStart(dragEv(), REVIEW, CELL);
    await ctx.wpCellDrop(cellEv(), "10-12", "tue");
    assert.strictEqual(asked, 1, "dropping back in the same cell doesn't prompt");
  }

  // ---------- 6: identical behaviour under the v87 day-count views ----------
  {
    for (const n of [1, 3, 7]) {
      const { ctx } = await boot(world());
      await ctx.loadWeeklyPlan(WEEK);
      ctx.wpSetDayCount(n);
      if (n < 7) { for (let i = 0; i < 6; i++) ctx.wpSlideDays(1); ctx.wpSlideDays(-1); }  // make sure Tue is visible
      while (!renderedOrder(ctx, CELL).length) ctx.wpSlideDays(-1);

      ctx.wpChipDragStart(dragEv(), LEADS, CELL);
      await ctx.wpChipDrop(chipEv(true), CELL, REVIEW);
      assert.deepStrictEqual(order(ctx, CELL), [LEADS, REVIEW], `reorder works at ${n}-day view`);
      assert.deepStrictEqual(renderedOrder(ctx, CELL), [LEADS, REVIEW], `…and renders at ${n}-day view`);

      ctx.wpSetDayCount(7);
      assert.deepStrictEqual(order(ctx, CELL), [LEADS, REVIEW], "…and survives returning to the full week");
    }
  }

  // ---------- 7: nothing else in the week changes ----------
  {
    const { ctx } = await boot(world({
      [WEEK]: {
        weekEnding: WEEK,
        placements: { "1-3:fri": ["buffer:b1"] },
        bufferItems: [{ id: "b1", title: "Emails", done: false }],
        recurringDone: { "r1:tue": true },
        exceptions: { "recurring:r2": { type: "move", from: "10-12:thu", to: "5-8:sat" } },
        locations: { fri: "home" },
        timeBlocks: { "10-12": { tue: "keep me" } },
      },
    }));
    await ctx.loadWeeklyPlan(WEEK);
    const before = JSON.stringify({
      placements: ctx.__wpState.plan.placements, exceptions: ctx.__wpState.plan.exceptions,
      done: ctx.__wpState.plan.recurringDone, locations: ctx.__wpState.plan.locations,
      timeBlocks: ctx.__wpState.plan.timeBlocks, defaults: ctx.__wpState.defaults,
    });

    ctx.wpChipDragStart(dragEv(), LEADS, CELL);
    await ctx.wpChipDrop(chipEv(true), CELL, REVIEW);

    assert.strictEqual(JSON.stringify({
      placements: ctx.__wpState.plan.placements, exceptions: ctx.__wpState.plan.exceptions,
      done: ctx.__wpState.plan.recurringDone, locations: ctx.__wpState.plan.locations,
      timeBlocks: ctx.__wpState.plan.timeBlocks, defaults: ctx.__wpState.defaults,
    }), before, "a reorder touches nothing but cellOrder");
    assert.deepStrictEqual(order(ctx, "5-8:sat"), [LEADS], "the unrelated v82 move exception still applies");
  }

  // ---------- 8: the store's whitelist keeps cellOrder clean ----------
  {
    const src = fs.readFileSync(path.join(__dirname, "../netlify/functions/kpi-store.js"), "utf8");
    const start = src.indexOf('if ("cellOrder" in incoming) {');
    assert.ok(start > 0, "found the store's cellOrder whitelist");
    const end = src.indexOf("incoming.cellOrder = clean;", start) + "incoming.cellOrder = clean;".length;
    const run = new Function("incoming", "VALID_DAY_KEYS",
      src.slice(start, end) + "\n}\nreturn incoming.cellOrder;");   // + the if-block's closing brace
    const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const out = run({ cellOrder: {
      "10-12:tue": [LEADS, REVIEW, LEADS, 7, "nope:x", "buffer:b1"],
      "10-12:funday": [LEADS],
      "bogus": [LEADS],
      "6-9:mon": "not-an-array",
      "1-3:wed": [],
    } }, DAYS);
    assert.deepStrictEqual(out["10-12:tue"], [LEADS, REVIEW, "buffer:b1"], "valid refs kept, de-duped; junk stripped");
    assert.ok(!("10-12:funday" in out) && !("bogus" in out), "invalid cell keys dropped");
    assert.ok(!("6-9:mon" in out), "non-array values dropped");
    assert.ok(!("1-3:wed" in out), "empty lists dropped");
    assert.deepStrictEqual(run({ cellOrder: null }, DAYS), {}, "junk → empty map");
    assert.deepStrictEqual(run({ cellOrder: [LEADS] }, DAYS), {}, "arrays rejected");
  }

  console.log("v89-reorder-within-cell.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
