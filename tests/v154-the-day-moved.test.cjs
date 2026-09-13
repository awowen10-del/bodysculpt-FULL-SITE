// v154 — the day has left the weekly dashboard, and the morning opens the daily one.
//
// Ash, three things: "can we have the 'start the day' and 'today' in the same row — almost
// like a split screen. I want that to be the focus as I open the dashboard." / "It needs to
// be removed from the Time Blocks Calendar on the Weekly Dashboard, too." / "I also think
// the 'Money needing attention' and the '3 payments are still unpaid' need to be in the
// same area."
//
// v152 built the day on the daily page and deliberately left the weekly copy alone, so it
// could be used against real data before anything was deleted. It has been. This is the
// other half.
//
// THE REMOVAL IS THE RISKY PART, and what makes it risky is not the modal — it is that ten
// test files used the modal as a convenient SECOND SURFACE for testing something else
// ("the grid and the modal agree"). Each of those had to be read and decided on rather than
// deleted: some lost a redundant check, some were re-pointed at the surface that survived,
// and one lost an assertion that was only ever true of the modal's mirror. The five files
// that OWNED the feature are tombstones now — they assert the weekly page is rid of it, so
// a future edit cannot quietly put a second copy back and leave two places writing one day.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const WEEKLY = read("index.html");
const DAILY = read("daily.html");
const wjs = WEEKLY.slice(WEEKLY.indexOf("<script>", WEEKLY.indexOf("</style>")) + 8, WEEKLY.lastIndexOf("</script>"));
const djs = DAILY.slice(DAILY.lastIndexOf("<script>") + 8, DAILY.lastIndexOf("</script>"));
const dstyle = DAILY.slice(DAILY.indexOf("<style>") + 7, DAILY.indexOf("</style>"));

