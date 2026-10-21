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
assert.ok(/@media\(hover:none\)\{ \.cal-nav\{display:none;\} \}/.test(css), "a phone swipes; it shows no arrows");
assert.ok(/prefers-reduced-motion:reduce\)\{ \.cal-track\{scroll-behavior:auto;\}/.test(css), "no glide for somebody who asked for less motion");

// it opens on today, and a redraw leaves it where you put it
const wire = js.slice(js.indexOf("function calStripWire"), js.indexOf("\n}\n", js.indexOf("function calStripWire")));
assert.ok(/track\.querySelector\("\[data-today\]"\)/.test(wire) && /today\.offsetLeft/.test(wire), "this week opens scrolled to today");
assert.ok(/if \(calStripWeek === calWeekOffset && calStripX != null\)/.test(wire), "a tick or refresh does not jump it back");
assert.ok(/calStripWire\(\);/.test(js.slice(js.indexOf("function renderCalendar"))), "every render wires it");

console.log("v231-today-beside-the-week: all assertions passed");
