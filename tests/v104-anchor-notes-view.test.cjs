// v104: the Weekly Plan's monthly anchor surfaces the NOTES that already live on the
// monthly items. An anchor item that has notes on the Monthly Plan gets a small note glyph;
// clicking it opens those notes in a READ-ONLY viewer (the v93/Today modal shell — ✕ / Esc /
// backdrop close, blurred backdrop) with their rich formatting intact and the same
// sanitise-on-render pass used everywhere else.
//
// The whole point is reference-while-planning, so the invariants are as important as the
// feature: one source of truth (the monthly-plan record the anchor already reads), no copy on
// the weekly side, no editor, no save path, and every existing anchor behaviour untouched.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, sleep } = require("./lib/env.cjs");

const WEEKLY = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const MONTHLY = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const AUG_WEEK = "2026-08-10", SEP_WEEK = "2026-09-07";
const MARK = "<!--wp:rich-->";

// A rich note using the full v70 vocabulary: bold, a bullet list and a ticked checkbox line.
const RICH_NOTE = MARK + '<b>Call Dan first</b><ul><li>agenda</li><li>numbers</li></ul>' +
  '<div class="wp-note-todo"><input type="checkbox" checked>&nbsp;room booked</div>';
// A rich value that LOOKS like content but is only empty blocks — must read as "no notes".
const EMPTY_RICH = MARK + "<div><br></div><p></p>";
// A legacy plain-text note (pre-v70), line breaks and all.
const PLAIN_NOTE = "wake 6am\nbed by 10pm";
// A hostile/tampered stored value — the render pass has to strip it.
const NASTY_NOTE = MARK + '<script>alert(1)</script><img src=x onerror="alert(1)">' +
  '<a href="javascript:alert(1)">tap</a><b>survives</b>';

const MONTH_FOCUS = {
  "2026-08": [
    { id: "f1", title: "Rebuild the onboarding call", rockRef: "1", notes: RICH_NOTE, done: true },
    { id: "f2", title: "Price review", rockRef: "", notes: "", done: false },
    { id: "f3", title: "Hire a second coach", rockRef: "", notes: EMPTY_RICH, done: false },
    { id: "f4", title: "Tidy the price list", rockRef: "", notes: NASTY_NOTE, done: false },
  ],
  "2026-09": [{ id: "s1", title: "September business thing", notes: "", done: false }],
};
const MONTH_PRIORITIES = {
  "2026-08": [
    { id: "p1", title: "Consistent wake/bed time", owner: "Ash", status: "Done", notes: PLAIN_NOTE },
    { id: "p2", title: "Book the Italy trip", owner: "", status: "In Progress", notes: "" },
  ],
  "2026-09": [{ id: "s2", title: "September personal thing", status: "Not Started" }],
};

