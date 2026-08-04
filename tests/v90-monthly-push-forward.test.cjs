// v90 regression: the Monthly Plan's "This Month's Focus" card.
//   1) the Done control is a legible pill that toggles and persists;
//   2) "Push forward" COPIES a focus item into a chosen future month, leaves the original
//      here untouched (so an unproductive month still reads honestly), resets the copy's
//      done-state, stamps provenance, and refuses to copy the same item twice.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { boot, openPlan } = require("./lib/monthly-env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const STORE_SRC = fs.readFileSync(
  path.join(__dirname, "..", "netlify", "functions", "kpi-store.js"), "utf8");

const AUG = "2026-08", SEP = "2026-09", OCT = "2026-10", DEC = "2026-12";
const ROCKS = [{ title: "Retention above 92%" }, { title: "Open the second studio" }];

function focusOf(env, ym) { return (env.plans[ym] && env.plans[ym].focus) || []; }
function rowOf(env, id) { return env.body.focusRows().find((r) => r.getAttribute("data-focus") === id); }

(async () => {
  /* ---------- 1. build stamp ---------- */
  assert.ok(/<!-- build v90 · monthly-push-forward -->/.test(HTML), "build stamp is v90 · monthly-push-forward");

  /* ---------- 2. the Done control renders legibly ---------- */
  {
    // The bug was CSS, not markup: "#mpBody input{width:100%;padding:7px 9px}" (id specificity)
    // beat the checkbox's own sizing, stretching it and squeezing the word "Done" out of view.
    assert.ok(/#mpBody input:not\(\[type=checkbox\]\)[^{]*\{[^}]*width:100%/.test(HTML),
      "the generic #mpBody input rule no longer applies to checkboxes");
    assert.ok(/#mpBody \.mp-done input\[type=checkbox\]\{[^}]*width:16px/.test(HTML),
      "the Done checkbox is sized explicitly at id-level specificity");
    assert.ok(/\.mp-done,\.mp-linktag\{[^}]*height:30px/.test(HTML),
      "Done pill and Rock badge share one height so they line up");
    assert.ok(/\.mp-done\{[^}]*white-space:nowrap/.test(HTML), "the Done label cannot wrap/clip");
    assert.ok(/\.mp-item\.done \.mp-done\{/.test(HTML), "a done item gets a distinct Done pill state");
    assert.ok(/\.mp-item\.done input\.mp-title\{[^}]*line-through/.test(HTML),
      "a done item's title reads as done (struck through)");
    assert.ok(!/\.mp-chk\s*(\{|input)/.test(HTML) && !/class="mp-chk"/.test(HTML),
      "the old cramped .mp-chk control is gone");

    const env = await boot({ plans: { [AUG]: { ym: AUG, focus: [
      { id: "f1", title: "Rebuild the onboarding call", rockRef: "0", notes: "with Dan", done: false },
      { id: "f2", title: "Price review", rockRef: "", notes: "", done: true },
    ] } }, rocks: ROCKS });
    await openPlan(env, AUG);
    const html = env.body.innerHTML;

    assert.ok(html.includes('<span class="mp-done-lbl">Done</span>'),
      "the Done label is rendered as readable text in its own element");
    assert.ok(/<label class="mp-done"><input type="checkbox" data-ff="done"/.test(html),
      "the checkbox still carries data-ff=\"done\" (unchanged save path)");
    assert.ok(html.includes('onchange="mpToggleFocus(this)"'), "toggle handler unchanged");
    assert.ok(/<div class="mp-item" data-focus="f1"/.test(html), "an open item has no done class");
    assert.ok(/<div class="mp-item done" data-focus="f2"/.test(html), "a done item renders in the done state");
    assert.ok(/data-focus="f2"[\s\S]*?data-ff="done" checked/.test(html), "a done item's box is ticked");

    // toggling persists through the DOM round-trip and into the save payload
    rowOf(env, "f1").querySelector('[data-ff="done"]').checked = true;
    await env.ctx.mpSaveSection("focus");
    await env.settle();
    const posted = env.posts[env.posts.length - 1].body.monthlyPlan;
    assert.strictEqual(posted.ym, AUG, "focus save targets this month");
    assert.strictEqual(posted.focus.find((f) => f.id === "f1").done, true, "ticking Done persists");
    assert.strictEqual(posted.focus.find((f) => f.id === "f2").done, true, "an already-done item stays done");
    assert.deepStrictEqual(Object.keys(posted).sort(), ["focus", "ym"], "focus save still sends only ym + focus");
  }

  /* ---------- 3. push forward: copy lands in the chosen month, original untouched ---------- */
  {
    const env = await boot({
      plans: {
        [AUG]: { ym: AUG, focus: [
          { id: "f1", title: "Rebuild the onboarding call", rockRef: "1", notes: "with Dan", done: false },
        ], priorities: [], notes: "aug notes" },
        // the target month already has other content — the push must not disturb it
        [OCT]: { ym: OCT, focus: [{ id: "o1", title: "Existing October item", rockRef: "", notes: "", done: false }],
          priorities: [{ id: "p9", title: "Oct project" }], notes: "oct notes" },
      },
      rocks: ROCKS,
    });
    await openPlan(env, AUG);

    // the picker defaults to next month but lists further months too
    env.ctx.mpOpenPushForward("f1");
    assert.strictEqual(env.ctx.__mpState.pushOpen.id, "f1", "picker opens on that item");
    assert.strictEqual(env.ctx.__mpState.pushOpen.ym, SEP, "picker defaults to next month");
    const pickerHtml = env.body.innerHTML;
    assert.ok(/<div class="mp-push" data-push="f1">/.test(pickerHtml), "an inline month picker is rendered");
    ["September 2026", "October 2026", "December 2026", "July 2027"].forEach((label) => {
      assert.ok(pickerHtml.includes(`>${label}</option>`), `picker offers ${label}`);
    });
    assert.ok(!pickerHtml.includes(">August 2026</option>"), "the current month is not a push target");
    assert.ok(/<option value="2026-09" selected>/.test(pickerHtml), "next month is preselected");
    assert.strictEqual((pickerHtml.match(/<option value="20/g) || []).length, 12, "12 future months offered");

    // choose a month further out than next month
    env.ctx.mpSetPushTarget({ value: OCT });
    await env.ctx.mpPushFocusForward("f1");
    await env.settle();

    const oct = focusOf(env, OCT);
    assert.strictEqual(oct.length, 2, "the copy is appended to the chosen month");
    const copy = oct[1];
    assert.strictEqual(copy.title, "Rebuild the onboarding call", "copy keeps the title");
    assert.strictEqual(copy.rockRef, "1", "copy keeps the Rock link");
    assert.strictEqual(copy.notes, "with Dan", "copy keeps the notes");
    assert.strictEqual(copy.done, false, "copy starts unticked — it is fresh work for that month");
    assert.strictEqual(copy.pushedFrom, AUG, "copy records the month it came from");
    assert.strictEqual(copy.pushedFromId, "f1", "copy records the item it came from");
    assert.notStrictEqual(copy.id, "f1", "the copy is its own item with its own id");
    assert.strictEqual(oct[0].title, "Existing October item", "the target month's other focus items survive");
    assert.strictEqual(env.plans[OCT].notes, "oct notes", "the target month's notes are untouched");
    assert.strictEqual(env.plans[OCT].priorities.length, 1, "the target month's priorities are untouched");
    const pushPost = env.posts.find((p) => p.body.monthlyPlan && p.body.monthlyPlan.ym === OCT);
    assert.deepStrictEqual(Object.keys(pushPost.body.monthlyPlan).sort(), ["focus", "ym"],
      "the push writes only ym + focus to the target month (store merges the rest)");

    // the original is still here, unchanged and still not done
    const aug = focusOf(env, AUG);
    assert.strictEqual(aug.length, 1, "nothing was moved out of this month");
    assert.strictEqual(aug[0].id, "f1", "the original item keeps its id");
    assert.strictEqual(aug[0].title, "Rebuild the onboarding call", "the original title is unchanged");
    assert.strictEqual(aug[0].rockRef, "1", "the original Rock link is unchanged");
    assert.strictEqual(aug[0].notes, "with Dan", "the original notes are unchanged");
    assert.strictEqual(aug[0].done, false, "the original stays not-done: an honest record of the month");
    assert.strictEqual(aug[0].pushedFrom, undefined, "the original is not marked as a pushed copy");
    assert.strictEqual(env.plans[AUG].notes, "aug notes", "this month's other sections are untouched");
    assert.strictEqual(env.ctx.__mpState.plan.focus.length, 1, "the item is still on screen in this month");

    // and the user is told what happened
    assert.strictEqual(env.ctx.__mpState.pushOpen, null, "the picker closes after a push");
    assert.ok(/October 2026/.test(env.ctx.__mpState.pushNote.text), "the result note names the target month");
    assert.ok(!env.ctx.__mpState.pushNote.warn, "a successful push is not a warning");
    assert.ok(env.body.innerHTML.includes("mp-pushnote"), "the note is rendered on the item");

    /* ---------- 4. the copy carries the pushed-from marker in the target month ---------- */
    await openPlan(env, OCT);
    const octHtml = env.body.innerHTML;
    assert.ok(octHtml.includes("↩ pushed from August 2026"),
      "the copy shows where it came from, so it doesn't look like an independent plan");
    assert.strictEqual((octHtml.match(/mp-pushed/g) || []).length, 1, "exactly one item is marked as pushed");
    const o1Block = octHtml.slice(octHtml.indexOf('data-focus="o1"'), octHtml.indexOf("data-focus", octHtml.indexOf('data-focus="o1"') + 20));
    assert.ok(!o1Block.includes("mp-pushed"), "an item that was never pushed carries no marker");

    // provenance survives the DOM round-trip (it has no input of its own)
    env.ctx.mpSyncFromDom();
    const synced = env.ctx.__mpState.plan.focus.find((f) => f.pushedFrom);
    assert.ok(synced, "pushedFrom survives mpSyncFromDom");
    assert.strictEqual(synced.pushedFromId, "f1", "pushedFromId survives mpSyncFromDom");
    await env.ctx.mpSaveSection("focus");
    await env.settle();
    const reSaved = env.posts[env.posts.length - 1].body.monthlyPlan.focus.find((f) => f.id === synced.id);
    assert.strictEqual(reSaved.pushedFrom, AUG, "a later ordinary save does not drop the marker");

    /* ---------- 5. chained push records its immediate source ---------- */
    env.ctx.mpOpenPushForward(synced.id);
    env.ctx.mpSetPushTarget({ value: DEC });
    await env.ctx.mpPushFocusForward(synced.id);
    await env.settle();
    const dec = focusOf(env, DEC);
    assert.strictEqual(dec.length, 1, "the chained copy lands in December");
    assert.strictEqual(dec[0].pushedFrom, OCT, "a re-push records the month it was pushed from this time");
    assert.strictEqual(dec[0].pushedFromId, synced.id, "…and the item it was copied from");
    assert.strictEqual(dec[0].done, false, "the chained copy is unticked too");
    assert.strictEqual(focusOf(env, OCT).length, 2, "October keeps its own record of the push");
  }

  /* ---------- 6. de-dupe: same item, same month, twice ---------- */
  {
    const env = await boot({ plans: { [AUG]: { ym: AUG, focus: [
      { id: "f1", title: "Rebuild the onboarding call", rockRef: "0", notes: "", done: false },
    ] } }, rocks: ROCKS });
    await openPlan(env, AUG);

    env.ctx.mpOpenPushForward("f1");
    env.ctx.mpSetPushTarget({ value: OCT });
    await env.ctx.mpPushFocusForward("f1");
    await env.settle();
    assert.strictEqual(focusOf(env, OCT).length, 1, "first push copies the item");

    const postsBefore = env.posts.filter((p) => p.body.monthlyPlan && p.body.monthlyPlan.ym === OCT).length;
    env.ctx.mpOpenPushForward("f1");
    env.ctx.mpSetPushTarget({ value: OCT });
    await env.ctx.mpPushFocusForward("f1");
    await env.settle();
    assert.strictEqual(focusOf(env, OCT).length, 1, "pushing the same item to the same month does not duplicate");
    assert.strictEqual(env.posts.filter((p) => p.body.monthlyPlan && p.body.monthlyPlan.ym === OCT).length,
      postsBefore, "the duplicate push writes nothing");
    assert.ok(env.ctx.__mpState.pushNote.warn, "the duplicate is reported as a warning");
    assert.ok(/Already in October 2026/.test(env.ctx.__mpState.pushNote.text), "…naming the month it is already in");

    // a DIFFERENT month is still allowed (a pushed item can legitimately appear in several)
    env.ctx.mpOpenPushForward("f1");
    env.ctx.mpSetPushTarget({ value: DEC });
    await env.ctx.mpPushFocusForward("f1");
    await env.settle();
    assert.strictEqual(focusOf(env, DEC).length, 1, "the same item can still be pushed to another month");

    // guard: an untitled item is not pushed
    env.ctx.mpAddFocus();
    const blank = env.ctx.__mpState.plan.focus[1];
    env.ctx.mpOpenPushForward(blank.id);
    env.ctx.mpSetPushTarget({ value: SEP });
    await env.ctx.mpPushFocusForward(blank.id);
    await env.settle();
    assert.strictEqual(focusOf(env, SEP).length, 0, "an untitled item is not pushed anywhere");
    assert.ok(env.alerts.some((a) => /title/i.test(a)), "…and the user is told why");

    // cancelling closes the picker without writing anything
    const postCount = env.posts.length;
    env.ctx.mpOpenPushForward("f1");
    env.ctx.mpClosePushForward();
    assert.strictEqual(env.ctx.__mpState.pushOpen, null, "Cancel closes the picker");
    assert.strictEqual(env.posts.length, postCount, "Cancel writes nothing");
    assert.ok(!/mp-push"/.test(env.body.innerHTML), "the picker is no longer rendered");
  }

  /* ---------- 7. existing focus-item / Rock behaviour is unchanged ---------- */
  {
    const env = await boot({ plans: { [AUG]: { ym: AUG, focus: [
      { id: "f1", title: "Keep", rockRef: "1", notes: "n", done: false },
    ], priorities: [{ id: "p1", title: "Proj", owner: "Ash", status: "In Progress", notes: "pn" }] } }, rocks: ROCKS });
    await openPlan(env, AUG);

    // Rock badge + Rock select still reflect the link
    assert.ok(env.body.innerHTML.includes('<span class="mp-linktag">↳ Rock 2</span>'), "Rock badge unchanged");
    assert.ok(/<option value="1" selected>Rock 2: Open the second studio<\/option>/.test(env.body.innerHTML),
      "the Rock select still preselects the linked Rock");
    assert.strictEqual(rowOf(env, "f1").querySelector('[data-ff="rockRef"]').value, "1", "Rock link round-trips");

    // + Add focus item
    env.ctx.mpAddFocus();
    assert.strictEqual(env.ctx.__mpState.plan.focus.length, 2, "+ Add focus item adds a row");
    const added = env.ctx.__mpState.plan.focus[1];
    assert.strictEqual(added.done, false, "a new focus item starts not done");
    assert.strictEqual(added.pushedFrom, undefined, "a new focus item carries no push marker");
    assert.strictEqual(env.body.focusRows().length, 2, "…and it is rendered");

    // relink a Rock via the select, then save
    rowOf(env, "f1").querySelector('[data-ff="title"]').value = "Keep (edited)";
    rowOf(env, added.id).querySelector('[data-ff="title"]').value = "Second thing";
    rowOf(env, added.id).querySelector('[data-ff="rockRef"]').value = "0";
    await env.ctx.mpSaveSection("focus");
    await env.settle();
    const saved = env.posts[env.posts.length - 1].body.monthlyPlan.focus;
    assert.strictEqual(saved.length, 2, "both items save");
    assert.strictEqual(saved[0].title, "Keep (edited)", "edited titles save");
    assert.strictEqual(saved[1].rockRef, "0", "a newly linked Rock saves");
    assert.strictEqual(env.ctx.__mpState.plan.priorities.length, 1, "priorities are untouched by focus work");

    // a milestone cascaded down from quarterly.html keeps its extra fields through the
    // DOM round-trip (they have no inputs of their own, so a sync must carry them)
    env.ctx.__mpState.plan.focus.push({ id: "q1", linkId: "qglink:2026-Q3:rock:r1:2026-08",
      sourceType: "quarterly", title: "Cascaded milestone", successMeasure: "92%",
      owner: "Ash", status: "Not Started", rockRef: "", notes: "", done: false });
    env.ctx.drawMonthlyPlan();
    rowOf(env, "q1").querySelector('[data-ff="title"]').value = "Cascaded milestone (edited)";
    env.ctx.mpSyncFromDom();
    const q1 = env.ctx.__mpState.plan.focus.find((f) => f.id === "q1");
    assert.strictEqual(q1.title, "Cascaded milestone (edited)", "editing a cascaded milestone works");
    assert.strictEqual(q1.linkId, "qglink:2026-Q3:rock:r1:2026-08", "its cascade linkId survives a sync");
    assert.strictEqual(q1.successMeasure, "92%", "its success measure survives a sync");
    assert.strictEqual(q1.owner, "Ash", "its owner survives a sync");

    // remove still removes
    const delBtn = { closest: () => rowOf(env, "f1") };
    const before = env.ctx.__mpState.plan.focus.length;
    env.ctx.mpRemoveFocus(delBtn);
    const left = env.ctx.__mpState.plan.focus;
    assert.strictEqual(left.length, before - 1, "✕ removes the item");
    assert.ok(!left.some((f) => f.id === "f1"), "…the right one");
    assert.strictEqual(left[0].title, "Second thing", "…and the others stay");
  }

  /* ---------- 8. kpi-store whitelist ---------- */
  {
    // Run the store's real sanitiser (plus the validYm it depends on) in isolation.
    const grab = (name) => {
      const start = STORE_SRC.indexOf("function " + name);
      assert.ok(start >= 0, name + " exists in kpi-store.js");
      const end = STORE_SRC.indexOf("\n}", start);
      return STORE_SRC.slice(start, end + 2);
    };
    const tableStart = STORE_SRC.indexOf("const MONTHLY_FOCUS_STRINGS");
    assert.ok(tableStart >= 0, "the focus field table exists in kpi-store.js");
    const table = STORE_SRC.slice(tableStart, STORE_SRC.indexOf("};", tableStart) + 2);
    const sandbox = { module: {} };
    vm.createContext(sandbox);
    vm.runInContext(grab("validYm") + "\n" + table + "\n" + grab("cleanMonthlyFocus") +
      "\n;module.exports = { cleanMonthlyFocus, validYm };", sandbox);
    const { cleanMonthlyFocus } = sandbox.module.exports;

    const out = cleanMonthlyFocus([
      { id: "f1", title: "Keep me", rockRef: "1", notes: "n", done: true,
        pushedFrom: "2026-08", pushedFromId: "src1", junk: "drop me", __proto__x: 1 },
      { id: "f2", title: "Plain", rockRef: 2, notes: "", done: false },
      { id: "f3", title: "Bad marker", pushedFrom: "nonsense", pushedFromId: "x" },
      // a milestone cascaded down from quarterly.html — a second writer of this same list
      { id: "f4", linkId: "qglink:2026-Q3:rock:r1:2026-10", sourceType: "quarterly",
        title: "Hit 92% retention", monthlyOutcome: "Hit 92% retention", milestone: "Hit 92% retention",
        successMeasure: "92% at month end", rockRef: "r1", priorityRef: null,
        sourceQuarter: "2026-Q3", owner: "Ash", status: "Not Started", notes: "", done: false },
      null,
    ]);
    assert.strictEqual(out.length, 4, "null entries are dropped");

    const q = out[3];
    assert.strictEqual(q.linkId, "qglink:2026-Q3:rock:r1:2026-10",
      "the quarterly cascade's idempotency key survives a monthly save");
    ["sourceType", "monthlyOutcome", "milestone", "successMeasure", "sourceQuarter", "owner", "status"]
      .forEach((k) => assert.ok(q[k], "quarterly cascade field " + k + " survives"));
    assert.strictEqual(q.rockRef, "r1", "a quarterly source ref is not rewritten");
    assert.strictEqual(q.priorityRef, null, "a null ref stays null");
    assert.deepStrictEqual(Object.keys(out[0]).sort(),
      ["done", "id", "notes", "pushedFrom", "pushedFromId", "rockRef", "title"],
      "the whitelist keeps exactly the known focus fields");
    assert.strictEqual(out[0].junk, undefined, "unknown fields are dropped server-side");
    assert.strictEqual(out[0].pushedFrom, "2026-08", "pushedFrom persists");
    assert.strictEqual(out[0].pushedFromId, "src1", "pushedFromId persists");
    assert.strictEqual(out[0].done, true, "done persists");
    assert.strictEqual(out[1].rockRef, 2, "a numeric rockRef is preserved as-is");
    assert.strictEqual(out[1].pushedFrom, undefined, "no marker is invented for ordinary items");
    assert.strictEqual(out[2].pushedFrom, undefined, "a malformed pushedFrom is dropped");
    assert.strictEqual(cleanMonthlyFocus(new Array(80).fill({ title: "x" })).length, 60, "runaway lists are capped");

    // the sanitiser only touches focus — other monthly-plan sections merge as before
    assert.ok(/if \(Array\.isArray\(incoming\.focus\)\) incoming\.focus = cleanMonthlyFocus/.test(STORE_SRC),
      "focus is sanitised only when it is part of the write");
    assert.ok(/const merged = \{ \.\.\.existing, \.\.\.incoming, lastUpdated/.test(STORE_SRC),
      "monthly-plan writes still merge over the existing record");
  }

  console.log("v90-monthly-push-forward.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
