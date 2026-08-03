// v82 regression: per-week exceptions for scheduled tasks (recurring + training).
// A move/skip is an overlay on THIS week only — the task's schedule is untouched, the
// stored placements stay schedule-derived, and nothing leaks into another week.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const WEEK = "2026-03-16"; // a Monday inside NAV_WEEKS
const PREV = "2026-03-09";
const NEXT = "2026-03-23";

const dragEv = () => ({ dataTransfer: { setData() {} } });
const dropEv = () => ({
  preventDefault() {},
  currentTarget: { classList: { remove() {} } },
  dataTransfer: { getData: () => "" },
});
const cell = (P, k) => Array.from(P[k] || []);
const weeklyPosts = (posts) => posts.filter((p) => p.body && p.body.weeklyPlan);
const defaultsPosts = (posts) => posts.filter((p) => p.body && Array.isArray(p.body.recurringDefaults));
const trainingPosts = (posts) => posts.filter((p) => p.body && Array.isArray(p.body.trainingDefaults));

// A week with one 2-day recurring task (Mon + Wed at 6-9) already placed from its schedule.
function recurringWeek(extra) {
  return {
    defaults: [{ id: "r1", title: "Scorecard", days: ["mon", "wed"], time: "6-9" }],
    plans: {
      [WEEK]: Object.assign(
        {
          weekEnding: WEEK,
          placements: { "6-9:mon": ["recurring:r1"], "6-9:wed": ["recurring:r1"] },
        },
        extra || {}
      ),
    },
  };
}
// Stub the modal (the real one builds DOM) and record what it was asked.
function stubAsk(ctx, answer) {
  const asks = [];
  ctx.wpAsk = async (opts) => { asks.push(opts); return answer; };
  return asks;
}

