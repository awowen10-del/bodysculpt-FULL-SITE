// v158 — the Today card, from a design point of view.
//
// Ash, with a screenshot: "From a design, UI/UX point of view — surely you can do better
// here?" What the screenshot showed: a browser tooltip (the habit's long label) sat on top
// of the DAILY NON-NEGOTIABLES heading; four loose grey tiles for the timer with a stray
// teal pill underneath; and a card two-thirds empty because it stretches to match the
// questions beside it.
//
// What changed, and what this pins: the habit's detail is a line under its name (no title
// attribute, nothing for the browser to float); the count has three segments beside it; the
// playlist link sits on the heading row of the focus block; the four lengths are one
// segmented control; and the card is a flex column with the focus block anchored to its
// bottom edge, so the empty middle reads as spacing rather than a void.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const html = read("daily.html");
const js = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
const fn = (name) => {
  const i = js.indexOf("function " + name + "(");
  assert.ok(i >= 0, "function " + name + " exists");
  return js.slice(i, js.indexOf("\n}\n", i) + 3);
};

/* ================= 0. the stamp ================= */
const text = "build v172 · competitor-views";
for (const f of ["monthly.html", "index.html", "finances.html", "daily.html", "social.html"]) {
  assert.ok(read(f).includes(text), f + " carries the stamp");
}

/* ============ 1. the habit rows: detail under the name, no tooltip ============ */
const today = fn("renderToday");
assert.ok(!/data-habit="' \+ esc\(h\.id\) \+\s*'" title=/.test(today), "the habit button carries no title attribute");
assert.ok(!/title="' \+ esc\(h\.label\)/.test(js), "…and nothing else puts the label in a tooltip");
assert.ok(/class="nn-txt"><span class="nn-s">' \+ esc\(h\.short\)/.test(today), "the name is the row's first line");
assert.ok(/h\.sub \? '<span class="nn-sub">' \+ esc\(h\.sub\)/.test(today), "the detail is the second line, when there is one");
const habits = js.slice(js.indexOf("const CK_HABITS"), js.indexOf("];", js.indexOf("const CK_HABITS")));
assert.strictEqual((habits.match(/sub: "/g) || []).length, 3, "all three habits have a sub line");
assert.ok(/aria-pressed="' \+ \(on \? "true" : "false"\)/.test(today), "the row is still a toggle to a screen reader");
assert.ok(/\.nn\.on \.nn-s\{[^}]*line-through/.test(css), "a done row reads as done");

/* ============ 2. the count is three segments and a number ============ */
assert.ok(/CK_HABITS\.map\(\(_, i\) => '<span class="nn-seg' \+ \(i < ticked \? " on" : ""\)/.test(today),
  "one segment per habit, filled left to right");
assert.ok(/all \? "All done" : ticked \+ " of " \+ CK_HABITS\.length/.test(today), "three of three says so");
assert.ok(!/nn-count/.test(js) && !/\.nn-count/.test(css), "the floated count is gone, rule and all");

/* ============ 3. the focus block: one heading row, one control ============ */
assert.ok(/<div class="ft-head"><div class="one-k">Focus block<\/div>' \+\s*'<a class="ft-dial"/.test(today),
  "Dial in sits on the heading row, right of the title");
assert.ok(/#ic-headphones/.test(today) && /<symbol id="ic-headphones"/.test(html), "…with a headphones glyph, not a dot");
assert.ok(/onclick="return ftDialIn\(this\)"/.test(today) && /rel="noopener noreferrer"/.test(today), "the app-then-web link is unchanged");
assert.ok(/'<button type="button" class="ft-preset" id="ftGo' \+ m \+ '" data-min="' \+ m \+ '">' \+ m \+ "<small>min<\/small><\/button>"/.test(today),
  "each length is a number over a small unit");
assert.ok(/\.ft-presets\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\);border:1px solid var\(--line\)/.test(css),
  "the four lengths share one bordered box");
assert.ok(/\.ft-preset\{[^}]*border:0;border-left:1px solid var\(--line\)/.test(css) && /\.ft-preset:first-child\{border-left:0;\}/.test(css),
  "…divided by hairlines, not four separate tiles");
assert.ok(/t\.id\.indexOf\("ftGo"\) === 0\) ftStart\(Number\(t\.dataset\.min\)\)/.test(js), "the delegated click still starts the timer");

/* ============ 4. the card anchors the timer to its bottom edge ============ */
assert.ok(/\.today-card\{[^}]*display:flex;flex-direction:column;\}/.test(css), "the card is a column");
assert.ok(/#todayBody\{display:flex;flex-direction:column;flex:1;min-height:0;\}/.test(css), "…and its body fills it");
assert.ok(/\.ft-idle-box\{margin-top:auto;/.test(css), "the idle focus block takes the slack above it");
assert.ok(/\.nn-box\{padding-bottom:var\(--sp-4\);\}/.test(css), "…but never closes right up to the checklist");

console.log("v158 the-today-card: ok");
