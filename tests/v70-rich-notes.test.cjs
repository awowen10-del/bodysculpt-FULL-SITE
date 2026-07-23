// v70 harness — rich weekly Notes. Assertions: legacy plain-text notes migrate with
// every line break intact and never double-convert; each format (bold / italic /
// underline / strikethrough / bullets / checkbox) round-trips through the real save
// path and a fresh reload; checkbox ticked-state persists; malicious input (<script>,
// onclick=, javascript: href, iframe, data: URL) is stripped on BOTH save and render;
// the Today modal and the weekly panel stay in sync through the one notes field.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const MARK = "<!--wp:rich-->";
const ALL_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const NOW = new Date();
function mondayIso(d) {
  const x = new Date(d);
  const back = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - back);
  x.setUTCHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}
const WEEK = mondayIso(NOW); // modal notes only render when today is in the viewed week

// Ash's real-world shape: a ~10-line plain-text note, including characters that need
// escaping — it must come back IDENTICAL, just editable.
const PLAIN = [
  "Monday: chase the leads from the open day",
  "Ask Jo about Q3 targets & the PT rota",
  "Price check: 6 wk challenge < £200?",
  "",
  "Ideas for next week",
  "- reels x3",
  "- referral push",
  "Book kit service (rower + 2 bikes)",
  "Team meeting agenda > send Thursday",
  "Remember the Q2 review follow-ups",
].join("\n");

const lastNotesPost = (posts) => {
  const saves = posts.filter((p) => p.body.weeklyPlan && "notes" in p.body.weeklyPlan);
  return saves[saves.length - 1];
};

