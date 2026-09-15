// v159 — the week card, from a design point of view.
//
// Ash, with a screenshot: "Time to look at the design of this now. Surely you can't be
// proud of your work here? If you were an employed UI/UX designer you'd be sacked."
//
// What the screenshot showed, honestly: today drawn TWICE (the Today panel and a MON 14
// column carrying the identical four items); tick boxes jammed against their text because
// .cal-task was declared twice and the later display:block won; names cut mid-word on one
// line ("Plan next week'…"); a left bar AND a tint AND a box on every chip; a "This week"
// label between the arrows on a card already titled This week; two New event buttons; and
// WEEKLY PLAN shouted in teal on every row of the panel.
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
const count = (re, s) => (s.match(re) || []).length;

/* ================= 0. the stamp ================= */
const text = "build v170 · scheduling";
for (const f of ["monthly.html", "index.html", "finances.html", "daily.html", "social.html"]) {
  assert.ok(read(f).includes(text), f + " carries the stamp");
}

/* ============ 1. today is drawn once ============ */
const render = fn("renderCalendar");
assert.ok(/if \(calWeekOffset === 0 && ymd\(d\) === todayKey\) continue;/.test(render),
  "on this week, today's column is skipped — the panel is today");
assert.ok(/'<div class="cal-week' \+ \(calWeekOffset === 0 \? " rest" : ""\) \+ '">'/.test(render),
  "…and the strip says it holds the rest of the week");
assert.ok(/\.cal-week\.rest\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\);\}/.test(css), "six columns, not seven, beside the panel");
assert.ok(/calWeekOffset === 0\s*\?\s*'<div class="cal-split">' \+ calTodayHtml/.test(render), "on another week it is seven, and no panel");

/* ============ 2. one rule for the task chip, and it is a row with a gap ============ */
assert.strictEqual(count(/\n  \.cal-task\{/g, css), 1, ".cal-task is declared exactly once");
assert.ok(/\.cal-task\{display:flex;align-items:flex-start;gap:7px;/.test(css), "…as a flex row with a gap between box and name");
assert.strictEqual(count(/\n  \.cal-evt\{/g, css), 1, ".cal-evt is declared exactly once too");
assert.ok(/\.cal-tname\{display:-webkit-box;-webkit-line-clamp:2;/.test(css), "a task's name wraps to two lines");
assert.ok(/\.cal-evn\{display:-webkit-box;-webkit-line-clamp:2;/.test(css), "…and so does an event's");
const day = fn("calDayHtml");
assert.ok(!/class="cal-task' \+ \(t\.done \? " done" : ""\) \+ '" title=/.test(day), "no tooltip on the chip");
assert.ok(/<span class="cal-tb"><span class="cal-tname">' \+ esc\(t\.title\) \+ "<\/span>" \+\s*'<span class="cal-tband">' \+ esc\(t\.bandLabel\)/.test(day),
  "the band is written under the name instead");

/* ============ 3. one signifier each ============ */
assert.ok(!/\.cal-ev\{[^}]*border-left/.test(css), "a booked event has no left bar — it is a tile");
assert.ok(!/\.cal-task\{[^}]*border-left/.test(css) && !/\.cal-task\{[^}]*background:rgba\(var\(--teal-rgb\)/.test(css),
  "a planned task has no bar and no tint — it is a row with a box");
assert.ok(/\.cal-ev\.now\{[^}]*box-shadow:inset 2\.5px 0 0 var\(--orange\)/.test(css), "only what is on NOW gets a bar");
assert.ok(/\.ct-src-plan\{color:var\(--ink-faint\);\}/.test(css) && /\.ct-src\{[^}]*font-size:10px;font-weight:600/.test(css),
  "the source tag in the panel is a whisper, not a teal heading");

/* ============ 4. the header ============ */
assert.ok(/<span id="calTitle">This week<\/span>/.test(html), "the card's title is live");
assert.ok(/calWeekOffset === 0 \? "This week" : calWeekOffset === 1 \? "Next week"\s*: calWeekOffset === -1 \? "Last week" : "Week of "/.test(render),
  "…and names the week you are looking at");
assert.ok(/' <span class="mo">' \+ esc\(rangeLabel\) \+ "<\/span>"/.test(render), "with its dates beside it");
assert.ok(!/cal-rng/.test(js) && !/\.cal-rng/.test(css), "the label between the arrows is gone, rule and all");
assert.ok(/<span class="cal-nav">'\s*\+\s*'<button type="button" class="cal-nav-b" id="calPrev"/.test(render) &&
  /class="cal-nav-b" id="calNextWk"/.test(render), "the two arrows are one control");
assert.ok(/id="calToday">Back to today/.test(render), "away from this week, the way back says where it goes");
assert.strictEqual(count(/New event<\/button>/g, js.slice(js.indexOf("function calTodayHtml"), js.indexOf("function renderCalendar"))), 0,
  "the panel has no New event button of its own");
assert.ok(/class="cal-dadd" id="calNewToday" aria-label="New event today"/.test(fn("calTodayHtml")),
  "…it has the same quiet + every other day has");
assert.ok(/\.cal-today:hover \.cal-dadd/.test(css), "which shows on hover, like theirs");
assert.ok(!/ct-foot/.test(js) && !/\.ct-foot/.test(css), "the panel footer is gone, rule and all");

console.log("v159 the-week-card: ok");
