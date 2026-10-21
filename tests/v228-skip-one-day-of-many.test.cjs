// v228 — skipping a second day of a repeating task no longer un-skips the first.
//
// Ash: "Lead Generation repeats daily, 9–11.30. Click ✕ on Tuesday's chip → Skip this week.
// Tuesday goes. Click ✕ on Thursday's chip → Skip this week. Thursday goes and TUESDAY COMES
// BACK."
//
// Cause: wpPlan.exceptions held ONE entry per task per week, so a daily task — seven
// occurrences — could only ever have one of them skipped or moved. Now the value is a list,
// one entry per OCCURRENCE, identified by the schedule-derived cell it comes from (`from`).
//
// Driven in the real weekly page, and through the real kpi-store save filter, because the
// store's whitelist dropping a list would bring the bug straight back on reload.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { boot } = require("./lib/env.cjs");

const WEEK = "2026-03-16";
const LEADS = "recurring:lg";
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const cell = (P, k) => Array.from(P[k] || []);
const list = (ctx) => Array.from(ctx.__wpState.plan.exceptions[LEADS] || []);
const daysShowing = (ctx) => {
  const E = ctx.wpEffectivePlacements();
  return DAYS.filter((d) => cell(E, "10-12:" + d).includes(LEADS));
};
const dragEv = () => ({ dataTransfer: { setData() {} } });
const dropEv = () => ({ preventDefault() {}, currentTarget: { classList: { remove() {} } }, dataTransfer: { getData: () => "" } });
const world = (exceptions) => ({
  defaults: [{ id: "lg", title: "Lead Generation", days: DAYS.slice(), time: "10-12" }],
  plans: { [WEEK]: Object.assign({ weekEnding: WEEK, placements: {} }, exceptions ? { exceptions } : {}) },
});
const skip = async (ctx, day) => { ctx.wpAsk = async () => "week"; await ctx.wpChipRemove(null, LEADS, "10-12:" + day); };
const lastSave = (posts) => posts.filter((p) => p.body && p.body.weeklyPlan && p.body.weeklyPlan.exceptions).pop().body.weeklyPlan;

