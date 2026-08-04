// v102, two additions to the Weekly Plan:
//   1. the monthly anchor is a two-column row — business focus left, the month's PERSONAL
//      priorities right — both read-only reflections of the same monthly-plan record for the
//      week's month, done-state included.
//   2. the recurring card collapses to its header + per-tab counts, remembered for the
//      session, with everything inside it unchanged when expanded.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/env.cjs");

const WEEKLY = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const AUG_WEEK = "2026-08-10", SEP_WEEK = "2026-09-07";

const MONTH_FOCUS = {
  "2026-08": [
    { id: "f1", title: "Rebuild the onboarding call", rockRef: "1", done: true },
    { id: "f2", title: "Price review", rockRef: "", done: false },
  ],
  "2026-09": [{ id: "s1", title: "September business thing", done: false }],
};
const MONTH_PRIORITIES = {
  "2026-08": [
    { id: "p1", title: "Redo the garden", owner: "Ash", status: "Done", notes: "quotes in" },
    { id: "p2", title: "Book the Italy trip", owner: "", status: "In Progress", notes: "" },
  ],
  "2026-09": [{ id: "s2", title: "September personal thing", status: "Not Started" }],
};
const DEFAULTS = [
  { id: "r1", title: "Standup", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], time: "6-9" },
  { id: "r2", title: "Scorecard", days: ["mon"], time: "10-12" },
  { id: "r3", title: "Payroll", days: ["fri"], time: "1-3" },
];

const html = (env) => env.ctx.document.getElementById("wpBody").innerHTML;
// the anchor's two columns, sliced apart
function cols(env) {
  const h = html(env);
  const box = h.slice(h.indexOf('<div class="wp-anchor">'), h.indexOf('<div class="wp-top'));
  const split = box.indexOf('<div class="wp-anchor-col wp-anchor-personal">');
  return { box, business: box.slice(0, split), personal: box.slice(split) };
}
async function week(opts) {
  const env = await boot(Object.assign({
    defaults: DEFAULTS, monthFocus: MONTH_FOCUS, monthPriorities: MONTH_PRIORITIES,
    plans: { [AUG_WEEK]: { weekEnding: AUG_WEEK }, [SEP_WEEK]: { weekEnding: SEP_WEEK } },
  }, opts || {}));
  await env.ctx.loadWeeklyPlan(opts && opts.week ? opts.week : AUG_WEEK);
  await env.settle();
  return env;
}

