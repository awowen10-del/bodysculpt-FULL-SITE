// v303 — a "Next week" button on undone Project / Buffer rows (and the Overdue strip).
//
// Ash: "a little button next to the job on the buffer that would just move it there
// automatically so I don't have to drag it all away. Also, on the projects that haven't been
// done, just a 'move back a week' button."
//
// Runs the page's real functions with stand-ins for the network and the screen.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
function fn(name) {
  const m = new RegExp("\\n(?:async )?function " + name + "\\s*\\(").exec(HTML);
  assert.ok(m, "the page defines " + name + "()");
  let i = HTML.indexOf("{", m.index + m[0].length - 1), depth = 0, j = i;
  for (; j < HTML.length; j++) {
    if (HTML[j] === "{") depth++;
    else if (HTML[j] === "}") { depth--; if (!depth) break; }
  }
  return HTML.slice(m.index, j + 1);
}
const consts = HTML.match(/const WP_DAYS = .*;/)[0] + "\n" + (HTML.match(/const WP_DAY_OF *=.*;/) || [""])[0];
assert.ok(/WP_DAY_OF/.test(consts), "WP_DAY_OF found");

(async () => {
  const calls = { saved: [], moves: [], stepWrites: [], toasts: [] };
  const src = `${consts}
    let wpWeekEnding = "2026-11-09";
    let wpPlan = { projectItems: [], bufferItems: [], placements: {}, carryItems: [] };
    const wpUid = () => "u" + (++n); let n = 0;
    const wpItemRef = (s, id) => s + ":" + id;
    function mondayOf(d){ const x=new Date(d); const k=(x.getUTCDay()+6)%7; x.setUTCDate(x.getUTCDate()-k); return x; }
    ${fn("wpPlacementOf")} ${fn("wpWeekOfYmd")} ${fn("wpDayOfYmd")} ${fn("wpDateOfDay")} ${fn("wpNextWeekEnding")}
    ${fn("wpYmdAdd")} ${fn("wpStepDateOf")} ${fn("wpCarryItem")} ${fn("wpNextWeekBtnHtml")}
    ${fn("wpCarryFromRow")} ${fn("wpStepToNextWeek")} ${fn("wpCarryReturn")}
    return { get plan(){ return wpPlan; }, wpCarryFromRow, wpStepToNextWeek, wpNextWeekBtnHtml };`;
  const step = { id: "s1", title: "Agree payoff order", due: "2026-11-15", week: "2026-11-09", day: "sun", slot: "eve" };
  const step2 = { id: "s2", title: "Old one", due: "2026-10-20" };          // weeks overdue
  const step3 = { id: "s3", title: "Pulled, no day", week: "2026-11-09", day: "", slot: "" };
  const project = { id: "p1", steps: [step, step2, step3] };
  const env = new Function("wpSyncFromDom", "wpSaveSection", "renderWeeklyPlan", "wpToastUndo", "wpEsc",
    "wpProjItemById", "wpStepFor", "wpStepMoveToDate", "wpStepLinkWrite", src)(
    () => {}, async (k) => { calls.saved.push(k); }, () => {}, (m, undo) => calls.toasts.push({ m, undo }), (x) => String(x),
    (id) => ({ id, sid: id.replace("ps-", "") }),
    (item) => ({ project, step: project.steps.find((s) => s.id === item.sid) }),
    async (id, ymd) => { calls.moves.push([id, ymd]); },
    async (p, st, f) => { calls.stepWrites.push([st.id, f]); Object.assign(st, f); return true; });

  // the buttons
  assert.ok(/wpCarryFromRow\('buffer','b1'\)/.test(env.wpNextWeekBtnHtml("buffer", { id: "b1", title: "Post to Socials" })), "buffer row carries");
  assert.ok(/wpStepToNextWeek\('ps-s1'\)/.test(env.wpNextWeekBtnHtml("project", { id: "ps-s1", title: "x", derived: true, source: "project-step" })), "step row moves the step");
  assert.strictEqual(env.wpNextWeekBtnHtml("project", { id: "w", title: "x", derived: true, source: "project-worked" }), "", "no button on a worked-today row");
  assert.strictEqual(env.wpNextWeekBtnHtml("training", { id: "t", title: "Run" }), "", "not on training");
  assert.strictEqual(env.wpNextWeekBtnHtml("buffer", { id: "e", title: "  " }), "", "not on an empty row");

  // a buffer task goes into the carry tray, off the grid, saved, with Undo
  env.plan.bufferItems.push({ id: "b1", title: "Post to Socials" }, { id: "b2", title: "Keep me" });
  env.plan.placements["aft:sun"] = ["buffer:b1", "buffer:b2"];
  await env.wpCarryFromRow("buffer", "b1");
  assert.deepStrictEqual(env.plan.bufferItems.map((x) => x.id), ["b2"], "only that task left the Buffer");
  assert.deepStrictEqual(env.plan.placements["aft:sun"], ["buffer:b2"], "and its block on the grid");
  assert.strictEqual(env.plan.carryItems.length, 1); assert.strictEqual(env.plan.carryItems[0].title, "Post to Socials");
  assert.deepStrictEqual(calls.saved, ["carry"], "saved the way the drag saves");
  await calls.toasts[0].undo();
  assert.strictEqual(env.plan.carryItems.length, 0, "Undo takes it back out of the tray");
  assert.ok(env.plan.bufferItems.some((x) => x.title === "Post to Socials"), "…and into the Buffer");

  // a project step: same weekday, next week, through the step move
  await env.wpStepToNextWeek("ps-s1");
  assert.deepStrictEqual(calls.moves[0], ["ps-s1", "2026-11-22"], "Sun 15 Nov -> Sun 22 Nov");
  await env.wpStepToNextWeek("ps-s2");
  assert.deepStrictEqual(calls.moves[1], ["ps-s2", "2026-11-17"], "a step weeks overdue lands next week, not in the past");
  await env.wpStepToNextWeek("ps-s3");
  assert.deepStrictEqual(calls.stepWrites[0], ["s3", { week: "2026-11-16", day: "", slot: "" }], "a day-less step goes into next week's list");

  // the page wires it in
  assert.ok(/\$\{done\?"":wpNextWeekBtnHtml\(source, it\)\}/.test(HTML), "on undone Project/Buffer rows");
  assert.ok(/wpNextWeekBtnHtml\("project", it\)/.test(fn("wpOverdueHtml")), "on Overdue rows");
  assert.ok(/await wpCarryItem\(source, id\)/.test(fn("wpCarryDrop")), "the drag and the button share one move");
  console.log("v303 next week button: ok");
})().catch((e) => { console.error(e); process.exit(1); });
