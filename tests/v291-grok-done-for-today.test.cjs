// v291: Grok knows about "done for today" (v290).
//
// Ash can say "I've done enough on that today, carry it on Wednesday" and Grok does what the
// button does: the sitting goes on the worked list and the step moves, unfinished. Asked
// what he got done, Grok counts those sittings as done on their day and says what is still
// carrying on. Same rules as every other Grok change: nothing without a confirmed second
// call, and undo_last_change puts it all back.
const assert = require("assert");
const path = require("path");
const root = path.join(__dirname, "..");
const TODAY = "2026-11-09";            // a Monday
const WK = "2026-11-09";

function fakeApi(over) {
  const log = [];
  const state = {
    projects: [{ id: "p1", name: "6 Week Challenge", status: "active", steps: [
      { id: "big", title: "Build the automation", due: "", week: WK, day: "mon", slot: "10-12",
        checklist: Array.from({ length: 31 }, (_, i) => ({ id: "c" + i, text: "x", done: i < 15 })) },
      { id: "fin", title: "Finished one", done: true, week: WK, day: "mon" }] }],
    worked: [],
    undo: [],
    ...over,
  };
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const step = (id) => state.projects[0].steps.find((s) => s.id === id);
  const api = {
    projects: async () => copy(state.projects),
    plan: async () => ({ ym: "2026-11", focus: [] }),
    week: async (wk) => ({ weekEnding: wk, projectItems: [], bufferItems: [] }),
    agenda: async () => null,
    checkins: async () => ({}),
    waiting: async () => [],
    training: async () => [],
    worked: async () => copy(state.worked),
    addWorked: async (rec) => { log.push(["addWorked", copy(rec)]); state.worked.push(copy(rec)); },
    removeWorked: async (id) => { log.push(["removeWorked", id]); state.worked = state.worked.filter((r) => r.id !== id); },
    stepLink: async (l) => { log.push(["stepLink", copy(l)]); if (state.failLink) throw new Error("write failed");
      const s = step(l.stepId); for (const k of ["week", "day", "slot", "due", "done"]) if (k in l) s[k] = l[k]; },
    calendar: async () => {},
    undoLoad: async () => state.undo,
    undoSave: async (s) => { state.undo = s; },
  };
  return { api, log, state, step };
}

(async () => {
  const { callTool, TOOLS, INSTRUCTIONS } = await import(path.join(root, "netlify/lib/grok-connector.js"));

  assert.ok(TOOLS.some((t) => t.name === "done_for_today"), "Grok has the tool");
  assert.ok(/done_for_today/.test(INSTRUCTIONS) && /Only tick_step finishes/.test(INSTRUCTIONS), "…and is told when to use it, and that it does not finish a step");

  /* asking first, then doing it */
  {
    const { api, log, state, step } = fakeApi();
    const ask = await callTool("done_for_today", { project: "6 Week Challenge", stepId: "big", day: "2026-11-11" }, api, TODAY);
    assert.ok(/^NOT DONE YET/.test(ask) && ask.includes("15 of 31") && ask.includes("2026-11-11"), ask);
    assert.strictEqual(log.length, 0, "nothing changes before his yes");

    const done = await callTool("done_for_today", { project: "6 Week Challenge", stepId: "big", day: "2026-11-11", confirmed: true }, api, TODAY);
    assert.ok(/^Saved/.test(done) && /stays open/.test(done), done);
    const rec = state.worked[0];
    assert.deepStrictEqual([rec.date, rec.week, rec.day, rec.slot, rec.check, rec.to], [TODAY, WK, "mon", "10-12", "15 of 31", "2026-11-11"],
      "today's sitting, in the block it was in, with the checklist, carrying on Wednesday");
    assert.deepStrictEqual([step("big").week, step("big").day, step("big").slot, !!step("big").done], [WK, "wed", "10-12", false],
      "the step moves to Wednesday, same time, NOT finished");
    assert.ok(log.findIndex((l) => l[0] === "addWorked") < log.findIndex((l) => l[0] === "stepLink"), "the sitting is written before the step moves");

    /* it shows when he asks */
    const plan = await callTool("get_week_plan", {}, api, TODAY);
    assert.ok(/Mon 9 Nov: .*9 to 11\.30: Build the automation \(6 Week Challenge\), done for today at 15 of 31, carries on Wed 11 Nov \(done\)/.test(plan), plan);
    const review = await callTool("get_week_review", {}, api, TODAY);
    assert.ok(/Worked on but not finished yet: Build the automation \(6 Week Challenge\): worked on Mon 9 Nov, checklist at 15 of 31, carries on Wed 11 Nov\./.test(review), review);
    const proj = await callTool("get_project", { project: "6 Week Challenge" }, api, TODAY);
    assert.ok(/big: Build the automation on 2026-11-11 \(worked on Mon 9 Nov\)/.test(proj), proj);

    /* undo puts it all back */
    const u = await callTool("undo_last_change", {}, api, TODAY);
    assert.ok(/^Undone/.test(u), u);
    assert.deepStrictEqual([step("big").week, step("big").day, step("big").slot], [WK, "mon", "10-12"], "the step is back on Monday");
    assert.strictEqual(state.worked.length, 0, "…and the sitting is gone");
  }

  /* refusals */
  {
    const { api, log } = fakeApi();
    const today = await callTool("done_for_today", { project: "6 Week Challenge", stepId: "big", day: TODAY, confirmed: true }, api, TODAY);
    assert.ok(/another day/.test(today), "carrying on today makes no sense: " + today);
    const fin = await callTool("done_for_today", { project: "6 Week Challenge", stepId: "fin", day: "2026-11-11", confirmed: true }, api, TODAY);
    assert.ok(/already finished/.test(fin), fin);
    const past = await callTool("done_for_today", { project: "6 Week Challenge", stepId: "big", day: "2026-11-01", confirmed: true }, api, TODAY)
      .catch((e) => e.message);   // Grok hears a refusal as the tool's answer (handleRpc)
    assert.ok(/has passed/.test(past), past);
    assert.strictEqual(log.length, 0, "none of those wrote anything");
  }

  /* a step that will not move takes its sitting back */
  {
    const { api, state } = fakeApi({ failLink: true });
    await assert.rejects(callTool("done_for_today", { project: "6 Week Challenge", stepId: "big", day: "2026-11-11", confirmed: true }, api, TODAY));
    assert.strictEqual(state.worked.length, 0, "no tick is left for a job that did not move");
  }

  /* a worked list that will not load costs only its lines */
  {
    const { api } = fakeApi();
    api.worked = async () => { throw new Error("down"); };
    const plan = await callTool("get_week_plan", {}, api, TODAY);
    assert.ok(/Build the automation/.test(plan), "the week still reads");
  }

  console.log("v291 grok done for today: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
