// v127 — the nav stopped being furniture.
//
// v126 put the right STRUCTURE in the app bar (Planning above its three periods, Finances
// fenced off) and dressed it badly. Ash, looking at the finance page: "I don't think it
// does [look high end]. It just sits there, painfully — doesn't look integrated with the
// page at all." He was right, and the faults were nameable:
//
//   · THREE SHAPES for one job — a grey capsule track, a solid terracotta capsule, and
//     underline tabs on the row below. Chrome that reads as expensive picks one language.
//   · A SATURATED FILL ON A DESTINATION. The loudest thing on the page was a nav item.
//     The accent belongs to actions; where you are is stated quietly.
//   · NOTHING ALIGNED — brand hard left, nav floating centre, month picker hard right:
//     three loose objects rather than one row.
//   · THE TRACK WAS REDUNDANT: it existed to contain an active state that already
//     announces itself.
//
// So: no capsule track (only the current link takes a soft chip), the nav sits directly
// after the brand, Finances is pushed to the far edge behind a rule, the month picker
// moves DOWN to the section row where it belongs (it steers the page's content, not which
// page you are on), and a hairline under the app bar makes the header two registers of one
// block. Finances keeps its prominence through position and colour, not a fill.
//
// Dress and layout only — no store key, save path or handler is touched, so this reads the
// markup and the stylesheet rather than booting the app.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const FILES = ["index.html", "monthly.html", "quarterly.html", "finances.html"];
const SRC = {};
FILES.forEach((f) => { SRC[f] = read(f); });
const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));
const ruleOf = (style, sel) => {
  const m = new RegExp("\\n  " + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{[^}]*\\}").exec(style);
  return m ? m[0] : null;
};