(async () => {
  /* ---------- 1: plain-text migration — line breaks intact, no double-convert ---------- */
  {
    const plans = { [WEEK]: { weekEnding: WEEK, placements: {}, notes: PLAIN } };
    const { ctx, posts } = await boot({ plans });
    await ctx.loadWeeklyPlan(WEEK);
    const st = ctx.__wpState;

    // raw stored value is untouched by load (no store write, no in-memory rewrite)
    assert.strictEqual(st.plan.notes, PLAIN, "legacy plain notes not rewritten on load");
    assert.strictEqual(lastNotesPost(posts), undefined, "no notes save fired just from loading");

    // rendered form: every line present, exactly lines-1 <br>s, escapes correct
    const html = ctx.wpNotesToEditorHtml(PLAIN);
    const wpBody = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(wpBody.includes(html), "weekly panel renders the converted note");
    assert.ok(wpBody.includes(`id="wpWeekNotesEd"`) && wpBody.includes(`contenteditable="true"`), "notes are a contenteditable editor");
    assert.ok(wpBody.includes(`class="wp-nt-bar"`) && wpBody.includes(`wpNotesCmd('bold'`), "toolbar rendered above the editor");
    assert.strictEqual((html.match(/<br>/g) || []).length, PLAIN.split("\n").length - 1, "one <br> per original newline");
    assert.ok(html.includes("Ask Jo about Q3 targets &amp; the PT rota"), "& escaped, line intact");
    assert.ok(html.includes("Price check: 6 wk challenge &lt; £200?"), "< escaped, line intact");
    assert.ok(html.includes("Team meeting agenda &gt; send Thursday"), "> escaped, line intact");
    // decode back: the rendered html maps 1:1 onto the original text
    const decoded = html.split("<br>").map((l) => l.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
    assert.deepStrictEqual(decoded, PLAIN.split("\n"), "all 10 lines come back byte-identical");

    // no double-convert: saving stores MARK+html; rendering THAT yields the same html
    const stored = ctx.wpNotesFromEditor({ innerHTML: html });
    assert.strictEqual(stored, MARK + html, "first save upgrades to the marked rich form");
    assert.strictEqual(ctx.wpNotesToEditorHtml(stored), html, "re-render of the rich form is stable (no re-escaping)");
    assert.ok(!ctx.wpNotesToEditorHtml(stored).includes("&amp;amp;"), "no double-escaped entities");

    // un-convertible junk is kept as escaped text, never dropped
    const junk = "<<<not html\nstill mine";
    const jh = ctx.wpNotesToEditorHtml(junk);
    assert.ok(jh.includes("&lt;&lt;&lt;not html") && jh.includes("still mine"), "raw text kept (escaped) when it isn't valid markup");
  }

  /* ---------- 2: each format round-trips through save → store → fresh reload ---------- */
  const RICH =
    `<b>bold</b><br><strong>strong</strong><br><i>italic</i><br><em>em</em><br>` +
    `<u>underline</u><br><s>strike</s><br><strike>old-strike</strike><br>` +
    `<ul><li>bullet one</li><li>bullet two</li></ul>` +
    `<div class="wp-note-todo"><input type="checkbox" checked>&nbsp;ring supplier</div>` +
    `<div class="wp-note-todo"><input type="checkbox">&nbsp;order chalk</div>`;
  let storedRich;
  {
    const plans = { [WEEK]: { weekEnding: WEEK, placements: {}, notes: "" } };
    const { ctx, posts } = await boot({ plans });
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpOpenToday();
    // type into the (modal) editor, save through the real path
    ctx.document.getElementById("wpTodayNotes").innerHTML = RICH;
    await ctx.wpTodaySaveNotes();
    const post = lastNotesPost(posts);
    assert.ok(post, "notes save posted");
    assert.strictEqual(post.body.weeklyPlan.weekEnding, WEEK, "saved against the viewed week");
    storedRich = post.body.weeklyPlan.notes;
    assert.strictEqual(storedRich, MARK + RICH, "well-formed rich content passes the sanitiser unchanged");
    assert.strictEqual(ctx.__wpState.plan.notes, storedRich, "wpPlan.notes holds the stored form");
  }
  {
    // fresh boot = reload; the store hands back what was saved
    const plans = { [WEEK]: { weekEnding: WEEK, placements: {}, notes: storedRich } };
    const { ctx } = await boot({ plans });
    await ctx.loadWeeklyPlan(WEEK);
    const wpBody = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(wpBody.includes(RICH), "every format survives save + reload verbatim");
    for (const frag of ["<b>bold</b>", "<strong>strong</strong>", "<i>italic</i>", "<em>em</em>",
      "<u>underline</u>", "<s>strike</s>", "<strike>old-strike</strike>",
      "<ul><li>bullet one</li><li>bullet two</li></ul>"]) {
      assert.ok(wpBody.includes(frag), "format round-trips: " + frag);
    }
    // ---------- 3: checkbox ticked-state persists (and unticked stays unticked) ----------
    assert.ok(wpBody.includes(`<input type="checkbox" checked>&nbsp;ring supplier`), "ticked checkbox comes back ticked");
    assert.ok(wpBody.includes(`<input type="checkbox">&nbsp;order chalk`), "unticked checkbox comes back unticked");
    // the modal renders the same notes
    ctx.wpOpenToday();
    assert.ok(ctx.document.getElementById("wpTodayBody").innerHTML.includes(RICH), "Today modal renders the same rich note");
    // ticking = flipping the checked ATTRIBUTE (what the delegated click handler does),
    // then serialising — the flip survives the save path
    const reticked = RICH.replace(`<input type="checkbox">&nbsp;order chalk`, `<input type="checkbox" checked>&nbsp;order chalk`);
    const restored = ctx.wpNotesFromEditor({ innerHTML: reticked });
    assert.ok(restored.includes(`<input type="checkbox" checked>&nbsp;order chalk`), "a new tick serialises into the saved note");
    const unticked = ctx.wpNotesFromEditor({ innerHTML: RICH.replace(`<input type="checkbox" checked>&nbsp;ring supplier`, `<input type="checkbox">&nbsp;ring supplier`) });
    assert.ok(unticked.includes(`<input type="checkbox">&nbsp;ring supplier`), "an untick serialises too");
  }

  /* ---------- 4: malicious input stripped on save AND on render ---------- */
  const EVIL =
    `<script>alert(1)<` + `/script>` +
    `<b onclick="steal()">keep me</b>` +
    `<a href="javascript:evil()">a link</a>` +
    `<a href="data:text/html,pwn">data link</a>` +
    `<iframe src="https://bad.example"></iframe>` +
    `<img src=x onerror="alert(2)">` +
    `<div style="position:fixed" onmouseover="alert(3)">styled text</div>` +
    `<svg onload="alert(4)"><circle></circle></svg>` +
    `<input type="text" value="not a checkbox">` +
    `<input type="checkbox" onclick="alert(5)" checked>`;
  {
    const plans = { [WEEK]: { weekEnding: WEEK, placements: {}, notes: "" } };
    const { ctx, posts } = await boot({ plans });
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpOpenToday();
    // SAVE side: pasted-in nastiness never reaches the store
    ctx.document.getElementById("wpTodayNotes").innerHTML = EVIL;
    await ctx.wpTodaySaveNotes();
    const saved = lastNotesPost(posts).body.weeklyPlan.notes;
    for (const bad of ["<script", "alert(", "onclick", "onerror", "onmouseover", "onload",
      "javascript:", "data:", "<iframe", "<img", "<svg", "<a ", "href", "style="]) {
      assert.ok(!saved.includes(bad), "saved note contains no " + JSON.stringify(bad));
    }
    assert.ok(saved.includes("<b>keep me</b>"), "legit formatting kept");
    assert.ok(saved.includes("a link") && saved.includes("styled text"), "text content of stripped tags kept");
    assert.ok(saved.includes(`<input type="checkbox" checked>`), "checkbox kept, handler + junk attrs dropped");
    assert.ok(!saved.includes("not a checkbox"), "non-checkbox inputs dropped entirely");

    // RENDER side: a tampered STORE value (marker + raw nastiness) is sanitised before innerHTML
    const tampered = MARK + EVIL;
    const rendered = ctx.wpNotesToEditorHtml(tampered);
    for (const bad of ["<script", "alert(", "onclick", "onerror", "onmouseover", "onload", "javascript:", "data:", "<iframe", "<svg"]) {
      assert.ok(!rendered.includes(bad), "rendered note contains no " + JSON.stringify(bad));
    }
    ctx.__wpState.plan.notes = tampered;
    ctx.renderWeeklyPlan();
    const wpBody = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(!wpBody.includes("alert(") && !wpBody.includes("<script") && !wpBody.includes("javascript:"), "tampered store value never reaches the page unsanitised");
    ctx.wpRenderTodayBody();
    const modal = ctx.document.getElementById("wpTodayBody").innerHTML;
    assert.ok(!modal.includes("alert(") && !modal.includes("<script") && !modal.includes("javascript:"), "…nor the Today modal");
    // and wpValidUrl is exactly as strict as before — not loosened for notes
    assert.strictEqual(ctx.wpValidUrl("javascript:alert(1)"), null, "wpValidUrl still rejects javascript:");
    assert.strictEqual(ctx.wpValidUrl("data:text/html,x"), null, "wpValidUrl still rejects data:");
    assert.strictEqual(ctx.wpValidUrl("example.com/x"), "https://example.com/x", "wpValidUrl still normalises bare domains");
  }

  /* ---------- 5: Today modal ↔ weekly panel stay in sync ---------- */
  {
    const plans = { [WEEK]: { weekEnding: WEEK, placements: {}, notes: "start point" } };
    const { ctx, posts } = await boot({ plans });
    await ctx.loadWeeklyPlan(WEEK);
    const st = ctx.__wpState;
    // weekly → modal: the modal renders the current weekly note
    ctx.wpOpenToday();
    assert.ok(ctx.document.getElementById("wpTodayBody").innerHTML.includes("start point"), "modal shows the weekly note");
    // modal edit → one field, one save path, weekly panel re-render agrees
    ctx.document.getElementById("wpTodayNotes").innerHTML = "<b>synced</b> from the modal";
    await ctx.wpTodaySaveNotes();
    assert.strictEqual(st.plan.notes, MARK + "<b>synced</b> from the modal", "single notes field updated");
    const post = lastNotesPost(posts);
    assert.strictEqual(post.body.weeklyPlan.notes, st.plan.notes, "modal writes through wpSaveSection('notes')");
    assert.strictEqual(post.body.weeklyPlan.weekEnding, WEEK, "…against the viewed week");
    ctx.renderWeeklyPlan();
    assert.ok(ctx.document.getElementById("wpBody").innerHTML.includes("<b>synced</b> from the modal"), "weekly panel shows the modal edit");
    ctx.wpRenderTodayBody();
    assert.ok(ctx.document.getElementById("wpTodayBody").innerHTML.includes("<b>synced</b> from the modal"), "modal re-render reads the same value");
    // mirror-before-save: unchanged content doesn't re-save (no clobber loop)
    const n = posts.length;
    await ctx.wpTodaySaveNotes();
    assert.strictEqual(posts.length, n, "no redundant save when the note is unchanged");
    // clearing the note stores plain "" (not a marker-wrapped shell)
    ctx.document.getElementById("wpTodayNotes").innerHTML = "<div><br></div>";
    await ctx.wpTodaySaveNotes();
    assert.strictEqual(st.plan.notes, "", "emptied editor normalises to a blank note");
  }

  console.log("v70-rich-notes.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
