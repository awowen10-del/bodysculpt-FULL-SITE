// v63 features that carry into v64 unchanged: link validation/rendering and
// per-day done-state compatibility (legacy v63 repeat:"weekdays" data maps to
// days:["mon".."fri"] and keeps using the same "<id>:<day>" done keys).
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const WEEK = "2026-03-16"; // a Monday inside NAV_WEEKS

(async () => {
  // ---------- 1: link only clickable when it's a valid http(s) URL ----------
  {
    const defaults = [{ id: "r1", title: "Standup <b>" }];
    const { ctx } = await boot({ defaults, plans: { [WEEK]: null } });
    await ctx.loadWeeklyPlan(WEEK);

    assert.strictEqual(ctx.wpValidUrl("https://example.com/x"), "https://example.com/x", "https accepted");
    assert.ok(ctx.wpValidUrl("http://foo.co.uk/page?a=1"), "http accepted");
    assert.strictEqual(ctx.wpValidUrl("example.com/page"), "https://example.com/page", "bare domain gets https");
    assert.strictEqual(ctx.wpValidUrl("  https://a.com  "), "https://a.com/", "whitespace stripped");
    assert.strictEqual(ctx.wpValidUrl("javascript:alert(1)"), null, "javascript: rejected");
    assert.strictEqual(ctx.wpValidUrl("data:text/html,x"), null, "data: rejected");
    assert.strictEqual(ctx.wpValidUrl("not a url"), null, "junk without hostname rejected");
    assert.strictEqual(ctx.wpValidUrl(""), null, "empty rejected");
    assert.ok(!ctx.wpValidUrl('https://x.com/a"b').includes('"'), "quotes encoded");

    const withLink = ctx.wpRecurRow({ id: "r1", title: "Standup <b>", link: "https://example.com/x" });
    assert.ok(withLink.includes('target="_blank"'), "opens in new tab");
    assert.ok(withLink.includes('rel="noopener noreferrer"'), "noopener noreferrer set");
    assert.ok(withLink.includes('href="https://example.com/x"'), "href is the validated URL");
    assert.ok(withLink.includes("&lt;b&gt;"), "title escaped");

    const badLink = ctx.wpRecurRow({ id: "r1", title: "Standup", link: "javascript:alert(1)" });
    assert.ok(!badLink.includes("<a "), "invalid link renders no anchor");
    const noLink = ctx.wpRecurRow({ id: "r1", title: "Standup" });
    assert.ok(!noLink.includes("<a "), "no link renders no anchor");
  }

  // ---------- 1b (v66): placed grid chips carry the same link affordance ----------
  {
    const defaults = [
      { id: "r1", title: "Standup", link: "https://example.com/x" },
      { id: "r2", title: "Scorecard" }, // no link
    ];
    const { ctx } = await boot({ defaults, plans: { [WEEK]: null } });
    await ctx.loadWeeklyPlan(WEEK);
    await ctx.wpPlaceRefAt("recurring:r1", "6-9", "mon");
    await ctx.wpPlaceRefAt("recurring:r2", "6-9", "tue");
    const html = ctx.document.getElementById("wpBody").innerHTML;

    // r1's chip renders the ↗ with the same validated href + safe attributes
    const chipLinks = html.split('class="wp-rec-link wp-chip-link"').length - 1;
    assert.strictEqual(chipLinks, 1, "exactly one chip link — only the linked task's chip");
    const chipAnchor = html.slice(html.indexOf('wp-chip-link'));
    assert.ok(chipAnchor.includes('href="https://example.com/x"'), "chip href is the validated URL");
    assert.ok(chipAnchor.slice(0, 200).includes('target="_blank"'), "chip link opens in new tab");
    assert.ok(chipAnchor.slice(0, 200).includes('rel="noopener noreferrer"'), "chip link noopener noreferrer");

    // r2's chip (no link) renders no anchor: its cell markup contains none
    const r2Cell = html.split('data-tb="6-9:tue"')[0].slice(-600); // chip markup precedes its cell textarea
    assert.ok(r2Cell.includes("Scorecard"), "sanity: looking at r2's cell");
    assert.ok(!r2Cell.includes("wp-chip-link"), "chip without link renders no ↗");
  }

  // ---------- 2: legacy v63 repeat:"weekdays" maps to days Mon–Fri, same done keys ----------
  {
    const defaults = [{ id: "r1", title: "Standup", repeat: "weekdays", time: "6-9" }];
    const existingDone = { "r1:wed": true, r9: true }; // v63-written keys must survive
    const plans = {
      [WEEK]: {
        weekEnding: WEEK,
        placements: { "6-9:mon": ["recurring:r1"] },
        recurringDone: { ...existingDone },
      },
    };
    const { ctx } = await boot({ defaults, plans });
    await ctx.loadWeeklyPlan(WEEK);
    const st = ctx.__wpState;
    const r1 = st.defaults.find((d) => d.id === "r1");

    assert.deepStrictEqual(Array.from(r1.days), ["mon", "tue", "wed", "thu", "fri"], "legacy repeat mapped to days");
    assert.strictEqual(ctx.wpIsDone("recurring", r1, "wed"), true, "v63 done key still read");
    await ctx.wpToggleDoneRef("recurring:r1", true, "mon");
    const rd = st.plan.recurringDone;
    assert.strictEqual(rd["r1:mon"], true, "same id:day key format as v63");
    assert.strictEqual(rd["r1:wed"], true, "existing per-day keys untouched");
    assert.strictEqual(rd.r9, true, "unrelated plain keys untouched");
    assert.ok(!("r1" in rd), "no plain-id key created for a multi-day task");
    assert.strictEqual(ctx.wpIsDone("recurring", r1), false, "struck-through only when ALL its days are done");
    for (const d of ["tue", "thu", "fri"]) await ctx.wpToggleDoneRef("recurring:r1", true, d);
    assert.strictEqual(ctx.wpIsDone("recurring", r1), true, "all selected days done → task done");
  }

  console.log("v63-features.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
