// v99 regression: changing a focus item's Rock link persists by itself.
// Same bug shape as the v98 Done tick — mpQuickSave synced the DOM and redrew (so the
// ↳ Rock N badge updated) but never wrote, so the new link was lost on navigation.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, openPlan } = require("./lib/monthly-env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const AUG = "2026-08";
const ROCKS = [{ title: "Retention above 92%" }, { title: "Open the second studio" }];
const row = (env, id) => env.body.focusRows().find((r) => r.getAttribute("data-focus") === id);

// Pick a Rock the way the browser does: the select's value changes, then onchange fires.
async function pickRock(env, id, value) {
  row(env, id).querySelector('[data-ff="rockRef"]').value = value;
  await env.ctx.mpQuickSave();
  await env.settle();
}

(async () => {
  assert.ok(/<!-- build v99 · focus-rock-link-save -->/.test(HTML), "build stamp is v99 · focus-rock-link-save");

  const env = await boot({ plans: { [AUG]: { ym: AUG, focus: [
    { id: "f1", title: "Rebuild the onboarding call", rockRef: "", notes: "with Dan", done: true },
    { id: "f2", title: "Price review", rockRef: "0", notes: "", done: false },
  ] } }, rocks: ROCKS });
  await openPlan(env, AUG);
  assert.strictEqual(env.posts.length, 0, "opening the month writes nothing");

  /* ---------- 1. linking a Rock saves itself ---------- */
  {
    await pickRock(env, "f1", "1");
    assert.strictEqual(env.posts.length, 1, "picking a Rock saves — no Save press needed");
    const posted = env.posts[0].body.monthlyPlan;
    assert.strictEqual(posted.ym, AUG, "…against this month");
    assert.deepStrictEqual(Object.keys(posted).sort(), ["focus", "ym"], "…on the normal focus section path");
    assert.strictEqual(posted.focus.find((f) => f.id === "f1").rockRef, "1", "…with the new Rock link");
    assert.strictEqual(posted.focus.find((f) => f.id === "f2").rockRef, "0", "…and other items untouched");

    // the badge still updates on the redraw, exactly as before
    assert.ok(/data-focus="f1"[\s\S]*?<span class="mp-linktag">↳ Rock 2<\/span>/.test(env.body.innerHTML),
      "the ↳ Rock badge re-renders for the new link");
    assert.ok(/<option value="1" selected>Rock 2: Open the second studio<\/option>/.test(env.body.innerHTML),
      "…and the select shows it");
  }

  /* ---------- 2. it survives navigating away and back ---------- */
  {
    const back = await boot({ plans: { [AUG]: env.plans[AUG] }, rocks: ROCKS });
    await openPlan(back, AUG);
    const item = back.ctx.__mpState.plan.focus.find((f) => f.id === "f1");
    assert.strictEqual(item.rockRef, "1", "the Rock link is STILL set after a reload");
    assert.ok(back.body.innerHTML.includes('<span class="mp-linktag">↳ Rock 2</span>'), "…and renders");

    // nothing else on the item moved when the link was saved
    assert.strictEqual(item.done, true, "the done-state is untouched");
    assert.strictEqual(item.title, "Rebuild the onboarding call", "the title is untouched");
    assert.strictEqual(item.notes, "with Dan", "the notes are untouched");

    /* ---------- 3. unlinking persists too ---------- */
    await pickRock(back, "f1", "");
    assert.strictEqual(back.plans[AUG].focus[0].rockRef, "", "clearing the link persists");
    const back2 = await boot({ plans: { [AUG]: back.plans[AUG] }, rocks: ROCKS });
    await openPlan(back2, AUG);
    assert.strictEqual(back2.ctx.__mpState.plan.focus[0].rockRef, "", "…through a reload");
    // scope to f1's own row — f2 legitimately still has a badge
    const h = back2.body.innerHTML;
    const start = h.indexOf('data-focus="f1"');
    const f1Block = h.slice(start, h.indexOf("data-focus", start + 20));
    assert.ok(!f1Block.includes("mp-linktag"), "…and the badge is gone");
    assert.strictEqual(back2.ctx.__mpState.plan.focus[0].done, true, "…with the done-state still intact");
  }

  /* ---------- 4. the v98 Done fix and the rest of the item still work ---------- */
  {
    const env2 = await boot({ plans: { [AUG]: { ym: AUG, focus: [
      { id: "f1", title: "Rebuild the onboarding call", rockRef: "0", notes: "n", done: false },
    ] } }, rocks: ROCKS });
    await openPlan(env2, AUG);

    const r = row(env2, "f1");
    r.querySelector('[data-ff="done"]').checked = true;
    await env2.ctx.mpToggleFocus({ checked: true, closest: () => r });
    await env2.settle();
    assert.strictEqual(env2.plans[AUG].focus[0].done, true, "a Done tick still saves itself (v98)");
    assert.strictEqual(env2.plans[AUG].focus[0].rockRef, "0", "…without disturbing the Rock link");

    // the section Save button still works the same way
    row(env2, "f1").querySelector('[data-ff="title"]').value = "Edited title";
    await env2.ctx.mpSaveSection("focus");
    await env2.settle();
    assert.strictEqual(env2.plans[AUG].focus[0].title, "Edited title", "the Save button path is unchanged");

    // and the personal section is not dragged into the focus save
    assert.ok(!env2.posts.some((p) => p.body.monthlyPlan && "priorities" in p.body.monthlyPlan),
      "a focus save never writes the personal priorities section");
  }

  console.log("v99-focus-rock-link-save.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
