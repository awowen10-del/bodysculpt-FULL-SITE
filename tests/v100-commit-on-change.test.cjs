// v100 regression: the whole "changes the display but never writes" bug class, closed.
// Every control in the Monthly Plan now commits on its own section path — dropdowns and
// toggles on change, text fields on blur — and each one is asserted here the same way the
// v98/v99 fixes were: change it, reload from the store, it's still there.
// Guardrails also asserted: no write when nothing changed, no cross-section writes, and the
// v98/v99 fixes plus the Save buttons still behave.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, openPlan } = require("./lib/monthly-env.cjs");

const MONTHLY = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const WEEKLY = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const AUG = "2026-08";
const ROCKS = [{ title: "Retention above 92%" }, { title: "Open the second studio" }];

const plan = () => ({
  ym: AUG,
  focus: [{ id: "f1", title: "Rebuild the onboarding call", rockRef: "", notes: "", done: false }],
  priorities: [{ id: "p1", title: "Redo the garden", owner: "", status: "Not Started", notes: "" }],
  notes: "",
  review: { wins: "", notDone: "", carryForward: "", blockers: "" },
});
const fRow = (env) => env.body.focusRows()[0];
const pRow = (env) => env.body.rows().filter((r) => r.kind === "prio")[0];

async function fresh(plans) {
  const env = await boot({ plans, rocks: ROCKS });
  await openPlan(env, AUG);
  return env;
}
// change → commit → reload from the store → read it back
async function roundTrip(env, commit, read) {
  await commit(env);
  await env.settle();
  const back = await fresh({ [AUG]: env.plans[AUG] });
  return read(back.ctx.__mpState.plan);
}

