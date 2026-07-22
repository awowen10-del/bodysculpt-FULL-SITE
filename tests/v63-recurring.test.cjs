// v63 harness — weekday repeat, per-day done-state, link validation.
// Asserts: weekday task places Mon–Fri only; existing weekly tasks unchanged;
// v62 rollover still works for weekday tasks (see v62-rollover.test.js for the
// full rollover suite); per-day done-state never corrupts existing data; link
// is only clickable when it's a valid http(s) URL.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const WEEK = "2026-03-16"; // a Monday inside NAV_WEEKS
const REF1 = "recurring:r1";
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"];

function keysHolding(P, ref) {
  return Object.keys(P).filter((k) => (P[k] || []).includes(ref));
}

(async () => {
  // ---------- 1: weekday task places Mon–Fri only (weekend always excluded) ----------
  {
    const defaults = [
      { id: "r1", title: "Standup", repeat: "weekdays" },
      { id: "r2", title: "Scorecard" }, // no repeat field → weekly
    ];
    const { ctx, posts } = await boot({ defaults, plans: { [WEEK]: null } });
    await ctx.loadWeeklyPlan(WEEK);
    const st = ctx.__wpState;

    await ctx.wpPlaceRefAt(REF1, "6-9", "wed");
    let P = st.plan.placements;
    WEEKDAYS.forEach((d) =>
      assert.ok((P["6-9:" + d] || []).includes(REF1), "weekday task placed at 6-9:" + d)
    );
    assert.strictEqual(keysHolding(P, REF1).length, 5, "weekday task occupies exactly 5 cells");
    assert.ok(!keysHolding(P, REF1).some((k) => k.endsWith(":sat") || k.endsWith(":sun")), "no weekend placement");

    // dropping it on Saturday still lands Mon–Fri (at the new time), never the weekend
    await ctx.wpPlaceRefAt(REF1, "10-12", "sat");
    P = st.plan.placements;
    WEEKDAYS.forEach((d) =>
      assert.ok((P["10-12:" + d] || []).includes(REF1), "sat drop re-placed at 10-12:" + d)
    );
    assert.strictEqual(keysHolding(P, REF1).length, 5, "old slots cleared on move");
    assert.ok(!keysHolding(P, REF1).some((k) => k.endsWith(":sat")), "sat drop excluded weekend");

    // the task remembered its time on the shared default (and it was saved)
    assert.strictEqual(st.defaults.find((d) => d.id === "r1").time, "10-12", "time remembered on default");
    const defSaves = posts.filter((p) => Array.isArray(p.body.recurringDefaults));
    assert.ok(defSaves.length > 0, "defaults were persisted");
    const savedR1 = defSaves[defSaves.length - 1].body.recurringDefaults.find((d) => d.id === "r1");
    assert.strictEqual(savedR1.repeat, "weekdays", "repeat round-trips to the store");
    assert.strictEqual(savedR1.time, "10-12", "time round-trips to the store");

    // ---------- 2: existing weekly tasks unchanged ----------
    await ctx.wpPlaceRefAt("recurring:r2", "6-9", "tue");
    P = st.plan.placements;
    assert.deepStrictEqual(keysHolding(P, "recurring:r2"), ["6-9:tue"], "weekly task keeps single-slot placement");
    assert.ok(!st.defaults.find((d) => d.id === "r2").repeat, "no repeat field invented on weekly task");
    // a day-passing chip tick on a weekly task still uses the plain-id key
    await ctx.wpToggleDoneRef("recurring:r2", true, "tue");
    assert.strictEqual(st.plan.recurringDone.r2, true, "weekly done keyed by plain id");
    assert.ok(!("r2:tue" in st.plan.recurringDone), "weekly done never keyed per-day");

    // ---------- 2b: explicit toggle weekly ⇄ weekdays ----------
    await ctx.wpToggleRepeat("r2"); // weekly → weekdays: expand current slot across Mon–Fri
    P = st.plan.placements;
    assert.strictEqual(st.defaults.find((d) => d.id === "r2").repeat, "weekdays", "toggle sets repeat");
    WEEKDAYS.forEach((d) =>
      assert.ok((P["6-9:" + d] || []).includes("recurring:r2"), "toggle expanded to 6-9:" + d)
    );
    assert.strictEqual(keysHolding(P, "recurring:r2").length, 5, "toggle → exactly 5 cells");
    await ctx.wpToggleRepeat("r2"); // weekdays → weekly: collapse to Monday at its time
    P = st.plan.placements;
    assert.ok(!st.defaults.find((d) => d.id === "r2").repeat, "toggle back clears repeat");
    assert.deepStrictEqual(keysHolding(P, "recurring:r2"), ["6-9:mon"], "collapsed to a single Monday slot");

    // ---------- 2c: removing a weekday task clears all five cells ----------
    await ctx.wpRemoveRecurring("r1");
    P = st.plan.placements;
    assert.strictEqual(keysHolding(P, REF1).length, 0, "remove cleared every weekday cell");
    assert.ok(!st.defaults.some((d) => d.id === "r1"), "task removed from defaults");
  }

  // ---------- 3: v62 rollover still works for weekday tasks ----------
  {
    const PREV = "2026-03-09";
    const defaults = [{ id: "r1", title: "Standup", repeat: "weekdays", time: "6-9" }];
    const prevPlacements = {};
    WEEKDAYS.forEach((d) => (prevPlacements["6-9:" + d] = [REF1]));
    const plans = { [WEEK]: null, [PREV]: { weekEnding: PREV, placements: prevPlacements } };
    const { ctx } = await boot({ defaults, plans });
    await ctx.loadWeeklyPlan(WEEK);
    const P = ctx.__wpState.plan.placements;
    WEEKDAYS.forEach((d) =>
      assert.ok((P["6-9:" + d] || []).includes(REF1), "weekday task rolled over to 6-9:" + d)
    );
    assert.strictEqual(keysHolding(P, REF1).length, 5, "rollover reproduces exactly 5 cells");
  }

  // ---------- 4: per-day done-state doesn't corrupt existing data ----------
  {
    const defaults = [
      { id: "r1", title: "Standup", repeat: "weekdays", time: "6-9" },
      { id: "r2", title: "Scorecard" },
    ];
    const existingDone = { r2: true, "legacy-id": false }; // pre-v63 shape must survive
    const plans = { [WEEK]: { weekEnding: WEEK, placements: { "6-9:mon": [REF1] }, recurringDone: { ...existingDone } } };
    const { ctx } = await boot({ defaults, plans });
    await ctx.loadWeeklyPlan(WEEK);
    const st = ctx.__wpState;
    const r1 = st.defaults.find((d) => d.id === "r1");

    await ctx.wpToggleDoneRef(REF1, true, "wed");
    const rd = st.plan.recurringDone;
    assert.strictEqual(rd["r1:wed"], true, "weekday done keyed by id:day");
    assert.ok(!("r1" in rd), "no plain-id key created for a weekday task");
    assert.strictEqual(rd.r2, true, "existing weekly done-state untouched");
    assert.ok("legacy-id" in rd, "unknown legacy keys preserved, never deleted");

    assert.strictEqual(ctx.wpIsDone("recurring", r1, "wed"), true, "done for the ticked day");
    assert.strictEqual(ctx.wpIsDone("recurring", r1, "mon"), false, "other days unaffected");
    assert.strictEqual(ctx.wpIsDone("recurring", r1), false, "task-level done only when all days ticked");
    for (const d of WEEKDAYS) await ctx.wpToggleDoneRef(REF1, true, d);
    assert.strictEqual(ctx.wpIsDone("recurring", r1), true, "all five days ticked → task done");
  }

  // ---------- 5: link only clickable when it's a valid http(s) URL ----------
  {
    const defaults = [{ id: "r1", title: "Standup <b>" }];
    const { ctx } = await boot({ defaults, plans: { [WEEK]: null } });
    await ctx.loadWeeklyPlan(WEEK);

    // validator
    assert.strictEqual(ctx.wpValidUrl("https://example.com/x"), "https://example.com/x", "https accepted");
    assert.ok(ctx.wpValidUrl("http://foo.co.uk/page?a=1"), "http accepted");
    assert.strictEqual(ctx.wpValidUrl("example.com/page"), "https://example.com/page", "bare domain gets https");
    assert.strictEqual(ctx.wpValidUrl("  https://a.com  "), "https://a.com/", "whitespace stripped");
    assert.strictEqual(ctx.wpValidUrl("javascript:alert(1)"), null, "javascript: rejected");
    assert.strictEqual(ctx.wpValidUrl("data:text/html,x"), null, "data: rejected");
    assert.strictEqual(ctx.wpValidUrl("not a url"), null, "junk without hostname rejected");
    assert.strictEqual(ctx.wpValidUrl(""), null, "empty rejected");
    // quotes are percent-encoded by URL serialisation → attribute-safe
    assert.ok(!ctx.wpValidUrl('https://x.com/a"b').includes('"'), "quotes encoded");

    // row rendering: valid link → ↗ anchor with safe attributes
    const withLink = ctx.wpRecurRow({ id: "r1", title: "Standup <b>", link: "https://example.com/x" });
    assert.ok(withLink.includes('target="_blank"'), "opens in new tab");
    assert.ok(withLink.includes('rel="noopener noreferrer"'), "noopener noreferrer set");
    assert.ok(withLink.includes('href="https://example.com/x"'), "href is the validated URL");
    assert.ok(withLink.includes("&lt;b&gt;"), "title escaped");

    // invalid stored link → no anchor rendered at all
    const badLink = ctx.wpRecurRow({ id: "r1", title: "Standup", link: "javascript:alert(1)" });
    assert.ok(!badLink.includes("<a "), "invalid link renders no anchor");
    const noLink = ctx.wpRecurRow({ id: "r1", title: "Standup" });
    assert.ok(!noLink.includes("<a "), "no link renders no anchor");
  }

  console.log("v63-recurring.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
