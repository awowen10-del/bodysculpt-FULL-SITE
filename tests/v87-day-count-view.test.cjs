// v87 regression: the day-count view control on the Time Blocks grid (1/2/3/5/7 days with a
// sliding window). This is a PURE VIEW FILTER — every assertion here exists to prove that
// narrowing the view renders fewer columns and changes NOTHING else: no task, placement,
// exception, location, done-state or free text is touched, and going back to 7 restores the
// exact same grid.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const WEEK = "2026-03-16"; // a Monday inside NAV_WEEKS
const NEXT = "2026-03-23";
const ALL = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// Which day columns are actually rendered, in order (the drop handler carries the day key).
function shownDays(ctx) {
  const html = ctx.document.getElementById("wpBody").innerHTML;
  const seen = [];
  const re = /wpCellDrop\(event,'6-9','(\w+)'\)/g;
  let m;
  while ((m = re.exec(html))) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}
function headerDays(ctx) {
  const html = ctx.document.getElementById("wpBody").innerHTML;
  return ALL.filter((d) => html.includes(`wpOpenLocPopup('${d}',this)`));
}
// Everything the view must never touch.
function snapshot(ctx) {
  const p = ctx.__wpState.plan;
  return JSON.stringify({
    timeBlocks: p.timeBlocks, placements: p.placements, exceptions: p.exceptions,
    locations: p.locations, recurringDone: p.recurringDone, trainingDone: p.trainingDone,
    projectItems: p.projectItems, bufferItems: p.bufferItems,
    defaults: ctx.__wpState.defaults, training: ctx.__wpState.training,
    locDefaults: ctx.__wpState.locDefaults, eff: ctx.wpEffectivePlacements(),
  });
}
// A week with something on every day, so a hidden day always has data to lose.
function world() {
  const tb = {};
  ["6-9", "10-12", "1-3", "5-8", "notes"].forEach((rk) => {
    tb[rk] = {};
    ALL.forEach((d) => { tb[rk][d] = rk + "/" + d + " text"; });
  });
  return {
    defaults: [{ id: "r1", title: "Scorecard", days: ["mon", "wed", "sun"], time: "6-9" }],
    training: [{ id: "t1", title: "Reformer", days: ["sat"], time: "5-8" }],
    locations: { mon: "warrington", sun: "home" },
    plans: {
      [WEEK]: {
        weekEnding: WEEK,
        timeBlocks: tb,
        bufferItems: [{ id: "b1", title: "Emails", done: false }],
        placements: { "1-3:fri": ["buffer:b1"] },
        recurringDone: { "r1:sun": true },
        exceptions: { "recurring:r1": { type: "skip", from: "6-9:wed" } },
        locations: { fri: "home" },
      },
      [NEXT]: null,
    },
  };
}

