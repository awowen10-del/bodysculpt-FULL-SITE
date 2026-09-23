// v217 — type it where it goes.
//
// Ash: "Let's look at the 'weekly calendar' view now. I want to be able to just add tasks in
// the blocks, and that add to the buffer.. you know just one off tasks I can think of?
// Rather than have to type them in the buffer and then move to the calendar."
//
// Two steps became one. A + in the corner of a block opens a box, and what you type becomes
// a BUFFER task placed in that block — which is exactly what typing it into the Buffer list
// and dragging it onto the grid already produced.
//
// THE POINT OF THIS TEST IS THAT IT PRODUCES NOTHING NEW. A task made here has to be the
// same record, in the same two places, saved through the same path — or it is a second kind
// of task that drags differently, ticks differently, rolls over differently and eventually
// disagrees with itself. So the test drives the real function in the real app sandbox and
// then compares what came out against what the old two-step route produces.
const assert = require("assert");
const fs = require("fs");
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

const WEEK = "2026-03-16";                 // a Monday inside NAV_WEEKS
const CELL = "1-3:wed";                    // Wednesday, 12 – 3
const weeklyPosts = (posts) => posts.filter((p) => p.body && p.body.weeklyPlan);
/* Arrays that came out of the app run in the vm's own realm, so their prototype is not this
   one's and deepStrictEqual refuses them however equal they look. Everything read out of the
   sandbox comes through here first — the same thing tests/v89 does. */
const arr = (a) => Array.from(a || []);
const titles = (a) => arr(a).map((i) => i.title);