const html = (env) => env.ctx.document.getElementById("wpBody").innerHTML;
function cols(env) {
  const h = html(env);
  const box = h.slice(h.indexOf('<div class="wp-anchor">'), h.indexOf('<div class="wp-top'));
  const split = box.indexOf('<div class="wp-anchor-col wp-anchor-personal">');
  return { box, business: box.slice(0, split), personal: box.slice(split) };
}
// the <li>s of one column, in render order
const items = (colHtml) => colHtml.match(/<li class="wp-anchor-item[\s\S]*?<\/li>/g) || [];
const NOTE_ICO = "\u{1F5D2}";
const el = (env, id) => env.ctx.document.getElementById(id);

async function week(opts) {
  const env = await boot(Object.assign({
    defaults: [], monthFocus: MONTH_FOCUS, monthPriorities: MONTH_PRIORITIES,
    plans: { [AUG_WEEK]: { weekEnding: AUG_WEEK }, [SEP_WEEK]: { weekEnding: SEP_WEEK } },
  }, opts || {}));
  await env.ctx.loadWeeklyPlan(opts && opts.week ? opts.week : AUG_WEEK);
  await env.settle();
  return env;
}
// open exactly the way the rendered button does — parse its own onclick and call it
function clickNote(env, li) {
  const m = /onclick="wpOpenAnchorNotes\('([a-z]+)',(\d+)\)"/.exec(li);
  assert.ok(m, "the notes icon carries its own open call: " + li);
  env.ctx.wpOpenAnchorNotes(m[1], Number(m[2]));
  return { kind: m[1], idx: Number(m[2]) };
}
const viewer = (env) => el(env, "wpAnchorNotesBody").innerHTML;

(async () => {
  /* ================= 0. the build stamp ================= */
  // ">= v104" — the exact stamp is asserted by the newest version's test; both pages still
  // have to agree on it (v101).
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(MONTHLY);
  assert.ok(stamp && Number(stamp[1]) >= 104, "monthly.html stamped v104 or later");
  assert.ok(WEEKLY.includes("build v" + stamp[1] + " · " + stamp[2]), "index.html carries the same stamp");

  /* ================= 1. the icon appears ONLY where notes exist ================= */
  {
    const env = await week();
    const c = cols(env);
    const biz = items(c.business), pers = items(c.personal);
    assert.strictEqual(biz.length, 4, "all four business items render");
    assert.strictEqual(pers.length, 2, "…and both personal ones");

    // business: rich note + tampered note have it, empty string and empty-rich do not
    assert.ok(biz[0].includes("Rebuild the onboarding call") && biz[0].includes(NOTE_ICO),
      "an item with notes shows the notes icon");
    assert.ok(biz[0].includes('class="wp-anchor-note"'), "…as the anchor's own small control");
    assert.ok(biz[1].includes("Price review") && !biz[1].includes(NOTE_ICO),
      "an item with no notes shows nothing");
    assert.strictEqual(biz[1], '<li class="wp-anchor-item">Price review</li>',
      "…it renders byte-identical to before the feature");
    assert.ok(biz[2].includes("Hire a second coach") && !biz[2].includes(NOTE_ICO),
      "notes that are only empty rich blocks count as no notes");
    assert.ok(biz[3].includes(NOTE_ICO), "…and an item whose notes are all junk still has content to show");

    // personal: same rule, same markup
    assert.ok(pers[0].includes("Consistent wake/bed time") && pers[0].includes(NOTE_ICO),
      "a personal item with notes shows the icon too");
    assert.ok(pers[0].includes('class="wp-anchor-note"'), "…the same control as the business side");
    assert.ok(pers[1].includes("Book the Italy trip") && !pers[1].includes(NOTE_ICO),
      "…and a personal item without notes shows nothing");
    assert.strictEqual(pers[1], '<li class="wp-anchor-item">Book the Italy trip</li>',
      "…rendering byte-identical to before");

    // exactly three icons across the whole anchor — one per item that has notes
    assert.strictEqual((c.box.match(/class="wp-anchor-note"/g) || []).length, 3,
      "one icon per item with notes, and none anywhere else");

    // a month whose items have no notes gets no icons at all
    await env.ctx.loadWeeklyPlan(SEP_WEEK);
    await env.settle();
    assert.ok(!cols(env).box.includes(NOTE_ICO), "a month with no notes anywhere stays completely clean");
  }

  /* ================= 2. clicking opens a read-only view, formatting intact ================= */
  {
    const env = await week();
    const ov = el(env, "wpAnchorNotesOverlay");
    assert.strictEqual(env.ctx.__wpState.plan.weekEnding, AUG_WEEK, "the August week is loaded");
    assert.ok(/<div id="wpAnchorNotesOverlay"[^>]*\shidden\b/.test(WEEKLY), "the viewer starts hidden");

    const biz = items(cols(env).business);
    const opened = clickNote(env, biz[0]);
    assert.strictEqual(opened.kind, "focus", "the business icon opens the focus item");
    assert.strictEqual(ov.hidden, false, "the viewer opens");
    assert.strictEqual(el(env, "wpAnchorNotesTitle").textContent, "Rebuild the onboarding call",
      "…titled with the item you clicked");
    assert.strictEqual(el(env, "wpAnchorNotesKicker").textContent, "Monthly focus notes",
      "…and says which monthly list it came from");
    assert.strictEqual(env.ctx.document.body.style.overflow, "hidden", "…locking the page behind it");

    const v = viewer(env);
    assert.ok(v.includes('class="wp-anchor-notes-view"'), "the notes render in the viewer body");
    assert.ok(v.includes("<b>Call Dan first</b>"), "…bold survives");
    assert.ok(v.includes("<li>agenda</li>") && v.includes("<li>numbers</li>"), "…bullets survive");
    assert.ok(v.includes('<div class="wp-note-todo"><input type="checkbox" checked>'),
      "…and checkbox lines survive, ticked state and all");
    assert.ok(!v.includes(MARK), "the rich marker never leaks into the view");

    /* ---- read-only: it is a viewer, not an editor ---- */
    assert.ok(!v.includes("contenteditable"), "nothing in the viewer is editable");
    assert.ok(!/onblur|oninput|onchange/.test(v), "…and it has no edit handlers");
    assert.ok(!v.includes("wp-nt-bar"), "…no formatting toolbar");
    assert.ok(/\.wp-anchor-notes-view input\[type=checkbox\]\{pointer-events:none/.test(WEEKLY),
      "…and its checkboxes can't even be clicked");

    /* ---- closing: ✕ / Esc / backdrop, and still nothing written ---- */
    assert.ok(/<button class="wp-today-close"[^>]*onclick="wpCloseAnchorNotes\(\)"/.test(WEEKLY),
      "the viewer closes with ✕");
    assert.ok(/id="wpAnchorNotesOverlay"[^>]*onclick="if\(event\.target===this\)wpCloseAnchorNotes\(\)"/.test(WEEKLY),
      "…and on a backdrop click");
    assert.ok(/if\(wpAnchorNotesOpen\)\{ wpCloseAnchorNotes\(\); return; \}/.test(WEEKLY),
      "…and on Escape");
    assert.ok(/\.wp-today-overlay\{[^}]*backdrop-filter:blur/.test(WEEKLY),
      "…in the same blurred-backdrop modal shell as Today and the v93 notes popup");
    env.ctx.wpCloseAnchorNotes();
    assert.strictEqual(env.ctx.document.body.style.overflow, "", "closing releases the page scroll");
    await sleep(260);
    assert.strictEqual(ov.hidden, true, "…and the overlay goes away after the fade");

    /* ---- the personal anchor behaves identically ---- */
    const pers = items(cols(env).personal);
    const p = clickNote(env, pers[0]);
    assert.strictEqual(p.kind, "personal", "the personal icon opens the personal item");
    assert.strictEqual(ov.hidden, false, "the viewer opens from the personal anchor too");
    assert.strictEqual(el(env, "wpAnchorNotesTitle").textContent, "Consistent wake/bed time",
      "…titled with the personal item");
    assert.strictEqual(el(env, "wpAnchorNotesKicker").textContent, "Monthly personal notes",
      "…and named as the personal list");
    const pv = viewer(env);
    assert.ok(pv.includes("wake 6am<br>bed by 10pm"),
      "a legacy plain-text note renders with its line breaks, escaped as before");
    assert.ok(pv.includes('class="wp-anchor-notes-view"') && !pv.includes("contenteditable"),
      "…in the same read-only viewer");
    env.ctx.wpCloseAnchorNotes();

    // a click that can't resolve an item does nothing at all
    env.ctx.wpOpenAnchorNotes("focus", 99);
    assert.strictEqual(env.ctx.__wpState.anchorNotesOpen, false, "an unresolvable item opens nothing");
  }

  /* ================= 3. sanitised on render ================= */
  {
    const env = await week();
    clickNote(env, items(cols(env).business)[3]);   // the tampered note
    const v = viewer(env);
    assert.ok(!/<script/i.test(v), "a stored <script> never reaches the view");
    assert.ok(!/<img/i.test(v) && !/onerror/i.test(v), "…nor an image with an event handler");
    assert.ok(!/<a\b/i.test(v) && !/javascript:/i.test(v), "…nor a javascript: link");
    assert.ok(v.includes("<b>survives</b>"), "…while the real formatting still renders");
    // and it is the SAME sanitiser the rest of the app uses, not a second copy
    assert.ok(/function wpOpenAnchorNotes[\s\S]*?wpNotesToEditorHtml\(it\.notes\)/.test(WEEKLY),
      "the viewer renders through wpNotesToEditorHtml — sanitise-on-render, one implementation");
  }

  /* ================= 4. one source of truth: reads only, no weekly copy ================= */
  {
    const env = await week();
    const before = env.posts.length;
    const biz = items(cols(env).business);
    clickNote(env, biz[0]);
    env.ctx.wpCloseAnchorNotes();
    clickNote(env, items(cols(env).personal)[0]);
    env.ctx.wpCloseAnchorNotes();
    await env.settle();

    assert.strictEqual(env.posts.length, before, "opening and closing the viewer writes nothing at all");
    assert.ok(!env.posts.some((p) => p.body.monthlyPlan), "the weekly app never writes the monthly record");
    assert.ok(!/monthfocus[^)]*method:"POST"/.test(WEEKLY), "…and has no write path to it");

    const st = env.ctx.__wpState;
    assert.ok(!("focus" in st.plan) && !("priorities" in st.plan) && !("monthFocus" in st.plan),
      "no copy of either monthly list is stored on the weekly plan");
    assert.ok(!JSON.stringify(st.plan).includes("Call Dan first"),
      "…and no copy of the notes either — the weekly plan never holds them");
    assert.ok(!/wpAnchorNotes(?:Save|FromEditor)|wpSaveSection\(["']anchor/.test(WEEKLY),
      "there is no save path for anchor notes anywhere in the app");

    // the viewer reads the SHARED record live: change the monthly item and the view follows,
    // with no weekly re-save in between
    st.monthFocus.focus[0].notes = MARK + "<b>changed on Monthly</b>";
    clickNote(env, items(cols(env).business)[0]);
    assert.ok(viewer(env).includes("<b>changed on Monthly</b>"),
      "the viewer reads the monthly record itself, so Monthly stays the single source of truth");
    env.ctx.wpCloseAnchorNotes();
    assert.strictEqual(env.posts.length, before, "…and reading it still writes nothing");
  }

  /* ================= 5. everything the anchor already did is unchanged ================= */
  {
    const env = await week();
    const c = cols(env);
    assert.ok(c.box.includes('<div class="wp-anchor-cols">'), "the anchor is still a two-column row");
    assert.strictEqual((c.box.match(/class="wp-anchor-col[" ]/g) || []).length, 2, "…of exactly two columns");
    assert.ok(c.box.indexOf("August focus") < c.box.indexOf("August personal"), "business left, personal right");
    assert.ok(c.business.includes("from Monthly Plan") && c.personal.includes("from Monthly Plan"),
      "…both still labelled with their source");

    // done-state / tick / strike, both sides (v98 + v103 behaviour, with an icon now present)
    assert.ok(/wp-anchor-done"><span class="wp-anchor-tick">✓<\/span>Rebuild the onboarding call/.test(c.business),
      "a done business item still ticks and strikes");
    assert.ok(/wp-anchor-done"><span class="wp-anchor-tick">✓<\/span>Consistent wake\/bed time/.test(c.personal),
      "a personal item with Status:Done still reads as done");
    assert.strictEqual((c.box.match(/wp-anchor-done/g) || []).length, 2, "exactly two items read as done");
    assert.ok(!c.business.includes("Consistent wake/bed time") && !c.personal.includes("Rebuild the onboarding call"),
      "the two sides still don't bleed into each other");

    // still no editing controls in the anchor itself
    ["<input", "<select", "<textarea", "onchange", "contenteditable", "draggable"]
      .forEach((bad) => assert.ok(!c.box.includes(bad), "the anchor stays read-only: no " + bad));

    // month resolution, and the empty-side hint
    await env.ctx.loadWeeklyPlan(SEP_WEEK);
    await env.settle();
    const sep = cols(env);
    assert.ok(sep.business.includes("September business thing") && sep.personal.includes("September personal thing"),
      "a September week still resolves September's own items");
    assert.ok(!sep.box.includes("wp-anchor-done"), "…with September's own done-state");

    const empty = await week({ monthPriorities: { "2026-08": [] } });
    assert.ok(cols(empty).personal.includes("Nothing set for this month."),
      "an empty side still keeps its column and hint");
    assert.ok(!cols(empty).personal.includes(NOTE_ICO), "…with no stray icon");
  }

  console.log("v104-anchor-notes-view.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
