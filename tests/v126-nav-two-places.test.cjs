// v126 — the top nav is two PLACES, not one row of four.
//
// The complaint: "Planning" sat to the LEFT of Weekly/Monthly/Quarterly and Finances sat
// to the right of them, all inside one pill — so the finance page read as a fourth period
// in the weekly→monthly→quarterly cadence, and the caption read as a label for the whole
// bar rather than for the three links after it.
//
// So each group is now a STACK: an icon + caption ABOVE its own pill of links, with a
// full-height rule between the two stacks. Planning (calendar) holds the three periods;
// Finances (wallet) holds its one link, in the brand colour, so it reads as somewhere
// else you go rather than the next step in the cadence.
//
// v135 UPDATE: a third stack joined the bar — Today, holding the Daily Dashboard, first.
// The claim this file was written to defend is unchanged and still checked: each group is
// a STACK (caption above its own pill), the three periods stay together in one pill, and
// finances stays alone rather than reading as a fourth period. Only the COUNT moved.
//
// v127 UPDATE: this file now guards the STRUCTURE only — two stacks, caption above links,
// the three periods together, finances alone. The DRESS it originally pinned (a pill track
// on .navlinks, a solid brand fill on the active finance link) was the part that did not
// look high end, and v127 replaced it; tests/v127-nav-integrated.test.cjs owns that now,
// and pins the exact build stamp with it.
//
// Structure, not behaviour: .topnav keeps its name and its links, and no store key, save
// path or handler is involved — so this test reads the markup and the stylesheet rather
// than booting the app.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const FILES = ["index.html", "monthly.html", "quarterly.html", "finances.html", "daily.html"];
const SRC = {};
FILES.forEach((f) => { SRC[f] = read(f); });
const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));

