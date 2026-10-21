// v227 — one place for a step.
//
// Ash: "The planning pages don't work as one system. Fix that and nothing else."
//
// THE RULE: a project step and its done-state exist in exactly one place, the projects
// store. The weekly and daily pages never store a copy of a step and never keep their own
// done flag for one — they read it live and hold only where it sits.
//
// Every claim below is driven in the real weekly page (tests/lib/env.cjs boots it with a
// served, mutable project list) or the real projects function, and read off the store
// afterwards — because "it is on the board" is the claim, not "a request was sent". Dates are
// built from the real clock (next week is always the future; two days ago is always late),
// so the test means the same thing whatever day it runs.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { boot } = require("./lib/env.cjs");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const WEEKLY = read("index.html");
const WJS = WEEKLY.slice(WEEKLY.lastIndexOf("<script>") + 8, WEEKLY.lastIndexOf("</script>"));
const DAILY = read("daily.html");
const DJS = DAILY.slice(DAILY.lastIndexOf("<script>") + 8, DAILY.lastIndexOf("</script>"));
const PROJ = read("projects.html");
const PJS = PROJ.slice(PROJ.lastIndexOf("<script>") + 8, PROJ.lastIndexOf("</script>"));
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
const bare = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ---- dates, from the real clock ----
const pad = (n) => String(n).padStart(2, "0");
const localYmd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const TODAY = localYmd(new Date());
const addDays = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOfYmd = (ymd) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const THIS = mondayOfYmd(TODAY);
const NEXT = addDays(THIS, 7);        // every day of it is in the future
const AFTER = addDays(THIS, 14);
const AGO2 = addDays(TODAY, -2);     // always late

const step = (id, extra) => Object.assign({ id, title: "Step " + id, col: "todo", urgency: "normal", due: "",
  tags: [], notes: "", checklist: [], files: [], done: false, del: false, order: 0,
  week: "", day: "", slot: "", colBefore: "" }, extra || {});
const PROJECT = () => ({
  id: "p1", name: "Ads back on & leads worked", status: "active", accent: "orange", archived: false,
  columns: [{ id: "todo", name: "To do", done: false }, { id: "doing", name: "Doing", done: false },
            { id: "done", name: "Done", done: true }],
  steps: [
    step("s_ads", { title: "Turn the 6-week challenge ads back on", due: addDays(NEXT, 3) }),        // Thu, no time
    step("s_timed", { title: "Brief the team", due: addDays(NEXT, 1), week: NEXT, day: "tue", slot: "1-3" }),
    step("s_late", { title: "Reply to the leads from last week", due: AGO2 }),
    step("s_late2", { title: "Chase the Stripe dispute", due: AGO2 }),
    step("s_lateDone", { title: "Late but finished", due: AGO2, done: true }),
    step("s_undated", { title: "Write the follow-up email" }),
  ],
  canvas: [],
});
const emptyWeek = (w) => ({ weekEnding: w, projectItems: [], bufferItems: [], placements: {} });
const agendaPosts = (posts) => posts.filter((p) => p.body && p.body.weeklyAgenda);
const lastAgenda = (posts) => { const a = agendaPosts(posts).pop(); return a && a.body.weeklyAgenda; };
const stepOf = (projects, id) => projects[0].steps.find((s) => s.id === id);

