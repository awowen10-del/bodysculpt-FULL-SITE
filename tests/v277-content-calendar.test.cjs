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
  // the year is this month and the eleven after it, and it never reaches back
  const yr = box.ccMonthsAhead("2026-11-05");
  assert.strictEqual(yr.length, 12, "twelve months");
  assert.strictEqual(yr[0].ym, "2026-11", "starts with this month");
  assert.strictEqual(yr[11].ym, "2027-10", "ends eleven months on");
  assert.strictEqual(yr[1].last, "2026-12-31", "a month knows its last day");
  assert.strictEqual(box.ccMonthsAhead("2026-12-01")[0].ym, "2026-12", "a finished month drops off");

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
  assert.ok(/class="cc-it lost" disabled/.test(PAGE), "a lost week is disabled, not a dead click");
  assert.strictEqual(box.CC_IDEAS.length, 12, "an idea for every month, shown only when it is empty");
  assert.ok(!/cc-rib|cc-num/.test(PAGE), "no timeline strip and no background numbers");
  assert.ok(/Content Calendar<\/h1>/.test(PAGE), "the page says what it is");

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
  assert.ok(!/#[0-9a-fA-F]{3,6}\b|rgba\(\d/.test(css), "tokens only");

  // v278: a project made here is an ordinary project
  assert.ok(/fetch\(PROJ_API, \{ method: "POST"[\s\S]{0,120}JSON\.stringify\(\{ project: project \}\)/.test(PAGE), "goes through the Projects page's own front door");
  assert.ok(/archived: true/.test(PAGE), "undo archives it, as the Projects page does");
  assert.ok(/name="deadline" required/.test(PAGE), "a project here always has a deadline");

  // v278: Coming up
  const cu = {}; vm.createContext(cu);
  vm.runInContext(read("coming-up.js") + "\nthis.cuCollect=cuCollect;this.CU_PAGES=CU_PAGES;", cu);
  const P = [{ cat: "moments", title: "Black Friday", start: "2026-11-23", end: "2026-11-30", fixed: true, yearly: true, prepWeeks: 8 },
    { cat: "moments", title: "Train for free", start: "2026-12-01", end: "2026-12-31", fixed: true, yearly: true, prepWeeks: 8 },
    { cat: "moments", title: "Deleted", start: "2026-11-10", end: "2026-11-11", fixed: true, del: true }];
  const PR = [{ id: "a", name: "Launch", status: "active", targetDate: "2026-11-20", steps: [
      { title: "Write it", due: "2026-11-03" }, { title: "Film it", due: "2026-11-10" }, { title: "Edit it", due: "2026-11-12" },
      { title: "Done one", due: "2026-11-06", done: true }, { title: "Binned", due: "2026-11-06", del: true }] },
    { id: "b", name: "Old", archived: true, targetDate: "2026-11-07", steps: [] }];
  const titles = (cfg) => Array.from(cu.cuCollect({ items: P }, PR, "2026-11-05", cfg)).map((x) => x.title);
  const wk = titles(cu.CU_PAGES["/index.html"]);
  assert.ok(wk.includes("Launch deadline") === false, "the deadline is 15 days out, one past Weekly's two weeks");
  const mo = titles(cu.CU_PAGES["/monthly.html"]);
  assert.ok(mo.includes("Black Friday") && mo.includes("Train for free"), "Monthly sees the big moments");
  assert.ok(mo.includes("Launch deadline"), "and project deadlines");
  assert.ok(mo.includes("Write it (Launch)"), "and overdue tasks");
  assert.ok(mo.includes("Launch: 2 tasks due, next 10 Nov"), "tasks group by project, done and deleted ones left out");
  assert.strictEqual(mo[0], "Black Friday", "a big moment leads, even with overdue work behind it");
  assert.ok(mo.includes("Nothing planned for January yet"), "and it says when the focus month is empty");
  assert.ok(!mo.some((t) => /Deleted|Old/.test(t)), "deleted plans and archived projects stay out");
  assert.ok(!titles(cu.CU_PAGES["/social.html"]).some((t) => /tasks|Write it/.test(t)), "the social pages get moments, not task lists");
  assert.strictEqual(Array.from(cu.cuCollect({ items: P }, PR, "2026-11-25", cu.CU_PAGES["/daily.html"]))[1] !== undefined, true, "something to say mid-campaign");
  assert.ok(Array.from(cu.cuCollect({ items: P }, [], "2026-11-25", cu.CU_PAGES["/daily.html"])).some((x) => x.when === "Live now"), "a running moment says so");
  const CUJS = read("coming-up.js").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/method:/.test(CUJS), "the strip only ever reads");
  for (const f of ["daily.html", "index.html", "monthly.html", "quarterly.html", "projects.html", "social.html", "ads.html", "schedule.html"]) assert.ok(read(f).includes('src="/coming-up.js"'), f + " carries the strip");

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
