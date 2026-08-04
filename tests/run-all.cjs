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
const storeChk = spawnSync(process.execPath, ["--check", path.join(__dirname, "..", "netlify", "functions", "kpi-store.js")], { stdio: "inherit" });
if (storeChk.status !== 0) {
  console.error("SYNTAX CHECK FAILED (kpi-store.js) — aborting test run");
  process.exit(1);
}
console.log("syntax check kpi-store.js: OK");

// 2) run every test file
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.cjs")).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: "inherit" });
  if (r.status !== 0) { failed++; console.error(`FAILED: ${f}`); }
}
console.log(failed ? `\n${failed} of ${files.length} test file(s) FAILED` : `\nAll ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