(async () => {
  // ">= v102" — the exact stamp is asserted by the newest version's test.
  const stamp = /build v(\d+) · [a-z0-9-]+/.exec(WEEKLY);
  assert.ok(stamp && Number(stamp[1]) >= 102, "build stamp is v102 or later");

  /* ================= 1. the two-column monthly anchor ================= */
  {
    const env = await week();
    const c = cols(env);

    // equal columns, one row
    assert.ok(c.box.includes('<div class="wp-anchor-cols">'), "the anchor is a column row");
    assert.ok(/\.wp-anchor-cols\{[^}]*grid-template-columns:1fr 1fr/.test(WEEKLY), "…of two equal columns");
    assert.strictEqual((c.box.match(/class="wp-anchor-col[" ]/g) || []).length, 2, "…exactly two of them");
    assert.ok(c.box.indexOf("August focus") < c.box.indexOf("August personal"), "business left, personal right");

    // left: business, unchanged
    assert.ok(c.business.includes("August focus"), "left column is the month's business focus");
    assert.ok(c.business.includes("from Monthly Plan"), "…labelled with its source");
    assert.ok(/wp-anchor-done"><span class="wp-anchor-tick">✓<\/span>Rebuild the onboarding call/.test(c.business),
      "…with the done item struck through and ticked (v98 behaviour intact)");
    assert.ok(c.business.includes('<li class="wp-anchor-item">Price review</li>'), "…and open items plain");
    assert.ok(!c.business.includes("Redo the garden"), "…and no personal items on the business side");

    // right: personal, from the same record
    assert.ok(c.personal.includes("August personal"), "right column is the month's personal priorities");
    assert.ok(c.personal.includes("from Monthly Plan"), "…same source label");
    assert.ok(c.personal.includes("Redo the garden") && c.personal.includes("Book the Italy trip"),
      "…listing the personal items");
    assert.ok(/wp-anchor-done"><span class="wp-anchor-tick">✓<\/span>Redo the garden/.test(c.personal),
      "…with Status:Done reflected as done");
    assert.ok(c.personal.includes('<li class="wp-anchor-item">Book the Italy trip</li>'),
      "…and a non-Done item plain");
    assert.ok(!c.personal.includes("Rebuild the onboarding call"), "…and no business items on the personal side");

    // personal accent, consistent with the rest of the app
    assert.ok(/\.wp-anchor-personal \.wp-anchor-h\{color:var\(--green\);?\}/.test(WEEKLY),
      "the personal column carries the green personal accent");

    /* ---- read-only: no controls, no write path ---- */
    ["<input", "<select", "<textarea", "onchange", "contenteditable", "draggable"]
      .forEach((c2) => assert.ok(!cols(env).box.includes(c2), "the anchor stays read-only: no " + c2));
    // v104 added ONE handler to the anchor — the read-only notes viewer. Nothing else may
    // appear here: any other handler would be a write path into the monthly record.
    (cols(env).box.match(/on[a-z]+="[^"]*"/g) || []).forEach((h) =>
      assert.ok(/^onclick="wpOpenAnchorNotes\(/.test(h), "the anchor's only handler is the notes viewer, not " + h));
    assert.ok(!env.posts.some((p) => p.body.monthlyPlan), "the weekly app never writes the monthly record");
    const st = env.ctx.__wpState;
    assert.ok(!("focus" in st.plan) && !("priorities" in st.plan) && !("monthFocus" in st.plan),
      "no copy of either monthly list is stored on the weekly plan");

    /* ---- month resolution: the week's own month, both sides ---- */
    await env.ctx.loadWeeklyPlan(SEP_WEEK);
    await env.settle();
    const sep = cols(env);
    assert.ok(sep.business.includes("September business thing"), "a September week shows September's focus");
    assert.ok(sep.personal.includes("September personal thing"), "…and September's personal items");
    assert.ok(!sep.box.includes("Redo the garden") && !sep.box.includes("Rebuild the onboarding call"),
      "…and nothing from August");
    assert.ok(!sep.box.includes("wp-anchor-done"), "…with September's own done-state (nothing done)");
  }

  /* ---- empty sides ---- */
  {
    // personal empty → the column stays with a quiet hint, business unaffected
    let env = await week({ monthPriorities: { "2026-08": [] } });
    let c = cols(env);
    assert.ok(c.personal.includes("Nothing set for this month."), "an empty personal side shows a hint");
    assert.ok(c.business.includes("Price review"), "…and the business side still renders");

    // business empty → same, the other way round
    env = await week({ monthFocus: { "2026-08": [] } });
    c = cols(env);
    assert.ok(c.business.includes("Nothing set for this month."), "an empty business side shows a hint");
    assert.ok(c.personal.includes("Redo the garden"), "…and the personal side still renders");
    assert.strictEqual((c.box.match(/class="wp-anchor-col[" ]/g) || []).length, 2, "…both columns still present");

    // both empty → no anchor at all, exactly as the business anchor behaved before
    env = await week({ monthFocus: { "2026-08": [] }, monthPriorities: { "2026-08": [] } });
    assert.ok(!html(env).includes('<div class="wp-anchor">'), "with nothing in the month, no anchor renders");
    assert.ok(html(env).includes("wp-grid-box") || html(env).includes("wp-box"),
      "…and the rest of the week still renders");
  }

  /* ================= 2. the collapsible recurring card ================= */
  {
    const env = await week();
    // the recurring card: its header through its add-row (another card uses .wp-rec-actions
    // earlier in the page, so search for the end AFTER the header)
    const recBox = (h) => { const a = h.indexOf("wp-rec-h"); const b = h.indexOf("wp-rec-actions", a); return h.slice(a, b < 0 ? undefined : b); };

    // default: expanded, exactly as before
    assert.strictEqual(env.ctx.__wpState.recurCollapsed, false, "the card starts expanded");
    let h = html(env);
    assert.ok(h.includes('class="wp-notes-tabs wp-rec-tabs"'), "the tabs render when expanded");
    assert.ok(h.includes("wpRecurSwitchTab('daily')") && h.includes("wpRecurSwitchTab('quarterly')"),
      "…all four of them");
    assert.ok(h.includes("+ Add recurring"), "…with the add control");
    assert.ok(h.includes("Scorecard") || h.includes("Payroll"), "…and the task rows");
    assert.ok(!h.includes("wp-rec-collapsed"), "…and no collapsed shell");
    assert.ok(/aria-expanded="true"/.test(h), "the toggle reports expanded");

    // collapse
    env.ctx.wpToggleRecurCollapsed();
    await env.settle();
    h = html(env);
    assert.strictEqual(env.ctx.__wpState.recurCollapsed, true, "it collapses");
    assert.ok(h.includes("wp-rec-collapsed"), "…to a header-only shell");
    assert.ok(/aria-expanded="false"/.test(h), "…reported on the toggle");
    assert.ok(!h.includes("wp-rec-tabs"), "the tabs are hidden when collapsed");
    assert.ok(!h.includes("+ Add recurring"), "…as is the add control");
    assert.ok(!/data-item-title="recurring:r2"/.test(h), "…and the task rows");  // no card body at all

    // counts still visible: "Daily 1 · Weekly 2"
    const summary = /<span class="wp-rec-summary">([^<]*)<\/span>/.exec(h);
    assert.ok(summary, "the collapsed header shows a summary");
    assert.strictEqual(summary[1], "Daily 1 · Weekly 2", "…the per-tab counts, so you know what's in there");
    assert.ok(h.includes(">Recurring <span"), "…next to the card's name");

    // it stays collapsed across weeks (session state)
    await env.ctx.loadWeeklyPlan(SEP_WEEK);
    await env.settle();
    assert.strictEqual(env.ctx.__wpState.recurCollapsed, true, "…and stays collapsed when the week changes");
    assert.ok(html(env).includes("wp-rec-collapsed"), "…still rendered collapsed");
    await env.ctx.loadWeeklyPlan(AUG_WEEK);
    await env.settle();
    assert.ok(html(env).includes("wp-rec-collapsed"), "…and back again");

    // expand: everything inside is exactly as it was
    env.ctx.wpToggleRecurCollapsed();
    await env.settle();
    h = html(env);
    assert.strictEqual(env.ctx.__wpState.recurCollapsed, false, "it expands again");
    assert.ok(h.includes("wp-rec-tabs") && h.includes("+ Add recurring"), "the card is whole again");
    assert.ok(/<span class="wp-ntab-count">1<\/span>/.test(h) && /<span class="wp-ntab-count">2<\/span>/.test(h),
      "…with the same per-tab counts on the tabs");

    // and the card still works: tab switching, rows, schedule, done-state, drag.
    // Scoped to the card — a scheduled task also appears as a chip in the grid below.
    env.ctx.wpRecurSwitchTab("daily");
    await env.settle();
    let card = recBox(html(env));
    assert.ok(card.includes("Standup"), "switching to Daily still shows the daily task");
    assert.ok(!card.includes("Scorecard"), "…and filters the others out of the card");
    assert.ok(/data-item-title="recurring:r1"/.test(card), "the row is still inline-editable");
    assert.ok(/data-rec-id="r1"/.test(card), "…still a recurring row with its id");
    assert.ok(card.includes("wpOpenPopup('recurring','r1'"), "…still schedulable via the 📅 button");
    assert.ok(card.includes("wpRemoveRecurring('r1'") || card.includes('wpRemoveRecurring("r1"'),
      "…still removable");
    env.ctx.wpRecurSwitchTab("weekly");
    await env.settle();
    card = recBox(html(env));
    assert.ok(card.includes("Scorecard") && card.includes("Payroll"), "and back to Weekly");
    assert.ok(!card.includes("Standup"), "…with the daily task filtered out again");

    // done-state through the card is untouched
    await env.ctx.wpToggleDoneRef("recurring:r2", true, "mon");
    await env.settle();
    assert.ok(env.posts.some((p) => p.body.weeklyPlan && p.body.weeklyPlan.recurringDone),
      "ticking a recurring task still saves its done-state");
  }

  /* ---- adding a recurring task never lands in a card you can't see ---- */
  {
    const env = await week();
    env.ctx.wpToggleRecurCollapsed();
    await env.settle();
    assert.strictEqual(env.ctx.__wpState.recurCollapsed, true, "collapsed");
    env.ctx.prompt = () => "Brand new task";
    await env.ctx.wpAddRecurring();
    await env.settle();
    assert.strictEqual(env.ctx.__wpState.recurCollapsed, false, "adding a recurring task expands the card");
    assert.ok(html(env).includes("Brand new task"), "…so the new task is visible");
  }

  console.log("v102-monthly-anchor-and-recurring-collapse.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
