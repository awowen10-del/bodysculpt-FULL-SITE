// v258: the Finances month picker and the Year table.
//
// Ash, 27 Oct: "we can only see September — but we're in October, so an October sheet
// should have autopopulated". The picker listed only months a statement had been imported
// for, so the month you are IN did not exist until its statement went in. It now offers
// every month from January to now, marks the empty ones, and the Year table puts the
// whole year side by side with a year-to-date total.
const assert = require("assert");
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { extract } = require("./lib/extract.cjs");

const file = path.join(__dirname, "..", "finances.html");
const html = fs.readFileSync(file, "utf8");
const src = extract(file).replace(/\ninit\(\);\s*$/, "\n");

const RealDate = Date;
function boot(today) {
  const ctx = {
    console,
    document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: () => Promise.reject(new Error("no network in tests")),
    setTimeout, clearTimeout, TextDecoder,
    // pin "now" so the test does not depend on the day it runs
    Date: class extends RealDate { constructor(...a) { super(...(a.length ? a : [today])); } },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  vm.runInContext("S.settings = { sources: { stripe: 'STRIPE', gocardless: 'GC C1', sumup: 'SUMUP', nutraprep: 'NUTRAPREP' } };", ctx);
  return ctx;
}
const set = (ctx, js) => vm.runInContext(js, ctx);

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log("  ok " + name); };
console.log("v258 finances year table:");

ok("the picker offers the current month even with no statement for it", () => {
  const ctx = boot("2026-10-27T12:00:00");
  set(ctx, "S.months = ['2026-09']; S.ym = '2026-10';");
  const list = Array.from(ctx.pickerMonths());
  assert.ok(list.includes("2026-10"), "October is there in October");
  assert.deepStrictEqual(list, ["2026-01","2026-02","2026-03","2026-04","2026-05","2026-06",
    "2026-07","2026-08","2026-09","2026-10"], "January to now, in order, no future months");
});

ok("an older month that holds data stays in the picker", () => {
  const ctx = boot("2026-10-27T12:00:00");
  set(ctx, "S.months = ['2025-11', '2026-09']; S.ym = '2026-09';");
  const list = Array.from(ctx.pickerMonths());
  assert.strictEqual(list[0], "2025-11");
  assert.strictEqual(list[list.length - 1], "2026-10");
});

ok("'last N months' spans end at the month on screen, empty or not", () => {
  const ctx = boot("2026-10-27T12:00:00");
  set(ctx, "S.months = ['2026-06','2026-07','2026-08','2026-09'];");
  set(ctx, "S.ym = '2026-08';"); assert.strictEqual(ctx.spanEnd(), 3, "a stored month counts itself");
  set(ctx, "S.ym = '2026-10';"); assert.strictEqual(ctx.spanEnd(), 4, "an empty October ends after September");
  set(ctx, "S.ym = '2026-02';"); assert.strictEqual(ctx.spanEnd(), 4, "before any data: falls back, never an empty span");
});

ok("the year runs January to now this year, and to December for a past year", () => {
  const ctx = boot("2026-10-27T12:00:00");
  assert.strictEqual(Array.from(ctx.yearMonths("2026")).length, 10);
  assert.strictEqual(Array.from(ctx.yearMonths("2025")).length, 12);
});

ok("year figures add up, and leave out transfers and directors loans", () => {
  const ctx = boot("2026-10-27T12:00:00");
  const trend = {
    "2026-08": [
      { dir: "in", amount: 1000, desc: "STRIPE PAYOUT", cat: "" },
      { dir: "in", amount: 500, desc: "GC C1 BODYSCULPT", cat: "" },
      { dir: "out", amount: 300, desc: "RENT", cat: "Rent" },
      { dir: "out", amount: 999, desc: "POT MOVE", cat: "Transfer" },
    ],
    "2026-09": [
      { dir: "in", amount: 200, desc: "SUMUP", cat: "" },
      { dir: "in", amount: 5000, desc: "CARD LOAN", cat: "Directors loan" },
      { dir: "out", amount: 100, desc: "RENT", cat: "Rent" },
      { dir: "out", amount: 40, desc: "SOMETHING", cat: "" },
    ],
  };
  const span = Array.from(ctx.yearMonths("2026"));
  const f = ctx.yearFigures(span, trend);
  assert.strictEqual(f.ytdIn, 1700);
  assert.strictEqual(f.ytdOut, 440);
  assert.strictEqual(f.inn["2026-08"], 1500);
  assert.strictEqual(f.out["2026-10"], 0, "a month with nothing imported is zero, not an error");
  assert.strictEqual(f.srcTot.stripe, 1000);
  assert.strictEqual(f.srcTot.gocardless, 500);
  assert.strictEqual(f.srcTot.sumup, 200);
  assert.strictEqual(f.catTot.Rent, 400);
  assert.strictEqual(f.catTot.Uncategorised, 40);
  assert.ok(!("Transfer" in f.catTot) && !("Directors loan" in f.catTot));
});

ok("the Year table tab sits in the top bar, picked out, and has a view", () => {
  assert.ok(/<button class="vt vt-hl" data-view="table">[\s\S]*?Year table<\/button>/.test(html));
  assert.ok(html.includes('<div class="view" id="v-table" hidden>'));
  assert.ok(html.includes('id="mPrev"') && html.includes('id="mNext"'), "the picker has arrows");
});

console.log(pass + " passed");
