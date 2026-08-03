// v83 regression: a scheduled task's grid position is DERIVED from its live schedule
// (days + slot), not frozen per week. Before v83 each week stored a snapshot of the
// placements (written by wpSetRecurrence, copied forward by the v62 rollover), so a
// "move the whole schedule" only fixed the week you were on — every other week kept
// showing the task in its old slot. These assertions pin the fix, and pin that the v82
// exception model, one-off placement and per-week customisation still hold.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const PREV = "2026-03-09";
const WEEK = "2026-03-16"; // a Monday inside NAV_WEEKS
const NEXT = "2026-03-23";
const LATER = "2026-03-30";
const FAR = "2026-06-08";   // 12 weeks on — beyond the rollover's 8-week lookback

const dragEv = () => ({ dataTransfer: { setData() {} } });
const dropEv = () => ({
  preventDefault() {},
  currentTarget: { classList: { remove() {} } },
  dataTransfer: { getData: () => "" },
});
const cell = (P, k) => Array.from(P[k] || []);
const flat = (P) => Object.values(P).flatMap((v) => Array.from(v));
const stubAsk = (ctx, answer) => { ctx.wpAsk = async () => answer; };

// A schedule + a snapshot of it already frozen into several weeks (exactly the state the
// bug report describes: every week that has been opened holds its own copy).
const SNAPSHOT = { "6-9:mon": ["recurring:r1"], "6-9:wed": ["recurring:r1"] };
function world(extra) {
  return {
    defaults: [{ id: "r1", title: "Scorecard", days: ["mon", "wed"], time: "6-9" }],
    plans: Object.assign(
      {
        [PREV]: { weekEnding: PREV, placements: { ...SNAPSHOT } },
        [WEEK]: { weekEnding: WEEK, placements: { ...SNAPSHOT } },
        [NEXT]: { weekEnding: NEXT, placements: { ...SNAPSHOT } },
        [LATER]: null, // never opened — fresh
      },
      extra || {}
    ),
  };
}

