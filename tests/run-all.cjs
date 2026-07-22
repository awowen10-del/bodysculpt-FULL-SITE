// Regression runner: syntax-checks the extracted inline script, then runs
// every *.test.cjs in this folder. Usage: node tests/run-all.js
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { extract } = require("./lib/extract.cjs");

// 1) node --check the extracted <script> body
const tmp = path.join(os.tmpdir(), "bodysculpt-extracted-" + process.pid + ".js");
fs.writeFileSync(tmp, extract());
const chk = spawnSync(process.execPath, ["--check", tmp], { stdio: "inherit" });
fs.unlinkSync(tmp);
if (chk.status !== 0) {
  console.error("SYNTAX CHECK FAILED — aborting test run");
  process.exit(1);
}
console.log("syntax check: OK");

// 2) run every test file
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.cjs")).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: "inherit" });
  if (r.status !== 0) { failed++; console.error(`FAILED: ${f}`); }
}
console.log(failed ? `\n${failed} of ${files.length} test file(s) FAILED` : `\nAll ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
