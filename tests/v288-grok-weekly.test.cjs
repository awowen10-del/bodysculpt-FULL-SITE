// v288: Grok can go through the Weekly page with Ash. Same rules as Monthly: nothing changes
// without a confirmed second call, every change can be undone, and a write sends only the
// fields it changes so the rest of the week is kept.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const TODAY = "2026-11-08";            // a Sunday: the week of Mon 2 Nov is being closed
const WK = "2026-11-02", NEXT = "2026-11-09";

function fakeApi(over) {
  const log = [];
  const state = {
    projects: [
      { id: "p1", name: "Website move", status: "active", steps: [
        { id: "a", title: "Phone number", due: "2026-11-04", week: WK, day: "wed", slot: "6-9", done: true, updatedAt: "2026-11-04T10:00:00Z" },
        { id: "b", title: "Copy check", due: "", week: NEXT, day: "tue", slot: "" },
        { id: "c", title: "Late one", due: "2026-11-01" },
        { id: "d", title: "Pulled, no day", week: NEXT }] },
    ],
    weeks: {
      [WK]: { weekEnding: WK, projectItems: [{ id: "t1", title: "Call the bank", done: false }], bufferItems: [{ id: "t2", title: "Bins", done: true }],
        placements: { "6-9:mon": ["project:t1"] }, timeBlocks: { "1-3": { fri: "Dentist" } },
        notes: "<!--wp:rich--><div>Old note</div>", foodNotes: "plain food line", review: { wins: "", notDone: "", carryForward: "", blockers: "" },
        reviewChecklist: { training: true } },
      [NEXT]: { weekEnding: NEXT, projects: [], buffer: [], review: { wins: "", notDone: "", carryForward: "", blockers: "" } },
    },
    agendas: { [WK]: { weekEnding: WK, cells: { "6-9:mon": [{ title: "Call the bank", kind: "project", done: false, tgt: { l: "projectItems", k: "t1" } },
      { title: "Weekly Scorecard", kind: "recurring", done: true, tgt: { m: "recurringDone", k: "r1" } }],
      "6-9:wed": [{ title: "Phone number", kind: "project", done: false, tgt: { p: "p1", s: "a" } }] } } },
    month: { ym: "2026-11", focus: [{ id: "f1", title: "Website move", projectId: "p1", goal: "Live by the 20th" }] },
    checkins: { "2026-11-03": { oneThing: "Ring the accountant", oneThingDone: true, habits: { read: true, house: true } },
      "2026-11-05": { oneThing: "Film two reels", oneThingDone: false, habits: { read: true } } },
    undo: [],
    ...over,
  };
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const api = {
    projects: async () => state.projects,
    plan: async () => copy(state.month),
    week: async (wk) => copy(state.weeks[wk] || { weekEnding: wk, projects: [], buffer: [] }),
    saveWeek: async (wk, part) => { log.push(["saveWeek", wk, copy(part)]); state.weeks[wk] = { ...(state.weeks[wk] || {}), ...copy(part) }; },
    agenda: async (wk) => (state.agendas[wk] ? copy(state.agendas[wk]) : null),
    saveAgenda: async (ag) => { log.push(["saveAgenda", ag.weekEnding]); state.agendas[ag.weekEnding] = copy(ag); },
    checkins: async () => state.checkins,
    waiting: async () => [{ title: "Logo files", on: "Gaz" }, { title: "Came back", ready: "2026-11-06" }],
    undoLoad: async () => state.undo,
    undoSave: async (s) => { state.undo = s; },
  };
  return { api, log, state };
}
const writes = (log) => log.filter((l) => l[0] === "saveWeek" || l[0] === "saveAgenda");

