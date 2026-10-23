// v252 — "later" says exactly when, and every page agrees; each job says where it is from.
//
// Ash: "we need a little more specificity on the jobs. Right now you can see 'Team meeting:
// agree the Shred plan, hand out the jobs' — that's a job from a project … in weekly planning
// … you can see that is specific. Another thing, when we 'later' it, it just moves it to
// 'parked'. I should be able to specify exactly when it's being moved to, and it should move
// it in the calendar and the weekly planner. Basically, I want all corresponding dates
// everywhere to align."
//
// The Daily page's own move code is RUN here (with a fixed clock and a recording fetch), what
// it sends is applied to the REAL projects store and the REAL kpi-store route, and the step
// that comes out is laid on the REAL weekly page — so "it moved in the planner" is checked
// where the planner draws it, not inferred from a request.
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

// ---- dates from the real clock, so the test means the same thing on any day ----
const pad = (n) => String(n).padStart(2, "0");
const localYmd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const TODAY = localYmd(new Date());
const addDays = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOfYmd = (ymd) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const DAYK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const dayKeyOf = (ymd) => DAYK[(new Date(ymd + "T00:00:00Z").getUTCDay() + 6) % 7];
const THIS = mondayOfYmd(TODAY);
const NEXT = addDays(THIS, 7);
const NEXT_TUE = addDays(NEXT, 1);
const TODAY_KEY = dayKeyOf(TODAY);

/* ---------- the Daily page's move code, in a sandbox: 7am today, a recording fetch ---------- */
function daily(opts) {
  const sent = [];
  const real = Date;
  class FakeDate extends real {
    constructor(...a) { if (a.length) super(...a); else { const [y, m, d] = TODAY.split("-").map(Number); super(y, m - 1, d, 7, 0, 0); } }
    static now() { return new FakeDate().getTime(); }
  }
  const reply = opts && opts.reply;
  const fetch = async (url, o) => {
    const body = JSON.parse(o.body);
    sent.push({ url, body });
    const out = reply ? await reply(url, body) : { ok: true };
    return { ok: true, status: 200, json: async () => out };
  };
  const src = [
    "let tlCancel = null, tlOpen = {}, wpAgenda = null, wpAgendaToday = null, calWeekOffset = 0;",
    line(/\nconst API = [^\n]*/), line(/\nconst PROJECTS = [^\n]*/), line(/\nconst pad = [^\n]*/), line(/\nconst ymd = [^\n]*/),
    DJS.slice(DJS.indexOf("\nconst WP_BANDS = ["), DJS.indexOf("\nconst WP_DAY_KEYS")),
    line(/\nconst WP_DAY_KEYS = [^\n]*/), line(/\nconst agendaDayKey = [^\n]*/),
    "function calWeekStart(offset)" + bodyOf(DJS, "calWeekStart"),
    "function agendaWeekOf(offset)" + bodyOf(DJS, "agendaWeekOf"),
    line(/\nconst TL_KIND_WORD = [^\n]*/), "function tlWhere(j)" + bodyOf(DJS, "tlWhere"), line(/\nconst tlBandLabel = [^\n]*/),
    DJS.slice(DJS.indexOf("\nconst tlStepOf = "), DJS.indexOf("/* On screen first, then told to the board")),
    "const esc = (s) => String(s); function renderTodayList(){} function fmAfterChange(){} async function loadAgenda(){}",
    "const agendaToday = () => wpAgendaToday;",
    "return { tlWhere, tlCancelDays, tlMoveSlots, tlCancelSays, tlCancelHtml, tlCancelGo, setCancel: (c) => { tlCancel = c; }, getCancel: () => tlCancel };",
  ].join("\n");
  const api = new Function("Date", "fetch", src)(FakeDate, fetch);
  return { api, sent };
}

