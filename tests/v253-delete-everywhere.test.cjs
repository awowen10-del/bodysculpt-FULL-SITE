// v253 — delete a job from Today: just today, or everywhere — with the way back.
//
// Ash: "I need to be able to delete tasks and have the option of deleting it from
// everywhere, too."
//
// The Daily page's own delete and Undo code is RUN (recording fetch), its requests go to the
// REAL kpi-store route and the REAL projects function, and the result is laid on the REAL
// weekly page — so "gone from the planner" and "back after Undo" are checked where the
// planner draws them.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { boot } = require("./lib/env.cjs");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const DAILY = read("daily.html");
const DJS = DAILY.slice(DAILY.lastIndexOf("<script>") + 8, DAILY.lastIndexOf("</script>"));
function bodyOf(js, name) {
  const re = new RegExp("\\n(?:async )?function " + name + "\\s*\\(", "g");
  const m = re.exec(js);
  assert.ok(m, "the page defines " + name + "()");
  let i = js.indexOf("{", m.index + m[0].length - 1), depth = 0, j = i;
  for (; j < js.length; j++) {
    if (js[j] === "{") depth++;
    else if (js[j] === "}") { depth--; if (!depth) break; }
  }
  return js.slice(i, j + 1);
}
const line = (re) => { const m = DJS.match(re); assert.ok(m, "the page has " + re); return m[0]; };

const pad = (n) => String(n).padStart(2, "0");
const localYmd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const TODAY = localYmd(new Date());
const addDays = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOfYmd = (ymd) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const DAYK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const THIS = mondayOfYmd(TODAY);
const NEXT = addDays(THIS, 7);
const LAST = addDays(THIS, -7);
const TK = DAYK[(new Date(TODAY + "T00:00:00Z").getUTCDay() + 6) % 7];