(async () => {
  /* =====================================================================
     1. A DATED STEP IS ON ITS DAY WITHOUT ANYBODY PULLING IT
     ===================================================================== */
  {
    const { ctx, posts } = await boot({ projects: [PROJECT()], plans: { [NEXT]: emptyWeek(NEXT) } });
    await ctx.loadWeeklyPlan(NEXT);
    const P = ctx.__wpState.plan.placements;
    assert.ok((P["any:thu"] || []).includes("project:ps-s_ads"),
      "a step dated Thursday is on Thursday — in the Anytime row, because it has no time yet");
    assert.ok((P["1-3:tue"] || []).includes("project:ps-s_timed"), "…and one given a time sits in that time");
    assert.ok(!Object.values(P).some((refs) => refs.includes("project:ps-s_undated")),
      "a step with no date and no plan is not on the week");
    assert.ok(ctx.wpProjItemById("ps-s_ads").derived, "the week's item is derived from the step, not stored");

    // the Anytime row is drawn above the time rows, and only because something is in it
    const html = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(/class="wp-grid-any"[\s\S]*?>Anytime</.test(html), "the grid has an Anytime row");
    assert.ok(html.indexOf("wp-grid-any") < html.indexOf('data-cell="6-9:'), "…at the top");

    // the daily page is told WHICH step, not an address in the plan
    const ag = lastAgenda(posts);
    const row = ag.cells["any:thu"].find((r) => r.title === "Turn the 6-week challenge ads back on");
    assert.deepStrictEqual(row.tgt, { p: "p1", s: "s_ads" }, "the agenda row carries projectId + stepId for the daily page");

    // a week with no steps in it has no Anytime row at all — it looks as it always did
    const b2 = await boot({ projects: [PROJECT()], plans: { [AFTER]: emptyWeek(AFTER) } });
    await b2.ctx.loadWeeklyPlan(AFTER);
    assert.ok(!/wp-grid-any/.test(b2.ctx.document.getElementById("wpBody").innerHTML), "no steps, no Anytime row");
  }

  /* =====================================================================
     2. ONE TICK, IN ONE PLACE — and a reload proves it is the store
     ===================================================================== */
  {
    const world = { projects: [PROJECT()], plans: { [NEXT]: emptyWeek(NEXT) } };
    let b = await boot(world);
    await b.ctx.loadWeeklyPlan(NEXT);
    const n0 = b.posts.length;
    await b.ctx.wpToggleDoneRef("project:ps-s_ads", true, "thu");
    await b.settle();
    assert.strictEqual(stepOf(b.projects, "s_ads").done, true, "ticking it on the weekly page marks the STEP done");
    assert.strictEqual(stepOf(b.projects, "s_ads").col, "done", "…and the card moves to Done, as it always did");
    const tickPosts = b.posts.slice(n0);
    assert.ok(!tickPosts.some((p) => p.body && p.body.weeklyPlan), "nothing about the tick was written into the week");

    // reload the weekly page against the same store
    b = await boot({ projects: b.projects, plans: world.plans });
    await b.ctx.loadWeeklyPlan(NEXT);
    assert.strictEqual(b.ctx.wpIsDone("project", b.ctx.wpProjItemById("ps-s_ads")), true, "after a reload it is still done");

    // untick it on the BOARD (the store), reload: live again
    const store = b.projects;
    Object.assign(stepOf(store, "s_ads"), { done: false, col: "todo" });
    b = await boot({ projects: store, plans: world.plans });
    await b.ctx.loadWeeklyPlan(NEXT);
    assert.strictEqual(b.ctx.wpIsDone("project", b.ctx.wpProjItemById("ps-s_ads")), false,
      "unticked on the board → open again on the weekly page, with nothing else touched");
    const ag = lastAgenda(b.posts);
    assert.strictEqual(ag.cells["any:thu"].find((r) => r.tgt && r.tgt.s === "s_ads").done, false,
      "…and on the daily page's agenda");
  }

  /* =====================================================================
     3. A MOVED DATE MOVES THE STEP'S WEEK — from the board, or by dragging
     ===================================================================== */
  {
    const proj = PROJECT();
    proj.steps.find((s) => s.id === "s_ads").due = addDays(AFTER, 2);    // moved on the board
    let b = await boot({ projects: [proj], plans: { [NEXT]: emptyWeek(NEXT), [AFTER]: emptyWeek(AFTER) } });
    await b.ctx.loadWeeklyPlan(NEXT);
    assert.ok(!Object.values(b.ctx.__wpState.plan.placements).some((r) => r.includes("project:ps-s_ads")),
      "a date moved on the board takes the step out of its old week");
    await b.ctx.loadWeeklyPlan(AFTER);
    assert.ok((b.ctx.__wpState.plan.placements["any:wed"] || []).includes("project:ps-s_ads"),
      "…and it is on its new day in its new week, with nothing else touched");

    // dragging a dated step to another day and time on the weekly grid moves its DATE
    b = await boot({ projects: [PROJECT()], plans: { [NEXT]: emptyWeek(NEXT) } });
    await b.ctx.loadWeeklyPlan(NEXT);
    await b.ctx.wpPlaceRefAt("project:ps-s_ads", "10-12", "fri");
    await b.settle();
    const st = stepOf(b.projects, "s_ads");
    assert.strictEqual(st.due, addDays(NEXT, 4), "dragging it to Friday makes it due Friday");
    assert.deepStrictEqual([st.week, st.day, st.slot], [NEXT, "fri", "10-12"], "…in the time it was dropped in");
    assert.ok((b.ctx.__wpState.plan.placements["10-12:fri"] || []).includes("project:ps-s_ads"), "…and that is where it shows");
    const save = b.posts.filter((p) => p.body && p.body.weeklyPlan).pop();
    assert.ok(!save || !JSON.stringify(save.body.weeklyPlan).includes("ps-"), "the week saved nothing about it");
  }

  /* =====================================================================
     4. OVERDUE: past its date and not done
     ===================================================================== */
  {
    const b = await boot({ projects: [PROJECT()], plans: { [THIS]: emptyWeek(THIS) } });
    await b.ctx.loadWeeklyPlan(THIS);
    const late = b.ctx.wpProjItemById("ps-s_late");
    assert.ok(late && late.overdue, "a step past its date and not done is overdue");
    assert.ok(!b.ctx.wpProjItemById("ps-s_lateDone") || !b.ctx.wpProjItemById("ps-s_lateDone").overdue,
      "…a done one is not");
    const html = b.ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(/wp-overdue[\s\S]*Reply to the leads from last week[\s\S]*Ads back on &amp; leads worked[\s\S]*2 days late/.test(html),
      "the Overdue strip names it, its project, and how late it is");
    assert.ok(html.indexOf("wp-overdue") < html.indexOf("wpAddItem('project')"), "…above the Project box");
    assert.ok(!Object.values(b.ctx.__wpState.plan.placements).some((r) => r.includes("project:ps-s_late")),
      "…and it is in the strip, not also on the grid");

    // tick it there: the step is done
    await b.ctx.wpToggleDoneRef("project:ps-s_late", true);
    await b.settle();
    assert.strictEqual(stepOf(b.projects, "s_late").done, true, "ticking it in the strip marks the step done");

    // drag the other one onto Monday: its due date moves
    await b.ctx.wpPlaceRefAt("project:ps-s_late2", "6-9", "mon");
    await b.settle();
    assert.strictEqual(stepOf(b.projects, "s_late2").due, THIS, "dragging an overdue step onto a day moves its due date to that day");
  }

  /* =====================================================================
     5. MIGRATION — old weeks hold copies; they become nothing but a pointer, once
     ===================================================================== */
  {
    const proj = PROJECT();
    proj.steps.push(step("s_mig", { title: "Pulled last month, no date" }));
    proj.steps.push(step("s_timed2", { title: "Dated Tuesday, dragged to a time", due: addDays(NEXT, 1) }));
    const plan = emptyWeek(NEXT);
    plan.projectItems = [
      // a v214 copy: done in the week, NOT done on the board — the step wins
      { id: "t1", title: "Pulled last month, no date", done: true, linkId: "projstep:p1:s_mig:" + NEXT,
        source: "project-step", sourceProjectId: "p1", sourceStepId: "s_mig" },
      // a copy of a dated step — its date decides where it goes
      { id: "t2", title: "Turn the 6-week challenge ads back on", done: false, linkId: "projstep:p1:s_ads:" + NEXT,
        source: "project-step", sourceProjectId: "p1", sourceStepId: "s_ads" },
      // a copy whose step has gone — kept, as a plain task
      { id: "t3", title: "A step that was deleted", done: false, linkId: "projstep:p1:s_gone:" + NEXT,
        source: "project-step", sourceProjectId: "p1", sourceStepId: "s_gone" },
      { id: "t4", title: "An ordinary project task", done: false },
      { id: "t5", title: "Dated Tuesday, dragged to a time", done: false, linkId: "projstep:p1:s_timed2:" + NEXT,
        source: "project-step", sourceProjectId: "p1", sourceStepId: "s_timed2" },
    ];
    plan.placements = { "5-8:wed": ["project:t1"], "6-9:mon": ["project:t2", "project:t4"], "1-3:fri": ["project:t3"], "10-12:tue": ["project:t5"] };

    const logs = [];
    const orig = console.info;
    console.info = (...a) => logs.push(a);
    let b;
    try {
      b = await boot({ projects: [proj], plans: { [NEXT]: plan } });
      await b.ctx.loadWeeklyPlan(NEXT);
      await b.settle();
    } finally { console.info = orig; }

    const S = b.ctx.__wpState.plan;
    assert.ok(!S.projectItems.some((i) => ["t1", "t2"].includes(i.id)), "the copies are gone from the week");
    const mig = stepOf(b.projects, "s_mig");
    assert.deepStrictEqual([mig.week, mig.day, mig.slot], [NEXT, "wed", "5-8"],
      "an undated pulled step keeps where it was planned — written onto the step");
    assert.strictEqual(mig.done, false, "the step's done-state wins over the copy's");
    assert.strictEqual(b.ctx.wpIsDone("project", b.ctx.wpProjItemById("ps-s_mig")), false, "…and the week shows the step's");
    assert.ok((S.placements["5-8:wed"] || []).includes("project:ps-s_mig"), "…in the same cell as before");
    assert.ok((S.placements["any:thu"] || []).includes("project:ps-s_ads"), "a dated step's copy gives way to its date");
    assert.ok((S.placements["10-12:tue"] || []).includes("project:ps-s_timed2"),
      "…but a copy that sat in a time ON its due day keeps that time, written onto the step");
    assert.strictEqual(stepOf(b.projects, "s_timed2").slot, "10-12", "…the step now says so");
    const t3 = S.projectItems.find((i) => i.id === "t3");
    assert.ok(t3 && !t3.source && t3.title === "A step that was deleted", "a copy whose step is gone is kept as a plain task");
    assert.ok(S.projectItems.some((i) => i.id === "t4"), "an ordinary project task is untouched");

    const saved = b.posts.filter((p) => p.body && p.body.weeklyPlan).pop().body.weeklyPlan;
    assert.deepStrictEqual(saved.projectItems.map((i) => i.id).sort(), ["t3", "t4"],
      "what is saved is the week's own tasks — no copies, and no derived steps");
    assert.ok(!JSON.stringify(saved.placements).includes("ps-") && !/"any:/.test(JSON.stringify(saved.placements)),
      "…and no placement of a step");
    assert.ok(logs.some((a) => /\[v227\]/.test(String(a[0]))), "what was converted is logged to the console");
    const logged = JSON.stringify(logs);
    assert.ok(/step wins/.test(logged), "…including the done-state disagreement, and which side won");

    // the second load has nothing left to convert and writes nothing
    const again = await boot({ projects: b.projects, plans: { [NEXT]: Object.assign({}, saved) } });
    const quiet = [];
    console.info = (...a) => quiet.push(a);
    try { await again.ctx.loadWeeklyPlan(NEXT); await again.settle(); } finally { console.info = orig; }
    assert.ok(!quiet.some((a) => /\[v227\]/.test(String(a[0]))), "a converted week converts nothing the second time");
    assert.ok(!again.posts.some((p) => p.body && p.body.stepLink), "…and touches no step");
  }

  /* =====================================================================
     6. TAKING A PULLED STEP OFF THE WEEK, AND THE PULL ITSELF
     ===================================================================== */
  {
    const proj = PROJECT();
    Object.assign(proj.steps.find((s) => s.id === "s_undated"), { week: NEXT, day: "mon", slot: "6-9" });
    const b = await boot({ projects: [proj], plans: { [NEXT]: emptyWeek(NEXT) } });
    await b.ctx.loadWeeklyPlan(NEXT);
    assert.ok((b.ctx.__wpState.plan.placements["6-9:mon"] || []).includes("project:ps-s_undated"), "a pulled undated step sits where it was put");
    await b.ctx.wpRemoveItem("project", "ps-s_undated");
    await b.settle();
    assert.deepStrictEqual([stepOf(b.projects, "s_undated").week, stepOf(b.projects, "s_undated").day], ["", ""],
      "its ✕ takes it off this week — on the step");
    assert.ok(stepOf(b.projects, "s_undated") && !stepOf(b.projects, "s_undated").del, "…and the step is still on its board");

    // the picker offers only undated steps, and a pull writes the step
    const open = b.ctx.wpProjOpenSteps(b.ctx.wpProjItemById ? proj : proj);
    assert.ok(!open.some((s) => s.due), "the pull picker offers only steps with no date — a dated one is already on its day");
    const confirm = bodyOf(WJS, "wpProjPullConfirm");
    assert.ok(/wpStepLinkWrite\(p, st, \{ week, day, slot \}\)/.test(confirm) && !/projectItems/.test(confirm),
      "a pull writes the step's week, day and time — and nothing into the week");
  }

  /* =====================================================================
     7. BUFFER → PROJECT
     ===================================================================== */
  {
    const plan = emptyWeek(NEXT);
    plan.bufferItems = [{ id: "b1", title: "Ring the accountant about VAT", done: false },
                        { id: "b2", title: "Something else", done: false }];
    plan.placements = { "1-3:wed": ["buffer:b1"] };
    const b = await boot({ projects: [PROJECT()], plans: { [NEXT]: plan } });
    await b.ctx.loadWeeklyPlan(NEXT);
    assert.ok(/class="wp-to-proj"/.test(b.ctx.document.getElementById("wpBody").innerHTML), "each Buffer task has a → project control");
    await b.ctx.wpBufferToProject("b1", "p1");
    await b.settle();
    const made = b.projects[0].steps.find((s) => s.title === "Ring the accountant about VAT");
    assert.ok(made, "the task is now a step on the chosen project");
    assert.strictEqual(made.col, "todo", "…in its To do column");
    assert.ok(!made.due && !made.notes, "…title only");
    const S = b.ctx.__wpState.plan;
    assert.deepStrictEqual(S.bufferItems.map((i) => i.id), ["b2"], "…and it has left the buffer");
    assert.ok(!(S.placements["1-3:wed"] || []).includes("buffer:b1"), "…and the grid");
    const sent = b.posts.find((p) => p.body && p.body.addStep);
    assert.deepStrictEqual(Object.keys(sent.body.addStep).sort(), ["id", "projectId", "title"], "it sends a title and nothing else");
    const add = bodyOf(WJS, "wpBufferToProject");
    assert.ok(add.indexOf("addStep") < add.indexOf("bufferItems.splice"),
      "the board is written FIRST — the buffer task only goes once the step is safely there");
  }

  /* =====================================================================
     8. THE STORE: stepLink takes { done, due, week, day, slot }; addStep adds one step
     ===================================================================== */
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bodysculpt-v227-"));
    fs.mkdirSync(path.join(dir, "lib")); fs.mkdirSync(path.join(dir, "functions"));
    fs.writeFileSync(path.join(dir, "lib", "projects.js"),
      read("netlify/lib/projects.js").replace(/^import \{ getStore \} from "@netlify\/blobs";$/m,
        "const getStore = () => globalThis.__fakeStore;"));
    fs.writeFileSync(path.join(dir, "functions", "projects.js"), read("netlify/functions/projects.js"));
    const m = new Map();
    globalThis.__fakeStore = {
      async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
      async set(k, v) { m.set(k, v); },
      async list(o) { const p = (o && o.prefix) || ""; return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })), directories: [] }; },
    };
    const h = (await import("file://" + path.join(dir, "functions", "projects.js") + "?t=" + Date.now())).default;
    const POST = (body) => h(new Request("https://x/.netlify/functions/projects",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    await POST({ project: PROJECT() });
    const link = async (patch) => (await (await POST({ stepLink: Object.assign({ projectId: "p1", stepId: "s_ads" }, patch) })).json()).step;

    let st = await link({ due: "2026-11-04" });
    assert.strictEqual(st.due, "2026-11-04", "stepLink moves a due date");
    st = await link({ due: "not a date" });
    assert.strictEqual(st.due, "", "…and a date that is not one clears it rather than being stored");
    st = await link({ done: true, due: "2026-10-28", week: "2026-10-26", day: "wed", slot: "10-12" });
    assert.deepStrictEqual([st.done, st.due, st.week, st.day, st.slot, st.col], [true, "2026-10-28", "2026-10-26", "wed", "10-12", "done"],
      "it takes done, due, week, day and slot together");
    st = await link({ week: "2026-10-26", day: "thu", slot: "" });
    assert.deepStrictEqual([st.day, st.slot], ["thu", ""], "a day with no time is kept as Anytime, not guessed as 6–9");
    const stored = JSON.parse(m.get("proj-p1")).steps.find((s) => s.id === "s_ads");
    assert.deepStrictEqual([stored.done, stored.due, stored.week, stored.day, stored.slot], [true, "2026-10-28", "2026-10-26", "thu", ""],
      "cleanStep keeps every one of them through the save");

    // the boundary: still not the title, notes, urgency or stage
    const before = m.get("proj-p1");
    const r = await (await POST({ stepLink: { projectId: "p1", stepId: "s_ads", title: "HACKED", notes: "x", urgency: "low", col: "todo" } })).json();
    assert.strictEqual(r.unchanged, true, "nothing else on the step is reachable");
    assert.strictEqual(m.get("proj-p1"), before, "…and nothing is written");

    // addStep
    let a = await (await POST({ addStep: { projectId: "p1", title: "Ring the accountant", id: "s_tb1" } })).json();
    assert.strictEqual(a.step.title, "Ring the accountant", "addStep adds a step");
    assert.strictEqual(a.step.col, "todo", "…in To do");
    a = await (await POST({ addStep: { projectId: "p1", title: "Ring the accountant", id: "s_tb1" } })).json();
    assert.strictEqual(a.unchanged, true, "…and a retry with the same id does not make two");
    const p = JSON.parse(m.get("proj-p1"));
    assert.strictEqual(p.steps.filter((s) => s.title === "Ring the accountant").length, 1, "…one, on the board");
    assert.strictEqual(p.name, "Ads back on & leads worked", "…and nothing else about the project moved");
    assert.strictEqual((await POST({ addStep: { projectId: "nope", title: "x" } })).status, 404, "an unknown project is a 404");
  }

  /* =====================================================================
     9. THE DAILY PAGE MATCHES BY ID, AND TICKS THE STEP
     ===================================================================== */
  {
    assert.ok(!/fmStepForPlanned/.test(bare(DJS)), "the title-match fallback is gone");
    assert.ok(/\["any",\s*"Anytime"/.test(DJS), "the daily page knows the Anytime row");
    assert.ok(/if \(tgt && tgt\.p\) return fmTickStep\(/.test(bodyOf(DJS, "tickTask")),
      "a project step's tick on the daily page goes to the step");
    const afd = bodyOf(DJS, "agendaForDay");
    assert.ok(/agendaStepOf\(row\)/.test(afd) && /f\.step\.done/.test(afd),
      "an agenda row for a step reads its title and done-state live from the project list");
  }

  /* =====================================================================
     10. THE BOARD WRITES NO WEEK
     ===================================================================== */
  {
    const pb = bare(PJS);
    assert.ok(!/kpi-store|weeklyPlan|weeklyAgenda|readWeek|syncWeekDone|reconcileWeek/.test(pb),
      "the projects page has no way into a weekly plan or the daily cache");
  }

  console.log("v227-one-place-for-a-step: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
