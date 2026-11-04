// v272/v273: the Grok connector. Nothing changes without a confirmed second call, every change
// can be undone, and steps follow the same day rule as the rest of the suite.
const assert = require("assert");
const path = require("path");
const root = path.join(__dirname, "..");
const TODAY = "2026-11-04", YM = "2026-11";

function fakeApi() {
  const log = [];
  const state = {
    projects: [
      { id: "p1", name: "Website move", status: "active", steps: [
        { id: "a", title: "Phone number", due: "", week: "", day: "", slot: "" },
        { id: "b", title: "Dated job", due: "2026-11-09", week: "", day: "", slot: "" },
        { id: "c", title: "Done job", done: true },
        { id: "x", title: "Deleted", del: true }] },
      { id: "p2", name: "Christmas Shred", status: "active", steps: [{ id: "s", title: "Only step" }] },
      { id: "p3", name: "Old thing", status: "active", archived: true, steps: [] },
    ],
    plan: { ym: YM, focus: [{ id: "f0", title: "Typed", notes: "keep", rockRef: "", done: false }] },
    undo: [],
  };
  const api = {
    projects: async () => state.projects,
    plan: async () => ({ ...state.plan, focus: state.plan.focus.map((f) => ({ ...f })) }),
    savePlan: async (ym, focus) => { log.push(["savePlan", ym, focus]); state.plan.focus = focus; },
    stepLink: async (l) => { log.push(["stepLink", l]);
      const { projectId, stepId, ...f } = l;
      Object.assign(state.projects.find((p) => p.id === projectId).steps.find((s) => s.id === stepId), f); },
    addStep: async (a) => { log.push(["addStep", a]); const s = { id: a.id, title: a.title, due: "", week: "", day: "", slot: "" };
      state.projects.find((p) => p.id === a.projectId).steps.push(s); return s; },
    createProject: async (name) => { log.push(["createProject", name]); const p = { id: "pn", name, status: "active", steps: [] }; state.projects.push(p); return p; },
    calendar: async (c) => { log.push(["calendar", c]); },
    saveReview: async (ym, r) => { log.push(["saveReview", ym, r]); state.plan.review = r; },
    monthNumbers: async () => ({ ym: "2026-10", signups: 12, cancellations: 3, adSpend: null }),
    askStart: async (t, m) => { log.push(["askStart", t, m]); return "J1"; },
    askJob: async () => state.job,
    undoLoad: async () => state.undo,
    undoSave: async (s) => { state.undo = s; },
  };
  return { api, log, state };
}
const writes = (log) => log.filter((l) => ["savePlan", "stepLink", "addStep", "createProject"].includes(l[0]));

