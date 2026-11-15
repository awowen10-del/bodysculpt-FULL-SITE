// v302 — Hide done on the weekly Project / Buffer / Training lists.
//
// Ash: "can we add a little toggle that hides all the completed jobs? They will stay visible
// on the actual calendar itself. But this would be useful on a Sunday to see what's
// outstanding, and what needs to be moved over to the next week."
//
// The rule that matters: hiding is CSS only. A done row is still written into the page, so
// wpSyncFromDom and every save still find it — the switch can never drop or rewrite a task.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function bodyOf(name) {
  const m = new RegExp("\\n(?:async )?function " + name + "\\s*\\(").exec(HTML);
  assert.ok(m, "the page defines " + name + "()");
  let i = HTML.indexOf("{", m.index + m[0].length - 1), depth = 0, j = i;
  for (; j < HTML.length; j++) {
    if (HTML[j] === "{") depth++;
    else if (HTML[j] === "}") { depth--; if (!depth) break; }
  }
  return HTML.slice(m.index, j + 1);
}

// Run the real wpListBox with stand-ins for what it calls.
const src = [
  "const WP_HIDE_DONE_KEY='k';", "let wpHideDone=false;",
  "const wpProjects={list:[]}; const wpProjAccent=()=>'orange'; const wpEsc=s=>String(s);",
  bodyOf("wpDoneCount"), bodyOf("wpHideDoneBtnHtml"), bodyOf("wpProjGroupedRows"), bodyOf("wpListBox"),
  "return { list: wpListBox, set: v => { wpHideDone = v; } };",
].join("\n");
const done = new Set(["a", "c"]);
const env = new Function("wpItemRow", "wpIsDone", "wpBoxHeader", "wpMonthlyPickerHtml", "wpProjectPickerHtml", src)(
  (s, it) => `<div class="wp-drag-row${done.has(it.id) ? " wp-item-done" : ""}" data-id="${it.id}"></div>`,
  (s, it) => done.has(it.id),
  (t, k, extra) => `<div class="wp-box-h"><span>${t}</span>${extra || ""}</div>`,
  () => "", () => ""
);
const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

// off: no hiding class, the switch shows the count of done jobs
let out = env.list("Project", "project", "project", items, "x()", "+ Add");
assert.ok(!/wp-hide-done/.test(out), "off by default");
assert.ok(/class="wp-hidedone"/.test(out) && /wp-hidedone-n">2</.test(out), "switch with a count of 2 done");

// on: the box hides done rows by CSS, but EVERY row is still in the page
env.set(true);
out = env.list("Buffer", "buffer", "buffer", items, "x()", "+ Add");
assert.ok(/class="wp-box wp-hide-done"/.test(out), "on adds the hiding class");
["a", "b", "c"].forEach(id => assert.ok(out.includes(`data-id="${id}"`), "row " + id + " still in the page"));
assert.ok(/aria-pressed="true"/.test(out), "switch reads as on");

// training gets the switch too; recurring does not
out = env.list("Training", "training", "training", items, "x()", "+ Add");
assert.ok(/wp-hidedone/.test(out), "training has the switch");
out = env.list("Recurring", "recurring", "recurring", items, "x()", "+ Add");
assert.ok(!/wp-hidedone/.test(out) && !/wp-hide-done/.test(out), "recurring untouched");

// all done + hiding: say so instead of an empty box
done.add("b");
out = env.list("Project", "project", "project", items, "x()", "+ Add");
assert.ok(/All 3 done/.test(out), "an all-done list says so");

// the CSS hides only done rows in a hiding box; the preference is this-computer only
assert.ok(/\.wp-hide-done \.wp-drag-row\.wp-item-done\{display:none;\}/.test(HTML), "CSS hides done rows only");
const tog = bodyOf("wpToggleHideDone");
assert.ok(/wpSyncFromDom\(\)/.test(tog), "captures in-progress edits before re-rendering");
assert.ok(/localStorage\.setItem\(WP_HIDE_DONE_KEY/.test(tog) && !/fetch\(/.test(tog), "stored on this computer, never sent to the store");

console.log("v302 hide done: ok");
