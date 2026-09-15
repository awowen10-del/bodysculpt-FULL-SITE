// v165 — Numbers in the rail.
//
// Ash: "right now we have 'KPIs' living inside of the weekly and monthly which are under
// 'planning', do you think they continue to live here — or, do we create a separate area
// for them under the nav bar?" — and, on the recommendation: "Let's go with the 2nd option."
// With the warning that mattered: "I can't stress how this move should and will not break
// anything."
//
// The 2nd option: the KPIs do NOT move. They stay the tab they have always been on the
// weekly and monthly pages — same data, same forms, same maths, same code. What they gain
// is a front door in the rail: a Numbers group with "Weekly KPIs" (/index.html#kpi) and
// "Monthly KPIs" (/monthly.html#kpi). Each page reads that one hash on load and opens its
// KPIs tab; anything else lands where it always did. Switching tabs writes the hash back
// (replaceState, which fires no hashchange) and moves the rail's mark, so "Weekly" and
// "Weekly KPIs" each mean exactly one thing and a refresh lands where you were.
//
// "Will not break anything" is the claim under test, so the real pages are BOOTED here:
// with no hash they land exactly where v94 said they must, and with #kpi they land on KPIs.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const weekly = require("./lib/env.cjs");
const monthly = require("./lib/monthly-env.cjs");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const FILES = ["index.html", "monthly.html", "quarterly.html", "finances.html", "daily.html", "social.html", "ads.html", "schedule.html"];
const scriptOf = (src) => src.slice(src.lastIndexOf("<script>") + 8, src.lastIndexOf("</script>"));