/* ---------- the real stores ---------- */
async function kpiStore(seed) {
  const m = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  globalThis.__fakeStore = {
    async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, v); },
    async list(o) { const p = (o && o.prefix) || ""; return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })), directories: [] }; },
  };
  const src = read("netlify/functions/kpi-store.js");
  const tmp = path.join(os.tmpdir(), "kpi-store-v252-" + process.pid + "-" + Date.now() + Math.random() + ".mjs");
  fs.writeFileSync(tmp, src.replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => globalThis.__fakeStore;"));
  const h = (await import("file://" + tmp)).default;
  fs.unlinkSync(tmp);
  const post = async (body) => {
    const r = await h(new Request("https://x/.netlify/functions/kpi-store", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    return { status: r.status, json: r.status === 200 ? await r.json() : null };
  };
  return { post, get: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null) };
}
let projLib = null;
async function applyStepLink(project, link) {
  if (!projLib) {
    const tmp = path.join(os.tmpdir(), "projects-lib-v252-" + process.pid + ".mjs");
    fs.writeFileSync(tmp, read("netlify/lib/projects.js").replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => null;"));
    projLib = await import("file://" + tmp);
    fs.unlinkSync(tmp);
  }
  if ("due" in link) projLib.applyStepDue(project, link.stepId, link.due);
  if ("week" in link) projLib.applyStepWeek(project, link.stepId, link.week, link.day, link.slot);
  return project.steps.find((s) => s.id === link.stepId);
}

const step = (id, extra) => Object.assign({ id, title: "Step " + id, col: "todo", urgency: "normal", due: "",
  tags: [], notes: "", checklist: [], files: [], done: false, del: false, order: 0,
  week: "", day: "", slot: "", colBefore: "" }, extra || {});
const SHRED = () => ({
  id: "pS", name: "Christmas Shred", status: "active", archived: false,
  columns: [{ id: "todo", name: "To do", done: false }, { id: "done", name: "Done", done: true }],
  steps: [
    step("sMeet", { title: "Team meeting: agree the Shred plan, hand out the jobs", week: THIS, day: TODAY_KEY }),
    step("sBills", { title: "List every outstanding bill, pay the overdue ones", due: TODAY }),
  ],
  canvas: [],
});
const jobFor = (p, sid, cellKey) => {
  const st = p.steps.find((s) => s.id === sid);
  return { key: "step:" + p.id + ":" + sid, title: st.title, source: cellKey ? "plan" : "step", kind: "project",
    when: cellKey ? "Anytime" : "", done: false, cellKey: cellKey || "", tgt: cellKey ? { p: p.id, s: sid } : null,
    from: p.name, step: { project: p, step: st } };
};

(async () => {
  /* 1. SPECIFIC: a job says which project it belongs to, the way the planner does */
  {
    const { api } = daily();
    const p = SHRED();
    assert.strictEqual(api.tlWhere(jobFor(p, "sMeet", "any:" + TODAY_KEY)), "Christmas Shred · Anytime",
      "THE SCREENSHOT: the Shred meeting no longer says just “Anytime”");
    assert.strictEqual(api.tlWhere(jobFor(p, "sBills")), "Christmas Shred · due today");
    assert.strictEqual(api.tlWhere({ source: "plan", kind: "recurring", when: "6–9", tgt: { m: "recurringDone", k: "f" } }), "Recurring · 6–9",
      "a recurring block says it is one");
    assert.strictEqual(api.tlWhere({ source: "plan", kind: "training", when: "5–8" }), "Training · 5–8");
    assert.strictEqual(api.tlWhere({ source: "plan", kind: "project", when: "12–3" }), "12–3", "a one-off planner task just says its block");
    assert.strictEqual(api.tlWhere({ source: "step", late: 3, from: "Migrate to GHL", step: null }), "Migrate to GHL · 3 days late");
  }

  /* 2. LATER asks WHEN: a day, then a time — never a Parked line */
  {
    const { api } = daily();
    const p = SHRED();
    const j = jobFor(p, "sMeet", "any:" + TODAY_KEY);
    const days = api.tlCancelDays(j);
    assert.strictEqual(days[0], TODAY, "a step can go later today");
    assert.strictEqual(days.length, 8, "…or any of the next seven days");
    api.setCancel({ key: j.key, stage: "move", via: "later" });
    let html = api.tlCancelHtml(j);
    assert.ok(/When are you doing it instead\?/.test(html) && /Later today/.test(html), "it asks when");
    assert.ok(/data-tl-date/.test(html), "…with any other date there to pick, for a project step");
    api.setCancel({ key: j.key, stage: "move", via: "later", day: NEXT_TUE });
    html = api.tlCancelHtml(j);
    for (const t of ["Any time", "6–9", "9–11.30", "12–3", "5–8"]) assert.ok(html.includes(">" + t + "<"), "then the time: " + t);
    // later today: never the slot it is already in
    assert.ok(!api.tlMoveSlots(j, TODAY).includes("any"), "later today does not offer the Anytime it is already in");
    assert.ok(api.tlMoveSlots(j, TODAY).includes("1-3"), "…but does offer this afternoon");

    // a recurring block: this week only, and never Anytime (that row is for project steps)
    const rec = { key: "plan:recurringDone:lg", title: "Lead Generation", source: "plan", kind: "recurring", when: "9–11.30",
      tgt: { m: "recurringDone", k: "lg" }, cellKey: "10-12:" + TODAY_KEY, done: false };
    assert.ok(!api.tlMoveSlots(rec, NEXT_TUE).includes("any"), "a planner block never goes to Anytime");
    assert.ok(api.tlCancelDays(rec).every((d) => d < NEXT), "…and stays inside its week");
    assert.ok(!api.tlMoveSlots(rec, TODAY).includes("10-12") && api.tlMoveSlots(rec, TODAY).includes("5-8"),
      "later today = a later block, not the one it is in");

    api.setCancel({ key: j.key, stage: "sure", via: "later", to: NEXT_TUE, slot: "1-3" });
    html = api.tlCancelHtml(j);
    assert.ok(/Move it\?/.test(html) && /12–3/.test(html) && /Christmas Shred board/.test(html) && /weekly planner and calendar/.test(html),
      "before anything moves it says when, and that the board, planner and calendar all move");
    assert.ok(/Yes, move it/.test(html), "…and waits for a yes");
  }

  /* 3. THE SCREENSHOT, end to end: the Shred meeting → next Tuesday 12–3.
        The step moves on the board; the planner draws it there; both calendar copies agree. */
  {
    const p = SHRED();
    const agThis = { weekEnding: THIS, cells: { ["any:" + TODAY_KEY]: [{ title: p.steps[0].title, kind: "project", done: false, tgt: { p: "pS", s: "sMeet" } }] } };
    const agNext = { weekEnding: NEXT, cells: { "6-9:tue": [{ title: "Weekly Finance Block", kind: "recurring", done: false, tgt: { m: "recurringDone", k: "wf" } }] } };
    const kv = await kpiStore({ ["weekly-agenda-" + THIS]: agThis, ["weekly-agenda-" + NEXT]: agNext });
    const board = SHRED();
    const { api, sent } = daily({ reply: async (url, body) => {
      if (body.stepLink) return { ok: true, step: await applyStepLink(board, body.stepLink) };
      return (await kv.post(body)).json;
    } });
    const j = jobFor(p, "sMeet", "any:" + TODAY_KEY);
    api.setCancel({ key: j.key, stage: "sure", via: "later", to: NEXT_TUE, slot: "1-3" });
    await api.tlCancelGo(j);
    assert.strictEqual(api.getCancel(), null, "it saved, so the prompt closes");

    const link = sent.find((s) => s.body.stepLink).body.stepLink;
    assert.deepStrictEqual({ week: link.week, day: link.day, slot: link.slot }, { week: NEXT, day: "tue", slot: "1-3" },
      "the step is told its new week, day AND time");
    assert.ok(!("due" in link), "an undated step is not handed a deadline it never had");
    const moved = board.steps.find((s) => s.id === "sMeet");
    assert.deepStrictEqual([moved.week, moved.day, moved.slot], [NEXT, "tue", "1-3"], "…and the board has it");

    assert.ok(!Object.values(kv.get("weekly-agenda-" + THIS).cells).some((rows) => rows.some((r) => r.tgt && r.tgt.s === "sMeet")),
      "off today on the calendar");
    const tue = kv.get("weekly-agenda-" + NEXT).cells["1-3:tue"];
    assert.ok(tue && tue.length === 1 && tue[0].tgt.s === "sMeet", "…and on next Tuesday 12–3 on the calendar");
    assert.strictEqual(kv.get("weekly-agenda-" + NEXT).cells["6-9:tue"].length, 1, "…next to what was already there");

    // the weekly planner, opened on next week, draws it from the step: Tuesday, 12–3
    const { ctx } = await boot({ projects: [board], plans: { [NEXT]: { weekEnding: NEXT, projectItems: [], bufferItems: [], placements: {} } } });
    await ctx.loadWeeklyPlan(NEXT);
    const P = ctx.__wpState.plan.placements;
    assert.ok((P["1-3:tue"] || []).includes("project:ps-sMeet"), "THE PLANNER: next week, Tuesday, 12–3");
    assert.strictEqual(Object.values(P).filter((r) => r.includes("project:ps-sMeet")).length, 1, "…in one place only");
  }

  /* 4. A DATED step: its due date follows, and the planner, board and calendar agree on the day */
  {
    const p = SHRED();
    const kv = await kpiStore({ ["weekly-agenda-" + THIS]: { weekEnding: THIS, cells: {} } });
    const board = SHRED();
    const { api, sent } = daily({ reply: async (url, body) => body.stepLink
      ? { ok: true, step: await applyStepLink(board, body.stepLink) } : (await kv.post(body)).json });
    const j = jobFor(p, "sBills");      // due today, never planned — no row on the calendar yet
    api.setCancel({ key: j.key, stage: "sure", via: "later", to: NEXT_TUE, slot: "6-9" });
    await api.tlCancelGo(j);
    const link = sent.find((s) => s.body.stepLink).body.stepLink;
    assert.strictEqual(link.due, NEXT_TUE, "its due date moves to the day it was moved to");
    const st = board.steps.find((s) => s.id === "sBills");
    assert.deepStrictEqual([st.due, st.week, st.day, st.slot], [NEXT_TUE, NEXT, "tue", "6-9"], "the board has date, day and time");
    assert.ok(!kv.get("weekly-agenda-" + NEXT), "a week the planner has never written is not invented — it writes it whole when opened");
    const { ctx } = await boot({ projects: [board], plans: { [NEXT]: { weekEnding: NEXT, projectItems: [], bufferItems: [], placements: {} } } });
    await ctx.loadWeeklyPlan(NEXT);
    assert.ok((ctx.__wpState.plan.placements["6-9:tue"] || []).includes("project:ps-sBills"), "the planner puts it on Tuesday 6–9");
  }

  /* 5. Later today, a different time: a recurring block becomes this week's one-off move, and the
        recurring list is left alone */
  {
    const LG = { m: "recurringDone", k: "lg:" + TODAY_KEY };
    const cell = "10-12:" + TODAY_KEY, dest = "5-8:" + TODAY_KEY;
    const kv = await kpiStore({
      ["weekly-plan-" + THIS]: { weekEnding: THIS, placements: {}, bufferItems: [] },
      ["weekly-agenda-" + THIS]: { weekEnding: THIS, cells: { [cell]: [{ title: "Lead Generation", kind: "recurring", done: false, tgt: LG }] } },
    });
    const { api } = daily({ reply: async (url, body) => (await kv.post(body)).json });
    const j = { key: "plan:recurringDone:" + LG.k, title: "Lead Generation", source: "plan", kind: "recurring", when: "9–11.30", tgt: LG, cellKey: cell, done: false };
    api.setCancel({ key: j.key, stage: "sure", via: "later", to: TODAY, slot: "5-8" });
    assert.ok(/later today, 5–8/.test(api.tlCancelHtml(j)) && /recurring list is not touched/.test(api.tlCancelHtml(j)), "it says so");
    await api.tlCancelGo(j);
    assert.deepStrictEqual(kv.get("weekly-plan-" + THIS).exceptions["recurring:lg"], [{ type: "move", from: cell, to: dest }],
      "written as the planner's own move, this week only");
    assert.ok(kv.get("weekly-agenda-" + THIS).cells[dest], "the calendar has it this evening");
  }

  /* 6. The route's new edges: a step with no row today; a plan job still needs one */
  {
    const kv = await kpiStore({ ["weekly-agenda-" + THIS]: { weekEnding: THIS, cells: {} } });
    const ok = await kv.post({ weeklyCancel: { weekEnding: THIS, tgt: { p: "pS", s: "sBills" }, cell: "", to: "1-3:" + TODAY_KEY, title: "List every bill" } });
    assert.strictEqual(ok.status, 200, "a dated-but-unplanned step can be given a time today");
    assert.strictEqual(ok.json.agenda.cells["1-3:" + TODAY_KEY][0].title, "List every bill", "…and lands on the calendar");
    const bad = await kv.post({ weeklyCancel: { weekEnding: THIS, tgt: { m: "recurringDone", k: "lg" }, cell: "", to: "1-3:wed" } });
    assert.strictEqual(bad.status, 400, "a planner job must say which cell it is leaving");
    const nowhere = await kv.post({ weeklyCancel: { weekEnding: THIS, tgt: { p: "pS", s: "sBills" }, cell: "" } });
    assert.strictEqual(nowhere.status, 400, "nothing to leave and nowhere to go is refused");
    const across = await kv.post({ weeklyCancel: { weekEnding: THIS, tgt: { m: "recurringDone", k: "lg" }, cell: "10-12:mon", to: "10-12:tue", toWeek: NEXT } });
    assert.ok(across.status !== 200 || !kv.get("weekly-agenda-" + NEXT), "a planner job cannot be sent to another week");
  }

  /* 7. The page: "later" moves, nothing new parks, an old parked job still comes back */
  {
    const row = bodyOf(DJS, "tlRowHtml");
    assert.ok(/data-tl="later"/.test(row) && !/data-tl="park"/.test(row), "the row's later is the move, not the park");
    assert.ok(/data-tl="unpark"/.test(row), "a job parked before today can still be brought back");
    const click = bodyOf(DJS, "tlClick");
    assert.ok(!/tlPark\(j, true\)/.test(click), "nothing parks any more");
    assert.ok(/act === "later"[\s\S]*?stage: "move", via: "later"/.test(click), "later opens the when");
    const q = bodyOf(DJS, "fmBuildQueue");
    assert.ok(/st\.week === thisWeek && st\.day === dayKey/.test(q), "an undated step moved to today is on today's list from the step itself");
  }

  console.log("v252-later-says-when: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