(async () => {
  const lib = await import(path.join(root, "netlify/lib/grok-connector.js"));
  const { callTool, handleRpc, TOOLS, INSTRUCTIONS, WEEK_REVIEW_STEPS, appendNotes, notesPlain, stepCell } = lib;

  /* ---------- the review steps are the page's own list ---------- */
  {
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const block = html.match(/const WP_REVIEW_CHECKLIST = \[([\s\S]*?)\];/)[1];
    const page = [...block.matchAll(/id:"([^"]+)",\s*label:"([^"]+)"/g)].map((m) => ({ id: m[1], label: m[2] }));
    assert.deepStrictEqual(WEEK_REVIEW_STEPS, page, "Grok's Sunday review steps match Weekly's");
    const enumIds = TOOLS.find((t) => t.name === "tick_week_review_step").inputSchema.properties.step.enum;
    assert.deepStrictEqual(enumIds, page.map((p) => p.id));
  }

  /* ---------- reading this week ---------- */
  {
    const { api } = fakeApi();
    const t = await callTool("get_week_plan", {}, api, TODAY);
    assert.ok(t.includes("Today is Sunday 2026-11-08") && t.includes("week 2026-11-02"), t);
    assert.ok(t.includes("The month's focus (2026-11): Website move: Live by the 20th"), t);
    assert.ok(t.includes("Mon 2 Nov: 6 to 9: Call the bank, Weekly Scorecard (done)."), t);
    assert.ok(t.includes("Wed 4 Nov: 6 to 9: Phone number (Website move) (done)."), "a step reads live from its board, not the stale cache: " + t);
    assert.strictEqual((t.match(/Phone number/g) || []).length, 1, "the cache's copy of a step is not shown twice");
    assert.ok(t.includes("Fri 6 Nov: 12 to 3: Dentist."), "free text typed on the grid shows");
    assert.ok(t.includes("Tue 3 Nov: nothing planned."), t);
    assert.ok(t.includes("Project list: Call the bank.") && t.includes("Buffer list: Bins (done)."), t);
    assert.ok(t.includes("Overdue project steps: Late one (Website move, was 2026-11-01)."), t);
    assert.ok(t.includes("Waiting on: Logo files, waiting on Gaz.") && !t.includes("Came back"), t);
    assert.ok(t.includes("Notes / Brain Dump: \nOld note") && t.includes("Intentions Around Food: \nplain food line"), t);
    assert.ok(t.includes("Sunday review steps: 1 of 7 done.") && t.includes("(reflect)"), t);
  }

  /* ---------- reading next week, never opened on Weekly ---------- */
  {
    const { api } = fakeApi();
    const t = await callTool("get_week_plan", { week: "2026-11-12" }, api, TODAY);
    assert.ok(t.includes("week 2026-11-09"), "any day names its week");
    assert.ok(t.includes("Tue 10 Nov: any time: Copy check (Website move)."), t);
    assert.ok(t.includes("Project list: Pulled, no day (Website move)."), t);
    assert.ok(t.includes("aren't shown because Weekly hasn't been opened"), "says what it can't see, rather than guessing");
  }

  /* ---------- the review gathers the week ---------- */
  {
    const { api } = fakeApi();
    const t = await callTool("get_week_review", {}, api, TODAY);
    assert.ok(t.includes("Reviewing the week of Mon 2 Nov to Sun 8 Nov"), t);
    assert.ok(t.includes("2 of 3 things on the days were ticked off."), t);
    assert.ok(t.includes("Not ticked off: Call the bank (Mon 2 Nov)."), t);
    assert.ok(t.includes("Project steps finished, 1 in all: Phone number (Website move)."), t);
    assert.ok(t.includes("Tue 3 Nov: Ring the accountant (done). Thu 5 Nov: Film two reels (not done)."), t);
    assert.ok(t.includes("Read 2 of 7, Mobility 0 of 7, House 1 of 7"), t);
    assert.ok(t.includes("No review written yet."), t);
  }

  /* ---------- no confirmed:true, no write ---------- */
  {
    const calls = [
      ["save_week_review", { wins: "Shred launched" }], ["add_week_notes", { notes: "x" }], ["add_food_intentions", { notes: "x" }],
      ["tick_week_review_step", { step: "reflect" }], ["add_week_task", { title: "New job", day: "2026-11-10", slot: "6-9" }],
    ];
    for (const [name, args] of calls) {
      const { api, log } = fakeApi();
      const t = await callTool(name, args, api, TODAY);
      assert.ok(t.startsWith("NOT DONE YET"), name + ": " + t);
      assert.strictEqual(writes(log).length, 0, name + " wrote nothing");
    }
  }

  /* ---------- the review: only the parts given, and undo ---------- */
  {
    const { api, log, state } = fakeApi();
    state.weeks[WK].review.blockers = "kept";
    const t = await callTool("save_week_review", { wins: "Shred launched", notDone: "Reels", confirmed: true }, api, TODAY);
    assert.ok(t.startsWith("Saved"), t);
    assert.deepStrictEqual(Object.keys(log[0][2]), ["review"], "sends the review and nothing else");
    assert.deepStrictEqual(state.weeks[WK].review, { wins: "Shred launched", notDone: "Reels", carryForward: "", blockers: "kept" });
    assert.ok(state.weeks[WK].projectItems.length === 1 && state.weeks[WK].notes.includes("Old note"), "the rest of the week is untouched");
    assert.ok((await callTool("undo_last_change", {}, api, TODAY)).startsWith("Undone"));
    assert.deepStrictEqual(state.weeks[WK].review, { wins: "", notDone: "", carryForward: "", blockers: "kept" });
    await assert.rejects(callTool("save_week_review", { confirmed: true }, api, TODAY), /nothing to save/);
  }

  /* ---------- notes keep their format and what was there ---------- */
  {
    assert.strictEqual(appendNotes("<!--wp:rich--><div>Old</div>", "New <b>\n\nLast"), "<!--wp:rich--><div>Old</div><div>New &lt;b&gt;</div><div><br></div><div>Last</div>");
    assert.strictEqual(appendNotes("line one\n", "two"), "line one\ntwo");
    assert.strictEqual(appendNotes("", "first"), "first");
    assert.strictEqual(notesPlain('<!--wp:rich--><div class="wp-note-todo"><input type="checkbox" checked>Done it</div><ul><li>a</li></ul>'), "[x] Done it\n- a");
    const { api, state } = fakeApi();
    await callTool("add_week_notes", { notes: "Ask Dan about cover", confirmed: true }, api, TODAY);
    assert.strictEqual(state.weeks[WK].notes, "<!--wp:rich--><div>Old note</div><div>Ask Dan about cover</div>");
    await callTool("add_food_intentions", { notes: "No takeaways midweek", confirmed: true }, api, TODAY);
    assert.strictEqual(state.weeks[WK].foodNotes, "plain food line\nNo takeaways midweek");
    await callTool("undo_last_change", {}, api, TODAY);
    assert.strictEqual(state.weeks[WK].foodNotes, "plain food line");
    await callTool("undo_last_change", {}, api, TODAY);
    assert.strictEqual(state.weeks[WK].notes, "<!--wp:rich--><div>Old note</div>");
  }

  /* ---------- ticking a review step ---------- */
  {
    const { api, state } = fakeApi();
    const t = await callTool("tick_week_review_step", { step: "reflect", confirmed: true }, api, TODAY);
    assert.ok(t.includes("2 of 7"), t);
    assert.deepStrictEqual(state.weeks[WK].reviewChecklist, { training: true, reflect: true });
    assert.ok((await callTool("tick_week_review_step", { step: "training", confirmed: true }, api, TODAY)).includes("already"));
    await callTool("undo_last_change", {}, api, TODAY);
    assert.deepStrictEqual(state.weeks[WK].reviewChecklist, { training: true });
    await callTool("tick_week_review_step", { step: "training", done: false, confirmed: true }, api, TODAY);
    assert.deepStrictEqual(state.weeks[WK].reviewChecklist, {});
  }

  /* ---------- adding a job to a week ---------- */
  {
    const { api, log, state } = fakeApi();
    // onto a day of this week, which Today reads from the cache
    let t = await callTool("add_week_task", { title: "Order kettlebells", day: "2026-11-08", slot: "5-8", list: "buffer", confirmed: true }, api, TODAY);
    assert.ok(t.includes("Buffer list") && t.includes("Sun 8 Nov 5 to 8"), t);
    const added = state.weeks[WK].bufferItems.find((x) => x.title === "Order kettlebells");
    assert.ok(added && state.weeks[WK].bufferItems.length === 2, "added beside what was there");
    assert.deepStrictEqual(state.weeks[WK].placements["5-8:sun"], ["buffer:" + added.id]);
    assert.deepStrictEqual(state.weeks[WK].placements["6-9:mon"], ["project:t1"], "other placements kept");
    assert.deepStrictEqual(Object.keys(log[0][2]).sort(), ["bufferItems", "placements"]);
    assert.deepStrictEqual(state.agendas[WK].cells["5-8:sun"], [{ title: "Order kettlebells", kind: "buffer", done: false, tgt: { l: "bufferItems", k: added.id } }]);
    // undo takes out that one job only, even after something else changed
    state.weeks[WK].bufferItems.push({ id: "t9", title: "Typed on the page meanwhile" });
    await callTool("undo_last_change", {}, api, TODAY);
    assert.deepStrictEqual(state.weeks[WK].bufferItems.map((x) => x.id), ["t2", "t9"]);
    assert.deepStrictEqual(state.weeks[WK].placements["5-8:sun"], []);
    assert.deepStrictEqual(state.agendas[WK].cells["5-8:sun"], []);
    // next week has no cache yet: nothing is invented for it
    log.length = 0;
    t = await callTool("add_week_task", { title: "Plan Shred week 2", day: "2026-11-10", slot: "10-12", confirmed: true }, api, TODAY);
    assert.ok(t.includes("Project list for the week of Mon 9 Nov"), t);
    assert.ok(!log.some((l) => l[0] === "saveAgenda"), "no half-made cache for a week Weekly hasn't opened");
    // with no day
    t = await callTool("add_week_task", { title: "Think about pricing", week: NEXT, confirmed: true }, api, TODAY);
    assert.ok(t.includes("with no day yet"), t);
  }
  {
    const { api, state } = fakeApi();
    await assert.rejects(callTool("add_week_task", { title: "X", day: "2026-11-10" }, api, TODAY), /What time/);
    await assert.rejects(callTool("add_week_task", { title: "X", day: "2026-11-01", slot: "6-9" }, api, TODAY), /has passed/);
    await assert.rejects(callTool("add_week_task", { title: "X", day: "2026-11-10", slot: "6-9", week: WK }, api, TODAY), /isn't in that week/);
    await assert.rejects(callTool("add_week_task", { title: "call the bank", confirmed: true }, api, TODAY), /already on/);
    state.weeks[WK] = { weekEnding: WK, project: "old free text list" };
    await assert.rejects(callTool("add_week_task", { title: "X", confirmed: true }, api, TODAY), /old format/, "an old-format week is never overwritten");
  }

  /* ---------- where a step sits, the page's rule ---------- */
  assert.deepStrictEqual(stepCell({ due: "2026-11-04", week: WK, day: "wed", slot: "1-3" }, WK), { day: "wed", slot: "1-3" });
  assert.deepStrictEqual(stepCell({ due: "2026-11-05", week: WK, day: "wed", slot: "1-3" }, WK), { day: "thu", slot: "any" }, "a moved date drops its stale time");
  assert.strictEqual(stepCell({ due: "2026-11-12" }, WK), null);

  /* ---------- the connector says it does weeks ---------- */
  {
    const { api } = fakeApi();
    const init = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, api, TODAY);
    assert.ok(init.result.instructions.includes("weekly review") && INSTRUCTIONS.includes("get_week_review"));
    const list = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, api, TODAY);
    for (const n of ["get_week_plan", "get_week_review", "save_week_review", "add_week_notes", "add_food_intentions", "tick_week_review_step", "add_week_task"])
      assert.ok(list.result.tools.some((x) => x.name === n), n);
    const bad = await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_week_plan", arguments: { week: "next" } } }, api, TODAY);
    assert.ok(bad.result.isError && bad.result.content[0].text.includes("YYYY-MM-DD"));
  }

  console.log("v288 grok weekly: all checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