(async () => {
  assert.ok(/<!-- build v100 · commit-on-change -->/.test(MONTHLY), "build stamp is v100 · commit-on-change");

  /* ---------- 1. every control the audit found now round-trips ---------- */
  const CONTROLS = [
    { name: "focus title (blur)", section: "focus",
      change: (e) => { fRow(e).querySelector('[data-ff="title"]').value = "Typed, never saved before"; },
      read: (p) => p.focus[0].title, expect: "Typed, never saved before" },
    { name: "focus Rock link (change) — v99", section: "focus",
      change: (e) => { fRow(e).querySelector('[data-ff="rockRef"]').value = "1"; },
      read: (p) => p.focus[0].rockRef, expect: "1", via: (e) => e.ctx.mpQuickSave() },
    { name: "focus Done (change) — v98", section: "focus",
      change: (e) => { fRow(e).querySelector('[data-ff="done"]').checked = true; },
      read: (p) => p.focus[0].done, expect: true,
      via: (e) => e.ctx.mpToggleFocus({ checked: true, closest: () => fRow(e) }) },
    { name: "personal priority title (blur)", section: "priorities",
      change: (e) => { pRow(e).querySelector('[data-pf="title"]').value = "Book the Italy trip"; },
      read: (p) => p.priorities[0].title, expect: "Book the Italy trip" },
    { name: "personal priority Owner (change)", section: "priorities",
      change: (e) => { pRow(e).querySelector('[data-pf="owner"]').value = "Ash"; },
      read: (p) => p.priorities[0].owner, expect: "Ash" },
    { name: "personal priority Status (change) — this section's 'done'", section: "priorities",
      change: (e) => { pRow(e).querySelector('[data-pf="status"]').value = "Done"; },
      read: (p) => p.priorities[0].status, expect: "Done" },
    { name: "personal priority notes (blur)", section: "priorities",
      change: (e) => { pRow(e).querySelector('[data-pf="notes"]').value = "quotes in"; },
      read: (p) => p.priorities[0].notes, expect: "quotes in" },
    { name: "Notes & Issues textarea (blur)", section: "notes",
      change: (e) => { e.body.querySelector('[data-field="mpnotes"]').value = "Watch the churn spike"; },
      read: (p) => p.notes, expect: "Watch the churn spike" },
    { name: "Month-End Review · wins (blur)", section: "review",
      change: (e) => { e.body.querySelector('[data-mpreview="wins"]').value = "Retention held"; },
      read: (p) => p.review.wins, expect: "Retention held" },
    { name: "Month-End Review · blockers (blur)", section: "review",
      change: (e) => { e.body.querySelector('[data-mpreview="blockers"]').value = "Staffing"; },
      read: (p) => p.review.blockers, expect: "Staffing" },
  ];

  for (const c of CONTROLS) {
    const env = await fresh({ [AUG]: plan() });
    const got = await roundTrip(env, async (e) => {
      c.change(e);
      await (c.via ? c.via(e) : e.ctx.mpCommit(c.section));
    }, c.read);
    assert.strictEqual(got, c.expect, c.name + " survives a reload");
    // it went out on ITS OWN section path — nothing else was written
    const posted = env.posts[env.posts.length - 1].body.monthlyPlan;
    assert.deepStrictEqual(Object.keys(posted).sort(), [c.section, "ym"].sort(),
      c.name + " writes only its own section");
  }

  /* ---------- 2. deleting an item is a commit too ---------- */
  {
    const env = await fresh({ [AUG]: plan() });
    env.ctx.mpRemoveFocus({ closest: () => fRow(env) });
    await env.settle();
    let back = await fresh({ [AUG]: env.plans[AUG] });
    assert.strictEqual(back.ctx.__mpState.plan.focus.length, 0, "a deleted focus item stays deleted");

    const env2 = await fresh({ [AUG]: plan() });
    env2.ctx.mpRemovePrio({ closest: () => pRow(env2) });
    await env2.settle();
    back = await fresh({ [AUG]: env2.plans[AUG] });
    assert.strictEqual(back.ctx.__mpState.plan.priorities.length, 0, "a deleted personal item stays deleted");
  }

  /* ---------- 3. no excessive saves ---------- */
  {
    const env = await fresh({ [AUG]: plan() });
    for (const s of ["focus", "priorities", "notes", "review"]) { await env.ctx.mpCommit(s); await env.settle(); }
    assert.strictEqual(env.posts.length, 0, "tabbing through without editing writes nothing");

    // one edit = one write, and committing again writes nothing more
    fRow(env).querySelector('[data-ff="title"]').value = "Edited once";
    await env.ctx.mpCommit("focus");
    await env.settle();
    assert.strictEqual(env.posts.length, 1, "an edit writes exactly once");
    await env.ctx.mpCommit("focus");
    await env.settle();
    assert.strictEqual(env.posts.length, 1, "re-committing an unchanged section writes nothing");

    // adding an empty row deliberately does not write; typing into it does
    env.ctx.mpAddFocus();
    await env.settle();
    assert.strictEqual(env.posts.length, 1, "adding an empty row writes nothing");
    const added = env.ctx.__mpState.plan.focus[1];
    env.body.focusRows()[1].querySelector('[data-ff="title"]').value = "Now it has content";
    await env.ctx.mpCommit("focus");
    await env.settle();
    assert.strictEqual(env.posts.length, 2, "…typing a title commits the new row");
    const back = await fresh({ [AUG]: env.plans[AUG] });
    assert.strictEqual(back.ctx.__mpState.plan.focus.find((f) => f.id === added.id).title, "Now it has content",
      "…and it survives a reload");
  }

  /* ---------- 4. an unset Owner stays unset ---------- */
  {
    // the "—" placeholder had no value attribute, so a sync turned an unset owner into the
    // literal "—" — harmless while nothing auto-saved, a real corruption once it does
    assert.ok(/<option value="\$\{esc\(o\)\}"/.test(MONTHLY), "every Owner option carries an explicit value");
    const env = await fresh({ [AUG]: plan() });
    env.ctx.mpSyncFromDom();
    assert.strictEqual(env.ctx.__mpState.plan.priorities[0].owner, "", "an unset owner stays \"\", not \"—\"");
  }

  /* ---------- 5. nothing else changed ---------- */
  {
    const env = await fresh({ [AUG]: plan() });
    // the Save buttons still save unconditionally
    await env.ctx.mpSaveSection("focus");
    await env.settle();
    assert.strictEqual(env.posts.length, 1, "the Save button still writes even with no edit");

    // the v93 notes modal still commits, on the focus path
    env.ctx.mpOpenNotes("f1");
    env.ctx.document.getElementById("mpNotesEd").innerHTML = "<b>rich note</b>";
    env.ctx.mpSaveNotes();
    await env.settle();
    const notesPost = env.posts[env.posts.length - 1].body.monthlyPlan;
    assert.deepStrictEqual(Object.keys(notesPost).sort(), ["focus", "ym"], "the notes modal writes the focus section");
    assert.ok(notesPost.focus[0].notes.includes("<b>rich note</b>"), "…with the rich note");

    // and the push-forward flow is untouched
    env.ctx.mpOpenPushForward("f1");
    env.ctx.mpSetPushTarget({ value: "2026-10" });
    await env.ctx.mpPushFocusForward("f1");
    await env.settle();
    assert.strictEqual(env.plans["2026-10"].focus.length, 1, "push forward still copies to the target month");
    assert.strictEqual(env.plans["2026-10"].focus[0].done, false, "…with done reset");
  }

  /* ---------- 6. the weekly app was audited and needs no change ---------- */
  {
    // every weekly control already persists — asserted here so a future edit that drops a
    // save path from one of them fails loudly instead of silently losing data.
    const savers = {
      "wpItemBlur": /wpSaveSection/, "wpRemoveItem": /wpSaveSection/, "wpPullMonthlyProject": /wpSaveSection/,
      "wpToggleDoneRef": /wpSaveSection/, "wpToggleReviewChecklist": /wpSaveSection/,
      "wpReorderInCell": /wpSaveSection/, "wpPlaceRefAt": /wpSaveSection/, "wpMoveThisWeek": /wpSaveSection/,
      "wpSetWeekLocation": /wpSaveSection/, "wpClearWeekLocation": /wpSaveSection/,
      "wpSetLocationDefault": /wpSaveLocDefaults/, "wpSetRecurrence": /wpSave(Defaults|Training)/,
      "wpDefaultTitleBlur": /wpSave(Defaults|Training)/,
    };
    for (const [fn, re] of Object.entries(savers)) {
      const start = WEEKLY.indexOf("function " + fn + "(");
      assert.ok(start > 0, "weekly function exists: " + fn);
      const body = WEEKLY.slice(start, WEEKLY.indexOf("\n}", start));
      assert.ok(re.test(body), "weekly control still persists: " + fn);
    }
    // the weekly text fields still commit on blur, not per keystroke
    assert.ok(/onblur="wpSaveSection\('review'\)"/.test(WEEKLY), "weekly review textareas save on blur");
    assert.ok(/onblur="wpSaveSection\('timeBlocks'\)"/.test(WEEKLY), "weekly time blocks save on blur");
    assert.ok(!/oninput="wp(Save|Commit)/.test(WEEKLY), "nothing in the weekly app saves per keystroke");
    assert.ok(!/oninput="mp(Save|Commit)/.test(MONTHLY), "nothing in the monthly plan saves per keystroke");
  }

  console.log("v100-commit-on-change.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
