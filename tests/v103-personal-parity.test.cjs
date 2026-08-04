// v103: the personal (Personal Priorities & Projects) items reach parity with the business
// focus items — done-state that persists and syncs to the weekly anchor (v98's shape),
// push-forward (v90's), and the rich-text notes popup (v93's). One implementation serves
// both kinds; these assertions prove the personal side works AND that the business side is
// untouched by the generalisation.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { boot, openPlan } = require("./lib/monthly-env.cjs");
const { boot: bootWeekly } = require("./lib/env.cjs");

const MONTHLY = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const WEEKLY = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const STORE_SRC = fs.readFileSync(
  path.join(__dirname, "..", "netlify", "functions", "kpi-store.js"), "utf8");

const AUG = "2026-08", SEP = "2026-09", OCT = "2026-10", DEC = "2026-12";
const AUG_WEEK = "2026-08-10", SEP_WEEK = "2026-09-07";
const ROCKS = [{ title: "Retention above 92%" }, { title: "Open the second studio" }];
const MARK = "<!--wp:rich-->";

const plan = () => ({
  ym: AUG,
  focus: [{ id: "f1", title: "Rebuild the onboarding call", rockRef: "1", notes: "with Dan", done: false }],
  priorities: [
    { id: "p1", title: "Redo the garden", owner: "Ash", status: "In Progress", notes: "quotes in" },
    { id: "p2", title: "Book the Italy trip", owner: "", status: "Not Started", notes: "" },
  ],
  notes: "", review: { wins: "", notDone: "", carryForward: "", blockers: "" },
});
const pRow = (env, id) => env.body.rows().filter((r) => r.kind === "prio")
  .find((r) => r.getAttribute("data-pid") === id);
const fRow = (env, id) => env.body.focusRows().find((r) => r.getAttribute("data-focus") === id);
const editor = (env) => env.ctx.document.getElementById("mpNotesEd");

async function month(plans) {
  const env = await boot({ plans: plans || { [AUG]: plan() }, rocks: ROCKS });
  await openPlan(env, AUG);
  return env;
}
// set Status the way a click does: the select changes, then onchange fires
async function setStatus(env, id, value) {
  const row = pRow(env, id);
  row.querySelector('[data-pf="status"]').value = value;
  await env.ctx.mpPrioStatus({ value, closest: () => row });
  await env.settle();
}

