// v95 regression: on a focus item the "Supports which Rock?" select and the Notes control
// are a matched pair — one shared height, aligned top and bottom on every row, empty or
// filled. Height/alignment only: widths, the Rock link, the notes popup, Done and Push
// forward all behave exactly as before.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, openPlan } = require("./lib/monthly-env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const AUG = "2026-08";
const ROCKS = [{ title: "Retention above 92%" }, { title: "Open the second studio" }];

(async () => {
  /* ---------- build stamp ---------- */
  assert.ok(/<!-- build v95 · focus-fields-equal-height -->/.test(HTML),
    "build stamp is v95 · focus-fields-equal-height");

  /* ---------- 1. one height, declared once, for both controls ---------- */
  {
    assert.ok(/--mp-field-h:(\d+)px/.test(HTML), "the shared field height is a single variable");
    const rule = /#mpBody \.mp-fields-focus select,\s*\n\s*#mpBody \.mp-fields-focus \.mp-notes-open\{([^}]*)\}/.exec(HTML);
    assert.ok(rule, "the select and the Notes control are sized by ONE rule, so they cannot drift");
    assert.ok(/height:var\(--mp-field-h\)/.test(rule[1]), "…using the shared height variable");
    assert.ok(/min-height:var\(--mp-field-h\)/.test(rule[1]),
      "…as a floor too, so neither control can collapse shorter than the other");

    // the cells stretch, and one-line labels keep the controls starting at the same y
    assert.ok(/\.mp-fields-focus\{[^}]*align-items:stretch/.test(HTML),
      "the two columns stretch to equal height (they were top-aligned only)");
    assert.ok(/\.mp-fields-focus \.mp-f > label\{[^}]*white-space:nowrap/.test(HTML),
      "the longer 'Supports which Rock?' label cannot wrap and push its control down");

    // widths are untouched
    assert.ok(/\.mp-fields\{[^}]*grid-template-columns:1fr 1fr/.test(HTML), "still two equal columns");
    assert.ok(/\.mp-f\{[^}]*min-width:0/.test(HTML), "the v93 equal-width fix is intact");
    assert.ok(!/width:/.test(/#mpBody \.mp-fields-focus select,\s*\n\s*#mpBody \.mp-fields-focus \.mp-notes-open\{([^}]*)\}/.exec(HTML)[1]),
      "the height rule sets no width");
  }

  /* ---------- 2. the rule reaches both controls on every row ---------- */
  {
    const env = await boot({
      plans: { [AUG]: { ym: AUG, focus: [
        { id: "f1", title: "Retention push", rockRef: "1", notes: "a filled note", done: false },
        { id: "f2", title: "Empty one", rockRef: "", notes: "", done: false },      // empty row
        { id: "f3", title: "Long", rockRef: "0", notes: "x ".repeat(200), done: true }, // overflowing row
      ] } },
      rocks: ROCKS,
    });
    await openPlan(env, AUG);
    const html = env.body.innerHTML;

    const blocks = html.split('<div class="mp-fields mp-fields-focus">').slice(1);
    assert.strictEqual(blocks.length, 3, "every focus row carries the matched-pair class");
    blocks.forEach((b, i) => {
      const cell = b.slice(0, b.indexOf('<div class="mp-focus-actions">'));
      assert.ok(cell.includes('<select data-ff="rockRef"'), "row " + i + " renders the Rock select");
      assert.ok(cell.includes('class="mp-notes-open'), "row " + i + " renders the Notes control");
      assert.strictEqual((cell.match(/<div class="mp-f">/g) || []).length, 2,
        "row " + i + " still has exactly two field cells");
    });
    // the priorities card is a different pair (two selects) and is deliberately untouched
    assert.ok(/<div class="mp-item" data-prio[\s\S]*?<div class="mp-fields">/.test(html) ||
      !html.includes("data-prio"), "the priorities grid keeps its own layout");

    /* ---------- 3. nothing behavioural moved ---------- */
    const row = env.body.focusRows().find((r) => r.getAttribute("data-focus") === "f1");
    assert.strictEqual(row.querySelector('[data-ff="rockRef"]').value, "1", "the Rock link still round-trips");
    assert.ok(html.includes("onclick=\"mpOpenNotes('f1')\""), "the notes popup still opens from the row");
    assert.ok(html.includes('<span class="mp-done-lbl">Done</span>'), "the Done control is unchanged");
    assert.ok(html.includes("mpOpenPushForward('f1')"), "Push forward is unchanged");

    env.ctx.mpOpenNotes("f1");
    assert.strictEqual(env.ctx.__mpState.notesId, "f1", "the notes editor still opens");
    env.ctx.mpCloseNotes();   // redraws the rows, so re-read the row before touching it
    const fresh = env.body.focusRows().find((r) => r.getAttribute("data-focus") === "f1");
    fresh.querySelector('[data-ff="done"]').checked = true;
    await env.ctx.mpSaveSection("focus");
    await env.settle();
    const saved = env.posts[env.posts.length - 1].body.monthlyPlan.focus;
    assert.strictEqual(saved[0].done, true, "Done still persists");
    assert.strictEqual(saved[0].rockRef, "1", "…with the Rock link intact");
    // (opening the editor migrated the legacy plain note to rich, per v93 — the text is intact)
    assert.strictEqual(env.ctx.mpNotesToPlainText(saved[0].notes), "a filled note", "…and the note text intact");
  }

  console.log("v95-focus-fields-equal-height.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
