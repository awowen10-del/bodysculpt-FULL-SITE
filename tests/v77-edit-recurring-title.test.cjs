// v77 harness — recurring (and training) task titles are editable in place, reusing the
// Project/Buffer inline-edit behaviour but saving through the defaults path. Asserts a
// rename persists and keeps the same id; that the id's placements, days/slot schedule,
// done-state and link all survive the rename; that an empty title reverts (never blanks the
// task); that Escape cancels; that the new title shows on the card, grid chip and Today
// modal; and that training titles are editable too and re-detect their title-derived emoji.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const WEEK = "2026-03-16"; // a Monday inside NAV_WEEKS
const ALL_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const NOW = new Date();
function mondayIso(d) {
  const x = new Date(d);
  const back = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - back);
  x.setUTCHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}
const TODAY_WEEK = mondayIso(NOW);
const TODAY = ALL_DAYS[NOW.getUTCDay()];

// The blur handler reads the edited value via document.querySelector('[data-item-title=…]').
// The stub DOM returns null there, so a rename is simulated by pointing document.querySelector
// at a tiny stand-in input carrying the new value, then invoking wpDefaultTitleBlur.
const setInputValue = (ctx, value) => { ctx.document.querySelector = () => ({ value }); };

(async () => {
  /* ---------- 1: a recurring rename persists, keeps the id, and survives schedule/done/link ---------- */
  {
    const defaults = [{ id: "r1", title: "Scorecard", days: ["mon", "wed", "fri"], time: "10-12", link: "https://example.com/x" }];
    const { ctx, posts } = await boot({ defaults, plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    const st = ctx.__wpState;

    // seed a per-day done tick + confirm the schedule placed it on its 3 days
    await ctx.wpSetRecurrence("r1", ["mon", "wed", "fri"], "10-12");
    await ctx.wpToggleDoneRef("recurring:r1", true, "wed");
    const placementsBefore = Array.from(ctx.wpPlacementsOf("recurring:r1")).sort();
    assert.deepStrictEqual(placementsBefore, ["10-12:fri", "10-12:mon", "10-12:wed"], "scheduled on its 3 days before rename");

    // rename via the real inline-edit path (the input carries the id-keyed data attr)
    setInputValue(ctx, "Weekly Scorecard");
    await ctx.wpDefaultTitleBlur("recurring", "r1");

    const item = st.defaults.find((d) => d.id === "r1");
    assert.ok(item, "the task is still present under the SAME id r1");
    assert.strictEqual(item.title, "Weekly Scorecard", "title updated in the defaults");
    // id-anchored state all preserved
    assert.deepStrictEqual(Array.from(item.days), ["mon", "wed", "fri"], "days/slot schedule preserved");
    assert.strictEqual(item.time, "10-12", "time slot preserved");
    assert.strictEqual(item.link, "https://example.com/x", "link preserved");
    assert.deepStrictEqual(Array.from(ctx.wpPlacementsOf("recurring:r1")).sort(), placementsBefore, "grid placements not orphaned by the rename");
    assert.strictEqual(st.plan.recurringDone["r1:wed"], true, "per-day done-state preserved");

    // persisted through the SAME defaults save path
    const defSave = posts.filter((p) => Array.isArray(p.body.recurringDefaults)).pop();
    assert.ok(defSave, "recurring defaults saved");
    const saved = defSave.body.recurringDefaults.find((d) => d.id === "r1");
    assert.strictEqual(saved.title, "Weekly Scorecard", "new title round-trips to the recurring defaults store");
    assert.deepStrictEqual(saved.days, ["mon", "wed", "fri"], "schedule round-trips with the same id");
  }

  /* ---------- 2: new title shows on the card, grid chip and Today modal ---------- */
  {
    const defaults = [{ id: "r1", title: "OldName", days: [TODAY], time: "6-9" }];
    const plans = { [TODAY_WEEK]: { weekEnding: TODAY_WEEK, placements: { ["6-9:" + TODAY]: ["recurring:r1"] } } };
    const { ctx } = await boot({ defaults, plans });
    await ctx.loadWeeklyPlan(TODAY_WEEK);

    setInputValue(ctx, "NewShinyName");
    await ctx.wpDefaultTitleBlur("recurring", "r1");

    const body = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(body.includes(`value="NewShinyName"`), "card row input shows the new title");
    assert.ok(!body.includes("OldName"), "old title gone from the card");
    assert.ok(body.includes("NewShinyName"), "grid chip shows the new title");
    // Today modal reads the same placement/title on open
    ctx.wpOpenToday();
    assert.ok(ctx.document.getElementById("wpTodayBody").innerHTML.includes("NewShinyName"), "Today modal shows the new title");
    ctx.wpCloseToday();
  }

  /* ---------- 3: empty title reverts to the previous title (never blanks/deletes) ---------- */
  {
    const defaults = [{ id: "r1", title: "KeepMe", days: ["mon"], time: "6-9" }];
    const { ctx, posts } = await boot({ defaults, plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    const before = posts.length;

    setInputValue(ctx, "   "); // whitespace-only
    await ctx.wpDefaultTitleBlur("recurring", "r1");

    const item = ctx.__wpState.defaults.find((d) => d.id === "r1");
    assert.ok(item, "the task is NOT deleted by an empty rename");
    assert.strictEqual(item.title, "KeepMe", "title reverts to the previous value");
    assert.deepStrictEqual(Array.from(item.days), ["mon"], "schedule untouched by the reverted empty edit");
    assert.strictEqual(posts.length, before, "no save fired for an empty (reverted) rename");
  }

  /* ---------- 4: Escape cancels an in-progress edit without saving ---------- */
  {
    const defaults = [{ id: "r1", title: "Original", days: ["mon"], time: "6-9" }];
    const { ctx, posts } = await boot({ defaults, plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    const before = posts.length;

    // wpItemKey Escape clears the input, then blurs → blank → revert to previous (cancel)
    let blurred = false;
    const fakeInput = { value: "half-typed new name", blur() { blurred = true; } };
    ctx.wpItemKey({ key: "Escape", preventDefault() {}, target: fakeInput });
    assert.strictEqual(fakeInput.value, "", "Escape clears the input");
    assert.ok(blurred, "Escape blurs the field");
    // simulate the ensuing blur with the now-empty input
    setInputValue(ctx, "");
    await ctx.wpDefaultTitleBlur("recurring", "r1");

    assert.strictEqual(ctx.__wpState.defaults.find((d) => d.id === "r1").title, "Original", "Escape leaves the original title");
    assert.strictEqual(posts.length, before, "Escape-cancel does not save");
  }

  /* ---------- 5: an unchanged edit does not fire a save ---------- */
  {
    const defaults = [{ id: "r1", title: "Same", days: ["mon"], time: "6-9" }];
    const { ctx, posts } = await boot({ defaults, plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    const before = posts.length;
    setInputValue(ctx, "Same");
    await ctx.wpDefaultTitleBlur("recurring", "r1");
    assert.strictEqual(posts.length, before, "no save when the title is unchanged");
  }

  /* ---------- 6: training titles are editable too and re-detect their emoji ---------- */
  {
    const training = [{ id: "t1", title: "Gym", days: [TODAY], time: "6-9" }]; // 🏋️, placed today
    const plans = { [TODAY_WEEK]: { weekEnding: TODAY_WEEK, placements: { ["6-9:" + TODAY]: ["training:t1"] } } };
    const { ctx, posts } = await boot({ training, plans });
    await ctx.loadWeeklyPlan(TODAY_WEEK);

    // sanity: starts as a barbell
    assert.strictEqual(ctx.wpTrainingEmoji(ctx.wpResolveRef("training:t1")), "🏋️", "starts 🏋️ (Gym)");

    setInputValue(ctx, "Morning swim");
    await ctx.wpDefaultTitleBlur("training", "t1");

    const item = ctx.__wpState.training.find((t) => t.id === "t1");
    assert.strictEqual(item.id, "t1", "same id kept");
    assert.strictEqual(item.title, "Morning swim", "training title updated");
    assert.deepStrictEqual(Array.from(item.days), [TODAY], "training schedule preserved across rename");
    assert.strictEqual(ctx.wpTrainingEmoji(item), "🏊", "emoji re-detected from the new title → 🏊");

    const body = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(body.includes(`🏊 Morning swim`), "grid chip shows the new title + re-detected 🏊");
    assert.ok(body.includes(`<span class="wp-train-emoji" aria-hidden="true">🏊</span>`), "card row emoji re-detected to 🏊");
    // persisted through the training defaults path
    const tSave = posts.filter((p) => Array.isArray(p.body.trainingDefaults)).pop();
    assert.strictEqual(tSave.body.trainingDefaults.find((t) => t.id === "t1").title, "Morning swim", "training rename round-trips to the store");
  }

  /* ---------- 7: existing recurring behaviour is otherwise unchanged (schedule editor still works) ---------- */
  {
    const defaults = [{ id: "r1", title: "Task", days: ["mon"], time: "6-9" }];
    const { ctx } = await boot({ defaults, plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    // the card row now carries an editable input + a 📅 schedule button that opens the popup
    const body = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(body.includes(`data-item-title="recurring:r1"`), "recurring title is an id-keyed inline input");
    assert.ok(body.includes(`wpDefaultTitleBlur('recurring','r1')`), "…wired to the shared inline-edit save path");
    assert.ok(body.includes(`class="wp-rec-linkbtn wp-rec-sched"`) && body.includes(`wpOpenPopup('recurring','r1',this)`), "📅 schedule button opens the same day/slot popup");
    // and scheduling still writes real placements
    await ctx.wpSetRecurrence("r1", ["mon", "tue"], "6-9");
    assert.deepStrictEqual(Array.from(ctx.wpPlacementsOf("recurring:r1")).sort(), ["6-9:mon", "6-9:tue"], "scheduling engine unchanged");
  }

  console.log("v77-edit-recurring-title.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
