// v218 — the step says more than its title.
//
// Ash: "When tasks are pulled from projects into the weekly, it would be good to be able to
// see their notes and checklists inside from the weekly view instead of going back to the
// projects all the time?"
// and, a minute later: "when we complete it on the weekly view, by ticking it off, it
// should move it to complete in the project dashboard"
//
// The first is new. The second already worked — v214 sent the tick to the board and v216
// moved the card to the finished stage — but "already works" is a claim, and the only
// honest way to make it is to drive the tick in the real app and look at the board
// afterwards. So this test does that, end to end, in one place.
//
// Nothing is fetched for the panel: the whole project list is already read when the week
// loads. What was missing was a door. And the checklist TICKS from here, because a checklist
// you can read but not tick sends you back to the board to tick it, which is the thing being
// complained about.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { boot } = require("./lib/env.cjs");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const WEEKLY = read("index.html");
const STYLE = WEEKLY.slice(WEEKLY.indexOf("<style>") + 7, WEEKLY.indexOf("</style>"));
const JS = WEEKLY.slice(WEEKLY.lastIndexOf("<script>") + 8, WEEKLY.lastIndexOf("</script>"));
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

const WEEK = "2026-03-16";
const CELL = "1-3:wed";
const arr = (a) => Array.from(a || []);

// a project whose step carries everything a step can carry
const PROJECT = () => ({
  id: "p_ghl", name: "Migrate from Ontraport to GoHighLevel", status: "active", accent: "orange",
  archived: false,
  columns: [{ id: "todo", name: "To do", done: false }, { id: "doing", name: "Doing", done: false },
            { id: "done", name: "Done", done: true }],
  steps: [
    { id: "s_map", title: "Build the tag and custom-field map", col: "doing", urgency: "high",
      due: "2026-03-18", tags: ["data"], notes: "Old name on the left, new name on the right.\nThis is the document the migration is judged against.",
      checklist: [{ id: "c1", text: "Tags", done: true }, { id: "c2", text: "Custom fields", done: false },
                  { id: "c3", text: "Lead sources", done: false }],
      files: [{ id: "f_md", name: "ontraport-audit.md", mime: "text/markdown", size: 900 }],
      done: false, del: false, order: 0, week: "", day: "", slot: "", colBefore: "" },
    { id: "s_bare", title: "A step with nothing on it", col: "todo", urgency: "normal", due: "",
      tags: [], notes: "", checklist: [], files: [],
      done: false, del: false, order: 1, week: "", day: "", slot: "", colBefore: "" },
  ],
  canvas: [],
});
// the two weekly tasks those steps were pulled into
const pulled = (id, stepId) => ({ id, title: stepId === "s_map" ? "Build the tag and custom-field map" : "A step with nothing on it",
  done: false, linkId: "projstep:p_ghl:" + stepId + ":" + WEEK, source: "project-step",
  sourceProjectId: "p_ghl", sourceStepId: stepId, sourceProjectName: "Migrate from Ontraport to GoHighLevel" });

const world = () => ({
  projects: [PROJECT()],
  plans: { [WEEK]: { weekEnding: WEEK,
    projectItems: [pulled("t_map", "s_map"), pulled("t_bare", "s_bare")],
    bufferItems: [{ id: "b1", title: "An ordinary buffer task", done: false }],
    placements: { [CELL]: ["project:t_map"] } } },
});

