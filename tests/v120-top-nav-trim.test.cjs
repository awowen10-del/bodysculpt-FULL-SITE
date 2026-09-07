// v120 — the top menu is trimmed to the three periods.
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

  /* ================= 2. exactly three links, labelled by period ================= */
  for (const [label, src, self] of PAGES) {
    const nav = /<nav class="topnav">([\s\S]*?)<\/nav>/.exec(src);
    assert.ok(nav, label + " still has a .topnav block");

    const links = [...nav[1].matchAll(/<a href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/g)];
    assert.strictEqual(links.length, 3, label + " top menu has exactly three links");

    assert.deepStrictEqual(
      links.map((m) => m[1]),
      ["/index.html", "/monthly.html", "/quarterly.html"],
      label + " links to the three pages in period order"
    );
    assert.deepStrictEqual(
      links.map((m) => m[3].trim()),
      ["Weekly", "Monthly", "Quarterly"],
      label + " labels the links by period alone"
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
