// v117: a recurring task can carry NOTES of its own — the reminder of what the task
// actually means ("Plan next week's content" wants a list, not a title).
//
// Deliberately quiet: one dim folder glyph beside the task name, which warms up once the
// task actually has something written on it. Clicking it opens the SHARED v70 rich editor
// (bold, bullets, checkboxes) in the same modal shell Today / v93 / v104 use, and saves
// onto the task through the existing wpSaveDefaults — one new optional string on the
// recurring defaults item, on the same blob key. Nothing else about the card moves.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, sleep, expandRecurring } = require("./lib/env.cjs");

const WEEKLY = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const MONTHLY = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const STORE = fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "kpi-store.js"), "utf8");

const WEEK = "2026-08-10";
const MARK = "<!--wp:rich-->";
const FOLDER = 'class="wp-note-folder"';

// Ash's own example, in the vocabulary the editor offers.
const CONTENT_NOTE = MARK + "<b>Plan next week's content</b>" +
  "<ul><li>Pick the 7 posts. 2 attract, 2 nurture, 2 position, 1 convert.</li>" +
  "<li>Write the shot list — who's in it, what's the hook, what needs filming.</li></ul>" +
  '<div class="wp-note-todo"><input type="checkbox" checked>&nbsp;anything not on this list doesn\'t get filmed</div>';
const PLAIN_NOTE = "call the supplier\nthen check stock";          // legacy pre-v70 shape
const EMPTY_RICH = MARK + "<div><br></div><p></p>";                 // looks like content, isn't
const NASTY_NOTE = MARK + '<script>alert(1)</script><img src=x onerror="alert(1)"><b>survives</b>';

const DEFAULTS = () => [
  { id: "r1", title: "Plan next week's content", days: ["mon"], time: "6-9", notes: CONTENT_NOTE },
  { id: "r2", title: "Check the numbers", days: ["fri"], time: "9-12" },
  { id: "r3", title: "Team huddle", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], time: "6-9", notes: PLAIN_NOTE },
  { id: "r4", title: "Deep clean", days: ["tue"], time: "12-3", notes: EMPTY_RICH },
  { id: "r5", title: "Pay the invoices", cadence: "monthly", monthlyRule: { type: "dayOfMonth", day: 1, slot: "6-9" }, time: "6-9", notes: NASTY_NOTE },
];

const html = (env) => env.ctx.document.getElementById("wpBody").innerHTML;
const el = (env, id) => env.ctx.document.getElementById(id);
// one recurring row's markup, by task id
function row(env, id) {
  const h = html(env);
  const i = h.indexOf(`data-rec-id="${id}"`);
  if (i < 0) return "";
  const start = h.lastIndexOf("<div class=", i);
  return h.slice(start, h.indexOf("</div>", h.indexOf('class="wp-txt-del"', i)) + 6);
}

// Open the editor the way a click does — and then do what the browser would: the modal body
// is written with innerHTML, so in a real DOM #wpRecurNotesEd comes into existence holding
// the rendered notes. The stub DOM has no tree, so the editor element is seeded here from
// the markup wpOpenRecurNotes just produced.
function open(env, id) {
  env.ctx.wpOpenRecurNotes(id);
  const body = el(env, "wpRecurNotesBody").innerHTML;
  const m = /id="wpRecurNotesEd"[^>]*>([\s\S]*)<\/div>\s*<div class="wp-anchor-notes-hint">/.exec(body);
  const ed = el(env, "wpRecurNotesEd");
  ed.innerHTML = m ? m[1] : "";
  return ed;
}

async function week(opts) {
  const env = await boot(Object.assign({ defaults: DEFAULTS(), plans: { [WEEK]: { weekEnding: WEEK } } }, opts || {}));
  await env.ctx.loadWeeklyPlan(WEEK);
  await env.settle();
  expandRecurring(env.ctx);
  return env;
}
// the last recurring-defaults POST body, as the store would receive it
const lastDefaults = (env) => {
  const p = env.posts.filter((x) => Array.isArray(x.body.recurringDefaults)).pop();
  return p ? p.body.recurringDefaults : null;
};
const stored = (env, id) => (lastDefaults(env) || []).find((t) => t.id === id) || null;
const item = (env, id) => Array.from(env.ctx.__wpState.defaults).find((t) => t.id === id) || null;