(async () => {
  /* =====================================================================
     1. THE STEP'S DETAIL IS ALREADY IN HAND — no fetch, just a door
     ===================================================================== */
  {
    const { ctx } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    const S = ctx.__wpState;
    const item = S.plan.projectItems.find((i) => i.id === "t_map");

    const found = ctx.wpStepFor(item);
    assert.ok(found, "the weekly task finds the step it came from");
    assert.strictEqual(found.step.id, "s_map", "…the right step");
    assert.strictEqual(found.project.name, "Migrate from Ontraport to GoHighLevel", "…in the right project");

    const d = ctx.wpStepDetail(item);
    assert.ok(d, "…and there is something worth showing");
    assert.strictEqual(arr(d.list).length, 3, "the checklist came with it");
    assert.strictEqual(d.done, 1, "…with one already ticked");
    assert.ok(d.notes.includes("judged against"), "the notes came with it");
    assert.strictEqual(arr(d.files).length, 1, "and the files");

    // a step with nothing on it offers nothing — no empty panel, no button
    const bare = S.plan.projectItems.find((i) => i.id === "t_bare");
    assert.strictEqual(ctx.wpStepDetail(bare), null,
      "a step with no notes, no checklist and no files has nothing to open");
    assert.strictEqual(ctx.wpStepNoteBtnHtml(bare, false), "", "…so it gets no button on its row");
    assert.strictEqual(ctx.wpStepNoteBtnHtml(bare, true), "", "…and none on its chip");
    // an ordinary buffer task was never pulled from anywhere
    assert.strictEqual(ctx.wpStepFor(S.plan.bufferItems[0]), null, "a task that came from nowhere has no step");

    // the button that does appear says how far through the checklist it is
    const btn = ctx.wpStepNoteBtnHtml(item, false);
    assert.ok(/1\/3/.test(btn), "the row's button shows the checklist's state without opening it");
    assert.ok(/ic-note/.test(ctx.wpStepNoteBtnHtml(item, true)), "the chip's button is just the icon — a chip has no room");
  }

  /* =====================================================================
     2. TICKING A CHECKLIST ITEM FROM THE WEEK REACHES THE BOARD
     ===================================================================== */
  {
    const { ctx, posts, projects, settle } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpOpenStepNotes("t_map");
    assert.strictEqual(ctx.__wpState.stepNotesId, "t_map", "the panel opens on that task");

    await ctx.wpStepCheckToggle("t_map", "c2", true);
    await settle();

    const onBoard = projects[0].steps.find((s) => s.id === "s_map");
    assert.strictEqual(onBoard.checklist.find((c) => c.id === "c2").done, true,
      "the item is ticked ON THE BOARD, not only in the week");
    assert.strictEqual(onBoard.checklist.find((c) => c.id === "c1").done, true, "…and the one already ticked is untouched");
    assert.strictEqual(onBoard.checklist.find((c) => c.id === "c3").done, false, "…and the one that was not, is not");
    assert.strictEqual(onBoard.done, false, "ticking a checklist item does not finish the step");
    assert.strictEqual(onBoard.col, "doing", "…nor move its card");

    const sent = posts.filter((p) => p.body && p.body.stepLink).pop();
    assert.ok(sent, "it went through the stepLink route");
    assert.deepStrictEqual(sent.body.stepLink.check, { id: "c2", done: true }, "…carrying one item and one boolean");
    assert.ok(!("done" in sent.body.stepLink) && !("week" in sent.body.stepLink),
      "…and nothing else — it cannot finish a step or move it by accident");

    // untick it again
    await ctx.wpStepCheckToggle("t_map", "c2", false);
    await settle();
    assert.strictEqual(projects[0].steps.find((s) => s.id === "s_map").checklist.find((c) => c.id === "c2").done, false,
      "unticking unticks it on the board too");
  }

  /* =====================================================================
     3. "WHEN WE COMPLETE IT ON THE WEEKLY VIEW… IT SHOULD MOVE IT TO
        COMPLETE IN THE PROJECT DASHBOARD"
     Built in v214/v216. Driven here, in the real app, and read off the board.
     ===================================================================== */
  {
    const { ctx, posts, projects, settle } = await boot(world());
    await ctx.loadWeeklyPlan(WEEK);
    const before = projects[0].steps.find((s) => s.id === "s_map");
    assert.strictEqual(before.done, false, "the step starts open");
    assert.strictEqual(before.col, "doing", "…in Doing");

    // tick the chip on the grid, which is where a pulled task is ticked
    await ctx.wpToggleDoneRef("project:t_map", true, "wed");
    await settle();

    const step = projects[0].steps.find((s) => s.id === "s_map");
    assert.strictEqual(step.done, true, "ticking it off in the week finishes it on the board");
    assert.strictEqual(step.col, "done", "…AND moves its card to the finished stage, which is what Ash asked for");
    assert.strictEqual(step.colBefore, "doing", "…remembering where it came from");
    assert.strictEqual(ctx.__wpState.plan.projectItems.find((i) => i.id === "t_map").done, true,
      "…and the week says so too");

    // the week saved its own tick BEFORE telling the board — a board that is down must
    // never cost Ash the tick he just made
    const order = posts.map((p) => (p.body && p.body.weeklyPlan) ? "week" : (p.body && p.body.stepLink) ? "board" : "other");
    assert.ok(order.indexOf("week") >= 0 && order.indexOf("board") >= 0, "both writes happened");
    assert.ok(order.indexOf("week") < order.lastIndexOf("board"), "…the week first");

    // and untick puts the card back rather than stranding it in Done
    await ctx.wpToggleDoneRef("project:t_map", false, "wed");
    await settle();
    const back = projects[0].steps.find((s) => s.id === "s_map");
    assert.strictEqual(back.done, false, "unticking it in the week reopens it on the board");
    assert.strictEqual(back.col, "doing", "…and the card goes back to Doing");
  }

  /* =====================================================================
     4. THE PANEL ITSELF
     ===================================================================== */
  {
    assert.ok(/id="wpStepNotesOverlay"/.test(WEEKLY), "the panel exists");
    assert.ok(/onclick="if\(event\.target===this\)wpCloseStepNotes\(\)"/.test(WEEKLY), "clicking the backdrop closes it");
    assert.ok(/if\(wpStepNotesId\)\{ wpCloseStepNotes\(\); return; \}/.test(JS), "Escape closes it, ahead of the panels it sits over");
    assert.ok(/role="dialog" aria-modal="true" aria-labelledby="wpStepNotesTitle"/.test(WEEKLY),
      "…and it is a dialog, named by the step it is about");
    const render = bodyOf(JS, "wpRenderStepNotes");
    assert.ok(/wpNotesToEditorHtml\(d\.step\.notes\)/.test(render),
      "notes render through the suite's own renderer, so a plain-text note keeps its line breaks and is escaped");
    assert.ok(/Nothing written down for this one\./.test(render), "…and a step with no notes says so rather than showing a gap");
    assert.ok(/Ticking, adding and deleting here all happen on the board too/.test(render),
      "it says that this IS the board's checklist, not a copy of it");
    assert.ok(/The notes are written on the board/.test(render), "…and that the notes are not editable here");
    assert.ok(/\/projects\.html#board/.test(render), "…with the way there");
    assert.ok(/\/\.netlify\/functions\/projects\?file=/.test(render), "a file on the step opens from here");

    // the tick is optimistic, and puts itself back if the board refuses
    const toggle = bodyOf(JS, "wpStepCheckToggle");
    // v222: the request goes through wpStepLink now — one door for every write this panel makes
    assert.ok(toggle.indexOf("c.done = !!checked") < toggle.indexOf("await wpStepLink"),
      "the box moves before the request, so it never feels broken on a phone");
    assert.ok(/c\.done = was;/.test(toggle), "…and goes back if the board would not take it");
    assert.ok(/renderWeeklyPlan\(\);/.test(toggle), "…and the row's counter follows either way");

    // the panel is read-only about everything except the checklist
    assert.ok(!/contenteditable/.test(render), "nothing in the panel is editable — the notes live on the board");
  }

  /* =====================================================================
     5. v222: ADDING AND DELETING CHECKLIST ITEMS, FROM THE WEEK
     Ash: "I need the ability to either delete or add another checklist from there — which
     syncs with the project dashboard."
     This WIDENS the stepLink route, so what it can and cannot reach is restated here rather
     than left to drift.
     ===================================================================== */
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bodysculpt-v222-"));
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
    const link = (patch) => POST({ stepLink: Object.assign({ projectId: "p_ghl", stepId: "s_map" }, patch) });

    // add
    let step = (await (await link({ addCheck: { text: "Lead sources" } })).json()).step;
    assert.strictEqual(step.checklist.length, 4, "an item can be added from the week");
    assert.strictEqual(step.checklist[3].text, "Lead sources", "…at the end, saying what was typed");
    assert.strictEqual(step.checklist[3].done, false, "…not done");
    assert.strictEqual((await (await link({ addCheck: { text: "   " } })).json()).step, null,
      "…and an empty one is not an item");

    // delete, and put back exactly
    const gone = step.checklist[1];
    step = (await (await link({ delCheck: { id: gone.id } })).json()).step;
    assert.strictEqual(step.checklist.length, 3, "an item can be deleted from the week");
    assert.ok(!step.checklist.some((c) => c.id === gone.id), "…the right one");
    step = (await (await link({ addCheck: { id: gone.id, text: gone.text, index: 1 } })).json()).step;
    assert.strictEqual(step.checklist[1].id, gone.id,
      "…and an undo puts back the SAME item, in its place — not a new one saying the same words");
    assert.strictEqual(step.checklist.length, 4, "…once");
    assert.strictEqual((await (await link({ addCheck: { id: gone.id, text: "again" } })).json()).step, null,
      "…and it cannot be put back twice");

    /* THE BOUNDARY, RESTATED. The route reaches a step's done flag, its plan, and its
       checklist. It reaches nothing else about the project — not even on the same step. */
    const before = m.get("proj-p_ghl");
    const r = await link({ title: "HACKED", notes: "HACKED", due: "2030-01-01", urgency: "critical",
      col: "done", tags: ["x"], files: [], name: "HACKED", columns: [], steps: [], canvas: [] });
    assert.strictEqual((await r.json()).unchanged, true, "everything else it might carry changes nothing");
    assert.strictEqual(m.get("proj-p_ghl"), before, "…and does not even write");
    const proj = JSON.parse(m.get("proj-p_ghl"));
    const s2 = proj.steps.find((x) => x.id === "s_map");
    assert.strictEqual(s2.title, "Build the tag and custom-field map", "the step's title is unreachable");
    assert.strictEqual(s2.notes, PROJECT().steps[0].notes, "…its notes");
    assert.strictEqual(s2.due, "2026-03-18", "…its due date");
    assert.strictEqual(s2.urgency, "high", "…its urgency");
    assert.strictEqual(s2.col, "doing", "…its stage");
    assert.strictEqual(proj.name, "Migrate from Ontraport to GoHighLevel", "…and the project's name");

    /* the page's side: on screen first, reverted on refusal, and one door for all of it */
    const add = bodyOf(JS, "wpStepCheckAdd");
    assert.ok(add.indexOf("f.step.checklist.push") < add.indexOf("await wpStepLink"), "an added item appears at once");
    assert.ok(/f\.step\.checklist = f\.step\.checklist\.filter\(c=>c\.id !== id\);/.test(add),
      "…and is taken back off if the board refuses it");
    assert.ok(/if\(again\) again\.focus\(\);/.test(add), "…and the box stays ready for the next one");
    const del = bodyOf(JS, "wpStepCheckDel");
    assert.ok(del.indexOf("splice(i, 1)") < del.indexOf("await wpStepLink"), "a deleted item goes at once");
    assert.ok(/wpToastUndo\(/.test(del), "…with the way back on the confirmation");
    assert.ok(/addCheck:\{ id:gone\.id, text:gone\.text, index:i \}/.test(del),
      "…restoring the same item, in its place");
    assert.ok(/f\.step\.checklist\.splice\(i, 0, gone\);\s*\/\/ the board refused it/.test(del),
      "…and a refusal puts it straight back, because it never really left");
    assert.ok(/id="wpSnNew"/.test(JS) && /wp-sn-ckx/.test(JS), "the panel has an add box and a delete per row");
  }

  console.log("v218-the-step-says-more-than-its-title: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