(async () => {
  assert.ok(/<!-- build v103 · personal-parity -->/.test(MONTHLY), "monthly.html stamped v103 · personal-parity");
  assert.ok(/build v103 · personal-parity/.test(WEEKLY), "index.html carries the same stamp");

  /* ============ 2. personal done-state: persists on Monthly, shows on Weekly ============ */
  {
    const env = await month();
    assert.strictEqual(env.posts.length, 0, "opening the month writes nothing");

    // Status is this section's done tick — it commits immediately, like the v98 Done toggle
    await setStatus(env, "p1", "Done");
    assert.strictEqual(env.posts.length, 1, "setting Status Done saves itself — no Save press");
    const posted = env.posts[0].body.monthlyPlan;
    assert.deepStrictEqual(Object.keys(posted).sort(), ["priorities", "ym"], "…on the priorities path only");
    assert.strictEqual(posted.priorities[0].status, "Done", "…with the done status");

    // round-trips through a reload
    const back = await boot({ plans: { [AUG]: env.plans[AUG] }, rocks: ROCKS });
    await openPlan(back, AUG);
    const item = back.ctx.__mpState.plan.priorities.find((p) => p.id === "p1");
    assert.strictEqual(item.status, "Done", "…and it is STILL done after a reload");
    assert.ok(/<div class="mp-item done" data-prio data-pid="p1"/.test(back.body.innerHTML),
      "…rendering as done (struck-through title), like a done focus item");
    assert.strictEqual(item.title, "Redo the garden", "the title is untouched");
    assert.strictEqual(item.notes, "quotes in", "the notes are untouched");
    assert.strictEqual(item.owner, "Ash", "the owner is untouched");

    // un-setting persists too
    await setStatus(back, "p1", "In Progress");
    assert.strictEqual(back.plans[AUG].priorities[0].status, "In Progress", "changing it back persists");
    const back2 = await boot({ plans: { [AUG]: back.plans[AUG] }, rocks: ROCKS });
    await openPlan(back2, AUG);
    assert.ok(!/data-pid="p1"[\s\S]{0,40}mp-item done/.test(back2.body.innerHTML), "…and it no longer reads as done");

    /* ---- the weekly anchor reflects it, read-only, from the same record ---- */
    const wk = await bootWeekly({
      defaults: [],
      monthFocus: { "2026-08": [{ id: "f1", title: "Rebuild the onboarding call", done: false }] },
      monthPriorities: {
        "2026-08": [
          { id: "p1", title: "Redo the garden", status: "Done" },
          { id: "p2", title: "Book the Italy trip", status: "In Progress" },
        ],
        "2026-09": [{ id: "s2", title: "September personal", status: "Not Started" }],
      },
      plans: { [AUG_WEEK]: { weekEnding: AUG_WEEK }, [SEP_WEEK]: { weekEnding: SEP_WEEK } },
    });
    await wk.ctx.loadWeeklyPlan(AUG_WEEK);
    await wk.settle();
    let h = wk.ctx.document.getElementById("wpBody").innerHTML;
    const personal = h.slice(h.indexOf('<div class="wp-anchor-col wp-anchor-personal">'), h.indexOf('<div class="wp-top'));
    assert.ok(personal.includes("August personal"), "the weekly anchor has the personal column");
    assert.ok(/wp-anchor-done"><span class="wp-anchor-tick">✓<\/span>Redo the garden/.test(personal),
      "a personal item done on Monthly shows done on the Weekly anchor");
    assert.ok(personal.includes('<li class="wp-anchor-item">Book the Italy trip</li>'),
      "…and a not-done one shows plain");
    assert.ok(!wk.posts.some((p) => p.body.monthlyPlan), "the weekly app never writes the monthly record");

    // correct month for the week being viewed
    await wk.ctx.loadWeeklyPlan(SEP_WEEK);
    await wk.settle();
    h = wk.ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(h.includes("September personal thing") || h.includes("September personal"),
      "a September week resolves September's personal list");
    assert.ok(!h.includes("Redo the garden"), "…and not August's");
  }

  /* ============ 3. push forward on a personal item ============ */
  {
    const env = await month({ [AUG]: plan(), [OCT]: { ym: OCT,
      priorities: [{ id: "o1", title: "Existing October personal", owner: "", status: "Not Started", notes: "" }],
      focus: [{ id: "of1", title: "October business", rockRef: "", notes: "", done: false }], notes: "oct notes" } });

    // the picker: default next month, further months selectable
    env.ctx.mpOpenPushPersonal("p1");
    assert.strictEqual(env.ctx.__mpState.pushOpen.ym, SEP, "the picker defaults to next month");
    assert.strictEqual(env.ctx.__mpState.pushOpen.kind, "priorities", "…on the personal list");
    const pick = env.body.innerHTML;
    assert.ok(/<div class="mp-push" data-push="p1">/.test(pick), "an inline month picker renders on the item");
    assert.ok(pick.includes(">December 2026</option>"), "…offering months further out");
    assert.ok(pick.includes("mpPushForward('priorities','p1')"), "…wired to the personal push");

    env.ctx.mpSetPushTarget({ value: OCT });
    await env.ctx.mpPushForward("priorities", "p1");
    await env.settle();

    const oct = env.plans[OCT].priorities;
    assert.strictEqual(oct.length, 2, "the copy is appended to the chosen month");
    const copy = oct[1];
    assert.strictEqual(copy.title, "Redo the garden", "the copy keeps the title");
    assert.strictEqual(copy.notes, "quotes in", "…and the notes");
    assert.strictEqual(copy.owner, "Ash", "…and the owner");
    assert.strictEqual(copy.status, "Not Started", "…with done-state reset (fresh work that month)");
    assert.strictEqual(copy.pushedFrom, AUG, "…carrying where it came from");
    assert.strictEqual(copy.pushedFromId, "p1", "…and which item");
    assert.strictEqual(copy.rockRef, undefined, "a personal copy has no Rock link");
    assert.notStrictEqual(copy.id, "p1", "the copy is its own item");
    assert.strictEqual(oct[0].title, "Existing October personal", "the target month's own items survive");
    assert.strictEqual(env.plans[OCT].focus.length, 1, "…as does its business focus");
    assert.strictEqual(env.plans[OCT].notes, "oct notes", "…and its notes");
    const push = env.posts.find((p) => p.body.monthlyPlan && p.body.monthlyPlan.ym === OCT);
    assert.deepStrictEqual(Object.keys(push.body.monthlyPlan).sort(), ["priorities", "ym"],
      "the push writes only ym + priorities to the target month");

    // the original stays put, unchanged
    const orig = env.ctx.__mpState.plan.priorities.find((p) => p.id === "p1");
    assert.strictEqual(orig.title, "Redo the garden", "the original is unchanged");
    assert.strictEqual(orig.status, "In Progress", "…including its status");
    assert.strictEqual(orig.pushedFrom, undefined, "…and it is not marked as a copy");
    assert.strictEqual(env.ctx.__mpState.plan.priorities.length, 2, "nothing was moved out of this month");

    // the marker renders in the target month, and survives a sync
    const oe = await boot({ plans: { [OCT]: env.plans[OCT] }, rocks: ROCKS });
    oe.ctx.__mpState.curYm = OCT;
    await oe.ctx.renderMonthlyPlan();
    await oe.settle();
    assert.ok(oe.body.innerHTML.includes("↩ pushed from August 2026"), "the copy shows where it came from");
    oe.ctx.mpSyncFromDom();
    const synced = oe.ctx.__mpState.plan.priorities.find((p) => p.pushedFrom);
    assert.ok(synced, "the provenance survives a DOM round-trip");
    assert.strictEqual(synced.pushedFromId, "p1", "…both fields");

    // de-dupe
    const before = env.posts.filter((p) => p.body.monthlyPlan && p.body.monthlyPlan.ym === OCT).length;
    env.ctx.mpOpenPushPersonal("p1");
    env.ctx.mpSetPushTarget({ value: OCT });
    await env.ctx.mpPushForward("priorities", "p1");
    await env.settle();
    assert.strictEqual(env.plans[OCT].priorities.length, 2, "pushing the same item to the same month twice does not duplicate");
    assert.strictEqual(env.posts.filter((p) => p.body.monthlyPlan && p.body.monthlyPlan.ym === OCT).length, before,
      "…and writes nothing");
    assert.ok(env.ctx.__mpState.pushNote.warn, "…reporting it as a warning");

    // a different month is still allowed
    env.ctx.mpOpenPushPersonal("p1");
    env.ctx.mpSetPushTarget({ value: DEC });
    await env.ctx.mpPushForward("priorities", "p1");
    await env.settle();
    assert.strictEqual(env.plans[DEC].priorities.length, 1, "the same item can go to another month");

    // an untitled item is not pushed
    env.ctx.mpAddPrio();
    const blank = env.ctx.__mpState.plan.priorities[2];
    env.ctx.mpOpenPushPersonal(blank.id);
    env.ctx.mpSetPushTarget({ value: SEP });
    await env.ctx.mpPushForward("priorities", blank.id);
    await env.settle();
    assert.ok(!env.plans[SEP], "an untitled personal item is not pushed");
    assert.ok(env.alerts.some((a) => /title/i.test(a)), "…and the user is told why");
  }

  /* ============ 4. the notes popup on a personal item ============ */
  {
    const env = await month();
    const html = env.body.innerHTML;
    assert.ok(/data-pid="p1"[\s\S]{0,1600}<input type="hidden" data-pf="notes"/.test(html),
      "the stored note stays in the DOM, so the save path is unchanged");
    assert.ok(html.includes("mpOpenNotesPersonal('p1')"), "clicking Notes opens the editor for that item");
    const prev = pRow(env, "p1").querySelector("[data-notes-prev]").textContent;
    assert.strictEqual(prev, "quotes in", "the resting state previews the note");
    assert.ok(/data-pid="p2"[\s\S]{0,1600}Add notes…/.test(html), "an empty note shows the placeholder");

    // open: same modal, same editor, labelled for this side
    env.ctx.mpOpenNotesPersonal("p1");
    assert.strictEqual(env.ctx.__mpState.notesId, "p1", "the modal knows which item it edits");
    assert.strictEqual(env.ctx.document.getElementById("mpNotesOverlay").hidden, false, "the overlay opens");
    assert.strictEqual(env.ctx.document.body.style.overflow, "hidden", "…with the page scroll-locked");
    assert.strictEqual(env.ctx.document.getElementById("mpNotesKicker").textContent, "Personal notes",
      "…labelled as the personal side");
    assert.strictEqual(env.ctx.document.getElementById("mpNotesTitle").textContent, "Redo the garden",
      "…titled with the item");
    // legacy plain text migrates, exactly and once
    assert.strictEqual(editor(env).innerHTML, "quotes in", "an existing plain note renders intact");

    // rich formatting + sanitising, round-tripped through save and reload
    editor(env).innerHTML = '<b>Bold</b><i>it</i><ul><li>one</li></ul>' +
      '<div class="wp-note-todo"><input type="checkbox" checked>&nbsp;done step</div>' +
      '<script>steal()</' + 'script><img src=x onerror="boom()"><a href="javascript:boom()">l</a>';
    env.ctx.mpSaveNotes();
    await env.settle();
    const stored = env.ctx.__mpState.plan.priorities[0].notes;
    assert.ok(stored.indexOf(MARK) === 0, "the note is stored in the rich format");
    ["<b>Bold</b>", "<li>one</li>", '<input type="checkbox" checked>'].forEach((f) =>
      assert.ok(stored.includes(f), "…keeping " + f));
    ["<script", "steal()", "onerror", "javascript:", "<img", "<a "].forEach((bad) =>
      assert.ok(!stored.includes(bad), "sanitised on save: no " + bad));
    const savedPost = env.posts[env.posts.length - 1].body.monthlyPlan;
    assert.deepStrictEqual(Object.keys(savedPost).sort(), ["priorities", "ym"], "saved on the priorities path");
    assert.strictEqual(savedPost.priorities[0].notes, stored, "…with the note in the record");

    // reload
    const back = await boot({ plans: { [AUG]: env.plans[AUG] }, rocks: ROCKS });
    await openPlan(back, AUG);
    back.ctx.mpOpenNotesPersonal("p1");
    const reloaded = editor(back).innerHTML;
    assert.ok(reloaded.includes("<b>Bold</b>") && reloaded.includes("<li>one</li>"), "the rich note reloads");
    assert.ok(reloaded.indexOf(MARK) < 0, "the marker never leaks into the editor");
    // no double-conversion
    assert.ok(!reloaded.includes("&lt;b&gt;"), "an already-converted note is not escaped again");
    const posts = back.posts.length;
    back.ctx.mpSaveNotes();
    await back.settle();
    assert.strictEqual(back.posts.length, posts, "an unchanged note does not re-save");

    // sanitise on render, from a tampered stored value
    const tampered = await boot({ plans: { [AUG]: { ym: AUG, priorities: [
      { id: "p1", title: "X", owner: "", status: "Not Started", notes: MARK + '<b>ok</b><script>bad()</' + 'script>' },
    ], focus: [] } }, rocks: ROCKS });
    await openPlan(tampered, AUG);
    tampered.ctx.mpOpenNotesPersonal("p1");
    assert.ok(!editor(tampered).innerHTML.includes("<script"), "sanitised on render too");
    assert.ok(editor(tampered).innerHTML.includes("<b>ok</b>"), "…while the real content renders");

    // closes the same three ways as the business one
    tampered.ctx.mpCloseNotes();
    assert.strictEqual(tampered.ctx.__mpState.notesId, null, "✕ closes it");
    assert.strictEqual(tampered.ctx.document.body.style.overflow, "", "…releasing the scroll lock");
    tampered.ctx.mpOpenNotesPersonal("p1");
    tampered.fire("keydown", { key: "Escape" });
    assert.strictEqual(tampered.ctx.__mpState.notesId, null, "Escape closes it");
  }

  /* ============ the store whitelists the personal item's new fields ============ */
  {
    const grab = (name) => {
      const start = STORE_SRC.indexOf("function " + name);
      return STORE_SRC.slice(start, STORE_SRC.indexOf("\n}", start) + 2);
    };
    const tStart = STORE_SRC.indexOf("const MONTHLY_PRIORITY_STRINGS");
    const sandbox = { module: {} };
    vm.createContext(sandbox);
    vm.runInContext(grab("validYm") + "\n" + STORE_SRC.slice(tStart, STORE_SRC.indexOf("};", tStart) + 2) +
      "\n" + grab("cleanMonthlyPriorities") +
      "\n;module.exports = { cleanMonthlyPriorities, cap: MONTHLY_PRIORITY_STRINGS.notes };", sandbox);
    const { cleanMonthlyPriorities, cap } = sandbox.module.exports;

    assert.ok(cap >= 20000, "the personal notes cap fits a real rich note");
    const rich = MARK + "<div>" + "a long personal thought. ".repeat(200) + "</div>";
    const out = cleanMonthlyPriorities([
      { id: "p1", title: "T", owner: "Ash", status: "Done", notes: rich,
        pushedFrom: "2026-08", pushedFromId: "src", rockRef: "1", junk: "x" },
      { id: "p2", title: "U", pushedFrom: "nonsense", pushedFromId: "y" },
    ]);
    assert.strictEqual(out[0].notes, rich, "a rich personal note is stored verbatim");
    assert.strictEqual(out[0].pushedFrom, "2026-08", "pushedFrom persists");
    assert.strictEqual(out[0].pushedFromId, "src", "pushedFromId persists");
    assert.strictEqual(out[0].status, "Done", "the done status persists");
    assert.strictEqual(out[0].rockRef, undefined, "a personal item still carries no Rock link");
    assert.strictEqual(out[0].junk, undefined, "unknown fields are still dropped");
    assert.strictEqual(out[1].pushedFrom, undefined, "a malformed marker is dropped");
  }

  /* ============ the business side is untouched by the generalisation ============ */
  {
    const env = await month();
    // v98 done tick
    const row = fRow(env, "f1");
    row.querySelector('[data-ff="done"]').checked = true;
    await env.ctx.mpToggleFocus({ checked: true, closest: () => row });
    await env.settle();
    assert.strictEqual(env.plans[AUG].focus[0].done, true, "the business Done tick still saves itself");

    // v99 Rock link
    fRow(env, "f1").querySelector('[data-ff="rockRef"]').value = "0";
    await env.ctx.mpQuickSave();
    await env.settle();
    assert.strictEqual(env.plans[AUG].focus[0].rockRef, "0", "the Rock link still saves on change");

    // v90 push-forward, via its original entry point
    env.ctx.mpOpenPushForward("f1");
    assert.strictEqual(env.ctx.__mpState.pushOpen.kind, "focus", "the business picker opens on the focus list");
    env.ctx.mpSetPushTarget({ value: OCT });
    await env.ctx.mpPushFocusForward("f1");
    await env.settle();
    const copy = env.plans[OCT].focus[0];
    assert.strictEqual(copy.title, "Rebuild the onboarding call", "the business copy keeps its title");
    assert.strictEqual(copy.rockRef, "0", "…and its Rock link (as just relinked above)");
    assert.strictEqual(copy.done, false, "…with done reset");
    assert.strictEqual(copy.pushedFrom, AUG, "…and provenance");
    assert.ok(!env.plans[OCT].priorities || !env.plans[OCT].priorities.length,
      "a business push writes nothing to the personal list");

    // v93 notes popup, via its original entry point
    env.ctx.mpOpenNotes("f1");
    assert.strictEqual(env.ctx.document.getElementById("mpNotesKicker").textContent, "Focus notes",
      "the business modal is still labelled Focus notes");
    editor(env).innerHTML = "<b>business note</b>";
    env.ctx.mpSaveNotes();
    await env.settle();
    assert.ok(env.plans[AUG].focus[0].notes.includes("<b>business note</b>"), "business notes still save");
    assert.strictEqual(env.plans[AUG].priorities[0].notes, "quotes in", "…without touching the personal note");

    // one implementation, not two: the personal features route through the shared helpers
    assert.ok(/const MP_KINDS = \{/.test(MONTHLY), "there is a single kind table");
    assert.ok(/function mpOpenPushForward\(id\)\{ return mpOpenPush\("focus", id\); \}/.test(MONTHLY),
      "the business push entry point is a wrapper over the shared implementation");
    assert.ok(/function mpOpenNotes\(id\)\{ return mpOpenNotesFor\("focus", id\); \}/.test(MONTHLY),
      "…as is the business notes entry point");
    assert.strictEqual((MONTHLY.match(/function mpSanitizeNotesHtml/g) || []).length, 1,
      "the v70 editor is reused, not forked");
  }

  console.log("v103-personal-parity.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
