// v122: the Finances page — the bank-file reader, the category memory and the
// Profit First week maths.
//
// These are the parts that carry real risk: a mis-read column silently imports
// nonsense, and a wrong week boundary moves the wrong amount of money. Everything
// here runs the page's OWN functions, pulled out of finances.html, against the
// three file shapes the account actually produces.
// Arrays that come back from the vm belong to ITS realm, so deepStrictEqual on one
// fails on the prototype alone — anything compared structurally is spread into a
// local array first.
const assert = require("assert");
const vm = require("vm");
const path = require("path");
const { extract } = require("./lib/extract.cjs");

const src = extract(path.join(__dirname, "..", "finances.html"))
  .replace(/\ninit\(\);\s*$/, "\n");   // load the functions, don't boot the page

const ctx = {
  console,
  document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} },
  fetch: () => Promise.reject(new Error("no network in tests")),
  setTimeout, clearTimeout,
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const { parseDelimited, readTable, guessMapping, buildRows, toAmount, toDate,
        merchantOf, categorise, weekStartOf, dropEmptyCols, findHeader } = ctx;

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log("  ok " + name); };

console.log("v122 finances:");

/* ---------- amounts ---------- */
ok("reads every amount format a UK bank emits", () => {
  assert.strictEqual(toAmount("£1,763.29"), 1763.29);
  assert.strictEqual(toAmount("£ 3.44"), 3.44);
  assert.strictEqual(toAmount("-30.48"), -30.48);
  assert.strictEqual(toAmount("+62.94"), 62.94);
  assert.strictEqual(toAmount("(12.34)"), -12.34);
  assert.strictEqual(toAmount(""), null);
  assert.strictEqual(toAmount("Balance"), null);
});

/* ---------- dates ---------- */
ok("reads UK dates as day-first", () => {
  assert.strictEqual(toDate("07/09/2026", "auto"), "2026-09-07");   // 7 Sep, not 9 Jul
  assert.strictEqual(toDate("28/06/2026", "auto"), "2026-06-28");
  assert.strictEqual(toDate("2026-06-28", "auto"), "2026-06-28");
  assert.strictEqual(toDate("07/09/2026", "mdy"), "2026-07-09");     // forced, if ever needed
  assert.strictEqual(toDate("3-Aug-26", "auto"), "2026-08-03");
  assert.strictEqual(toDate("not a date", "auto"), null);
});

/* ---------- shape 1: a plain CSV with a header ---------- */
const FUNDING = `date,description,amount,reference,repayment_term
28/06/2026,Repayment - Funding Circle,+62.94,Jay Bell,
22/06/2026,TROPICANA WHOLESALE,-30.48,,
01/06/2026,Card Repayment May,-1190.65,FLEXIPAY REPAYMENT,3`;

ok("a signed-amount CSV splits into money in and money out", () => {
  const t = readTable(FUNDING);
  const map = guessMapping(t);
  assert.strictEqual(t.headers[map.date], "date");
  assert.strictEqual(t.headers[map.desc], "description");
  assert.strictEqual(t.headers[map.amt], "amount");
  const rows = buildRows(t, map, "auto");
  assert.strictEqual(rows.length, 3);
  const credit = rows.find((r) => r.desc.includes("Repayment - Funding"));
  assert.strictEqual(credit.dir, "in");
  assert.strictEqual(credit.amount, 62.94);
  const debit = rows.find((r) => r.desc === "TROPICANA WHOLESALE");
  assert.strictEqual(debit.dir, "out");
  assert.strictEqual(debit.amount, 30.48);
  assert.strictEqual(rows[0].date, "2026-06-01");   // sorted oldest first
});

ok("the amount column is not confused with the balance column", () => {
  const t = readTable(`Date,Description,Amount,Balance
01/08/2026,CARD PAYMENT TO CANVA,-13.00,2958.19
02/08/2026,CARD PAYMENT TO NETLIFY,-11.46,2946.73`);
  const map = guessMapping(t);
  assert.strictEqual(t.headers[map.amt], "Amount");
  const rows = buildRows(t, map, "auto");
  assert.deepStrictEqual([...rows.map((r) => r.amount)], [13, 11.46]);
});

/* ---------- shape 2: Santander's HTML .xls, spacer columns and all ----------
   parseHtmlTable needs a DOM, which node has not got; the grid below is exactly
   what its querySelectorAll produces from the real file, so everything after the
   DOM read is covered. */
