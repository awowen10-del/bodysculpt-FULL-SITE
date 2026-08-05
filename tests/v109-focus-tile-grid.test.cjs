// v109: This Month's Focus (and its personal twin, and the Rocks anchor above them) are
// laid out as TILES in a 3-across grid instead of full-width stacked rows.
//
// It is a re-flow and nothing else, so this test is in two halves. The first pins the
// layout that was asked for — three columns, dropping to two then one; a self-contained
// tile with everything stacked down it; equal heights within a row; the note off the tile
// face and behind the v93 popup; the "+ Add" control as the last tile. The second pins
// that every per-item behaviour came through untouched: the Rock link, Done and its
// persistence, Push forward and its provenance marker, the notes popup, add and delete,
// and the section save path — with the same bytes going to the store as before.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, openPlan } = require("./lib/monthly-env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const WEEKLY = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const AUG = "2026-08", SEP = "2026-09";
const ROCKS = [{ title: "Retention above 92%" }, { title: "Open the second studio" }];
const MARK = "<!--wp:rich-->";

const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));
const ruleOf = (sel) => {
  const re = new RegExp("\\n\\s*" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{([^}]*)\\}");
  const m = re.exec(styleOf(HTML));
  assert.ok(m, "stylesheet defines " + sel);
  return m[1];
};
const fRow =(env, id) => env.body.focusRows().find((r) => r.getAttribute("data-focus") === id);
const pRow = (env, id) => env.body.rows().find((r) => r.kind === "prio" && r.getAttribute("data-pid") === id);

const PLAN = () => ({
  ym: AUG,
  focus: [
    { id: "f1", title: "Retention push", rockRef: "1", notes: MARK + "<div>call anyone under 2 visits</div>", done: false },
    { id: "f2", title: "Second trainer", rockRef: "", notes: "", done: true },
    { id: "f3", title: "Pushed one", rockRef: "0", notes: "", done: false, pushedFrom: "2026-07", pushedFromId: "old" },
  ],
  priorities: [
    { id: "p1", title: "Three gym sessions", owner: "Ash", status: "In Progress", notes: "gym at 6" },
    { id: "p2", title: "Evenings off the phone", owner: "", status: "Not Started", notes: "" },
  ],
});
const month = async (plan) => {
  const env = await boot({ plans: { [AUG]: plan || PLAN() }, rocks: ROCKS });
  await openPlan(env, AUG);
  return env;
};

