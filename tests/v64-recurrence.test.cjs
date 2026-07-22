// v64 harness — recurrence = chosen day set + one preset time slot, wired to REAL
// placement refs. These assertions fail if the wiring breaks: days:["mon","wed","fri"]
// at a slot must produce refs in slot:mon/wed/fri and nowhere else; ticking/unticking
// a day adds/removes exactly that placement; existing single-day tasks unchanged;
// v62 rollover copies a multi-day task; per-day done never corrupts existing keys.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const WEEK = "2026-03-16"; // a Monday inside NAV_WEEKS
const REF1 = "recurring:r1";
const ALL_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function keysHolding(P, ref) {
  return Object.keys(P).filter((k) => (P[k] || []).includes(ref));
}
// count the chip instances actually rendered for a ref, and which days they're on
function renderedChipDays(ctx, ref) {
  const html = ctx.document.getElementById("wpBody").innerHTML;
  return ALL_DAYS.filter((d) => html.includes(`wpToggleDoneRef('${ref}',this.checked,'${d}')`));
}

(async () => {
  // ---------- 1: days ["mon","wed","fri"] at "10-12" → those refs and NOT other days ----------
  {
    const defaults = [
      { id: "r1", title: "Standup" },
      { id: "r2", title: "Scorecard" }, // stays single-day throughout
    ];
    // pre-existing unrelated ref shares a cell — must survive r1's edits untouched
    const plans = { [WEEK]: { weekEnding: WEEK, placements: { "10-12:fri": ["recurring:r2"] } } };
    const { ctx, posts } = await boot({ defaults, plans });
    await ctx.loadWeeklyPlan(WEEK);
    const st = ctx.__wpState;

    await ctx.wpSetRecurrence("r1", ["mon", "wed", "fri"], "10-12");
    let P = st.plan.placements;
    ["mon", "wed", "fri"].forEach((d) =>
      assert.ok((P["10-12:" + d] || []).includes(REF1), "placed at 10-12:" + d)
    );
    assert.deepStrictEqual(keysHolding(P, REF1).sort(), ["10-12:fri", "10-12:mon", "10-12:wed"], "exactly 3 placements — no other days");
    assert.ok(!keysHolding(P, REF1).some((k) => /:(tue|thu|sat|sun)$/.test(k)), "unticked days empty");

    // it RENDERS on all selected days, not just one
    assert.deepStrictEqual(renderedChipDays(ctx, REF1), ["mon", "wed", "fri"], "chips rendered on exactly the ticked days");

    // day set + slot persisted on the shared default
    const r1 = st.defaults.find((d) => d.id === "r1");
    assert.deepStrictEqual(Array.from(r1.days), ["mon", "wed", "fri"], "days stored on the item");
    assert.strictEqual(r1.time, "10-12", "slot stored on the item");
    const defSaves = posts.filter((p) => Array.isArray(p.body.recurringDefaults));
    const savedR1 = defSaves[defSaves.length - 1].body.recurringDefaults.find((d) => d.id === "r1");
    assert.deepStrictEqual(savedR1.days, ["mon", "wed", "fri"], "days round-trip to the store");
    assert.strictEqual(savedR1.time, "10-12", "time round-trips to the store");

    // ---------- 2: unticking a day removes exactly that placement ----------
    await ctx.wpSetRecurrence("r1", ["mon", "wed"], "10-12");
    P = st.plan.placements;
    assert.ok(!(P["10-12:fri"] || []).includes(REF1), "fri placement removed");
    assert.ok((P["10-12:fri"] || []).includes("recurring:r2"), "other refs in that cell untouched");
    assert.deepStrictEqual(keysHolding(P, REF1).sort(), ["10-12:mon", "10-12:wed"], "mon+wed kept exactly");

    // ticking days adds exactly those placements — weekend is allowed
    await ctx.wpSetRecurrence("r1", ["mon", "wed", "sat", "sun"], "10-12");
    P = st.plan.placements;
    assert.deepStrictEqual(keysHolding(P, REF1).sort(), ["10-12:mon", "10-12:sat", "10-12:sun", "10-12:wed"], "sat+sun placements added");
    assert.deepStrictEqual(renderedChipDays(ctx, REF1), ["mon", "wed", "sat", "sun"], "weekend chips render too");

    // ---------- 3: drag to another row moves the WHOLE set (drop day ignored) ----------
    await ctx.wpSetRecurrence("r1", ["mon", "wed", "fri"], "10-12");
    await ctx.wpPlaceRefAt(REF1, "1-3", "sun"); // dropped on Sunday's 12–3 cell
    P = st.plan.placements;
    assert.deepStrictEqual(keysHolding(P, REF1).sort(), ["1-3:fri", "1-3:mon", "1-3:wed"], "all days moved to the new slot; drop day not added");
    assert.strictEqual(st.defaults.find((d) => d.id === "r1").time, "1-3", "slot updated on the item");

    // ---------- 4: existing single-day tasks unchanged ----------
    await ctx.wpPlaceRefAt("recurring:r2", "6-9", "tue");
    P = st.plan.placements;
    assert.deepStrictEqual(keysHolding(P, "recurring:r2"), ["6-9:tue"], "single-day task keeps one placement");
    assert.ok(!st.defaults.find((d) => d.id === "r2").days, "no days field invented");
    await ctx.wpToggleDoneRef("recurring:r2", true, "tue");
    assert.strictEqual(st.plan.recurringDone.r2, true, "single-day done keyed by plain id");
    assert.ok(!("r2:tue" in st.plan.recurringDone), "no per-day key for a single-day task");

    // ---------- 5: empty day set switches recurrence off cleanly ----------
    await ctx.wpSetRecurrence("r1", [], "6-9");
    P = st.plan.placements;
    assert.strictEqual(keysHolding(P, REF1).length, 0, "no placements with no ticked days");
    assert.ok(!st.defaults.find((d) => d.id === "r1").days, "days field removed");
    assert.strictEqual(st.plan.recurringDone.r2, true, "done history untouched by recurrence edits");
  }

  // ---------- 6: v62 rollover copies a multi-day task (incl. Sunday) ----------
  {
    const PREV = "2026-03-09";
    const defaults = [{ id: "r1", title: "Standup", days: ["mon", "wed", "sun"], time: "6-9" }];
    const prevPlacements = { "6-9:mon": [REF1], "6-9:wed": [REF1], "6-9:sun": [REF1] };
    const plans = { [WEEK]: null, [PREV]: { weekEnding: PREV, placements: prevPlacements } };
    const { ctx } = await boot({ defaults, plans });
    await ctx.loadWeeklyPlan(WEEK);
    const P = ctx.__wpState.plan.placements;
    assert.deepStrictEqual(keysHolding(P, REF1).sort(), ["6-9:mon", "6-9:sun", "6-9:wed"], "rollover reproduced the full day set");
    assert.deepStrictEqual(renderedChipDays(ctx, REF1), ["mon", "wed", "sun"], "rolled-over task renders on all its days");
  }

  // ---------- 7: Sunday placements survive the plan cleaner ----------
  {
    const defaults = [{ id: "r1", title: "Standup", days: ["sun"], time: "6-9" }];
    const plans = { [WEEK]: { weekEnding: WEEK, placements: { "6-9:sun": [REF1] } } };
    const { ctx } = await boot({ defaults, plans });
    await ctx.loadWeeklyPlan(WEEK);
    const P = ctx.__wpState.plan.placements;
    assert.ok((P["6-9:sun"] || []).includes(REF1), "sun placement no longer dropped on load");
  }

  // ---------- 8: per-day done-state never corrupts existing keys ----------
  {
    const defaults = [{ id: "r1", title: "Standup", days: ["mon", "wed", "fri"], time: "6-9" }];
    const existingDone = { r2: true, "legacy-id": false, "r1:wed": true };
    const plans = { [WEEK]: { weekEnding: WEEK, placements: { "6-9:mon": [REF1], "6-9:wed": [REF1], "6-9:fri": [REF1] }, recurringDone: { ...existingDone } } };
    const { ctx } = await boot({ defaults, plans });
    await ctx.loadWeeklyPlan(WEEK);
    const st = ctx.__wpState;
    const r1 = st.defaults.find((d) => d.id === "r1");

    await ctx.wpToggleDoneRef(REF1, true, "mon");
    const rd = st.plan.recurringDone;
    assert.strictEqual(rd["r1:mon"], true, "per-day key written");
    assert.strictEqual(rd["r1:wed"], true, "pre-existing per-day key kept");
    assert.strictEqual(rd.r2, true, "plain keys of other tasks kept");
    assert.ok("legacy-id" in rd, "unknown legacy keys never deleted");
    assert.ok(!("r1" in rd), "no plain key for a multi-day task");
    assert.strictEqual(ctx.wpIsDone("recurring", r1), false, "not struck until every selected day done");
    await ctx.wpToggleDoneRef(REF1, true, "fri");
    assert.strictEqual(ctx.wpIsDone("recurring", r1), true, "mon+wed+fri all done → struck through");
  }

  console.log("v64-recurrence.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
