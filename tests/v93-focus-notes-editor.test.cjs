// v93 regression: focus-item notes.
//   1) the Rock select and the Notes control are equal-width columns;
//   2) Notes opens a Today-style modal, closing via ✕ / Escape / backdrop;
//   3) the modal runs the v70 rich-text engine — same marker, same allowlist as the weekly
//      app (asserted by running BOTH sanitisers over the same inputs) — sanitising on save
//      and on render, persisting to the monthly-plan record, and migrating legacy plain
//      text exactly once.
// Done state, Rock links and Push forward must be untouched by all of it.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { boot, openPlan } = require("./lib/monthly-env.cjs");
const { boot: bootWeekly } = require("./lib/env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const STORE_SRC = fs.readFileSync(
  path.join(__dirname, "..", "netlify", "functions", "kpi-store.js"), "utf8");

const AUG = "2026-08", OCT = "2026-10";
const ROCKS = [{ title: "Retention above 92%" }, { title: "Open the second studio" }];
const MARK = "<!--wp:rich-->";

const row = (env, id) => env.body.focusRows().find((r) => r.getAttribute("data-focus") === id);
const editor = (env) => env.ctx.document.getElementById("mpNotesEd");
const overlay = (env) => env.ctx.document.getElementById("mpNotesOverlay");

async function withItem(notes, extra) {
  const env = await boot({
    plans: { [AUG]: { ym: AUG, focus: [Object.assign(
      { id: "f1", title: "Retention push", rockRef: "1", notes, done: false }, extra || {})] } },
    rocks: ROCKS,
  });
  await openPlan(env, AUG);
  return env;
}