(async () => {
  // ---------- 1: THE BUG — "move all" must reach a week that already holds a snapshot ----------
  {
    const { ctx } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    stubAsk(ctx, "all");
    ctx.wpChipDragStart(dragEv(), "recurring:r1", "6-9:mon");
    await ctx.wpCellDrop(dropEv(), "10-12", "tue");   // Mon 6-9 → Tue 9-11.30, whole schedule

    const it = ctx.__wpState.defaults.find((d) => d.id === "r1");
    assert.deepStrictEqual(Array.from(it.days), ["tue", "wed"], "schedule updated");
    assert.strictEqual(it.time, "10-12");

    // the week we're on
    let E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "10-12:tue").includes("recurring:r1") && cell(E, "10-12:wed").includes("recurring:r1"));
    assert.ok(!cell(E, "6-9:mon").includes("recurring:r1"));

    // …and the FUTURE week, whose stored snapshot still says 6-9:mon / 6-9:wed
    await ctx.loadWeeklyPlan(NEXT);
    assert.ok(cell(ctx.__wpState.plan.placements, "6-9:mon").includes("recurring:r1"),
      "the stale stored snapshot is still on disk (nothing destructive)");
    E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "10-12:tue").includes("recurring:r1"), "next week shows the NEW slot");
    assert.ok(cell(E, "10-12:wed").includes("recurring:r1"), "…on every new day");
    assert.ok(!cell(E, "6-9:mon").includes("recurring:r1"), "…and not the old one");
    assert.ok(!cell(E, "6-9:wed").includes("recurring:r1"));

    // a week that has never been opened
    await ctx.loadWeeklyPlan(LATER);
    E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "10-12:tue").includes("recurring:r1") && cell(E, "10-12:wed").includes("recurring:r1"),
      "a fresh future week derives the new schedule too");
    assert.strictEqual(flat(ctx.__wpState.plan.placements).length, 0, "and nothing is frozen into it");

    // …and a PAST week that also held the old snapshot
    await ctx.loadWeeklyPlan(PREV);
    E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "10-12:tue").includes("recurring:r1"), "past weeks follow the schedule too");
    assert.ok(!cell(E, "6-9:mon").includes("recurring:r1"));
  }

  // ---------- 2: the same via the 📅 editor (wpSetRecurrence direct) ----------
  {
    const { ctx } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    await ctx.wpSetRecurrence("r1", ["fri"], "5-8", "recurring");
    await ctx.loadWeeklyPlan(NEXT);
    const E = ctx.wpEffectivePlacements();
    assert.deepStrictEqual(Object.keys(E).filter((k) => cell(E, k).includes("recurring:r1")), ["5-8:fri"],
      "a schedule edit anywhere shows in every week, on exactly the scheduled cells");
  }

  // ---------- 3: training propagates through the same derivation ----------
  {
    const { ctx } = await boot({
      training: [{ id: "t1", title: "Reformer", days: ["tue", "thu"], time: "5-8" }],
      plans: {
        [WEEK]: { weekEnding: WEEK, placements: { "5-8:tue": ["training:t1"], "5-8:thu": ["training:t1"] } },
        [NEXT]: { weekEnding: NEXT, placements: { "5-8:tue": ["training:t1"], "5-8:thu": ["training:t1"] } },
      },
    });
    await ctx.loadWeeklyPlan(WEEK);
    stubAsk(ctx, "all");
    ctx.wpChipDragStart(dragEv(), "training:t1", "5-8:tue");
    await ctx.wpCellDrop(dropEv(), "6-9", "wed");

    await ctx.loadWeeklyPlan(NEXT);
    const E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "6-9:wed").includes("training:t1") && cell(E, "6-9:thu").includes("training:t1"),
      "training's new schedule reaches next week");
    assert.ok(!cell(E, "5-8:tue").includes("training:t1"));
  }

  // ---------- 4: a week's own exception survives a schedule change elsewhere ----------
  {
    // NEXT week has its own "just this week" move; the schedule is edited from WEEK
    const { ctx } = await boot(world({
      [NEXT]: {
        weekEnding: NEXT,
        placements: { ...SNAPSHOT },
        exceptions: { "recurring:r1": { type: "move", from: "6-9:wed", to: "1-3:sat" } },
      },
    }));
    await ctx.loadWeeklyPlan(NEXT);
    let E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "1-3:sat").includes("recurring:r1"), "its own customisation applies");

    // now a skip-week exception in a DIFFERENT week must not be disturbed by rendering WEEK
    await ctx.loadWeeklyPlan(WEEK);
    E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "6-9:mon").includes("recurring:r1") && cell(E, "6-9:wed").includes("recurring:r1"),
      "this week follows the plain schedule");
    assert.strictEqual(Object.keys(ctx.__wpState.plan.exceptions).length, 0, "…and holds no exception of its own");

    // back to NEXT: still customised
    await ctx.loadWeeklyPlan(NEXT);
    E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "1-3:sat").includes("recurring:r1"), "the other week kept its exception");
    assert.ok(!cell(E, "6-9:wed").includes("recurring:r1"));
    assert.ok(cell(E, "6-9:mon").includes("recurring:r1"), "its unexcepted day still follows the schedule");
  }

  // ---------- 5: "just this week" still doesn't touch the schedule, and doesn't travel ----------
  {
    const { ctx } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    stubAsk(ctx, "week");
    ctx.wpChipDragStart(dragEv(), "recurring:r1", "6-9:mon");
    await ctx.wpCellDrop(dropEv(), "1-3", "sun");

    const it = ctx.__wpState.defaults.find((d) => d.id === "r1");
    assert.deepStrictEqual(Array.from(it.days), ["mon", "wed"], "schedule untouched by a one-week move");
    assert.strictEqual(it.time, "6-9");
    let E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "1-3:sun").includes("recurring:r1") && !cell(E, "6-9:mon").includes("recurring:r1"));

    // a skip in the same week, then check neither travels
    stubAsk(ctx, "week");
    await ctx.wpChipRemove(null, "recurring:r1", "6-9:wed");
    assert.strictEqual(ctx.__wpState.plan.exceptions["recurring:r1"].type, "skip");

    await ctx.loadWeeklyPlan(NEXT);
    assert.strictEqual(Object.keys(ctx.__wpState.plan.exceptions).length, 0, "exceptions never roll over");
    E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "6-9:mon").includes("recurring:r1") && cell(E, "6-9:wed").includes("recurring:r1"),
      "next week is back on the plain schedule");
    assert.ok(!cell(E, "1-3:sun").includes("recurring:r1"), "last week's move did not travel");

    await ctx.loadWeeklyPlan(LATER);
    E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "6-9:mon").includes("recurring:r1") && !cell(E, "1-3:sun").includes("recurring:r1"),
      "…nor into a fresh week");
  }

  // ---------- 6: one-off tasks are untouched by derivation ----------
  {
    const { ctx } = await boot({
      training: [{ id: "t9", title: "Swim" }],              // no days → one-off
      defaults: [{ id: "r0", title: "Legacy", time: "6-9" }], // pre-v64: no day set, hand-placed
      plans: {
        [WEEK]: {
          weekEnding: WEEK,
          bufferItems: [{ id: "b1", title: "Emails", done: false }],
          placements: { "6-9:mon": ["buffer:b1", "recurring:r0"], "1-3:fri": ["training:t9"] },
        },
        [NEXT]: null,
      },
    });
    await ctx.loadWeeklyPlan(WEEK);
    let E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "6-9:mon").includes("buffer:b1"), "one-off buffer renders exactly where placed");
    assert.ok(cell(E, "1-3:fri").includes("training:t9"), "unscheduled training renders where placed");
    assert.ok(cell(E, "6-9:mon").includes("recurring:r0"), "pre-v64 recurring renders where placed");

    // dragging a one-off still moves it, with no prompt and no exception
    let asked = 0;
    ctx.wpAsk = async () => { asked++; return "week"; };
    ctx.wpChipDragStart(dragEv(), "buffer:b1", "6-9:mon");
    await ctx.wpCellDrop(dropEv(), "5-8", "thu");
    assert.strictEqual(asked, 0, "no prompt for a one-off");
    assert.ok(cell(ctx.__wpState.plan.placements, "5-8:thu").includes("buffer:b1"), "stored placement moved");
    assert.strictEqual(Object.keys(ctx.__wpState.plan.exceptions).length, 0);

    // next week: the unscheduled recurring still rolls over (it has no schedule to derive);
    // one-off buffer/training do not
    await ctx.loadWeeklyPlan(NEXT);
    E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "6-9:mon").includes("recurring:r0"), "pre-v64 recurring still seeds forward");
    assert.ok(!flat(E).includes("buffer:b1"), "buffer does not roll over");
    assert.ok(!flat(E).includes("training:t9"), "one-off training does not roll over");
  }

  // ---------- 7: the card pill + 📅 editor read the live schedule in every week ----------
  {
    const { ctx } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    await ctx.wpSetRecurrence("r1", ["tue", "wed"], "10-12", "recurring");
    await ctx.loadWeeklyPlan(LATER); // a week with no stored placement at all
    assert.strictEqual(ctx.wpPlacedLabel("recurring:r1"), "Tue Wed · 9 – 11.30",
      "the pill reflects the live schedule, not a stored placement");
    const html = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(html.includes("wpToggleDoneRef('recurring:r1',this.checked,'tue')"), "chip renders on Tue in that week");
    assert.ok(html.includes("wpToggleDoneRef('recurring:r1',this.checked,'wed')"), "chip renders on Wed in that week");
  }

  // ---------- 8: "Remove from grid" on a scheduled task clears the schedule ----------
  {
    const { ctx } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    await ctx.wpUnplaceItem("recurring", "r1");
    assert.ok(!ctx.__wpState.defaults.find((d) => d.id === "r1").days, "day set cleared");
    assert.strictEqual(flat(ctx.wpEffectivePlacements()).filter((r) => r === "recurring:r1").length, 0, "off this week's grid");
    // it no longer DERIVES anywhere: a week out of reach of any old snapshot is clean
    await ctx.loadWeeklyPlan(FAR);
    assert.strictEqual(flat(ctx.wpEffectivePlacements()).filter((r) => r === "recurring:r1").length, 0,
      "an unscheduled task derives into no week at all");
    // (weeks that still hold a pre-v83 snapshot of it keep showing it, exactly as they did
    // before v83 — with no day set there's no schedule to derive from, so that stored
    // placement is treated as a hand-placed pre-v64 one and is deliberately not thrown away)
  }

  console.log("v83-schedule-propagates.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
