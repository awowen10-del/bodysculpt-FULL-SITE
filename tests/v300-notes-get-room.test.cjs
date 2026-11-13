// v300: a plan's notes get room. Ash: "The notes inside of the marketing pushes like Black
// Friday, this is where all my brain dumping and finalised ideas go, so can we make this bigger?
// maybe even a popup box?" The rules that matter: notes hold 20,000 characters; they save through
// their own door (noteItem) and nothing else changes; the dates form no longer carries them, so
// saving the dates can never wipe them; and a box opened on old notes is refused, not written.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const PAGE = read("content-calendar.html");
const LIB = read("netlify/lib/marketing-calendar.js");

async function main() {
  const out = fs.mkdtempSync(path.join(require("os").tmpdir(), "v300-"));
  const lib = path.join(out, "lib.mjs");
  fs.writeFileSync(lib, LIB.replace('import { getStore } from "@netlify/blobs";', "const getStore = () => globalThis.__mem;"));
  let rec = null;
  globalThis.__mem = { get: async () => rec, setJSON: async (_, v) => { rec = JSON.parse(JSON.stringify(v)); } };
  const m = await import(lib);
  const bf = () => rec.items.find((i) => i.id === "seed-bf");

  // ---- server: the notes door
  assert.ok((await m.applyOp({ op: "noteItem", id: "seed-bf", notes: "10 months for £999", was: "" })).ok, "notes save on their own");
  assert.strictEqual(bf().notes, "10 months for £999");
  assert.strictEqual(bf().title, "Black Friday", "and nothing else on the plan moves");
  assert.strictEqual(rec.items.length, 5);
  const stale = await m.applyOp({ op: "noteItem", id: "seed-bf", notes: "old tab", was: "" });
  assert.ok(stale.error, "a box opened on older notes is refused");
  assert.strictEqual(bf().notes, "10 months for £999", "and writes over nothing");
  assert.ok((await m.applyOp({ op: "noteItem", id: "seed-bf", notes: "10 months for £999\nline two", was: "10 months for £999" })).ok, "the next save from the same box goes in");
  assert.ok((await m.applyOp({ op: "noteItem", id: "nope", notes: "x" })).error, "an unknown plan is refused");
  const long = "a".repeat(25000);
  await m.applyOp({ op: "noteItem", id: "seed-bf", notes: long, was: bf().notes });
  assert.strictEqual(bf().notes.length, 20000, "20,000 characters of room");
  assert.strictEqual(m.cleanItem({ cat: "lead", title: "x", start: "2026-11-02", notes: long }).notes.length, 20000);
  // the dates form saves the plan without notes: they stay
  await m.applyOp({ op: "noteItem", id: "seed-bf", notes: "the final plan", was: bf().notes });
  await m.applyOp({ op: "saveItem", item: { id: "seed-bf", cat: "moments", title: "Black Friday", start: "2026-11-13", end: "2026-11-26", fixed: true, yearly: true, prepWeeks: 4 } });
  assert.strictEqual(bf().notes, "the final plan", "saving the dates never wipes the notes");
  assert.strictEqual(bf().start, "2026-11-13", "and the dates landed");
  await m.applyOp({ op: "saveItem", item: { id: "", cat: "lead", title: "New one", start: "2026-12-01", notes: "from the new form" } });
  assert.strictEqual(rec.items.find((i) => i.title === "New one").notes, "from the new form", "a new plan still takes its notes");

  // ---- the page
  assert.ok(/op: "noteItem", id: n\.id, notes: v, was: n\.saved/.test(PAGE), "the box saves through noteItem, saying what it started from");
  assert.ok(/\(isNew \? '<label class="cc-f">Notes<textarea name="notes"/.test(PAGE), "only a new plan's form has a notes field");
  assert.ok(/if \(e\.notes\) item\.notes = e\.notes\.value;/.test(PAGE), "so the dates form sends no notes");
  assert.ok(/'<div class="cc-notew" id="ccNote">' \+ noteHtml\(it\) \+ '<\/div><div id="ccProj">'/.test(PAGE), "notes sit at the top of the drawer, above the project");
  assert.ok(/role="dialog" aria-modal="true" aria-labelledby="ccPopH"/.test(PAGE), "the big box is a labelled dialog");
  assert.ok(/note\.timer = setTimeout\(saveNotes, 1200\)/.test(PAGE), "it saves when he stops typing");
  assert.ok(/if \(ok\) dropNotes\(\); else if \(\$\("ccNoteDrop"\)\) \$\("ccNoteDrop"\)\.hidden = false;/.test(PAGE), "a failed save keeps the box open, words and all");
  assert.ok(/if \(note\) closeNotes\(\); else shut\(\);/.test(PAGE), "Escape closes the box first, not the drawer under it");
  assert.ok(/beforeunload/.test(PAGE), "leaving the page with unsaved notes asks first");
  const css = PAGE.slice(PAGE.indexOf("/* v300: a plan's notes"), PAGE.indexOf(".cc-sugg{", PAGE.indexOf("/* v300: a plan's notes")));
  assert.ok(css.length > 200 && !/#[0-9a-fA-F]{3,6}\b|rgba\(\d/.test(css), "tokens only");
  console.log("v300 notes get room: OK");
}
main().catch((e) => { console.error(e); process.exit(1); });