(async () => {
  /* ================= 0. the stamp ================= */
  // relaxed once v128 shipped: the newest test pins the exact stamp, this one only checks
  // the build never goes backwards and that every page agrees on it.
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(SRC["monthly.html"]);
  assert.ok(stamp && Number(stamp[1]) >= 127, "monthly.html stamped v127 or later");
  const text = "build v" + stamp[1] + " · " + stamp[2];
  assert.ok(SRC["monthly.html"].includes('<span class="mp-stage">' + text + "</span>"), "…and shows it on screen");
  assert.ok(SRC["index.html"].includes(text), "index.html carries the same stamp");
  assert.ok(SRC["finances.html"].includes("<!-- " + text + " -->"), "finances.html carries the same stamp");

  /* ================= 1. one language: no capsule track anywhere ================= */
  for (const f of FILES) {
    const style = styleOf(SRC[f]), label = f + ": ";

    const links = ruleOf(style, ".navlinks");
    assert.ok(links, label + ".navlinks is still the row of links");
    assert.ok(!/background/.test(links), label + "the capsule TRACK is gone — no fill behind the links");
    assert.ok(!/border/.test(links), label + "…and no ring around them either");

    const a = ruleOf(style, ".topnav a");
    assert.ok(/border-radius:var\(--r-md\)/.test(a), label + "a link is a soft chip, not a pill");
    assert.ok(/color:var\(--ink-dim\)/.test(a), label + "…resting as quiet text");

    const act = ruleOf(style, ".topnav a.active");
    assert.ok(/background:var\(--navy-2\)/.test(act), label + "only the link you are on is filled");
    assert.ok(!/box-shadow/.test(act), label + "…flat: no floating white card inside the bar");
    assert.ok(/color:var\(--ink-strong\)/.test(act), label + "…and it is the darkest text in the group");
  }

  /* ============ 2. Finances is prominent by POSITION and COLOUR, never a fill ============ */
  for (const f of FILES) {
    const style = styleOf(SRC[f]), label = f + ": ";

    // the rule takes up the slack, so it and the money group travel to the far edge together
    const sep = ruleOf(style, ".navsep");
    assert.ok(/margin-left:auto/.test(sep), label + "the rule takes the slack — Finances sits at the far edge");
    assert.ok(/background:var\(--line\)/.test(sep), label + "…and is a hairline, not a bar");
    assert.ok(/\.topnav\{[^}]*flex:1 1 auto/.test(style), label + "the nav spans the bar, so 'far edge' means the edge");

    const money = ruleOf(style, ".navgrp-money a");
    assert.ok(/color:var\(--orange\)/.test(money), label + "the finance link carries the brand as colour");
    const moneyAct = ruleOf(style, ".navgrp-money a.active");
    assert.ok(/background:rgba\(var\(--orange-rgb\)/.test(moneyAct), label + "…and a TINTED chip when you are on it");
    assert.ok(!/background:var\(--orange\)/.test(moneyAct), label + "…never a saturated brand fill on a destination");
    assert.ok(!/var\(--on-accent\)/.test(moneyAct), label + "…so it needs no reversed-out text");
    // nothing in the chrome may outshout the page: no solid --orange fill anywhere in the nav
    const navCss = style.slice(style.indexOf("  .topnav{"), style.indexOf("  .viewtoggle{"));
    assert.ok(!/background:var\(--orange\)/.test(navCss), label + "no solid brand fill left in the nav at all");
  }

  /* ================= 3. it lines up: one row, one gutter ================= */
  for (const f of FILES) {
    const style = styleOf(SRC[f]), label = f + ": ";
    const nav = ruleOf(style, ".topnav");
    assert.ok(/margin:0/.test(nav), label + "the nav no longer floats centred");
    assert.ok(/align-items:center/.test(nav), label + "…it sits on the brand's line");
    // the caption's left edge lines up with its first link's TEXT, not its padding box
    const cap = ruleOf(style, ".navgroup");
    const capPad = /padding-left:(\d+)px/.exec(cap);
    const linkPad = /padding:\d+px (\d+)px/.exec(ruleOf(style, ".topnav a"));
    assert.ok(capPad && linkPad, label + "both the caption and the link declare their inset");
    assert.strictEqual(capPad[1], linkPad[1], label + "…and the caption is inset to match the link's text");
  }

  /* ============ 4. two registers of one header, and the picker moved down ============ */
  for (const f of FILES) {
    const style = styleOf(SRC[f]), label = f + ": ";
    const bar = ruleOf(style, ".appbar");
    assert.ok(!/border-bottom:0/.test(bar), label + "the app bar closes with a hairline, not an open edge");
    assert.ok(/padding:var\(--sp-3\) var\(--sp-4\)/.test(bar), label + "…on the shared gutter");
    assert.ok(!/\.appbar-right\{/.test(style), label + "the app bar's right-hand slot is gone");
    assert.ok(!/class="appbar-right"/.test(SRC[f]), label + "…and nothing still uses it");
  }
  // the month picker belongs with the content it steers, so it now sits in the section row
  for (const f of ["monthly.html", "finances.html"]) {
    const src = SRC[f], label = f + ": ";
    const row = /<div class="viewtoggle" id="tabBar">([\s\S]*?)\n  <\/div>/.exec(src);
    assert.ok(row, label + "has a section row");
    assert.ok(/<div class="vt-right"><div class="monthpick">/.test(row[1]),
      label + "the month picker rides in the section row now");
    assert.ok(row[1].indexOf('class="vt-right"') > row[1].lastIndexOf("</button>"),
      label + "…after the tabs, at the right-hand end");
    assert.ok(/\.vt-right\{[^}]*margin-left:auto/.test(styleOf(src)), label + "…pushed to that end, not floated");
    // it is still the same control, wired the same way
    assert.strictEqual((src.match(/id="monthSel"/g) || []).length, 1, label + "there is exactly one month picker");
    // both pages still reach it by id, so moving it in the DOM changed nothing for the JS
    assert.ok(/getElementById\("monthSel"\)|\$\("monthSel"\)/.test(src),
      label + "…and it is still the one the page listens to, reached by id");
  }
  // the tab handler must not mistake the picker for a tab
  assert.ok(/const b = e\.target\.closest\("\.vt"\); if\(!b\) return;/.test(SRC["monthly.html"]),
    "monthly's tab handler ignores anything that is not a tab");

  /* ================= 5. the narrow screen still works ================= */
  for (const f of FILES) {
    const style = styleOf(SRC[f]), label = f + ": ";
    const mq = style.slice(style.indexOf("@media(max-width:720px){", style.indexOf("  .topnav{")));
    assert.ok(/\.navsep\{display:none;\}/.test(mq), label + "the rule goes when the stacks wrap");
    assert.ok(/\.navsep \+ \.navgrp\{margin-left:0;\}/.test(mq), label + "…and takes its offset with it");
    assert.ok(/\.navgrp\{flex:1 1 100%;\}/.test(mq), label + "each stack takes the row");
    assert.ok(/\.vt-right\{padding-left:0;\}/.test(mq), label + "the picker drops its gutter inset");
  }

  console.log("v127-nav-integrated.test: all assertions passed");
})();
