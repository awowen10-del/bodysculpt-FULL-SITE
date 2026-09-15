// v166 — the plan is the page.
//
// Ash: "Weekly planning: Just the weekly plan. Monthly planning: Just the monthly plan.
// Quarterly planning: keep as is. Weekly KPIs should be: KPIs, Facebook Ads, Table.
// Monthly KPIs should be: KPIs, Expenses, Growth."
//
// So each of those two pages has two SIDES, and the rail is how you pick one:
//   "Weekly"      → the Weekly Plan, alone, no tab row
//   "Weekly KPIs" → the numbers side, with its own row: KPIs · Facebook Ads · Table
// and the same for Monthly (KPIs · Expenses · Growth). The plan tab is gone from the row
// because the plan is the page; the row hides itself while the plan shows. Every view
// still exists and every switch still runs through the same show()/showView() — this is
// which buttons you see, not what the page can do. Each numbers tab has a hash so a
// refresh lands where you were and the rail's mark stays on the KPIs link.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const weekly = require("./lib/env.cjs");
const monthly = require("./lib/monthly-env.cjs");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const scriptOf = (src) => src.slice(src.lastIndexOf("<script>") + 8, src.lastIndexOf("</script>"));

(async () => {
  /* ================= 0. the stamp ================= */
  const text = "build v176 · out-of-lambda-compatibility-mode";
  for (const f of ["monthly.html", "index.html", "finances.html", "daily.html", "social.html"]) {
    assert.ok(read(f).includes(text), f + " carries the stamp");
  }

  /* ============ 1. the rows: numbers only, hidden at rest ============ */
  {
    const W = read("index.html"), M = read("monthly.html");
    const wbar = /<div class="viewtoggle" id="tabBar" hidden>([\s\S]*?)<\/div>/.exec(W);
    assert.deepStrictEqual([...wbar[1].matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]),
      ["KPIs", "Facebook Ads", "Table"], "weekly: the row is KPIs · Facebook Ads · Table");
    assert.ok(!/id="vtPlan"/.test(W), "weekly: there is no plan tab");
    const mbar = /<div class="viewtoggle" id="tabBar" hidden>([\s\S]*?)<\/div>/.exec(M);
    assert.deepStrictEqual([...mbar[1].matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]),
      ["KPIs", "Expenses", "Growth"], "monthly: the row is KPIs · Expenses · Growth");
    assert.ok(!/data-view="plan"/.test(M), "monthly: there is no plan tab");
    // the month picker rides in the row; the plan still has the period bar to change month
    assert.ok(mbar[0].includes('id="monthSel"'), "monthly: the month picker is in the numbers row");
    assert.ok(/id="pbPrev"/.test(M) && /id="pbNext"/.test(M) && /id="pbCurrent"/.test(M), "monthly: …and the period bar is outside it, for the plan");
    // hidden has to beat the row's display:flex, on every page that carries the row's CSS
    for (const f of ["index.html", "monthly.html", "finances.html", "daily.html", "social.html", "quarterly.html", "ads.html", "schedule.html"]) {
      assert.ok(/\n  \.viewtoggle\[hidden\]\{display:none;\}/.test(read(f)), f + ": a hidden row is hidden");
    }
    // quarterly: kept as is — no row, no sides, nothing of this applies
    assert.ok(!/id="tabBar"/.test(read("quarterly.html")), "quarterly: untouched, as asked");
  }

  /* ============ 2. weekly, booted: the plan alone; the numbers side with its row ============ */
  {
    const env = await weekly.boot({});
    const el = (id) => env.ctx.document.getElementById(id);
    assert.strictEqual(el("planView").hidden, false, "no hash: the plan shows");
    assert.strictEqual(el("tabBar").hidden, true, "…and the row is hidden — the plan is the page");
    for (const [tab, view] of [["kpi", "kpiView"], ["fb", "fbView"], ["table", "tableView"]]) {
      env.ctx.window.showTab(tab);
      assert.strictEqual(el(view).hidden, false, tab + " shows");
      assert.strictEqual(el("tabBar").hidden, false, "…with the row");
      assert.strictEqual(el("planView").hidden, true, "…and the plan hidden");
    }
    env.ctx.window.showTab("plan");
    assert.strictEqual(el("planView").hidden, false, "back to the plan");
    assert.strictEqual(el("tabBar").hidden, true, "…and the row goes again");
    // each numbers hash lands on its tab; the plan needs none
    for (const [hash, view] of [["#kpi", "kpiView"], ["#fb", "fbView"], ["#table", "tableView"]]) {
      const e = await weekly.boot({ hash });
      assert.strictEqual(e.ctx.document.getElementById(view).hidden, false, hash + " lands on its tab");
      assert.strictEqual(e.ctx.document.getElementById("tabBar").hidden, false, "…with the row showing");
    }
    const js = scriptOf(read("index.html"));
    assert.ok(/if\(bar\) bar\.hidden = \(which==='plan'\);/.test(js), "the row hides on the plan, in show() itself");
    assert.ok(!/tabs\.plan\.addEventListener/.test(js), "nothing wires a plan tab any more");
    assert.ok(/if\(!tabs\.kpi\) return;/.test(js), "…and the wiring no longer depends on one existing");
  }

  /* ============ 3. monthly, booted: the same ============ */
  {
    const env = await monthly.boot({});
    const bar = env.ctx.document.getElementById("tabBar");
    assert.strictEqual(env.ctx.__mpState.view, "plan", "no hash: the plan shows");
    assert.strictEqual(bar.hidden, true, "…and the row is hidden");
    for (const v of ["home", "money", "growth"]) {
      env.ctx.showView(v); await env.settle();
      assert.strictEqual(env.ctx.__mpState.view, v, v + " shows");
      assert.strictEqual(bar.hidden, false, "…with the row");
    }
    env.ctx.showView("plan"); await env.settle();
    assert.strictEqual(bar.hidden, true, "back to the plan, the row goes");
    for (const [hash, view] of [["#kpi", "home"], ["#expenses", "money"], ["#growth", "growth"]]) {
      const e = await monthly.boot({ hash });
      assert.strictEqual(e.ctx.__mpState.view, view, hash + " lands on its view");
    }
    const js = scriptOf(read("monthly.html"));
    assert.ok(/const bar=document\.getElementById\("tabBar"\); if\(bar\) bar\.hidden = \(v==="plan"\);/.test(js), "the row hides on the plan, in showView() itself");
  }

  console.log("v166-the-plan-is-the-page.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
