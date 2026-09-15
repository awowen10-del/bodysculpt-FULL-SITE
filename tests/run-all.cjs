// Regression runner: syntax-checks the extracted inline script, then runs
// every *.test.cjs in this folder. Usage: node tests/run-all.js
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { extract } = require("./lib/extract.cjs");

// 1) node --check the extracted <script> body of each single-file app, plus the store
const SOURCES = [
  ["index.html", path.join(__dirname, "..", "index.html")],
  ["monthly.html", path.join(__dirname, "..", "monthly.html")],
  // v106: quarterly.html joined the syntax check when the theming change started touching it
  ["quarterly.html", path.join(__dirname, "..", "quarterly.html")],
  // v122: the Finances page is a fourth single-file app and gets the same check
  ["finances.html", path.join(__dirname, "..", "finances.html")],
  // v135: the Daily Dashboard is a fifth single-file app and gets the same check
  ["daily.html", path.join(__dirname, "..", "daily.html")],
  // v136: the Social page is the sixth
  ["social.html", path.join(__dirname, "..", "social.html")],
  // v167: Facebook Ads is the seventh
  ["ads.html", path.join(__dirname, "..", "ads.html")],
  // v170: Scheduling is the eighth
  ["schedule.html", path.join(__dirname, "..", "schedule.html")],
];
for (const [label, file] of SOURCES) {
  const tmp = path.join(os.tmpdir(), "bodysculpt-extracted-" + process.pid + "-" + label + ".js");
  fs.writeFileSync(tmp, extract(file));
  const chk = spawnSync(process.execPath, ["--check", tmp], { stdio: "inherit" });
  fs.unlinkSync(tmp);
  if (chk.status !== 0) {
    console.error("SYNTAX CHECK FAILED (" + label + ") — aborting test run");
    process.exit(1);
  }
  console.log("syntax check " + label + ": OK");
}
// v161: google-auth.js keeps the long-lived Google credential and gets the same check
for (const fn of ["kpi-store.js", "stripe-feed.js", "instagram-feed.js", "google-auth.js", "ig-snapshot.js",
                  "schedule-queue.js", "schedule-caption-background.js", "schedule-publish-background.js", "../lib/schedule.js"]) {
  const chk = spawnSync(process.execPath, ["--check", path.join(__dirname, "..", "netlify", "functions", fn)], { stdio: "inherit" });
  if (chk.status !== 0) {
    console.error("SYNTAX CHECK FAILED (" + fn + ") — aborting test run");
    process.exit(1);
  }
  console.log("syntax check " + fn + ": OK");
}

// 1b) v167: the Facebook Ads server code is TypeScript — `tsc` is its syntax check, and
// its type check. netlify/ads/tsconfig.json covers netlify/ads/src and the ads-* functions.
{
  const tsc = path.join(__dirname, "..", "node_modules", "typescript", "bin", "tsc");
  const chk = spawnSync(process.execPath, [tsc, "-p", path.join(__dirname, "..", "netlify", "ads", "tsconfig.json")], { stdio: "inherit" });
  if (chk.status !== 0) {
    console.error("TYPE CHECK FAILED (netlify/ads) — aborting test run");
    process.exit(1);
  }
  console.log("type check netlify/ads: OK");
}

// 2) run every test file
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.cjs")).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: "inherit" });
  if (r.status !== 0) { failed++; console.error(`FAILED: ${f}`); }
}
console.log(failed ? `\n${failed} of ${files.length} test file(s) FAILED` : `\nAll ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
