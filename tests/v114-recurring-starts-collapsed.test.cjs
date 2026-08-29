// v114: the recurring card starts COLLAPSED on every load.
//
// It is the tallest thing sitting above the week itself, and v113 only made it taller by
// filling two more tabs — so the quiet state is now the default one. The change is a single
// initial value: the state was already session-only and never stored, so "always starts
// collapsed" needs nothing more than that. Everything else is untouched — the toggle works
// both ways within the session, the state still survives moving between weeks, the per-tab
// counts are still on the collapsed header, and adding a task still opens the card so you
// can see what you just added.
//
// The behaviour in depth (collapsed shell, counts, expand, cross-week persistence) is v102's
// to assert, and it does. This file owns the DEFAULT and the current build stamp.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/env.cjs");

const WEEKLY = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const MONTHLY = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const WEEK = "2026-08-17", NEXT = "2026-08-24";

const html = (env) => env.ctx.document.getElementById("wpBody").innerHTML;
const DEFAULTS = [
  { id: "d1", title: "Inbox zero", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], time: "6-9" },
  { id: "w1", title: "Scorecard", days: ["mon"], time: "6-9" },
  { id: "w2", title: "Supplier call", days: ["thu"], time: "1-3" },
  { id: "m1", title: "Invoices out", cadence: "monthly", monthlyRule: { type: "dayOfMonth", day: 1, slot: "10-12" } },
  { id: "q1", title: "Board pack", cadence: "quarterly",
    quarterlyRule: { type: "ordinalWeekday", ordinal: 2, weekday: "tue", monthOfQuarter: 2, slot: "10-12" } },
];

async function week(wk) {
  const env = await boot({ defaults: DEFAULTS, plans: { [WEEK]: { weekEnding: WEEK }, [NEXT]: { weekEnding: NEXT } } });
  await env.ctx.loadWeeklyPlan(wk || WEEK);
  await env.settle();
  return env;
}

