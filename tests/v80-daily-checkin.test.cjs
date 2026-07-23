// v80 harness — the daily check-in that leads the Today modal. Asserts answers save + load
// per date and don't leak between days; a fresh day shows the three questions (before the
// day's content, which stays reachable); skipping works and never blocks task access; the
// one-thing summary renders once answered; the evening "did you do it?" saves independently
// without disturbing the morning answers; the rich-text sanitiser applies on save and render;
// past days are preserved and retrievable as a chronological list (for the future AI step);
// and the existing modal (timer, notes, chips, close/scroll) is unchanged.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
function mondayIso(d) {
  const x = new Date(d);
  const back = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - back);
  x.setUTCHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}
const WEEK = mondayIso(NOW);          // the real current week, so the modal renders in-week
const MARK = "<!--wp:rich-->";
const plain = (o) => JSON.parse(JSON.stringify(o));
const checkinPosts = (posts) => posts.filter((p) => p.body.checkin && p.body.checkin.date);

(async () => {
  /* ---------- 1: answers save + load per date; nothing leaks between days ---------- */
  {
    const past = { date: "2026-03-01", mind: MARK + "old mind", gratitude: MARK + "old grat", oneThing: MARK + "<b>old one</b>", oneThingDone: true, doneNote: MARK + "did it", dismissed: true };
    const { ctx, posts } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {} } }, checkins: { "2026-03-01": past } });
    await ctx.loadWeeklyPlan(WEEK);

    // past day loaded; today starts fresh (no entry)
    assert.ok(ctx.__wpState.checkins["2026-03-01"], "past day loaded from the store");
    assert.strictEqual(ctx.wpCheckinEntry(TODAY).dismissed, false, "today starts fresh (not dismissed)");
    assert.strictEqual(ctx.wpCheckinEntry(TODAY).mind, "", "today starts with empty answers");

    // answer today and start the day
    ctx.wpOpenToday();
    ctx.document.getElementById("wpCkMind").innerHTML = "<b>todays brain</b>";
    ctx.document.getElementById("wpCkOneThing").innerHTML = "Ship the check-in";
    await ctx.wpCheckinStart();

    const today = ctx.__wpState.checkins[TODAY];
    assert.strictEqual(today.mind, MARK + "<b>todays brain</b>", "today's mind saved (sanitised/marked)");
    assert.strictEqual(today.oneThing, MARK + "Ship the check-in", "today's one-thing saved");
    assert.strictEqual(today.dismissed, true, "today dismissed after Start");
    // the other day is untouched — no leak
    assert.deepStrictEqual(plain(ctx.__wpState.checkins["2026-03-01"]), past, "the past day's entry is completely unchanged");
    // saved against today's date through the check-in path
    const posted = checkinPosts(posts).pop();
    assert.strictEqual(posted.body.checkin.date, TODAY, "the POST is keyed to today's date");

    // force a reload → the store round-trips both days, still separate
    ctx.__wpState.checkins = null;
    await ctx.wpLoadCheckins();
    assert.strictEqual(ctx.__wpState.checkins[TODAY].oneThing, MARK + "Ship the check-in", "today reloaded from the store");
    assert.strictEqual(ctx.__wpState.checkins["2026-03-01"].oneThing, MARK + "<b>old one</b>", "past day still there after reload");
  }

  /* ---------- 2: a fresh day shows the questions first, tasks reachable below ---------- */
  {
    const { ctx } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: { ["6-9:" + ["sun","mon","tue","wed","thu","fri","sat"][NOW.getUTCDay()]]: [] } } } });
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpOpenToday();
    const html = ctx.document.getElementById("wpTodayBody").innerHTML;
    assert.ok(html.includes("Daily check-in"), "the check-in leads the modal");
    assert.ok(html.includes("on your mind") && html.includes("grateful") && html.includes("only complete one thing"), "all three questions render");
    // order: dump → gratitude → focus
    assert.ok(html.indexOf("on your mind") < html.indexOf("grateful"), "brain dump before gratitude");
    assert.ok(html.indexOf("grateful") < html.indexOf("only complete one thing"), "gratitude before the one thing");
    assert.ok(html.includes("wpCheckinStart()") && html.includes("wpCheckinSkip()"), "Start + Skip actions offered");
    // the questions come first, but the day's content is still present below (never blocked)
    assert.ok(html.indexOf("Daily check-in") < html.indexOf("wpTimerBox") && html.indexOf("wpTimerBox") < html.indexOf("wp-today-row"), "check-in leads; timer + time rows still render below");
  }

  /* ---------- 3: skipping works and does NOT block task access ---------- */
  {
    const { ctx } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpOpenToday();
    let html = ctx.document.getElementById("wpTodayBody").innerHTML;
    assert.ok(html.includes("wp-today-row"), "tasks are present even before skipping (not hard-blocked)");
    await ctx.wpCheckinSkip();
    assert.strictEqual(ctx.__wpState.checkins[TODAY].dismissed, true, "skip dismisses the check-in for the day");
    assert.deepStrictEqual([ctx.wpCheckinEntry(TODAY).mind, ctx.wpCheckinEntry(TODAY).oneThing], ["", ""], "skip leaves the answers empty (not fabricated)");
    html = ctx.document.getElementById("wpTodayBody").innerHTML;
    assert.ok(!html.includes("wpCheckinStart()"), "questions gone after skip");
    assert.ok(html.includes("One thing today") && html.includes("wp-today-row"), "normal Today view with tasks after skip");
  }

  /* ---------- 4: the one-thing summary renders once answered, with an Edit affordance ---------- */
  {
    const seed = { [TODAY]: { date: TODAY, oneThing: MARK + "<b>Ship v80</b>", dismissed: true } };
    const { ctx } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {} } }, checkins: seed });
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpOpenToday();
    const html = ctx.document.getElementById("wpTodayBody").innerHTML;
    assert.ok(html.includes("One thing today"), "summary shown (not the questions) on reopen after answering");
    assert.ok(html.includes("<b>Ship v80</b>"), "the one thing is surfaced (sanitised rich text)");
    assert.ok(html.includes("wpCheckinEdit()"), "an Edit affordance is offered");
    assert.ok(!html.includes("wpCheckinStart()"), "no Start button in the summary view");
    // Edit re-opens the questions, pre-filled
    await ctx.wpCheckinEdit();
    const edit = ctx.document.getElementById("wpTodayBody").innerHTML;
    assert.ok(edit.includes("wpCheckinStart()") && edit.includes("Ship v80"), "Edit reopens the questions with the saved answer");
  }

  /* ---------- 5: evening "did you do it?" saves independently of the morning answers ---------- */
  {
    const seed = { [TODAY]: { date: TODAY, mind: MARK + "morning brain", oneThing: MARK + "<b>Ship v80</b>", dismissed: true } };
    const { ctx, posts } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {} } }, checkins: seed });
    await ctx.loadWeeklyPlan(WEEK);

    await ctx.wpCheckinSetDone(true);
    const e = ctx.__wpState.checkins[TODAY];
    assert.strictEqual(e.oneThingDone, true, "did-you-do-it saved as yes");
    assert.strictEqual(e.oneThing, MARK + "<b>Ship v80</b>", "the one-thing answer is untouched");
    assert.strictEqual(e.mind, MARK + "morning brain", "the morning brain-dump is untouched");
    assert.strictEqual(checkinPosts(posts).pop().body.checkin.oneThingDone, true, "saved through the check-in path");

    // flip to no
    await ctx.wpCheckinSetDone(false);
    assert.strictEqual(ctx.__wpState.checkins[TODAY].oneThingDone, false, "flips to not-done independently");

    // the evening field markup: yes/no + optional note + the closed-loop tag in the summary
    const ev = ctx.wpCheckinEveningHtml(ctx.wpCheckinEntry(TODAY));
    assert.ok(ev.includes("Did you do the one thing?") && ev.includes("wpCheckinSetDone(true)") && ev.includes("wpCheckinSetDone(false)"), "evening field offers the yes/no");
    assert.ok(ev.includes(`id="wpCkDoneNote"`), "…plus an optional one-line note editor");
    assert.ok(ev.includes("wp-ck-no on"), "the chosen answer (No) is highlighted");
  }

  /* ---------- 6: rich-text sanitising applies on save AND render ---------- */
  {
    const { ctx } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpOpenToday();
    ctx.document.getElementById("wpCkMind").innerHTML = `<script>alert(1)</script><b onclick="x()">keep</b><a href="javascript:e()">bad</a>`;
    await ctx.wpCheckinSaveFromEditors();
    const saved = ctx.__wpState.checkins[TODAY].mind;
    for (const bad of ["<script", "alert(", "onclick", "javascript:", "href"]) assert.ok(!saved.includes(bad), "save stripped " + JSON.stringify(bad));
    assert.ok(saved.includes("<b>keep</b>"), "legit formatting kept");
    // a tampered STORED value is re-sanitised on render (same helper as notes)
    const rendered = ctx.wpNotesToEditorHtml(MARK + `<img src=x onerror="alert(2)">safe`);
    assert.ok(!rendered.includes("onerror") && !rendered.includes("<img"), "render sanitises a tampered value");
    assert.ok(rendered.includes("safe"), "…keeping the text");
  }

  /* ---------- 7: past days are preserved and retrievable as a chronological list ---------- */
  {
    const seed = {
      "2026-02-10": { date: "2026-02-10", oneThing: MARK + "A", dismissed: true },
      "2026-02-12": { date: "2026-02-12", oneThing: MARK + "B", oneThingDone: true, dismissed: true },
      "2026-02-11": { date: "2026-02-11", oneThing: MARK + "C", dismissed: true },
    };
    const { ctx } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {} } }, checkins: seed });
    await ctx.loadWeeklyPlan(WEEK);
    const list = ctx.wpCheckinList();
    // Array.from — vm-realm arrays fail deepStrictEqual's prototype check
    const dates = Array.from(list, (e) => e.date);
    assert.deepStrictEqual(dates, ["2026-02-10", "2026-02-11", "2026-02-12"], "list is chronological and complete");
    // clean, consistent shape for the future AI advisor
    const first = list[0];
    assert.deepStrictEqual(Array.from(Object.keys(first)).sort(), ["date", "dismissed", "doneNote", "gratitude", "mind", "oneThing", "oneThingDone", "updatedAt"], "each entry has the clean fixed shape");
    assert.strictEqual(list[2].oneThingDone, true, "per-day fields preserved through the list");
  }

  /* ---------- 8: existing modal behaviour is unchanged (timer, notes, chips, close) ---------- */
  {
    const dayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][NOW.getUTCDay()];
    const defaults = [{ id: "r1", title: "Standup", days: [dayKey], time: "6-9" }];
    const { ctx } = await boot({ defaults, plans: { [WEEK]: { weekEnding: WEEK, placements: { ["6-9:" + dayKey]: ["recurring:r1"] }, notes: "weekly notes here" } } });
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpOpenToday();
    const html = ctx.document.getElementById("wpTodayBody").innerHTML;
    assert.ok(html.includes(`id="wpTimerBox"`), "focus timer still renders");
    assert.ok(html.includes(`id="wpTodayNotes"`) && html.includes("weekly notes here"), "weekly notes editor still renders");
    assert.ok(html.includes("wpTodayToggleDone('recurring:r1'"), "today's task chips still render + tick");
    // close still restores scroll + hides
    ctx.wpCloseToday();
    assert.strictEqual(ctx.document.body.style.overflow, "", "close restores page scroll");
    await new Promise((r) => setTimeout(r, 250));
    assert.strictEqual(ctx.document.getElementById("wpTodayOverlay").hidden, true, "overlay hidden after the close transition");
  }

  console.log("v80-daily-checkin.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
