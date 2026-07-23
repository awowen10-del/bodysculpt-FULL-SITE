// v75 harness — the Recurring card split into Daily · Weekly · Monthly · Quarterly tabs.
// The tabs are a DISPLAY FILTER over the existing wpDefaults: which tab a task shows under
// is derived from its schedule (it.days), never a stored field. Asserts a 7-day task lands
// in Daily; a 5-day weekday task and a 1-day task both land in Weekly; every task derives
// into exactly one tab; the per-tab counts are right; Monthly/Quarterly render as empty
// placeholders; switching tabs never mutates task data; and all the underlying recurring
// behaviour (scheduling, done-state, grid placement, rollover) is unchanged.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const WEEK = "2026-03-16"; // a Monday inside NAV_WEEKS
const PREV = "2026-03-09";
const ALL7 = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"];

// A defaults set spanning every tab bucket. No placements provided for the current week and
// no prior-week plans, so nothing auto-seeds onto the grid — each task's title therefore
// only appears inside the Recurring card, making tab membership checkable from the DOM.
const defaults = () => [
  { id: "d1", title: "DailyStandup", days: ALL7.slice(), time: "6-9" },  // 7 days → Daily
  { id: "w5", title: "WeekdayScorecard", days: WEEKDAYS.slice(), time: "6-9" }, // 5 days → Weekly
  { id: "w1", title: "MondayReview", days: ["mon"], time: "10-12" },      // 1 day → Weekly
  { id: "u0", title: "UnscheduledTask" },                                  // no days → Weekly
];