/* ---------- one shared blob store behind both functions ---------- */
const m = new Map();
globalThis.__fakeStore = {
  async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
  async set(k, v) { m.set(k, v); },
  async delete(k) { m.delete(k); },
  async list(o) { const p = (o && o.prefix) || ""; return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })), directories: [] }; },
};
const put = (k, v) => m.set(k, JSON.stringify(v));
const get = (k) => (m.has(k) ? JSON.parse(m.get(k)) : null);
async function handlers() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bodysculpt-v253-"));
  fs.mkdirSync(path.join(dir, "lib")); fs.mkdirSync(path.join(dir, "functions"));
  const fake = (src) => src.replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => globalThis.__fakeStore;");
  fs.writeFileSync(path.join(dir, "lib", "projects.js"), fake(read("netlify/lib/projects.js")));
  fs.writeFileSync(path.join(dir, "functions", "projects.js"), read("netlify/functions/projects.js"));
  fs.writeFileSync(path.join(dir, "functions", "kpi-store.mjs"), fake(read("netlify/functions/kpi-store.js")));
  const proj = (await import("file://" + path.join(dir, "functions", "projects.js"))).default;
  const kpi = (await import("file://" + path.join(dir, "functions", "kpi-store.mjs"))).default;
  return async (url, body) => {
    const h = /projects/.test(url) ? proj : kpi;
    const r = await h(new Request("https://x" + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    return { status: r.status, json: r.status === 200 ? await r.json() : null };
  };
}

/* ---------- the Daily page's delete + Undo, in a sandbox ---------- */
function daily(call) {
  const sent = [];
  const fetch = async (url, o) => {
    const body = JSON.parse(o.body);
    sent.push({ url, body });
    const r = await call(url, body);
    return { ok: r.status === 200, status: r.status, json: async () => r.json };
  };
  const src = [
    "let tlCancel = null, tlOpen = {}, wpAgenda = null, wpAgendaToday = null, calWeekOffset = 0, ftTimer = null;",
    line(/\nconst API = [^\n]*/), line(/\nconst PROJECTS = [^\n]*/), line(/\nconst pad = [^\n]*/), line(/\nconst ymd = [^\n]*/),
    DJS.slice(DJS.indexOf("\nconst WP_BANDS = ["), DJS.indexOf("\nconst WP_DAY_KEYS")),
    line(/\nconst WP_DAY_KEYS = [^\n]*/), line(/\nconst agendaDayKey = [^\n]*/),
    "function calWeekStart(offset)" + bodyOf(DJS, "calWeekStart"),
    "function agendaWeekOf(offset)" + bodyOf(DJS, "agendaWeekOf"),
    line(/\nconst tlBandLabel = [^\n]*/),
    DJS.slice(DJS.indexOf("\nconst tlStepOf = "), DJS.indexOf("/* On screen first, then told to the board")),
    "const esc = (s) => String(s); function renderTodayList(){} function fmAfterChange(){} async function loadAgenda(){} function ftReset(){}",
    "const agendaToday = () => wpAgendaToday;",
    "return { tlCancelHtml, tlDeleteGo, tlUndoGo, tlUndoHtml, setCancel: (c) => { tlCancel = c; }, getCancel: () => tlCancel, getUndo: () => tlUndo };",
  ].join("\n");
  return { api: new Function("fetch", "setTimeout", src)(fetch, () => 0), sent };
}

const step = (id, extra) => Object.assign({ id, title: "Step " + id, col: "todo", urgency: "normal", due: "",
  tags: [], notes: "kept notes", checklist: [], files: [], done: false, del: false, order: 0,
  week: "", day: "", slot: "", colBefore: "" }, extra || {});
const MONEY = () => ({
  id: "pM", name: "Money straight", status: "active", archived: false,
  columns: [{ id: "todo", name: "To do", done: false }, { id: "done", name: "Done", done: true }],
  steps: [step("sBills", { title: "List every outstanding bill, pay the overdue ones", week: THIS, day: TK }),
          step("sOther", { title: "Something else", week: THIS, day: TK })],
  canvas: [],
});
const row = (title, kind, tgt) => ({ title, kind, done: false, tgt });
const emptyWeek = (w, extra) => Object.assign({ weekEnding: w, projectItems: [], bufferItems: [], placements: {} }, extra || {});
const has = (k, pred) => Object.values((get(k) || { cells: {} }).cells).some((rows) => rows.some((r) => pred(r.tgt || {})));

(async () => {
  const call = await handlers();

  /* 1. THE SCREENSHOT: the bills step, deleted everywhere — and Undo */
  {
    m.clear();
    await call("/.netlify/functions/projects", { project: MONEY() });
    put("weekly-agenda-" + THIS, { weekEnding: THIS, cells: { ["any:" + TK]: [row("List every outstanding bill", "project", { p: "pM", s: "sBills" }), row("Something else", "project", { p: "pM", s: "sOther" })] } });
    put("weekly-agenda-" + NEXT, { weekEnding: NEXT, cells: { "any:mon": [row("List every outstanding bill", "project", { p: "pM", s: "sBills" })] } });
    const p = JSON.parse(m.get("proj-pM"));
    const j = { key: "step:pM:sBills", title: p.steps[0].title, source: "plan", kind: "project", when: "Anytime",
      cellKey: "any:" + TK, tgt: { p: "pM", s: "sBills" }, step: { project: p, step: p.steps[0] } };
    const { api, sent } = daily(call);

    api.setCancel({ key: j.key, stage: "ask" });
    assert.ok(/data-tl="cx-del">Delete it</.test(api.tlCancelHtml(j)), "cancel's menu now has Delete it");
    api.setCancel({ key: j.key, stage: "del" });
    let html = api.tlCancelHtml(j);
    assert.ok(/Just today/.test(html) && /data-tl="cx-drop"/.test(html) && /Everywhere/.test(html),
      "it asks: just today (the v251 skip) or everywhere");
    api.setCancel({ key: j.key, stage: "delsure" });
    html = api.tlCancelHtml(j);
    assert.ok(/Delete it everywhere\?/.test(html) && /Money straight board/.test(html) && /weekly planner and the calendar/.test(html) && /Yes, delete it/.test(html),
      "…then an Are-you-sure that names the board, the planner and the calendar");

    await api.tlDeleteGo(j);
    assert.strictEqual(api.getCancel(), null, "it went");
    const st = JSON.parse(m.get("proj-pM")).steps.find((s) => s.id === "sBills");
    assert.strictEqual(st.del, true, "deleted on its board — the board's own delete");
    assert.strictEqual(st.notes, "kept notes", "…which keeps the step and its notes, as the board always has");
    assert.ok(!has("weekly-agenda-" + THIS, (t) => t.s === "sBills") && has("weekly-agenda-" + THIS, (t) => t.s === "sOther"),
      "off this week's calendar, and only it");
    assert.ok(!has("weekly-agenda-" + NEXT, (t) => t.s === "sBills"), "…and off next week's too");
    let w = await boot({ projects: [JSON.parse(m.get("proj-pM"))], plans: { [THIS]: emptyWeek(THIS) } });
    await w.ctx.loadWeeklyPlan(THIS);
    assert.ok(!Object.values(w.ctx.__wpState.plan.placements).some((r) => r.includes("project:ps-sBills")), "THE PLANNER no longer has it");
    assert.ok(/Undo/.test(api.tlUndoHtml()) && /deleted everywhere/.test(api.tlUndoHtml()), "the way back is on the confirmation");
    const stepWrites = sent.filter((s) => s.body.stepLink).map((s) => Object.keys(s.body.stepLink).sort().join(","));
    assert.deepStrictEqual(stepWrites, ["del,projectId,stepId"], "the board was sent one boolean on one step");

    await api.tlUndoGo();
    assert.strictEqual(api.getUndo(), null, "Undo went through");
    assert.strictEqual(JSON.parse(m.get("proj-pM")).steps.find((s) => s.id === "sBills").del, false, "the step is back on its board");
    assert.ok(has("weekly-agenda-" + THIS, (t) => t.s === "sBills") && has("weekly-agenda-" + NEXT, (t) => t.s === "sBills"), "…and on both calendars");
    w = await boot({ projects: [JSON.parse(m.get("proj-pM"))], plans: { [THIS]: emptyWeek(THIS) } });
    await w.ctx.loadWeeklyPlan(THIS);
    assert.ok((w.ctx.__wpState.plan.placements["any:" + TK] || []).includes("project:ps-sBills"), "…and in the planner, where it was");
  }

  /* 2. A recurring job: off the recurring list for good — every week — and Undo puts it back in its place */
  {
    m.clear();
    const LIST = [{ title: "Weekly Finance Block", owner: "Ash", id: "wf", days: ["fri"], time: "6-9" },
                  { title: "Lead Generation", owner: "Ash", id: "lg", days: DAYK.slice(), time: "10-12" },
                  { title: "Plan content", owner: "Ash", id: "pc", days: ["fri"], time: "10-12" }];
    put("weekly-recurring-defaults", LIST);
    put("weekly-plan-" + THIS, emptyWeek(THIS, { exceptions: { "recurring:lg": [{ type: "skip", from: "10-12:mon" }] }, recurringDone: { "lg:mon": true } }));
    put("weekly-plan-" + LAST, emptyWeek(LAST, { recurringDone: { "lg:fri": true } }));
    const lgRow = (d) => row("Lead Generation", "recurring", { m: "recurringDone", k: "lg:" + d });
    put("weekly-agenda-" + LAST, { weekEnding: LAST, cells: { "10-12:fri": [lgRow("fri")] } });
    put("weekly-agenda-" + THIS, { weekEnding: THIS, cells: { "10-12:tue": [lgRow("tue")], "10-12:fri": [lgRow("fri"), row("Plan content", "recurring", { m: "recurringDone", k: "pc" })] } });
    put("weekly-agenda-" + NEXT, { weekEnding: NEXT, cells: { "10-12:mon": [lgRow("mon")] } });
    const before = { plan: get("weekly-plan-" + THIS), ag: [get("weekly-agenda-" + THIS), get("weekly-agenda-" + NEXT)] };
    const j = { key: "plan:recurringDone:lg:tue", title: "Lead Generation", source: "plan", kind: "recurring", when: "9–11.30",
      cellKey: "10-12:tue", tgt: { m: "recurringDone", k: "lg:tue" } };
    const { api } = daily(call);
    api.setCancel({ key: j.key, stage: "delsure" });
    assert.ok(/off your recurring list for good — every week, not just today/.test(api.tlCancelHtml(j)), "it says it is for good, every week");

    await api.tlDeleteGo(j);
    assert.deepStrictEqual(get("weekly-recurring-defaults").map((t) => t.id), ["wf", "pc"], "off the recurring list — and only it");
    assert.ok(!get("weekly-plan-" + THIS).exceptions["recurring:lg"], "this week's skip for it went with it");
    assert.ok(get("weekly-plan-" + THIS).recurringDone["lg:mon"], "…what was ticked stays ticked (history is not rewritten)");
    assert.ok(!has("weekly-agenda-" + THIS, (t) => String(t.k).startsWith("lg")) && !has("weekly-agenda-" + NEXT, (t) => String(t.k).startsWith("lg")),
      "off this week's calendar and next week's");
    assert.ok(has("weekly-agenda-" + THIS, (t) => t.k === "pc"), "…leaving the other blocks alone");
    assert.ok(has("weekly-agenda-" + LAST, (t) => String(t.k).startsWith("lg")), "last week's record is not touched");
    const w = await boot({ defaults: get("weekly-recurring-defaults"), plans: { [THIS]: get("weekly-plan-" + THIS) } });
    await w.ctx.loadWeeklyPlan(THIS);
    const E = w.ctx.wpEffectivePlacements();
    assert.ok(!Object.values(E).some((r) => r.includes("recurring:lg")), "THE PLANNER no longer has it on any day");

    await api.tlUndoGo();
    assert.deepStrictEqual(get("weekly-recurring-defaults"), LIST, "Undo puts it back on the list, in its place, exactly as it was");
    assert.deepStrictEqual(get("weekly-plan-" + THIS).exceptions, before.plan.exceptions, "…with this week's skip");
    for (const k of ["weekly-agenda-" + THIS, "weekly-agenda-" + NEXT]) {
      assert.ok(has(k, (t) => String(t.k).startsWith("lg")), "…and back on the calendar: " + k);
    }
    const again = await call("/.netlify/functions/kpi-store", { weeklyDelete: { weekEnding: THIS, undo: "anything" } });
    assert.strictEqual(again.status, 404, "an Undo can only be used once — it never makes a second copy");
  }

  /* 3. A one-off planner task: out of this week's list and its slot; Undo restores both */
  {
    m.clear();
    put("weekly-plan-" + THIS, emptyWeek(THIS, { bufferItems: [{ id: "b0", title: "Keep me" }, { id: "b1", title: "Ring the accountant" }],
      placements: { ["1-3:" + TK]: ["buffer:b1", "buffer:b0"] } }));
    put("weekly-agenda-" + THIS, { weekEnding: THIS, cells: { ["1-3:" + TK]: [row("Ring the accountant", "buffer", { l: "bufferItems", k: "b1" }), row("Keep me", "buffer", { l: "bufferItems", k: "b0" })] } });
    const before = get("weekly-plan-" + THIS);
    const j = { key: "plan:bufferItems:b1", title: "Ring the accountant", source: "plan", kind: "buffer", when: "12–3",
      cellKey: "1-3:" + TK, tgt: { l: "bufferItems", k: "b1" } };
    const { api } = daily(call);
    await api.tlDeleteGo(j);
    const plan = get("weekly-plan-" + THIS);
    assert.deepStrictEqual(plan.bufferItems.map((x) => x.id), ["b0"], "out of the week's list");
    assert.deepStrictEqual(plan.placements["1-3:" + TK], ["buffer:b0"], "…and its slot");
    assert.ok(!has("weekly-agenda-" + THIS, (t) => t.k === "b1"), "…and the calendar");
    await api.tlUndoGo();
    const back = get("weekly-plan-" + THIS);
    assert.deepStrictEqual(back.bufferItems, before.bufferItems, "Undo: back in the list, in its place");
    assert.ok(back.placements["1-3:" + TK].includes("buffer:b1"), "…and in its slot");
  }

  /* 4. Nothing is taken that cannot be put back; refusals take nothing */
  {
    m.clear();
    put("weekly-recurring-defaults", [{ title: "A", id: "a" }]);
    const r = await call("/.netlify/functions/kpi-store", { weeklyDelete: { weekEnding: THIS, tgt: { m: "recurringDone", k: "nope" } } });
    assert.strictEqual(r.status, 404, "a job that is not on the list is said so");
    assert.deepStrictEqual(get("weekly-recurring-defaults"), [{ title: "A", id: "a" }], "…and nothing was touched");
    assert.strictEqual((await call("/.netlify/functions/kpi-store", { weeklyDelete: { weekEnding: THIS, tgt: { m: "weeklyPlan", k: "x" } } })).status, 400,
      "a made-up target is refused");
    const ok = await call("/.netlify/functions/kpi-store", { weeklyDelete: { weekEnding: THIS, tgt: { m: "recurringDone", k: "a" } } });
    assert.strictEqual(get("weekly-last-delete").token, ok.json.token, "the way back was written down");
    assert.deepStrictEqual(get("weekly-last-delete").item, { title: "A", id: "a" }, "…whole");
  }

  /* 5. The board's delete through stepLink is one boolean — nothing else rides along */
  {
    m.clear();
    await call("/.netlify/functions/projects", { project: MONEY() });
    const r = await call("/.netlify/functions/projects", { stepLink: { projectId: "pM", stepId: "sBills", del: true, title: "HACKED", notes: "HACKED" } });
    const s = r.json.step;
    assert.ok(s.del === true && s.title === "List every outstanding bill, pay the overdue ones" && s.notes === "kept notes",
      "del flags the step and reaches nothing else on it");
    assert.strictEqual(JSON.parse(m.get("proj-pM")).steps.length, 2, "…and the step is still in the store");
  }

  console.log("v253-delete-everywhere: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
