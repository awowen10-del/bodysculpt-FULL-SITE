// v112: the monthly item's own done-state is the SINGLE source of truth for "is this project
// finished", and all three surfaces read it — the Monthly plan, the weekly cascade anchor, and
// the weekly "Pull from Monthly" dropdown.
//
// What was actually broken (v111 aimed at the symptom and missed the cause): ticking a pulled
// project task complete on the Weekly wrote only to the WEEK. Nothing ever reached the monthly
// record, so the Monthly plan still read the work as open — the item rendered exactly like an
// unfinished one — and v111 then tried to paper over that by cross-referencing the weekly ticks
// of every other week from the dropdown. Two flags, one of them never written.
//
// The fix is the missing write:
//   1. weekly → monthly propagation. Ticking a task with source:"monthly-project" marks the
//      monthly item it is a copy of done, matched by sourceProjectId (linkId as fallback), on
//      the same monthlyPlan section-save path the Monthly page's own Done tick uses (v98).
//      Symmetric: an untick clears it. Only that item's done-state is written.
//   2. the Monthly plan renders a done item GREEN — a tint across the tile, a green edge and a
//      struck, dimmed title. The dim never landed before: the generic "#mpBody input" field
//      styling is an ID selector and out-specified the done rule.
//   3. the pull dropdown SHOWS a done item, struck through and disabled, instead of dropping it
//      (v111's behaviour) — you can see the month holds it and that it is finished, and you
//      cannot re-pull it.
// v111's cross-referencing machinery (wpMonthWeeklyDone / wpPullDoneIds / the other-week scan)
// is gone with its test file: there is one flag now, so there is nothing to cross-reference.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/env.cjs");
const { boot: bootMonthly, openPlan } = require("./lib/monthly-env.cjs");

const WEEKLY = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const MONTHLY = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const STORE_SRC = fs.readFileSync(
  path.join(__dirname, "..", "netlify", "functions", "kpi-store.js"), "utf8");

const AUG = "2026-08";
const W2 = "2026-08-10";
const ROCKS = [{ title: "Retention above 92%" }];

const MONTH_FOCUS = {
  "2026-08": [
    { id: "f1", title: "Rebuild the onboarding call", rockRef: "1", notes: "with Dan", done: false },
    { id: "f2", title: "Price review", rockRef: "", notes: "", done: true },   // done ON MONTHLY
    { id: "f3", title: "Hire a second coach", rockRef: "", notes: "", done: false },
  ],
};
const MONTH_PRIORITIES = {
  "2026-08": [
    { id: "p1", title: "Consistent wake/bed time", owner: "Ash", status: "In Progress", notes: "keep it boring" },
    { id: "p2", title: "Book the Italy trip", owner: "", status: "Done", notes: "" },   // done ON MONTHLY
    { id: "p3", title: "Dentist", owner: "", status: "Not Started", notes: "" },
    // an item the weekly app filters OUT when it loads the list (no title). It must survive
    // every write-back — this is the data-loss trap in writing back an in-memory copy.
    { id: "p4", title: "   ", owner: "", status: "Not Started", notes: "half an idea" },
  ],
};

const html = (env) => env.ctx.document.getElementById("wpBody").innerHTML;
const picker = (env) => env.ctx.wpMonthlyPickerHtml();
const projects = (env) => env.ctx.__wpState.plan.projectItems || [];
const monthlyPosts = (env) => env.posts.filter((p) => p.body.monthlyPlan);
// the <option> for one title, out of the rendered select
function option(sel, title) {
  const at = sel.indexOf(title);
  if (at < 0) return null;
  return sel.slice(sel.lastIndexOf("<option", at), sel.indexOf("</option>", at) + 9);
}
const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));
function ruleOf(style, sel) {
  const m = new RegExp("\\n\\s*" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{([^}]*)\\}").exec(style);
  assert.ok(m, "stylesheet defines " + sel);
  return m[1];
}

