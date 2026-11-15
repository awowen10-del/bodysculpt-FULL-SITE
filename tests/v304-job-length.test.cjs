// v304 — a job takes up room in its time block.
//
// Ash: "if a job is going to take me 2 hours, I need to be able to pull it in 30 min
// increments so it covers like 3/4 of that block."
//
// Runs the page's real functions with stand-ins for the network and the screen.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const STORE = fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "kpi-store.js"), "utf8");
function fn(name) {
  const m = new RegExp("\\n(?:async )?function " + name + "\\s*\\(").exec(HTML);
  assert.ok(m, "the page defines " + name + "()");
  let i = HTML.indexOf("{", m.index + m[0].length - 1), depth = 0, j = i;
  for (; j < HTML.length; j++) {
    if (HTML[j] === "{") depth++;
    else if (HTML[j] === "}") { depth--; if (!depth) break; }
  }
  return HTML.slice(m.index, j + 1);
}
const bands = HTML.match(/const WPCAL_BANDS = \[[\s\S]*?\];/)[0];
const src = `${bands}
  const WP_HALF_PX = 26, WP_LEN_MAX = 12;
  let wpPlan = { lengths: {} };
  ${fn("wpValidRef")} ${fn("wpBlockLenKey")} ${fn("wpValidLenKey")} ${fn("wpBlockHalves")} ${fn("wpLengthsMap")} ${fn("wpCleanLengths")}
  ${fn("wpLenOf")} ${fn("wpFmtHalves")} ${fn("wpNextBand")} ${fn("wpSpanMax")} ${fn("wpShownLen")} ${fn("wpSetLen")}
  return { get plan(){ return wpPlan; }, wpSpanMax, wpBlockHalves, wpCleanLengths, wpLenOf, wpFmtHalves, wpShownLen, wpSetLen };`;
const env = new Function(src)();

// each block knows its size in half hours, from the same hours the calendar uses
assert.strictEqual(env.wpBlockHalves("6-9"), 6, "6–9 is three hours");
assert.strictEqual(env.wpBlockHalves("10-12"), 5, "9–11.30 is two and a half");
assert.strictEqual(env.wpBlockHalves("notes"), 0, "Notes has no hours");
assert.strictEqual(env.wpBlockHalves("any"), 0, "Anytime has no hours");

// a job is 30 minutes until it is pulled longer, and 30 minutes is never stored
assert.strictEqual(env.wpLenOf("buffer:b1"), 1);
assert.ok(env.wpSetLen("buffer:b1", 4), "pulled to 2 hours");
assert.strictEqual(env.plan.lengths["buffer:b1"], 4);
assert.ok(!env.wpSetLen("buffer:b1", 4), "the same length again writes nothing");
assert.ok(env.wpSetLen("buffer:b1", 1), "back to 30 minutes");
assert.ok(!("buffer:b1" in env.plan.lengths), "…and the default is not kept");
assert.ok(!env.wpSetLen("nonsense", 3), "only real jobs have a length");

// v306: a job can run on into the next block — 6am coaching pulled to 11am is 10 half hours
assert.strictEqual(env.wpSpanMax("6-9"), 11, "6–9 can run on to 11.30");
assert.strictEqual(env.wpSpanMax("10-12"), 12, "9–11.30 can run on through 12–3, capped at six hours");
assert.strictEqual(env.wpSpanMax("5-8"), 6, "5–8 is the last block of the day");
env.wpSetLen("project:p1", 10);
assert.strictEqual(env.wpShownLen("project:p1", "6-9"), 10, "6am to 11am");
assert.strictEqual(env.wpShownLen("project:p1", "5-8"), 6, "…but never past the end of the day");

// the words
assert.deepStrictEqual([1, 2, 3, 4, 5].map(env.wpFmtHalves), ["30m", "1h", "1h 30", "2h", "2h 30"]);

// what comes back from the store is checked
assert.deepStrictEqual(env.wpCleanLengths({ "buffer:a": 3, "buffer:b": 1, "x:y": 4, "training:t": 99, "recurring:r": "2" }),
  { "buffer:a": 3, "recurring:r": 2 });

// it saves with the grid, and the store keeps it clean
assert.ok(/timeBlocks: \[[^\]]*"lengths"[^\]]*\]/.test(HTML), "the grid's save carries lengths");
assert.ok(/lengths: wpCleanLengths\(plan\.lengths\)/.test(HTML), "a loaded week cleans its lengths");
assert.ok(/if \("lengths" in incoming\)/.test(STORE), "the store whitelists lengths");

// the chip: a drag edge in a timed block, none in Anytime or Notes
assert.ok(/class="wp-chip-len"[\s\S]{0,200}onpointerdown="wpLenStart\(event,'\$\{ref\}','\$\{ck\}'\)"/.test(fn("wpChipHtml")), "a timed chip has a drag edge");
assert.ok(/const sized = !!wpBlockHalves\(slot\)/.test(fn("wpChipHtml")), "…only where the block has hours");

console.log("v304 job length: all assertions passed");
