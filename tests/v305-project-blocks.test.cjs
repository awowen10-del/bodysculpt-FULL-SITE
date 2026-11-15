// v305 — a slot holds one project block, and the steps live inside it.
// v306 — finished jobs can be hidden from the grid; Anytime sits under 5 – 8.
//
// Ash: "I want each slot to answer 'what am I working on?' with one project, and the steps to
// live inside that block, out of the way until I open it."
//
// Runs the page's real functions with stand-ins for the network and the screen.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const DAILY = fs.readFileSync(path.join(__dirname, "..", "daily.html"), "utf8");
function fnOf(SRC, name) {
  const m = new RegExp("\\n(?:async )?function " + name + "\\s*\\(").exec(SRC);
  assert.ok(m, "defines " + name + "()");
  let i = SRC.indexOf("{", m.index + m[0].length - 1), depth = 0, j = i;
  for (; j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}") { depth--; if (!depth) break; }
  }
  return SRC.slice(m.index, j + 1);
}
const fn = (n) => fnOf(HTML, n);

(async () => {
  // ---------- the grid: steps of one project in one cell are one block ----------
  const items = {
    "project:ps-s1": { id: "ps-s1", source: "project-step", sourceProjectId: "p_sops", sourceProjectName: "SOPs", title: "One", done: false },
    "project:ps-s2": { id: "ps-s2", source: "project-step", sourceProjectId: "p_sops", sourceProjectName: "SOPs", title: "Two", done: true },
    "project:ps-m1": { id: "ps-m1", source: "project-step", sourceProjectId: "p_money", sourceProjectName: "Money", title: "Tax", done: false },
    "buffer:b1": { id: "b1", title: "Film a reel" },
  };
  const moves = [], writes = [];
  const placements = { "10-12:mon": ["project:ps-s1", "buffer:b1", "project:ps-s2", "project:ps-m1"] };
  const src = `
    const WP_ANY = "any", WP_LEN_MAX = 12, WP_HALF_PX = 26;
    const WPCAL_BANDS = [["6-9",6,9],["10-12",9,11.5],["1-3",12,15],["5-8",17,20]];
    const WP_TIME_ROWS = [["6-9","6 – 9"],["10-12","9 – 11.30"],["1-3","12 – 3"],["5-8","5 – 8"],["notes","Notes"]];
    let wpPlan = { lengths: {} }, wpGridHideDone = false;
    ${fn("wpIsStepItem")} ${fn("wpCellUnits")} ${fn("wpBlockSteps")} ${fn("wpBlockMoveTo")} ${fn("wpBlockLenKey")}
    ${fn("wpGridUnits")} ${fn("wpRefDoneOn")} ${fn("wpGridRowsWithAnytime")}
    return { wpCellUnits, wpBlockMoveTo, wpGridUnits, wpGridRowsWithAnytime, hide: (v) => { wpGridHideDone = v; } };`;
  const env = new Function("wpResolveRef", "wpEffectivePlacements", "wpStepMoveTo", "wpLenOf", "wpSetLen",
    "renderWeeklyPlan", "wpSaveSection", "wpIsDone", "wpOpenBlocks", src)(
    (r) => items[r] || null, () => placements,
    async (it, time, day) => { moves.push([it.id, time, day]); },
    () => 1, () => false, () => {}, () => {}, (s, it) => !!it.done, new Set());

  const units = env.wpCellUnits(placements["10-12:mon"]);
  assert.deepStrictEqual(units.map((u) => u.kind === "block" ? u.pid + ":" + u.steps.length : u.ref),
    ["p_sops:2", "buffer:b1", "p_money:1"], "one block per project, where its first step sat; other jobs untouched");

  // dragging a block moves every step in it, one write each
  await env.wpBlockMoveTo("p_sops", "10-12:mon", "1-3", "wed");
  assert.deepStrictEqual(moves, [["ps-s1", "1-3", "wed"], ["ps-s2", "1-3", "wed"]], "both SOPs steps moved, Money stayed");
  moves.length = 0;
  await env.wpBlockMoveTo("p_sops", "10-12:mon", "notes", "mon");
  assert.strictEqual(moves.filter((m) => m[1] === "notes").length, 0, "nothing goes into Notes");

  // hide done: a finished loose job and a block's finished steps disappear; an all-done block goes
  env.hide(true);
  const hidden = env.wpGridUnits(placements["10-12:mon"], "mon");
  assert.deepStrictEqual(hidden.map((u) => u.kind === "block" ? u.pid : u.ref), ["p_sops", "buffer:b1", "p_money"],
    "a block with one open step stays");
  items["project:ps-s1"].done = true;
  items["buffer:b1"].done = true;
  assert.deepStrictEqual(env.wpGridUnits(placements["10-12:mon"], "mon").map((u) => u.kind === "block" ? u.pid : u.ref), ["p_money"],
    "done jobs and an all-done block are hidden");

  // Anytime goes in under 5 – 8, above Notes
  assert.deepStrictEqual(env.wpGridRowsWithAnytime(["a", "b", "c", "d", "notes"], "ANY"), "abcdANYnotes",
    "Anytime sits under the last time block");

  // ---------- the store never sees a block ----------
  assert.ok(/function wpIsDerivedRef\(ref\)\{ return \/\^project:ps-\/\.test/.test(HTML), "steps stay derived, so nothing new is saved");

  // ---------- the Daily page: a heading per project block ----------
  const dsrc = `${fnOf(DAILY, "tlSegments")} return tlSegments;`;
  const tlSegments = new Function(dsrc)();
  const S = { project: { name: "SOPs" } };
  const segs = tlSegments([
    { key: "1", source: "plan", tgt: { p: "p_sops", s: "s1" }, cellKey: "10-12:mon", when: "9 – 11.30", step: S, done: false },
    { key: "2", source: "plan", tgt: { l: "buffer", k: "b1" }, cellKey: "10-12:mon", when: "9 – 11.30", done: false },
    { key: "3", source: "plan", tgt: { p: "p_sops", s: "s2" }, cellKey: "10-12:mon", when: "9 – 11.30", step: S, done: true },
    { key: "4", source: "step", projectId: "p_money", done: false, late: 2 },
  ]);
  assert.strictEqual(segs.length, 3, "two SOPs steps under one heading, the buffer job and the late step on their own");
  assert.ok(segs[0].block && segs[0].name === "SOPs" && segs[0].jobs.length === 2 && !segs[0].done, "the SOPs block, not all done");
  assert.ok(/data-tl="hfocus"/.test(fnOf(DAILY, "tlBlockHtml")), "a heading has its own Focus");
  assert.ok(/ftStart\(Number\(el\.dataset\.min\), \{ key: h\.dataset\.hkey, title: h\.dataset\.htitle \}\)/.test(DAILY),
    "…and its timer is named after the project");

  // ---------- v307: hide one job from the grid, kept on the week ----------
  const STORE = fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "kpi-store.js"), "utf8");
  const clean = new Function(`
    const WP_ANY = "any";
    const WP_TIME_ROWS = [["6-9",""],["10-12",""],["1-3",""],["5-8",""],["notes",""]];
    const WP_DAYS = [["mon"],["tue"],["wed"],["thu"],["fri"],["sat"],["sun"]];
    ${fn("wpValidCellKey")} ${fn("wpValidRef")} ${fn("wpCleanHidden")} return wpCleanHidden;`)();
  assert.deepStrictEqual(clean({ "10-12:mon|pblock:p_bf": 1, "6-9:tue|buffer:b1": true, "bad|buffer:b1": 1, "6-9:tue|x:y": 1, "1-3:wed|buffer:b2": 0 }),
    { "10-12:mon|pblock:p_bf": 1, "6-9:tue|buffer:b1": 1 }, "a hidden block or job is kept; junk is dropped");
  assert.ok(/"lengths","hidden"\]/.test(HTML), "hidden saves with the grid");
  assert.ok(/if \("hidden" in incoming\)/.test(STORE), "the store whitelists hidden");
  assert.ok(/hideOut = ck \? wpHideBtnHtml\(ck, ref, isHid, item\.title\)/.test(HTML), "every placed job has its eye");

  console.log("v305 project blocks: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
