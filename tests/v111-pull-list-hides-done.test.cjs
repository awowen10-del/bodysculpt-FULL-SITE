// v111 (bug fix): the weekly Projects card's "Pull from Monthly" dropdown no longer offers a
// monthly project that is already DONE.
//
// The bug: the picker (v61, widened to both monthly lists in v105) excluded only the items
// already sitting in the week being viewed, matched by sourceProjectId. It never looked at
// done-state — so the moment a project was ticked off, it was still on offer, and could be
// pulled into next week, and the week after that, for ever.
//
// The fix treats an item as done by EITHER measure:
//   • done on the Monthly plan — the item's own done-state (the v98 focus Done tick, the v103
//     personal Status), read through wpAnchorDone from the SAME monthly record the anchor
//     renders from, so the dropdown and the anchor cannot diverge;
//   • done on the Weekly — a copy pulled into any week of that month was ticked there, matched
//     back to its monthly source by the existing sourceProjectId (linkId as fallback).
//
// It ONLY narrows the dropdown. Nothing is deleted or hidden: the item still renders on the
// Monthly plan in its done state, it still shows (struck through) in the weekly anchor, and
// weekly copies already pulled stay exactly as they are. Logic only — no new stored field.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/env.cjs");
const { boot: bootMonthly, openPlan } = require("./lib/monthly-env.cjs");

const WEEKLY = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const MONTHLY = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");

const AUG = "2026-08";
// the Mondays of August 2026 — the weeks a 2026-08 monthly item can be pulled into
const W1 = "2026-08-03", W2 = "2026-08-10", W3 = "2026-08-17", W4 = "2026-08-24", W5 = "2026-08-31";
const SEP_WEEK = "2026-09-07";

// f1/p1 open · f2/p2 done ON MONTHLY · f3/p3 done on a WEEK (planted per-test) · f4/p4 open
const MONTH_FOCUS = {
  "2026-08": [
    { id: "f1", title: "Rebuild the onboarding call", rockRef: "1", notes: "", done: false },
    { id: "f2", title: "Price review", rockRef: "", notes: "", done: true },
    { id: "f3", title: "Renew the insurance", rockRef: "", notes: "", done: false },
    { id: "f4", title: "Hire a second coach", rockRef: "", notes: "", done: false },
  ],
  "2026-09": [{ id: "s1", title: "September business thing", done: false }],
};
const MONTH_PRIORITIES = {
  "2026-08": [
    { id: "p1", title: "Consistent wake/bed time", owner: "Ash", status: "In Progress", notes: "" },
    { id: "p2", title: "Book the Italy trip", owner: "", status: "Done", notes: "" },
    { id: "p3", title: "Sort the garage", owner: "", status: "Not Started", notes: "" },
    { id: "p4", title: "Dentist", owner: "", status: "Not Started", notes: "" },
  ],
  "2026-09": [{ id: "s2", title: "September personal thing", status: "Not Started" }],
};

const html = (env) => env.ctx.document.getElementById("wpBody").innerHTML;
const picker = (env) => env.ctx.wpMonthlyPickerHtml();
const projects = (env) => env.ctx.__wpState.plan.projectItems || [];
// the <option>s of one <optgroup>, by its label exactly as rendered
function group(sel, label) {
  const open = '<optgroup label="' + label + '">';
  const at = sel.indexOf(open);
  if (at < 0) return null;
  return sel.slice(at + open.length, sel.indexOf("</optgroup>", at));
}
// a weekly project item as the push/pull paths create one
const pulled = (wk, srcId, title, done) => ({
  id: "w-" + srcId + "-" + wk, title, done: !!done,
  linkId: "monthly:" + AUG + ":" + srcId + ":" + wk,
  source: "monthly-project", sourceYm: AUG, sourceProjectId: srcId,
});

async function week(opts) {
  opts = opts || {};
  const env = await boot(Object.assign({
    defaults: [], monthFocus: MONTH_FOCUS, monthPriorities: MONTH_PRIORITIES,
  }, opts, {
    plans: Object.assign({ [W2]: { weekEnding: W2 }, [SEP_WEEK]: { weekEnding: SEP_WEEK } }, opts.plans || {}),
  }));
  await env.ctx.loadWeeklyPlan(opts.week || W2);
  await env.settle();
  return env;
}