(async () => {
  /* ================= 0. the stamp ================= */
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(read("monthly.html"));
  assert.strictEqual(stamp[1], "154", "monthly.html is stamped v154");
  assert.strictEqual(stamp[2], "the-day-moved", "…as the release that finished the move");
  for (const f of ["index.html", "finances.html", "daily.html", "social.html"]) {
    assert.ok(read(f).includes("build v154 · the-day-moved"), f + " carries the same stamp");
  }

  /* ============ 1. THE MORNING OPENS THE PAGE, side by side ============ */
  assert.ok(/<div class="day-top">/.test(DAILY), "there is a top row");
  assert.ok(/\.day-top\{display:grid;grid-template-columns:minmax\(0,1\.35fr\) minmax\(300px,1fr\)/.test(dstyle),
    "…two columns, the questions the wider of them while they are still questions");
  const top = DAILY.slice(DAILY.indexOf('<div class="day-top">'), DAILY.indexOf('id="calCard"'));
  assert.ok(/id="ckCard"/.test(top) && /class="card today-card"/.test(top),
    "Start the day and Today are both in it");
  assert.ok(top.indexOf('id="ckCard"') < top.indexOf("today-card"), "…the questions on the left");
  // it is genuinely FIRST — nothing but the timer host sits above it
  const before = DAILY.slice(DAILY.indexOf('<div class="day-head">'), DAILY.indexOf('<div class="day-top">'));
  assert.ok(!/<section class="card/.test(before), "nothing else gets between the date and the morning");
  assert.ok(/id="ftHost"/.test(before), "…except the focus bar, which only exists while a block is running");
  // and when there are no questions left to ask, Today takes the whole row rather than
  // sitting beside a gap
  assert.ok(/\.ck-card\[hidden\] \+ \.today-card\{grid-column:1 \/ -1;\}/.test(dstyle),
    "with no check-in to show, Today spans the row instead of leaving a hole");

  /* ============ 2. the money headline sits with the money ============ */
  const moneyCard = DAILY.slice(DAILY.indexOf("Money needing attention") - 400, DAILY.indexOf('id="moneyBody"') + 40);
  assert.ok(/id="moneyAlert"/.test(moneyCard), "the alert is inside the money card now");
  assert.ok(moneyCard.indexOf('id="moneyAlert"') < moneyCard.indexOf('id="moneyBody"'),
    "…at the top of it, where a headline goes");
  // and nowhere near the top of the page any more
  assert.ok(!/id="moneyAlert"/.test(before), "it is no longer a strip a screen away from what it counts");

  /* ============ 3. THE WEEKLY PAGE IS RID OF THE DAY ============ */
  for (const gone of [
    "wpOpenToday", "wpCloseToday", "wpRenderTodayBody", "wpTodaySaveNotes", "wpTodayToggleDone",
    "wpCheckinBlockHtml", "wpCheckinStart", "wpCheckinSkip", "wpCheckinEdit", "wpCheckinSetDone",
    "wpCheckinFieldHtml", "wpCheckinEveningHtml", "wpCheckinSaveFromEditors", "wpCheckinReadEditors",
    "WP_CHECKIN_FIELDS", "wpToggleHabit", "wpHabitCatchup", "wpHabitsBlockHtml",
    "wpStartTimer", "wpPauseTimer", "wpTimerOnTick", "wpTimerHtml", "wpTimerBadgeText",
    "wpDialIn", "WP_FOCUS_PLAYLIST_URI",
  ]) {
    assert.ok(!wjs.includes(gone), "the weekly page no longer contains " + gone);
  }
  assert.ok(!/id="wpTodayOverlay"/.test(WEEKLY), "…and the modal element is gone with them");
  // the button became a signpost rather than vanishing — somebody who reaches for it is
  // told where the thing went
  assert.ok(/<a class="wp-today-btn" href="\/daily\.html"/.test(wjs),
    "the Today button is now a link to where the day lives");

  /* ============ 4. …but only the DAY left. The week kept what is weekly ============
     This is the half that could have gone wrong quietly: the non-negotiables TRACKER is a
     week view and belongs here, and Copy Week reads the same per-date data. */
  for (const kept of ["wpHabitWeekStats", "wpHabitTrackerHtml", "wpHabitCardHtml", "WP_HABITS",
                      "wpLoadCheckins", "wpCheckinEntry", "wpHabitsOf", "wpHabitDone", "wpDayStarted"]) {
    assert.ok(wjs.includes(kept), "the weekly page still has " + kept + " — it reads the day, it just no longer runs it");
  }
  assert.ok(/days\.some\(d=>wpDayStarted\(d\)\)/.test(wjs),
    "Copy Week still asks whether a day was started before writing the non-negotiables into the text");
  // the overlay SHELL survives, because three other things use it
  assert.ok(/\.wp-today-overlay\{/.test(WEEKLY), "the modal shell stays in the stylesheet");
  assert.ok(/wpAnchorNotesOverlay/.test(WEEKLY) && /wpRecurNotesOverlay/.test(WEEKLY),
    "…because the anchor-notes viewer and the recurring-notes editor are built on it");
  // and Escape no longer reaches for a modal that is not there
  assert.ok(!/if\(wpTodayOpen\)/.test(wjs), "Escape has nothing left to close on the Today path");

  /* ============ 5. everything it did, the daily page does ============ */
  for (const here of [
    "const CK_FIELDS", "function renderCheckin()", "JSON.stringify({ checkin: next })",
    "const CK_HABITS", "ckToggleHabit", "data-habit",
    "function ftStart(min)", "function ftPause()", "function ftOnTick()", "renderTimerBar",
  ]) {
    assert.ok(djs.includes(here), "the daily page has " + here);
  }
  // including Dial in, which nearly went out with the bathwater
  assert.ok(/const FT_PLAYLIST_URI = "spotify:playlist:/.test(djs), "Dial in came across too");
  assert.ok(/function ftDialIn\(a\)/.test(djs), "…with its app-first, web-fallback behaviour");
  assert.ok(/if \(taken \|\| document\.hidden\) return;/.test(djs),
    "…which still opens exactly one thing: the app took it, or the web player did");

  /* ============ 6. one day, one writer ============
     The whole point of removing it. Two pages writing the same date was survivable while it
     was deliberate and temporary; leaving it that way was not. */
  assert.ok(!/checkin:/.test(wjs), "the weekly page cannot write a check-in at all any more");
  assert.ok(/JSON\.stringify\(\{ checkin: next \}\)/.test(djs), "the daily page is the only one that can");
  assert.ok(/\?checkins=1/.test(wjs), "…while the weekly page still READS them for its tracker");

  console.log("v154-the-day-moved.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
