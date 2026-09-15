// v127 — the nav stopped being furniture.
//
// RETIRED BY v162. This file pinned the DRESS of the top app bar: no capsule track, only
// the current link takes a soft chip, Finances carries the brand as colour and never as a
// saturated fill, the month picker on the section row, a hairline under the bar. v162
// removed the bar altogether (Ash: "I no longer want the navigation accessible from the
// top. I now want a side navigation"). The rules that were about TASTE rather than about
// the bar travelled with the links into the side rail, and tests/v162-side-nav.test.cjs
// pins them there: plain text at rest, a soft chip on the current link only, Finances
// tinted, never filled.
//
// What is left here is a TOMBSTONE for the two things v127 removed for good, so neither
// can come back under a new name: a solid brand fill on a place you merely go to, and a
// capsule track around a row of links.
//
// The original file is in the git history at v161 if the old assertions are ever wanted.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const FILES = ["index.html", "monthly.html", "quarterly.html", "finances.html", "daily.html", "social.html", "ads.html"];
const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));

(async () => {
  for (const f of FILES) {
    const style = styleOf(read(f)), label = f + ": ";
    // the nav block, wherever it lives now
    const nav = style.slice(style.indexOf("  .sidenav{"), style.indexOf("  .mobilebar{"));
    assert.ok(nav.length > 0, label + "the rail's stylesheet block is there");
    assert.ok(!/background:var\(--orange\)/.test(nav), label + "no nav link is a solid brand fill");
    assert.ok(!/\.sn-group\{[^}]*border-radius:var\(--r-pill\)/.test(nav) && !/\.sn-nav\{[^}]*border/.test(nav),
      label + "no capsule track around the links");
    assert.ok(!/\.appbar-right\{/.test(style), label + "the app bar's right-hand slot never came back");
  }
  console.log("v127-nav-integrated: all assertions passed (retired — see v162-side-nav)");
})().catch((e) => { console.error(e); process.exit(1); });
