// v310 — the 1-day view: a readable width, empty slots small. (v310.1: done is never folded away.)
// Finished jobs and blocks take one line, not their hours, in every view.
//
// Ash, of the 1-day view: "are you happy with how this calendar looks?" — the finished work
// was the biggest thing on the page and the slots held their hours empty.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
function fn(name) {
  const m = new RegExp("\\n(?:async )?function " + name + "\\s*\\(").exec(HTML);
  assert.ok(m, "defines " + name + "()");
  let i = HTML.indexOf("{", m.index + m[0].length - 1), depth = 0, j = i;
  for (; j < HTML.length; j++) {
    if (HTML[j] === "{") depth++;
    else if (HTML[j] === "}") { depth--; if (!depth) break; }
  }
  return HTML.slice(m.index, j + 1);
}
const items = {
  "buffer:a": { id: "a", title: "Open job", done: false },
  "buffer:b": { id: "b", title: "Done job", done: true },
};
const env = new Function("items", `
  const wpResolveRef = (r) => items[r] || null;
  const wpRefDoneOn = (r) => !!(items[r] && items[r].done);
  const wpLenOf = () => 5, wpSpanMax = () => 6, wpBlockLenKey = () => "k";
  const wpShownLen = () => 5;
  ${fn("wpUnitDone")} ${fn("wpUnitsLen")}
  return { wpUnitDone, wpUnitsLen };`)(items);

const block = (flags) => ({ kind: "block", pid: "p", steps: flags.map((d) => ({ it: { done: d } })) });
assert.strictEqual(env.wpUnitDone(block([true, true]), "wed"), true, "a block with every step ticked is done");
assert.strictEqual(env.wpUnitDone(block([true, false]), "wed"), false, "one step left: not done");
assert.strictEqual(env.wpUnitDone(block([]), "wed"), false, "an empty block is not done");
assert.strictEqual(env.wpUnitsLen([{ kind: "ref", ref: "buffer:a" }], "10-12:wed"), 5, "an open job keeps its hours");
assert.strictEqual(env.wpUnitsLen([{ kind: "ref", ref: "buffer:b" }], "10-12:wed"), 1, "a finished job takes one line");
assert.strictEqual(env.wpUnitsLen([block([true, true])], "10-12:wed"), 1, "a finished block takes one line");
assert.strictEqual(env.wpUnitsLen([block([false, true])], "10-12:wed"), 5, "an unfinished block keeps its hours");

// the grid: the fold, the shrink, the warning by the time
const R = fn("renderWeeklyPlan");
// v310.1: Ash: "I like to see what I've achieved in a day" — done is never folded away
assert.ok(!/donefold/i.test(HTML), "no Done fold: finished jobs stay where they are, ticked");
assert.ok(/const chips = units\.map\(unitHtml\)\.join\(""\);/.test(R), "every job in a slot is drawn, done or not");
assert.ok(/emptySlot = wpDayCount === 1 && !units\.length/.test(R), "only a truly empty slot shrinks in the 1-day view");
assert.ok(/rowWarn\[rk\]/.test(R) && /wp-rowwarn/.test(R), "\"2 projects\" sits by the slot's time in the 1-day view");
assert.ok(/!wpUnitDone\(u, dk\)\)\.length/.test(R), "a finished project is not counted as a second project");
assert.ok(!/table\.wp-grid\.wp-cols-1\{max-width/.test(HTML), "the 1-day view fills the box, all the way to the right");
assert.ok(/\.wp-pb-row input:checked,\.wp-pb-tick\{background:var\(--green\)/.test(HTML), "done is green everywhere");
assert.ok(/\.wp-chip-grip\{width:12px;/.test(HTML), "the grip is as wide as a block's arrow, so ticks line up");

console.log("v310 day view: ok");
