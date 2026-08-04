// Extract the page's main inline <script> body so it can be syntax-checked and evaluated
// inside the test sandbox.
// v106: the pages carry a SECOND inline script — the few-line theme boot that has to run
// before the stylesheet is parsed, so it sits at the top of <head>, ahead of the app. Taking
// the first match would hand the harness that snippet instead of the app (and every test
// would boot an empty sandbox), so the LARGEST block wins: the app script is orders of
// magnitude bigger than any boot snippet, and a page with one script is unaffected.
const fs = require("fs");
const path = require("path");

function extract(file) {
  const html = fs.readFileSync(
    file || path.join(__dirname, "..", "..", "index.html"),
    "utf8"
  );
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (!blocks.length) throw new Error("No inline <script> block found in " + (file || "index.html"));
  return blocks.reduce((a, b) => (b.length > a.length ? b : a));
}

module.exports = { extract };
