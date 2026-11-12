// v299: Finish week must not half-happen. Before: a failed read of next week replaced next
// week's lists with only the carried tasks, and a failed write still emptied the tray so the
// carried tasks were stored nowhere. Now each step must succeed before the next, a failure
// leaves the tray alone, and pressing again cannot add a task twice.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const monday = (ctx) => ctx.__wpState.weekEnding;
async function setup() {
  const env = await boot({});
  const ctx = env.ctx;
  const st = ctx.__wpState;
  const thisWeek = monday(ctx);
  const nextWeek = ctx.wpNextWeekEnding(thisWeek);
  st.plan.carryItems = [{ id: "a1", title: "Carry me", source: "project" }, { id: "b1", title: "And me", source: "buffer" }];
  const stored = { [nextWeek]: { weekEnding: nextWeek, projectItems: [{ id: "keep1", title: "Already planned", done: false }], bufferItems: [] } };
  const calls = [];
  const mode = { failRead: false, failWrite: false, failClear: false };
  ctx.fetch = async (url, o) => {
    const u = String(url);
    if (o && o.method === "POST") {
      const body = JSON.parse(o.body);
      calls.push(body);
      if (body.weeklyPlan && body.weeklyPlan.weekEnding === nextWeek && body.weeklyPlan.projectItems) {
        if (mode.failWrite) return { ok: false, status: 500, json: async () => ({}) };
        stored[nextWeek] = Object.assign({}, stored[nextWeek], body.weeklyPlan);
        return { ok: true, status: 200, json: async () => ({ ok: true, plan: stored[nextWeek] }) };
      }
      if (body.weeklyPlan && body.weeklyPlan.weekEnding === thisWeek && "carryItems" in body.weeklyPlan && Object.keys(body.weeklyPlan).length === 2) {
        if (mode.failClear) throw new Error("offline");
        stored[thisWeek] = { carryItems: [] };
        return { ok: true, status: 200, json: async () => ({ ok: true, plan: {} }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, plan: body.weeklyPlan || {} }) };
    }
    if (u.includes("weeklyplan=" + encodeURIComponent(nextWeek))) {
      if (mode.failRead) return { ok: false, status: 502, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ plan: stored[nextWeek] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { env, ctx, st, thisWeek, nextWeek, stored, calls, mode };
}
const titles = (list) => (list || []).map((x) => x.title);

(async () => {
  // a failed READ of next week: nothing is written, the tray is untouched
  {
    const t = await setup(); t.mode.failRead = true;
    await t.ctx.wpCommitFinish(); await t.env.settle();
    assert.strictEqual(t.calls.filter((b) => b.weeklyPlan && b.weeklyPlan.weekEnding === t.nextWeek).length, 0, "next week is not written when it could not be read");
    assert.deepStrictEqual(titles(t.stored[t.nextWeek].projectItems), ["Already planned"]);
    assert.strictEqual(t.st.plan.carryItems.length, 2, "the tray is as it was");
    assert.strictEqual(t.st.weekEnding, t.thisWeek, "and the page stays on this week");
  }
  // a failed WRITE to next week: the tray is not cleared
  {
    const t = await setup(); t.mode.failWrite = true;
    await t.ctx.wpCommitFinish(); await t.env.settle();
    assert.strictEqual(t.st.plan.carryItems.length, 2, "the tray keeps the tasks when they could not be saved");
    assert.ok(!t.calls.some((b) => b.weeklyPlan && b.weeklyPlan.weekEnding === t.thisWeek && Array.isArray(b.weeklyPlan.carryItems) && b.weeklyPlan.carryItems.length === 0 && Object.keys(b.weeklyPlan).length === 2), "no tray-clear was sent");
    assert.strictEqual(t.st.weekEnding, t.thisWeek);
  }
  // the tray-clear fails after the move: pressing again does not add the tasks twice
  {
    const t = await setup(); t.mode.failClear = true;
    await t.ctx.wpCommitFinish(); await t.env.settle();
    assert.deepStrictEqual(titles(t.stored[t.nextWeek].projectItems), ["Already planned", "Carry me"], "what was already planned is kept and the task is added");
    assert.deepStrictEqual(titles(t.stored[t.nextWeek].bufferItems), ["And me"]);
    assert.strictEqual(t.st.plan.carryItems.length, 2, "the tray is still full because the clear failed");
    t.mode.failClear = false;
    await t.ctx.wpCommitFinish(); await t.env.settle();
    assert.deepStrictEqual(titles(t.stored[t.nextWeek].projectItems), ["Already planned", "Carry me"], "a second press adds nothing twice");
    assert.deepStrictEqual(titles(t.stored[t.nextWeek].bufferItems), ["And me"]);
    assert.strictEqual(t.st.weekEnding, t.nextWeek, "and it moves on to next week");
  }
  // the ordinary case still works
  {
    const t = await setup();
    await t.ctx.wpCommitFinish(); await t.env.settle();
    assert.deepStrictEqual(titles(t.stored[t.nextWeek].projectItems), ["Already planned", "Carry me"]);
    assert.strictEqual(t.st.weekEnding, t.nextWeek);
  }
  // quotes: a task name with a quoted word survives a redraw, and a title cannot add an attribute
  {
    const t = await setup();
    assert.strictEqual(t.ctx.wpEsc('Say "hi" & it\'s <b>'), "Say &quot;hi&quot; &amp; it&#39;s &lt;b&gt;");
  }
  console.log("v299-finish-week-safe.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
