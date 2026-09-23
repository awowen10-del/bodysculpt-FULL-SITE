// v120 — the top menu is trimmed, and (v122) grouped, and (v126) stacked, and (v162) a rail.
//
// v162 UPDATE: the menu is no longer at the top at all — it is a side rail (.sidenav), one
// block of markup on every page. Every claim below still holds and is read from the rail:
// no HQ launcher, six links in one order labelled by period, exactly one active per page,
// and the section bar (#tabBar) untouched. Each link now leads with a sprite icon, which
// is stripped before the label is compared.
//
// v126 UPDATE: the two groups are no longer side by side on one line. Each is a STACK —
// an icon + caption above its own pill of links — so the group caption now contains an
// <svg> as well as its text, and the links live in a .navlinks pill inside .navgrp. What
// this test protects is unchanged and still checked below.
//
// v122 UPDATE: the menu is no longer a flat row of three. It is two labelled groups —
// Planning (Weekly / Monthly / Quarterly) and Finances (Income & Expenses) — because
// the finance page is not a step in the weekly→quarterly cadence and must not read as
// one. What this test was actually protecting is unchanged and still checked: no HQ
// launcher link, links labelled by period, exactly one active link per page, and the
// section bar (#tabBar) untouched.
//
// The "Bodysculpt HQ" back-link (a hardcoded pointer at bodysculptdashboard.netlify.app)
// is gone from all three pages, and the three remaining links are labelled by PERIOD
// alone — "Weekly", "Monthly", "Quarterly" — rather than by page title. The second bar
// (.viewtoggle / #tabBar) still names the sections within a page and is untouched.
//
// Presentation only: no store key, save path or handler is involved, so this test reads
// the markup rather than booting the app.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const WEEKLY = read("index.html");
const MONTHLY = read("monthly.html");
const QUARTERLY = read("quarterly.html");

const PAGES = [
  ["index.html", WEEKLY, "/index.html"],
  ["monthly.html", MONTHLY, "/monthly.html"],
  ["quarterly.html", QUARTERLY, "/quarterly.html"],
  ["finances.html", read("finances.html"), "/finances.html"],
  // v135: the Daily Dashboard is a fifth page and lives under the same rules.
  ["daily.html", read("daily.html"), "/daily.html"],
  // v136: and Social is the sixth.
  ["social.html", read("social.html"), "/social.html"],
  // v167: Facebook Ads is the seventh.
  ["ads.html", read("ads.html"), "/ads.html"],
  // v170: Scheduling is the eighth.
  ["schedule.html", read("schedule.html"), "/schedule.html"],
];

(async () => {
  /* ================= 0. the build stamp ================= */
  // v121 relaxed this: the newest release's test pins the exact stamp, older ones only
  // check the build never goes backwards and that the two pages agree.
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(MONTHLY);
  assert.ok(stamp && Number(stamp[1]) >= 120, "monthly.html stamped v120 or later");
  assert.ok(WEEKLY.includes("build v" + stamp[1] + " · " + stamp[2]), "index.html carries the same stamp");

  /* ================= 1. the HQ launcher link is gone everywhere ================= */
  for (const [label, src] of PAGES) {
    assert.ok(!src.includes("bodysculptdashboard.netlify.app"), label + " has no HQ launcher link");
    assert.ok(!/Bodysculpt HQ/.test(src), label + " has no 'Bodysculpt HQ' label left over");
    assert.ok(!/EDIT THIS: point to your actual/.test(src), label + " dropped the stale placeholder comment");
  }

  /* ============ 2. the groups, labelled by period, one active ============
     v135 relaxed the COUNT: a third group (Today) joined the bar. What this test still
     owns is the claim it was written for — the planning links are labelled by period
     alone, and every page marks its own link, once. */
  for (const [label, src, self] of PAGES) {
    const nav = /<nav class="sn-nav">([\s\S]*?)<\/nav>/.exec(src);
    assert.ok(nav, label + " still has a nav block (the rail's)");

    // the group headings, in order
    const groups = [...nav[1].matchAll(/<span class="sn-cap">([^<]+)<\/span>/g)].map((m) => m[1].trim());
    // v165: a fifth group, Numbers, between Planning and Social — the KPI tabs' own front door
    assert.deepStrictEqual(groups, ["Today", "Planning", "Numbers", "Social", "Finances"], label + " names the five groups");
    assert.strictEqual((nav[1].match(/<div class="sn-group/g) || []).length, 5,
      label + " keeps the five groups apart");

    // v162: a link leads with its icon; v163 wrapped the label so the fold can hide it
    const links = [...nav[1].matchAll(/<a href="([^"]+)"([^>]*)><svg class="ic"><use href="#ic-[a-z-]+"\/><\/svg><span class="sn-lbl">([\s\S]*?)<\/span><\/a>/g)];
    assert.strictEqual(links.length, 11, label + " menu has today, the three periods, Projects (v213), the two KPI doors, the three social pages and finances");

    assert.deepStrictEqual(
      links.map((m) => m[1]),
      ["/daily.html", "/index.html", "/monthly.html", "/quarterly.html", "/projects.html", "/index.html#kpi", "/monthly.html#kpi", "/social.html", "/ads.html", "/schedule.html", "/finances.html"],
      label + " links to today, the three periods in order, the two KPI tabs, then social (Instagram, Facebook Ads — v167), then finances"
    );
    assert.deepStrictEqual(
      links.map((m) => m[3].trim()),
      ["Daily Dashboard", "Weekly", "Monthly", "Quarterly", "Projects", "Weekly KPIs", "Monthly KPIs", "Content", "Facebook Ads", "Scheduling", "Income &amp; Expenses"],
      label + " labels the periods by period alone"
    );

    // no stray markup left inside a label (the HQ link carried a <span class="ico">)
    for (const m of links) {
      assert.ok(!/[<>]/.test(m[3]), label + ' label "' + m[3] + '" is plain text');
    }

    // the page's own link is the active one, and it is the only active one
    const active = links.filter((m) => /class="sn-link active"/.test(m[2]));
    for (const m of links) assert.ok(/^ class="sn-link(?: active)?" title="[^"]+"$/.test(m[2]), label + " a link carries only its class and a tooltip");
    assert.strictEqual(active.length, 1, label + " marks exactly one link active");
    assert.strictEqual(active[0][1], self, label + " marks its own link active");

    // v121 removed dark mode entirely, so the toggle that used to sit here is gone.
    assert.ok(!/id="themeToggle"/.test(src), label + " has no theme toggle left anywhere");
  }

  /* ================= 3. the section bar ================= */
  // The two bars do different jobs: the rail names the PAGE, #tabBar names the SECTION
  // within it. v166: the plan tab left the row — the plan is the page itself, reached from
  // the rail — so the row holds the numbers side's sections only and hides while the plan
  // shows (tests/v166 owns that). What this still checks: the sections that remain are
  // the ones that were always there, in the same order.
  const SECTIONS = [
    ["index.html", WEEKLY, ["KPIs", "Facebook Ads", "Table"]],
    ["monthly.html", MONTHLY, ["KPIs", "Expenses", "Growth"]],
  ];
  for (const [label, src, expected] of SECTIONS) {
    const bar = /<div class="viewtoggle" id="tabBar" hidden>([\s\S]*?)<\/div>/.exec(src);
    assert.ok(bar, label + " still has its section bar");
    const tabs = [...bar[1].matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].trim());
    assert.deepStrictEqual(tabs, expected, label + " section tabs are unchanged");
  }

  console.log("v120-top-nav-trim.test: all assertions passed");
})();