(async () => {
  /* 1. Skip Tue, then Thu: both stay gone, the other five stay — and it survives a reload */
  {
    const { ctx, posts } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    await skip(ctx, "tue");
    await skip(ctx, "thu");
    assert.deepStrictEqual(daysShowing(ctx).join(","), "mon,wed,fri,sat,sun",
      "skipping Thursday after Tuesday leaves BOTH gone and the other five in place");
    assert.strictEqual(list(ctx).length, 2, "two occurrences, two entries");

    // reload: the week as saved, through the real store's filter
    const saved = lastSave(posts);
    const stored = await storeRoundTrip(saved.exceptions);
    const b = await boot(world(stored));
    await b.ctx.loadWeeklyPlan(WEEK);
    assert.deepStrictEqual(daysShowing(b.ctx).join(","), "mon,wed,fri,sat,sun", "…and it survives a reload");
  }

  /* 2. Skip Tue, then move Mon to 5–8: Tue stays gone AND Mon is in 5–8 */
  {
    const { ctx } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    await skip(ctx, "tue");
    ctx.wpAsk = async () => "week";
    ctx.wpChipDragStart(dragEv(), LEADS, "10-12:mon");
    await ctx.wpCellDrop(dropEv(), "5-8", "mon");
    const E = ctx.wpEffectivePlacements();
    assert.ok(!cell(E, "10-12:tue").includes(LEADS), "Tuesday stays skipped after a move elsewhere");
    assert.ok(cell(E, "5-8:mon").includes(LEADS) && !cell(E, "10-12:mon").includes(LEADS), "…and Monday is in 5–8");
    assert.strictEqual(list(ctx).length, 2, "…two entries, one per occurrence");

    // dragging the moved chip back home clears THAT entry only
    ctx.wpAsk = async () => "week";
    ctx.wpChipDragStart(dragEv(), LEADS, "5-8:mon");
    await ctx.wpCellDrop(dropEv(), "10-12", "mon");
    assert.deepStrictEqual(list(ctx).map((e) => e.type + "@" + e.from).join(","), "skip@10-12:tue",
      "moving Monday back home drops Monday's entry and keeps Tuesday's skip");
  }

  /* 3. Skip Tue twice: still one entry */
  {
    const { ctx } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    await skip(ctx, "tue");
    await skip(ctx, "tue");
    assert.strictEqual(list(ctx).length, 1, "skipping the same day twice is still one entry");
  }

  /* 4. Change the schedule so it no longer lands on Tue: the Tue skip is ignored */
  {
    const { ctx } = await boot(world({ [LEADS]: [{ type: "skip", from: "10-12:tue" }, { type: "skip", from: "10-12:thu" }] }));
    await ctx.loadWeeklyPlan(WEEK);
    // change the live schedule directly (the 📅 editor clears the week's exceptions on purpose,
    // which is a separate, deliberate rule this does not touch)
    ctx.__wpState.defaults.find((d) => d.id === "lg").days = ["mon", "wed", "thu", "fri"];
    assert.deepStrictEqual(daysShowing(ctx).join(","), "mon,wed,fri",
      "the Tue skip no longer matches an occurrence and is ignored; Thu's still applies; nothing else changes");
  }

  /* 5. A week holding the OLD single-object exception renders the same as before */
  {
    // with `from`: one occurrence
    let b = await boot(world({ [LEADS]: { type: "skip", from: "10-12:wed" } }));
    await b.ctx.loadWeeklyPlan(WEEK);
    assert.deepStrictEqual(daysShowing(b.ctx).join(","), "mon,tue,thu,fri,sat,sun", "an old skip still skips its one day");
    assert.strictEqual(list(b.ctx).length, 1, "…and is now a one-element list");
    assert.strictEqual(list(b.ctx)[0].from, "10-12:wed", "…of the same occurrence");
    // an old move
    b = await boot(world({ [LEADS]: { type: "move", from: "10-12:fri", to: "5-8:sat" } }));
    await b.ctx.loadWeeklyPlan(WEEK);
    const E = b.ctx.wpEffectivePlacements();
    assert.ok(!cell(E, "10-12:fri").includes(LEADS) && cell(E, "5-8:sat").includes(LEADS), "an old move still moves");
    // the oldest shape, a skip with no `from`, meant every occurrence this week — still does
    b = await boot(world({ [LEADS]: { type: "skip" } }));
    await b.ctx.loadWeeklyPlan(WEEK);
    assert.strictEqual(daysShowing(b.ctx).length, 0, "an old from-less skip still hides the whole week's occurrences");
    assert.strictEqual(list(b.ctx).length, 7, "…now written as one entry per occurrence, so nothing is lost");
    assert.ok(list(b.ctx).every((e) => e.from), "…every one of them with a `from`");
  }

  /* 6. Still per week: nothing rolls over */
  {
    const NEXT = "2026-03-23";
    const w = world({ [LEADS]: [{ type: "skip", from: "10-12:tue" }] });
    w.plans[NEXT] = { weekEnding: NEXT, placements: {} };
    const { ctx } = await boot(w);
    await ctx.loadWeeklyPlan(NEXT);
    assert.strictEqual(Object.keys(ctx.__wpState.plan.exceptions).length, 0, "next week starts with no exceptions");
    assert.strictEqual(daysShowing(ctx).length, 7, "…and shows every day");
  }

  console.log("v228-skip-one-day-of-many: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });

/* The real kpi-store save filter, run on what the page sent, returning what would be stored. */
async function storeRoundTrip(exceptions) {
  const src = fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "kpi-store.js"), "utf8");
  const m = new Map();
  globalThis.__fakeStore = {
    async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, v); },
    async list(o) { const p = (o && o.prefix) || ""; return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })), directories: [] }; },
  };
  const tmp = path.join(os.tmpdir(), "kpi-store-v228-" + process.pid + "-" + Date.now() + ".mjs");
  fs.writeFileSync(tmp, src.replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => globalThis.__fakeStore;"));
  const h = (await import("file://" + tmp)).default;
  fs.unlinkSync(tmp);
  const r = await h(new Request("https://x/.netlify/functions/kpi-store", { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weeklyPlan: { weekEnding: WEEK, exceptions: JSON.parse(JSON.stringify(exceptions)) } }) }));
  const plan = (await r.json()).plan;
  assert.strictEqual(plan.exceptions[LEADS].length, 2, "the store keeps BOTH entries — its filter takes a list");
  return plan.exceptions;
}