(async () => {
  // ---------- 1: moving "just this week" ----------
  {
    const { ctx, posts } = await boot(recurringWeek());
    await ctx.loadWeeklyPlan(WEEK);
    const asks = stubAsk(ctx, "week");
    const before = posts.length;

    ctx.wpChipDragStart(dragEv(), "recurring:r1", "6-9:mon");
    await ctx.wpCellDrop(dropEv(), "10-12", "tue");

    assert.strictEqual(asks.length, 1, "dragging a scheduled chip asks first");
    const ex = ctx.__wpState.plan.exceptions["recurring:r1"];
    assert.ok(ex, "a week exception was recorded");
    assert.strictEqual(ex.type, "move");
    assert.strictEqual(ex.from, "6-9:mon");
    assert.strictEqual(ex.to, "10-12:tue");

    // the SCHEDULE is untouched…
    const it = ctx.__wpState.defaults.find((d) => d.id === "r1");
    assert.deepStrictEqual(Array.from(it.days), ["mon", "wed"], "days unchanged");
    assert.strictEqual(it.time, "6-9", "slot unchanged");
    assert.strictEqual(defaultsPosts(posts.slice(before)).length, 0, "no defaults save — the pattern didn't change");
    // …and so are the stored (schedule-derived) placements
    const P = ctx.__wpState.plan.placements;
    assert.ok(cell(P, "6-9:mon").includes("recurring:r1"), "stored placement still on Mon");
    assert.ok(!cell(P, "10-12:tue").includes("recurring:r1"), "the move is not baked into placements");

    // rendering applies it on top
    const E = ctx.wpEffectivePlacements();
    assert.ok(!cell(E, "6-9:mon").includes("recurring:r1"), "Mon occurrence relocated");
    assert.ok(cell(E, "10-12:tue").includes("recurring:r1"), "renders in the new cell");
    assert.ok(cell(E, "6-9:wed").includes("recurring:r1"), "the other scheduled day is untouched");

    const saved = weeklyPosts(posts).pop();
    assert.ok(saved && saved.body.weeklyPlan.exceptions["recurring:r1"], "exception persisted on the timeBlocks save");
    assert.strictEqual(saved.body.weeklyPlan.weekEnding, WEEK, "saved against this week only");
  }

  // ---------- 2: moving "all / whole schedule" ----------
  {
    const { ctx, posts } = await boot(recurringWeek());
    await ctx.loadWeeklyPlan(WEEK);
    stubAsk(ctx, "all");
    const before = posts.length;

    ctx.wpChipDragStart(dragEv(), "recurring:r1", "6-9:mon");
    await ctx.wpCellDrop(dropEv(), "10-12", "tue");

    const it = ctx.__wpState.defaults.find((d) => d.id === "r1");
    assert.deepStrictEqual(Array.from(it.days), ["tue", "wed"], "mon → tue in the real schedule");
    assert.strictEqual(it.time, "10-12", "slot changed for the set");
    assert.strictEqual(Object.keys(ctx.__wpState.plan.exceptions).length, 0, "no week exception created");

    const P = ctx.__wpState.plan.placements;
    assert.ok(cell(P, "10-12:tue").includes("recurring:r1"), "real placement moved");
    assert.ok(cell(P, "10-12:wed").includes("recurring:r1"), "whole set moved to the new slot");
    assert.ok(!cell(P, "6-9:mon").includes("recurring:r1"), "old cell cleared");

    const dp = defaultsPosts(posts.slice(before)).pop();
    assert.ok(dp, "the schedule was saved through the defaults path");
    assert.deepStrictEqual(Array.from(dp.body.recurringDefaults.find((d) => d.id === "r1").days), ["tue", "wed"]);
  }

  // ---------- 3: removing "just this week" ----------
  {
    const { ctx, posts } = await boot(recurringWeek());
    await ctx.loadWeeklyPlan(WEEK);
    const asks = stubAsk(ctx, "week");

    await ctx.wpChipRemove(null, "recurring:r1", "6-9:mon");

    assert.strictEqual(asks.length, 1, "removing a scheduled chip asks first");
    const ex = ctx.__wpState.plan.exceptions["recurring:r1"];
    assert.strictEqual(ex.type, "skip");
    assert.strictEqual(ex.from, "6-9:mon");
    assert.ok(ctx.__wpState.defaults.some((d) => d.id === "r1"), "the task itself survives");
    assert.ok(cell(ctx.__wpState.plan.placements, "6-9:mon").includes("recurring:r1"), "schedule placement kept");

    const E = ctx.wpEffectivePlacements();
    assert.ok(!cell(E, "6-9:mon").includes("recurring:r1"), "skipped occurrence is hidden");
    assert.ok(cell(E, "6-9:wed").includes("recurring:r1"), "only that occurrence is skipped");
    assert.ok(weeklyPosts(posts).pop().body.weeklyPlan.exceptions["recurring:r1"], "skip persisted");
  }

  // ---------- 3b: …and it's back next week ----------
  {
    const { ctx } = await boot({
      defaults: [{ id: "r1", title: "Scorecard", days: ["mon", "wed"], time: "6-9" }],
      plans: {
        [WEEK]: {
          weekEnding: WEEK,
          placements: { "6-9:mon": ["recurring:r1"], "6-9:wed": ["recurring:r1"] },
          exceptions: { "recurring:r1": { type: "skip", from: "6-9:mon" } },
        },
        [NEXT]: null, // fresh week — seeds from WEEK
      },
    });
    await ctx.loadWeeklyPlan(NEXT);
    assert.strictEqual(Object.keys(ctx.__wpState.plan.exceptions).length, 0, "no exception carried into the new week");
    const E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "6-9:mon").includes("recurring:r1"), "the skipped occurrence returns next week");
    assert.ok(cell(E, "6-9:wed").includes("recurring:r1"));
  }

  // ---------- 4: removing "entirely" ----------
  {
    const { ctx, posts } = await boot(recurringWeek({
      exceptions: { "recurring:r1": { type: "move", from: "6-9:mon", to: "10-12:tue" } },
    }));
    await ctx.loadWeeklyPlan(WEEK);
    stubAsk(ctx, "all");

    await ctx.wpChipRemove(null, "recurring:r1", "10-12:tue");

    assert.ok(!ctx.__wpState.defaults.some((d) => d.id === "r1"), "task deleted from the recurring list");
    const all = Object.values(ctx.__wpState.plan.placements).flatMap((v) => Array.from(v));
    assert.ok(!all.includes("recurring:r1"), "cleared from every cell");
    assert.strictEqual(Object.keys(ctx.__wpState.plan.exceptions).length, 0, "its exception went with it");
    const dp = defaultsPosts(posts).pop();
    assert.ok(!dp.body.recurringDefaults.some((d) => d.id === "r1"), "deletion persisted to the defaults blob");
  }

  // ---------- 5: exceptions never roll over into a fresh week ----------
  {
    const { ctx, posts } = await boot({
      defaults: [{ id: "r1", title: "Scorecard", days: ["mon", "wed"], time: "6-9" }],
      plans: {
        [WEEK]: null,
        [PREV]: {
          weekEnding: PREV,
          placements: { "6-9:mon": ["recurring:r1"], "6-9:wed": ["recurring:r1"] },
          // last week both skipped a day AND moved the other one
          exceptions: { "recurring:r1": { type: "move", from: "6-9:wed", to: "5-8:sat" } },
        },
      },
    });
    await ctx.loadWeeklyPlan(WEEK);
    assert.strictEqual(Object.keys(ctx.__wpState.plan.exceptions).length, 0, "v62 seeding ignores exceptions");
    const P = ctx.__wpState.plan.placements;
    assert.ok(cell(P, "6-9:mon").includes("recurring:r1"), "seeded from the schedule");
    assert.ok(cell(P, "6-9:wed").includes("recurring:r1"), "seeded from the schedule, not last week's move");
    assert.ok(!cell(P, "5-8:sat").includes("recurring:r1"), "last week's move did not travel");
    const E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "6-9:wed").includes("recurring:r1"), "renders per schedule");
    assert.strictEqual(weeklyPosts(posts).length, 0, "a plain load writes nothing");
  }

  // ---------- 6: render precedence (skip hides, move relocates, else schedule) ----------
  {
    const { ctx } = await boot(recurringWeek());
    await ctx.loadWeeklyPlan(WEEK);
    const plan = ctx.__wpState.plan;

    plan.exceptions = { "recurring:r1": { type: "skip", from: "6-9:wed" } };
    let E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "6-9:mon").includes("recurring:r1"), "unexcepted day follows the schedule");
    assert.ok(!cell(E, "6-9:wed").includes("recurring:r1"), "skip hides");

    plan.exceptions = { "recurring:r1": { type: "move", from: "6-9:wed", to: "1-3:sun" } };
    E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "1-3:sun").includes("recurring:r1"), "move relocates");
    assert.ok(!cell(E, "6-9:wed").includes("recurring:r1"), "…and vacates the scheduled cell");
    assert.ok(cell(E, "6-9:mon").includes("recurring:r1"), "other days unaffected");

    // stale: the schedule no longer places it where the exception says it came from
    plan.exceptions = { "recurring:r1": { type: "move", from: "5-8:fri", to: "1-3:sun" } };
    E = ctx.wpEffectivePlacements();
    assert.ok(!cell(E, "1-3:sun").includes("recurring:r1"), "stale exception ignored");
    assert.ok(cell(E, "6-9:mon").includes("recurring:r1") && cell(E, "6-9:wed").includes("recurring:r1"),
      "schedule wins when the exception is stale");

    // junk / deleted task / one-off refs never take effect
    plan.exceptions = {
      "recurring:gone": { type: "skip", from: "6-9:mon" },
      "recurring:r1": { type: "move", from: "6-9:mon", to: "nope:mon" },
    };
    E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "6-9:mon").includes("recurring:r1"), "invalid move target ignored");
    assert.strictEqual(cell(E, "nope:mon").length, 0, "no phantom cell created");
  }

  // ---------- 7: training runs the same path ----------
  {
    const training = [{ id: "t1", title: "Reformer", days: ["tue", "thu"], time: "5-8" }];
    const { ctx, posts } = await boot({
      training,
      plans: { [WEEK]: { weekEnding: WEEK, placements: { "5-8:tue": ["training:t1"], "5-8:thu": ["training:t1"] } } },
    });
    await ctx.loadWeeklyPlan(WEEK);
    const asks = stubAsk(ctx, "week");

    ctx.wpChipDragStart(dragEv(), "training:t1", "5-8:tue");
    await ctx.wpCellDrop(dropEv(), "6-9", "wed");

    assert.strictEqual(asks.length, 1, "training chips ask too");
    const ex = ctx.__wpState.plan.exceptions["training:t1"];
    assert.strictEqual(ex.type, "move");
    assert.strictEqual(ex.to, "6-9:wed");
    const it = ctx.__wpState.training.find((d) => d.id === "t1");
    assert.deepStrictEqual(Array.from(it.days), ["tue", "thu"], "training schedule unchanged");
    assert.strictEqual(it.time, "5-8");
    let E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "6-9:wed").includes("training:t1") && !cell(E, "5-8:tue").includes("training:t1"));

    // …and the skip half, through the same shared function
    stubAsk(ctx, "week");
    await ctx.wpChipRemove(null, "training:t1", "5-8:thu");
    assert.strictEqual(ctx.__wpState.plan.exceptions["training:t1"].type, "skip", "skip replaces the move");
    E = ctx.wpEffectivePlacements();
    assert.ok(!cell(E, "5-8:thu").includes("training:t1"), "skipped");
    assert.ok(cell(E, "5-8:tue").includes("training:t1"), "back on its schedule (the move was superseded)");

    // remove entirely deletes the training task everywhere
    stubAsk(ctx, "all");
    await ctx.wpChipRemove(null, "training:t1", "5-8:tue");
    assert.ok(!ctx.__wpState.training.some((d) => d.id === "t1"), "training task deleted");
    assert.strictEqual(Object.keys(ctx.__wpState.plan.exceptions).length, 0);
    assert.ok(!trainingPosts(posts).pop().body.trainingDefaults.some((d) => d.id === "t1"), "deletion persisted");
  }

  // ---------- 8: one-off tasks are unaffected (no prompt, existing behaviour) ----------
  {
    const { ctx } = await boot({
      // unscheduled training (no days) is a one-off as far as the grid is concerned
      training: [{ id: "t9", title: "Swim" }],
      plans: {
        [WEEK]: {
          weekEnding: WEEK,
          bufferItems: [{ id: "b1", title: "Emails", done: false }],
          placements: { "6-9:mon": ["buffer:b1"], "1-3:fri": ["training:t9"] },
        },
      },
    });
    await ctx.loadWeeklyPlan(WEEK);
    const asks = stubAsk(ctx, "week");

    ctx.wpChipDragStart(dragEv(), "buffer:b1", "6-9:mon");
    await ctx.wpCellDrop(dropEv(), "5-8", "thu");
    ctx.wpChipDragStart(dragEv(), "training:t9", "1-3:fri");
    await ctx.wpCellDrop(dropEv(), "5-8", "sat");

    assert.strictEqual(asks.length, 0, "one-off drags never prompt");
    let P = ctx.__wpState.plan.placements;
    assert.ok(cell(P, "5-8:thu").includes("buffer:b1") && !cell(P, "6-9:mon").includes("buffer:b1"), "buffer chip moved as before");
    assert.ok(cell(P, "5-8:sat").includes("training:t9"), "unscheduled training moved as before");
    assert.strictEqual(Object.keys(ctx.__wpState.plan.exceptions).length, 0, "no exceptions written for one-offs");

    await ctx.wpChipRemove(null, "buffer:b1", "5-8:thu");
    assert.strictEqual(asks.length, 0, "one-off remove never prompts");
    P = ctx.__wpState.plan.placements;
    assert.ok(!Object.values(P).flatMap((v) => Array.from(v)).includes("buffer:b1"), "taken off the grid");
    assert.ok(ctx.__wpState.plan.bufferItems.some((i) => i.id === "b1"), "…but still in the Buffer list");
    assert.strictEqual(Object.keys(ctx.__wpState.plan.exceptions).length, 0);
  }

  // ---------- 9: a week with no exceptions behaves exactly as before ----------
  {
    const { ctx, posts } = await boot(recurringWeek());
    await ctx.loadWeeklyPlan(WEEK);
    const plan = ctx.__wpState.plan;
    assert.strictEqual(Object.keys(plan.exceptions).length, 0, "fresh/legacy weeks start with none");
    assert.strictEqual(ctx.wpEffectivePlacements(), plan.placements, "renders through the identical map");

    await ctx.wpSaveSection("timeBlocks");
    const saved = weeklyPosts(posts).pop().body.weeklyPlan;
    assert.strictEqual(Object.keys(saved.exceptions).length, 0, "saves an empty map, never junk");
    assert.ok(saved.placements && saved.recurringDone && saved.trainingDone, "the rest of the section is unchanged");

    // chip markup: the grid chip carries its cell (drag origin + ✕), the Today chip doesn't
    const gridChip = ctx.wpChipHtml("recurring:r1", "mon", "", "6-9:mon");
    assert.ok(gridChip.includes("wpChipDragStart(event,'recurring:r1','6-9:mon')"), "drag carries the origin cell");
    assert.ok(gridChip.includes("wpChipRemove(event,'recurring:r1','6-9:mon')"), "grid chip has a ✕");
    assert.ok(!ctx.wpChipHtml("recurring:r1", "mon", "today").includes("wpChipRemove"), "Today modal chip unchanged");
  }

  // ---------- 10: a moved occurrence keeps its done-state ----------
  {
    const { ctx } = await boot(recurringWeek({ recurringDone: { "r1:mon": true } }));
    await ctx.loadWeeklyPlan(WEEK);
    stubAsk(ctx, "week");
    assert.strictEqual(ctx.wpIsDone("recurring", ctx.__wpState.defaults[0], "mon"), true, "ticked before the move");

    ctx.wpChipDragStart(dragEv(), "recurring:r1", "6-9:mon");
    await ctx.wpCellDrop(dropEv(), "10-12", "tue");

    const it = ctx.__wpState.defaults[0];
    assert.strictEqual(ctx.wpIsDone("recurring", it, "tue"), true, "tick travelled with the occurrence");
    assert.strictEqual(ctx.wpIsDone("recurring", it, "mon"), false, "and left the old day");
  }

  // ---------- 11: dropping a moved chip back on its scheduled cell clears the exception ----------
  {
    const { ctx } = await boot(recurringWeek({
      exceptions: { "recurring:r1": { type: "move", from: "6-9:mon", to: "10-12:tue" } },
    }));
    await ctx.loadWeeklyPlan(WEEK);
    stubAsk(ctx, "week");

    ctx.wpChipDragStart(dragEv(), "recurring:r1", "10-12:tue");
    await ctx.wpCellDrop(dropEv(), "6-9", "mon");

    assert.strictEqual(Object.keys(ctx.__wpState.plan.exceptions).length, 0, "back home → exception dropped");
    const E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "6-9:mon").includes("recurring:r1"), "renders on its schedule again");
  }

  // ---------- 12: editing the schedule supersedes this week's exception ----------
  {
    const { ctx } = await boot(recurringWeek({
      exceptions: { "recurring:r1": { type: "skip", from: "6-9:mon" } },
    }));
    await ctx.loadWeeklyPlan(WEEK);
    await ctx.wpSetRecurrence("r1", ["mon", "fri"], "1-3", "recurring");
    assert.strictEqual(Object.keys(ctx.__wpState.plan.exceptions).length, 0, "📅 editor clears the stale exception");
    const E = ctx.wpEffectivePlacements();
    assert.ok(cell(E, "1-3:mon").includes("recurring:r1") && cell(E, "1-3:fri").includes("recurring:r1"));
  }

  console.log("v82-weekly-exceptions.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
