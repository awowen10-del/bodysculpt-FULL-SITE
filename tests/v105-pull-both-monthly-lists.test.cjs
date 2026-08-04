// v105 (bug fix): the weekly Projects card's "Pull from Monthly" dropdown offers BOTH monthly
// lists — the business "This Month's Focus" and the "Personal Priorities & Projects".
//
// The bug: v61 built the picker against the monthly `priorities` array, which was then the
// month's general Priorities & Projects list. v97 repurposed that same array into the PERSONAL
// counterpart to `focus` without widening the pull path, so from v97 onwards the picker was
// personal-only and business focus items — a different array — were never offered at all.
//
// The fix reads both lists through wpAnchorItems, the same reader the monthly anchor uses, so
// the picker and the anchor cannot disagree about what is in the month. Everything about how a
// pulled item is created and stored is unchanged.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/env.cjs");

const WEEKLY = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const MONTHLY = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const AUG_WEEK = "2026-08-10", SEP_WEEK = "2026-09-07";

const MONTH_FOCUS = {
  "2026-08": [
    { id: "f1", title: "Rebuild the onboarding call", rockRef: "1", notes: "", done: false },
    { id: "f2", title: "Price review", rockRef: "", notes: "", done: true },
    { id: "f3", title: "   ", rockRef: "", notes: "", done: false },        // untitled — never offered
  ],
  "2026-09": [{ id: "s1", title: "September business thing", done: false }],
};
const MONTH_PRIORITIES = {
  "2026-08": [
    { id: "p1", title: "Consistent wake/bed time", owner: "Ash", status: "In Progress", notes: "" },
    { id: "p2", title: "Book the Italy trip", owner: "", status: "Not Started", notes: "" },
  ],
  "2026-09": [{ id: "s2", title: "September personal thing", status: "Not Started" }],
};

const html = (env) => env.ctx.document.getElementById("wpBody").innerHTML;
const picker = (env) => env.ctx.wpMonthlyPickerHtml();
// the <option>s of one <optgroup>, by its label exactly as rendered
function group(sel, label) {
  const open = '<optgroup label="' + label + '">';
  const at = sel.indexOf(open);
  if (at < 0) return null;
  return sel.slice(at + open.length, sel.indexOf("</optgroup>", at));
}
const projects = (env) => env.ctx.__wpState.plan.projectItems || [];

async function week(opts) {
  const env = await boot(Object.assign({
    defaults: [], monthFocus: MONTH_FOCUS, monthPriorities: MONTH_PRIORITIES,
    plans: { [AUG_WEEK]: { weekEnding: AUG_WEEK }, [SEP_WEEK]: { weekEnding: SEP_WEEK } },
  }, opts || {}));
  await env.ctx.loadWeeklyPlan(opts && opts.week ? opts.week : AUG_WEEK);
  await env.settle();
  return env;
}