(async () => {
  /* ================= 0. the build stamp ================= */
  assert.ok(/<!-- build v117 · recurring-task-notes -->/.test(MONTHLY),
    "monthly.html stamped v117 · recurring-task-notes");
  assert.ok(WEEKLY.includes("build v117 · recurring-task-notes"), "index.html carries the same stamp");

  /* ================= 1. the folder: on every task, loud only when it holds something ====== */
  {
    const env = await week();
    const h = html(env);

    // weekly tab first — r1/r2/r3(daily)/r4 live across the Weekly and Daily tabs
    assert.strictEqual(env.ctx.__wpState.recurTab, "weekly", "the card opens on Weekly, as before");
    ["r1", "r2", "r4"].forEach((id) => {
      const r = row(env, id);
      assert.ok(r, id + " renders");
      assert.strictEqual((r.match(/wp-rec-notebtn/g) || []).length, 1, id + " has exactly one notes folder");
      assert.ok(r.includes(FOLDER), "…drawn as the folder");
      assert.ok(r.includes(`onclick="wpOpenRecurNotes('${id}')"`), "…which opens that task's notes");
    });
    // it is an inline SVG drawn from currentColor, not a colour emoji CSS can't tint and
    // every platform draws differently
    assert.ok(/<svg class="wp-note-folder"[^>]*>/.test(h) && h.includes('stroke="currentColor"'),
      "the folder is an inline SVG that takes the theme's colour");
    assert.ok(!/[\u{1F4C1}\u{1F4C2}\u{1F5C0}-\u{1F5C4}]/u.test(h), "…not a folder emoji");

    // dim vs lit — real note content is the only thing that lights it up
    assert.ok(/class="wp-rec-notebtn has"/.test(row(env, "r1")), "a task with notes shows a lit folder");
    assert.ok(row(env, "r1").includes('title="Notes for this task"'), "…and says so");
    assert.ok(/class="wp-rec-notebtn"/.test(row(env, "r2")) && !row(env, "r2").includes("notebtn has"),
      "a task with no notes keeps the folder dim");
    assert.ok(row(env, "r2").includes('title="Add notes for this task"'), "…and offers to add some");
    assert.ok(!row(env, "r4").includes("notebtn has"),
      "notes that are only empty rich blocks count as no notes");

    // the other tabs behave identically
    env.ctx.wpRecurSwitchTab("daily");
    assert.ok(/class="wp-rec-notebtn has"/.test(row(env, "r3")), "a daily task's legacy plain notes light it too");
    env.ctx.wpRecurSwitchTab("monthly");
    assert.ok(/class="wp-rec-notebtn has"/.test(row(env, "r5")), "…and a monthly cadence task is no different");
    assert.ok(row(env, "r5").includes("wp-cad-badge"), "…keeping its cadence badge alongside");

    // exactly one dim/lit state per rendered row, and the styling is real
    assert.ok(/\.wp-rec-notebtn\{[^}]*opacity:\.42/.test(WEEKLY), "the folder is faint by default");
    assert.ok(/\.wp-rec-notebtn \.wp-note-folder\{[^}]*fill:none/.test(WEEKLY), "…and an empty outline");
    assert.ok(/\.wp-rec-notebtn\.has\{[^}]*color:var\(--teal\)/.test(WEEKLY), "…taking the recurring teal once used");
    assert.ok(/\.wp-rec-notebtn\.has \.wp-note-folder\{fill:rgba\(var\(--teal-rgb\),\.18\)/.test(WEEKLY),
      "…and filling in, so a task that holds notes reads differently at a glance");
    assert.ok(!/\.wp-rec-notebtn[^}]*#[0-9a-f]{3}/i.test(WEEKLY), "…from tokens, never a literal colour");
  }

  /* ================= 2. it belongs to recurring only ================= */
  {
    const env = await week({ training: [{ id: "t1", title: "Squats", days: ["mon"], time: "6-9" }] });
    const h = html(env);
    assert.strictEqual((h.match(/wp-rec-notebtn/g) || []).length, (h.match(/data-rec-id=/g) || []).length,
      "one folder per recurring row on screen, and not one anywhere else");
    assert.ok(h.includes("Squats") && !/Squats[\s\S]{0,400}wp-rec-notebtn/.test(h),
      "the training list is untouched — no folder there");
    assert.ok(!/wpOpenRecurNotes\('t1'\)/.test(h), "…and no way to open notes on a training item");
  }

  /* ================= 3. opening: the shared editor, sanitised on render ================= */
  {
    const env = await week();
    const ov = el(env, "wpRecurNotesOverlay");
    assert.ok(/<div id="wpRecurNotesOverlay"[^>]*\shidden\b/.test(WEEKLY), "the editor starts hidden");

    open(env, "r1");
    assert.strictEqual(ov.hidden, false, "the editor opens");
    assert.strictEqual(env.ctx.__wpState.recurNotesId, "r1", "…on the task you clicked");
    assert.strictEqual(el(env, "wpRecurNotesTitle").textContent, "Plan next week's content",
      "…titled with that task");
    assert.strictEqual(env.ctx.document.body.style.overflow, "hidden", "…locking the page behind it");

    const body = el(env, "wpRecurNotesBody").innerHTML;
    assert.ok(body.includes('id="wpRecurNotesEd"') && body.includes('contenteditable="true"'),
      "the body holds a real editor");
    assert.ok(body.includes("wp-nt-bar") && body.includes(">•<") && body.includes(">☑<") && body.includes("<b>B</b>"),
      "…with the shared toolbar: bold, bullets, checkboxes");
    assert.ok(body.includes("<b>Plan next week's content</b>"), "bold survives the round-trip");
    assert.ok(body.includes("<li>Pick the 7 posts. 2 attract, 2 nurture, 2 position, 1 convert.</li>"),
      "…bullets survive");
    assert.ok(body.includes('<div class="wp-note-todo"><input type="checkbox" checked>'),
      "…and checkbox lines survive, ticked state and all");
    assert.ok(!body.includes(MARK), "the rich marker never leaks into the editor");

    // a tampered stored value is stripped on the way in
    open(env, "r5");
    const nasty = el(env, "wpRecurNotesBody").innerHTML;
    assert.ok(!/<script/i.test(nasty) && !/onerror/i.test(nasty), "a hostile stored note never reaches the editor");
    assert.ok(nasty.includes("<b>survives</b>"), "…while the real formatting still renders");

    // legacy plain text keeps its exact line structure
    open(env, "r3");
    assert.ok(el(env, "wpRecurNotesBody").innerHTML.includes("call the supplier<br>then check stock"),
      "a legacy plain-text note renders with its line breaks, escaped as before");

    // an id that resolves to nothing opens nothing
    env.ctx.__wpState.recurNotesId = "";
    env.ctx.wpOpenRecurNotes("nope");
    assert.strictEqual(env.ctx.__wpState.recurNotesId, "", "an unresolvable task opens nothing");
  }

  /* ================= 4. writing: onto the task, through the one save path ================= */
  {
    const env = await week();
    open(env, "r2");                     // the task with no notes yet
    const before = env.posts.length;

    // an idle blur must cost nothing
    assert.strictEqual(await env.ctx.wpRecurNotesCommit(), false, "an unchanged editor commits nothing");
    assert.strictEqual(env.posts.length, before, "…and writes nothing");

    el(env, "wpRecurNotesEd").innerHTML = "<b>Bank the week</b><ul><li>reconcile</li></ul>";
    assert.strictEqual(await env.ctx.wpRecurNotesCommit(), true, "an edited editor commits");
    await env.settle();

    const it = item(env, "r2");
    assert.strictEqual(it.notes, MARK + "<b>Bank the week</b><ul><li>reconcile</li></ul>",
      "the notes land on the task itself, in the shared rich format");
    const sent = stored(env, "r2");
    assert.ok(sent, "…and go to the store on the recurring-defaults key");
    assert.strictEqual(sent.notes, it.notes, "…byte-identical to what the task holds");
    assert.deepStrictEqual([sent.id, sent.title, sent.time], ["r2", "Check the numbers", "9-12"],
      "…alongside everything the task already had");
    assert.deepStrictEqual(Array.from(sent.days), ["fri"], "…including its schedule");
    assert.ok(!env.posts.some((p) => p.body.trainingDefaults), "the training key is never touched");
    assert.ok(!env.posts.some((p) => p.body.monthlyPlan), "…nor the monthly record");

    // sanitised on SAVE too — a hostile paste never reaches the store
    el(env, "wpRecurNotesEd").innerHTML = '<script>alert(1)</script><a href="javascript:alert(1)">x</a><i>kept</i>';
    await env.ctx.wpRecurNotesCommit();
    await env.settle();
    assert.strictEqual(item(env, "r2").notes, MARK + "x<i>kept</i>",
      "a pasted script is dropped whole and a link reduced to its text — the shared allowlist, on save");
    assert.ok(!JSON.stringify(lastDefaults(env)).includes("javascript:"), "…and never reaches the store");

    // emptying it removes the field rather than storing a hollow one
    el(env, "wpRecurNotesEd").innerHTML = "<div><br></div>";
    assert.strictEqual(await env.ctx.wpRecurNotesCommit(), true, "clearing the notes is a real change");
    await env.settle();
    assert.ok(!("notes" in item(env, "r2")), "an emptied note drops the field entirely");
    assert.ok(!("notes" in stored(env, "r2")), "…and the store is told so");
    assert.ok(item(env, "r2").title === "Check the numbers", "…while the task itself is untouched");
  }

  /* ================= 5. closing: commits, then catches the folder up ================= */
  {
    const env = await week();
    const ov = el(env, "wpRecurNotesOverlay");

    // opened, read, closed — nothing written, nothing re-rendered
    const before = env.posts.length;
    open(env, "r1");
    await env.ctx.wpCloseRecurNotes();
    await env.settle();
    assert.strictEqual(env.posts.length, before, "opening and closing without editing writes nothing");
    assert.strictEqual(env.ctx.__wpState.recurNotesId, "", "…and the editor is closed");
    assert.strictEqual(env.ctx.document.body.style.overflow, "", "…releasing the page scroll");
    await sleep(260);
    assert.strictEqual(ov.hidden, true, "…with the overlay gone after the fade");

    // now actually write from a task that had nothing, and close
    open(env, "r2");
    assert.ok(!row(env, "r2").includes("notebtn has"), "r2's folder starts dim");
    el(env, "wpRecurNotesEd").innerHTML = "<b>now it has notes</b>";
    await env.ctx.wpCloseRecurNotes();
    await env.settle();
    assert.strictEqual(item(env, "r2").notes, MARK + "<b>now it has notes</b>", "the close committed the edit");
    assert.ok(/class="wp-rec-notebtn has"/.test(row(env, "r2")), "…and the folder lit up without a reload");
    assert.strictEqual(env.ctx.__wpState.recurNotesId, "", "…with the editor closed");

    // a ✕ click blurs the editor first (which already commits), so the close must not
    // double-write — it re-renders because THIS session wrote, not because close ran
    const after = env.posts.length;
    open(env, "r2");
    await env.ctx.wpCloseRecurNotes();
    await env.settle();
    assert.strictEqual(env.posts.length, after, "a second look at the same notes writes nothing again");
  }

  /* ================= 6. ✕ / Esc / backdrop all funnel through one close ================= */
  {
    assert.ok(/<button class="wp-today-close"[^>]*onclick="wpCloseRecurNotes\(\)"/.test(WEEKLY),
      "the editor closes with ✕");
    assert.ok(/id="wpRecurNotesOverlay"[^>]*onclick="if\(event\.target===this\)wpCloseRecurNotes\(\)"/.test(WEEKLY),
      "…and on a backdrop click");
    assert.ok(/if\(wpRecurNotesId\)\{ wpCloseRecurNotes\(\); return; \}/.test(WEEKLY), "…and on Escape");
    assert.ok(WEEKLY.indexOf("if(wpRecurNotesId){ wpCloseRecurNotes(); return; }") <
      WEEKLY.indexOf("if(wpAnchorNotesOpen){ wpCloseAnchorNotes(); return; }"),
      "…Escape reaches it before the Today modal underneath");
    assert.ok(/wpRecurNotesOverlay[\s\S]{0,400}class="wp-today-modal"/.test(WEEKLY),
      "…in the same modal shell as Today, the v93 popup and the v104 viewer");

    // a checkbox ticked inside THIS editor saves through this path, not the weekly notes one
    assert.ok(/else if\(ed\.id === "wpRecurNotesEd"\) wpRecurNotesCommit\(\);/.test(WEEKLY),
      "a tick inside the task notes saves the task, never the weekly notes");
  }

  /* ================= 7. one engine, one writer ================= */
  {
    assert.ok(/function wpRecurNotesBodyHtml[\s\S]*?wpNotesToolbarHtml\("wpRecurNotesEd"\)/.test(WEEKLY),
      "the editor is the SHARED toolbar, not a copy");
    assert.ok(/function wpRecurNotesBodyHtml[\s\S]*?wpNotesToEditorHtml\(it\.notes\)/.test(WEEKLY),
      "…rendering through the shared sanitise-on-render");
    assert.ok(/function wpRecurNotesCommit[\s\S]*?wpNotesFromEditor\(ed\)/.test(WEEKLY),
      "…and saving through the shared sanitise-on-save");
    assert.strictEqual((WEEKLY.match(/function wpSanitizeNotesHtml/g) || []).length, 1,
      "there is still exactly one sanitiser in the page");
    assert.ok(/function wpRecurNotesCommit[\s\S]*?await wpSaveDefaults\(\);/.test(WEEKLY),
      "notes are written by the existing defaults saver — no new save path, no new blob key");
    assert.ok(!/recurringNotes|taskNotes|notesDefaults/.test(WEEKLY), "…and no parallel notes collection");

    // one "does this carry notes?" reader, shared with the v104 anchor
    assert.strictEqual((WEEKLY.match(/function wpHasNotes\(/g) || []).length, 1, "one has-notes reader");
    assert.ok(!/wpAnchorHasNotes/.test(WEEKLY), "…and no second copy left behind");
  }

  /* ================= 8. the store persists it (and bounds it) ================= */
  {
    assert.ok(/if \(typeof t\.notes === "string" && t\.notes\) d\.notes = t\.notes\.slice\(0, 20000\);/.test(STORE),
      "kpi-store whitelists the recurring task's notes — without this it is silently stripped");
    const block = STORE.slice(STORE.indexOf("body.recurringDefaults"), STORE.indexOf("body.trainingDefaults"));
    assert.ok(block.includes("d.notes = t.notes.slice(0, 20000)"), "…inside the recurringDefaults whitelist");
    assert.ok(!STORE.slice(STORE.indexOf("body.trainingDefaults")).slice(0, 900).includes("t.notes"),
      "…and NOT on the training key, which is a separate collection");
  }

  /* ================= 9. notes survive everything else the task can do ================= */
  {
    const env = await week();
    // reschedule it — days/slot rewrite, notes untouched
    await env.ctx.wpSetRecurrence("r1", ["tue", "thu"], "9-12", "recurring");
    await env.settle();
    assert.strictEqual(item(env, "r1").notes, CONTENT_NOTE, "a schedule change never touches the notes");
    assert.strictEqual(stored(env, "r1").notes, CONTENT_NOTE, "…and they are re-sent to the store with it");
    assert.deepStrictEqual(Array.from(stored(env, "r1").days), ["tue", "thu"], "…while the new schedule lands");

    // give it a monthly cadence — the day-set goes, the notes stay
    await env.ctx.wpSetCadence("r1", "monthly", { type: "dayOfMonth", day: 3, slot: "6-9" });
    await env.settle();
    assert.strictEqual(item(env, "r1").notes, CONTENT_NOTE, "a cadence change never touches the notes either");
    assert.strictEqual(stored(env, "r1").notes, CONTENT_NOTE, "…and they persist alongside the rule");
    assert.ok(stored(env, "r1").monthlyRule && !("days" in stored(env, "r1")), "…with the rule replacing the day-set");
    expandRecurring(env.ctx);
    env.ctx.wpRecurSwitchTab("monthly");
    assert.ok(/class="wp-rec-notebtn has"/.test(row(env, "r1")), "…and the folder follows it into its new tab");

    // ticking it done doesn't disturb them
    await env.ctx.wpToggleDoneRef("recurring:r1", true);
    await env.settle();
    assert.strictEqual(item(env, "r1").notes, CONTENT_NOTE, "marking the task done leaves the notes alone");
  }

  /* ================= 10. the weekly plan never holds a copy ================= */
  {
    const env = await week();
    open(env, "r1");
    el(env, "wpRecurNotesEd").innerHTML = "<b>only on the task</b>";
    await env.ctx.wpCloseRecurNotes();
    await env.settle();
    const plan = JSON.stringify(env.ctx.__wpState.plan);
    assert.ok(!plan.includes("only on the task"), "the notes are never copied onto the weekly plan");
    assert.ok(!plan.includes(MARK) || !plan.includes("Plan next week's content"),
      "…the plan holds no copy of the task's notes at all");
    assert.ok(!env.posts.some((p) => p.body.weeklyPlan && JSON.stringify(p.body.weeklyPlan).includes("only on the task")),
      "…and no weekly-plan save ever carries them");
  }

  console.log("v117-recurring-task-notes.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