(async () => {
  /* ---------- 1: derivation — 7-day → daily; 5-day + 1-day + unscheduled → weekly ---------- */
  {
    const { ctx } = await boot({ defaults: defaults(), plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    assert.strictEqual(ctx.wpRecurTab({ days: ALL7.slice() }), "daily", "7-day task → Daily");
    assert.strictEqual(ctx.wpRecurTab({ days: WEEKDAYS.slice() }), "weekly", "5-day weekday task → Weekly");
    assert.strictEqual(ctx.wpRecurTab({ days: ["mon"] }), "weekly", "1-day task → Weekly");
    assert.strictEqual(ctx.wpRecurTab({}), "weekly", "unscheduled task → Weekly");
    // and via the real loaded items
    const byId = Object.fromEntries(ctx.__wpState.defaults.map((d) => [d.id, ctx.wpRecurTab(d)]));
    assert.deepStrictEqual(byId, { d1: "daily", w5: "weekly", w1: "weekly", u0: "weekly" }, "each loaded task derives to the expected tab");
  }

  /* ---------- 2: each task appears in exactly one tab; correct rows per tab ---------- */
  {
    const { ctx } = await boot({ defaults: defaults(), plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    const titles = ["DailyStandup", "WeekdayScorecard", "MondayReview", "UnscheduledTask"];
    const seenIn = Object.fromEntries(titles.map((t) => [t, []]));
    for (const [tab] of [["daily"], ["weekly"], ["monthly"], ["quarterly"]]) {
      ctx.wpRecurSwitchTab(tab);
      const html = ctx.document.getElementById("wpBody").innerHTML;
      for (const t of titles) if (html.includes(t)) seenIn[t].push(tab);
    }
    assert.deepStrictEqual(seenIn.DailyStandup, ["daily"], "the 7-day task shows only under Daily");
    assert.deepStrictEqual(seenIn.WeekdayScorecard, ["weekly"], "the 5-day task shows only under Weekly");
    assert.deepStrictEqual(seenIn.MondayReview, ["weekly"], "the 1-day task shows only under Weekly");
    assert.deepStrictEqual(seenIn.UnscheduledTask, ["weekly"], "the unscheduled task shows only under Weekly");
    titles.forEach((t) => assert.strictEqual(seenIn[t].length, 1, `${t} appears in exactly one tab`));
  }

  /* ---------- 3: per-tab counts are correct and shown in the tab labels ---------- */
  {
    const { ctx } = await boot({ defaults: defaults(), plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    const html = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(html.includes(`Daily <span class="wp-ntab-count">1</span>`), "Daily count = 1");
    assert.ok(html.includes(`Weekly <span class="wp-ntab-count">3</span>`), "Weekly count = 3");
    assert.ok(html.includes(`Monthly <span class="wp-ntab-count">0</span>`), "Monthly count = 0");
    assert.ok(html.includes(`Quarterly <span class="wp-ntab-count">0</span>`), "Quarterly count = 0");
  }

  /* ---------- 4: Monthly & Quarterly render as empty placeholders ---------- */
  {
    const { ctx } = await boot({ defaults: defaults(), plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    for (const [tab, lbl] of [["monthly", "Monthly"], ["quarterly", "Quarterly"]]) {
      ctx.wpRecurSwitchTab(tab);
      const html = ctx.document.getElementById("wpBody").innerHTML;
      assert.ok(html.includes("wp-rec-soon") && html.includes(`${lbl} recurring is coming soon.`), `${lbl} shows the coming-soon placeholder`);
      // no recurring task rows, and no "+ Add" on placeholder tabs
      assert.ok(!html.includes("DailyStandup") && !html.includes("WeekdayScorecard"), `${lbl} renders no task rows`);
      assert.ok(!html.includes("+ Add recurring"), `${lbl} placeholder hides the + Add control`);
    }
  }

  /* ---------- 5: switching tabs never mutates task data ---------- */
  {
    const { ctx, posts } = await boot({ defaults: defaults(), plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    const before = JSON.stringify(ctx.__wpState.defaults);
    const postsBefore = posts.length;
    ["daily", "weekly", "monthly", "quarterly", "daily", "weekly"].forEach((t) => ctx.wpRecurSwitchTab(t));
    assert.strictEqual(JSON.stringify(ctx.__wpState.defaults), before, "wpDefaults unchanged by any tab switch");
    assert.strictEqual(posts.length, postsBefore, "no save fired from switching tabs (pure display filter)");
  }

  /* ---------- 6: scheduling still works AND is reflected by the derived tab ---------- */
  {
    const { ctx } = await boot({ defaults: defaults(), plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    // promote the 1-day Weekly task to all 7 days via the unchanged recurrence writer
    await ctx.wpSetRecurrence("w1", ALL7.slice(), "10-12");
    assert.strictEqual(ctx.wpPlacementsOf("recurring:w1").length, 7, "scheduling placed the task on all 7 days");
    assert.strictEqual(ctx.wpRecurTab(ctx.wpResolveRef("recurring:w1")), "daily", "now-7-day task derives into Daily");
    // demote back to weekday-only → Weekly again
    await ctx.wpSetRecurrence("w1", WEEKDAYS.slice(), "10-12");
    assert.strictEqual(ctx.wpRecurTab(ctx.wpResolveRef("recurring:w1")), "weekly", "weekday task derives back into Weekly");
  }

  /* ---------- 7: done-state + grid placement unchanged (scoped to a tab-filtered card) ---------- */
  {
    const { ctx } = await boot({
      defaults: defaults(),
      plans: { [WEEK]: { weekEnding: WEEK, placements: { ["6-9:mon"]: ["recurring:d1"], ["6-9:tue"]: ["recurring:d1"] } } },
    });
    await ctx.loadWeeklyPlan(WEEK);
    // tick a per-day done on the daily task — same keys as before the tabs existed
    await ctx.wpToggleDoneRef("recurring:d1", true, "mon");
    assert.strictEqual(ctx.__wpState.plan.recurringDone["d1:mon"], true, "per-day done key written as usual");
    // the grid still renders its chip regardless of which recurring tab is active
    ctx.wpRecurSwitchTab("quarterly"); // a placeholder tab
    const html = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(html.includes("wpToggleDoneRef('recurring:d1'"), "grid chip for the daily task renders independent of the active recurring tab");
  }

  /* ---------- 8: v62 rollover of recurring placements is unchanged ---------- */
  {
    const plans = {
      [WEEK]: null, // fresh week
      [PREV]: { weekEnding: PREV, placements: { "6-9:mon": ["recurring:d1"], "6-9:tue": ["recurring:d1"] } },
    };
    const { ctx } = await boot({ defaults: defaults(), plans });
    await ctx.loadWeeklyPlan(WEEK);
    const P = ctx.__wpState.plan.placements;
    assert.ok((P["6-9:mon"] || []).includes("recurring:d1") && (P["6-9:tue"] || []).includes("recurring:d1"), "recurring placements still roll over into a fresh week");
  }

  /* ---------- 9: + Add lands the new task in a sensible (visible) tab ---------- */
  {
    const { ctx } = await boot({ defaults: defaults(), plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpRecurSwitchTab("daily"); // sitting on a different tab than where the add will land
    ctx.prompt = () => "Brand New Task"; // the env stub returns null by default; supply a title
    await ctx.wpAddRecurring();
    const html = ctx.document.getElementById("wpBody").innerHTML;
    // a fresh unscheduled task derives to Weekly, and the card jumped there so it's visible
    assert.ok(html.includes(`class="wp-ntab active" onclick="wpRecurSwitchTab('weekly')"`), "adding switched the card to the Weekly tab");
    assert.ok(html.includes("Brand New Task"), "the newly added task is visible in its tab");
    assert.ok(ctx.__wpState.defaults.some((d) => d.title === "Brand New Task"), "the task was appended to wpDefaults");
  }

  console.log("v75-recurring-tabs.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
