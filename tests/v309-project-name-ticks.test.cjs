// v309 — when every step in a project block is ticked, the project's name is ticked too.
//
// Ash: "be nice, when I tick off all the jobs in my project, that it ticks off the actual
// project name as well"
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
const render = new Function(`
  const WP_ANY = "any", WP_HALF_PX = 26;
  let wpGridHideDone = false, wpProjects = { list: [] }, wpOpenBlocks = new Set();
  const wpEsc = (s) => String(s), wpProjAccent = () => "orange", wpBlockHalves = () => false,
    wpBlockLenKey = () => "k", wpLenOf = () => 1, wpSpanMax = () => 1, wpProjDueLabel = () => null,
    wpStepNoteBtnHtml = () => "", wpColorStyle = () => "", wpColorBtnHtml = () => "",
    wpHideBtnHtml = () => "", wpFmtHalves = () => "";
  ${fn("wpBlockHtml")}
  return wpBlockHtml;`)();
const block = (doneFlags) => ({ kind: "block", pid: "p1", name: "Money straight",
  steps: doneFlags.map((d, i) => ({ ref: "project:s" + i, it: { id: "s" + i, title: "Step " + i, done: d } })) });

const some = render(block([true, false]), "mon", "10-12:mon");
assert.ok(!some.includes("wp-pb-tick"), "a project with a step still to do has no tick on its name");
assert.ok(!some.includes("wp-pb-alldone"), "and is not marked all done");

const all = render(block([true, true]), "mon", "10-12:mon");
assert.ok(all.includes('class="wp-pb-tick"'), "every step ticked: the name gets a tick");
assert.ok(all.indexOf("wp-pb-tick") < all.indexOf("wp-pb-name"), "the tick sits before the name");
assert.ok(all.includes("wp-pb-alldone"), "and the block is marked all done");
assert.ok(/\.wp-pblock\.wp-pb-alldone \.wp-pb-name\{text-decoration:line-through;\}/.test(HTML), "the name is struck through");

console.log("v309 project name ticks: ok");