(async () => {
  const { callTool, handleRpc, TOOLS, INSTRUCTIONS, projectsText, findProject, dayFields } = await import(path.join(root, "netlify/lib/grok-connector.js"));

  /* ---------- reading ---------- */
  {
    const { api } = fakeApi();
    const t = await callTool("get_my_projects", {}, api, TODAY);
    assert.ok(t.includes("Website move (Running). 1 of 3 steps done. next: Dated job on 2026-11-09"), t);
    assert.ok(!t.includes("Old thing"), "archived stays out");
    const late = projectsText([{ name: "L", status: "paused", steps: [{ title: "Old", due: "2026-10-30", notes: "PRIVATE" }] }], TODAY);
    assert.ok(late.includes("1 late") && late.includes("late, was 2026-10-30") && !late.includes("PRIVATE"), late);
    const m = await callTool("get_month_plan", {}, api, TODAY);
    assert.ok(m.includes("Not on the month: Website move, Christmas Shred"), m);
    const p = await callTool("get_project", { project: "website" }, api, TODAY);
    assert.ok(p.includes("b: Dated job on 2026-11-09") && p.includes("a: Phone number, no day yet") && !p.includes("Deleted"), p);
  }

  /* ---------- finding a project ---------- */
  assert.throws(() => findProject([{ id: "1", name: "Ads one" }, { id: "2", name: "Ads two" }], "ads"), /could be/);
  assert.throws(() => findProject([{ id: "1", name: "Ads" }], "nothing"), /no project called/);

  /* ---------- no confirmed:true, no write, for every tool that changes something ---------- */
  {
    const calls = [
      ["add_project_to_month", { project: "Website move" }], ["create_project", { name: "New one" }],
      ["add_step", { project: "Website move", title: "New step" }], ["set_step_day", { project: "Website move", stepId: "a", day: "2026-11-10" }],
      ["tick_step", { project: "Website move", stepId: "a" }],
    ];
    for (const [name, args] of calls) {
      const { api, log } = fakeApi();
      const t = await callTool(name, args, api, TODAY);
      assert.ok(t.startsWith("NOT DONE YET"), name);
      assert.strictEqual(writes(log).length, 0, name + " wrote nothing");
    }
    const writers = TOOLS.filter((t) => !t.annotations.readOnlyHint && !["ask_claude_for_plan", "undo_last_change"].includes(t.name));
    assert.ok(writers.every((t) => t.inputSchema.properties.confirmed), "every writer takes confirmed");
    assert.ok(/Never set confirmed true on your own say-so/.test(INSTRUCTIONS));
  }

  /* ---------- a month's list is kept ---------- */
  {
    const { api, state } = fakeApi();
    const t = await callTool("add_project_to_month", { project: "Website move", goal: "Moved", confirmed: true }, api, TODAY);
    assert.ok(t.startsWith("Saved"), t);
    assert.strictEqual(state.plan.focus.length, 2);
    assert.strictEqual(state.plan.focus[0].notes, "keep", "what was there stays");
    assert.strictEqual(state.plan.focus[1].projectId, "p1");
    assert.strictEqual(state.plan.focus[1].goal, "Moved");
    assert.ok((await callTool("add_project_to_month", { project: "Website move", confirmed: true }, api, TODAY)).includes("already"));
    assert.strictEqual(state.plan.focus.length, 2, "never twice");
    await callTool("undo_last_change", {}, api, TODAY);
    assert.strictEqual(state.plan.focus.length, 1, "undo takes it back off");
  }

  /* ---------- days follow v252 ---------- */
  {
    assert.deepStrictEqual(dayFields({ slot: "6-9" }, "2026-11-18").fields, { week: "2026-11-16", day: "wed", slot: "6-9" });
    const { api, log, state } = fakeApi();
    await callTool("set_step_day", { project: "p1", stepId: "a", day: "2026-11-18", confirmed: true }, api, TODAY);
    const undated = log.find((l) => l[0] === "stepLink")[1];
    assert.ok(undated.day === "wed" && !("due" in undated), "no deadline handed out");
    await callTool("set_step_day", { project: "p1", stepId: "b", day: "2026-11-18", confirmed: true }, api, TODAY);
    assert.strictEqual(state.projects[0].steps[1].due, "2026-11-18", "a dated step's date moves");
    assert.ok(log.some((l) => l[0] === "calendar"), "and its calendar copy");
    await callTool("undo_last_change", {}, api, TODAY);
    assert.strictEqual(state.projects[0].steps[1].due, "2026-11-09", "undo moves it back");
    await assert.rejects(callTool("set_step_day", { project: "p1", stepId: "a", day: "2020-01-01", confirmed: true }, api, TODAY), /has passed/);
    await assert.rejects(callTool("set_step_day", { project: "p1", stepId: "x", day: "2026-11-20", confirmed: true }, api, TODAY), /isn't on/, "a deleted step can't be touched");
  }

  /* ---------- adding, ticking, undoing ---------- */
  {
    const { api, log, state } = fakeApi();
    await callTool("add_step", { project: "p2", title: "Brand new", day: "2026-11-06", confirmed: true }, api, TODAY);
    const made = state.projects[1].steps[1];
    assert.strictEqual(made.week, "2026-11-02");
    await callTool("undo_last_change", {}, api, TODAY);
    assert.strictEqual(made.del, true, "undo soft-deletes, it never removes");
    state.plan.focus.push({ id: "f1", title: "S", projectId: "p2", done: false });
    await callTool("tick_step", { project: "p2", stepId: "s", confirmed: true }, api, TODAY);
    assert.strictEqual(state.plan.focus[1].done, true, "the month's tick follows the project");
    await callTool("undo_last_change", {}, api, TODAY);
    assert.ok(!state.projects[1].steps[0].done, "undo unticks");
    assert.strictEqual(await callTool("undo_last_change", {}, api, TODAY), "There's nothing to undo.");
    assert.ok(!log.some((l) => l[0] === "project"), "a whole project is never sent");
  }

  /* ---------- the monthly review ---------- */
  {
    const { api, log, state } = fakeApi();
    state.projects[0].steps[2].updatedAt = "2026-10-14T10:00:00Z";
    state.plan.review = { wins: "Already here", notDone: "", carryForward: "", blockers: "" };
    const t = await callTool("get_month_review", {}, api, TODAY);
    assert.ok(t.includes("Today is 2026-11-04. Reviewing 2026-10."), "with no month it means last month: " + t);
    assert.ok(t.includes("Done job (Website move)"), "the steps finished are there");
    assert.ok(t.includes("sign-ups 12, cancellations 3") && !t.includes("ad spend"), "and the numbers that exist");
    assert.ok(t.includes("What moved: Already here"), "and what is already written");
    assert.ok((await callTool("get_month_review", { month: "2026-01" }, api, TODAY)).includes("Reviewing 2026-01"));
    assert.ok((await callTool("get_month_review", {}, api, "2026-01-10")).includes("Reviewing 2025-12"), "January looks back to December");
    const first = await callTool("save_month_review", { notDone: "The ads" }, api, TODAY);
    assert.ok(first.startsWith("NOT DONE YET") && !log.some((l) => l[0] === "saveReview"), "nothing saves without a yes");
    await callTool("save_month_review", { notDone: "The ads", confirmed: true }, api, TODAY);
    assert.deepStrictEqual(state.plan.review, { wins: "Already here", notDone: "The ads", carryForward: "", blockers: "" }, "what was there stays");
    await callTool("undo_last_change", {}, api, TODAY);
    assert.strictEqual(state.plan.review.notDone, "", "undo puts the review back");
    await assert.rejects(callTool("save_month_review", { confirmed: true }, api, TODAY), /nothing to save/);
  }

  /* ---------- Claude's plan ---------- */
  {
    const { api, log, state } = fakeApi();
    assert.ok((await callTool("ask_claude_for_plan", { thoughts: "hello" }, api, TODAY)).includes("J1"));
    assert.strictEqual(writes(log).length, 0, "asking saves nothing");
    state.job = { status: "running" };
    assert.ok((await callTool("get_claude_plan", { job: "J1" }, api, TODAY)).includes("still working"));
    state.job = { status: "done", proposal: { month: YM, summary: "S", leftOut: [], question: "Q?", projects: [
      { projectId: "p1", name: "Website move", goal: "G", steps: [{ stepId: "a", title: "Phone number", day: "2026-11-06" }, { stepId: "", title: "Fresh step", day: "2020-01-01" }] },
      { projectId: "", name: "Brand new project", goal: "H", steps: [] }] } };
    const seen = await callTool("get_claude_plan", { job: "J1" }, api, TODAY);
    assert.ok(seen.includes("Nothing is saved yet") && seen.includes("Claude asks: Q?"), seen);
    assert.ok((await callTool("apply_claude_plan", { job: "J1" }, api, TODAY)).startsWith("NOT DONE YET"));
    assert.strictEqual(writes(log).length, 0);
    const t = await callTool("apply_claude_plan", { job: "J1", confirmed: true }, api, TODAY);
    assert.ok(t.startsWith("Saved"), t);
    assert.strictEqual(state.plan.focus.length, 3);
    assert.strictEqual(state.projects[0].steps[0].day, "fri");
    assert.ok(!state.projects[0].steps.find((s) => s.title === "Fresh step").week, "a past day isn't written");
    await callTool("undo_last_change", {}, api, TODAY);
    assert.strictEqual(state.plan.focus.length, 1, "undo clears the month");
    assert.strictEqual(state.projects[0].steps[0].day, "", "and the days");
    assert.strictEqual(state.projects[0].steps.find((s) => s.title === "Fresh step").del, true, "and new steps");
  }

  /* ---------- the protocol ---------- */
  {
    const { api } = fakeApi();
    const rpc = (method, params, id = 1) => handleRpc({ jsonrpc: "2.0", id, method, params }, api, TODAY);
    assert.strictEqual((await rpc("initialize", { protocolVersion: "2025-03-26" })).result.protocolVersion, "2025-03-26");
    assert.strictEqual((await rpc("tools/list")).result.tools.length, TOOLS.length);
    assert.ok((await rpc("tools/call", { name: "get_my_projects" })).result.content[0].text.includes("Shred"));
    assert.strictEqual((await rpc("tools/call", { name: "delete_everything" })).error.code, -32602);
    assert.strictEqual((await rpc("nope")).error.code, -32601);
    assert.strictEqual(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, api, TODAY), null);
    const bad = await rpc("tools/call", { name: "get_project", arguments: { project: "nothing" } });
    assert.ok(bad.result.isError && bad.result.content[0].text.includes("no project called"), "a mistake is said plainly");
    const broke = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_my_projects" } }, { projects: async () => { throw new Error("secret detail"); } }, TODAY);
    assert.ok(broke.result.isError && !broke.result.content[0].text.includes("secret detail"), "a crash doesn't leak its detail");
  }
  console.log("v272-grok-connector.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
