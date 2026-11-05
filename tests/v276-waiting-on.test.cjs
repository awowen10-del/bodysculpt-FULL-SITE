// v276 — Waiting on: the job is not finished and not his to move, so it comes off the list
// without being crossed off, and it cannot be lost when the day ends.
//
// Ash: "if I'm waiting on something I've got the ability to highlight that, so not cross it off
// as though it's done … the staff rota went out, I'm waiting on people to confirm … I need to
// give myself permission to accept I'm waiting on that and move onto the next job."
//
// The store is the REAL kpi-store handler. The weekly page is the REAL page in the sandbox. The
// daily page's waiting code is lifted out of the real script and run against a recording fetch.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { boot } = require("./lib/env.cjs");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const DAILY = read("daily.html");
const DJS = DAILY.slice(DAILY.lastIndexOf("<script>") + 8, DAILY.lastIndexOf("</script>"));
const WEEK = "2026-11-02";

async function store(seed) {
  const m = new Map(Object.entries(seed || {}).map(([k, v]) => [k, JSON.stringify(v)]));
  const writes = [];
  globalThis.__fakeStore = {
    async get(k, o) { const v = m.get(k); if (v === undefined) return null; return o && o.type === "json" ? JSON.parse(v) : v; },
    async set(k, v) { writes.push(k); m.set(k, v); },
    async list() { return { blobs: [], directories: [] }; },
  };
  const tmp = path.join(os.tmpdir(), "kpi-store-v276-" + process.pid + "-" + Date.now() + ".mjs");
  fs.writeFileSync(tmp, read("netlify/functions/kpi-store.js").replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => globalThis.__fakeStore;"));
  const h = (await import("file://" + tmp)).default;
  fs.unlinkSync(tmp);
  const post = async (body) => {
    const r = await h(new Request("https://x/.netlify/functions/kpi-store", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    return { status: r.status, json: r.status === 200 ? await r.json() : null };
  };
  const list = async () => (await (await h(new Request("https://x/.netlify/functions/kpi-store?waiting=1"))).json()).items;
  return { post, list, writes, get: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null) };
}

// the daily page's own code: from the top of the waiting block to the next section
function daily({ items, queue, projects, agenda, today }) {
  const a = DJS.indexOf("let wtItems = [];"), b = DJS.indexOf('/* ---------- v251: "cancel"');
  assert.ok(a > 0 && b > a, "the waiting block is where the test expects it");
  const tl = DJS.slice(DJS.indexOf("\nfunction tlJobs()"), DJS.indexOf("\nconst tlFind = "));
  const sent = [];
  const src = [
    "let fmProjects = P, calWeekOffset = 0, wtQueue = Q, oneThing = '';",
    "const API = '/store', TL_UNDO_MS = 1; const esc = (s) => String(s); const ymd = (d) => T;",
    "const agendaWeekOf = () => '" + WEEK + "'; const ckToday = () => T; const agendaToday = () => A;",
    "const tlDayName = (s) => s, tlDayShort = (s) => s; let tlCancel = null;",
    "const ckEntry = () => ({ parked: [], oneThing: '' }); const richToText = (s) => s;",
    "const fmBuildQueue = () => wtQueue; function renderTodayList(){} function fmAfterChange(){}",
    "const agendaSetDone = (row, v) => { row.done = v; };",
    "async function fmTickStep(j, d) { await fetch(API, { method: 'POST', body: JSON.stringify({ stepLink: { projectId: j.projectId, stepId: j.stepId, done: d } }) }); }",
    "async function tickTask(t, d, w) { const r = await fetch(API, { method: 'POST', body: JSON.stringify({ weeklyTick: { weekEnding: w, tgt: t, done: d } }) }); if (!r.ok) throw new Error('HTTP ' + r.status); }",
    "async function ckSetDone() {}",
    DJS.slice(a, b), tl,
    "wtItems = I; return { tlJobs, wtFor, wtOpen, wtGotIt, wtFinish, wtPrune, wtSays, wtFinishByKey: (k) => wtFinish(wtItems.find((x) => x.key === k)),",
    "  list: () => wtItems, sectionHtml: () => wtSectionHtml(wtOpen()), panel: (j) => { wtDraft = wtDraftFor(wtNewRec(j), j.key); return wtPanelHtml(); }, save: () => wtSaveDraft(), setOn: (v) => { wtDraft.on = v; } };",
  ].join("\n");
  const fetch = async (url, o) => {
    sent.push(JSON.parse(o.body));
    const st = (fetch.onlyTick && !sent[sent.length - 1].weeklyTick ? 0 : fetch.status) || 200;
    return { ok: st < 400, status: st, json: async () => ({ ok: true }) };
  };
  const api = new Function("P", "Q", "A", "T", "I", "fetch", "setTimeout", src)(projects || [], queue || [], agenda || null, today, items || [], fetch, () => 0);
  return { api, sent, fetch };
}

(async () => {
  /* ---------- the store ---------- */
  {
    const s = await store({ "weekly-plan-x": { keep: 1 } });
    const rec = { key: "plan:recurringDone:rota", week: WEEK, title: "Staff rota", on: "Staff to confirm", since: "2026-11-05",
      check: "2026-11-06", ready: "", tgt: { m: "recurringDone", k: "rota" }, junk: "<b>" };
    assert.strictEqual((await s.post({ waiting: { set: rec } })).status, 200);
    let l = await s.list();
    assert.strictEqual(l.length, 1, "it is on the list");
    assert.ok(!("junk" in l[0]), "only the named fields are kept");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(l[0].tgt)), { m: "recurringDone", k: "rota" }, "and it remembers where its tick lives");
    assert.deepStrictEqual(s.writes, ["waiting-list"], "marking a job writes the waiting list and NOTHING else: no plan, no agenda");

    await s.post({ waiting: { set: { ...rec, on: "Two more staff" } } });
    assert.strictEqual((await s.list()).length, 1, "marking the same job again updates it, it does not double up");

    await s.post({ waiting: { set: { ...rec, week: "2026-11-09" } } });
    assert.strictEqual((await s.list()).length, 2, "a recurring job is a separate job next week");

    await s.post({ waiting: { clear: { key: rec.key, week: WEEK } } });
    l = await s.list();
    assert.strictEqual(l.length, 1, "clearing takes one record");
    assert.strictEqual(l[0].week, "2026-11-09", "and it takes the right week's");

    for (const bad of [{ set: { key: "weekly-plan-x", title: "x" } }, { set: { key: "step:a:b", title: "" } }, { clear: { key: "../x" } }, {}]) {
      assert.strictEqual((await s.post({ waiting: bad })).status, 400, "refused: " + JSON.stringify(bad));
    }
    assert.deepStrictEqual(s.get("weekly-plan-x"), { keep: 1 }, "the plan is exactly as it was");
  }

  /* ---------- the daily list ---------- */
  const today = "2026-11-05", job = (key, title, extra) => ({ key, title, source: "plan", tgt: { m: "recurringDone", k: key.split(":")[2] }, done: false, ...extra });
  {
    const rota = job("plan:recurringDone:rota", "Staff rota");
    const emails = job("plan:recurringDone:mail", "Emails");
    const held = { key: rota.key, week: WEEK, title: "Staff rota", on: "Staff to confirm", since: today, check: "2026-11-06", ready: "", tgt: rota.tgt };
    const d = daily({ items: [held], queue: [rota, emails], today });
    const { live, waiting } = d.api.tlJobs();
    assert.deepStrictEqual(live.map((j) => j.title), ["Emails"], "the held job leaves the list, so the count of jobs left really drops");
    assert.deepStrictEqual(waiting.map((r) => r.title), ["Staff rota"], "and shows under Waiting on");
    assert.ok(!live.some((j) => j.done), "it has not been counted as done");

    // next week the same recurring key is a fresh job
    const nextWeek = daily({ items: [{ ...held, week: "2026-10-26" }], queue: [rota], today });
    assert.strictEqual(nextWeek.api.tlJobs().live.length, 1, "last week's hold does not swallow this week's recurring job");
    assert.strictEqual(nextWeek.api.tlJobs().waiting.length, 1, "and last week's is still shown, because it was never cleared");

    // THE POINT: tomorrow, when Tuesday's job is on nobody's list
    const tomorrow = daily({ items: [held], queue: [emails], today: "2026-11-06" });
    assert.strictEqual(tomorrow.api.tlJobs().waiting.length, 1, "a job not on today's list is still under Waiting on");
    assert.ok(/check back today/.test(tomorrow.api.wtSays(held)), "and on the day, it says to check back");
    assert.ok(/ due/.test(tomorrow.api.sectionHtml()), "and the row is picked out");
  }
  {
    // putting one on waiting, with no words typed: it must still work in one press
    const rota = job("plan:recurringDone:rota", "Staff rota");
    const d = daily({ items: [], queue: [rota], today });
    const html = d.api.panel(rota);
    assert.ok(/Put it on waiting/.test(html) && /Tomorrow/.test(html) && /Next week/.test(html), "the question offers days to check back");
    await d.api.save();
    assert.strictEqual(d.sent.length, 1);
    assert.deepStrictEqual(Object.keys(d.sent[0]), ["waiting"], "it posts to the waiting list only");
    assert.ok(d.sent[0].waiting.set.check > "", "with a check-back day even when none was chosen");
  }
  {
    // a failed save must not pretend
    const rota = job("plan:recurringDone:rota", "Staff rota");
    const d = daily({ items: [], queue: [rota], today });
    d.fetch.status = 500;
    d.api.panel(rota);
    await d.api.save();
    assert.strictEqual(d.api.list().length, 0, "a save that failed takes it back off the waiting list");
  }
  {
    // "got it" on a job from another day gives it a row, because it has no slot today
    const held = { key: "plan:projectItems:p1", week: WEEK, title: "Tuesday's job", on: "", since: "2026-11-03", check: "", ready: "", tgt: { l: "projectItems", k: "p1" } };
    const d = daily({ items: [held], queue: [], today });
    await d.api.wtGotIt(d.api.list()[0]);
    const { live, waiting } = d.api.tlJobs();
    assert.strictEqual(waiting.length, 0, "it leaves Waiting on");
    assert.deepStrictEqual(live.map((j) => j.title), ["Tuesday's job"], "and it is on today's list");
    assert.strictEqual(live[0].source, "back", "as a job in its own right");
    assert.strictEqual(d.api.list().length, 1, "the record stays until the job is finished, or it would vanish");
  }
  {
    // "got it" on a job that is on today's list anyway needs no record
    const rota = job("plan:recurringDone:rota", "Staff rota");
    const held = { key: rota.key, week: WEEK, title: "Staff rota", since: today, tgt: rota.tgt };
    const d = daily({ items: [held], queue: [rota], today });
    await d.api.wtGotIt(d.api.list()[0]);
    assert.strictEqual(d.api.list().length, 0, "the record goes");
    assert.deepStrictEqual(d.api.tlJobs().live.map((j) => j.title), ["Staff rota"], "and the job is just a job again, once");
  }
  {
    // the tick finishes the job at its owner, in the right week, and then the record
    const held = { key: "plan:recurringDone:rota", week: "2026-10-26", title: "Staff rota", since: "2026-10-30", tgt: { m: "recurringDone", k: "rota" } };
    const d = daily({ items: [held], queue: [], today });
    await d.api.wtFinishByKey(held.key);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(d.sent[0])), { weeklyTick: { weekEnding: "2026-10-26", tgt: held.tgt, done: true } },
      "the tick goes to the week the job belongs to, not this week");
    assert.ok(d.sent[1].waiting.clear, "then it comes off the list");
    assert.strictEqual(d.api.list().length, 0);
  }
  {
    // a job since deleted must not leave a row that can never be cleared
    const held = { key: "plan:projectItems:gone", week: WEEK, title: "Gone", since: today, tgt: { l: "projectItems", k: "gone" } };
    const d = daily({ items: [held], queue: [], today });
    d.fetch.status = 404; d.fetch.onlyTick = true;
    await d.api.wtFinishByKey(held.key);
    assert.strictEqual(d.api.list().length, 0, "a 404 means there is nothing left to wait for");
  }
  {
    // ticked on the board, the waiting row goes by itself. A step it cannot find stays.
    const P = [{ id: "p1", name: "Shred", steps: [{ id: "s1", title: "Done elsewhere", done: true }, { id: "s2", title: "Open", done: false }] }];
    const rec = (s) => ({ key: "step:p1:" + s, week: "", title: s, since: today, tgt: { p: "p1", s } });
    const d = daily({ items: [rec("s1"), rec("s2"), rec("s9")], queue: [], projects: P, today });
    d.api.wtPrune();
    assert.deepStrictEqual(d.api.list().map((r) => r.tgt.s), ["s2", "s9"], "only a job it can SEE is finished is cleared");
  }

  /* ---------- the weekly page ---------- */
  {
    const fix = { id: "b1", title: "Staff rota", done: false };
    const r = await boot({ plans: { [WEEK]: { weekEnding: WEEK, bufferItems: [fix], projectItems: [], placements: { "6-9:thu": ["buffer:b1"] } } } });
    const ctx = r.ctx;
    ctx.wpWeekEnding = WEEK;
    const src = read("index.html");
    assert.ok(/wpWaitBtnHtml\(ref,dk,held\)/.test(src), "a grid chip has the hourglass");
    assert.ok(/wpWaitBtnHtml\(ref,"",held\)/.test(src), "and so does a row in the task lists");
    assert.ok(/wpWaitBoxHtml\(\) \+ wpOverdueHtml\(\)/.test(src), "the Waiting box is at the top of the week");
    assert.ok(/if\(checked\)\{ const held = wpWaitRecOf\(ref, day\); if\(held\) wpWaitClear\(held\); \}/.test(src), "ticking a job on the grid clears its hold");
    assert.strictEqual(typeof ctx.wpWaitTargetOf, "function");
    const t = ctx.wpDoneTarget("buffer", fix);
    assert.strictEqual(ctx.wpWaitKeyOf(t), "plan:bufferItems:b1", "the weekly page builds the same key the daily page builds");
    assert.strictEqual(ctx.wpWaitKeyOf({ p: "p1", s: "s1" }), "step:p1:s1", "a step's too");
  }
  // the two pages must build one address, or a mark on one is invisible on the other
  assert.ok(/key: t\.tgt\.p \? "step:" \+ t\.tgt\.p \+ ":" \+ t\.tgt\.s : "plan:" \+ \(t\.tgt\.l \|\| t\.tgt\.m \|\| ""\) \+ ":" \+ t\.tgt\.k/.test(DJS),
    "the daily queue's key is the shape the weekly page builds");

  /* ---------- the board ---------- */
  const pj = read("projects.html");
  assert.ok(/S\.waiting\[s\.id\]/.test(pj), "a held step says so on its card");
  assert.ok(!/waiting:\s*\{\s*(set|clear)/.test(pj) && !/JSON\.stringify\(\{ waiting/.test(pj), "the board only reads the list");

  console.log("v276-waiting-on.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