const SANTANDER_GRID = [
  ["", "XXXX XXXX XXXX 9792:", "", "07/03/2026 to 07/09/2026", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", "", "", ""],
  ["", "Date", "", "Description", "", "Money in", "Money Out", "Balance", "", ""],
  ["", "", "", "", "", "", "", "", "", ""],
  ["", "07/09/2026", "", "FASTER PAYMENTS RECEIPT REF.MFG PID1354570 FROM SumUp Payments Account", "", "£ 3.44", "", "£ 2,958.19", "", ""],
  ["", "07/09/2026", "", "BILL PAYMENT VIA FASTER PAYMENT TO GRACE TERRY REFERENCE Bodysculpt , MANDATE NO 0127", "", "", "£ 62.58", "£ 2,954.75", "", ""],
  ["", "06/09/2026", "", "CARD PAYMENT TO FACEBK *D3CPMYZRS2 ON 05-09-2026", "", "", "£ 509.44", "£ 2,445.31", "", ""],
];

ok("Santander's spacer columns are dropped and the header is still found", () => {
  const g = dropEmptyCols(SANTANDER_GRID);
  assert.strictEqual(g[0].length, 5, "five real columns survive");
  const head = findHeader(g);
  assert.deepStrictEqual([...g[head]], ["Date", "Description", "Money in", "Money Out", "Balance"]);
});

ok("separate money in / money out columns give the right direction", () => {
  const g = dropEmptyCols(SANTANDER_GRID).filter((r) => r.some((c) => c !== ""));
  const head = findHeader(g);
  const t = { headers: g[head], rows: g.slice(head + 1) };
  const map = guessMapping(t);
  assert.strictEqual(t.headers[map.inn], "Money in");
  assert.strictEqual(t.headers[map.out], "Money Out");
  assert.strictEqual(map.amt, -1, "a separate in/out pair must switch the single amount column off");
  const rows = buildRows(t, map, "auto");
  assert.strictEqual(rows.length, 3);
  const sumup = rows.find((r) => r.desc.includes("SumUp"));
  assert.strictEqual(sumup.dir, "in");
  assert.strictEqual(sumup.amount, 3.44);
  const wages = rows.find((r) => r.desc.includes("GRACE TERRY"));
  assert.strictEqual(wages.dir, "out");
  assert.strictEqual(wages.amount, 62.58);
  // the balance column must never be read as the amount
  assert.ok(!rows.some((r) => r.amount > 1000), "balance leaked into amounts");
});

/* ---------- shape 3: the plain-text key/value export ---------- */
ok("the Date:/Description:/Amount: text export reads too", () => {
  const t = readTable(`From: 01/08/2026 to 31/08/2026

Account: XXXX 9792

Date: 04/08/2026
Description: CARD PAYMENT TO ONTRAPORT, INC
Amount: -14.93
Balance: 2100.00

Date: 03/08/2026
Description: FASTER PAYMENTS RECEIPT REF.STRIPE FROM Stripe Payments UK Ltd
Amount: 287.32
Balance: 2114.93
`);
  const map = guessMapping(t);
  const rows = buildRows(t, map, "auto");
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].date, "2026-08-03");
  assert.strictEqual(rows[0].dir, "in");
  assert.strictEqual(rows[1].amount, 14.93);
  assert.strictEqual(rows[1].dir, "out");
});

/* ---------- categorising ---------- */
ok("a transaction id glued to the merchant name is stripped", () => {
  // Without this, the same monthly subscription is a NEW merchant every month and can
  // never be auto-categorised — which is the whole point of remembering a rule.
  assert.strictEqual(merchantOf("CARD PAYMENT TO MICROSOFT-G167112320 ON 01-08-2026"), "MICROSOFT");
  assert.strictEqual(merchantOf("CARD PAYMENT TO MICROSOFT-G173431096 ON 01-09-2026"), "MICROSOFT");
  assert.strictEqual(merchantOf("CARD PAYMENT TO GODADDY#4156017395 ON 01-08-2026"), "GODADDY");
  // a short number is a branch, not a transaction id, and stays
  assert.strictEqual(merchantOf("TESCO STORES 2676 (VIA APPLE PAY), ON 31-05-2026"), "TESCO STORES 2676");
});

