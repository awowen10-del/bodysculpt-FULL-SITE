// v299: Monthly's share of the audit's data-loss routes.
//  - a plan that fails to load is an error, not an empty month that the next Add saves over
//  - two quick month changes cannot leave one month's plan under another's name
//  - saves carry the lastUpdated the page loaded, and a refused (stale) save reloads
//  - a failed save answers false, so no "added" message follows it
//  - the figures panel is closed by a month change and refuses to save into another month
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, openPlan } = require("./lib/monthly-env.cjs");
const HTML = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const item = (id, title) => ({ id, title, rockRef: "", notes: "", done: false });
const A = "2026-10", B = "2026-11";

function wire(env, served, mode) {
  const posts = [];
  env.ctx.fetch = async (url, o) => {
    const u = String(url);
    if (o && o.method === "POST") {
      const body = JSON.parse(o.body); posts.push(body);
      if (body.monthlyPlan) {
        if (mode.failWrite) throw new Error("offline");
        if (mode.conflict) { mode.conflict = false; return { ok: false, status: 409, json: async () => ({ ok: false, conflict: true }) }; }
        const ym = body.monthlyPlan.ym;
        served[ym] = Object.assign({}, served[ym], body.monthlyPlan, { lastUpdated: "t" + posts.length });
        return { ok: true, status: 200, json: async () => ({ ok: true, plan: served[ym] }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (u.includes("monthlyplan=")) {
      const ym = decodeURIComponent(u.split("monthlyplan=")[1]);
      if (mode.failRead) return { ok: false, status: 502, json: async () => { throw new Error("x"); } };
      if (mode.delay && mode.delay[ym]) await new Promise((r) => setTimeout(r, mode.delay[ym]));
      return { ok: true, status: 200, json: async () => ({ plan: served[ym] || null, rocks: [], quarterTag: "2026-Q4" }) };
    }
    if (u.includes("projects?list=1")) return { ok: true, status: 200, json: async () => ({ ok: true, projects: [] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return posts;
}

(async () => {
  // a failed load: error on screen, nothing can be saved
  {
    const env = await boot({ plans: {} }); const toasts = []; env.ctx.mpToast = (m) => toasts.push(m);
    const served = { [B]: { ym: B, focus: [item("a", "One"), item("b", "Two"), item("c", "Three")], lastUpdated: "t0" } };
    const mode = { failRead: true }; const posts = wire(env, served, mode);
    await openPlan(env, B);
    assert.ok(/didn't load/.test(env.body.innerHTML), "the page says the month did not load");
    assert.strictEqual(await env.ctx.mpSaveSection("focus"), false);
    assert.strictEqual(posts.filter((b) => b.monthlyPlan).length, 0, "nothing is saved from a month that did not load");
    mode.failRead = false;
    await openPlan(env, B);
    assert.strictEqual(env.ctx.__mpState.plan.focus.length, 3, "Try again loads the real month");
    assert.strictEqual(await env.ctx.mpSaveSection("focus"), true);
    assert.strictEqual(posts.filter((b) => b.monthlyPlan).pop().base, "t0", "a save carries the lastUpdated the page loaded");

    // a refused save loads the newer copy rather than overwriting it
    served[B] = { ym: B, focus: [item("a", "One"), item("z", "Added by Grok")], lastUpdated: "t9" };
    mode.conflict = true;
    assert.strictEqual(await env.ctx.mpSaveSection("focus"), false);
    await env.settle();
    assert.ok(env.ctx.__mpState.plan.focus.some((f) => f.title === "Added by Grok"), "the newer month is on screen");
    assert.strictEqual(served[B].focus.length, 2, "and was not overwritten");

    // a save that cannot reach the store answers false and says so
    toasts.length = 0; mode.failWrite = true;
    assert.strictEqual(await env.ctx.mpSaveSection("focus"), false);
    assert.ok(toasts.some((t) => /not saved/.test(t)), "the failure is said out loud");
  }
  // two quick month changes
  {
    const env = await boot({ plans: {} }); env.ctx.mpToast = () => {};
    const served = { [A]: { ym: A, focus: [item("a", "October item")], lastUpdated: "ta" }, [B]: { ym: B, focus: [item("b", "November item")], lastUpdated: "tb" } };
    const mode = { delay: { [A]: 80 } }; const posts = wire(env, served, mode);
    env.ctx.__mpState.curYm = A; const p1 = env.ctx.renderMonthlyPlan();
    env.ctx.__mpState.curYm = B; const p2 = env.ctx.renderMonthlyPlan();
    await Promise.all([p1, p2]); await env.settle();
    assert.strictEqual(env.ctx.__mpState.plan.ym, B, "the plan in memory is the month on screen");
    assert.strictEqual(env.ctx.__mpState.plan.focus[0].title, "November item");
    await env.ctx.mpSaveSection("focus");
    assert.ok(posts.filter((b) => b.monthlyPlan).every((b) => b.monthlyPlan.ym === B));
    assert.strictEqual(served[A].focus[0].title, "October item", "October is untouched");
  }
  // the figures panel belongs to the month it was opened for
  assert.ok(/function setMonth\(ym\)\{\s*if\(!YMS\.includes\(ym\)\) return;\s*if\(ym !== curYm\)\{ const mp = document\.getElementById\("moneyPanel"\); if\(mp && !mp\.hidden\) closeMoney\(\); \}/.test(HTML), "a month change closes the figures panel");
  assert.ok(/async function saveMoney\(\)\{\s*const msg = document\.getElementById\("moneyMsg"\);\s*if\(moneyYm !== curYm\)\{[^}]*return; \}/.test(HTML), "Save refuses a panel opened for another month");
  assert.ok(/function openMoney\(\)\{\s*moneyYm = curYm;/.test(HTML));
  // the "added" and "taken off" messages only follow a save that worked
  assert.ok(/if\(!\(await mpSaveSection\("focus"\)\)\) return;[^\n]*\n\s*mpToast\(p\.name \+ " added to "/.test(HTML));
  assert.ok(/if\(!\(await mpSaveSection\("focus"\)\)\) return;[^\n]*\n\s*mpToast\(\(p \? p\.name : "Project"\) \+ " taken off "/.test(HTML));
  console.log("v299-monthly-guards.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
