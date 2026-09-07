// v73 harness — training-type emojis. Asserts each keyword group auto-detects the right
// v121: the resolver returns a sprite ICON NAME ("lift", "run", …) where it used to
// return an emoji character. The rules, tokenising and priority order are unchanged.
// Unmatched titles fall back to lift, a manual override beats auto-detection while
// items without one re-detect as the title changes, and the resolved emoji renders
// identically in the Training card row, the grid chip and the v67 Today modal (all via
// the one shared resolver — no duplicated logic).
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

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

(async () => {
  const { ctx } = await boot({ plans: { [TODAY_WEEK]: { weekEnding: TODAY_WEEK, placements: {} } } });
  await ctx.loadWeeklyPlan(TODAY_WEEK);

  /* ---------- 1: each keyword group maps to the right emoji ---------- */
  const groups = {
    "run": ["Morning run", "Easy jog", "Jogging", "5k", "10k tempo", "20km long", "3mi recovery", "Marathon prep"],
    "lift": ["Gym", "Leg day", "Legs", "Upper body", "Lower body", "Push session", "Pull day", "Full body", "Full-body circuit", "Weights", "Lift heavy"],
    "swim": ["Swim", "Swim 1k", "Swimming"],
    "bike": ["Bike ride", "Cycle commute", "Cycling", "Spin class", "Ride out"],
    "walk": ["Evening walk", "Walking", "Hill hike", "Hiking"],
    "yoga": ["Yoga flow", "Stretch session", "Mobility work"],
  };
  for (const [emoji, titles] of Object.entries(groups)) {
    for (const title of titles) {
      assert.strictEqual(ctx.wpDetectTrainingEmoji(title), emoji, `"${title}" → ${emoji}`);
      // the item-level resolver (no override) agrees with detection
      assert.strictEqual(ctx.wpTrainingIcon({ title }), emoji, `resolver: "${title}" → ${emoji}`);
    }
  }

  /* ---------- 2: unmatched titles fall back to lift ---------- */
  for (const title of ["Physio appointment", "Sauna", "Massage", "Rest day", "", "   "]) {
    assert.strictEqual(ctx.wpDetectTrainingEmoji(title), "lift", `unmatched "${title}" → default lift`);
  }
  // whole-word matching: a keyword buried in another word is not a match
  assert.strictEqual(ctx.wpDetectTrainingEmoji("Gym run-through"), "lift", "'run-through' is not read as a run → stays lift (gym)");
  assert.strictEqual(ctx.wpDetectTrainingEmoji("Runway walk"), "walk", "'Runway' does not trigger run; 'walk' wins → walk");

  /* ---------- 3: most-specific / strongest match wins when two groups hit ---------- */
  assert.strictEqual(ctx.wpDetectTrainingEmoji("Swim then jog"), "swim", "swim (higher priority) beats jog");
  assert.strictEqual(ctx.wpDetectTrainingEmoji("Bike then run"), "bike", "cycle beats run");

  /* ---------- 4: the emoji is detection-only; any stored override is harmlessly ignored ---------- */
  // v76 removed the manual override. A stray `emoji` field on stored data must NOT change
  // the rendered emoji — it's always auto-detected from the title.
  assert.strictEqual(ctx.wpTrainingIcon({ title: "Gym", emoji: "run" }), "lift", "stored override ignored → auto lift");
  assert.strictEqual(ctx.wpTrainingIcon({ title: "Morning run", emoji: "yoga" }), "run", "stored override ignored → auto run");
  assert.strictEqual(ctx.wpTrainingIcon({ title: "Swim", emoji: "<img src=x>" }), "swim", "junk override ignored → auto swim");
  assert.strictEqual(typeof ctx.wpSetTrainingEmoji, "undefined", "the override setter is gone");

  /* ---------- 5: the emoji re-detects as the title changes (no pinning) ---------- */
  {
    const item = { title: "Gym" };
    assert.strictEqual(ctx.wpTrainingIcon(item), "lift", "starts lift");
    item.title = "Swim 1k";
    assert.strictEqual(ctx.wpTrainingIcon(item), "swim", "re-detects swim after rename");
    item.title = "Evening cycle";
    assert.strictEqual(ctx.wpTrainingIcon(item), "bike", "re-detects bike after another rename");
    // even a leftover stored emoji field never pins it
    item.emoji = "walk";
    assert.strictEqual(ctx.wpTrainingIcon(item), "bike", "leftover stored emoji does not pin — still auto");
  }

  /* ---------- 6: the same auto emoji renders in card row, grid chip AND Today modal ---------- */
  {
    const training = [
      { id: "t1", title: "Morning run", days: [TODAY], time: "6-9" }, // run, placed today
      { id: "t2", title: "Leg day" },                                 // lift, unplaced
    ];
    const plans = { [TODAY_WEEK]: { weekEnding: TODAY_WEEK, placements: { ["6-9:" + TODAY]: ["training:t1"] } } };
    const { ctx: c2 } = await boot({ training, plans });
    await c2.loadWeeklyPlan(TODAY_WEEK);

    const body = c2.document.getElementById("wpBody").innerHTML;
    // v76: card row shows a plain, fixed-width icon span — no picker/select/chevron
    // (v121: the span now holds a sprite <svg> where it held an emoji character)
    assert.ok(!body.includes("wp-train-emoji-sel") && !body.includes("<select") && !body.includes("wpSetTrainingEmoji"), "the emoji override control is gone");
    assert.ok(body.includes(`<span class="wp-train-emoji" aria-hidden="true"><svg class="ic"><use href="#ic-run"/></svg></span>`),
      "run row shows the static run icon");
    assert.ok(body.includes(`<span class="wp-train-emoji" aria-hidden="true"><svg class="ic"><use href="#ic-lift"/></svg></span>`),
      "gym row shows the static barbell icon");
    // grid chip for the placed run leads with the run icon (not the old hardcoded lift)
    assert.ok(body.includes(`<svg class="ic"><use href="#ic-run"/></svg> Morning run`), "grid chip leads with the run icon");
    assert.ok(!body.includes("lift Morning run"), "the run chip is not the default barbell");

    // Today modal: same chip, same run via the shared renderer
    c2.wpOpenToday();
    const modal = c2.document.getElementById("wpTodayBody").innerHTML;
    assert.ok(modal.includes(`<svg class="ic"><use href="#ic-run"/></svg> Morning run`), "Today modal chip shows the same run icon");
    assert.ok(modal.includes("wp-train"), "…keeping the green training accent");
    c2.wpCloseToday();

    // one resolver everywhere: rename t1 and every surface follows after a re-render
    c2.__wpState.training.find((t) => t.id === "t1").title = "Pool swim";
    c2.renderWeeklyPlan();
    const body2 = c2.document.getElementById("wpBody").innerHTML;
    assert.ok(body2.includes(`<svg class="ic"><use href="#ic-swim"/></svg> Pool swim`), "grid chip follows the retitle to swim");
    assert.ok(body2.includes(`<span class="wp-train-emoji" aria-hidden="true"><svg class="ic"><use href="#ic-swim"/></svg></span>`), "card row follows the retitle to swim");
    c2.wpOpenToday();
    assert.ok(c2.document.getElementById("wpTodayBody").innerHTML.includes(`<svg class="ic"><use href="#ic-swim"/></svg> Pool swim`), "modal chip follows the retitle to swim");
    c2.wpCloseToday();
  }

  /* ---------- 7: the emoji field is never written back to the store ---------- */
  {
    const training = [{ id: "t1", title: "Gym", emoji: "swim" }]; // legacy stored override
    const { ctx: c3, posts } = await boot({ training, plans: { [TODAY_WEEK]: { weekEnding: TODAY_WEEK, placements: {} } } });
    await c3.loadWeeklyPlan(TODAY_WEEK);
    // the loaded item doesn't even carry the field anymore
    assert.ok(!("emoji" in c3.__wpState.training.find((t) => t.id === "t1")), "load drops the legacy emoji field");
    // and a natural save (e.g. renaming) never re-emits it
    await c3.wpSaveTraining();
    const post = posts.filter((p) => Array.isArray(p.body.trainingDefaults)).pop();
    assert.ok(post, "training list saved");
    assert.ok(!("emoji" in post.body.trainingDefaults.find((t) => t.id === "t1")), "no emoji field written back to the store");
  }

  console.log("v73-training-emojis.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
