// v120 — the top menu is trimmed, and (v122) grouped.
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

  /* ============ 2. two groups, labelled by period, one active ============ */
  for (const [label, src, self] of PAGES) {
    const nav = /<nav class="topnav">([\s\S]*?)<\/nav>/.exec(src);
    assert.ok(nav, label + " still has a .topnav block");

    // the group headings, in order
    const groups = [...nav[1].matchAll(/<span class="navgroup">([^<]+)<\/span>/g)].map((m) => m[1].trim());
    assert.deepStrictEqual(groups, ["Planning", "Finances"], label + " names the two groups");
    assert.ok(/<span class="navsep"><\/span>/.test(nav[1]), label + " rules the groups apart");

    const links = [...nav[1].matchAll(/<a href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/g)];
    assert.strictEqual(links.length, 4, label + " top menu has the three periods plus finances");

    assert.deepStrictEqual(
      links.map((m) => m[1]),
      ["/index.html", "/monthly.html", "/quarterly.html", "/finances.html"],
      label + " links to the three periods in order, then finances"
    );
    assert.deepStrictEqual(
      links.map((m) => m[3].trim()),
      ["Weekly", "Monthly", "Quarterly", "Income &amp; Expenses"],
      label + " labels the periods by period alone"
    );

    // no stray markup left inside a label (the HQ link carried a <span class="ico">)
    for (const m of links) {
      assert.ok(!/[<>]/.test(m[3]), label + ' label "' + m[3] + '" is plain text');
    }

    // the page's own link is the active one, and it is the only active one
    const active = links.filter((m) => /class="active"/.test(m[2]));
    assert.strictEqual(active.length, 1, label + " marks exactly one link active");
    assert.strictEqual(active[0][1], self, label + " marks its own link active");

    // v121 removed dark mode entirely, so the toggle that used to sit here is gone.
    assert.ok(!/id="themeToggle"/.test(src), label + " has no theme toggle left anywhere");
  }

  /* ================= 3. the section bar is untouched ================= */
  // The two bars do different jobs: .topnav names the PERIOD, #tabBar names the SECTION
  // within that period. Trimming the first must not have touched the second.
  const SECTIONS = [
    ["index.html", WEEKLY, ["Weekly Plan", "KPIs", "Facebook Ads", "Table"]],
    ["monthly.html", MONTHLY, ["Monthly Plan", "KPIs", "Expenses", "Growth"]],
  ];
  for (const [label, src, expected] of SECTIONS) {
    const bar = /<div class="viewtoggle" id="tabBar">([\s\S]*?)<\/div>/.exec(src);
    assert.ok(bar, label + " still has its section bar");
    const tabs = [...bar[1].matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].trim());
    assert.deepStrictEqual(tabs, expected, label + " section tabs are unchanged");
  }

  console.log("v120-top-nav-trim.test: all assertions passed");
})();