(async () => {
  /* ================= 0. the stamp ================= */
  const text = "build v175 · gemini-is-busy-not-broken";
  for (const f of ["monthly.html", "index.html", "finances.html", "daily.html", "social.html"]) {
    assert.ok(read(f).includes(text), f + " carries the stamp");
  }

  /* ============ 1. the rail: a Numbers group, the same on every page ============ */
  for (const f of FILES) {
    const src = read(f), label = f + ": ";
    const grp = /<div class="sn-group">\s*<span class="sn-cap">Numbers<\/span>\s*<a href="\/index.html#kpi" class="sn-link" title="Weekly KPIs"><svg class="ic"><use href="#ic-trend-up"\/><\/svg><span class="sn-lbl">Weekly KPIs<\/span><\/a>\s*<a href="\/monthly.html#kpi" class="sn-link" title="Monthly KPIs"><svg class="ic"><use href="#ic-trend-up"\/><\/svg><span class="sn-lbl">Monthly KPIs<\/span><\/a>\s*<\/div>/.exec(src);
    assert.ok(grp, label + "a Numbers group with the two KPI doors, never marked active at build");
    const caps = [...src.matchAll(/<span class="sn-cap">([^<]+)<\/span>/g)].map((m) => m[1]);
    assert.deepStrictEqual(caps, ["Today", "Planning", "Numbers", "Social", "Finances"], label + "…between Planning and Social");
    // the KPI doors are the SAME pages — no kpis.html exists, nothing moved
    assert.ok(!/kpis?\.html/.test(src), label + "no separate KPI page is linked");
    // the rail's mark can follow the tab, on any page, harmlessly where there is no KPI link
    const js = scriptOf(src);
    assert.ok(/window\.snMarkActive = function \(onKpi\) \{\s*if \(!own \|\| !kpi\) return;/.test(js),
      label + "snMarkActive exists and is a no-op where the page has no KPI door");
  }
  assert.ok(!fs.existsSync(path.join(__dirname, "..", "kpis.html")), "there is no kpis.html — the numbers did not move");

  /* ============ 2. the weekly page, booted: no hash = as before; #kpi = KPIs ============ */
  {
    const src = read("index.html"), js = scriptOf(src);
    // v166: the numbers side grew to three tabs, each with a hash; the plan is still the default
    assert.ok(/const WP_TAB_HASH = \{ kpi:'#kpi', fb:'#fb', table:'#table' \};/.test(js) && /\|\| 'plan';/.test(js),
      "weekly: #kpi, #fb and #table name the numbers tabs; everything else is the plan");
    assert.ok(/if\(window\.showTab\) window\.showTab\(wpTabFromHash\(\)\);/.test(js), "weekly: the landing tab is read from the hash");
    assert.ok(/window\.addEventListener\('hashchange',\(\)=>show\(wpTabFromHash\(\)\)\);/.test(js),
      "weekly: the rail's link, clicked while already here, still switches the tab");
    assert.ok(/if\(window\.snMarkActive\) window\.snMarkActive\(which!=='plan'\);/.test(js), "weekly: the tab switch moves the rail's mark");
    assert.ok(/window\.history\.replaceState\(null,'', WP_TAB_HASH\[which\] \|\| \(window\.location\.pathname \+ window\.location\.search\)\)/.test(js),
      "weekly: …and writes the hash back without a hashchange, so a refresh lands where you were");

    const plain = await weekly.boot({});
    const el = (id) => plain.ctx.document.getElementById(id);
    assert.strictEqual(el("planView").hidden, false, "weekly, no hash: lands on the Weekly Plan (v94's rule, untouched)");
    assert.strictEqual(el("kpiView").hidden, true, "…and the KPIs view is hidden");

    const kpi = await weekly.boot({ hash: "#kpi" });
    const el2 = (id) => kpi.ctx.document.getElementById(id);
    assert.strictEqual(el2("kpiView").hidden, false, "weekly, #kpi: lands on the KPIs tab");
    assert.strictEqual(el2("planView").hidden, true, "…and the plan is hidden");
    assert.strictEqual(el2("weekActions").style.display, "flex", "…with the entry/edit buttons showing, exactly as a click on the tab gives");
    // and the tab still switches the way it always did
    kpi.ctx.window.showTab("plan");
    assert.strictEqual(el2("planView").hidden, false, "…and showTab('plan') still brings the plan back");
  }

  /* ============ 3. the monthly page, booted: the same ============ */
  {
    const src = read("monthly.html"), js = scriptOf(src);
    assert.ok(/const MP_VIEW_HASH = \{ home:"#kpi", money:"#expenses", growth:"#growth" \};/.test(js) && /\|\| DEFAULT_VIEW;/.test(js),
      "monthly: #kpi (the KPIs view, id 'home' since forever), #expenses and #growth; everything else is the default");
    assert.ok(/const DEFAULT_VIEW = "plan";/.test(js), "monthly: the default is still the plan (v94)");
    assert.ok(/showView\(mpViewFromHash\(\)\);\s*\n\s*window\.addEventListener\("hashchange", \(\)=>showView\(mpViewFromHash\(\)\)\);/.test(js),
      "monthly: the landing view is read from the hash, and the rail's link works while already here");
    assert.ok(/if\(window\.snMarkActive\) window\.snMarkActive\(v!=="plan"\);/.test(js), "monthly: the view switch moves the rail's mark");

    const plain = await monthly.boot({});
    assert.strictEqual(plain.ctx.__mpState.view, "plan", "monthly, no hash: lands on the Monthly Plan (v94's rule, untouched)");
    const kpi = await monthly.boot({ hash: "#kpi" });
    assert.strictEqual(kpi.ctx.__mpState.view, "home", "monthly, #kpi: lands on the KPIs view");
    kpi.ctx.showView("plan");
    assert.strictEqual(kpi.ctx.__mpState.view, "plan", "…and showView('plan') still works");
  }

  /* ============ 4. nothing about the numbers changed ============
     The claim "will not break anything" in its narrowest checkable form: no store URL,
     no save path and no KPI function on either page was touched by this release — the
     diff is the rail, one hash reader, and a hook at the end of each tab switch. */
  for (const [f, fns] of [["index.html", ["wireViewToggle", "buildQuarterSelector", "renderScorecard"]],
                          ["monthly.html", ["showView", "renderCurrent", "renderHome"]]]) {
    const js = scriptOf(read(f));
    for (const fn of fns) assert.ok(new RegExp("function " + fn + "\\(").test(js), f + " still has " + fn);
    // the hash is read in exactly one function per page, and nowhere else
    assert.strictEqual((js.match(/location\.hash/g) || []).length, 1, f + " reads the hash in one place only");
  }

  console.log("v165-numbers-in-the-rail.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