async function week(opts) {
  opts = opts || {};
  const env = await boot(Object.assign({
    defaults: [], monthFocus: MONTH_FOCUS, monthPriorities: MONTH_PRIORITIES,
    plans: { [W2]: { weekEnding: W2 } },
  }, opts));
  await env.ctx.loadWeeklyPlan(opts.week || W2);
  await env.settle();
  return env;
}
// pull an item into the week and tick it complete, through the app's own paths
async function pullAndTick(env, value, done) {
  env.ctx.wpPullMonthlyProject(value);
  await env.settle();
  const it = projects(env)[projects(env).length - 1];
  await env.ctx.wpToggleDoneRef("project:" + it.id, done !== false, "mon");
  await env.settle();
  return it;
}

(async () => {
  /* ================= 0. the build stamp ================= */
  assert.ok(/<!-- build v112 · monthly-done-single-source -->/.test(MONTHLY),
    "monthly.html stamped v112 · monthly-done-single-source");
  assert.ok(/build v112 · monthly-done-single-source/.test(WEEKLY), "index.html carries the same stamp");

  /* ========= 1. THE MISSING PIECE: a weekly tick marks the monthly item done ========= */
  {
    const env = await week();
    const before = monthlyPosts(env).length;
    assert.strictEqual(before, 0, "loading a week writes nothing to the monthly record");

    const item = await pullAndTick(env, "focus:f1");
    assert.strictEqual(item.sourceProjectId, "f1", "the pulled task is linked to its monthly item");
    assert.strictEqual(projects(env)[0].done, true, "…and it is ticked on the week");

    // the write itself
    const posts = monthlyPosts(env);
    assert.strictEqual(posts.length, 1, "ticking a linked task writes to the monthly record — once");
    const sent = posts[0].body.monthlyPlan;
    assert.deepStrictEqual(Object.keys(sent).sort(), ["focus", "ym"],
      "…on the normal focus section path, exactly as the Monthly page's own Done tick writes");
    assert.strictEqual(sent.ym, AUG, "…against the month the item came from");
    assert.strictEqual(sent.focus.find((f) => f.id === "f1").done, true, "…with the linked item done");

    // ONLY the done-state moved
    assert.strictEqual(sent.focus.length, 3, "every focus item travels back");
    assert.strictEqual(sent.focus.find((f) => f.id === "f1").title, "Rebuild the onboarding call",
      "the item's title is untouched");
    assert.strictEqual(sent.focus.find((f) => f.id === "f1").rockRef, "1", "…its Rock link too");
    assert.strictEqual(sent.focus.find((f) => f.id === "f1").notes, "with Dan", "…and its notes");
    assert.strictEqual(sent.focus.find((f) => f.id === "f3").done, false, "the other items keep their own state");
    assert.ok(!("priorities" in sent), "the personal list is not part of this write");

    // it round-trips: the stored record holds it
    assert.strictEqual(env.monthly[AUG].focus.find((f) => f.id === "f1").done, true,
      "the monthly record now holds the done-state");

    // …and a reload reads it back
    await env.ctx.loadWeeklyPlan(W2);
    await env.settle();
    assert.strictEqual(env.ctx.__wpState.monthFocus.focus.find((f) => f.id === "f1").done, true,
      "…and it is STILL done after a reload");
    const doneRows = html(env).match(/<li class="wp-anchor-item wp-anchor-done">([\s\S]*?)<\/li>/g) || [];
    assert.ok(doneRows.some((r) => r.includes("Rebuild the onboarding call")),
      "…so the weekly anchor now reads it as done");

    // and the Monthly plan itself renders it done
    const m = await bootMonthly({ plans: { [AUG]: env.monthly[AUG] }, rocks: ROCKS });
    await openPlan(m, AUG);
    assert.ok(/<div class="mp-item done" data-focus="f1"/.test(m.body.innerHTML),
      "the Monthly plan renders the item in its done state — the tick reached the month");
    assert.ok(/data-focus="f1"[\s\S]*?data-ff="done" checked/.test(m.body.innerHTML),
      "…with its Done box ticked");
    assert.strictEqual(m.ctx.__mpState.plan.focus.length, 3, "…and nothing was added or removed");
  }

  /* ================= 2. symmetric: an untick clears it again ================= */
  {
    const env = await week();
    const item = await pullAndTick(env, "focus:f1");
    assert.strictEqual(env.monthly[AUG].focus.find((f) => f.id === "f1").done, true, "ticked");

    await env.ctx.wpToggleDoneRef("project:" + item.id, false, "mon");
    await env.settle();
    assert.strictEqual(env.monthly[AUG].focus.find((f) => f.id === "f1").done, false,
      "un-ticking on the Weekly clears the monthly item's done-state");
    assert.strictEqual(projects(env)[0].done, false, "…and the weekly task with it");
    const last = monthlyPosts(env).pop().body.monthlyPlan;
    assert.deepStrictEqual(Object.keys(last).sort(), ["focus", "ym"], "…on the same section path");
    assert.strictEqual(last.focus.find((f) => f.id === "f3").done, false, "…still touching nothing else");
  }

  /* ================= 3. personal items behave identically ================= */
  {
    const env = await week();
    const item = await pullAndTick(env, "personal:p1");
    assert.strictEqual(item.sourceProjectId, "p1", "a personal item pulls with the same link");

    const sent = monthlyPosts(env).pop().body.monthlyPlan;
    assert.deepStrictEqual(Object.keys(sent).sort(), ["priorities", "ym"],
      "…and writes back on the priorities section path");
    assert.ok(!("focus" in sent), "the business list is not part of this write");
    assert.strictEqual(sent.priorities.find((p) => p.id === "p1").status, "Done",
      "Status is the personal done-state (v103) — a weekly tick sets it to Done");
    assert.strictEqual(sent.priorities.find((p) => p.id === "p1").owner, "Ash", "the owner is untouched");
    assert.strictEqual(sent.priorities.find((p) => p.id === "p1").notes, "keep it boring", "…and the notes");
    assert.strictEqual(sent.priorities.find((p) => p.id === "p3").status, "Not Started",
      "the other personal items keep their own status");

    // NO DATA LOSS: the untitled item the weekly app filters out of its copy still travels
    const kept = sent.priorities.find((p) => p.id === "p4");
    assert.ok(kept, "the untitled personal item is still in the list that goes back");
    assert.strictEqual(kept.notes, "half an idea", "…with its content intact");
    assert.strictEqual(sent.priorities.length, 4, "…and nothing was dropped from the month");
    assert.strictEqual(env.monthly[AUG].priorities.length, 4, "…as stored");

    // un-ticking clears it symmetrically
    await env.ctx.wpToggleDoneRef("project:" + item.id, false, "mon");
    await env.settle();
    assert.strictEqual(env.monthly[AUG].priorities.find((p) => p.id === "p1").status, "In Progress",
      "un-ticking moves Status off Done — the honest opposite for a task just un-ticked");
    assert.strictEqual(env.monthly[AUG].priorities.length, 4, "…still losing nothing");

    // the Monthly plan renders a done personal item done too
    await pullAndTick(env, "personal:p3");
    const m = await bootMonthly({ plans: { [AUG]: env.monthly[AUG] }, rocks: ROCKS });
    await openPlan(m, AUG);
    assert.ok(/<div class="mp-item done" data-prio data-pid="p3"/.test(m.body.innerHTML),
      "the Monthly plan renders the personal item in its done state");
    assert.strictEqual(m.ctx.__mpState.plan.priorities.length, 4, "…with the whole list intact");
  }

  /* ================= 4. only linked tasks write, and only when it changes ================= */
  {
    // a plain weekly project task has no monthly item to mark
    const env = await week();
    env.ctx.wpAddItem("project");
    const plain = projects(env)[0];
    plain.title = "Something local to this week";
    await env.ctx.wpToggleDoneRef("project:" + plain.id, true, "mon");
    await env.settle();
    assert.strictEqual(monthlyPosts(env).length, 0,
      "ticking an ordinary weekly task never touches the monthly record");
    assert.strictEqual(projects(env)[0].done, true, "…and the week's own tick still lands");

    // a tick that says what the record already says writes nothing
    const env2 = await week({
      plans: { [W2]: { weekEnding: W2, projectItems: [
        { id: "w1", title: "Price review", done: false, linkId: "monthly:" + AUG + ":f2:" + W2,
          source: "monthly-project", sourceYm: AUG, sourceProjectId: "f2" },
      ] } },
    });
    await env2.ctx.wpToggleDoneRef("project:w1", true, "mon");   // f2 is already done on Monthly
    await env2.settle();
    assert.strictEqual(monthlyPosts(env2).length, 0,
      "marking done what the month already calls done is not a write");

    // matching still works through the linkId alone, for a copy that lost the explicit field
    const env3 = await week({
      plans: { [W2]: { weekEnding: W2, projectItems: [
        { id: "w2", title: "Hire a second coach", done: false, source: "monthly-project",
          linkId: "monthly:" + AUG + ":f3:" + W2 },
      ] } },
    });
    await env3.ctx.wpToggleDoneRef("project:w2", true, "mon");
    await env3.settle();
    assert.strictEqual(env3.monthly[AUG].focus.find((f) => f.id === "f3").done, true,
      "a copy matched only by its linkId still marks its monthly source done");
  }

  /* ========= 5. the Monthly plan shows a done item GREEN ========= */
  {
    const STYLE = styleOf(MONTHLY);
    const tile = ruleOf(STYLE, ".mp-item.done");
    assert.ok(/background:rgba\(var\(--green-rgb\)/.test(tile),
      "a done item takes a green tint across the tile — not just a hairline border");
    assert.ok(/border-color:rgba\(var\(--green-rgb\)/.test(tile), "…and a green edge");

    const title = ruleOf(STYLE, "#mpBody .mp-item.done input.mp-title");
    assert.ok(/text-decoration:line-through/.test(title), "the title is struck through");
    assert.ok(/color:var\(--ink-faint\)/.test(title), "…and dimmed");
    assert.ok(/background:rgba\(var\(--green-rgb\)/.test(title), "…on the same green ground");
    // THE SPECIFICITY BUG: without the #mpBody prefix the generic field rule wins and repaints
    // the title back to the normal colours, which is why a done item looked like an open one.
    assert.ok(STYLE.indexOf("#mpBody .mp-item.done input.mp-title") >
      STYLE.indexOf("#mpBody input:not([type=checkbox])"),
      "…and the done rule is specific enough (and late enough) to beat the generic #mpBody field styling");
    // a finished personal item reads as done rather than keeping the plain personal accent
    assert.ok(/border-left-color:rgba\(var\(--green-rgb\)/.test(ruleOf(STYLE, ".mp-personal .mp-item.done")),
      "a done personal item goes green too, over its personal edge");
    assert.ok(STYLE.indexOf(".mp-item.done{background") > STYLE.indexOf(".mp-personal .mp-item{"),
      "…because the done rules come after the personal ones");

    // and both kinds actually carry the class when the record says done
    const m = await bootMonthly({
      plans: { [AUG]: { ym: AUG, focus: MONTH_FOCUS[AUG].map((f) => Object.assign({}, f)),
                        priorities: MONTH_PRIORITIES[AUG].map((p) => Object.assign({}, p)) } },
      rocks: ROCKS,
    });
    await openPlan(m, AUG);
    const mh = m.body.innerHTML;
    assert.ok(/<div class="mp-item done" data-focus="f2"/.test(mh),
      "a focus item ticked Done renders with the done class");
    assert.ok(/<div class="mp-item done" data-prio data-pid="p2"/.test(mh),
      "a personal item at Status Done renders with the same class");
    assert.ok(/<div class="mp-item" data-focus="f1"/.test(mh), "an open focus item does not");
    assert.ok(/<div class="mp-item" data-prio data-pid="p3"/.test(mh), "…nor an open personal one");
  }

  /* ========= 6. the pull dropdown: done is shown, struck through, unpickable ========= */
  {
    const env = await week();
    const sel = picker(env);

    // shown — not dropped (this is what changed from v111)
    assert.ok(sel.includes("Price review"), "a done business item is still SHOWN in the dropdown");
    assert.ok(sel.includes("Book the Italy trip"), "…as is a done personal one");

    // …struck through and not selectable
    const doneOpt = option(sel, "Price review");
    assert.ok(/\bdisabled\b/.test(doneOpt), "the done option is disabled — it cannot be chosen");
    assert.ok(/class="wp-pull-done"/.test(doneOpt), "…and carries the struck-through class");
    assert.ok(doneOpt.includes('value=""'), "…with no value, so even a stray change is a no-op");
    assert.ok(doneOpt.includes("✓"), "…marked done in the text as well, for popups that ignore CSS");
    const doneP = option(sel, "Book the Italy trip");
    assert.ok(/\bdisabled\b/.test(doneP) && /class="wp-pull-done"/.test(doneP),
      "the personal side behaves identically");

    // an open item is untouched — normal, selectable, kind-qualified value
    const openOpt = option(sel, "Rebuild the onboarding call");
    assert.ok(!/\bdisabled\b/.test(openOpt), "an open item is still selectable");
    assert.ok(!/wp-pull-done/.test(openOpt), "…not struck through");
    assert.ok(openOpt.includes('value="focus:f1"'), "…and still carries its kind and id");
    assert.ok(!/\bdisabled\b/.test(option(sel, "Dentist")), "…the same on the personal side");

    // the strike-through is real styling, not just a class name
    assert.ok(/text-decoration:line-through/.test(ruleOf(styleOf(WEEKLY), ".wp-pull-sel option.wp-pull-done")),
      "the class strikes the option through where the browser styles <option>s");

    // a month whose items are ALL done still renders the dropdown — you can see they are there
    const allDone = await week({
      monthFocus: { [AUG]: [{ id: "d1", title: "All done", done: true }] },
      monthPriorities: { [AUG]: [{ id: "d2", title: "Also done", status: "Done" }] },
    });
    const sel2 = picker(allDone);
    assert.ok(sel2.includes("All done") && sel2.includes("Also done"),
      "a fully finished month still shows its items…");
    assert.strictEqual((sel2.match(/ disabled/g) || []).length, 2, "…every one of them disabled");

    // and the logic refuses too, not just the control
    const n = projects(env).length;
    env.ctx.wpPullMonthlyProject("focus:f2");
    env.ctx.wpPullMonthlyProject("personal:p2");
    await env.settle();
    assert.strictEqual(projects(env).length, n, "a done item cannot be pulled even by calling the handler");
    assert.ok(!env.posts.some((p) => p.body.weeklyPlan), "…and nothing is written");
  }

  /* ========= 7. one flag drives all three surfaces ========= */
  {
    const env = await week();
    // before: open everywhere
    const anchorDone = (env) => (html(env).match(/<li class="wp-anchor-item wp-anchor-done">([\s\S]*?)<\/li>/g) || []);
    assert.ok(!anchorDone(env).some((r) => r.includes("Rebuild the onboarding call")),
      "the item starts open in the anchor");
    assert.ok(!/\bdisabled\b/.test(option(picker(env), "Rebuild the onboarding call")),
      "…and selectable in the dropdown");

    // one action: tick the pulled copy on the Weekly
    await pullAndTick(env, "focus:f1");

    // all three now agree, from the SAME monthly flag
    assert.strictEqual(env.monthly[AUG].focus.find((f) => f.id === "f1").done, true,
      "1. the monthly record holds it done");
    const m = await bootMonthly({ plans: { [AUG]: env.monthly[AUG] }, rocks: ROCKS });
    await openPlan(m, AUG);
    assert.ok(/<div class="mp-item done" data-focus="f1"/.test(m.body.innerHTML),
      "2. the Monthly plan shows it done (green)");
    assert.ok(anchorDone(env).some((r) => r.includes("Rebuild the onboarding call")),
      "…and the weekly anchor, reading that same record, shows it done as well");
    // it is in this week now, so the dropdown excludes it as a duplicate — check the flag on a
    // DIFFERENT item to prove the dropdown is reading the same monthly state
    assert.ok(/\bdisabled\b/.test(option(picker(env), "Price review")),
      "3. the dropdown disables what the monthly record calls done");

    // the reader is defined once and used by every surface
    assert.ok(/function wpAnchorDone\(kind, it\)\{/.test(WEEKLY), "one done-state reader in the weekly app");
    assert.ok(/wpAnchorDone\(kind, it\)/.test(WEEKLY), "…used by the anchor column");
    assert.ok(/wpAnchorDone\(g\.kind, p\)/.test(WEEKLY), "…by the dropdown");
    assert.ok(/wpAnchorDone\(foundIn, proj\)/.test(WEEKLY), "…and by the pull handler");
    // v111's second flag is gone — there is nothing left to cross-reference
    ["wpMonthWeeklyDone", "wpPullDoneIds", "wpLoadMonthWeeklyDone", "wpWeeklyDoneSourceIds"].forEach((n) =>
      assert.ok(!WEEKLY.includes(n), "the cross-referencing helper " + n + " is gone"));
  }

  /* ========= 8. the write is additive — no new storage, no new whitelist ========= */
  {
    const env = await week();
    await pullAndTick(env, "focus:f1");
    const saved = env.posts.filter((x) => x.body.weeklyPlan && x.body.weeklyPlan.projectItems).pop()
      .body.weeklyPlan.projectItems;
    assert.deepStrictEqual(Object.keys(saved[0]).slice().sort(),
      ["done", "id", "linkId", "source", "sourceProjectId", "sourceYm", "title"],
      "the weekly item still stores exactly the v60/v61 fields");
    const sentFocus = monthlyPosts(env).pop().body.monthlyPlan.focus.find((f) => f.id === "f1");
    assert.deepStrictEqual(Object.keys(sentFocus).slice().sort(), ["done", "id", "notes", "rockRef", "title"],
      "…and the monthly item goes back with the fields it was stored with — nothing new");

    // the fields the write depends on were already whitelisted by the store
    const focusFn = STORE_SRC.slice(STORE_SRC.indexOf("function cleanMonthlyFocus"),
      STORE_SRC.indexOf("\n}", STORE_SRC.indexOf("function cleanMonthlyFocus")) + 2);
    assert.ok(/done: !!f\.done/.test(focusFn), "done survives the store's focus whitelist");
    assert.ok(/status: 40/.test(STORE_SRC.slice(STORE_SRC.indexOf("MONTHLY_PRIORITY_STRINGS"),
      STORE_SRC.indexOf("MONTHLY_PRIORITY_STRINGS") + 200)),
      "status survives the store's priority whitelist");
    assert.ok(/const merged = \{ \.\.\.existing, \.\.\.incoming/.test(STORE_SRC),
      "a section save merges over the record, so writing one list leaves the others alone");
  }

  /* ========= 9. v105 duplicate exclusion and the rest of the pull path still hold ========= */
  {
    const env = await week();
    env.ctx.wpPullMonthlyProject("focus:f1");
    env.ctx.wpPullMonthlyProject("personal:p1");
    await env.settle();
    let sel = picker(env);

    // in this week → excluded OUTRIGHT (a duplicate, not a completion — no disabled row for it)
    assert.ok(!sel.includes("Rebuild the onboarding call"), "an item already in this week drops out entirely");
    assert.ok(!sel.includes("Consistent wake/bed time"), "…on the personal side too");
    assert.ok(sel.includes("Hire a second coach") && sel.includes("Dentist"), "…while the open ones stay");

    // pulling the same item twice is still a no-op
    const n = projects(env).length, posts = env.posts.length;
    env.ctx.wpPullMonthlyProject("focus:f1");
    await env.settle();
    assert.strictEqual(projects(env).length, n, "pulling an item already in the week adds nothing");
    assert.strictEqual(env.posts.length, posts, "…and writes nothing");

    // both groups, in order, with the same shell
    assert.ok(sel.startsWith('<select class="wp-pull-sel" onchange="wpPullMonthlyProject(this.value); this.value=\'\';">'),
      "the control is the same select, wired the same way");
    assert.ok(sel.includes('<option value="">Pull from Monthly…</option>'), "…with the same placeholder");
    assert.ok(sel.indexOf('label="This Month\'s Focus"') < sel.indexOf('label="Personal'),
      "…business first, personal second");

    // an untitled monthly item is still never offered, done or not
    const env2 = await week({
      monthFocus: { [AUG]: [{ id: "u1", title: "  ", done: false }, { id: "u2", title: "Real one", done: false }] },
      monthPriorities: { [AUG]: [] },
    });
    assert.strictEqual((picker(env2).match(/<option /g) || []).length, 2,
      "placeholder + the one titled item");

    // an empty month renders no control at all
    const env3 = await week({ monthFocus: { [AUG]: [] }, monthPriorities: { [AUG]: [] } });
    assert.strictEqual(picker(env3), "", "a month with nothing in it renders no dropdown");
    assert.ok(!html(env3).includes("wp-pull-sel"), "…and no control on the card");
  }

  console.log("v112-monthly-done-single-source.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