(async () => {
  /* ================= 0. the build stamp ================= */
  // ">= v114" — the exact stamp is asserted by the newest version's test; both pages still
  // have to agree on it (v101).
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(MONTHLY);
  assert.ok(stamp && Number(stamp[1]) >= 114, "monthly.html stamped v114 or later");
  assert.ok(WEEKLY.includes("build v" + stamp[1] + " · " + stamp[2]), "index.html carries the same stamp");

  /* ================= 1. THE CHANGE: collapsed on load ================= */
  {
    const env = await week();
    assert.strictEqual(env.ctx.__wpState.recurCollapsed, true, "the recurring card starts collapsed");
    const h = html(env);
    assert.ok(h.includes("wp-rec-collapsed"), "…rendered as the header-only shell");
    assert.ok(/aria-expanded="false"/.test(h), "…and the toggle says so");
    assert.ok(!h.includes("wp-rec-tabs"), "the tab strip is not rendered");
    assert.ok(!/data-item-title="recurring:w1"/.test(h), "…nor any task row");
    assert.ok(!h.includes("+ Add recurring"), "…nor the add control");

    // it is the INITIAL VALUE that changed — nothing is read from or written to storage
    assert.ok(/let wpRecurCollapsed = true;/.test(WEEKLY), "the state initialises collapsed");
    assert.ok(!/wpRecurCollapsed[^;\n]*localStorage/.test(WEEKLY), "…and is still never persisted");
    assert.ok(!env.posts.length || !env.posts.some((p) => JSON.stringify(p.body).includes("recurCollapsed")),
      "…so nothing about it is ever saved");
  }

  /* ================= 2. the counts are still readable while collapsed ================= */
  {
    const env = await week();
    const summary = /<span class="wp-rec-summary">([^<]*)<\/span>/.exec(html(env));
    assert.ok(summary, "the collapsed header carries a summary");
    assert.strictEqual(summary[1], "Daily 1 · Weekly 2 · Monthly 1 · Quarterly 1",
      "…the per-tab counts, so you can see what is in there without opening it");
    assert.ok(html(env).includes(">Recurring <span"), "…beside the card's name");

    // a tab with nothing in it is left out rather than shown as a zero
    const few = await boot({ defaults: [DEFAULTS[1]], plans: { [WEEK]: { weekEnding: WEEK } } });
    await few.ctx.loadWeeklyPlan(WEEK);
    await few.settle();
    assert.strictEqual(/<span class="wp-rec-summary">([^<]*)<\/span>/.exec(html(few))[1], "Weekly 1",
      "…and only the tabs that hold something");
  }

  /* ================= 3. expanding and collapsing still work, unchanged ================= */
  {
    const env = await week();

    env.ctx.wpToggleRecurCollapsed();
    await env.settle();
    let h = html(env);
    assert.strictEqual(env.ctx.__wpState.recurCollapsed, false, "one click expands it");
    assert.ok(h.includes("wp-rec-tabs") && /aria-expanded="true"/.test(h), "…to the full card");
    assert.ok(h.includes("wpRecurSwitchTab('daily')") && h.includes("wpRecurSwitchTab('quarterly')"),
      "…with all four tabs");
    assert.ok(/data-item-title="recurring:w1"/.test(h), "…its task rows");
    assert.ok(h.includes("+ Add recurring"), "…and its add control");

    env.ctx.wpToggleRecurCollapsed();
    await env.settle();
    assert.strictEqual(env.ctx.__wpState.recurCollapsed, true, "…and clicking again collapses it");
    assert.ok(html(env).includes("wp-rec-collapsed"), "…back to the shell");

    // once open it STAYS open for the rest of the session, including across weeks
    env.ctx.wpToggleRecurCollapsed();
    await env.settle();
    await env.ctx.loadWeeklyPlan(NEXT);
    await env.settle();
    assert.strictEqual(env.ctx.__wpState.recurCollapsed, false,
      "an expanded card stays expanded when you change week — the default is about a fresh load");
    assert.ok(html(env).includes("wp-rec-tabs"), "…still rendered open");

    // …and a fresh load is collapsed again, every time
    for (const wk of [WEEK, NEXT]) {
      const fresh = await week(wk);
      assert.strictEqual(fresh.ctx.__wpState.recurCollapsed, true, "a fresh load starts collapsed: " + wk);
    }
  }

  /* ================= 4. adding a task still opens the card ================= */
  {
    const env = await week();
    assert.strictEqual(env.ctx.__wpState.recurCollapsed, true, "starts collapsed");
    env.ctx.prompt = () => "Brand new task";
    await env.ctx.wpAddRecurring();
    await env.settle();
    assert.strictEqual(env.ctx.__wpState.recurCollapsed, false,
      "adding a recurring task still expands the card — you never add into something you can't see");
    assert.ok(html(env).includes("Brand new task"), "…so the new task is visible");

    // the same for a v113 cadence task
    const cad = await week();
    cad.ctx.prompt = () => "Quarterly review";
    await cad.ctx.wpAddCadence("quarterly");
    await cad.settle();
    assert.strictEqual(cad.ctx.__wpState.recurCollapsed, false, "…and so does adding a quarterly one");
    assert.ok(html(cad).includes("Quarterly review"), "…visible on the tab it landed in");
  }

  /* ================= 5. ONLY the recurring card ================= */
  {
    // it is the only card with a collapse control at all, so there is nothing else to change
    assert.strictEqual((WEEKLY.match(/wpToggleRecurCollapsed\(\)/g) || []).length, 3,
      "the one toggle: the chevron, the collapsed title, and the definition");
    assert.ok(!/let wp[A-Z]\w*Collapsed = /.test(WEEKLY.replace("let wpRecurCollapsed = true;", "")),
      "no other card carries a collapse state");

    // every other card still renders whole on load, exactly as before
    const env = await week();
    const h = html(env);
    ["Project", "Buffer", "Training", "Time Blocks", "End-of-Week Review"].forEach((name) =>
      assert.ok(h.includes(name), "the " + name + " card renders on load as it always did"));
    assert.ok(h.includes("+ Add project task") && h.includes("+ Add buffer task") && h.includes("+ Add training"),
      "…each with its own controls, none of them hidden behind a collapse");
    assert.ok(h.includes("wp-grid"), "…and the week grid itself is untouched");
  }

  console.log("v114-recurring-starts-collapsed.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