ok("the merchant is pulled out of the bank's boilerplate", () => {
  assert.strictEqual(merchantOf("CARD PAYMENT TO CANVA* 04960-21821687 ON 01-08-2026"), "CANVA");
  assert.strictEqual(merchantOf("CARD PAYMENT TO ONTRAPORT, INC ,20.00 USD, RATE 0.7465/£ ON 01-08-2026"), "ONTRAPORT, INC");
  assert.strictEqual(merchantOf("BILL PAYMENT VIA FASTER PAYMENT TO GRACE TERRY REFERENCE Bodysculpt , MANDATE NO 0127"), "GRACE TERRY");
  assert.strictEqual(merchantOf("FOREIGN CURRENCY CONVERSION FEE"), "FOREIGN CURRENCY CONVERSION FEE");
});

ok("the seeded rules categorise a fresh import", () => {
  assert.strictEqual(categorise("CARD PAYMENT TO FACEBK *D3CPMYZRS2 ON 02-08-2026").cat, "Marketing");
  assert.strictEqual(categorise("CARD PAYMENT TO ONTRAPORT, INC ON 01-08-2026").cat, "Software");
  assert.strictEqual(categorise("UBER *TRIP HELP.UBER.COM").cat, "Travel");
  assert.strictEqual(categorise("FOREIGN CURRENCY CONVERSION FEE").cat, "Charges");
  assert.strictEqual(categorise("PAYMENT TO SOMEWHERE NOBODY HAS EVER HEARD OF").cat, "");
});

ok("a longer rule beats a shorter one that also matches", () => {
  // "TESCO PFS 3732" (the fuel station, Other) must win over a plain "TESCO" (Retail)
  const specific = categorise("TESCO PFS 3732 (VIA APPLE PAY), ON 31-05-2026");
  assert.strictEqual(specific.cat, "Other");
});

ok("income is only categorised on the expense side", () => {
  const t = readTable(FUNDING);
  const rows = buildRows(t, guessMapping(t), "auto");
  const credit = rows.find((r) => r.dir === "in");
  assert.strictEqual(credit.cat, "");
  assert.ok("src" in credit, "a credit carries a source instead");
});

/* ---------- dedupe ---------- */
ok("re-reading the same statement produces the same keys, and true repeats survive", () => {
  const t = readTable(FUNDING);
  const a = buildRows(t, guessMapping(t), "auto");
  const b = buildRows(t, guessMapping(t), "auto");
  assert.deepStrictEqual([...a.map((r) => r.hash)], [...b.map((r) => r.hash)]);
  const twice = readTable(`date,description,amount
01/08/2026,CARD PAYMENT TO CANVA,-13.00
01/08/2026,CARD PAYMENT TO CANVA,-13.00`);
  const rows = buildRows(twice, guessMapping(twice), "auto");
  assert.strictEqual(new Set(rows.map((r) => r.hash)).size, 2, "two identical charges must both import");
});

/* ---------- the Profit First week ---------- */
ok("the week starts on the configured day and never jumps forward", () => {
  // 2026-09-07 is a Monday; with Thursday (4) as the start the week began 2026-09-03.
  assert.strictEqual(new Date("2026-09-07T12:00:00").getDay(), 1);
  assert.strictEqual(weekStartOf("2026-09-07", 4), "2026-09-03");
  assert.strictEqual(weekStartOf("2026-09-03", 4), "2026-09-03", "on the start day, the week is today");
  assert.strictEqual(weekStartOf("2026-09-02", 4), "2026-08-27", "the day before rolls back a full week");
  assert.strictEqual(weekStartOf("2026-09-07", 1), "2026-09-07", "Monday weeks work too");
});

/* ---------- the page itself ---------- */
const fs = require("fs");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const FIN = read("finances.html");

ok("every page carries the v122 stamp, and finances is stamped as its own build", () => {
  assert.ok(/<!-- build v12[23] · [a-z-]+ -->/.test(FIN), "finances.html carries a build stamp");
  assert.ok(/build v12[23] · [a-z-]+/.test(read("monthly.html")), "monthly.html carries the stamp");
  assert.ok(/build v12[23] · [a-z-]+/.test(read("index.html")), "index.html carries the stamp");
});

ok("the finance page stands apart from the weekly/monthly/quarterly cadence", () => {
  const bar = /<div class="viewtoggle" id="tabBar">([\s\S]*?)<\/div>/.exec(FIN);
  assert.ok(bar, "finances.html has a section bar");
  const tabs = [...bar[1].matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].trim());
  assert.deepStrictEqual(tabs, ["Cockpit", "Import", "Transactions", "Breakdown", "Report", "Settings"]);
  // it must not borrow the planning pages' week/month picker chrome
  assert.ok(!/class="periodbar"/.test(FIN), "no weekly period bar on the finance page");
});

