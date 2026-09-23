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
const text = "build v176 · out-of-lambda-compatibility-mode";
for (const f of ["monthly.html", "index.html", "finances.html", "daily.html", "social.html"]) {
  assert.ok(read(f).includes(text), f + " carries the stamp");
}

/* ============ v221 REPLACED THE CARD THIS TEST WAS ABOUT ============
   v158 was a design pass on the Today card: habit rows with a detail line under the name, a
   segmented count, the four timer lengths in one bordered box, and the card as a flex column
   with the timer anchored to its bottom edge so the empty middle read as spacing.

   v221 collapsed that card. The questions that sat beside it moved into focus mode, and what
   is left is one compact strip: three rows, each a label and its state, for the afternoon you
   land on the page without entering a mode. There is no empty middle to anchor against any
   more, and the habits are chips rather than rows.

   So the layout claims are retired. THE FINDINGS ARE NOT — those were about what went wrong
   on screen, and they are just as true of a strip as of a card. They are re-pinned here
   against the thing that now exists. */
const today = fn("renderToday");

/* ---- 1. the finding that started v158: no tooltip over the heading ---- */
assert.ok(!/data-habit="[^"]*"[^>]*title=/.test(today), "the habit chip carries no title attribute");
assert.ok(!/title="' \+ esc\(h\.sub/.test(js) && !/title="' \+ esc\(h\.label/.test(js),
  "…and nothing else puts a habit's long text in a tooltip");
assert.ok(/NO TITLE ATTRIBUTE/.test(js), "…and why is written down, because it is easy to put back");

/* ---- 2. it is still a toggle, and a done one reads as done ---- */
assert.ok(/aria-pressed="' \+ \(habits\[h\.id\] === true \? "true" : "false"\)/.test(today),
  "each habit is still a toggle to a screen reader");
assert.ok(/\.tsum-hb\.on\{[^}]*line-through/.test(css), "a ticked habit reads as done, not just as green");
assert.ok(/all \? "All done" : ticked \+ " of " \+ CK_HABITS\.length/.test(today),
  "three of three still says All done");
const habits = js.slice(js.indexOf("const CK_HABITS"), js.indexOf("];", js.indexOf("const CK_HABITS")));
assert.strictEqual((habits.match(/sub: "/g) || []).length, 3,
  "the habits keep their detail text — it is the tooltip that was wrong, not the words");

/* ---- 3. the focus block still works the way it did ---- */
assert.ok(/#ic-headphones/.test(today) && /<symbol id="ic-headphones"/.test(html), "Dial in keeps its glyph");
assert.ok(/onclick="return ftDialIn\(this\)"/.test(today) && /rel="noopener noreferrer"/.test(today),
  "the app-then-web link is unchanged");
assert.ok(/id="ftGo' \+ m \+ '" data-min="' \+ m \+ '"/.test(today), "each length keeps its id and its minutes");
assert.ok(/t\.id\.indexOf\("ftGo"\) === 0\) ftStart\(Number\(t\.dataset\.min\)\)/.test(js),
  "…so the delegated click still starts the timer");
assert.ok(/A ' \+ ftTimer\.durationMin \+ "-minute block is "/.test(today),
  "a running block still says so here, rather than the presets pretending nothing is on");

/* ---- 4. the strip itself: three rows, each a label and its state ---- */
assert.ok(/\.tsum-row\{display:flex/.test(css), "the card is rows");
assert.ok((today.match(/class="tsum-row"/g) || []).length === 3, "three of them: the one thing, the habits, the focus block");
assert.ok(/\.tsum-k\{[^}]*flex:0 0 132px/.test(css), "…each led by a label of the same width, so they line up");
assert.ok(!/\.ft-idle-box\{margin-top:auto/.test(css), "nothing is anchored to a bottom edge any more — there is no slack to take");

console.log("v158 the-today-card: ok (layout claims retired in v221 — findings re-pinned)");