(async () => {
  /* ---------- 1. build stamp ---------- */
  // Pinned to "v93 or later", not the exact stamp — the stamp moves with every release and
  // the current one is asserted by the newest version's test.
  const stamp = /<!-- build v(\d+) · [a-z0-9-]+ -->/.exec(HTML);
  assert.ok(stamp && Number(stamp[1]) >= 93, "build stamp is v93 or later");

  /* ---------- 2. the field cell can shrink ---------- */
  {
    // v109 turned the two-column field grid into a one-column tile stack, so the pair of
    // equal columns this section used to guard is gone. What survives is the fix underneath
    // it: without min-width:0 a grid item's min-width:auto lets the Rock <select>'s widest
    // option push its cell — and now its whole tile column — wider than its share.
    assert.ok(/\.mp-f\{[^}]*min-width:0/.test(HTML), "a field cell can shrink, so 1fr means 1fr");
    const fields = /\.mp-f\{([^}]*)\}/.exec(HTML)[1];
    assert.ok(!/width:/.test(fields.replace(/min-width:0;?/, "")), "…and is given no fixed width");
    assert.ok(!/\.mp-notes-open/.test(HTML), "the resting notes control is gone from the stylesheet with it");
  }

  /* ---------- 3. resting state is a button that opens the modal ---------- */
  {
    const env = await withItem("");
    const emptyRow = env.body.innerHTML;
    // v109: the note is reached from the tile's 🗒 button, never previewed on the tile face
    assert.ok(/class="mp-note-ico empty" data-note-ico/.test(emptyRow), "an item with no note shows the quiet button");
    assert.ok(!emptyRow.includes("Add notes…"), "…and no placeholder text takes up tile space");
    assert.ok(/onclick="mpOpenNotes\('f1'\)"/.test(emptyRow), "clicking it opens the editor for that item");
    assert.ok(/<input type="hidden" data-ff="notes"/.test(emptyRow),
      "the stored value stays in the DOM, so mpSyncFromDom is unchanged");

    // a long note never reaches the tile at all — only the lit button does
    const long = MARK + "<div>" + "Rebuild the onboarding call end to end. ".repeat(12) + "</div>";
    const env2 = await withItem(long);
    const ico = row(env2, "f1").querySelector("[data-note-ico]");
    assert.ok(ico && !ico.classList.contains("empty"), "an item with a note shows the lit button");
    // the note text is in the tile exactly once — inside the hidden field mpSyncFromDom
    // reads. Strip that, and none of it is left to render.
    const visible = env2.body.innerHTML.replace(/<input type="hidden" data-ff="notes"[^>]*>/g, "");
    assert.ok(!visible.includes("Rebuild the onboarding call"),
      "…and not one word of the note is rendered on the tile face");
    assert.ok(!visible.includes("data-notes-prev"), "…there is no resting preview left at all");

    // opening
    env2.ctx.mpOpenNotes("f1");
    assert.strictEqual(env2.ctx.__mpState.notesId, "f1", "the modal knows which item it is editing");
    assert.strictEqual(overlay(env2).hidden, false, "the overlay is shown");
    assert.strictEqual(env2.ctx.document.body.style.overflow, "hidden", "the page behind is scroll-locked");
    assert.strictEqual(env2.ctx.document.getElementById("mpNotesTitle").textContent, "Retention push",
      "the modal is titled with the focus item");
    assert.ok(editor(env2).innerHTML.includes("Rebuild the onboarding call"), "the note is loaded into the editor");
    assert.ok(env2.ctx.document.getElementById("mpNotesBody").innerHTML.includes('class="mp-nt-bar"'),
      "the rich-text toolbar is present");

    // ✕ / Escape / backdrop all close — and the ✕ carries the same hint as the Today modal
    env2.ctx.mpCloseNotes();
    assert.strictEqual(env2.ctx.__mpState.notesId, null, "✕ closes the modal");
    assert.strictEqual(env2.ctx.document.body.style.overflow, "", "…and releases the scroll lock");
    assert.ok(/<button class="mp-modal-close" title="Close \(Esc\)" onclick="mpCloseNotes\(\)">✕<\/button>/.test(HTML),
      "the ✕ button calls the close path");

    env2.ctx.mpOpenNotes("f1");
    env2.fire("keydown", { key: "Escape" });
    assert.strictEqual(env2.ctx.__mpState.notesId, null, "Escape closes the modal");
    env2.ctx.mpOpenNotes("f1");
    env2.fire("keydown", { key: "a" });
    assert.strictEqual(env2.ctx.__mpState.notesId, "f1", "other keys do not close it");

    // the real backdrop handler, run exactly as the browser would
    const onclick = /<div id="mpNotesOverlay"[^>]*onclick="([^"]+)"/.exec(HTML)[1];
    const handler = vm.runInContext("(function(event){ " + onclick + " })", env2.ctx);
    const ov = overlay(env2);
    handler.call({ notTheOverlay: true }, { target: ov });
    assert.strictEqual(env2.ctx.__mpState.notesId, "f1", "a click inside the modal does not close it");
    handler.call(ov, { target: ov });
    assert.strictEqual(env2.ctx.__mpState.notesId, null, "a backdrop click closes it");

    // modal chrome matches the v67 Today modal
    ["backdrop-filter:blur(7px)", "position:fixed", "z-index:10000"].forEach((d) =>
      assert.ok(new RegExp("\\.mp-modal-overlay\\{[^}]*" + d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(HTML),
        "the overlay declares " + d));
  }

  /* ---------- 4. rich text round-trips through save and reload ---------- */
  {
    const env = await withItem("");
    env.ctx.mpOpenNotes("f1");
    editor(env).innerHTML =
      '<b>Bold</b> <i>italic</i> <u>under</u> <s>struck</s><ul><li>one</li><li>two</li></ul>' +
      '<div class="wp-note-todo"><input type="checkbox" checked>&nbsp;done step</div>' +
      '<div class="wp-note-todo"><input type="checkbox">&nbsp;open step</div>';
    env.ctx.mpSaveNotes();
    await env.settle();

    const stored = env.ctx.__mpState.plan.focus[0].notes;
    assert.ok(stored.indexOf(MARK) === 0, "a rich note is stored with the marker prefix");
    ["<b>Bold</b>", "<i>italic</i>", "<u>under</u>", "<s>struck</s>", "<ul><li>one</li><li>two</li></ul>",
      '<input type="checkbox" checked>', '<div class="wp-note-todo">'].forEach((frag) =>
      assert.ok(stored.includes(frag), "the stored note keeps " + frag));

    // it reached the monthly-plan record on the normal focus section path
    const post = env.posts[env.posts.length - 1].body.monthlyPlan;
    assert.strictEqual(post.ym, AUG, "saved against this month");
    assert.deepStrictEqual(Object.keys(post).sort(), ["focus", "ym"], "…on the focus section path");
    assert.strictEqual(post.focus[0].notes, stored, "the note is in the saved record");
    assert.strictEqual(env.plans[AUG].focus[0].notes, stored, "…and in the stored month");

    // reload from the store: the same note renders back into the editor
    const env2 = await boot({ plans: { [AUG]: env.plans[AUG] }, rocks: ROCKS });
    await openPlan(env2, AUG);
    env2.ctx.mpOpenNotes("f1");
    const reloaded = editor(env2).innerHTML;
    ["<b>Bold</b>", "<li>one</li>", '<input type="checkbox" checked>'].forEach((frag) =>
      assert.ok(reloaded.includes(frag), "after reload the editor still holds " + frag));
    assert.ok(reloaded.indexOf(MARK) < 0, "the marker never leaks into the editor content");

    // an emptied note goes back to plain "" rather than storing empty markup
    env2.ctx.mpOpenNotes("f1");
    editor(env2).innerHTML = "<div><br></div>";
    env2.ctx.mpSaveNotes();
    await env2.settle();
    assert.strictEqual(env2.ctx.__mpState.plan.focus[0].notes, "", "an emptied note stores as blank");

    // ticking a checkbox in the editor saves immediately (a tick is rarely followed by blur)
    const env3 = await withItem(MARK + '<div class="wp-note-todo"><input type="checkbox">&nbsp;step</div>');
    env3.ctx.mpOpenNotes("f1");
    const ed = editor(env3);
    const attrs = {};
    const box = { tagName: "INPUT", type: "checkbox", checked: false,
      hasAttribute: (k) => k in attrs, setAttribute: (k, v) => { attrs[k] = v; },
      removeAttribute: (k) => { delete attrs[k]; }, closest: (s) => ed.closest(s) };
    ed.innerHTML = ed.innerHTML.replace("<input type=\"checkbox\">", "<input type=\"checkbox\" checked>");
    let prevented = false;
    env3.fire("click", { target: box, preventDefault: () => { prevented = true; } });
    await env3.settle();
    assert.ok(prevented, "the editor owns the tick (attribute and property cannot diverge)");
    assert.ok("checked" in attrs, "the tick lands on the checked ATTRIBUTE, which is what innerHTML serialises");
    assert.ok(env3.ctx.__mpState.plan.focus[0].notes.includes('<input type="checkbox" checked>'),
      "a tick is saved without waiting for a blur");
    assert.ok(env3.posts.some((p) => p.body.monthlyPlan), "…through the normal save path");
  }

  /* ---------- 5. sanitising on save AND on render ---------- */
  {
    const env = await withItem("");
    env.ctx.mpOpenNotes("f1");
    editor(env).innerHTML = '<b>keep</b><script>steal()</' + 'script>' +
      '<img src=x onerror="boom()"><div onclick="boom()">handler</div>' +
      '<a href="javascript:boom()">link</a><iframe src="//evil"></iframe>' +
      '<input type="text" value="not a checkbox"><style>body{display:none}</style>';
    env.ctx.mpSaveNotes();
    await env.settle();
    const saved = env.ctx.__mpState.plan.focus[0].notes;
    ["<script", "onerror", "onclick", "javascript:", "<iframe", "<img", "<a ", "<style", "steal()", "boom()"]
      .forEach((bad) => assert.ok(!saved.includes(bad), "sanitised on save: " + bad + " never reaches the store"));
    assert.ok(saved.includes("<b>keep</b>"), "allowlisted formatting survives");
    assert.ok(saved.includes("handler"), "…and the text inside a dropped tag is kept");
    assert.ok(!saved.includes('type="text"'), "only checkbox inputs survive");

    // sanitise-on-render: a tampered stored value is cleaned before it touches innerHTML
    const env2 = await withItem(MARK + '<b>ok</b><script>steal()</' + 'script><div onclick="boom()">x</div>');
    env2.ctx.mpOpenNotes("f1");
    const rendered = editor(env2).innerHTML;
    ["<script", "steal()", "onclick", "boom()"].forEach((bad) =>
      assert.ok(!rendered.includes(bad), "sanitised on render: " + bad + " never reaches the DOM"));
    assert.ok(rendered.includes("<b>ok</b>"), "…while the real content still renders");

    // the marker cannot be smuggled in as content (comments are dropped)
    const env3 = await withItem("");
    env3.ctx.mpOpenNotes("f1");
    editor(env3).innerHTML = "text " + MARK + " more";
    env3.ctx.mpSaveNotes();
    await env3.settle();
    assert.strictEqual(env3.ctx.__mpState.plan.focus[0].notes.split(MARK).length - 1, 1,
      "the marker can never nest or leak into the content");
  }

  /* ---------- 6. legacy plain-text notes migrate intact, exactly once ---------- */
  {
    const plain = "Call Dan re: pricing < 5% & the new plan\nsecond line\n\nfourth line";
    const env = await withItem(plain);

    // untouched on load — nothing is rewritten just by opening the month
    assert.strictEqual(env.ctx.__mpState.plan.focus[0].notes, plain, "a plain note is not rewritten on load");
    assert.strictEqual(env.posts.length, 0, "…and opening the month saves nothing");

    env.ctx.mpOpenNotes("f1");
    const html = editor(env).innerHTML;
    assert.strictEqual(html,
      "Call Dan re: pricing &lt; 5% &amp; the new plan<br>second line<br><br>fourth line",
      "every character survives: escaped, line structure preserved");

    // the first pass through the editor migrates it (same as the weekly app's modal) —
    // losslessly, and the migrated value reads back as the identical text
    env.ctx.mpCloseNotes();
    await env.settle();
    const converted = env.ctx.__mpState.plan.focus[0].notes;
    assert.ok(converted.indexOf(MARK) === 0, "the first pass through the editor migrates the note");
    assert.strictEqual(converted.slice(MARK.length), html, "…storing exactly what the editor rendered");
    assert.strictEqual(env.ctx.mpNotesToPlainText(converted), plain,
      "…and the original text survives the conversion character for character");

    // a real edit on top keeps the migrated text and adds the formatting
    env.ctx.mpOpenNotes("f1");
    editor(env).innerHTML = html + "<br><b>new line</b>";
    env.ctx.mpSaveNotes();
    await env.settle();
    const migrated = env.ctx.__mpState.plan.focus[0].notes;
    assert.ok(migrated.indexOf(MARK) === 0, "still rich after an edit");
    assert.ok(migrated.includes("Call Dan re: pricing &lt; 5% &amp; the new plan"), "the original text is preserved exactly");
    assert.ok(migrated.includes("<b>new line</b>"), "…alongside the new formatting");
    assert.strictEqual(migrated.split(MARK).length - 1, 1, "one marker only");

    // reopening the migrated note must not double-convert (no escaped markup, no second marker)
    env.ctx.mpOpenNotes("f1");
    const again = editor(env).innerHTML;
    assert.ok(!again.includes("&lt;b&gt;"), "an already-converted note is not escaped a second time");
    assert.ok(again.includes("<b>new line</b>"), "…it renders as rich text");
    const posts = env.posts.length;
    env.ctx.mpSaveNotes();
    await env.settle();
    assert.strictEqual(env.posts.length, posts, "an unchanged note does not re-save");
    assert.strictEqual(env.ctx.__mpState.plan.focus[0].notes, migrated, "…and does not change");
  }

  /* ---------- 7. the ported engine matches index.html's, byte for byte ---------- */
  {
    // monthly.html is a standalone page — it carries its own copy of the v70 engine.
    // This is the guard against the two drifting apart.
    const weekly = await bootWeekly({ defaults: [] });
    const monthly = await withItem("");
    const CASES = [
      '<b>a</b><i>b</i><u>c</u><s>d</s>',
      '<ul><li>one</li><li>two</li></ul>',
      '<div class="wp-note-todo"><input type="checkbox" checked>&nbsp;x</div>',
      '<div class="not-allowed"><span>text</span></div>',
      '<script>bad()</' + 'script><img src=x onerror="bad()"><a href="javascript:bad()">l</a>',
      '<b>unclosed<i>nested',
      'plain & <text> with "quotes" and &amp; entities',
      '<input type="text"><input type="checkbox">',
      '<!-- comment --><!DOCTYPE html><?pi?>',
      '</b></div>stray closers',
      '<div><br></div>',
    ];
    CASES.forEach((c) => {
      assert.strictEqual(monthly.ctx.mpSanitizeNotesHtml(c), weekly.ctx.wpSanitizeNotesHtml(c),
        "sanitiser parity with index.html for: " + c.slice(0, 40));
    });
    ["", "plain\nlines", MARK + "<b>rich</b>", MARK + "<script>x</" + "script>"].forEach((v) => {
      assert.strictEqual(monthly.ctx.mpNotesToEditorHtml(v), weekly.ctx.wpNotesToEditorHtml(v),
        "render parity for: " + JSON.stringify(v).slice(0, 40));
      assert.strictEqual(monthly.ctx.mpNotesToPlainText(v), weekly.ctx.wpNotesToPlainText(v),
        "plain-text parity for: " + JSON.stringify(v).slice(0, 40));
    });
    const el = { innerHTML: '<b>x</b><script>bad()</' + 'script>' };
    assert.strictEqual(monthly.ctx.mpNotesFromEditor(el), weekly.ctx.wpNotesFromEditor(el),
      "save-format parity (same marker, same output)");
    assert.strictEqual(monthly.ctx.MP_NOTES_MARK, weekly.ctx.WP_NOTES_MARK, "both apps use the same rich marker");
    // the same toolbar commands, so the editors behave identically
    ["bold", "italic", "underline", "strike", "bullets", "todo"].forEach((cmd) =>
      assert.ok(monthly.ctx.mpNotesToolbarHtml("mpNotesEd").includes("mpNotesCmd('" + cmd + "'"),
        "toolbar offers " + cmd));
  }

  /* ---------- 8. everything else in the item is untouched ---------- */
  {
    const env = await boot({
      plans: { [AUG]: { ym: AUG, focus: [
        { id: "f1", title: "Retention push", rockRef: "1", notes: "note one", done: false },
        { id: "f2", title: "Second thing", rockRef: "", notes: "", done: true, pushedFrom: "2026-07", pushedFromId: "z" },
      ] } },
      rocks: ROCKS,
    });
    await openPlan(env, AUG);
    const html = env.body.innerHTML;

    // Rock link + Done + push marker all render as before
    assert.ok(html.includes('<span class="mp-linktag">↳ Rock 2</span>'), "the Rock badge is unchanged");
    assert.ok(/<option value="1" selected>Rock 2: Open the second studio<\/option>/.test(html), "the Rock select is unchanged");
    assert.ok(/<div class="mp-item done" data-focus="f2"/.test(html), "the done state still renders");
    assert.ok(html.includes("↩ pushed from July 2026"), "the push-forward marker still renders");
    assert.ok(html.includes('<span class="mp-done-lbl">Done</span>'), "the v90 Done control is unchanged");

    // editing notes leaves title / Rock / done / provenance alone, and persists all of them
    env.ctx.mpOpenNotes("f1");
    editor(env).innerHTML = "<b>fresh</b>";
    env.ctx.mpSaveNotes();
    await env.settle();
    const saved = env.posts[env.posts.length - 1].body.monthlyPlan.focus;
    assert.strictEqual(saved.length, 2, "both items are still saved");
    assert.strictEqual(saved[0].title, "Retention push", "the title is untouched by a notes edit");
    assert.strictEqual(saved[0].rockRef, "1", "the Rock link is untouched");
    assert.strictEqual(saved[0].done, false, "the done state is untouched");
    assert.ok(saved[0].notes.includes("<b>fresh</b>"), "…and the note itself saved");
    assert.strictEqual(saved[1].done, true, "the other item's done state is untouched");
    assert.strictEqual(saved[1].pushedFrom, "2026-07", "…as is its push provenance");

    // ticking Done still persists (v90 path), with the rich note intact
    row(env, "f1").querySelector('[data-ff="done"]').checked = true;
    await env.ctx.mpSaveSection("focus");
    await env.settle();
    const afterDone = env.posts[env.posts.length - 1].body.monthlyPlan.focus[0];
    assert.strictEqual(afterDone.done, true, "Done still toggles and persists");
    assert.ok(afterDone.notes.includes("<b>fresh</b>"), "…without disturbing the note");

    // Push forward still copies title + Rock link + notes, done reset
    env.ctx.mpOpenPushForward("f1");
    env.ctx.mpSetPushTarget({ value: OCT });
    await env.ctx.mpPushFocusForward("f1");
    await env.settle();
    const copy = env.plans[OCT].focus[0];
    assert.strictEqual(copy.title, "Retention push", "push forward still copies the title");
    assert.strictEqual(copy.rockRef, "1", "…and the Rock link");
    assert.ok(copy.notes.includes("<b>fresh</b>"), "…and the rich note, intact");
    assert.strictEqual(copy.done, false, "…with done reset");
    assert.strictEqual(copy.pushedFrom, AUG, "…and provenance stamped");
    assert.strictEqual(env.ctx.__mpState.plan.focus[0].done, true, "the original is unchanged by the push");
  }

  /* ---------- 9. the store keeps rich notes whole ---------- */
  {
    const grab = (name) => {
      const start = STORE_SRC.indexOf("function " + name);
      const end = STORE_SRC.indexOf("\n}", start);
      return STORE_SRC.slice(start, end + 2);
    };
    const tableStart = STORE_SRC.indexOf("const MONTHLY_FOCUS_STRINGS");
    const table = STORE_SRC.slice(tableStart, STORE_SRC.indexOf("};", tableStart) + 2);
    const sandbox = { module: {} };
    vm.createContext(sandbox);
    vm.runInContext(grab("validYm") + "\n" + table + "\n" + grab("cleanMonthlyFocus") +
      "\n;module.exports = { cleanMonthlyFocus, cap: MONTHLY_FOCUS_STRINGS.notes };", sandbox);
    const { cleanMonthlyFocus, cap } = sandbox.module.exports;

    assert.ok(cap >= 20000, "the notes cap fits a real rich note (was 2000, a one-line field)");
    const rich = MARK + "<div>" + "a long thought. ".repeat(200) + "</div>";
    assert.ok(rich.length > 2000, "the fixture is longer than the old cap");
    const out = cleanMonthlyFocus([{ id: "f1", title: "T", notes: rich, done: false }]);
    assert.strictEqual(out[0].notes, rich, "a rich note is stored verbatim — no truncation, no rewriting");
    assert.ok(/notes: typeof f\.notes === "string" \? f\.notes\.slice\(0, MONTHLY_FOCUS_STRINGS\.notes\)/.test(STORE_SRC),
      "the cap is read from the whitelist table, not a stray literal");
  }

  console.log("v93-focus-notes-editor.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
