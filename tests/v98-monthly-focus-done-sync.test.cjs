// v98 regression, two parts:
//   PART 1 (bug) — ticking a focus item Done used to update only the row's class, so the
//     value never reached the store unless you also pressed the section's Save button; a
//     tick was lost on navigation. A tick now saves itself, and survives a reload.
//   PART 2 — the weekly cascade anchor reflects that done-state, read from the SAME monthly
//     -plan record (Monthly is the source of truth; the anchor stays read-only, so there is
//     no second copy that can diverge), for whichever month the week being viewed falls in.
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

const AUG = "2026-08";
const ROCKS = [{ title: "Retention above 92%" }, { title: "Open the second studio" }];
const focusRow = (env, id) => env.body.focusRows().find((r) => r.getAttribute("data-focus") === id);

// Tick the Done box the way a click does: the checkbox flips, then onchange fires.
async function tickDone(env, id, on) {
  const row = focusRow(env, id);
  row.querySelector('[data-ff="done"]').checked = on;
  await env.ctx.mpToggleFocus({ checked: on, closest: () => row });
  await env.settle();
}

(async () => {
  /* ---------- build stamp (both files changed) ---------- */
  // monthly.html moves on with every release, so it is pinned to ">= v98"; index.html was
  // last touched by this change, so its exact stamp still stands.
  const mStamp = /<!-- build v(\d+) · [a-z0-9-]+ -->/.exec(MONTHLY);
  assert.ok(mStamp && Number(mStamp[1]) >= 98, "monthly.html stamped v98 or later");
  // index.html now moves with every release too (v101 made the stamp visible on both
  // pages and pinned them to the same string), so this is ">= v98" as well.
  const wStamp = /build v(\d+) · [a-z0-9-]+/.exec(WEEKLY);
  assert.ok(wStamp && Number(wStamp[1]) >= 98, "index.html stamped v98 or later");

  /* ================= PART 1: a tick persists by itself ================= */
  {
    const env = await boot({ plans: { [AUG]: { ym: AUG, focus: [
      { id: "f1", title: "Rebuild the onboarding call", rockRef: "1", notes: "with Dan", done: false },
      { id: "f2", title: "Price review", rockRef: "", notes: "", done: false },
    ] } }, rocks: ROCKS });
    await openPlan(env, AUG);
    assert.strictEqual(env.posts.length, 0, "opening the month writes nothing");

    // the bug: this used to be the ONLY thing a tick did
    await tickDone(env, "f1", true);
    assert.strictEqual(env.posts.length, 1, "a tick saves itself — no Save press needed");
    const posted = env.posts[0].body.monthlyPlan;
    assert.strictEqual(posted.ym, AUG, "…against this month");
    assert.deepStrictEqual(Object.keys(posted).sort(), ["focus", "ym"], "…on the normal focus section path");
    assert.strictEqual(posted.focus.find((f) => f.id === "f1").done, true, "…with the ticked item done");
    assert.strictEqual(posted.focus.find((f) => f.id === "f2").done, false, "…and the others untouched");
    assert.strictEqual(env.plans[AUG].focus[0].done, true, "the store holds the done-state");

    // navigate away and come back
    const back = await boot({ plans: { [AUG]: env.plans[AUG] }, rocks: ROCKS });
    await openPlan(back, AUG);
    const item = back.ctx.__mpState.plan.focus.find((f) => f.id === "f1");
    assert.strictEqual(item.done, true, "…and it is STILL ticked after a reload");
    assert.ok(/data-focus="f1"[\s\S]*?data-ff="done" checked/.test(back.body.innerHTML), "…and renders ticked");
    assert.ok(/<div class="mp-item done" data-focus="f1"/.test(back.body.innerHTML), "…in the done row state");
    // nothing else about the item moved
    assert.strictEqual(item.title, "Rebuild the onboarding call", "the title is untouched");
    assert.strictEqual(item.rockRef, "1", "the Rock link is untouched");
    assert.strictEqual(item.notes, "with Dan", "the notes are untouched");

    // and un-ticking persists too
    await tickDone(back, "f1", false);
    assert.strictEqual(back.plans[AUG].focus[0].done, false, "un-ticking persists as well");
    const back2 = await boot({ plans: { [AUG]: back.plans[AUG] }, rocks: ROCKS });
    await openPlan(back2, AUG);
    assert.strictEqual(back2.ctx.__mpState.plan.focus[0].done, false, "…through a reload");

    // the store keeps `done` on focus items (it always did — the write was what was missing)
    const start = STORE_SRC.indexOf("function cleanMonthlyFocus");
    const fn = STORE_SRC.slice(start, STORE_SRC.indexOf("\n}", start) + 2);
    assert.ok(/done: !!f\.done/.test(fn), "done is whitelisted on focus items in kpi-store");
  }

  /* ================= PART 2: the weekly anchor reflects it ================= */
  {
    // Two weeks in different months, so the month→week resolution is actually exercised.
    const AUG_WEEK = "2026-08-10", SEP_WEEK = "2026-09-07";
    const monthFocus = {
      "2026-08": [
        { id: "f1", title: "Rebuild the onboarding call", rockRef: "1", notes: "with Dan", done: true },
        { id: "f2", title: "Price review", rockRef: "", notes: "", done: false },
      ],
      "2026-09": [{ id: "s1", title: "September thing", rockRef: "", notes: "", done: false }],
    };
    const env = await bootWeekly({
      defaults: [],
      monthFocus,
      plans: { [AUG_WEEK]: { weekEnding: AUG_WEEK }, [SEP_WEEK]: { weekEnding: SEP_WEEK } },
    });

    await env.ctx.loadWeeklyPlan(AUG_WEEK);
    await env.settle();
    let html = env.ctx.document.getElementById("wpBody").innerHTML;

    assert.ok(html.includes("August focus"), "the anchor names the week's month");
    assert.ok(html.includes("from Monthly Plan"), "…and its source");
    const doneRow = /<li class="wp-anchor-item wp-anchor-done">([\s\S]*?)<\/li>/.exec(html);
    assert.ok(doneRow, "the item ticked on Monthly renders in the done state");
    assert.ok(doneRow[1].includes("Rebuild the onboarding call"), "…and it is the right item");
    assert.ok(doneRow[1].includes('<span class="wp-anchor-tick">✓</span>'), "…shown with an explicit tick");
    assert.ok(/\.wp-anchor-done\{[^}]*line-through/.test(WEEKLY), "…and struck through");
    assert.ok(html.includes('<li class="wp-anchor-item">Price review</li>'),
      "an item that is NOT done renders plain — no tick, no strike");
    assert.strictEqual((html.match(/wp-anchor-done/g) || []).length, 1, "exactly one item reads as done");

    // the right month resolves for the week being viewed
    await env.ctx.loadWeeklyPlan(SEP_WEEK);
    await env.settle();
    html = env.ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(html.includes("September focus"), "a September week shows September's focus");
    assert.ok(html.includes("September thing"), "…its items");
    assert.ok(!html.includes("Rebuild the onboarding call"), "…and not August's");
    assert.ok(!html.includes("wp-anchor-done"), "…with September's own (untouched) done-state");

    // read-only: the anchor renders no control and writes nothing anywhere
    const anchor = html.slice(html.indexOf('<div class="wp-anchor">'), html.indexOf("</ul>"));
    ["<input", "onclick", "onchange", "contenteditable"].forEach((c) =>
      assert.ok(!anchor.includes(c), "the anchor stays read-only: no " + c));
    assert.ok(!env.posts.some((p) => p.body.monthlyPlan),
      "loading a week and rendering the anchor writes nothing to the monthly record");
    // v112 note: the weekly app DOES now write one thing back — a linked project task's
    // done-state, and only when you tick one (see v112-monthly-done-single-source). That is
    // what makes the monthly item the single source of truth rather than a second copy. The
    // anchor itself is still what it was here: read-only, rendering only, no control, no save.
    assert.ok(!/monthfocus[^)]*method:"POST"/.test(WEEKLY),
      "…and the ?monthfocus= cascade read is still a read");

    // the anchor is derived state only — the week's own data is untouched by any of it
    const st = env.ctx.__wpState;
    assert.strictEqual(st.plan.weekEnding, SEP_WEEK, "the week's plan still loads normally");
    assert.ok(!("monthFocus" in st.plan) && !("focus" in st.plan),
      "no copy of the monthly focus is stored on the weekly plan");
  }

  /* ---------- the two apps agree on where done lives ---------- */
  {
    // Monthly writes it; the weekly GET reads that same record back out.
    assert.ok(/if \(req\.method === "GET" && url\.searchParams\.get\("monthfocus"\)\)/.test(STORE_SRC),
      "?monthfocus= serves the monthly-plan record");
    const start = STORE_SRC.indexOf('url.searchParams.get("monthfocus")');
    const handler = STORE_SRC.slice(start, start + 400);
    assert.ok(/saved\.focus/.test(handler) && !/map\(/.test(handler),
      "…returning the focus items as stored, done-state included");
    const sandbox = { module: {} };
    vm.createContext(sandbox);
    const cmf = STORE_SRC.indexOf("function cleanMonthlyFocus");
    const tbl = STORE_SRC.indexOf("const MONTHLY_FOCUS_STRINGS");
    vm.runInContext(
      STORE_SRC.slice(STORE_SRC.indexOf("function validYm"), STORE_SRC.indexOf("\n}", STORE_SRC.indexOf("function validYm")) + 2) +
      "\n" + STORE_SRC.slice(tbl, STORE_SRC.indexOf("};", tbl) + 2) +
      "\n" + STORE_SRC.slice(cmf, STORE_SRC.indexOf("\n}", cmf) + 2) +
      "\n;module.exports = { cleanMonthlyFocus };", sandbox);
    const out = sandbox.module.exports.cleanMonthlyFocus([{ id: "f1", title: "T", done: true, rockRef: "1" }]);
    assert.strictEqual(out[0].done, true, "a ticked item survives the store's whitelist");
    assert.strictEqual(out[0].rockRef, "1", "…with its Rock link");
  }

  console.log("v98-monthly-focus-done-sync.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