(async () => {
  /* ================= 0. the build stamp ================= */
  // ">= v105" — the exact stamp is asserted by the newest version's test; both pages still
  // have to agree on it (v101).
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(MONTHLY);
  assert.ok(stamp && Number(stamp[1]) >= 105, "monthly.html stamped v105 or later");
  assert.ok(WEEKLY.includes("build v" + stamp[1] + " · " + stamp[2]), "index.html carries the same stamp");

  /* ================= 1. THE BUG: both lists are offered ================= */
  {
    const env = await week();
    const sel = picker(env);

    // the regression itself — business focus items were missing entirely
    assert.ok(sel.includes("Rebuild the onboarding call"), "a business focus item is offered (the v97 regression)");
    assert.ok(sel.includes("Price review"), "…including one already ticked done on Monthly");
    assert.ok(sel.includes("Consistent wake/bed time") && sel.includes("Book the Italy trip"),
      "…and the personal items are still offered");

    // grouped so business and personal are tellable apart
    const biz = group(sel, "This Month's Focus");
    const pers = group(sel, "Personal Priorities &amp; Projects");
    assert.ok(biz, "the business items sit in a labelled group");
    assert.ok(pers, "…and the personal ones in their own");
    assert.ok(sel.indexOf("<optgroup") > sel.indexOf('<option value="">'), "the placeholder still leads the list");
    assert.ok(sel.indexOf('label="This Month\'s Focus"') < sel.indexOf('label="Personal'),
      "business first, personal second — the same order as the anchor");
    assert.ok(biz.includes("Rebuild the onboarding call") && biz.includes("Price review"),
      "the business group holds exactly the focus items");
    assert.ok(!biz.includes("Consistent wake/bed time"), "…and no personal ones");
    assert.ok(pers.includes("Consistent wake/bed time") && pers.includes("Book the Italy trip"),
      "the personal group holds the personal items");
    assert.ok(!pers.includes("Price review"), "…and no business ones");
    assert.ok(/\.wp-pull-sel optgroup\{[^}]*font-weight:800/.test(WEEKLY),
      "…and the group headings read as headings where the browser styles the popup");

    // values are kind-qualified so an item resolves in the list it was offered from
    assert.ok(biz.includes('<option value="focus:f1">'), "a business option carries its kind and id");
    assert.ok(pers.includes('<option value="personal:p1">'), "…as does a personal one");

    // untitled monthly items are still never offered
    assert.strictEqual((sel.match(/<option /g) || []).length, 5,
      "placeholder + 2 business + 2 personal — the untitled focus item is not offered");

    // v61 shell unchanged, and it renders in the Projects card
    assert.ok(sel.startsWith('<select class="wp-pull-sel" onchange="wpPullMonthlyProject(this.value); this.value=\'\';">'),
      "the control is the same select, wired the same way");
    assert.ok(sel.includes('<option value="">Pull from Monthly…</option>'), "…with the same placeholder");
    assert.ok(html(env).includes('class="wp-pull-sel"'), "…and it renders on the Projects card");
  }

  /* ================= 2. pulling either type creates the same weekly item ================= */
  {
    const env = await week();
    const before = env.posts.length;

    // business focus item
    env.ctx.wpPullMonthlyProject("focus:f1");
    await env.settle();
    let items = projects(env);
    assert.strictEqual(items.length, 1, "pulling a business focus item adds one project item");
    const b = items[0];
    assert.strictEqual(b.title, "Rebuild the onboarding call", "…with the monthly item's title");
    assert.strictEqual(b.done, false, "…not done");
    assert.strictEqual(b.source, "monthly-project", "…tagged as pulled from Monthly");
    assert.strictEqual(b.sourceYm, "2026-08", "…carrying the month it came from");
    assert.strictEqual(b.sourceProjectId, "f1", "…and the monthly item's id, for the de-dupe");
    assert.strictEqual(b.linkId, "monthly:2026-08:f1:" + AUG_WEEK,
      "…with the v60 linkId, so push and pull stay interchangeable");
    assert.ok(b.id && b.id !== "f1", "…as its own weekly item");

    // personal item — identical shape
    env.ctx.wpPullMonthlyProject("personal:p1");
    await env.settle();
    items = projects(env);
    assert.strictEqual(items.length, 2, "pulling a personal item adds another");
    const p = items[1];
    assert.strictEqual(p.title, "Consistent wake/bed time", "…with its title");
    assert.strictEqual(p.source, "monthly-project", "…the same Monthly tag");
    assert.strictEqual(p.sourceYm, "2026-08", "…the same month");
    assert.strictEqual(p.sourceProjectId, "p1", "…its own monthly id");
    assert.strictEqual(p.linkId, "monthly:2026-08:p1:" + AUG_WEEK, "…and the same linkId shape");

    // both render with the "↳ Monthly" tag and both saved
    const h = html(env);
    assert.strictEqual((h.match(/wp-from-monthly/g) || []).length, 2,
      "both pulled items render the ↳ Monthly tag");
    assert.ok(h.includes("Rebuild the onboarding call") && h.includes("Consistent wake/bed time"),
      "…and both appear in the Projects card");
    const saves = env.posts.slice(before).filter((x) => x.body.weeklyPlan && x.body.weeklyPlan.projectItems);
    assert.strictEqual(saves.length, 2, "each pull saves the project section, exactly as before");
    const saved = saves[1].body.weeklyPlan.projectItems;
    assert.strictEqual(saved.length, 2, "…writing both items");
    assert.ok(saved.every((it) => it.linkId && it.source === "monthly-project" && it.sourceProjectId),
      "…with their link metadata intact on the way to the store");

    // no new field on the stored item — the shape is exactly the v60/v61 one
    assert.deepStrictEqual(Object.keys(saved[0]).slice().sort(),
      ["done", "id", "linkId", "source", "sourceProjectId", "sourceYm", "title"],
      "the stored item gains no new field — no data-model change");
  }

  /* ================= 3. already-pulled items are handled exactly as before ================= */
  {
    const env = await week();
    env.ctx.wpPullMonthlyProject("focus:f1");
    env.ctx.wpPullMonthlyProject("personal:p1");
    await env.settle();

    // gone from the dropdown, both sides
    let sel = picker(env);
    assert.ok(!sel.includes("Rebuild the onboarding call"), "a pulled business item drops out of the dropdown");
    assert.ok(!sel.includes("Consistent wake/bed time"), "…and so does a pulled personal one");
    assert.ok(sel.includes("Price review") && sel.includes("Book the Italy trip"),
      "…while the rest stay available");

    // pulling the same item again is a no-op (linkId / sourceProjectId de-dupe)
    const n = projects(env).length, posts = env.posts.length;
    env.ctx.wpPullMonthlyProject("focus:f1");
    env.ctx.wpPullMonthlyProject("personal:p1");
    await env.settle();
    assert.strictEqual(projects(env).length, n, "pulling an item already in the week adds nothing");
    assert.strictEqual(env.posts.length, posts, "…and writes nothing");

    // an item PUSHED from Monthly (already in the plan) is excluded the same way
    const env2 = await week({
      plans: { [AUG_WEEK]: { weekEnding: AUG_WEEK, projectItems: [
        { id: "w1", title: "Price review", done: false, linkId: "monthly:2026-08:f2:" + AUG_WEEK,
          source: "monthly-project", sourceYm: "2026-08", sourceProjectId: "f2" },
      ] } },
    });
    sel = picker(env2);
    assert.ok(!sel.includes("Price review"), "an item pushed from Monthly is excluded from the pull list too");
    assert.ok(sel.includes("Rebuild the onboarding call"), "…and the rest of the month is still offered");

    // nothing left to offer → no control at all (v61 behaviour)
    const env3 = await week({ monthFocus: { "2026-08": [] }, monthPriorities: { "2026-08": [] } });
    assert.strictEqual(picker(env3), "", "a month with nothing in it renders no dropdown");
    assert.ok(!html(env3).includes("wp-pull-sel"), "…and no control on the card");

    // one empty list still shows the other, with only its own group
    const env4 = await week({ monthPriorities: { "2026-08": [] } });
    assert.ok(group(picker(env4), "This Month's Focus"), "an empty personal list still offers the business one");
    assert.strictEqual(group(picker(env4), "Personal Priorities &amp; Projects"), null,
      "…and renders no empty group for it");
    const env5 = await week({ monthFocus: { "2026-08": [] } });
    assert.ok(group(picker(env5), "Personal Priorities &amp; Projects"), "and the other way round");
    assert.strictEqual(group(picker(env5), "This Month's Focus"), null, "…same, no empty group");
  }

  /* ================= 4. the right month for the week being viewed ================= */
  {
    const env = await week({ week: SEP_WEEK });
    const sel = picker(env);
    assert.ok(sel.includes("September business thing"), "a September week offers September's focus");
    assert.ok(sel.includes("September personal thing"), "…and September's personal items");
    assert.ok(!sel.includes("Rebuild the onboarding call") && !sel.includes("Consistent wake/bed time"),
      "…and nothing from August");

    env.ctx.wpPullMonthlyProject("focus:s1");
    await env.settle();
    const it = projects(env)[0];
    assert.strictEqual(it.sourceYm, "2026-09", "a pull in a September week records September");
    assert.strictEqual(it.linkId, "monthly:2026-09:s1:" + SEP_WEEK, "…and links to that month and week");

    // back to August: August's own list, unaffected by the September pull
    await env.ctx.loadWeeklyPlan(AUG_WEEK);
    await env.settle();
    const aug = picker(env);
    assert.ok(aug.includes("Rebuild the onboarding call") && aug.includes("Consistent wake/bed time"),
      "August's week offers August's items again");
    assert.ok(!aug.includes("September business thing"), "…and none of September's");
  }

  /* ================= 5. one source: the picker reads what the anchor reads ================= */
  {
    const env = await week();
    // the picker resolves through wpAnchorItems, not its own copy of either list
    const fn = WEEKLY.slice(WEEKLY.indexOf("function wpMonthlyPickerHtml"), WEEKLY.indexOf("function wpAddItem"));
    assert.ok(/wpAnchorItems\(g\.kind\)/.test(fn), "the picker builds its options from wpAnchorItems");
    assert.ok(/wpAnchorItems\(k\)/.test(fn), "…and the pull resolves the chosen item the same way");
    assert.ok(!/wpMonthProjects\.projects/.test(fn),
      "…and neither reads a monthly list directly any more — one reader, no divergence");

    // change the month's records and BOTH the anchor and the picker follow, together
    const st = env.ctx.__wpState;
    st.monthFocus.focus.push({ id: "f9", title: "Fix the aircon", done: false });
    st.monthProjects.projects.push({ id: "p9", title: "Learn to swim front crawl", status: "Not Started" });
    env.ctx.renderWeeklyPlan();
    await env.settle();
    const h = html(env), sel = picker(env);
    assert.ok(h.includes("Fix the aircon") && sel.includes("Fix the aircon"),
      "a new business item shows in the anchor and the pull list together");
    assert.ok(h.includes("Learn to swim front crawl") && sel.includes("Learn to swim front crawl"),
      "…and so does a new personal one");

    // and a bare id (no kind prefix) still resolves, from either list
    env.ctx.wpPullMonthlyProject("f9");
    await env.settle();
    assert.strictEqual(projects(env)[0].sourceProjectId, "f9", "a bare id still resolves a business item");
    env.ctx.wpPullMonthlyProject("p9");
    await env.settle();
    assert.strictEqual(projects(env)[1].sourceProjectId, "p9", "…and a personal one");

    // an unknown value does nothing
    const n = projects(env).length;
    env.ctx.wpPullMonthlyProject("focus:nope");
    env.ctx.wpPullMonthlyProject("");
    await env.settle();
    assert.strictEqual(projects(env).length, n, "an unresolvable choice pulls nothing");
  }

  console.log("v105-pull-both-monthly-lists.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
