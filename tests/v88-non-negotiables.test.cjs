// v88 regression: daily non-negotiables (habit tracking) in three places — the Today
// checklist (per date, after the day is started), the new-day catch-up prompt about
// YESTERDAY ONLY, and the read-only weekly tracker in the End-of-Week Review. The habits
// ride the v80 per-date check-in entry, so they use the same store/load/save path; nothing
// about tasks, placements, exceptions, locations or done-state is involved.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/env.cjs");

const HABITS = ["read", "mobility", "house"]; // WP_HABITS ids / VALID_HABITS in kpi-store
const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);
const YDAY = (() => { const d = new Date(NOW); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
const TWO_AGO = (() => { const d = new Date(NOW); d.setUTCDate(d.getUTCDate() - 2); return d.toISOString().slice(0, 10); })();
// the Monday of the week containing today (the app's own week basis)
const THIS_WEEK = (() => { const d = new Date(NOW); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
const dateAt = (i) => { const d = new Date(THIS_WEEK + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); };

const entry = (over) => Object.assign({ date: "", mind: "", gratitude: "", oneThing: "", oneThingDone: null, doneNote: "", dismissed: true, habits: {}, habitsAsked: false, updatedAt: "" }, over);
const started = (date, habits, extra) => entry(Object.assign({ date, habits: habits || {} }, extra || {}));
const todayHtml = (ctx) => { ctx.wpRenderTodayBody(); return ctx.document.getElementById("wpTodayBody").innerHTML; };
const checkinPosts = (posts) => posts.filter((p) => p.body && p.body.checkin);

(async () => {
  // ---------- 1: the three habits render once the day is started, and tick per date ----------
  {
    const { ctx, posts } = await boot({
      checkins: { [TODAY]: started(TODAY) },
      plans: { [THIS_WEEK]: { weekEnding: THIS_WEEK, placements: {} } },
    });
    await ctx.loadWeeklyPlan(THIS_WEEK);

    let html = todayHtml(ctx);
    assert.ok(html.includes("Daily non-negotiables"), "the checklist shows after the day is started");
    assert.ok(html.includes("Read a minimum 10 pages of a self-development book"), "habit 1 rendered");
    assert.ok(html.includes("Mobility — minimum 10 minutes of Pliability"), "habit 2 rendered");
    assert.ok(html.includes("Do one thing around the house that will make a difference"), "habit 3 rendered");
    HABITS.forEach((id) => assert.ok(html.includes(`wpToggleHabit('${TODAY}','${id}')`), `${id} ticks against today's date`));
    assert.ok(html.includes("0 of 3"), "count starts at 0 of 3");

    await ctx.wpToggleHabit(TODAY, "read");
    assert.strictEqual(ctx.wpHabitDone(TODAY, "read"), true, "tick recorded");
    assert.strictEqual(ctx.wpHabitCount(TODAY), 1, "count follows");
    await ctx.wpToggleHabit(TODAY, "house");
    assert.strictEqual(ctx.wpHabitCount(TODAY), 2);
    assert.ok(todayHtml(ctx).includes("2 of 3"), "'x of 3' shown for the day");

    // untick works, and the write goes through the v80 check-in path for THAT date only
    await ctx.wpToggleHabit(TODAY, "read");
    assert.strictEqual(ctx.wpHabitDone(TODAY, "read"), false, "unticked again");
    const sent = checkinPosts(posts).pop().body.checkin;
    assert.strictEqual(sent.date, TODAY, "saved against today's date");
    assert.deepStrictEqual({ ...sent.habits }, { read: false, house: true }, "only habit flags are written");
    assert.strictEqual(ctx.__wpState.checkins[YDAY], undefined, "no other date touched");

    // unknown ids are ignored
    await ctx.wpToggleHabit(TODAY, "gym");
    assert.ok(!("gym" in ctx.wpHabitsOf(TODAY)), "unknown habit id rejected");
  }

  // ---------- 2: not shown until the day is started; data never leaks between dates ----------
  {
    const { ctx } = await boot({
      checkins: { [TODAY]: entry({ date: TODAY, dismissed: false }), [YDAY]: started(YDAY, { read: true, mobility: true, house: true }) },
      plans: { [THIS_WEEK]: { weekEnding: THIS_WEEK, placements: {} } },
    });
    await ctx.loadWeeklyPlan(THIS_WEEK);
    assert.ok(!todayHtml(ctx).includes("Daily non-negotiables"), "hidden until the day is started");

    await ctx.wpCheckinStart();   // "Start the day →"
    assert.ok(todayHtml(ctx).includes("Daily non-negotiables"), "appears after Start the day");
    assert.strictEqual(ctx.wpHabitCount(TODAY), 0, "today starts fresh — yesterday's ticks don't leak in");
    assert.strictEqual(ctx.wpHabitCount(YDAY), 3, "yesterday keeps its own record");

    await ctx.wpToggleHabit(TODAY, "read");
    assert.strictEqual(ctx.wpHabitCount(TODAY), 1);
    assert.strictEqual(ctx.wpHabitCount(YDAY), 3, "ticking today never alters another date");
  }

  // ---------- 3: the catch-up prompt — yesterday only, only when something's missing ----------
  {
    // (a) yesterday started with two missing → prompt, naming exactly those two
    const { ctx } = await boot({
      checkins: {
        [TWO_AGO]: started(TWO_AGO, {}),                       // older day, also incomplete
        [YDAY]: started(YDAY, { read: true }),
        [TODAY]: started(TODAY),
      },
      plans: { [THIS_WEEK]: { weekEnding: THIS_WEEK, placements: {} } },
    });
    await ctx.loadWeeklyPlan(THIS_WEEK);
    const c = ctx.wpHabitCatchup();
    assert.ok(c, "prompt offered");
    assert.strictEqual(c.date, YDAY, "…about yesterday only, never the older day");
    assert.deepStrictEqual(Array.from(c.missing, (h) => h.id), ["mobility", "house"], "names the unticked habits");
    const html = todayHtml(ctx);
    assert.ok(html.includes("Did you actually do them?"), "the prompt renders");
    assert.ok(html.includes("Mobility") && html.includes("House") && !html.includes("Read — I did it"), "only the missed ones are offered");
  }
  {
    // (b) yesterday fully ticked → no prompt
    const { ctx } = await boot({
      checkins: { [YDAY]: started(YDAY, { read: true, mobility: true, house: true }), [TODAY]: started(TODAY) },
      plans: { [THIS_WEEK]: { weekEnding: THIS_WEEK, placements: {} } },
    });
    await ctx.loadWeeklyPlan(THIS_WEEK);
    assert.strictEqual(ctx.wpHabitCatchup(), null, "nothing to ask when yesterday was complete");
    assert.ok(!todayHtml(ctx).includes("Did you actually do them?"));
  }
  {
    // (c) yesterday never started (no entry, or an entry that was never dismissed) → no prompt
    const { ctx } = await boot({
      checkins: { [TWO_AGO]: started(TWO_AGO, {}), [TODAY]: started(TODAY) },
      plans: { [THIS_WEEK]: { weekEnding: THIS_WEEK, placements: {} } },
    });
    await ctx.loadWeeklyPlan(THIS_WEEK);
    assert.strictEqual(ctx.wpHabitCatchup(), null, "no started day yesterday → no prompt (and never about older days)");

    ctx.__wpState.checkins[YDAY] = entry({ date: YDAY, dismissed: false });
    assert.strictEqual(ctx.wpHabitCatchup(), null, "an un-started yesterday doesn't prompt either");
  }

  // ---------- 4: catch-up marks yesterday, and only asks once per day ----------
  {
    const { ctx, posts } = await boot({
      checkins: { [YDAY]: started(YDAY, { read: true }), [TODAY]: started(TODAY, { read: true }) },
      plans: { [THIS_WEEK]: { weekEnding: THIS_WEEK, placements: {} } },
    });
    await ctx.loadWeeklyPlan(THIS_WEEK);

    await ctx.wpHabitCatchupMark("mobility");
    assert.strictEqual(ctx.wpHabitDone(YDAY, "mobility"), true, "marked done after the fact on YESTERDAY");
    assert.strictEqual(ctx.wpHabitCount(YDAY), 2, "yesterday's count updated");
    assert.strictEqual(ctx.wpHabitCount(TODAY), 1, "today's record untouched");
    assert.strictEqual(checkinPosts(posts).pop().body.checkin.date, YDAY, "the write was against yesterday");

    // still one missing → still asks
    let c = ctx.wpHabitCatchup();
    assert.deepStrictEqual(Array.from(c.missing, (h) => h.id), ["house"]);

    // "leave as missed" → flags TODAY as asked, and it never comes back today
    await ctx.wpHabitCatchupDismiss();
    assert.strictEqual(ctx.wpHabitCatchup(), null, "dismissed for today");
    assert.strictEqual(ctx.wpCheckinEntry(TODAY).habitsAsked, true, "the flag is stored on today's entry");
    assert.strictEqual(ctx.wpHabitDone(YDAY, "house"), false, "…and the missed habit stays missed");
    assert.ok(!todayHtml(ctx).includes("Did you actually do them?"), "prompt gone");

    // marking every missing habit also clears it naturally
    await ctx.wpCheckinSave(TODAY, { habitsAsked: false });
    assert.ok(ctx.wpHabitCatchup(), "asking again for this check");
    await ctx.wpHabitCatchupMark("house");
    assert.strictEqual(ctx.wpHabitCatchup(), null, "nothing left to ask once yesterday is complete");
  }

  // ---------- 5: the weekly tracker counts each habit across the 7 days ----------
  {
    const checkins = {};
    // Mon+Tue+Wed read, Mon mobility, nothing for house
    checkins[dateAt(0)] = started(dateAt(0), { read: true, mobility: true });
    checkins[dateAt(1)] = started(dateAt(1), { read: true, mobility: false });
    checkins[dateAt(2)] = started(dateAt(2), { read: true });
    const { ctx } = await boot({ checkins, plans: { [THIS_WEEK]: { weekEnding: THIS_WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(THIS_WEEK);

    const st = ctx.wpHabitWeekStats();
    const by = {}; st.per.forEach((p) => { by[p.habit.id] = p.done; });
    assert.deepStrictEqual(by, { read: 3, mobility: 1, house: 0 }, "per-habit weekly counts are right");
    assert.strictEqual(st.total, 4, "week total");
    assert.strictEqual(st.max, 21, "3 habits × 7 days");
    assert.strictEqual(Array.from(st.per[0].cells).filter((c) => c.done).length, 3, "one cell per day, ticks where recorded");
    assert.strictEqual(st.per[0].cells[0].date, dateAt(0), "cells align Monday-first with the viewed week");

    const html = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(html.includes("wp-nnw"), "the tracker renders in the End-of-Week Review");
    assert.ok(html.includes("3/7") && html.includes("1/7") && html.includes("0/7"), "per-habit counts shown");
    assert.ok(html.includes("4 of 21 this week"), "week total shown");
    // read-only: no inputs, no handlers in the tracker block
    const block = html.slice(html.indexOf('<div class="wp-nnw">'), html.indexOf('<div class="wp-review-grid">'));
    assert.ok(!/<input|onclick|onchange/.test(block), "the tracker is a read-only summary");

    // a different week reads its own dates (no leakage)
    await ctx.loadWeeklyPlan("2026-03-16");
    const other = ctx.wpHabitWeekStats();
    assert.strictEqual(other.total, 0, "another week shows no ticks from this one");
  }

  // ---------- 6: habits appear in the Copy week output ----------
  {
    const checkins = {};
    checkins[dateAt(0)] = started(dateAt(0), { read: true, mobility: true, house: true });
    checkins[dateAt(3)] = started(dateAt(3), { read: true });
    const { ctx } = await boot({ checkins, plans: { [THIS_WEEK]: { weekEnding: THIS_WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(THIS_WEEK);
    const text = ctx.wpBuildWeekText();
    assert.ok(text.includes("DAILY NON-NEGOTIABLES"), "section present");
    assert.ok(text.includes("Read (Read a minimum 10 pages of a self-development book):"), "habit named with its full text");
    assert.ok(/Read \(.*\): Mon \[x\], Tue \[ \], Wed \[ \], Thu \[x\]/.test(text), "per-day ticks in day order");
    assert.ok(text.includes("— 2/7"), "per-habit count");
    assert.ok(text.includes("Total: 4/21"), "week total");
    assert.ok(!/[<>]/.test(text.slice(text.indexOf("DAILY NON-NEGOTIABLES"), text.indexOf("Total: 4/21"))), "plain text only");

    // a week with no habit data at all doesn't add an empty section
    const { ctx: ctx2 } = await boot({ plans: { "2026-03-16": { weekEnding: "2026-03-16", placements: {} } } });
    await ctx2.loadWeeklyPlan("2026-03-16");
    assert.ok(!ctx2.wpBuildWeekText().includes("DAILY NON-NEGOTIABLES"), "section skipped when there's nothing to say");
  }

  // ---------- 7: additive only — existing behaviour untouched ----------
  {
    const defaults = [{ id: "r1", title: "Scorecard", days: ["mon", "wed"], time: "6-9" }];
    const { ctx } = await boot({
      defaults,
      locations: { mon: "warrington" },
      checkins: { [TODAY]: started(TODAY, { read: true }) },
      plans: {
        [THIS_WEEK]: {
          weekEnding: THIS_WEEK,
          placements: { "6-9:mon": ["recurring:r1"] },
          recurringDone: { "r1:mon": true },
          exceptions: { "recurring:r1": { type: "skip", from: "6-9:wed" } },
          locations: { fri: "home" },
          timeBlocks: { "6-9": { mon: "keep me" } },
        },
      },
    });
    await ctx.loadWeeklyPlan(THIS_WEEK);
    const before = JSON.stringify({
      plan: ctx.__wpState.plan, defaults: ctx.__wpState.defaults, eff: ctx.wpEffectivePlacements(),
    });

    await ctx.wpToggleHabit(TODAY, "mobility");
    await ctx.wpHabitCatchupDismiss();
    ctx.wpHabitWeekStats();

    assert.strictEqual(JSON.stringify({
      plan: ctx.__wpState.plan, defaults: ctx.__wpState.defaults, eff: ctx.wpEffectivePlacements(),
    }), before, "no task / placement / exception / location / done-state changed");

    // the v80 check-in fields on the same entry survive a habit write
    await ctx.wpCheckinSave(TODAY, { oneThing: "Ship v88", oneThingDone: true });
    await ctx.wpToggleHabit(TODAY, "house");
    const e = ctx.wpCheckinEntry(TODAY);
    assert.strictEqual(e.oneThing, "Ship v88", "check-in answers preserved");
    assert.strictEqual(e.oneThingDone, true, "…and its evening flag");
    assert.strictEqual(e.habits.house, true, "…alongside the habit tick");
  }

  // ---------- 8: the store's whitelist keeps the entry clean ----------
  {
    const src = fs.readFileSync(path.join(__dirname, "../netlify/functions/kpi-store.js"), "utf8");
    const block = /const VALID_HABITS[\s\S]*?\nfunction cleanHabits[\s\S]*?\n}\n/.exec(src);
    assert.ok(block, "found the store's habit sanitiser");
    const clean = new Function(block[0] + "\nreturn cleanHabits;")();
    assert.deepStrictEqual(clean({ read: true, mobility: false, house: true }), { read: true, mobility: false, house: true }, "known ids kept as booleans");
    assert.deepStrictEqual(clean({ read: "yes", gym: true, house: 1 }), {}, "non-booleans and unknown ids stripped");
    assert.deepStrictEqual(clean(null), {}, "junk → empty");
    assert.deepStrictEqual(clean(["read"]), {}, "arrays rejected");
    assert.ok(/habits: cleanHabits\(raw\.habits\)/.test(src), "the check-in entry runs habits through it");
    assert.ok(/habitsAsked: !!raw\.habitsAsked/.test(src), "…and coerces the asked flag");
  }

  console.log("v88-non-negotiables.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
