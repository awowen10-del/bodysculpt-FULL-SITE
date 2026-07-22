// Core regression: pure helpers of the dashboard script still behave.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

(async () => {
  const { ctx } = await boot({ defaults: [] });

  // isoWeekNum — 2026-01-01 is a Thursday, so Jan 11 (Sun) sits in ISO week 2
  assert.strictEqual(ctx.isoWeekNum("2026-01-11"), 2, "isoWeekNum Jan 11 2026");
  assert.strictEqual(ctx.isoWeekNum("2026-01-05"), 2, "isoWeekNum Jan 5 2026 (Mon)");

  // derive — cpl / netGain / cancelRate maths
  const prev = { weekEnding: "2026-01-04", recurring: 100 };
  const wk = derived({ weekEnding: "2026-01-11", adSpend: 100, leads: 20, trialSales: 5, signups: 3, cancellations: 2, recurring: 101 });
  function derived(w) { return ctx.derive(w, prev); }
  assert.strictEqual(wk.cpl, 5, "derive cpl");
  assert.strictEqual(wk.netGain, 1, "derive netGain");
  assert.strictEqual(wk.cancelRate, 0.02, "derive cancelRate vs prev recurring");

  // wpToItems — legacy free-text coercion
  const items = ctx.wpToItems("- Task one\n• Task two\n");
  assert.strictEqual(items.length, 2, "wpToItems line count");
  assert.strictEqual(items[0].title, "Task one", "wpToItems strips bullets");
  assert.strictEqual(items[1].done, false, "wpToItems default done=false");

  // wpToItems — preserves monthly-link metadata
  const linked = ctx.wpToItems([{ id: "a1", title: "T", done: true, linkId: "monthly:x", source: "monthly-project", sourceYm: "2026-03", sourceProjectId: "p1" }]);
  assert.strictEqual(linked[0].linkId, "monthly:x", "wpToItems keeps linkId");
  assert.strictEqual(linked[0].sourceProjectId, "p1", "wpToItems keeps sourceProjectId");

  // wpNextWeekEnding — +7 days in UTC
  assert.strictEqual(ctx.wpNextWeekEnding("2026-03-16"), "2026-03-23", "wpNextWeekEnding");

  console.log("core.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
