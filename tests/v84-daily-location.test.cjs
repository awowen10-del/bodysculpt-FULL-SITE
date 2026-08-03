// v84 regression: daily location on the Time Blocks grid. A DEFAULT weekly pattern
// (its own blob key) applies to every week; a week may override a day for that week only.
// Same precedence shape as the v82/v83 task model — default → this week's overrides on top
// — and, like exceptions, an override never leaks into another week. Purely informational:
// no task, placement, done-state or exception behaviour changes.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/env.cjs");

const WEEK = "2026-03-16"; // a Monday inside NAV_WEEKS
const NEXT = "2026-03-23";
const LATER = "2026-03-30";

// the fixed list under test (WP_LOCATIONS in index.html / VALID_LOCATIONS in kpi-store.js)
const LOCATION_KEYS = ["warrington", "home"];
const PATTERN = { mon: "warrington", tue: "home", wed: "warrington" };
const locPosts = (posts) => posts.filter((p) => p.body && p.body.locationDefaults);
const weeklyPosts = (posts) => posts.filter((p) => p.body && p.body.weeklyPlan);

(async () => {
  // ---------- 1: the default pattern shows on a fresh week ----------
  {
    const { ctx } = await boot({ locations: { ...PATTERN }, plans: { [WEEK]: null } });
    await ctx.loadWeeklyPlan(WEEK);
    assert.strictEqual(ctx.wpLocationOf("mon"), "warrington", "Monday follows the pattern");
    assert.strictEqual(ctx.wpLocationOf("tue"), "home", "Tuesday follows the pattern");
    assert.strictEqual(ctx.wpLocationOf("thu"), "", "a day with no pattern entry is unset");
    assert.strictEqual(Object.keys(ctx.__wpState.plan.locations).length, 0, "a fresh week carries no overrides");
    assert.ok(!ctx.wpLocIsOverride("mon"), "…and nothing reads as an override");

    const html = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(html.includes(`wpOpenLocPopup('mon',this)`), "the day header is the click target");
    // v86: the header location is quiet text (divider + 📍 + place), not a filled pill
    assert.ok(html.includes(`class="wp-loctext wp-loc-warrington"`), "Warrington rendered with its own colour class");
    assert.ok(html.includes(`class="wp-loctext wp-loc-home"`), "Home rendered with its own colour class");
    assert.ok(html.includes("📍") && html.includes(`class="wp-loclbl">Warrington<`), "pin + plain place text");
    assert.ok(html.includes(`class="wp-locset"`), "unset days show only the click-to-set affordance");
    assert.ok(!/class="wp-locset[^"]*"[^>]*>[^<]*📍/.test(html), "…with no stray pin");
    assert.ok(html.includes("📍 Locations"), "the default-pattern control is in the grid header");
  }

  // ---------- 2: a per-week override applies to that week only ----------
  {
    const { ctx, posts } = await boot({
      locations: { ...PATTERN },
      plans: { [WEEK]: { weekEnding: WEEK, placements: {} }, [NEXT]: null },
    });
    await ctx.loadWeeklyPlan(WEEK);
    await ctx.wpSetWeekLocation("mon", "home");

    assert.strictEqual(ctx.wpLocationOf("mon"), "home", "the override wins for this week");
    assert.ok(ctx.wpLocIsOverride("mon"), "…and is flagged as an override");
    assert.strictEqual(ctx.__wpState.plan.locations.mon, "home", "stored on the week's plan");
    assert.deepStrictEqual({ ...ctx.__wpState.locDefaults }, PATTERN, "the default pattern is untouched");
    assert.strictEqual(locPosts(posts).length, 0, "…and never written");
    const saved = weeklyPosts(posts).pop().body.weeklyPlan;
    assert.strictEqual(saved.locations.mon, "home", "persisted on the week's own save");
    assert.strictEqual(saved.weekEnding, WEEK, "against this week only");

    // the next week (fresh) is untouched by it — overrides never roll over
    await ctx.loadWeeklyPlan(NEXT);
    assert.strictEqual(Object.keys(ctx.__wpState.plan.locations).length, 0, "no override carried forward");
    assert.strictEqual(ctx.wpLocationOf("mon"), "warrington", "next week follows the default pattern");
  }

  // ---------- 3: editing the default propagates to every non-overridden week ----------
  {
    const { ctx, posts } = await boot({
      locations: { ...PATTERN },
      plans: {
        [WEEK]: { weekEnding: WEEK, placements: {} },
        // NEXT has its own override for Monday
        [NEXT]: { weekEnding: NEXT, placements: {}, locations: { mon: "home" } },
        [LATER]: null,
      },
    });
    await ctx.loadWeeklyPlan(WEEK);
    await ctx.wpSetLocationDefault("mon", "home");
    await ctx.wpSetLocationDefault("thu", "warrington");

    assert.strictEqual(ctx.wpLocationOf("mon"), "home", "the week you're on updates immediately");
    assert.strictEqual(ctx.wpLocationOf("thu"), "warrington", "a newly-set day too");
    const dp = locPosts(posts).pop();
    assert.strictEqual(dp.body.locationDefaults.mon, "home", "the pattern was saved to its own key");
    assert.strictEqual(dp.body.locationDefaults.thu, "warrington");
    assert.strictEqual(weeklyPosts(posts).length, 0, "editing the default writes no week plan");

    await ctx.loadWeeklyPlan(LATER);
    assert.strictEqual(ctx.wpLocationOf("mon"), "home", "a fresh future week follows the new pattern");
    assert.strictEqual(ctx.wpLocationOf("thu"), "warrington");

    await ctx.loadWeeklyPlan(NEXT);
    assert.strictEqual(ctx.wpLocationOf("mon"), "home", "the overridden week keeps its own value");
    assert.ok(ctx.wpLocIsOverride("mon"), "…still as an override");
    assert.strictEqual(ctx.wpLocationOf("tue"), "home", "its non-overridden days follow the pattern");
  }

  // ---------- 4: clearing — this week, back to default, and in the pattern ----------
  {
    const { ctx } = await boot({ locations: { ...PATTERN }, plans: { [WEEK]: { weekEnding: WEEK, placements: {} }, [NEXT]: null } });
    await ctx.loadWeeklyPlan(WEEK);

    // (a) "Nowhere" this week — an explicit clear, distinct from having no override
    await ctx.wpSetWeekLocation("mon", "");
    assert.strictEqual(ctx.wpLocationOf("mon"), "", "cleared for this week");
    assert.ok(ctx.wpLocIsOverride("mon"), "…as a real override, not a fallthrough");
    assert.strictEqual(ctx.__wpState.locDefaults.mon, "warrington", "the pattern still says Warrington");
    assert.ok(ctx.document.getElementById("wpBody").innerHTML.includes(`class="wp-locset wp-loc-ovr"`),
      "a cleared day falls back to the click-to-set affordance, marked as an override");

    // (b) "Use default" removes the override
    await ctx.wpClearWeekLocation("mon");
    assert.ok(!ctx.wpLocIsOverride("mon"), "override dropped");
    assert.strictEqual(ctx.wpLocationOf("mon"), "warrington", "back on the pattern");

    // (c) clearing a day in the DEFAULT pattern unsets it everywhere non-overridden
    await ctx.wpSetLocationDefault("tue", "");
    assert.ok(!("tue" in ctx.__wpState.locDefaults), "day removed from the pattern");
    assert.strictEqual(ctx.wpLocationOf("tue"), "", "unset on this week");
    await ctx.loadWeeklyPlan(NEXT);
    assert.strictEqual(ctx.wpLocationOf("tue"), "", "…and on a fresh week");
  }

  // ---------- 5: only valid locations + day keys survive (client and server) ----------
  {
    const { ctx } = await boot({
      // junk served by the store must not reach the app's state
      locations: { mon: "warrington", funday: "home", tue: "the pub", wed: 7, thu: "" },
      plans: {
        [WEEK]: {
          weekEnding: WEEK, placements: {},
          locations: { fri: "home", sat: "moon", nope: "home", sun: "" },
        },
      },
    });
    await ctx.loadWeeklyPlan(WEEK);
    assert.deepStrictEqual({ ...ctx.__wpState.locDefaults }, { mon: "warrington" }, "pattern sanitised on load ('' not allowed in the pattern)");
    assert.deepStrictEqual({ ...ctx.__wpState.plan.locations }, { fri: "home", sun: "" }, "week overrides sanitised on load ('' allowed = cleared)");

    // the setters refuse anything off the list
    await ctx.wpSetWeekLocation("mon", "pub");
    assert.ok(!ctx.wpLocIsOverride("mon"), "unknown location rejected");
    await ctx.wpSetWeekLocation("funday", "home");
    assert.strictEqual(Object.keys(ctx.__wpState.plan.locations).length, 2, "unknown day key rejected");
    await ctx.wpSetLocationDefault("funday", "home");
    await ctx.wpSetLocationDefault("mon", "pub");
    assert.deepStrictEqual({ ...ctx.__wpState.locDefaults }, { mon: "warrington" }, "the pattern rejects both too");

    // the server-side whitelist, exercised directly from kpi-store.js
    const src = fs.readFileSync(path.join(__dirname, "../netlify/functions/kpi-store.js"), "utf8");
    const block = /const VALID_LOCATIONS[\s\S]*?\nfunction sanitiseLocationMap[\s\S]*?\n}\n/.exec(src);
    assert.ok(block, "found the store's location sanitiser");
    const sanitise = new Function(block[0] + "\nreturn sanitiseLocationMap;")();
    assert.deepStrictEqual(
      sanitise({ mon: "warrington", tue: "home", wed: "pub", thu: 3, funday: "home", sun: "" }, false),
      { mon: "warrington", tue: "home" },
      "pattern: valid days + listed locations only, no ''"
    );
    assert.deepStrictEqual(
      sanitise({ fri: "home", sat: "", sun: "spa", __proto__: "x" }, true),
      { fri: "home", sat: "" },
      "week overrides: '' allowed, everything else stripped"
    );
    assert.deepStrictEqual(sanitise(null, true), {}, "junk input → empty map");
    assert.deepStrictEqual(sanitise(["home"], true), {}, "arrays rejected");
  }

  // ---------- 6: today's location shows in the Today modal ----------
  {
    const now = new Date();
    const dayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][now.getUTCDay()];
    const d = new Date(now); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const thisWeek = d.toISOString().slice(0, 10);
    const { ctx } = await boot({ locations: { [dayKey]: "home" }, plans: { [thisWeek]: { weekEnding: thisWeek, placements: {} } } });
    await ctx.loadWeeklyPlan(thisWeek);
    ctx.wpRenderTodayBody();
    const html = ctx.document.getElementById("wpTodayBody").innerHTML;
    assert.ok(html.includes("wp-today-loc") && html.includes("Home"), "the modal shows today's location");
    assert.ok(html.includes("Where you are today"));

    // a per-week override wins there too
    await ctx.wpSetWeekLocation(dayKey, "warrington");
    ctx.wpRenderTodayBody();
    const html2 = ctx.document.getElementById("wpTodayBody").innerHTML;
    assert.ok(html2.includes("Warrington") && !html2.includes(">Home<"), "override reflected in the modal");
  }

  // ---------- 7: nothing about tasks / placements / exceptions changes ----------
  {
    const defaults = [{ id: "r1", title: "Scorecard", days: ["mon", "wed"], time: "6-9" }];
    const { ctx, posts } = await boot({
      defaults,
      locations: { ...PATTERN },
      plans: {
        [WEEK]: {
          weekEnding: WEEK,
          placements: { "6-9:mon": ["recurring:r1"], "6-9:wed": ["recurring:r1"] },
          recurringDone: { "r1:mon": true },
          exceptions: { "recurring:r1": { type: "skip", from: "6-9:wed" } },
        },
      },
    });
    await ctx.loadWeeklyPlan(WEEK);
    const before = JSON.stringify({
      placements: ctx.__wpState.plan.placements,
      exceptions: ctx.__wpState.plan.exceptions,
      done: ctx.__wpState.plan.recurringDone,
      defaults: ctx.__wpState.defaults,
      eff: ctx.wpEffectivePlacements(),
    });

    await ctx.wpSetWeekLocation("mon", "home");
    await ctx.wpSetLocationDefault("fri", "home");
    await ctx.wpClearWeekLocation("mon");

    assert.strictEqual(JSON.stringify({
      placements: ctx.__wpState.plan.placements,
      exceptions: ctx.__wpState.plan.exceptions,
      done: ctx.__wpState.plan.recurringDone,
      defaults: ctx.__wpState.defaults,
      eff: ctx.wpEffectivePlacements(),
    }), before, "location edits touch no task state at all");

    // the v82 skip still hides Wednesday's chip; Monday's chip still renders + ticks
    const html = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(html.includes("wpToggleDoneRef('recurring:r1',this.checked,'mon')"), "grid chip unchanged");
    assert.ok(!html.includes("wpToggleDoneRef('recurring:r1',this.checked,'wed')"), "the skip exception still applies");
    // the week save still carries every other timeBlocks field
    const saved = weeklyPosts(posts).pop().body.weeklyPlan;
    ["timeBlocks", "placements", "recurringDone", "trainingDone", "exceptions", "locations"].forEach((f) =>
      assert.ok(f in saved, `${f} still on the timeBlocks save`));
  }

  // ---------- 8: the popups offer exactly the fixed list ----------
  {
    const { ctx } = await boot({ locations: { ...PATTERN }, plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);

    const pop = ctx.wpOpenLocPopup("mon", null);
    assert.ok(pop, "per-day popup opens");
    LOCATION_KEYS.forEach((k) =>
      assert.ok(pop.innerHTML.includes(`wpSetWeekLocation('mon','${k}')`), `offers ${k}`));
    assert.ok(pop.innerHTML.includes(`wpSetWeekLocation('mon','')`), "offers a clear");
    assert.ok(pop.innerHTML.includes("wpOpenLocDefaultsPopup"), "links to the default-pattern editor");
    assert.ok(!pop.innerHTML.includes("wpClearWeekLocation"), "no 'use default' when there's no override");

    ctx.wpSetWeekLocation("mon", "home");
    assert.ok(ctx.wpOpenLocPopup("mon", null).innerHTML.includes("wpClearWeekLocation('mon')"),
      "'use default' appears once the day is overridden");

    const dpop = ctx.wpOpenLocDefaultsPopup(null);
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].forEach((d) =>
      assert.ok(dpop.innerHTML.includes(`wpSetLocationDefault('${d}','warrington')`), `pattern editor covers ${d}`));
    assert.ok(dpop.innerHTML.includes(`wpSetLocationDefault('sun','')`), "…and can unset a day");
  }

  console.log("v84-daily-location.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
