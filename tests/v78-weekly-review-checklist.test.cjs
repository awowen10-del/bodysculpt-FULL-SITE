// v78 harness — the End-of-Week Review close-out ritual checklist. Asserts all six items
// render in the exact order, above the review fields; that ticks are stored per-week (keyed
// by item id), persist through the review save path, don't leak between weeks, and that a
// fresh week starts unticked; that the "N of 6" progress is correct; and that the existing
// review content (Wins / What didn't get done / Issues) is unaffected.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const WEEK = "2026-03-16"; // a Monday inside NAV_WEEKS
const NEXT = "2026-03-23";

// The six steps, in the exact required order.
const EXPECTED = [
  "Training sessions diarised + checked in with coach",
  "Intentions around food set",
  "Business + personal priorities planned",
  "Reflect on last week",
  "To-do list written",
  "Consume something motivational or educational",
];
const IDS = ["training", "food", "priorities", "reflect", "todo", "motivation"];

// vm-realm objects/arrays fail deepStrictEqual's prototype check — normalise via JSON.
const plain = (o) => JSON.parse(JSON.stringify(o));
const checklistSaves = (posts) => posts.filter((p) => p.body.weeklyPlan && "reviewChecklist" in p.body.weeklyPlan);

(async () => {
  /* ---------- 1: all six items render in the correct order, above the review fields ---------- */
  {
    const { ctx } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    const body = ctx.document.getElementById("wpBody").innerHTML;

    // all six labels present, numbered, and in ascending position (rendered in order)
    let last = -1;
    EXPECTED.forEach((label, i) => {
      const at = body.indexOf(label);
      assert.ok(at !== -1, `item ${i + 1} rendered: ${label}`);
      assert.ok(at > last, `item ${i + 1} appears after item ${i}`);
      last = at;
      assert.ok(body.includes(`<span class="wp-rc-num">${i + 1}</span>`), `item ${i + 1} numbered ${i + 1}`);
    });
    // ids wired to the toggle in the same order
    let lastId = -1;
    IDS.forEach((id, i) => {
      const at = body.indexOf(`wpToggleReviewChecklist('${id}')`);
      assert.ok(at !== -1, `item ${i + 1} toggles id '${id}'`);
      assert.ok(at > lastId, `id '${id}' wired in order`);
      lastId = at;
    });

    // the checklist sits ABOVE the review fields (Wins etc.)
    assert.ok(body.includes("Weekly close-out ritual"), "checklist header rendered");
    assert.ok(body.indexOf("Weekly close-out ritual") < body.indexOf("Wins this week"), "checklist is above the Wins field");
    assert.ok(body.indexOf("Weekly close-out ritual") < body.indexOf("What didn't get done?"), "…and above the rest of the review grid");
  }

  /* ---------- 2: a fresh week starts unticked, progress 0 of 6 ---------- */
  {
    const { ctx } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    assert.strictEqual(Object.keys(ctx.__wpState.plan.reviewChecklist).length, 0, "fresh week: empty checklist map");
    const body = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(body.includes(`<span class="wp-rc-progress">0 of 6</span>`), "fresh week shows 0 of 6");
    assert.ok(!body.includes(`class="wp-rc-item done"`), "no ritual item is pre-ticked/struck");
  }

  /* ---------- 3: ticking persists per week, progress updates, existing review untouched ---------- */
  {
    const { ctx, posts } = await boot({
      plans: { [WEEK]: { weekEnding: WEEK, placements: {}, review: { wins: "shipped v78", notDone: "the gym audit", carryForward: "", blockers: "none" } } },
    });
    await ctx.loadWeeklyPlan(WEEK);
    const st = ctx.__wpState;

    await ctx.wpToggleReviewChecklist("training");
    await ctx.wpToggleReviewChecklist("priorities");
    await ctx.wpToggleReviewChecklist("todo");

    assert.deepStrictEqual(plain(st.plan.reviewChecklist), { training: true, priorities: true, todo: true }, "ticked ids stored on the per-week map");
    const body = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(body.includes(`<span class="wp-rc-progress">3 of 6</span>`), "progress shows 3 of 6");
    assert.ok(body.includes(`class="wp-rc-item done"`), "ticked items carry the done (struck) class");

    // saved through the REVIEW path, carrying both review + reviewChecklist, and nothing unrelated
    const last = checklistSaves(posts).pop();
    assert.ok(last, "a save carried reviewChecklist");
    assert.deepStrictEqual(last.body.weeklyPlan.reviewChecklist, { training: true, priorities: true, todo: true }, "checklist round-trips to the store");
    assert.deepStrictEqual(last.body.weeklyPlan.review, { wins: "shipped v78", notDone: "the gym audit", carryForward: "", blockers: "none" }, "existing review content saved alongside, unchanged");
    assert.ok(!("notes" in last.body.weeklyPlan) && !("placements" in last.body.weeklyPlan), "the review save doesn't drag in unrelated sections");

    // un-tick removes the key (progress falls) — existing review still intact
    await ctx.wpToggleReviewChecklist("training");
    assert.deepStrictEqual(plain(st.plan.reviewChecklist), { priorities: true, todo: true }, "un-ticking removes the id");
    assert.strictEqual(st.plan.review.wins, "shipped v78", "review fields never touched by the checklist");
    assert.ok(ctx.document.getElementById("wpBody").innerHTML.includes(`<span class="wp-rc-progress">2 of 6</span>`), "progress back to 2 of 6");
  }

  /* ---------- 4: ticks are per-week — they don't leak, and each week keeps its own ---------- */
  {
    const { ctx } = await boot({
      plans: {
        [WEEK]: { weekEnding: WEEK, placements: {}, reviewChecklist: { training: true, food: true } },
        [NEXT]: { weekEnding: NEXT, placements: {} }, // next week has no checklist at all
      },
    });
    await ctx.loadWeeklyPlan(WEEK);
    assert.deepStrictEqual(plain(ctx.__wpState.plan.reviewChecklist), { training: true, food: true }, "this week loads its own saved ticks");
    assert.ok(ctx.document.getElementById("wpBody").innerHTML.includes(`<span class="wp-rc-progress">2 of 6</span>`), "this week: 2 of 6");

    // move to next week → starts fresh/unticked
    await ctx.loadWeeklyPlan(NEXT);
    assert.strictEqual(Object.keys(ctx.__wpState.plan.reviewChecklist).length, 0, "next week starts with no ticks (no leak)");
    assert.ok(ctx.document.getElementById("wpBody").innerHTML.includes(`<span class="wp-rc-progress">0 of 6</span>`), "next week: 0 of 6");

    // go back → last week's state is preserved
    await ctx.loadWeeklyPlan(WEEK);
    assert.deepStrictEqual(plain(ctx.__wpState.plan.reviewChecklist), { training: true, food: true }, "returning to the week restores its ticks");
  }

  /* ---------- 5: an all-ticked week reports 6 of 6 ---------- */
  {
    const full = Object.fromEntries(IDS.map((id) => [id, true]));
    const { ctx } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {}, reviewChecklist: full } } });
    await ctx.loadWeeklyPlan(WEEK);
    assert.ok(ctx.document.getElementById("wpBody").innerHTML.includes(`<span class="wp-rc-progress">6 of 6</span>`), "all ticked → 6 of 6");
  }

  /* ---------- 6: a bogus/legacy checklist shape is coerced to empty, never crashes ---------- */
  {
    const { ctx } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {}, reviewChecklist: ["not", "an", "object"] } } });
    await ctx.loadWeeklyPlan(WEEK);
    assert.strictEqual(Object.keys(ctx.__wpState.plan.reviewChecklist).length, 0, "array/garbage checklist coerced to an empty map");
    assert.ok(ctx.document.getElementById("wpBody").innerHTML.includes(`<span class="wp-rc-progress">0 of 6</span>`), "…and shows 0 of 6");
  }

  console.log("v78-weekly-review-checklist.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