ok("it reads and writes only finance-* keys", () => {
  const store = read(path.join("netlify", "functions", "kpi-store.js"));
  for (const k of ["finance-txns-", "finance-settings", "finance-rules", "finance-week-"]) {
    assert.ok(store.includes(k), "kpi-store defines " + k);
  }
  // the page must never post to a planning/weekly key
  for (const k of ["weeklyPlan", "monthlyPlan", "planning:", "seedAll"]) {
    assert.ok(!FIN.includes('"' + k + '"'), "finances.html does not write " + k);
  }
});



/* =====================================================================
   Booting the real page: the import → categorise → pots round trip.
   ===================================================================== */
const { boot } = require("./lib/finance-env.cjs");

// One week of the shape the account actually produces: card takings from two
// processors, a SumUp payment, a wage and an ad spend.
const AUG = [
  { id: "a1", date: "2026-08-06", dir: "in",  amount: 1000, desc: "FASTER PAYMENTS RECEIPT REF.STRIPE FROM Stripe Payments UK Ltd", src: "stripe", cat: "", km: "", hash: "a1" },
  { id: "a2", date: "2026-08-07", dir: "in",  amount:  200, desc: "FASTER PAYMENTS RECEIPT REF.BODYSCULPTTR-CX1JX FROM GC C1", src: "gocardless", cat: "", km: "", hash: "a2" },
  { id: "a3", date: "2026-08-07", dir: "in",  amount:   50, desc: "FASTER PAYMENTS RECEIPT REF.MFG PID1318625 FROM SumUp Payments Account", src: "sumup", cat: "", km: "", hash: "a3" },
  { id: "a4", date: "2026-08-07", dir: "out", amount:  300, desc: "CARD PAYMENT TO FACEBK *D3CPMYZRS2 ON 06-08-2026", cat: "Marketing", km: "Essential", hash: "a4" },
  { id: "a5", date: "2026-08-08", dir: "out", amount:  120, desc: "CARD PAYMENT TO A SHOP NOBODY HAS SEEN ON 07-08-2026", cat: "", km: "", hash: "a5" },
];