(async () => {
  /* ================= 0. the build stamp ================= */
  // v110 relaxed this from the pinned v109 stamp to "at least v109" — the newest version's
  // test pins the exact stamp, older ones only assert the suite hasn't gone backwards.
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(HTML);
  assert.ok(stamp && Number(stamp[1]) >= 109, "monthly.html stamped v109 or later");
  assert.ok(WEEKLY.includes("build v" + stamp[1] + " · " + stamp[2]), "index.html carries the same stamp");

  /* ================= 1. three across, then two, then one ================= */
  {
    const grid = ruleOf(".mp-tiles");
    assert.ok(/display:grid/.test(grid), "the items are laid out on a grid");
    assert.ok(/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(grid),
      "…three equal columns at full width");
    assert.ok(/minmax\(0,/.test(grid),
      "…with a 0 minimum, or a long <select> option widens its column and the columns stop being equal");

    // the two step-downs, in order, so a tile can never be squeezed to an unusable width
    const style = styleOf(HTML);
    const two = /@media\(max-width:(\d+)px\)\{ \.mp-tiles\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\} \}/.exec(style);
    const one = /@media\(max-width:(\d+)px\)\{ \.mp-tiles\{grid-template-columns:minmax\(0,1fr\);\} \}/.exec(style);
    assert.ok(two, "a narrow desktop drops to two columns");
    assert.ok(one, "a phone drops to one");
    assert.ok(Number(one[1]) < Number(two[1]), "…and the one-column breakpoint is the narrower of the two");

    /* ---- equal height within a row (the v79 idiom) ---- */
    assert.ok(/align-items:stretch/.test(grid),
      "tiles stretch to the height of the tallest in their row, so a short tile leaves no ragged gap");
    const tile = ruleOf(".mp-tiles .mp-item");
    assert.ok(/display:flex/.test(tile) && /flex-direction:column/.test(tile), "a tile is a column…");
    assert.ok(/margin-bottom:0/.test(tile), "…with the stacked row's margin dropped, since the grid owns the gaps");
    assert.ok(/margin-top:auto/.test(ruleOf(".mp-tile-foot")),
      "…and its footer pinned to the bottom, so the controls line up across a stretched row");
  }

  /* ================= 2. one self-contained tile, stacked ================= */
  {
    const env = await month();
    const html = env.body.innerHTML;

    // the grid holds the items and the add control, and nothing else
    assert.ok(html.includes('<div class="mp-tiles">'), "the items render inside the grid");
    const focusGrid = html.slice(html.indexOf("This Month's Focus"), html.indexOf("Personal Priorities"));
    assert.strictEqual((focusGrid.match(/data-focus="/g) || []).length, 3, "one tile per focus item");

    const t = focusGrid.slice(focusGrid.indexOf('data-focus="f1"'));
    const tile = t.slice(0, t.indexOf('data-focus="f2"'));
    // …in the order asked for: title, then the Rock link, then the controls, then the tags
    const at = (s) => { const i = tile.indexOf(s); assert.ok(i >= 0, "the tile carries " + s); return i; };
    const title = at('class="mp-title"'), rock = at("Supports which Rock?"),
      ctl = at('class="mp-tile-ctl"'), tags = at('class="mp-tile-tags"');
    assert.ok(title < rock, "title sits above the Rock dropdown");
    assert.ok(rock < ctl, "…the dropdown above the controls");
    assert.ok(ctl < tags, "…and the tags below them");
    // everything the full-width row carried is still on the tile
    ["mp-done", "mpOpenPushForward('f1')", "mp-note-ico", "mpRemoveFocus(this)"]
      .forEach((c) => assert.ok(tile.includes(c), "the tile keeps " + c));
    assert.ok(!tile.includes('class="mp-fields'), "nothing on the tile is laid out side by side any more");

    // the personal twin is the same tile, with its two selects stacked the same way
    const prioGrid = html.slice(html.indexOf("Personal Priorities"));
    const p = prioGrid.slice(prioGrid.indexOf('data-pid="p1"'));
    const pTile = p.slice(0, p.indexOf('data-pid="p2"'));
    assert.strictEqual((pTile.match(/<div class="mp-f">/g) || []).length, 2,
      "Owner and Status each get their own stacked cell");
    assert.ok(pTile.indexOf("Owner") < pTile.indexOf("Status"), "…in that order");
    assert.ok(!pTile.includes('class="mp-fields'), "…not side by side");
    ["mpOpenPushPersonal('p1')", "mpPushProjectToWeek('p1')", "mp-note-ico", "mpRemovePrio(this)"]
      .forEach((c) => assert.ok(pTile.includes(c), "the personal tile keeps " + c));

    // provenance still shows, on the tile it belongs to
    const pushed = focusGrid.slice(focusGrid.indexOf('data-focus="f3"'));
    assert.ok(/↩ pushed from/.test(pushed.slice(0, pushed.indexOf("</div>\n    </div>"))),
      "a pushed-forward item still wears its marker");
    assert.ok(!focusGrid.slice(0, focusGrid.indexOf('data-focus="f3"')).includes("↩ pushed from"),
      "…and only that one does");

    // the Rock badge follows the link, as before
    assert.ok(tile.includes("↳ Rock 2"), "the Rock badge still names the linked Rock");

    /* ---- the add control is the last tile, not a full-width bar under the grid ---- */
    assert.ok(focusGrid.indexOf("+ Add focus item") > focusGrid.lastIndexOf('data-focus="f3"'),
      "the add tile comes after the items");
    // …and it is emitted INSIDE the grid, which only the source can show unambiguously
    assert.ok(/<div class="mp-tiles">\$\{focusTiles\}<button class="mp-add" onclick="mpAddFocus\(\)">/.test(HTML),
      "the focus add control is a cell of the grid");
    assert.ok(/<div class="mp-tiles">\$\{prTiles\}<button class="mp-add" onclick="mpAddPrio\(\)">/.test(HTML),
      "…and so is the personal one");
    // (v110 sized the add cell to its own content instead of the row — see that test)
    assert.ok(/\.mp-tiles \.mp-add\{/.test(styleOf(HTML)), "…and is styled as a cell of the grid");
    // the empty-state line stays OUT of the grid, or it renders as a lonely third of a row
    const empty = await month(Object.assign(PLAN(), { focus: [], priorities: [] }));
    assert.ok(/mp-rocks-empty">What are the 1–3 things[\s\S]*?<div class="mp-tiles">/.test(empty.body.innerHTML),
      "with no items, the prompt sits above the grid and the add tile is alone in it");
  }

  /* ================= 3. the note is off the tile face ================= */
  {
    const env = await month();
    const html = env.body.innerHTML;

    // lit when the item has a note, quiet when it doesn't — both open the same popup
    assert.ok(!fRow(env, "f1").querySelector("[data-note-ico]").classList.contains("empty"),
      "an item with a note shows a lit 🗒");
    assert.ok(fRow(env, "f2").querySelector("[data-note-ico]").classList.contains("empty"),
      "an item without one shows it quiet…");
    assert.ok(html.includes("mpOpenNotes('f2')"),
      "…still clickable, because it is now the only way to write a first note");
    assert.ok(/data-note-ico[^>]*>🗒</.test(html), "the glyph is the weekly app's 🗒");

    // no note text, and no notes field, anywhere on the face
    const visible = html.replace(/<input type="hidden" data-(ff|pf)="notes"[^>]*>/g, "");
    assert.ok(!visible.includes("call anyone under 2 visits"), "no note text is rendered on a tile");
    assert.ok(!visible.includes("Add notes…"), "no inline notes field is left on a tile");
    assert.ok(!visible.includes("mp-notes-open"), "…the resting control is gone entirely");
    // an empty rich block counts as no note, exactly as the weekly anchor judges it
    const env2 = await month(Object.assign(PLAN(), {
      focus: [{ id: "f1", title: "Blank note", rockRef: "", notes: MARK + "<div><br></div>", done: false }],
    }));
    assert.ok(fRow(env2, "f1").querySelector("[data-note-ico]").classList.contains("empty"),
      "an empty rich block does not count as a note");

    // writing the first note lights the icon without waiting for a redraw
    const env3 = await month();
    env3.ctx.mpOpenNotes("f2");
    env3.ctx.document.getElementById("mpNotesEd").innerHTML = "the first note";
    await env3.ctx.mpSaveNotes();
    await env3.settle();
    assert.ok(!fRow(env3, "f2").querySelector("[data-note-ico]").classList.contains("empty"),
      "the icon lights as soon as the note is saved");
    assert.strictEqual(fRow(env3, "f2").querySelector('[data-ff="notes"]').value,
      env3.ctx.__mpState.plan.focus[1].notes, "…and the hidden field still mirrors the model");
  }

  /* ================= 4. every per-item behaviour survived ================= */
  {
    /* ---- the Rock link round-trips and saves ---- */
    {
      const env = await month();
      assert.strictEqual(fRow(env, "f1").querySelector('[data-ff="rockRef"]').value, "1",
        "the tile's select is set to the linked Rock");
      fRow(env, "f1").querySelector('[data-ff="rockRef"]').value = "0";
      await env.ctx.mpQuickSave();
      await env.settle();
      const saved = env.posts[env.posts.length - 1].body.monthlyPlan.focus;
      assert.strictEqual(saved[0].rockRef, "0", "choosing a Rock still writes immediately (v99)");
      assert.ok(env.body.innerHTML.includes("↳ Rock 1"), "…and the badge redraws with it");
    }

    /* ---- Done ticks, persists and syncs ---- */
    {
      // ticked the way a click does it: the checkbox flips, then onchange fires (the save
      // path re-reads the DOM, so a handler call on its own would write nothing)
      const env = await month();
      fRow(env, "f1").querySelector('[data-ff="done"]').checked = true;
      await env.ctx.mpToggleFocus({ checked: true, closest: () => fRow(env, "f1") });
      await env.settle();
      const saved = env.posts[env.posts.length - 1].body.monthlyPlan.focus;
      assert.strictEqual(saved[0].done, true, "a tick still saves on its own (v98)");
      env.ctx.drawMonthlyPlan();   // the tick toggles the live class; this proves the redraw agrees
      assert.ok(/<div class="mp-item done" data-focus="f1"/.test(env.body.innerHTML),
        "…and the tile carries the done state, so the strike-through and green edge still apply");
    }

    /* ---- push forward: picker opens on the tile, copy lands in the target month ---- */
    {
      const env = await month();
      env.ctx.mpOpenPushForward("f1");
      assert.ok(env.body.innerHTML.includes('class="mp-push"'), "the picker opens under its own tile");
      await env.ctx.mpPushForward("focus", "f1");
      await env.settle();
      const sep = env.plans[SEP];
      assert.ok(sep && sep.focus.length === 1, "the item is copied into the next month");
      assert.strictEqual(sep.focus[0].pushedFrom, AUG, "…carrying its provenance");
      assert.strictEqual(sep.focus[0].done, false, "…with done reset");
      assert.strictEqual(env.ctx.__mpState.plan.focus.length, 3, "…and the original month untouched");
    }

    /* ---- add and delete, on both halves ---- */
    {
      const env = await month();
      env.ctx.mpAddFocus();
      assert.strictEqual(env.ctx.__mpState.plan.focus.length, 4, "the add tile adds an item");
      assert.strictEqual((env.body.innerHTML.match(/data-focus="/g) || []).length, 4, "…and it renders as a tile");
      assert.strictEqual(env.posts.length, 0, "…without writing an empty item (v100)");

      await env.ctx.mpRemoveFocus({ closest: () => fRow(env, "f1") });
      await env.settle();
      const saved = env.posts[env.posts.length - 1].body.monthlyPlan.focus;
      assert.ok(!saved.some((f) => f.id === "f1"), "a delete still commits (v100)");

      const env2 = await month();
      await env2.ctx.mpRemovePrio({ closest: () => pRow(env2, "p1") });
      await env2.settle();
      const savedP = env2.posts[env2.posts.length - 1].body.monthlyPlan.priorities;
      assert.ok(!savedP.some((p) => p.id === "p1"), "…and so does deleting a personal item");
    }

    /* ---- the personal status tick still drives the done state ---- */
    {
      const env = await month();
      pRow(env, "p1").querySelector('[data-pf="status"]').value = "Done";
      await env.ctx.mpPrioStatus({ value: "Done", closest: () => pRow(env, "p1") });
      await env.settle();
      const saved = env.posts[env.posts.length - 1].body.monthlyPlan.priorities;
      assert.strictEqual(saved[0].status, "Done", "the status writes on change");
      env.ctx.drawMonthlyPlan();
      assert.ok(/<div class="mp-item done" data-prio data-pid="p1"/.test(env.body.innerHTML),
        "…and the tile reads as done");
    }
  }

  /* ================= 5. no data change: the same bytes reach the store ============== */
  {
    const env = await month();
    const before = JSON.stringify(env.ctx.__mpState.plan);
    // a full round-trip through the re-flowed DOM must not alter one field
    env.ctx.mpSyncFromDom();
    assert.strictEqual(JSON.stringify(env.ctx.__mpState.plan), before,
      "render → sync → compare is a no-op: the tile exposes exactly the fields the row did");

    await env.ctx.mpSaveSection("focus");
    await env.settle();
    const sent = env.posts[env.posts.length - 1].body.monthlyPlan;
    assert.deepStrictEqual(Object.keys(sent.focus[0]).sort(), ["done", "id", "notes", "rockRef", "title"],
      "a focus item still carries exactly its five fields");
    assert.strictEqual(sent.focus[2].pushedFrom, "2026-07", "…and state-only fields still survive the round-trip");
    assert.strictEqual(sent.focus[0].notes, PLAN().focus[0].notes, "…with the note stored verbatim");

    await env.ctx.mpSaveSection("priorities");
    await env.settle();
    const sentP = env.posts[env.posts.length - 1].body.monthlyPlan.priorities;
    assert.strictEqual(sentP[0].owner, "Ash", "the personal item's owner survives the re-flow");
    assert.strictEqual(sentP[0].status, "In Progress", "…and its status");
    assert.strictEqual(sentP[0].notes, "gym at 6", "…and its note");
  }

  console.log("v109-focus-tile-grid.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
