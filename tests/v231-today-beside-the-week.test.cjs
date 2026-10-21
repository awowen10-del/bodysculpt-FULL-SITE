// v231 — Today and This week on one row, above Team Slack; the week scrolls sideways.
//
// Ash: "move 'this week' above 'team slack'… have 'today' and 'this week' on the same row
// but have the 'this week' scrollable (in a lovely way, aesthetic way) so I can easily scroll
// to later in the week if needed."
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const DAILY = fs.readFileSync(path.join(__dirname, "..", "daily.html"), "utf8");
const css = DAILY.slice(DAILY.indexOf("<style>") + 7, DAILY.indexOf("</style>"));
const js = DAILY.slice(DAILY.lastIndexOf("<script>") + 8, DAILY.lastIndexOf("</script>"));

// one row: the Today list, then the week — and Slack after it
const row = DAILY.slice(DAILY.indexOf('<div class="day-row">'));
assert.ok(row.indexOf('id="tlCard"') > 0 && row.indexOf('id="tlCard"') < row.indexOf('id="calCard"'),
  "Today and This week share one row, Today first");
assert.ok(DAILY.indexOf('id="calCard"') < DAILY.indexOf('id="slCard"'), "the week sits above Team Slack");
assert.ok(/\.day-row\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1\.35fr\)/.test(css), "side by side on a wide screen");
assert.ok(/@media\(max-width:1180px\)\{ \.day-row\{grid-template-columns:minmax\(0,1fr\);\} \}/.test(css), "…stacked when there is no room");

// the strip: scrolls, snaps, fades only where there is more, arrows only for a mouse
assert.ok(/scroll-snap-type:x mandatory/.test(css) && /\.cal-slide\{[^}]*scroll-snap-align:start/.test(css), "it snaps to a day");
assert.ok(/mask-image:linear-gradient/.test(css) && /\.cal-strip\.can-right\{--fr:44px;\}/.test(css), "the edge fades only on a side with more to see");
assert.ok(/@media\(hover:none\)\{ \.cal-snav\{display:none;\} \}/.test(css), "a phone swipes; it shows no arrows");

/* v232: Ash — "fix the alignment on both tables… make sure they're the same", "always make sure
   'today' is visible", "always make sure 'money needing attention' is aligned with 'needs a reply'" */
// the strip's arrows have their own class: .cal-nav is the header's week arrows, and v231 hid them
assert.ok(/<span class="cal-nav">/.test(js) && /\.cal-nav\{display:inline-flex;/.test(css), "the header keeps its week-before / week-after arrows");
assert.ok(!/\.cal-nav\{position:absolute/.test(css) && /class="cal-snav prev"/.test(js), "…the strip's own arrows never restyle them");
// today: pinned, never faded, never covered, and days snap beside it rather than under it
assert.ok(/\.cal-slide\.is-today\{position:sticky;left:0;z-index:2;background:var\(--card\)/.test(css), "Today is pinned to the strip's left edge, solid behind");
assert.ok(!/\.cal-strip\.can-left\{--fl:/.test(css), "…the left edge is never faded");
assert.ok(/\.cal-strip\.has-today \.cal-snav\.prev\{left:calc\(276px - 12px\);\}/.test(css), "…‹ sits on the seam beside it, not on it");
assert.ok(/\.cal-strip\.has-today \.cal-track\{scroll-padding-left:calc\(276px \+ var\(--sp-2\)\);\}/.test(css), "…and a day snaps to that seam, not under Today");
// both pairs of cards are the same height
assert.ok(/\.day-row\{[^}]*align-items:stretch;/.test(css), "Today and This week are the same height");
assert.ok(/\.day-grid\{[^}]*align-items:stretch;\}/.test(css) && /\.day-main > \.card,\.day-rail > \.card:last-child\{flex:1 1 auto;\}/.test(css),
  "Needs a reply and Money needing attention are the same height");
assert.ok(/prefers-reduced-motion:reduce\)\{ \.cal-track\{scroll-behavior:auto;\}/.test(css), "no glide for somebody who asked for less motion");

// it opens on today, and a redraw leaves it where you put it
const wire = js.slice(js.indexOf("function calStripWire"), js.indexOf("\n}\n", js.indexOf("function calStripWire")));
assert.ok(/const todayEl = track\.querySelector\("\[data-today\]"\)/.test(wire) && /todayEl\.offsetLeft - 2/.test(wire), "this week opens scrolled to today");
assert.ok(/if \(calStripWeek === calWeekOffset && calStripX != null\)/.test(wire), "a tick or refresh does not jump it back");
assert.ok(/calStripWire\(\);/.test(js.slice(js.indexOf("function renderCalendar"))), "every render wires it");

console.log("v231-today-beside-the-week: all assertions passed");
