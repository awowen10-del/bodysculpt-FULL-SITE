// v123: `hidden` must actually hide.
//
// The browser hides [hidden] with display:none from its OWN stylesheet, and ANY author
// rule that sets display beats it. .wz-back sets display:flex, so `<div class="wz-back"
// hidden>` rendered at full size: the sort-out modal appeared on every page load, and
// because it is position:fixed inset:0 it covered the page and swallowed every click.
// .abtn sets display:inline-flex and broke the hidden sort button the same way.
//
// This is a whole CLASS of bug — it fires whenever someone adds `hidden` to an element
// whose class happens to set display — so the test is written to catch the class, not
// the two instances: find every element that starts hidden, and if any of its classes
// carries a display rule, demand the global guard that makes hidden win.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const PAGES = ["finances.html", "index.html", "monthly.html", "quarterly.html"];
let pass = 0;
console.log("v123 hidden-means-hidden:");

for (const page of PAGES) {
  const src = fs.readFileSync(path.join(__dirname, "..", page), "utf8");
  const css = src.slice(src.indexOf("<style>"), src.indexOf("</style>"));
  const cut = src.indexOf("<script>");
  const markup = src.slice(0, cut === -1 ? src.length : cut);

  // every element that ships with a hidden attribute, and the classes it carries
  const hiddenClasses = new Set();
  for (const tag of markup.match(/<[a-z]+[^>]*\bhidden\b[^>]*>/g) || []) {
    const c = /class="([^"]*)"/.exec(tag);
    if (c) for (const cl of c[1].trim().split(/\s+/)) if (cl) hiddenClasses.add(cl);
  }

  // of those, the ones whose own rule sets display — the dangerous combination
  const risky = [...hiddenClasses].filter((cl) => {
    const esc = cl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("\\." + esc + "\\s*\\{[^}]*display\\s*:").test(css);
  });

  // the guard: a bare [hidden] rule that forces display:none and cannot be outranked,
  // or — as the older pages do — a per-class .x[hidden] rule for every risky class
  const guarded = /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(css)
    || risky.every((cl) => new RegExp("\\." + cl + "\\[hidden\\]\\s*\\{[^}]*display\\s*:\\s*none").test(css));

  if (risky.length) {
    assert.ok(guarded, page + ": " + risky.map((c) => "." + c).join(", ")
      + " set display AND are used with the hidden attribute, but nothing forces hidden to win. "
      + "Add [hidden]{display:none!important} to the stylesheet.");
    console.log("  ok " + page.padEnd(16) + risky.length + " risky class(es) — guarded");
  } else {
    console.log("  ok " + page.padEnd(16) + "no class both hides and sets display");
  }
  pass++;
}

// And the specific instance that shipped broken, pinned by name so it cannot regress.
const fin = fs.readFileSync(path.join(__dirname, "..", "finances.html"), "utf8");
assert.ok(/\[hidden\]\{display:none!important;\}/.test(fin), "finances.html carries the global guard");
assert.ok(/<div class="wz-back" id="wzBack" hidden>/.test(fin), "the wizard still ships hidden");
assert.ok(/\.wz-back\{[^}]*position:fixed/.test(fin), "and it is still a full-page overlay");
pass++;
console.log("  ok the wizard overlay ships hidden, behind the guard");
console.log("v123 hidden-means-hidden: " + pass + " checks passed");