(async () => {
  /* ================= 0. the stamp ================= */
  // relaxed once v127 shipped: the newest test pins the exact stamp, this one only checks
  // the build never goes backwards and that the pages agree.
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(SRC["monthly.html"]);
  assert.ok(stamp && Number(stamp[1]) >= 126, "monthly.html stamped v126 or later");
  const text = "build v" + stamp[1] + " · " + stamp[2];
  assert.ok(SRC["monthly.html"].includes('<span class="mp-stage">' + text + "</span>"), "…and shows it on screen");
  assert.ok(SRC["index.html"].includes(text), "index.html carries the same stamp");
  assert.ok(SRC["finances.html"].includes("<!-- " + text + " -->"), "finances.html carries the same stamp");

  /* ================= 1. the nav is two stacks, in order ================= */
  for (const f of FILES) {
    const label = f + ": ";
    const nav = /<nav class="topnav">([\s\S]*?)<\/nav>/.exec(SRC[f]);
    assert.ok(nav, label + "has a .topnav");
    const inner = nav[1];

    // three groups: Today, Planning, then the money one — each fenced from the next
    const grpOpen = [...inner.matchAll(/<div class="navgrp([^"]*)">/g)].map((m) => m[1].trim());
    assert.deepStrictEqual(grpOpen, ["", "", "navgrp-money"],
      label + "three stacks: today, planning, then the money one");
    assert.strictEqual((inner.match(/<span class="navsep"><\/span>/g) || []).length, 2,
      label + "a rule between each pair of stacks");
    assert.ok(inner.indexOf('<span class="navsep">') > inner.indexOf('<div class="navgrp">'),
      label + "…and the first sits after the first stack, not before it");
    assert.ok(inner.lastIndexOf('<span class="navsep">') < inner.indexOf('navgrp-money'),
      label + "…and the last one is on the planning side of Finances");

    // each caption leads with a sprite icon, and SITS ABOVE its own pill of links
    const caps = [...inner.matchAll(/<span class="navgroup"><svg class="ic"><use href="#(ic-[a-z-]+)"\/><\/svg>([^<]+)<\/span>/g)];
    assert.deepStrictEqual(caps.map((m) => [m[1], m[2].trim()]),
      [["ic-sun", "Today"], ["ic-calendar", "Planning"], ["ic-wallet", "Finances"]],
      label + "an icon + caption for each group");

    const pills = [...inner.matchAll(/<div class="navlinks">([\s\S]*?)<\/div>/g)];
    assert.strictEqual(pills.length, 3, label + "each group has its own pill of links");
    // caption above pill, for every group
    for (let i = 0; i < 3; i++) {
      assert.ok(inner.indexOf(caps[i][0]) < inner.indexOf(pills[i][0]),
        label + "group " + (i + 1) + "'s caption is written above its links");
    }

    // the three periods are in the FIRST pill; finances is alone in the second
    const hrefs = (block) => [...block.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepStrictEqual(hrefs(pills[0][1]), ["/daily.html"],
      label + "today is on its own, ahead of the cadence");
    assert.deepStrictEqual(hrefs(pills[1][1]), ["/index.html", "/monthly.html", "/quarterly.html"],
      label + "the cadence lives in the Planning pill");
    assert.deepStrictEqual(hrefs(pills[2][1]), ["/finances.html"],
      label + "…and finances is on its own, not a fourth period");

    // the page's own link is active, and it is the only one
    const active = [...inner.matchAll(/<a href="([^"]+)" class="active">/g)].map((m) => m[1]);
    assert.deepStrictEqual(active, ["/" + f], label + "marks its own link active, once");

    // the nav still lives inside the app bar
    assert.ok(SRC[f].indexOf('class="appbar"') < SRC[f].indexOf('<nav class="topnav">'),
      label + "the nav is still inside the app bar");
  }

  /* ================= 2. the wallet joined the sprite, everywhere ================= */
  for (const f of FILES) {
    const label = f + ": ";
    const sprite = /<svg width="0" height="0"[\s\S]*?<\/defs><\/svg>/.exec(SRC[f]);
    assert.ok(sprite, label + "carries the sprite");
    const sym = /<symbol id="ic-wallet"[^>]*>/.exec(sprite[0]);
    assert.ok(sym, label + "the sprite defines #ic-wallet");
    assert.ok(/viewBox="0 0 24 24"/.test(sym[0]), label + "…on the shared 24px grid");
    assert.ok(/currentColor/.test(sym[0]), label + "…drawn in currentColor, so it takes the brand");
    // and every icon the nav asks for resolves
    const defined = new Set([...sprite[0].matchAll(/<symbol id="(ic-[a-z-]+)"/g)].map((m) => m[1]));
    for (const id of ["ic-sun", "ic-calendar", "ic-wallet"]) assert.ok(defined.has(id), label + "#" + id + " resolves");
  }

  /* ================= 3. the stylesheet says the same thing ================= */
  for (const f of FILES) {
    const style = styleOf(SRC[f]), label = f + ": ";

    // a stack is a column, so the caption can sit above the links
    assert.ok(/\.navgrp\{[^}]*flex-direction:column/.test(style), label + ".navgrp stacks caption over links");
    // there is a rule between the two stacks, and it is a hairline drawn from the token
    assert.ok(/\.navsep\{[^}]*background:var\(--line\)/.test(style), label + "the rule is a hairline");

    // Finances is dressed differently — that is the whole point of the release
    assert.ok(/\.navgrp-money \.navgroup\{[^}]*color:var\(--orange\)/.test(style),
      label + "the Finances caption carries the brand");

    // the icon in a caption is sized off the caption's own text
    assert.ok(/\.navgroup \.ic\{[^}]*width:1\.3em/.test(style), label + "the caption icon scales with its text");

    // narrow screens: the rule goes, and each stack takes the full width
    const mq = style.slice(style.indexOf("@media(max-width:720px){", style.indexOf(".navlinks{")));
    assert.ok(/\.navsep\{display:none;\}/.test(mq), label + "the rule is dropped when the stacks wrap");
    assert.ok(/\.navgrp\{flex:1 1 100%;\}/.test(mq), label + "…and each stack takes the row");
  }

  console.log("v126-nav-two-places.test: all assertions passed");
})();