(async () => {
  /* ================= 0. the build stamp ================= */
  assert.ok(/<!-- build v111 · pull-list-hides-done -->/.test(MONTHLY),
    "monthly.html stamped v111 · pull-list-hides-done");
  assert.ok(/build v111 · pull-list-hides-done/.test(WEEKLY), "index.html carries the same stamp");

  /* ================= 1. THE BUG: done on MONTHLY drops out of the dropdown ================= */
  {
    const env = await week();
    const sel = picker(env);

    // the regression itself — v105 explicitly asserted that a monthly-DONE item was offered
    assert.ok(!sel.includes("Price review"),
      "a business focus item ticked Done on Monthly is NOT offered for pulling");
    assert.ok(!sel.includes("Book the Italy trip"),
      "…and neither is a personal item whose Status is Done");

    // 2. an item done by NEITHER measure is still offered — both sides
    assert.ok(sel.includes("Rebuild the onboarding call"), "an open business item is still offered");
    assert.ok(sel.includes("Renew the insurance") && sel.includes("Hire a second coach"),
      "…as are the rest of the open business items");
    assert.ok(sel.includes("Consistent wake/bed time"), "an open personal item is still offered");
    assert.ok(sel.includes("Sort the garage") && sel.includes("Dentist"),
      "…as are the rest of the open personal items");

    // both kinds behave the same way, in their own groups
    const biz = group(sel, "This Month's Focus");
    const pers = group(sel, "Personal Priorities &amp; Projects");
    assert.ok(biz && pers, "both groups still render");
    assert.strictEqual((biz.match(/<option /g) || []).length, 3, "the business group drops exactly its done item");
    assert.strictEqual((pers.match(/<option /g) || []).length, 3, "the personal group drops exactly its done one");
    assert.strictEqual((sel.match(/<option /g) || []).length, 7, "placeholder + 3 business + 3 personal");
  }

  /* ================= 3. a done item is NOT deleted or hidden anywhere else ================= */
  {
    // (a) it still renders — as done — in the weekly cascade anchor
    const env = await week();
    const h = html(env);
    assert.ok(h.includes("Price review"), "the done business item still shows in the monthly anchor");
    assert.ok(h.includes("Book the Italy trip"), "…and so does the done personal one");
    const doneRows = h.match(/<li class="wp-anchor-item wp-anchor-done">([\s\S]*?)<\/li>/g) || [];
    assert.strictEqual(doneRows.length, 2, "exactly the two done items read as done in the anchor");
    assert.ok(doneRows.some((r) => r.includes("Price review")), "…the business one struck through with a tick");
    assert.ok(doneRows.some((r) => r.includes("Book the Italy trip")), "…and the personal one too");
    assert.ok(!env.posts.some((p) => p.body.monthlyPlan),
      "the weekly app still never writes to the monthly record — nothing is deleted from the month");

    // (b) it still renders — as done — on the Monthly plan itself
    const m = await bootMonthly({
      plans: { [AUG]: { ym: AUG, focus: MONTH_FOCUS[AUG].map((f) => Object.assign({}, f)),
                        priorities: MONTH_PRIORITIES[AUG].map((p) => Object.assign({}, p)) } },
      rocks: [{ title: "Retention above 92%" }],
    });
    await openPlan(m, AUG);
    const mh = m.body.innerHTML;
    assert.ok(mh.includes("Price review"), "the done focus item is still on the Monthly plan");
    assert.ok(mh.includes("Book the Italy trip"), "…as is the done personal one");
    assert.ok(/<div class="mp-item done" data-focus="f2"/.test(mh), "…the focus one in its done row state");
    assert.strictEqual(m.ctx.__mpState.plan.focus.length, 4, "no focus item was removed from the month");
    assert.strictEqual(m.ctx.__mpState.plan.priorities.length, 4, "and none from the personal list");
    assert.strictEqual(m.posts.length, 0, "opening the month still writes nothing");
  }

  /* ================= 4. done on the WEEKLY, seen from another week ================= */
  {
    // f3/p3 were pulled into week 1 and ticked there. Week 2 must not offer them again.
    const env = await week({
      week: W2,
      plans: {
        [W1]: { weekEnding: W1, projectItems: [
          pulled(W1, "f3", "Renew the insurance", true),
          pulled(W1, "p3", "Sort the garage", true),
          pulled(W1, "f4", "Hire a second coach", false),   // pulled but NOT ticked
        ] },
      },
    });

    const sel = picker(env);
    assert.ok(!sel.includes("Renew the insurance"),
      "a business item ticked complete in ANOTHER week is not offered again");
    assert.ok(!sel.includes("Sort the garage"), "…and neither is a personal one");
    assert.ok(sel.includes("Hire a second coach"),
      "an item pulled into another week but NOT ticked is still offered — pulled is not done");
    assert.ok(sel.includes("Rebuild the onboarding call") && sel.includes("Dentist"),
      "…and the untouched items are unaffected");

    // it is matched back through the existing source link, not a new stored field
    const ids = env.ctx.__wpState.monthWeeklyDone;
    assert.strictEqual(ids.ym, AUG, "the index is built for the month being viewed");
    assert.deepStrictEqual([...ids.ids].sort(), ["f3", "p3"], "…and holds exactly the ticked sources");

    // the other week's own data is untouched by any of this — read-only, and nothing written
    assert.ok(!env.posts.some((p) => p.body.weeklyPlan),
      "loading a week reads the month's other weeks and writes to none of them");
    assert.strictEqual(projects(env).length, 0, "…and copies nothing into the week on screen");

    // …and it holds in EVERY week of the month, not just the one after
    for (const wk of [W3, W4, W5]) {
      const later = await week({
        week: wk,
        plans: Object.assign({ [wk]: { weekEnding: wk } }, {
          [W1]: { weekEnding: W1, projectItems: [pulled(W1, "f3", "Renew the insurance", true)] },
        }),
      });
      assert.ok(!picker(later).includes("Renew the insurance"),
        "a completed project cannot be re-pulled in week " + wk);
    }
  }

  /* ================= 5. the source link is the match — linkId as fallback ================= */
  {
    // an older row that lost sourceProjectId still resolves through its linkId
    const env = await week({
      week: W2,
      plans: {
        [W1]: { weekEnding: W1, projectItems: [
          { id: "old1", title: "Renew the insurance", done: true,
            linkId: "monthly:" + AUG + ":f3:" + W1, source: "monthly-project", sourceYm: AUG },
        ] },
      },
    });
    assert.ok(!picker(env).includes("Renew the insurance"),
      "a weekly copy matched only by linkId still marks its monthly source done");
  }

  /* ================= 6. ticking in THIS week drops it out immediately ================= */
  {
    const env = await week();
    env.ctx.wpPullMonthlyProject("focus:f1");
    env.ctx.wpPullMonthlyProject("personal:p1");
    await env.settle();
    assert.strictEqual(projects(env).length, 2, "both items pulled into this week");

    // tick them through the app's own path (the grid chip's handler)
    await env.ctx.wpToggleDoneRef("project:" + projects(env)[0].id, true, "mon");
    await env.ctx.wpToggleDoneRef("project:" + projects(env)[1].id, true, "mon");
    await env.settle();
    assert.ok(projects(env).every((it) => it.done), "…and ticked complete");

    const sel = picker(env);
    assert.ok(!sel.includes("Rebuild the onboarding call"), "the ticked business item is gone from the dropdown");
    assert.ok(!sel.includes("Consistent wake/bed time"), "…and the ticked personal one too");
    // the weekly copies themselves stay put — this only touches the dropdown
    assert.strictEqual(projects(env).length, 2, "the pulled copies are still in the week");
    const h = html(env);
    assert.ok(h.includes("Rebuild the onboarding call") && h.includes("Consistent wake/bed time"),
      "…and still render on the Projects card");
    assert.strictEqual((h.match(/wp-from-monthly/g) || []).length, 2, "…still tagged ↳ Monthly");

    // un-ticking puts it back on offer — the rule is done-state, not a one-way burn
    await env.ctx.wpToggleDoneRef("project:" + projects(env)[0].id, false, "mon");
    await env.settle();
    // it is still IN this week, so v105's already-pulled exclusion keeps it out here…
    assert.ok(!picker(env).includes("Rebuild the onboarding call"),
      "un-ticked but still in this week — the v105 duplicate rule still holds it out");
    // …and it is offered again in a different week of the month
    const other = await week({
      week: W3,
      plans: Object.assign({ [W3]: { weekEnding: W3 } },
        { [W2]: { weekEnding: W2, projectItems: [pulled(W2, "f1", "Rebuild the onboarding call", false)] } }),
    });
    assert.ok(picker(other).includes("Rebuild the onboarding call"),
      "an un-ticked item is offered again elsewhere — nothing is permanently removed");
  }

  /* ================= 7. v105 behaviour still stands ================= */
  {
    // already in this week → excluded (pull path)
    const env = await week();
    env.ctx.wpPullMonthlyProject("focus:f1");
    env.ctx.wpPullMonthlyProject("personal:p1");
    await env.settle();
    let sel = picker(env);
    assert.ok(!sel.includes("Rebuild the onboarding call"), "a pulled business item drops out of the dropdown");
    assert.ok(!sel.includes("Consistent wake/bed time"), "…and so does a pulled personal one");
    assert.ok(sel.includes("Hire a second coach") && sel.includes("Dentist"), "…while the open ones stay");

    // pulling the same item again is still a no-op
    const n = projects(env).length, posts = env.posts.length;
    env.ctx.wpPullMonthlyProject("focus:f1");
    env.ctx.wpPullMonthlyProject("personal:p1");
    await env.settle();
    assert.strictEqual(projects(env).length, n, "pulling an item already in the week adds nothing");
    assert.strictEqual(env.posts.length, posts, "…and writes nothing");

    // an item PUSHED from Monthly into this week is excluded the same way
    const env2 = await week({
      plans: { [W2]: { weekEnding: W2, projectItems: [pulled(W2, "f4", "Hire a second coach", false)] } },
    });
    sel = picker(env2);
    assert.ok(!sel.includes("Hire a second coach"), "an item pushed from Monthly is excluded too");
    assert.ok(sel.includes("Rebuild the onboarding call"), "…and the rest of the month is still offered");

    // the picker shell, grouping and order are untouched
    assert.ok(sel.startsWith('<select class="wp-pull-sel" onchange="wpPullMonthlyProject(this.value); this.value=\'\';">'),
      "the control is the same select, wired the same way");
    assert.ok(sel.includes('<option value="">Pull from Monthly…</option>'), "…with the same placeholder");
    assert.ok(sel.indexOf('label="This Month\'s Focus"') < sel.indexOf('label="Personal'),
      "…business first, personal second");
    assert.ok(group(sel, "This Month's Focus").includes('<option value="focus:f1">'),
      "…and kind-qualified values");

    // nothing left to offer → no control at all
    const env3 = await week({
      monthFocus: { "2026-08": [{ id: "d1", title: "All done", done: true }] },
      monthPriorities: { "2026-08": [{ id: "d2", title: "Also done", status: "Done" }] },
    });
    assert.strictEqual(picker(env3), "", "a month whose items are ALL done renders no dropdown");
    assert.ok(!html(env3).includes("wp-pull-sel"), "…and no control on the card");
    // …but they are still there, as done, in the anchor
    assert.ok(html(env3).includes("All done") && html(env3).includes("Also done"),
      "…while both items still show (as done) in the anchor");

    // one empty list still shows the other, with only its own group
    const env4 = await week({ monthPriorities: { "2026-08": [] } });
    assert.ok(group(picker(env4), "This Month's Focus"), "an empty personal list still offers the business one");
    assert.strictEqual(group(picker(env4), "Personal Priorities &amp; Projects"), null,
      "…and renders no empty personal group");

    // untitled monthly items are still never offered
    const env5 = await week({
      monthFocus: { "2026-08": [{ id: "x1", title: "   ", done: false }, { id: "x2", title: "Real one", done: false }] },
      monthPriorities: { "2026-08": [] },
    });
    assert.strictEqual((picker(env5).match(/<option /g) || []).length, 2,
      "placeholder + the one titled item — untitled items are still dropped");
  }

  /* ================= 8. scoped to the month, and to done-state only ================= */
  {
    // a September week reads September's own items — August's ticks are irrelevant there
    const env = await week({
      week: SEP_WEEK,
      plans: { [W1]: { weekEnding: W1, projectItems: [pulled(W1, "f3", "Renew the insurance", true)] } },
    });
    const sel = picker(env);
    assert.ok(sel.includes("September business thing") && sel.includes("September personal thing"),
      "a September week offers September's open items");
    assert.ok(!sel.includes("Renew the insurance"), "…and never August's");
    assert.strictEqual(env.ctx.__wpState.monthWeeklyDone.ym, "2026-09",
      "the done index is rebuilt for the month being viewed");
    assert.strictEqual(env.ctx.__wpState.monthWeeklyDone.ids.size, 0,
      "…and August's ticks do not leak into it");
  }

  /* ================= 9. logic only — no data-model change ================= */
  {
    const env = await week();
    env.ctx.wpPullMonthlyProject("focus:f1");
    await env.settle();
    const saved = env.posts.filter((x) => x.body.weeklyPlan && x.body.weeklyPlan.projectItems).pop()
      .body.weeklyPlan.projectItems;
    assert.deepStrictEqual(Object.keys(saved[0]).slice().sort(),
      ["done", "id", "linkId", "source", "sourceProjectId", "sourceYm", "title"],
      "a pulled item still stores exactly the v60/v61 fields — no new field for done-tracking");

    // the done-state readers are defined once and shared by the anchor and the picker
    assert.ok(/function wpAnchorDone\(kind, it\)\{/.test(WEEKLY),
      "one done-state reader for the monthly record");
    assert.ok(/wpAnchorDone\(kind, it\)/.test(WEEKLY) && /wpAnchorDone\(g\.kind, p\)/.test(WEEKLY),
      "…used by both the anchor column and the pull dropdown, so they cannot diverge");
    assert.ok(!/isDone\(it\)/.test(WEEKLY), "…and the old per-call predicate is gone");
    assert.ok(!/monthfocus[^)]*method:"POST"/.test(WEEKLY),
      "still no write path from the weekly app to the monthly record");
  }

  console.log("v111-pull-list-hides-done.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
