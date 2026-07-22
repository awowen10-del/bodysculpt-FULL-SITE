// v62 regression: recurring placements roll over from the nearest previous week
// that has them — only recurring refs, only tasks that still exist, and never
// overwriting a week that already has its own recurring placements.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const WEEK = "2026-03-16"; // a Monday inside NAV_WEEKS
const PREV = "2026-03-09";

(async () => {
  // ---------- 1: fresh week seeds from the previous week ----------
  {
    const defaults = [
      { id: "r1", title: "Standup", repeat: "weekdays", time: "6-9" },
      { id: "r2", title: "Scorecard" },
      // r3 deliberately NOT in defaults — deleted task, must be skipped
    ];
    const plans = {
      [WEEK]: null,
      [PREV]: {
        weekEnding: PREV,
        placements: {
          "6-9:mon": ["recurring:r1", "recurring:r3", "project:p9"],
          "6-9:tue": ["recurring:r1"],
          "6-9:wed": ["recurring:r1"],
          "6-9:thu": ["recurring:r1"],
          "6-9:fri": ["recurring:r1"],
          "1-3:thu": ["recurring:r2"],
        },
      },
    };
    const { ctx } = await boot({ defaults, plans });
    await ctx.loadWeeklyPlan(WEEK);
    const P = ctx.__wpState.plan.placements;

    // weekday task r1 rolled over to all five weekday cells
    ["mon", "tue", "wed", "thu", "fri"].forEach((d) =>
      assert.ok((P["6-9:" + d] || []).includes("recurring:r1"), "r1 rolled to 6-9:" + d)
    );
    // weekly task r2 rolled over to its single slot
    assert.ok((P["1-3:thu"] || []).includes("recurring:r2"), "r2 rolled to 1-3:thu");
    // deleted r3 skipped, project ref not copied
    const all = Object.values(P).flat();
    assert.ok(!all.includes("recurring:r3"), "deleted recurring task not seeded");
    assert.ok(!all.includes("project:p9"), "project placements do not roll over");
  }

  // ---------- 2: a week with its own recurring placements is left alone ----------
  {
    const defaults = [{ id: "r2", title: "Scorecard" }];
    const plans = {
      [WEEK]: {
        weekEnding: WEEK,
        placements: { "5-8:fri": ["recurring:r2"] }, // this week already scheduled it
      },
      [PREV]: {
        weekEnding: PREV,
        placements: { "6-9:mon": ["recurring:r2"] }, // previous week had it elsewhere
      },
    };
    const { ctx } = await boot({ defaults, plans });
    await ctx.loadWeeklyPlan(WEEK);
    const P = ctx.__wpState.plan.placements;
    assert.ok((P["5-8:fri"] || []).includes("recurring:r2"), "own placement kept");
    assert.ok(!(P["6-9:mon"] || []).includes("recurring:r2"), "own week not overwritten by rollover");
  }

  // ---------- 3: rollover walks back past an empty week ----------
  {
    const FAR = "2026-03-02"; // two weeks back
    const defaults = [{ id: "r2", title: "Scorecard" }];
    const plans = {
      [WEEK]: null,
      [PREV]: { weekEnding: PREV, placements: {} }, // exists but has no recurring refs
      [FAR]: { weekEnding: FAR, placements: { "10-12:wed": ["recurring:r2"] } },
    };
    const { ctx } = await boot({ defaults, plans });
    await ctx.loadWeeklyPlan(WEEK);
    const P = ctx.__wpState.plan.placements;
    assert.ok((P["10-12:wed"] || []).includes("recurring:r2"), "seeded from 2 weeks back");
  }

  console.log("v62-rollover.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
