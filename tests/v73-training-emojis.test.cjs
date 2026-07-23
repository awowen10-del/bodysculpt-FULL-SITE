// v73 harness — training-type emojis. Asserts each keyword group auto-detects the right
// emoji, unmatched titles fall back to 🏋️, a manual override beats auto-detection while
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
    "🏃": ["Morning run", "Easy jog", "Jogging", "5k", "10k tempo", "20km long", "3mi recovery", "Marathon prep"],
    "🏋️": ["Gym", "Leg day", "Legs", "Upper body", "Lower body", "Push session", "Pull day", "Full body", "Full-body circuit", "Weights", "Lift heavy"],
    "🏊": ["Swim", "Swim 1k", "Swimming"],
    "🚴": ["Bike ride", "Cycle commute", "Cycling", "Spin class", "Ride out"],
    "🚶": ["Evening walk", "Walking", "Hill hike", "Hiking"],
    "🧘": ["Yoga flow", "Stretch session", "Mobility work"],
  };
  for (const [emoji, titles] of Object.entries(groups)) {
    for (const title of titles) {
      assert.strictEqual(ctx.wpDetectTrainingEmoji(title), emoji, `"${title}" → ${emoji}`);
      // the item-level resolver (no override) agrees with detection
      assert.strictEqual(ctx.wpTrainingEmoji({ title }), emoji, `resolver: "${title}" → ${emoji}`);
    }
  }

  /* ---------- 2: unmatched titles fall back to 🏋️ ---------- */
  for (const title of ["Physio appointment", "Sauna", "Massage", "Rest day", "", "   "]) {
    assert.strictEqual(ctx.wpDetectTrainingEmoji(title), "🏋️", `unmatched "${title}" → default 🏋️`);
  }
  // whole-word matching: a keyword buried in another word is not a match
  assert.strictEqual(ctx.wpDetectTrainingEmoji("Gym run-through"), "🏋️", "'run-through' is not read as a run → stays 🏋️ (gym)");
  assert.strictEqual(ctx.wpDetectTrainingEmoji("Runway walk"), "🚶", "'Runway' does not trigger 🏃; 'walk' wins → 🚶");

  /* ---------- 3: most-specific / strongest match wins when two groups hit ---------- */
  assert.strictEqual(ctx.wpDetectTrainingEmoji("Swim then jog"), "🏊", "swim (higher priority) beats jog");
  assert.strictEqual(ctx.wpDetectTrainingEmoji("Bike then run"), "🚴", "cycle beats run");

  /* ---------- 4: a manual override beats auto-detection ---------- */
  assert.strictEqual(ctx.wpTrainingEmoji({ title: "Gym", emoji: "🏃" }), "🏃", "override 🏃 wins over auto 🏋️");
  assert.strictEqual(ctx.wpTrainingEmoji({ title: "Morning run", emoji: "🧘" }), "🧘", "override 🧘 wins over auto 🏃");
  // an override outside the known set is ignored (falls back to auto) — no arbitrary string reaches the DOM
  assert.strictEqual(ctx.wpTrainingEmoji({ title: "Gym", emoji: "💣" }), "🏋️", "invalid override ignored → auto");
  assert.strictEqual(ctx.wpTrainingEmoji({ title: "Gym", emoji: "<img src=x>" }), "🏋️", "injection-y override ignored → auto");

  /* ---------- 5: items WITHOUT an override re-detect as the title changes ---------- */
  {
    const item = { title: "Gym" };
    assert.strictEqual(ctx.wpTrainingEmoji(item), "🏋️", "starts 🏋️");
    item.title = "Swim 1k"; // rename, no override
    assert.strictEqual(ctx.wpTrainingEmoji(item), "🏊", "re-detects 🏊 after rename");
    item.title = "Evening cycle";
    assert.strictEqual(ctx.wpTrainingEmoji(item), "🚴", "re-detects 🚴 after another rename");
    // once overridden it stops following the title…
    item.emoji = "🚶";
    assert.strictEqual(ctx.wpTrainingEmoji(item), "🚶", "override pins the emoji regardless of title");
    // …and clearing the override resumes auto-detection
    delete item.emoji;
    assert.strictEqual(ctx.wpTrainingEmoji(item), "🚴", "clearing the override resumes auto-detect");
  }

  /* ---------- 6: the same emoji renders in card row, grid chip AND Today modal ---------- */
  {
    // auto-detected (a run) placed today, plus an overridden item in the card
    const training = [
      { id: "t1", title: "Morning run", days: [TODAY], time: "6-9" }, // auto → 🏃, placed today
      { id: "t2", title: "Gym", emoji: "🧘" },                        // override → 🧘, unplaced
    ];
    const plans = { [TODAY_WEEK]: { weekEnding: TODAY_WEEK, placements: { ["6-9:" + TODAY]: ["training:t1"] } } };
    const { ctx: c2 } = await boot({ training, plans });
    await c2.loadWeeklyPlan(TODAY_WEEK);

    const body = c2.document.getElementById("wpBody").innerHTML;
    // card rows: the auto item's picker shows the detected 🏃 (v74: no "auto" word — the
    // auto option's label is just the emoji, selected); the overridden item shows 🧘 selected
    assert.ok(body.includes("wp-train-emoji-sel"), "training rows carry the light emoji picker");
    assert.ok(body.includes(`<option value="" selected title="Auto-detect from title">🏃</option>`), "auto item's picker shows the detected 🏃 with no visible 'auto' word");
    assert.ok(!body.includes("🏃 auto") && !body.includes(">🏃 auto<"), "the word 'auto' is not rendered in the control");
    assert.ok(body.includes(`<option value="🧘" selected>🧘</option>`), "overridden item's picker has 🧘 selected");
    // grid chip for the placed run shows 🏃 (not the old hardcoded 🏋️)
    const chipRun = body.split(`wpToggleDoneRef('training:t1'`)[0].slice(-400);
    assert.ok(body.includes(`🏃 Morning run`) || chipRun.includes("🏃"), "grid chip leads with 🏃");
    assert.ok(!body.includes("🏋️ Morning run"), "the run chip is not the default barbell");

    // Today modal: same chip, same 🏃 via the shared renderer
    c2.wpOpenToday();
    const modal = c2.document.getElementById("wpTodayBody").innerHTML;
    assert.ok(modal.includes(`🏃 Morning run`), "Today modal chip shows the same 🏃");
    assert.ok(modal.includes("wp-train"), "…keeping the green training accent");
    c2.wpCloseToday();

    // and the resolver is the single source everywhere: flip t1 to an override and every
    // surface follows after a re-render
    c2.__wpState.training.find((t) => t.id === "t1").emoji = "🚴";
    c2.renderWeeklyPlan();
    const body2 = c2.document.getElementById("wpBody").innerHTML;
    assert.ok(body2.includes(`🚴 Morning run`), "grid chip follows the override to 🚴");
    c2.wpOpenToday();
    assert.ok(c2.document.getElementById("wpTodayBody").innerHTML.includes(`🚴 Morning run`), "modal chip follows the override to 🚴");
    c2.wpCloseToday();
  }

  /* ---------- 7: override persists through the training save path ---------- */
  {
    const training = [{ id: "t1", title: "Gym" }];
    const { ctx: c3, posts } = await boot({ training, plans: { [TODAY_WEEK]: { weekEnding: TODAY_WEEK, placements: {} } } });
    await c3.loadWeeklyPlan(TODAY_WEEK);
    await c3.wpSetTrainingEmoji("t1", "🏊");
    assert.strictEqual(c3.__wpState.training.find((t) => t.id === "t1").emoji, "🏊", "override set on the item");
    const post = posts.filter((p) => Array.isArray(p.body.trainingDefaults)).pop();
    assert.ok(post, "training list saved");
    assert.strictEqual(post.body.trainingDefaults.find((t) => t.id === "t1").emoji, "🏊", "override round-trips to the store");
    // clearing it via the "auto" option removes the field
    await c3.wpSetTrainingEmoji("t1", "");
    assert.ok(!("emoji" in c3.__wpState.training.find((t) => t.id === "t1")), "auto option clears the override field");
  }

  console.log("v73-training-emojis.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