(async () => {
  // ---------- 1: default is 7 days, exactly as before ----------
  {
    const { ctx } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    assert.strictEqual(ctx.__wpState.dayCount, 7, "defaults to the whole week");
    assert.strictEqual(ctx.__wpState.dayStart, 0);
    assert.deepStrictEqual(shownDays(ctx), ALL, "all 7 columns rendered");
    assert.deepStrictEqual(headerDays(ctx), ALL, "all 7 day headers rendered");
    const html = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(html.includes(`class="wp-dv-n on"`), "the active count is marked");
    assert.ok(!html.includes("wpSlideDays"), "no window arrows at 7 days — nothing to slide");
  }

  // ---------- 2: a count shows exactly that many contiguous columns ----------
  {
    const { ctx } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    for (const n of [1, 2, 3, 5, 7]) {
      ctx.wpSetDayCount(n);
      const days = shownDays(ctx);
      assert.strictEqual(days.length, n, `${n} days → ${n} columns`);
      assert.deepStrictEqual(headerDays(ctx), days, "headers and cells agree");
      const first = ALL.indexOf(days[0]);
      assert.deepStrictEqual(days, ALL.slice(first, first + n), `${n} days → a contiguous window`);
      assert.strictEqual(ctx.__wpState.dayCount, n, "count recorded");
      assert.ok(ctx.document.getElementById("wpBody").innerHTML.includes(`wp-grid wp-cols-${n}`),
        "the table carries its column-count class (width rules)");
    }
    // an unknown count is ignored
    ctx.wpSetDayCount(4);
    assert.strictEqual(ctx.__wpState.dayCount, 7, "only the offered counts are accepted");
  }

  // ---------- 3: the window slides, and clamps at both ends of the week ----------
  {
    const { ctx } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpSetDayCount(3);
    // start from Monday regardless of where the default put it (today isn't in this week)
    assert.deepStrictEqual(shownDays(ctx), ["mon", "tue", "wed"], "opens at Monday");

    ctx.wpSlideDays(1);
    assert.deepStrictEqual(shownDays(ctx), ["tue", "wed", "thu"], "slides forward one day");
    ctx.wpSlideDays(1);
    assert.deepStrictEqual(shownDays(ctx), ["wed", "thu", "fri"], "…and again");
    ctx.wpSlideDays(-1);
    assert.deepStrictEqual(shownDays(ctx), ["tue", "wed", "thu"], "slides back one day");

    // clamp at the start
    for (let i = 0; i < 6; i++) ctx.wpSlideDays(-1);
    assert.deepStrictEqual(shownDays(ctx), ["mon", "tue", "wed"], "never slides before Monday");
    assert.strictEqual(ctx.__wpState.dayStart, 0);
    let html = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(/wp-dv-arrow" title="Earlier in the week" disabled/.test(html), "the back arrow is disabled at Monday");

    // clamp at the end
    for (let i = 0; i < 9; i++) ctx.wpSlideDays(1);
    assert.deepStrictEqual(shownDays(ctx), ["fri", "sat", "sun"], "never slides past Sunday");
    assert.strictEqual(ctx.__wpState.dayStart, 4, "window start clamped to 7 - count");
    html = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(/wp-dv-arrow" title="Later in the week" disabled/.test(html), "the forward arrow is disabled at Sunday");
    assert.ok(html.includes("Fri–Sun"), "the visible range is labelled");

    // widening from a late window keeps it inside the week
    ctx.wpSetDayCount(5);
    assert.strictEqual(shownDays(ctx).length, 5, "still exactly 5 columns");
    assert.deepStrictEqual(shownDays(ctx), ALL.slice(ALL.indexOf(shownDays(ctx)[0]), ALL.indexOf(shownDays(ctx)[0]) + 5));
  }

  // ---------- 4: hidden days keep every bit of their data, and come back unchanged ----------
  {
    const { ctx, posts } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    const before = snapshot(ctx);
    const fullHtml = ctx.document.getElementById("wpBody").innerHTML;
    const postsBefore = posts.length;

    ctx.wpSetDayCount(1);                       // hide six days
    assert.deepStrictEqual(shownDays(ctx), ["mon"]);
    assert.strictEqual(snapshot(ctx), before, "nothing in the plan changed when days were hidden");
    // the hidden days' free text is still in state
    assert.strictEqual(ctx.__wpState.plan.timeBlocks["5-8"].sun, "5-8/sun text", "hidden day's text intact");
    assert.strictEqual(ctx.__wpState.plan.timeBlocks["notes"].fri, "notes/fri text");
    assert.strictEqual(postsBefore, posts.length, "changing the view saves nothing");

    ctx.wpSlideDays(1); ctx.wpSlideDays(1);     // move across the week a bit
    ctx.wpSetDayCount(3);
    ctx.wpSetDayCount(7);                       // back to the whole week
    assert.strictEqual(snapshot(ctx), before, "round trip left the data identical");
    assert.deepStrictEqual(shownDays(ctx), ALL, "all 7 columns back");
    assert.strictEqual(ctx.document.getElementById("wpBody").innerHTML, fullHtml,
      "…and the grid renders byte-identically to before");
    assert.strictEqual(postsBefore, posts.length, "still no writes");
  }

  // ---------- 5: tasks / exceptions / locations / done-state are untouched by the view ----------
  {
    const { ctx } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpSetDayCount(3);
    ctx.wpSlideDays(1);                          // Tue–Thu: hides Mon (chip), Sun (chip+done), Sat (training)
    const html = ctx.document.getElementById("wpBody").innerHTML;

    // v83 derivation still drives what shows on the VISIBLE days…
    assert.ok(!html.includes("wpToggleDoneRef('recurring:r1',this.checked,'wed')"), "the v82 skip still applies");
    assert.ok(!html.includes("wpToggleDoneRef('recurring:r1',this.checked,'mon')"), "a hidden day's chip is simply not drawn");
    // …and the underlying state for hidden days is all still there
    assert.deepStrictEqual(Array.from(ctx.__wpState.defaults[0].days), ["mon", "wed", "sun"], "schedule untouched");
    assert.strictEqual(ctx.wpIsDone("recurring", ctx.__wpState.defaults[0], "sun"), true, "hidden day's done tick kept");
    assert.strictEqual(ctx.__wpState.plan.exceptions["recurring:r1"].type, "skip", "exception kept");
    assert.ok(ctx.wpEffectivePlacements()["6-9:sun"].includes("recurring:r1"), "hidden day still placed in the model");
    assert.strictEqual(ctx.wpLocationOf("sun"), "home", "hidden day's location still resolves");
    assert.strictEqual(ctx.wpLocationOf("fri"), "home", "…including a per-week override");

    // each VISIBLE day still shows its location + click-to-set exactly as in v84/v86
    assert.ok(html.includes(`wpOpenLocPopup('thu',this)`), "visible day header still opens the location control");
    ctx.wpSlideDays(1);                          // Wed–Fri, so the overridden Friday is visible
    const html2 = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(html2.includes(`class="wp-loctext wp-loc-home wp-loc-ovr"`),
      "the visible day's location badge renders as normal (override styling and all)");

    // a real edit through the narrowed view still writes the whole week
    await ctx.wpSetWeekLocation("wed", "warrington");
    const saved = ctx.__wpState.plan;
    assert.strictEqual(saved.locations.wed, "warrington", "edit applied");
    assert.strictEqual(saved.locations.fri, "home", "…without disturbing a hidden day's override");
    ALL.forEach((d) => assert.strictEqual(saved.timeBlocks["6-9"][d], "6-9/" + d + " text", "every day's text survives a save from a narrowed view"));
  }

  // ---------- 6: saves from a narrowed view carry all seven days ----------
  {
    const { ctx, posts } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpSetDayCount(2);
    await ctx.wpSaveSection("timeBlocks");
    const sent = posts.filter((p) => p.body && p.body.weeklyPlan).pop().body.weeklyPlan;
    ALL.forEach((d) => assert.strictEqual(sent.timeBlocks["1-3"][d], "1-3/" + d + " text", `${d} still saved`));
    assert.deepStrictEqual(Object.keys(sent.placements), ["1-3:fri"], "hidden day's placement still saved");
    assert.ok(sent.exceptions["recurring:r1"], "exception still saved");
    assert.strictEqual(sent.locations.fri, "home", "location override still saved");
    assert.strictEqual(sent.recurringDone["r1:sun"], true, "hidden day's done-state still saved");
  }

  // ---------- 7: count + window persist for the session (across re-render and week change) ----------
  {
    const { ctx } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpSetDayCount(3);
    ctx.wpSlideDays(1);
    assert.deepStrictEqual(shownDays(ctx), ["tue", "wed", "thu"]);

    ctx.renderWeeklyPlan();
    assert.deepStrictEqual(shownDays(ctx), ["tue", "wed", "thu"], "survives a plain re-render");

    await ctx.loadWeeklyPlan(NEXT);
    assert.strictEqual(ctx.__wpState.dayCount, 3, "count kept when changing week");
    assert.deepStrictEqual(shownDays(ctx), ["tue", "wed", "thu"], "…and so is the window position");

    await ctx.loadWeeklyPlan(WEEK);
    assert.deepStrictEqual(shownDays(ctx), ["tue", "wed", "thu"], "…and coming back");
  }

  // ---------- 8: the window opens on today when today is in the viewed week ----------
  {
    const now = new Date();
    const todayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][now.getUTCDay()];
    const d = new Date(now); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const thisWeek = d.toISOString().slice(0, 10);
    const { ctx } = await boot({ plans: { [thisWeek]: { weekEnding: thisWeek, placements: {} }, [NEXT]: null } });
    await ctx.loadWeeklyPlan(thisWeek);

    ctx.wpSetDayCount(1);
    assert.deepStrictEqual(shownDays(ctx), [todayKey], "1 day opens on today");

    ctx.wpSetDayCount(3);
    assert.ok(shownDays(ctx).includes(todayKey), "a wider window still includes today");
    assert.strictEqual(shownDays(ctx).length, 3, "…and is still exactly 3 columns inside the week");

    // a week that isn't this week falls back to Monday
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpSetDayCount(1);
    assert.deepStrictEqual(shownDays(ctx), ["mon"], "another week opens at Monday");
  }

  console.log("v87-day-count-view.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
