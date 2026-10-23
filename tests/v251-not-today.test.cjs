// v251 — "cancel" on the Daily Dashboard's Today list.
//
// Ash: "I need the option of being able to cancel the jobs here — but it should come with a
// final prompt, like are you sure? and that should remove it from the weekly calendar too but
// NOT the recurring task list. This should just be if I don't manage to get it done that day.
// Also should be prompted if I need to move it to another day, or just forget about it today."
// …and: "if I skip it, a little note — just a prompt to myself … It doesn't need to land
// anywhere."
//
// The store route is run for real, and what it writes is then fed to the REAL weekly page, so
// "off the calendar, still on the recurring list" is checked where the calendar is drawn.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { boot } = require("./lib/env.cjs");

const WEEK = "2026-03-16";
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

async function storeHandler(seed) {
  const m = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  globalThis.__fakeStore = {
    async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, v); },
    async list(o) { const p = (o && o.prefix) || ""; return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })), directories: [] }; },
  };
  const src = read("netlify/functions/kpi-store.js");
  const tmp = path.join(os.tmpdir(), "kpi-store-v251-" + process.pid + "-" + Date.now() + Math.random() + ".mjs");
  fs.writeFileSync(tmp, src.replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => globalThis.__fakeStore;"));
  const h = (await import("file://" + tmp)).default;
  fs.unlinkSync(tmp);
  const post = async (body) => {
    const r = await h(new Request("https://x/.netlify/functions/kpi-store", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    return { status: r.status, json: r.status === 200 ? await r.json() : null };
  };
  const get = (k) => (m.has(k) ? JSON.parse(m.get(k)) : null);
  return { post, get };
}

const LG = { m: "recurringDone", k: "lg:wed" };          // Lead Generation, daily — ticks keyed by day
const agendaSeed = () => ({
  weekEnding: WEEK,
  cells: {
    "10-12:wed": [{ title: "Lead Generation", kind: "recurring", done: false, tgt: LG }],
    "1-3:wed": [{ title: "Ring the accountant", kind: "buffer", done: false, tgt: { l: "bufferItems", k: "b1" } }],
    "any:wed": [{ title: "Point the forms at GHL", kind: "project", done: false, tgt: { p: "p1", s: "s1" } }],
  },
});
const planSeed = (extra) => Object.assign({ weekEnding: WEEK,
  placements: { "1-3:wed": ["buffer:b1"] },
  bufferItems: [{ id: "b1", title: "Ring the accountant" }] }, extra || {});
const defaults = [{ id: "lg", title: "Lead Generation", days: DAYS.slice(), time: "10-12" }];

async function onWeeklyPage(plan) {
  const { ctx } = await boot({ defaults, plans: { [WEEK]: plan } });
  await ctx.loadWeeklyPlan(WEEK);
  return ctx;
}
const showing = (ctx, ref) => {
  const E = ctx.wpEffectivePlacements();
  return Object.keys(E).filter((k) => (E[k] || []).includes(ref)).sort();
};

(async () => {
  /* 1. Forget it today — a recurring job: off Wednesday's calendar, the recurring list untouched */
  {
    const s = await storeHandler({ ["weekly-plan-" + WEEK]: planSeed(), ["weekly-agenda-" + WEEK]: agendaSeed() });
    const r = await s.post({ weeklyCancel: { weekEnding: WEEK, tgt: LG, cell: "10-12:wed" } });
    assert.strictEqual(r.status, 200, "the store takes it");
    const plan = s.get("weekly-plan-" + WEEK);
    assert.deepStrictEqual(plan.exceptions["recurring:lg"], [{ type: "skip", from: "10-12:wed" }],
      "it is written as the planner's own one-day skip");
    assert.ok(!r.json.agenda.cells["10-12:wed"], "today's row is gone from the daily view's copy");

    const ctx = await onWeeklyPage(plan);
    const days = showing(ctx, "recurring:lg").map((k) => k.split(":")[1]);
    assert.deepStrictEqual(days.sort(), ["fri", "mon", "sat", "sun", "thu", "tue"].sort(),
      "the weekly calendar drops Wednesday only");
    assert.strictEqual(ctx.__wpState.defaults ? ctx.__wpState.defaults.length : defaults.length, 1, "…and the recurring task itself is still there");
    assert.deepStrictEqual(defaults[0].days, DAYS, "…with its schedule unchanged");
  }

  /* 2. Move it to Friday — same time, this week only, and its tick key follows the day */
  {
    const s = await storeHandler({ ["weekly-plan-" + WEEK]: planSeed(), ["weekly-agenda-" + WEEK]: agendaSeed() });
    const r = await s.post({ weeklyCancel: { weekEnding: WEEK, tgt: LG, cell: "10-12:wed", to: "10-12:fri" } });
    const plan = s.get("weekly-plan-" + WEEK);
    assert.deepStrictEqual(plan.exceptions["recurring:lg"], [{ type: "move", from: "10-12:wed", to: "10-12:fri" }]);
    const fri = r.json.agenda.cells["10-12:fri"];
    assert.ok(fri && fri.length === 1 && fri[0].tgt.k === "lg:fri", "the row lands on Friday, ticking Friday's box");
    const ctx = await onWeeklyPage(plan);
    assert.ok(!showing(ctx, "recurring:lg").includes("10-12:wed"), "the weekly calendar no longer has it on Wednesday");
    assert.ok(showing(ctx, "recurring:lg").includes("10-12:fri"), "…and has it on Friday (Friday's own one is there too)");

    // moved to Friday, then not done Friday either: the entry is traced back to Wednesday — one entry, not two
    const r2 = await s.post({ weeklyCancel: { weekEnding: WEEK, tgt: { m: "recurringDone", k: "lg:fri" }, cell: "10-12:fri" } });
    assert.strictEqual(r2.status, 200);
    assert.deepStrictEqual(s.get("weekly-plan-" + WEEK).exceptions["recurring:lg"], [{ type: "skip", from: "10-12:wed" }],
      "skipping a moved occurrence skips IT, and leaves Friday's own occurrence alone");
  }

  /* 3. A one-off planner task: its slot today comes out; the task stays in the week's list */
  {
    const s = await storeHandler({ ["weekly-plan-" + WEEK]: planSeed(), ["weekly-agenda-" + WEEK]: agendaSeed() });
    await s.post({ weeklyCancel: { weekEnding: WEEK, tgt: { l: "bufferItems", k: "b1" }, cell: "1-3:wed" } });
    const plan = s.get("weekly-plan-" + WEEK);
    assert.ok(!plan.placements["1-3:wed"], "off Wednesday's slot");
    assert.strictEqual(plan.bufferItems.length, 1, "…still in the week's list");
    // and a second try at a slot it is no longer in is refused, not invented
    const again = await s.post({ weeklyCancel: { weekEnding: WEEK, tgt: { l: "bufferItems", k: "b1" }, cell: "1-3:wed" } });
    assert.strictEqual(again.status, 404, "a job that is not there any more is said so");
  }

  /* 4. A project step: the plan is not touched at all — only the display copy moves */
  {
    const s = await storeHandler({ ["weekly-plan-" + WEEK]: planSeed(), ["weekly-agenda-" + WEEK]: agendaSeed() });
    const before = JSON.stringify(s.get("weekly-plan-" + WEEK));
    const r = await s.post({ weeklyCancel: { weekEnding: WEEK, tgt: { p: "p1", s: "s1" }, cell: "any:wed", to: "any:thu" } });
    assert.strictEqual(JSON.stringify(s.get("weekly-plan-" + WEEK)), before, "a step's cancel never writes the plan");
    assert.ok(r.json.agenda.cells["any:thu"] && !r.json.agenda.cells["any:wed"], "…the display copy follows the step");
  }

  /* 5. Refusals: nowhere to go, the same place, a made-up target */
  {
    const s = await storeHandler({ ["weekly-plan-" + WEEK]: planSeed(), ["weekly-agenda-" + WEEK]: agendaSeed() });
    for (const bad of [
      { weekEnding: WEEK, tgt: LG, cell: "10-12:wed", to: "10-12:wed" },
      { weekEnding: WEEK, tgt: LG, cell: "10-12:wed", to: "nowhere" },
      { weekEnding: WEEK, tgt: { m: "weeklyPlan", k: "x" }, cell: "10-12:wed" },
      { weekEnding: WEEK, tgt: LG, cell: "../wed" },
    ]) assert.strictEqual((await s.post({ weeklyCancel: bad })).status, 400, "refused: " + JSON.stringify(bad));
  }

  /* 6. The page: three steps, inline, an "Are you sure?", and a note that is never sent */
  {
    const DAILY = read("daily.html");
    const html = DAILY.slice(DAILY.indexOf("function tlCancelHtml"), DAILY.indexOf("async function tlCancelGo"));
    assert.ok(/Not getting to this today\?/.test(html) && /Move to another day/.test(html) && /Forget it today/.test(html) && /Keep it/.test(html),
      "cancel first asks: move it, forget it today, or keep it");
    assert.ok(/Are you sure\?/.test(html) && /Yes, move it/.test(html) && /Yes, not today/.test(html) && /No, keep it/.test(html),
      "…and nothing changes until a final Are you sure?");
    assert.ok(/data-tl-note/.test(html) && /c\.to \? "" :/.test(html), "a skip offers a note to yourself");
    assert.ok(!/\bconfirm\(/.test(DAILY.slice(DAILY.indexOf("/* ---------- v251: \"cancel\""), DAILY.indexOf("/* On screen first, then told to the board"))
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")), "no browser confirm(), which would freeze the page");
    const go = DAILY.slice(DAILY.indexOf("async function tlCancelGo"), DAILY.indexOf("/* On screen first, then told to the board"));
    assert.ok(!/note/.test(go.replace(/note: \(tlCancel && tlCancel\.note\) \|\| ""/, "")),
      "the note is never part of any write — it only survives a failed save's redraw");
    assert.ok(/"Recurring list is not touched|recurring list is not touched/i.test(DAILY), "the prompt says the recurring list is left alone");
  }

  console.log("v251-not-today: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
