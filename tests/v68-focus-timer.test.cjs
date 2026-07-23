// v68 harness — the Focus Timer in the Today modal. Assertions: starting a preset
// sets the expected end timestamp; remaining time is DERIVED from timestamps (moving
// endAt moves remaining with no ticks — not a decremented counter); closing and
// reopening the modal preserves a running timer untouched; pause freezes remaining
// and resume restores endAt from the frozen point; finishing while the modal is
// closed shows the done state (and header-badge ✓) on next open; reset returns to idle.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

// Same week math as the app so the modal renders the in-week branch.
const NOW = new Date();
function mondayIso(d) {
  const x = new Date(d);
  const back = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - back);
  x.setUTCHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}
const WEEK = mondayIso(NOW);
const MIN = 60000;

(async () => {
  const plans = { [WEEK]: { weekEnding: WEEK, placements: { "6-9:mon": ["recurring:rX"] }, notes: "" } };
  const { ctx } = await boot({ plans, defaults: [{ id: "rX", title: "Anchor" }] });
  await ctx.loadWeeklyPlan(WEEK);
  const st = ctx.__wpState;

  // ---------- 0: idle state — presets offered at the top of the modal ----------
  ctx.wpOpenToday();
  let html = ctx.document.getElementById("wpTodayBody").innerHTML;
  assert.ok(html.indexOf(`id="wpTimerBox"`) >= 0 && html.indexOf(`id="wpTimerBox"`) < html.indexOf("wp-today-row") || !html.includes("wp-today-row"), "timer box renders above the time rows");
  [30, 60, 90, 120].forEach((m) => assert.ok(html.includes(`wpStartTimer(${m})`), `${m}m preset offered`));
  assert.strictEqual(ctx.wpTimerBadgeText(), "", "no header-badge text while idle");

  // ---------- 1: starting a timer sets the expected end time ----------
  const t0 = Date.now();
  ctx.wpStartTimer(30);
  const t1 = Date.now();
  assert.ok(st.timer && !st.timer.finished && st.timer.pausedRemaining == null, "running state");
  assert.ok(st.timer.endAt >= t0 + 30 * MIN && st.timer.endAt <= t1 + 30 * MIN, "endAt = start + 30 minutes");
  assert.strictEqual(st.timer.durationMin, 30, "duration recorded");

  // ---------- 2: remaining is derived from timestamps, not a decremented counter ----------
  st.timer.endAt = Date.now() + 5 * MIN;      // reposition endAt directly — no ticks involved
  assert.ok(Math.abs(ctx.wpTimerRemainingMs() - 5 * MIN) < 1500, "remaining recomputed from endAt");
  st.timer.endAt = Date.now() + 90 * MIN;     // reposition again, remaining follows instantly
  assert.ok(Math.abs(ctx.wpTimerRemainingMs() - 90 * MIN) < 1500, "remaining follows the timestamp, no counter to drift");
  assert.strictEqual(ctx.wpTimerFmt(90 * MIN), "90:00", "mm:ss formatting");

  // ---------- 3: closing + reopening the modal preserves the running timer ----------
  const endBefore = st.timer.endAt;
  ctx.wpCloseToday();
  assert.strictEqual(st.timer.endAt, endBefore, "closing the modal doesn't touch timer state");
  assert.strictEqual(st.timer.finished, false, "still running while closed");
  await new Promise((r) => setTimeout(r, 120));
  ctx.wpOpenToday();
  assert.strictEqual(st.timer.endAt, endBefore, "reopening doesn't rebuild or reset the timer");
  html = ctx.document.getElementById("wpTodayBody").innerHTML;
  assert.ok(html.includes(`id="wpTimerClock"`), "running clock rendered on reopen");
  assert.ok(html.includes("90:00") || html.includes("89:5"), "reopened modal shows remaining recomputed from endAt");
  assert.ok(html.includes("wpPauseTimer()"), "Pause offered while running");

  // ---------- 4: pause freezes remaining; resume restores endAt from the frozen point ----------
  st.timer.endAt = Date.now() + 10 * MIN;
  ctx.wpPauseTimer();
  assert.strictEqual(st.timer.endAt, null, "no endAt while paused");
  const frozen = st.timer.pausedRemaining;
  assert.ok(Math.abs(frozen - 10 * MIN) < 1500, "pause captured the remaining time");
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(ctx.wpTimerRemainingMs(), frozen, "remaining does not move while paused");
  ctx.wpTimerRefresh();
  html = ctx.document.getElementById("wpTimerBox").innerHTML;
  assert.ok(html.includes("wpResumeTimer()") && html.includes("paused"), "paused state offers Resume");
  const r0 = Date.now();
  ctx.wpResumeTimer();
  assert.strictEqual(st.timer.pausedRemaining, null, "resume clears the frozen value");
  assert.ok(st.timer.endAt >= r0 + frozen && st.timer.endAt <= Date.now() + frozen, "resume: endAt = now + frozen remaining");

  // ---------- 5: finishing while the modal is closed → done state on next open ----------
  ctx.wpCloseToday();
  st.timer.endAt = Date.now() - 10;           // past due
  ctx.wpTimerOnTick();                        // what the interval does
  assert.strictEqual(st.timer.finished, true, "tick past endAt finishes the timer");
  assert.strictEqual(ctx.wpTimerBadgeText(), "✓", "header badge shows done while modal is closed");
  ctx.wpOpenToday();
  html = ctx.document.getElementById("wpTodayBody").innerHTML;
  assert.ok(html.includes("Time's up"), "finished state shown on next open");
  assert.ok(html.includes("wp-timer-boxdone"), "finished box carries the green done styling");
  assert.ok(!html.includes("wpPauseTimer()"), "no pause control once finished");

  // ---------- 6: reset returns to idle presets; timer interactions never touched the plan ----------
  ctx.wpResetTimer();
  assert.strictEqual(st.timer, null, "reset clears the timer");
  ctx.wpRenderTodayBody();
  html = ctx.document.getElementById("wpTodayBody").innerHTML;
  assert.ok(html.includes("wpStartTimer(60)"), "presets offered again after reset");
  ctx.wpCloseToday();
  assert.strictEqual(Object.keys(st.plan.recurringDone).length, 0, "timer never wrote done-state");
  assert.strictEqual(st.plan.notes, "", "timer never wrote notes");

  // ---------- 7: badge span lives inside the Today header button ----------
  assert.ok(ctx.document.getElementById("wpBody").innerHTML.includes(`id="wpTodayBtnTimer"`), "Today button carries the timer badge span");

  console.log("v68-focus-timer.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
