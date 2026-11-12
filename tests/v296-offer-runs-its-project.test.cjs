// v296: a plan on the Content Calendar can be run by a project. Ash: "it would be nice to be able
// to manage my projects from here, too ... bring it up from the content calendar page too, and be
// able to do work on it, from there." The rules that matter: the plan stores only the project's
// id; a save that doesn't mention the project never drops the link; the page works the project
// only through the Projects function's narrow doors (stepLink / addStep), never by sending the
// whole project back, so a stale drawer can't overwrite the board; and a project joined to a plan
// counts as made on the calendar for the social pages.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const PAGE = read("content-calendar.html");
const LIB = read("netlify/lib/marketing-calendar.js");

async function main() {
  // ---- server: the link, kept and refused
  const out = fs.mkdtempSync(path.join(require("os").tmpdir(), "v296-"));
  const lib = path.join(out, "lib.mjs");
  fs.writeFileSync(lib, LIB.replace('import { getStore } from "@netlify/blobs";', "const getStore = () => globalThis.__mem;"));
  let rec = null;
  globalThis.__mem = { get: async () => rec, setJSON: async (_, v) => { rec = JSON.parse(JSON.stringify(v)); } };
  const m = await import(lib);
  const bf = () => rec.items.find((i) => i.id === "seed-bf");

  assert.ok((await m.applyOp({ op: "linkItem", id: "seed-bf", projectId: "p_67pw51zxaky" })).ok, "a plan can be joined to a project");
  assert.strictEqual(bf().projectId, "p_67pw51zxaky");
  assert.strictEqual(rec.items.length, 5, "linking adds nothing and removes nothing");
  // the details form saves the whole item without the project: the link survives
  await m.applyOp({ op: "saveItem", item: { id: "seed-bf", cat: "moments", title: "Black Friday", start: "2026-11-13", end: "2026-11-26", fixed: true, yearly: true, prepWeeks: 4, notes: "" } });
  assert.strictEqual(bf().projectId, "p_67pw51zxaky", "saving the dates never drops the project");
  assert.strictEqual(bf().start, "2026-11-13", "and the save itself landed");
  await m.applyOp({ op: "saveItem", item: { id: "seed-bf", cat: "moments", title: "Black Friday", start: "2026-11-13", end: "2026-11-26", fixed: true, yearly: true, prepWeeks: 4, notes: "", projectId: "" } });
  assert.strictEqual(bf().projectId, "", "a save that says no project means it");
  await m.applyOp({ op: "linkItem", id: "seed-bf", projectId: "p_67pw51zxaky" });
  assert.ok((await m.applyOp({ op: "linkItem", id: "seed-bf", projectId: "../x" })).error, "a bad id is refused");
  assert.strictEqual(bf().projectId, "p_67pw51zxaky", "and changes nothing");
  assert.ok((await m.applyOp({ op: "linkItem", id: "nope", projectId: "p_1" })).error, "an unknown plan is refused");
  assert.ok((await m.applyOp({ op: "linkItem", id: "seed-bf", projectId: "" })).ok, "unlinking is allowed");
  assert.strictEqual(bf().projectId, "");
  assert.strictEqual(m.cleanItem({ cat: "lead", title: "x", start: "2026-11-02", projectId: "a b" }).projectId, "", "cleanItem only keeps a real id");
  assert.strictEqual(m.cleanItem({ cat: "lead", title: "x", start: "2026-11-02", projectId: "p_ok-1" }).projectId, "p_ok-1");

  // ---- the strip: a project joined to a plan shows on the social pages
  const cu = {}; vm.createContext(cu);
  vm.runInContext(read("coming-up.js") + "\nthis.cuCollect=cuCollect;this.CU_PAGES=CU_PAGES;", cu);
  const PR = [{ id: "p1", name: "BF offers", status: "active", targetDate: "2026-11-13", steps: [] }];
  const items = [{ id: "i", cat: "moments", title: "Black Friday", start: "2026-11-13", end: "2026-11-26", fixed: true, prepWeeks: 4, projectId: "p1" }];
  const soc = (it) => Array.from(cu.cuCollect({ items: it }, PR, "2026-11-05", cu.CU_PAGES["/social.html"])).map((x) => x.title);
  assert.ok(soc(items).includes("BF offers deadline"), "joined to a plan = made on the calendar");
  assert.ok(!soc([Object.assign({}, items[0], { projectId: "" })]).includes("BF offers deadline"), "unjoined, it stays off");
  assert.ok(!soc([Object.assign({}, items[0], { del: true })]).includes("BF offers deadline"), "a deleted plan joins nothing");

  // ---- the page: narrow doors only
  const js = PAGE.slice(PAGE.indexOf("v296: a plan's project"));
  assert.ok(/stepLink: Object\.assign\(\{ projectId: pid, stepId: sid \}, patch\)/.test(PAGE), "task changes go through stepLink");
  assert.ok(/addStep: \{ projectId: pid, title: title, id: sid \}/.test(PAGE), "new tasks go through addStep, with their own id");
  const wholeSends = (PAGE.match(/saveProj\(/g) || []).length;
  assert.strictEqual(wholeSends, 4, "the whole project is only ever sent to create one or archive one (the Undo), as before: " + wholeSends);
  assert.ok(/"Task deleted", function \(\) \{\s*stepCall\(pX, sX, \{ del: false \}/.test(PAGE), "deleting a task has Undo on the confirmation");
  assert.ok(/data-act="unlink"/.test(js) && /Unlinked\. The project is still in Projects/.test(js), "unlinking says the project is safe");
  assert.ok(/op: "linkItem", id: itemId, projectId: saved\.id/.test(PAGE), "a project started from a plan is joined to it, not given a second bar");
  assert.ok(/for="ccNewStep">Add a task<\/label>/.test(PAGE), "the add box has a visible label");
  // no literal colours in the new CSS (v121)
  const css = PAGE.slice(PAGE.indexOf("/* v296: the big offers"), PAGE.indexOf("</style>"));
  assert.ok(!/#[0-9a-fA-F]{3,6}\b|rgba\(\d/.test(css.replace(/#ccProj|#ccNewStep/g, "")), "tokens only");
  // ---- v297: a task's date is its due date OR its day on the weekly plan, read like the board
  const pure = PAGE.slice(PAGE.indexOf("/* PURE:START */"), PAGE.indexOf("/* PURE:END */"));
  const w = { today: "2026-11-12", nowWk: "2026-11-09" }; vm.createContext(w);
  vm.runInContext(pure, w);
  vm.runInContext("function fmt(d){var m=CC_MONTHS[Number(d.slice(5,7))-1];return Number(d.slice(8,10))+' '+m.slice(0,3);}" +
    PAGE.slice(PAGE.indexOf("  var CC_DAYS = "), PAGE.indexOf("  function stepRank(")) + "\nthis.whenOf=whenOf;this.whenLabel=whenLabel;this.datePatch=datePatch;", w);
  const L = (st) => w.whenLabel(w.whenOf(st));
  assert.strictEqual(L({ due: "", week: "2026-11-09", day: "fri" }), "Fri this week", "a plan day reads as the board reads it");
  assert.strictEqual(L({ due: "", week: "2026-11-16", day: "mon" }), "Mon next week");
  assert.strictEqual(L({ due: "", week: "2026-11-30", day: "wed" }), "Wed 2 Dec");
  assert.strictEqual(L({ due: "2026-11-20", week: "2026-11-09", day: "fri" }), "Due 20 Nov", "a due date wins, as it does on Weekly");
  assert.strictEqual(L({ due: "", week: "", day: "" }), "Add date");
  assert.strictEqual(w.whenOf({ due: "", week: "2026-11-09", day: "fri" }).date, "2026-11-13");
  const P = (st, v) => JSON.parse(JSON.stringify(w.datePatch(st, v)));
  assert.deepStrictEqual(P({ due: "", week: "2026-11-09", day: "fri", slot: "6-9" }, "2026-11-18"), { week: "2026-11-16", day: "wed", slot: "" }, "a planned task moves its plan day, and loses a time that was for another day");
  assert.deepStrictEqual(P({ due: "", week: "2026-11-09", day: "fri", slot: "6-9" }, "2026-11-13"), { week: "2026-11-09", day: "fri", slot: "6-9" }, "same day keeps its time");
  assert.deepStrictEqual(P({ due: "", week: "", day: "" }, "2026-11-18"), { week: "2026-11-16", day: "wed", slot: "" }, "an undated task goes on the plan for that day");
  assert.deepStrictEqual(P({ due: "2026-11-20", week: "", day: "" }, "2026-11-25"), { due: "2026-11-25" }, "a due-dated task moves its due date");
  assert.deepStrictEqual(P({ due: "2026-11-20", week: "2026-11-16", day: "fri" }, "2026-11-25"), { due: "2026-11-25", week: "2026-11-23", day: "wed", slot: "" }, "and its plan day with it, so the board shows one date");
  assert.deepStrictEqual(P({ due: "2026-11-20", week: "2026-11-16", day: "fri" }, ""), { due: "", week: "", day: "", slot: "" }, "clearing takes both off");
  console.log("v296 offer runs its project: OK");
}
main().catch((e) => { console.error(e); process.exit(1); });
