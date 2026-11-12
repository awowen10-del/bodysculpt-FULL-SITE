// v299: two of the audit's data-loss routes, shut on the Weekly page and in the store.
//  (a) a tab left open used to save its old copy of a week over newer work. A page now sends
//      the lastUpdated it loaded as `base`, and the store refuses a save based on an older one.
//  (b) a week that FAILED to load used to be drawn as an empty week, and the next save stored
//      that emptiness. A failed load now shows an error and nothing can be saved.
//  (c) two quick week changes could leave one week's plan under another's name.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { boot } = require("./lib/env.cjs");
const SRC = path.join(__dirname, "..", "netlify", "functions", "kpi-store.js");

function fakeStore(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    _m: m,
    async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list(o) { const p = (o && o.prefix) || ""; return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })) }; },
  };
}
async function loadHandler() {
  const patched = fs.readFileSync(SRC, "utf8").replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = (o) => globalThis.__stores[o.name];");
  const tmp = path.join(os.tmpdir(), "kpi-store-v299-" + process.pid + ".mjs");
  fs.writeFileSync(tmp, patched);
  const mod = await import("file://" + tmp);
  fs.unlinkSync(tmp);
  return mod.default;
}
const POST = (h, body) => h(new Request("https://x/.netlify/functions/kpi-store", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const WEEK = "2026-11-09";

(async () => {
  // ---------- the store ----------
  const handler = await loadHandler();
  const kpi = fakeStore({}), bak = fakeStore({});
  globalThis.__stores = { "bodysculpt-kpi": kpi, "bodysculpt-backup": bak };

  // first save of a week nobody has stored: base "" is right
  let r = await POST(handler, { weeklyPlan: { weekEnding: WEEK, notes: "one" }, base: "" });
  assert.strictEqual(r.status, 200);
  const v1 = (await r.json()).plan.lastUpdated;
  await new Promise((res) => setTimeout(res, 5));
  // another writer changes the week (the Daily page, Grok): no base, as before
  r = await POST(handler, { weeklyPlan: { weekEnding: WEEK, foodNotes: "from elsewhere" } });
  assert.strictEqual(r.status, 200, "a caller that sends no base behaves exactly as before");
  const v2 = (await r.json()).plan.lastUpdated;
  assert.notStrictEqual(v1, v2);
  // the stale tab saves with the base it loaded: refused, and nothing is changed
  const before = kpi._m.get("weekly-plan-" + WEEK);
  r = await POST(handler, { weeklyPlan: { weekEnding: WEEK, notes: "old copy", foodNotes: "" }, base: v1 });
  assert.strictEqual(r.status, 409, "a save based on an older copy is refused");
  const j = await r.json();
  assert.strictEqual(j.conflict, true); assert.strictEqual(j.lastUpdated, v2);
  assert.strictEqual(kpi._m.get("weekly-plan-" + WEEK), before, "and the stored week is untouched");
  // with the current base it goes through
  r = await POST(handler, { weeklyPlan: { weekEnding: WEEK, notes: "two" }, base: v2 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(JSON.parse(kpi._m.get("weekly-plan-" + WEEK)).foodNotes, "from elsewhere", "the other writer's change survives");
  // "I believe nothing is stored" against a week that now exists is stale too
  r = await POST(handler, { weeklyPlan: { weekEnding: WEEK, notes: "" }, base: "" });
  assert.strictEqual(r.status, 409, "a blank page cannot overwrite a stored week");

  // the same guard on the monthly plan and the quarterly review, and the copy-before on the review
  r = await POST(handler, { monthlyPlan: { ym: "2026-11", notes: "a" }, base: "" });
  const m1 = (await r.json()).plan.lastUpdated;
  r = await POST(handler, { monthlyPlan: { ym: "2026-11", focus: [] }, base: "nonsense" });
  assert.strictEqual(r.status, 409);
  r = await POST(handler, { monthlyPlan: { ym: "2026-11", notes: "b" }, base: m1 });
  assert.strictEqual(r.status, 200);

  r = await POST(handler, { planning: { year: 2026, quarter: "Q3", reviewNotes: { wins: "first" } }, base: "" });
  assert.strictEqual(r.status, 200);
  const q1 = (await r.json()).planning.lastUpdated;
  await new Promise((res) => setTimeout(res, 5));
  r = await POST(handler, { planning: { year: 2026, quarter: "Q3", reviewNotes: { wins: "second" } }, base: q1 });
  assert.strictEqual(r.status, 200);
  r = await POST(handler, { planning: { year: 2026, quarter: "Q3", reviewNotes: {} }, base: q1 });
  assert.strictEqual(r.status, 409, "the quarterly review refuses a stale save");
  const prev = [...bak._m.keys()].filter((k) => k.startsWith("prev/bodysculpt-kpi/planning-2026-Q3/"));
  assert.strictEqual(prev.length, 1, "the copy before the overwrite is kept, in the backup store");
  assert.strictEqual(JSON.parse(bak._m.get(prev[0])).reviewNotes.wins, "first");
  assert.ok(![...kpi._m.keys()].some((k) => k.startsWith("prev/")), "never in the working store");

  // a finance month with no rows list is refused rather than stored as an empty month
  kpi._m.set("finance-txns-2026-10", JSON.stringify({ ym: "2026-10", rows: [{ id: "a", date: "2026-10-01", desc: "x", amt: 1 }], lastUpdated: "t0" }));
  r = await POST(handler, { finTxns: { ym: "2026-10" } });
  assert.strictEqual(r.status, 400);
  r = await POST(handler, { finTxns: { ym: "2026-10", rows: [] }, base: "older" });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(JSON.parse(kpi._m.get("finance-txns-2026-10")).rows.length, 1, "the month is untouched");

  // ---------- the Weekly page ----------
  const mkFetch = (ctx, served, mode, posts) => async (url, o) => {
    const u = String(url);
    if (o && o.method === "POST") {
      const body = JSON.parse(o.body); posts.push(body);
      if (body.weeklyPlan) {
        if (mode.conflict) { mode.conflict = false; return { ok: false, status: 409, json: async () => ({ ok: false, conflict: true }) }; }
        const wk = body.weeklyPlan.weekEnding;
        served[wk] = Object.assign({}, served[wk], body.weeklyPlan, { lastUpdated: "t" + posts.length });
        return { ok: true, status: 200, json: async () => ({ ok: true, plan: served[wk] }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (u.includes("weeklyplan=")) {
      const wk = decodeURIComponent(u.split("weeklyplan=")[1]);
      if (mode.failRead) return { ok: false, status: 502, json: async () => { throw new Error("not json"); } };
      if (mode.delay && mode.delay[wk]) await new Promise((res) => setTimeout(res, mode.delay[wk]));
      return { ok: true, status: 200, json: async () => ({ plan: served[wk] || null }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const item = (id, title) => ({ id, title, done: false });

  // (b) a failed load: an error on screen, and no save can leave the page
  {
    const env = await boot({}); const ctx = env.ctx; const st = ctx.__wpState;
    const wk = st.weekEnding, posts = [], mode = { failRead: true };
    const served = { [wk]: { weekEnding: wk, bufferItems: [item("b1", "Real job")], lastUpdated: "t0" } };
    ctx.fetch = mkFetch(ctx, served, mode, posts);
    await ctx.loadWeeklyPlan(wk); await env.settle();
    assert.ok(/didn't load/.test(ctx.document.getElementById("wpBody").innerHTML), "the page says the week did not load");
    await ctx.wpSaveSection("buffer"); await ctx.wpSaveSection("timeBlocks"); await env.settle();
    assert.strictEqual(posts.filter((b) => b.weeklyPlan).length, 0, "nothing is saved from a week that did not load");
    assert.strictEqual(served[wk].bufferItems.length, 1);
    mode.failRead = false;
    await ctx.loadWeeklyPlan(wk); await env.settle();
    assert.strictEqual(st.plan.bufferItems[0].title, "Real job", "Try again loads the real week");
    await ctx.wpSaveSection("buffer"); await env.settle();
    const sent = posts.filter((b) => b.weeklyPlan).pop();
    assert.strictEqual(sent.base, "t0", "a save carries the lastUpdated the page loaded");
  }
  // (c) two quick week changes: the slower, older answer is dropped
  {
    const env = await boot({}); const ctx = env.ctx; const st = ctx.__wpState;
    const A = st.weekEnding, B = ctx.wpNextWeekEnding(A), C = ctx.wpNextWeekEnding(B), posts = [];
    const served = { [B]: { weekEnding: B, bufferItems: [item("b", "Week B job")], lastUpdated: "tb" }, [C]: { weekEnding: C, bufferItems: [item("c", "Week C job")], lastUpdated: "tc" } };
    const mode = { delay: { [B]: 80 } };
    ctx.fetch = mkFetch(ctx, served, mode, posts);
    const p1 = ctx.loadWeeklyPlan(B); const p2 = ctx.loadWeeklyPlan(C);
    await Promise.all([p1, p2]); await env.settle();
    assert.strictEqual(st.weekEnding, C);
    assert.strictEqual(st.plan.weekEnding, C, "the plan on screen is the week named on screen");
    assert.strictEqual(st.plan.bufferItems[0].title, "Week C job");
    await ctx.wpSaveSection("buffer"); await env.settle();
    assert.ok(posts.filter((b) => b.weeklyPlan).every((b) => b.weeklyPlan.weekEnding === C), "and a save goes to that week only");
    assert.strictEqual(served[B].bufferItems[0].title, "Week B job");
  }
  // (a) the store says "changed elsewhere": the page loads the newer copy instead of overwriting it
  {
    const env = await boot({}); const ctx = env.ctx; const st = ctx.__wpState;
    const wk = st.weekEnding, posts = [], mode = {};
    const served = { [wk]: { weekEnding: wk, bufferItems: [item("b1", "Old")], lastUpdated: "t0" } };
    ctx.fetch = mkFetch(ctx, served, mode, posts);
    await ctx.loadWeeklyPlan(wk); await env.settle();
    served[wk] = { weekEnding: wk, bufferItems: [item("b1", "Old"), item("b2", "Added on Daily")], lastUpdated: "t9" };
    mode.conflict = true;
    await ctx.wpSaveSection("buffer"); await env.settle();
    assert.strictEqual(st.plan.bufferItems.length, 2, "the newer week is loaded");
    assert.strictEqual(st.plan.lastUpdated, "t9");
    assert.strictEqual(served[wk].bufferItems.length, 2, "and was not overwritten");
  }
  // two saves fired together go out one after the other, the second carrying the first's stamp
  {
    const env = await boot({}); const ctx = env.ctx; const st = ctx.__wpState;
    const wk = st.weekEnding, posts = [], mode = {};
    const served = { [wk]: { weekEnding: wk, lastUpdated: "t0" } };
    ctx.fetch = mkFetch(ctx, served, mode, posts);
    await ctx.loadWeeklyPlan(wk); await env.settle();
    posts.length = 0;
    const a = ctx.wpSaveSection("notes"), b = ctx.wpSaveSection("review");
    await Promise.all([a, b]); await env.settle();
    const ws = posts.filter((x) => x.weeklyPlan);
    assert.strictEqual(ws.length, 2);
    assert.strictEqual(ws[0].base, "t0");
    assert.strictEqual(ws[1].base, served[wk].lastUpdated === ws[1].base ? ws[1].base : "t1", "the second save waits for the first and carries its stamp");
    assert.notStrictEqual(ws[1].base, "t0");
  }
  console.log("v299-stale-saves-and-failed-loads.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
