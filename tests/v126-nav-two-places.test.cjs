// v126 — the top nav is two PLACES, not one row of four.
//
// RETIRED BY v162. Ash: "I no longer want the navigation accessible from the top. I now
// want a side navigation." The app bar and its stacks are gone; the STRUCTURE this file
// defended (four groups in order, the three periods together, Finances alone and not a
// fourth period, one active link per page) moved to the side rail and is guarded by
// tests/v162-side-nav.test.cjs, which drives the version that now ships.
//
// What is left here is a TOMBSTONE: it asserts the old bar really is gone from every page,
// so a future edit cannot quietly put a second navigation back at the top.
//
// The original file is in the git history at v161 if the old assertions are ever wanted.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const FILES = ["index.html", "monthly.html", "quarterly.html", "finances.html", "daily.html", "social.html", "ads.html", "schedule.html", "projects.html"];

(async () => {
  for (const f of FILES) {
    const src = read(f);
    for (const gone of ['class="topnav"', 'class="navgrp', 'class="navgroup"', 'class="navlinks"', 'class="navsep"', 'class="appbar"']) {
      assert.ok(!src.includes(gone), f + " is rid of " + gone);
    }
    const style = src.slice(src.indexOf("<style>"), src.indexOf("</style>"));
    for (const gone of [".topnav", ".navgrp", ".navsep", ".navlinks", ".appbar"]) {
      assert.ok(!style.includes(gone + "{") && !style.includes(gone + " "), f + "'s stylesheet is rid of " + gone);
    }
    assert.ok(/<aside class="sidenav"/.test(src) && /<nav class="sn-nav">/.test(src), f + " has the rail instead");
  }
  console.log("v126-nav-two-places: all assertions passed (retired — see v162-side-nav)");
})().catch((e) => { console.error(e); process.exit(1); });