(async () => {
  /* =====================================================================
     1. IT MAKES A BUFFER TASK, IN THAT BLOCK, AND SAVES IT
     ===================================================================== */
  {
    const { ctx, posts, settle } = await boot({ plans: {} });
    await ctx.loadWeeklyPlan(WEEK);
    const S = ctx.__wpState;
    assert.strictEqual((S.plan.bufferItems || []).length, 0, "the week starts with no buffer tasks");

    await ctx.wpCellAddCommit("1-3", "wed", "Ring the flooring company", false);
    await settle();

    const buf = S.plan.bufferItems;
    assert.strictEqual(buf.length, 1, "one buffer task exists");
    assert.strictEqual(buf[0].title, "Ring the flooring company", "…with what was typed");
    assert.strictEqual(buf[0].done, false, "…not done");
    // THE SHAPE: a buffer task is {id,title,done} and this must not invent a fourth field
    assert.deepStrictEqual(Object.keys(buf[0]).sort(), ["done", "id", "title"],
      "a task typed into a block is the SAME record as one typed into the Buffer list — no extra fields");

    assert.deepStrictEqual(arr(S.plan.placements[CELL]), ["buffer:" + buf[0].id],
      "…and it is placed in the block it was typed into");

    const saved = weeklyPosts(posts).pop().body.weeklyPlan;
    assert.strictEqual(saved.weekEnding, WEEK, "the week it saved is the week on screen");
    assert.deepStrictEqual(titles(saved.bufferItems), ["Ring the flooring company"],
      "the save carries the task");
    assert.deepStrictEqual(arr(saved.placements[CELL]), ["buffer:" + buf[0].id], "…and where it sits");
  }

  /* =====================================================================
     2. THE SAME RECORD THE OLD TWO-STEP ROUTE PRODUCES
     Typed-into-a-block vs typed-into-Buffer-then-dragged. If these two ever stop matching,
     one of them is a second kind of task.
     ===================================================================== */
  {
    const a = await boot({ plans: {} });
    await a.ctx.loadWeeklyPlan(WEEK);
    await a.ctx.wpCellAddCommit("1-3", "wed", "Chase the accountant", false);
    await a.settle();
    const viaCell = a.ctx.__wpState.plan;

    // the long way round: add an empty buffer row, name it, then drop it on the cell
    const b = await boot({ plans: {} });
    await b.ctx.loadWeeklyPlan(WEEK);
    b.ctx.wpAddItem("buffer");
    const made = b.ctx.__wpState.plan.bufferItems[0];
    made.title = "Chase the accountant";
    b.ctx.wpDragStart({ dataTransfer: { setData() {} } }, "buffer", made.id);
    await b.ctx.wpCellDrop({ preventDefault() {}, currentTarget: { classList: { remove() {} } },
      dataTransfer: { getData: () => "" } }, "1-3", "wed");
    await b.settle();
    const viaDrag = b.ctx.__wpState.plan;

    const shape = (p) => ({
      items: arr(p.bufferItems).map((i) => ({ title: i.title, done: i.done, keys: Object.keys(i).sort().join(",") })),
      placed: arr(p.placements[CELL]).map((r) => r.split(":")[0]),
    });
    assert.deepStrictEqual(shape(viaCell), shape(viaDrag),
      "typing into a block produces exactly what typing into Buffer and dragging produces");
    assert.strictEqual(shape(viaCell).placed.length, 1, "…one task, in one place");
  }

  /* =====================================================================
     3. IT ADDS TO WHAT IS THERE, RATHER THAN REPLACING IT
     ===================================================================== */
  {
    const { ctx, settle } = await boot({ plans: {
      [WEEK]: { weekEnding: WEEK,
        bufferItems: [{ id: "b1", title: "Something already in the buffer", done: false }],
        projectItems: [{ id: "p1", title: "A project task", done: false }],
        placements: { [CELL]: ["project:p1"] } },
    } });
    await ctx.loadWeeklyPlan(WEEK);
    const S = ctx.__wpState;
    await ctx.wpCellAddCommit("1-3", "wed", "A new one-off", false);
    await settle();
    assert.deepStrictEqual(titles(S.plan.bufferItems),
      ["Something already in the buffer", "A new one-off"], "it joins the buffer list, at the end");
    assert.strictEqual(S.plan.placements[CELL][0], "project:p1", "…and what was already in the block stays");
    assert.strictEqual(S.plan.placements[CELL].length, 2, "…with the new one beside it");
    assert.strictEqual(S.plan.projectItems.length, 1, "…and nothing else in the week is touched");
  }

  /* =====================================================================
     4. THE BUTTON, AND WHERE IT IS NOT
     ===================================================================== */
  {
    // every cell is addressable, so the box knows which block it opened in
    assert.ok(/<td class="wp-daycell" data-cell="\$\{key\}"/.test(JS), "every block carries its own address");
    // the Notes row is free text and holds no tasks, so it gets no button
    assert.ok(/const quickAdd = rk==="notes" \? "" :/.test(JS), "the Notes row has no + — it is not a list of tasks");
    assert.ok(/if\(rk === "notes"\) return;/.test(bodyOf(JS, "wpCellAdd")),
      "…and calling it for the Notes row does nothing, whatever calls it");
    assert.ok(/aria-label="Add a task to \$\{wpEsc\(rlbl\)\} on \$\{wpEsc\(dlbl\)\}"/.test(JS),
      "the button says which block it belongs to, for anyone not looking at it");

    // out of the way until wanted, but reachable on a screen with no hover at all
    assert.ok(/\.wp-cell-add\{[^}]*opacity:0/.test(STYLE), "it is invisible until the block is hovered");
    assert.ok(/table\.wp-grid td\.wp-daycell:hover \.wp-cell-add\{opacity:1;\}/.test(STYLE), "…and appears on hover");
    assert.ok(/@media\(hover:none\)\{ \.wp-cell-add\{opacity:\.5;\} \}/.test(STYLE),
      "…and is simply there on a touch screen, which has no hover to offer");
    assert.ok(/\.wp-cell-add:focus-visible\{opacity:1/.test(STYLE), "…and on a keyboard");

    // the typing box: one at a time, Enter keeps going, Escape backs out
    const add = bodyOf(JS, "wpCellAdd");
    assert.ok(/wrap\.insertBefore\(inp, wrap\.querySelector\("textarea"\)\)/.test(add),
      "the box goes above the block's free-text field, where the task will appear");
    assert.ok(/const open = document\.querySelector\("\.wp-cell-new"\);/.test(add), "only one box is ever open");
    assert.ok(/if\(e\.key === "Enter"\)\{ e\.preventDefault\(\); finish\(true\); \}/.test(add), "Enter commits it");
    assert.ok(/if\(e\.key === "Escape"\)\{ e\.preventDefault\(\); settled = true; inp\.remove\(\); \}/.test(add),
      "Escape backs out without writing anything");
    assert.ok(/if\(!title\)\{ inp\.remove\(\); return; \}/.test(add), "…and so does an empty box");
    assert.ok(/inp\.onblur = \(\)=>finish\(false\)/.test(add), "clicking away commits what was typed rather than losing it");
    const commit = bodyOf(JS, "wpCellAddCommit");
    assert.ok(/if\(keepOpen\) wpCellAdd\(rk, dk\);/.test(commit), "Enter opens the next one, in the same block");
    assert.ok(/wpSaveSection\("buffer"\)/.test(commit), "it saves through the buffer section, which carries placements too");
    assert.ok(/wpSyncFromDom\(\);/.test(commit),
      "…after reading the screen, so a half-typed edit somewhere else is not thrown away by the render");
  }

  console.log("v217-type-it-where-it-goes: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