(async () => {
  /* --- it boots, and the four headline numbers are right --- */
  {
    const { ctx, S, el } = await boot({ txns: { "2026-08": AUG }, now: "2026-08-10" });
    assert.strictEqual(S.ym, "2026-08", "opens on the latest month with data");
    const stats = el("statRow").innerHTML;
    assert.ok(stats.includes("£1,250"), "money in is the sum of every credit");   // 1000+200+50
    assert.ok(stats.includes("£420"), "money out is the sum of every debit");     // 300+120
    assert.ok(stats.includes("£830"), "net movement is in minus out");
    assert.ok(/Needs review[\s\S]*?>1</.test(stats), "the one uncategorised expense is surfaced");
    pass++; console.log("  ok the cockpit's four numbers come from the month's rows");
  }

  /* --- the pots are taken off card takings only --- */
  {
    // 2026-08-10 is a Monday, so the Thursday week began 2026-08-06 and covers
    // every row above. SumUp is income but NOT allocatable, so it must not be taxed.
    const { ctx, S, el } = await boot({ txns: { "2026-08": AUG }, now: "2026-08-10" });
    assert.strictEqual(S.weekStart, "2026-08-06");
    const lines = el("pfLines").innerHTML, pots = el("pfPots").innerHTML;
    assert.ok(lines.includes("£1,200.00"), "allocatable is Stripe + GoCardless only");
    assert.ok(!lines.includes("£1,250.00"), "SumUp must not be allocated");
    assert.ok(pots.includes("£180.00"), "tax pot is 15% of £1,200");
    assert.ok(pots.includes("£48.00"), "investment pot is 4% of £1,200");
    assert.ok(pots.includes("£972.00"), "what is left to run on is the remainder");
    pass++; console.log("  ok the pots come off card takings, not off all income");
  }

  /* --- marking the money moved is logged with the amounts of the day --- */
  {
    const { ctx, S, el, store } = await boot({ txns: { "2026-08": AUG }, now: "2026-08-10" });
    await el("pfMoved").onclick();
    const w = store.weeks["2026-08-06"];
    assert.ok(w && w.moved === true, "the week is recorded as moved");
    assert.strictEqual(w.tax, 180);
    assert.strictEqual(w.invest, 48);
    assert.strictEqual(w.checklist.pots, true, "and it ticks the checklist item for you");
    pass++; console.log("  ok marking the money moved records what was moved");
  }

  /* --- categorising once teaches the rule and back-fills the month --- */
  {
    const rows = AUG.concat([
      { id: "a6", date: "2026-08-09", dir: "out", amount: 60, desc: "CARD PAYMENT TO A SHOP NOBODY HAS SEEN ON 08-08-2026", cat: "", km: "", hash: "a6" },
    ]);
    const { ctx, S, store } = await boot({ txns: { "2026-08": rows }, now: "2026-08-10" });
    const target = S.rows.find((r) => r.id === "a5");
    target.cat = "Retail";
    await ctx.onCellChange({ dataset: { id: "a5", f: "cat" }, value: "Retail", classList: { toggle() {} } });
    assert.ok(store.rules.some((r) => r.match === "A SHOP NOBODY HAS SEEN" && r.cat === "Retail"),
      "the merchant is remembered as a rule");
    assert.strictEqual(S.rows.find((r) => r.id === "a6").cat, "Retail",
      "the other charge from the same merchant is filled in too");
    pass++; console.log("  ok setting a category once teaches it and back-fills the month");
  }

  /* --- a pot move is not spending --- */
  {
    // The real shape: takings in, a real cost out, and the two pot transfers out
    // (tax + investment) plus money coming back from a pot later in the month.
    const rows = [
      { id: "t1", date: "2026-08-05", dir: "in",  amount: 5000, desc: "FASTER PAYMENTS RECEIPT REF.STRIPE FROM Stripe Payments UK Ltd", src: "stripe", cat: "", km: "", hash: "t1" },
      { id: "t2", date: "2026-08-06", dir: "out", amount:  300, desc: "CARD PAYMENT TO FACEBK ON 05-08-2026", cat: "Marketing", km: "Essential", hash: "t2" },
      { id: "t3", date: "2026-08-06", dir: "out", amount:  750, desc: "TRANSFER TO BODYSCULPT TRANSFORMATION CENTRES LTD", cat: "Transfer", km: "", hash: "t3" },
      { id: "t4", date: "2026-08-06", dir: "out", amount:  200, desc: "TRANSFER TO BODYSCULPT TRANSFORMATION CENTRES LTD", cat: "Transfer", km: "", hash: "t4" },
      { id: "t5", date: "2026-08-20", dir: "in",  amount:  150, desc: "TRANSFER FROM BODYSCULPT TRANSFORMATION CENTRES LTD", src: "transfer", cat: "Transfer", km: "", hash: "t5" },
    ];
    const { S, el } = await boot({ txns: { "2026-08": rows }, now: "2026-08-10" });
    const stats = el("statRow").innerHTML;
    assert.ok(stats.includes("£5,000"), "money in is the takings only — not the £150 back from a pot");
    assert.ok(stats.includes("£300"), "money out is the real cost only — not the £950 of pot moves");
    assert.ok(stats.includes("£4,700"), "net is 5000 - 300");
    assert.ok(!/Needs review/.test(stats), "a transfer never lands in Needs Review");
    assert.ok(el("xferNote").hidden === false, "the transfers are still shown, just not counted");
    assert.ok(/£950\.00 moved out/.test(el("xferNote").textContent), "both pot moves are reported");
    assert.ok(/£150\.00 brought back/.test(el("xferNote").textContent), "so is the money coming back");
    pass++; console.log("  ok a pot move is excluded from money in, money out and net");
  }

  /* --- and the pots are never taken off a transfer --- */
  {
    const rows = [
      { id: "u1", date: "2026-08-06", dir: "in", amount: 1000, desc: "FASTER PAYMENTS RECEIPT REF.STRIPE FROM Stripe Payments UK Ltd", src: "stripe", cat: "", km: "", hash: "u1" },
      { id: "u2", date: "2026-08-07", dir: "in", amount: 5000, desc: "TRANSFER FROM BODYSCULPT TRANSFORMATION CENTRES LTD", src: "transfer", cat: "Transfer", km: "", hash: "u2" },
      { id: "u3", date: "2026-08-07", dir: "out", amount: 150, desc: "TRANSFER TO BODYSCULPT TRANSFORMATION CENTRES LTD", cat: "Transfer", km: "", hash: "u3" },
    ];
    const { el } = await boot({ txns: { "2026-08": rows }, now: "2026-08-10" });
    const pots = el("pfPots").innerHTML;
    assert.ok(el("pfLines").innerHTML.includes("£1,000.00"), "only the Stripe takings are allocatable");
    assert.ok(pots.includes("£150.00"), "tax is 15% of £1,000, not of £6,000");
    assert.ok(pots.includes("£40.00"), "investment is 4% of £1,000");
    // and the week card reports what actually left for the pots
    assert.ok(/£150\.00/.test(el("pfSeen").innerHTML), "what actually left for the pots is shown");
    pass++; console.log("  ok money coming back from a pot is never taxed again");
  }

  /* --- the breakdown ignores transfers too --- */
  {
    const rows = [
      { id: "b1", date: "2026-08-06", dir: "out", amount: 300, desc: "CARD PAYMENT TO FACEBK ON 05-08-2026", cat: "Marketing", km: "Essential", hash: "b1" },
      { id: "b2", date: "2026-08-06", dir: "out", amount: 900, desc: "TRANSFER TO BODYSCULPT TRANSFORMATION CENTRES LTD", cat: "Transfer", km: "", hash: "b2" },
    ];
    const { ctx, el } = await boot({ txns: { "2026-08": rows }, now: "2026-08-10" });
    ctx.setView("breakdown");
    const bd = el("bdRows").innerHTML;
    assert.ok(bd.includes("Marketing"), "a real category is listed");
    assert.ok(!bd.includes("Transfer"), "a transfer is not a line of spending");
    assert.ok(bd.includes("£300.00"), "and the total is the real spending only");
    pass++; console.log("  ok the breakdown counts spending, not pot moves");
  }

  /* --- the cash traffic light is the sheet's, to the pound --- */
  {
    // The sheet: net >= 2000 "Comfortable", >= 0 "Tight", < 0 "Protect cash".
    const at = async (inAmt, outAmt) => {
      const rows = [
        { id: "i", date: "2026-08-05", dir: "in",  amount: inAmt,  desc: "FASTER PAYMENTS RECEIPT REF.STRIPE FROM Stripe Payments UK Ltd", src: "stripe", cat: "", km: "", hash: "i" },
        { id: "o", date: "2026-08-05", dir: "out", amount: outAmt, desc: "CARD PAYMENT TO FACEBK ON 04-08-2026", cat: "Marketing", km: "Essential", hash: "o" },
      ];
      const { el } = await boot({ txns: { "2026-08": rows }, now: "2026-08-10" });
      return { stats: el("statRow").innerHTML, action: el("actionText").textContent, tone: el("actionCard").className };
    };
    const comfy = await at(3000, 500);   // net 2500
    assert.ok(comfy.stats.includes("Comfortable"), "net at or above the buffer is Comfortable");
    const edge = await at(2500, 500);    // net exactly 2000 — the boundary is inclusive
    assert.ok(edge.stats.includes("Comfortable"), "exactly at the buffer still counts as Comfortable");
    const tight = await at(1000, 500);   // net 500
    assert.ok(tight.stats.includes("Tight"), "in front but under the buffer is Tight");
    const down = await at(500, 1000);    // net -500
    assert.ok(down.stats.includes("Protect cash"), "spending ahead of income is Protect cash");
    pass++; console.log("  ok cash status uses the sheet's own thresholds");
  }

  /* --- the one action, in the sheet's order of precedence --- */
  {
    const act = async (rows) => {
      const { el } = await boot({ txns: { "2026-08": rows }, now: "2026-08-10" });
      return { text: el("actionText").textContent, tone: el("actionCard").className };
    };
    const row = (id, dir, amount, cat) =>
      ({ id, date: "2026-08-05", dir, amount, cat: cat || "",
         desc: dir === "in" ? "FASTER PAYMENTS RECEIPT REF.STRIPE FROM Stripe Payments UK Ltd"
                            : "CARD PAYMENT TO SOMEWHERE UNKNOWN ON 04-08-2026",
         src: dir === "in" ? "stripe" : "", km: "", hash: id });

    // a down month outranks everything, even an uncategorised row
    const down = await act([row("i", "in", 100), row("o", "out", 900)]);
    assert.strictEqual(down.text, "Hold non-essential spend");
    assert.ok(/stop/.test(down.tone));
    // otherwise, anything uncategorised comes first
    const blank = await act([row("i", "in", 5000), row("o", "out", 100)]);
    assert.strictEqual(blank.text, "Categorise this month");
    assert.ok(/warn/.test(blank.tone));
    // all categorised but a thin cushion
    const thin = await act([row("i", "in", 1000), row("o", "out", 100, "Marketing")]);
    assert.strictEqual(thin.text, "Keep a close eye on spend");
    // all categorised and clear of the buffer
    const clear = await act([row("i", "in", 5000), row("o", "out", 100, "Marketing")]);
    assert.strictEqual(clear.text, "In good shape — keep going");
    assert.ok(/calm/.test(clear.tone));
    pass++; console.log("  ok the one cashflow action follows the sheet's precedence");
  }

  /* --- an edit is never written to the wrong month --- */
  {
    // Change a category, then switch month before the 600ms save fires. The edit must
    // still land in the month it was made in.
    const jul = [{ id: "j1", date: "2026-07-10", dir: "out", amount: 90, desc: "CARD PAYMENT TO UNKNOWN SHOP ON 09-07-2026", cat: "", km: "", hash: "j1" }];
    const aug = [{ id: "g1", date: "2026-08-10", dir: "out", amount: 40, desc: "CARD PAYMENT TO OTHER SHOP ON 09-08-2026", cat: "", km: "", hash: "g1" }];
    const { ctx, S, store, el } = await boot({ txns: { "2026-07": jul, "2026-08": aug }, now: "2026-08-15" });
    assert.strictEqual(S.ym, "2026-08");
    // go to July, edit there
    el("monthSel").value = "2026-07";
    await el("monthSel").onchange();
    assert.strictEqual(S.ym, "2026-07");
    S.rows.find((r) => r.id === "j1").cat = "Retail";
    const p = ctx.onCellChange({ dataset: { id: "j1", f: "cat" }, value: "Retail", classList: { toggle() {} } });
    // ...and immediately jump back to August, inside the debounce window
    el("monthSel").value = "2026-08";
    await el("monthSel").onchange();
    await p;
    await new Promise((r) => setTimeout(r, 700));
    assert.strictEqual(store.txns["2026-07"][0].cat, "Retail", "the July edit was saved to July");
    assert.strictEqual(store.txns["2026-08"][0].cat, "", "and August was not overwritten with July's rows");
    assert.strictEqual(store.txns["2026-08"].length, 1);
    pass++; console.log("  ok an edit is saved to the month it was made in, even if you switch away");
  }

  /* --- an empty account opens on Import rather than an empty cockpit --- */
  {
    const { ctx, S, el } = await boot({ txns: {}, now: "2026-08-10" });
    assert.strictEqual(S.view, "import", "with nothing imported, the page opens where the work starts");
    assert.strictEqual(el("v-cockpit").hidden, true);
    assert.strictEqual(el("v-import").hidden, false);
    pass++; console.log("  ok an empty account opens on Import");
  }

  /* --- the wizard asks once per MERCHANT, not once per row --- */
  {
    // Six unknown payments, but only two merchants — so two questions, not six.
    const mk = (id, d, amt, desc) => ({ id, date: d, dir: "out", amount: amt, desc, cat: "", km: "", hash: id });
    const rows = [
      mk("w1", "2026-08-02", 13, "CARD PAYMENT TO WEIRD SHOP ON 01-08-2026"),
      mk("w2", "2026-08-09", 13, "CARD PAYMENT TO WEIRD SHOP ON 08-08-2026"),
      mk("w3", "2026-08-16", 13, "CARD PAYMENT TO WEIRD SHOP ON 15-08-2026"),
      mk("w4", "2026-08-03", 40, "CARD PAYMENT TO OTHER PLACE ON 02-08-2026"),
      mk("w5", "2026-08-10", 40, "CARD PAYMENT TO OTHER PLACE ON 09-08-2026"),
      mk("w6", "2026-08-11", 99, "CARD PAYMENT TO ONE OFF THING ON 10-08-2026"),
    ];
    const { ctx, S, WZ, el, store } = await boot({ txns: { "2026-08": rows }, now: "2026-08-20" });
    const groups = ctx.unknownGroups(S.rows);
    assert.strictEqual(groups.length, 3, "six unknown rows collapse to three merchants");
    assert.strictEqual(groups[0].merchant, "ONE OFF THING", "dearest first — £99 leads");
    assert.strictEqual(groups[1].merchant, "OTHER PLACE", "then £80 across two payments");
    assert.strictEqual(groups[2].merchant, "WEIRD SHOP", "then £39 across three payments");
    assert.strictEqual(groups[2].rows.length, 3);
    assert.strictEqual(groups[2].total, 39);
    pass++; console.log("  ok the wizard asks once per merchant, dearest first");

    // answering one question categorises every row behind it, and saves a rule
    let finished = null;
    ctx.openWizard(S.rows, (n) => { finished = n; });
    assert.strictEqual(el("wzBack").hidden, false, "the wizard opens");
    WZ.i = 2;                    // stand on the WEIRD SHOP question
    WZ.cat = "Software"; WZ.km = "Can Cut";
    ctx.applyWizard();
    assert.strictEqual(S.rows.filter((r) => r.cat === "Software").length, 3,
      "one answer categorised all three WEIRD SHOP payments");
    assert.ok(S.rules.some((r) => r.match === "WEIRD SHOP" && r.cat === "Software" && r.km === "Can Cut"),
      "and saved it as a rule so it is never asked again");
    ctx.closeWizard();
    assert.strictEqual(el("wzBack").hidden, true, "and it closes");
    assert.strictEqual(finished, 1, "reporting how many were sorted");
    pass++; console.log("  ok one answer categorises every payment behind it, and is remembered");
  }

  /* --- the sort button only appears when there is something to sort --- */
  {
    const clean = [{ id: "c1", date: "2026-08-02", dir: "out", amount: 10,
      desc: "CARD PAYMENT TO FACEBK ON 01-08-2026", cat: "Marketing", km: "Essential", hash: "c1" }];
    const { ctx, el } = await boot({ txns: { "2026-08": clean }, now: "2026-08-20" });
    ctx.setView("txns");
    assert.strictEqual(el("sortBtn").hidden, true, "nothing to sort, no button");
    pass++; console.log("  ok the sort button hides itself when there is nothing to do");
  }

  /* --- the report --- */
  {
    const rows = [
      { id: "r1", date: "2026-08-02", dir: "in",  amount: 5000, desc: "FASTER PAYMENTS RECEIPT REF.STRIPE FROM Stripe Payments UK Ltd", src: "stripe", cat: "", km: "", hash: "r1" },
      { id: "r2", date: "2026-08-03", dir: "out", amount:  600, desc: "CARD PAYMENT TO FACEBK ON 02-08-2026", cat: "Marketing", km: "Essential", hash: "r2" },
      { id: "r3", date: "2026-08-04", dir: "out", amount:   13, desc: "CARD PAYMENT TO CANVA ON 03-08-2026", cat: "Software", km: "Can Cut", hash: "r3" },
      { id: "r4", date: "2026-08-18", dir: "out", amount:   13, desc: "CARD PAYMENT TO CANVA ON 17-08-2026", cat: "Software", km: "Can Cut", hash: "r4" },
      { id: "r5", date: "2026-08-05", dir: "out", amount:  900, desc: "TRANSFER TO BODYSCULPT TRANSFORMATION CENTRES LTD", cat: "Transfer", km: "", hash: "r5" },
    ];
    const { ctx, el } = await boot({ txns: { "2026-08": rows }, now: "2026-08-20" });
    ctx.setView("report");
    await new Promise((r) => setTimeout(r, 30));
    const plain = await ctx.buildReport(false);
    assert.ok(plain.includes("£5,000"), "income is in there");
    assert.ok(plain.includes("£626"), "spending is 600+13+13 and excludes the £900 pot move");
    assert.ok(!plain.includes("£1,526"), "the pot move is never counted as spending");
    assert.ok(/REGULAR PAYMENTS/.test(plain), "recurring charges get their own section");
    assert.ok(/CANVA/.test(plain), "and the twice-monthly Canva charge is named in it");
    assert.ok(/Can Cut/.test(plain), "the discretionary split is shown");

    const forClaude = await ctx.buildReport(true);
    assert.ok(/stop paying for/.test(forClaude), "the Claude version leads with the ask");
    assert.ok(forClaude.indexOf("stop paying for") < forClaude.indexOf("BODYSCULPT WARRINGTON"),
      "and the ask comes BEFORE the figures, so it is not buried");
    assert.ok(forClaude.length > plain.length, "it is the plain report plus the brief");
    pass++; console.log("  ok the report is built for cutting cost, and never counts a pot move as spend");
  }

  console.log("v122 finances: " + pass + " checks passed");
})();
