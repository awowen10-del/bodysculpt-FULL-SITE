// v277: the Content Calendar. The rules that matter: it starts this week and never reaches back,
// the focus is two months out, a plan comes back every year, a broken feed says so, and nothing
// about it can touch another page's data.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const PAGE = read("content-calendar.html");
const LIB = read("netlify/lib/marketing-calendar.js");
const FN = read("netlify/functions/marketing-calendar.js");

const box = {};
vm.createContext(box);
const pure = PAGE.slice(PAGE.indexOf("/* PURE:START */"), PAGE.indexOf("/* PURE:END */"));
vm.runInContext(pure, box);

async function main() {
  // the calendar starts this week, with no history behind it
  let w = box.ccWeeks("2026-11-05");
  assert.strictEqual(w[0], "2026-11-02", "starts the week it was switched on");
  assert.strictEqual(w.length, 52, "fifty-two weeks forward");
  w = box.ccWeeks("2026-11-20");
  assert.strictEqual(w[0], "2026-11-02", "never reaches back past the start");
  w = box.ccWeeks("2027-03-10");
  assert.strictEqual(w[0], "2027-02-08", "later on, four weeks stay visible and older ones drop off");

  // October means focus on December
  assert.strictEqual(box.ccFocusMonth("2026-10-14").month, 11, "October: December");
  assert.strictEqual(box.ccFocusMonth("2026-11-05").month, 0, "November: January");
  assert.strictEqual(box.ccFocusMonth("2026-11-05").year, 2027, "and the year rolls over");

  // a non-negotiable comes back; a one-off does not
  const yearly = { start: "2026-12-01", end: "2026-12-31", yearly: true, prepWeeks: 8 };
  assert.strictEqual(box.ccOccur(yearly, "2026-11-02", "2028-01-01").length, 2, "yearly plan returns");
  const once = { start: "2026-12-01", end: "2026-12-31", yearly: false, prepWeeks: 0 };
  assert.strictEqual(box.ccOccur(once, "2026-11-02", "2028-01-01").length, 1, "one-off stays once");
  const next = box.ccOccur(yearly, "2027-09-01", "2027-10-31");
  assert.strictEqual(next.length, 1, "the run-up shows even before the plan itself is in view");

  // the week's state
  assert.strictEqual(box.ccStatus(1, 1, false), "done");
  assert.strictEqual(box.ccStatus(1, 3, false), "part");
  assert.strictEqual(box.ccStatus(0, 3, true), "missed");
  assert.strictEqual(box.ccStatus(0, 3, false), "due");

  // past weeks with nothing to show cannot be clicked
  assert.ok(/class="cc-wk lost" disabled/.test(PAGE), "a lost week is disabled, not a dead click");

  // the plan lives on its own and cannot reach anything else
  assert.ok(/name: "bodysculpt-mktcal"/.test(LIB), "its own blob store");
  assert.ok(!/bodysculpt-kpi/.test(LIB), "never opens the KPI store");
  assert.ok(!/\.delete\(/.test(LIB), "deleting flags a plan and keeps it, which is what makes Undo real");
  assert.ok(!/method:\s*"(POST|PUT|DELETE|PATCH)"/.test(LIB), "read-only towards GHL, Instagram and Meta");
  assert.ok(/Comes back every year/.test(PAGE), "the form says what non-negotiable does");
  assert.ok(/data-act="undo"/.test(PAGE), "the undo sits on the confirmation");

  // the rail, on every page
  for (const f of ["index.html", "monthly.html", "quarterly.html", "finances.html", "daily.html", "social.html", "ads.html", "schedule.html", "projects.html", "health.html", "content-calendar.html"]) {
    const s = read(f);
    assert.ok(s.includes('href="/content-calendar.html"'), f + " links to it");
    assert.ok(s.includes('<symbol id="ic-year"'), f + " has its icon");
    assert.ok(s.includes('src="/focus-timer.js"'), f + " carries the timer");
  }
  const rail = read("social.html");
  assert.ok(rail.indexOf("/content-calendar.html") < rail.indexOf('<a href="/social.html"'), "it leads the Social group");

  // no colour outside the tokens
  const css = PAGE.slice(PAGE.indexOf("v277: THE CONTENT CALENDAR"), PAGE.indexOf("</style>"));
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(css), "tokens only");

  // the server half, with a stubbed network
  const out = fs.mkdtempSync(path.join(require("os").tmpdir(), "v277-"));
  const lib = path.join(out, "lib.mjs");
  fs.writeFileSync(lib, LIB.replace('import { getStore } from "@netlify/blobs";', "const getStore = () => ({});"));
  const m = await import(lib);
  assert.strictEqual(m.mondayOf("2026-11-05"), "2026-11-02");
  assert.strictEqual(m.mondayOf("2026-11-02"), "2026-11-02");
  assert.strictEqual(m.cleanItem({ cat: "nope", title: "x", start: "2026-11-02" }), null, "unknown row refused");
  assert.strictEqual(m.cleanItem({ cat: "lead", title: "  ", start: "2026-11-02" }), null, "needs a name");
  assert.strictEqual(m.cleanItem({ cat: "lead", title: "x", start: "2026-11-05", end: "2026-11-01" }).end, "2026-11-05", "end cannot precede start");

  const realFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ schedules: [
    { id: "a", name: "Sent this week", subject: "s", status: "complete", updatedAt: "2026-11-03T10:00:00Z" },
    { id: "b", name: "Sent before the start", status: "complete", updatedAt: "2026-10-24T10:00:00Z" },
    { id: "c", name: "Draft", status: "draft", updatedAt: "2026-11-03T10:00:00Z" },
    { id: "d", name: "Binned", status: "complete", deleted: true, updatedAt: "2026-11-03T10:00:00Z" },
  ] }), { status: 200 });
  const em = await m.readEmails({ GHL_API_KEY: "k", GHL_LOCATION_ID: "l" }, "2026-11-02");
  assert.deepStrictEqual(em.items.map((x) => x.id), ["a"], "only sent, kept, and from the start onwards");
  assert.ok(!("raw" in em), "the raw answer never reaches the page");
  global.fetch = realFetch;

  fs.rmSync(out, { recursive: true, force: true });
  void FN;
  console.log("v277 content calendar: OK");
}
main().catch((e) => { console.error(e); process.exit(1); });
