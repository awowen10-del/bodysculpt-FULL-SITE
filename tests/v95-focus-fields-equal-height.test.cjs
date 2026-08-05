// v95 regression: a focus item's fields line up.
//
// v95 shipped this as a matched PAIR — the "Supports which Rock?" select and the Notes
// control sat side by side, sharing one explicit height (--mp-field-h) so neither could
// end up a couple of pixels shorter than the other. v109 reflowed the items into a
// 3-across tile grid: the fields stack down the tile, and the notes control left the tile
// face entirely for the v93 popup, so there is no pair left to match. Both the shared
// height variable and the .mp-fields-focus rules went with it.
//
// What v95 was really protecting outlives its markup, and is what this file now asserts:
// a field's control fills its cell, the cell can shrink, and the alignment is decided by
// ONE rule for every control rather than per-field tweaks that drift. The equal-height
// promise moved up a level — tiles in a row are equal height — and is owned by
// tests/v109-focus-tile-grid.test.cjs. Section 3 (nothing behavioural moved) is unchanged
// from the original: the Rock link, notes popup, Done and Push forward all still work.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, openPlan } = require("./lib/monthly-env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const AUG = "2026-08";
const ROCKS = [{ title: "Retention above 92%" }, { title: "Open the second studio" }];

(async () => {
  /* ---------- build stamp ---------- */
  // "v95 or later" — the exact stamp is asserted by the newest version's test.
  const stamp = /<!-- build v(\d+) · [a-z0-9-]+ -->/.exec(HTML);
  assert.ok(stamp && Number(stamp[1]) >= 95, "build stamp is v95 or later");

  /* ---------- 1. one rule sizes every control, so none can drift ---------- */
  {
    const box = /#mpBody input:not\(\[type=checkbox\]\), #mpBody select, #mpBody textarea\{([^}]*)\}/.exec(HTML);
    assert.ok(box, "inputs, selects and textareas are sized by ONE rule");
    ["padding:7px 9px", "border-radius:7px", "font-size:12.5px", "border:1px solid var(--line)", "width:100%"]
      .forEach((d) => assert.ok(box[1].includes(d), "…declaring " + d));

    // the v93 fix underneath the old equal-width pair, still load-bearing: a field cell
    // that cannot shrink lets the Rock select's widest option widen its whole tile column
    assert.ok(/\.mp-f\{[^}]*min-width:0/.test(HTML), "a field cell can shrink");
    assert.ok(/\.mp-f label\{[^}]*white-space:nowrap/.test(HTML),
      "the long 'Supports which Rock?' label cannot wrap and push its control down");

    // the retired pair leaves nothing behind to rot (the token's name survives in the
    // comment that records why it went — it is the definition and the uses that must not)
    assert.ok(!/--mp-field-h\s*:/.test(HTML), "the paired height variable is no longer defined");
    assert.ok(!/var\(--mp-field-h\)/.test(HTML), "…and nothing still asks for it");
    assert.ok(!/mp-fields-focus/.test(HTML), "…as are the matched-pair rules");
  }

  /* ---------- 2. every item renders the same field stack ---------- */
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

    const tiles = html.split('<div class="mp-item').slice(1);
    assert.strictEqual(tiles.length, 3, "every focus item rendered");
    tiles.forEach((t, i) => {
      const face = t.slice(0, t.indexOf('<div class="mp-tile-foot">'));
      assert.ok(face.includes('<select data-ff="rockRef"'), "item " + i + " renders the Rock select");
      assert.strictEqual((face.match(/<div class="mp-f">/g) || []).length, 1,
        "item " + i + " has exactly one labelled field cell — the fields stack, they no longer pair");
      assert.ok(face.includes('<input type="hidden" data-ff="notes"'),
        "item " + i + " still carries its note in the DOM for mpSyncFromDom");
    });

    /* ---------- 3. nothing behavioural moved ---------- */
    const row = env.body.focusRows().find((r) => r.getAttribute("data-focus") === "f1");
    assert.strictEqual(row.querySelector('[data-ff="rockRef"]').value, "1", "the Rock link still round-trips");
    assert.ok(html.includes("onclick=\"mpOpenNotes('f1')\""), "the notes popup still opens from the item");
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
