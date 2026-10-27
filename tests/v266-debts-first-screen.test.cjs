// v266: the Debts tab answers before it explains, and the cockpit listens to it.
// "The first screen is only three things: the total owed with today's interest cost on one
// line, the advisor's one-line answer, and the single progress bar. Everything else goes
// under one 'Show me everything' expander, collapsed by default." Plus two bugs: the
// cockpit said "Comfortable / keep going" while the advisor was negative and HMRC unpaid,
// and HMRC with no Time to Pay amount projected £4,150,323 of interest.
//
// Same statement-shaped rows as v265.
const assert = require("assert");
const vm = require("vm");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { extract } = require("./lib/extract.cjs");

const src = extract(path.join(__dirname, "..", "finances.html")).replace(/\ninit\(\);\s*$/, "\n");
const RealDate = Date;
const ctx = {
  console, setTimeout, clearTimeout, TextDecoder,
  document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} },
  fetch: () => Promise.reject(new Error("no network in tests")),
  Date: class extends RealDate { constructor(...a) { super(...(a.length ? a : ["2026-10-27T12:00:00"])); } },
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const run = (js) => vm.runInContext(js, ctx);
const J = (x) => JSON.parse(JSON.stringify(x));   // out of the sandbox's realm

let n = 0;
const R = (date, dir, amount, desc, extra) => ({ id: "r" + (++n), hash: "h" + n, date, dir, amount, desc, cat: "", ...(extra || {}) });
const ROWS = [
  // Capital on Tap: history before the 09/10 statement, then one payment and one draw after it
  R("2026-09-16", "out", 517.14, "DIRECT DEBIT PAYMENT TO CAPITAL ON TAP REF H82ZWKP, MANDATE NO 0027", { cat: "Lease" }),
  R("2026-09-16", "in", 2090.74, "FASTER PAYMENTS RECEIPT REF.MTPTOURFJSGD FROM CAPITAL ON TAP", { cat: "Directors loan" }),
  R("2026-09-29", "in", 851.20, "FASTER PAYMENTS RECEIPT REF.MTEQEYXDLNZF FROM CAPITAL ON TAP", { cat: "Directors loan" }),
  R("2026-10-16", "out", 800.42, "DIRECT DEBIT PAYMENT TO CAPITAL ON TAP REF H82ZWKP, MANDATE NO 0027", { cat: "Lease" }),
  R("2026-10-16", "in", 1200, "FASTER PAYMENTS RECEIPT REF.MTEFHZCILNZF FROM CAPITAL ON TAP", { cat: "Directors loan" }),
  // May: bounced pairs, deleted from the totals but still bounces here
  R("2026-05-26", "out", 238.08, "DIRECT DEBIT PAYMENT TO FUNDING CIRCLE REF 6BP27PA, MANDATE NO 0031", { del: true }),
  R("2026-05-26", "in", 238.08, "DIRECT DEBIT REVERSAL REF 6BP27PA, MANDATE NO 0031", { del: true }),
  R("2026-05-27", "out", 241.81, "DIRECT DEBIT PAYMENT TO FUNDING CIRCLE REF ZNZGTWE, MANDATE NO 0076", { del: true }),
  R("2026-05-27", "in", 241.81, "DIRECT DEBIT REVERSAL REF ZNZGTWE, MANDATE NO 0076", { del: true }),
  R("2026-05-27", "out", 900, "DIRECT DEBIT PAYMENT TO HMRC NDDS REF 109123972792399934, MANDATE NO 0067", { del: true }),
  R("2026-05-27", "in", 900, "DIRECT DEBIT REVERSAL REF 109123972792399934, MANDATE NO 0067", { del: true }),
  R("2026-05-28", "out", 260, "DIRECT DEBIT PAYMENT TO HMRC MY-DRS.CO.UK REF A04424537, MANDATE NO 0055"),
  // a row deleted for some other reason is not a debt event
  R("2026-06-02", "out", 999, "DIRECT DEBIT PAYMENT TO HMRC NDDS REF 1, MANDATE NO 0067", { del: true }),
  // Funding Circle: the term loan and FlexiPay plans share a lender
  R("2026-10-23", "out", 238.08, "DIRECT DEBIT PAYMENT TO FUNDING CIRCLE REF 6BP27PA, MANDATE NO 0031"),
  R("2026-10-27", "out", 119.00, "DIRECT DEBIT PAYMENT TO FUNDING CIRCLE REF 6PMT34X, MANDATE NO 0086"),
  R("2026-10-27", "out", 368.53, "DIRECT DEBIT PAYMENT TO FUNDING CIRCLE REF JWT5X3B, MANDATE NO 0084"),
  R("2026-09-28", "out", 1000, "BILL PAYMENT VIA FASTER PAYMENT TO NEIL BERESFORD REFERENCE BODYSCULPT , MANDATE", { cat: "Owners Pay" }),
  // income and a pot move, for the advisor
  R("2026-10-20", "out", 500, "TRANSFER TO BODYSCULPT TRANSFORMATION CENTRES LTD", { cat: "Transfer" }),
  R("2026-10-21", "in", 1000, "FASTER PAYMENTS RECEIPT REF.STRIPE FROM STRIPE PAYMENTS UK LTD", { src: "stripe" }),
  R("2026-10-22", "in", 200, "FASTER PAYMENTS RECEIPT REF.BODYSCULPTTR FROM GC C1", { src: "gocardless" }),
];
// three months of rent on the 28th, so it is "regular"
for (const ym of ["2026-07", "2026-08", "2026-09"]) ROWS.push(R(ym + "-28", "out", 2010, "BILL PAYMENT VIA FASTER PAYMENT TO PTS PROPERTY LTD REFERENCE RENT", { cat: "Rent" }));

ctx.__rows = ROWS;
run(`S.settings = { potTaxPct: 15, potInvestPct: 4, weekStartDow: 4, allocatable: ["stripe","gocardless"],
  transferKeyword: "BODYSCULPT TRANSFORMATION CENTRES",
  sources: { stripe: "STRIPE", gocardless: "GC C1", sumup: "SUMUP", nutraprep: "NUTRAPREP" } };
  S.debtDoc = debtClone(DEBT_SEED); S.debtRows = __rows;`);
const st = () => run("debtState()");

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log("  ok " + name); };
console.log("v266 debts first screen:");
// what the live doc holds: HMRC known, no Time to Pay amount; a bank that cannot cover it
run(`S.debtDoc.debts.find((d) => d.id === "hmrc").opening = { amount: 60548.81, date: "2026-08-31", note: "" };
  S.debtDoc.settings.bank = { amount: 3000, date: "2026-10-27", source: "import" };`);

ok("HMRC with no Time to Pay is not projected — it says so instead of printing millions", () => {
  const s = st();
  assert.ok(J(s.unproj).some((x) => x.d.id === "hmrc"), "HMRC waits for its payment");
  assert.ok(!J(s.states).some((x) => x.d.id === "hmrc"), "…and stays out of the projection");
  assert.ok(s.P.min.interest < 100000, "no runaway interest: " + Math.round(s.P.min.interest));
  const html = run("debtProjectionHtml(debtState())");
  assert.ok(html.includes("Enter Time to Pay to project"));
  assert.ok(/Not until HMRC can be projected/.test(html), "no debt-free date while HMRC is unknown");
  assert.ok(!/£[\d,]{9,}/.test(html), "no seven-figure sums anywhere");
});

ok("…and once a Time to Pay amount is entered, HMRC is projected like any other debt", () => {
  run(`S.debtDoc.debts.find((d) => d.id === "hmrc").hmrc.ttp = { amount: 1200, day: 28, start: "2026-11-01" };`);
  const s = st();
  assert.ok(J(s.states).some((x) => x.d.id === "hmrc") && !s.unproj.length);
  assert.ok(!run("debtProjectionHtml(debtState())").includes("Enter Time to Pay"));
  run(`S.debtDoc.debts.find((d) => d.id === "hmrc").hmrc.ttp = { amount: null, day: null, start: null };`);
});

ok("the first screen is three things; everything else is behind one closed expander", () => {
  const root = { innerHTML: "" };
  const g = ctx.document.getElementById;
  ctx.document.getElementById = (id) => (id === "debtsRoot" ? root : null);
  try { run("renderDebts()"); } finally { ctx.document.getElementById = g; }
  const html = root.innerHTML;
  const [first, rest] = html.split('<details class="dl-all"');
  assert.ok(rest, "the expander is there");
  assert.ok(/<details class="dl-all" data-open="all">/.test(html), "…and closed by default");
  assert.ok(/<summary>Show me everything<\/summary>/.test(html));
  assert.ok(/You owe/.test(first) && /a day<\/b>/.test(first), "total owed with what interest costs a day");
  assert.ok(/Don.t pay anything extra today\./.test(first), "the advisor's answer, in plain words");
  assert.ok(!/dlFloor|dlPaid|Funding Circle term loan/.test(first), "no inputs or missing-figure lists up top");
  assert.ok(/dl-bar big/.test(first), "the progress bar");
  assert.ok(/How is this worked out\?/.test(first) && /<details class="dl-det" data-open="how">/.test(first), "the sum is behind a closed tap");
  for (const k of ["dl-alarm", "The order", "When it is all gone", "Milestones", "Month in review", "dl-chart", "dlWhatIf", "Interest saved"])
    assert.ok(!first.includes(k), k + " is not on the first screen");
});

ok("only this month's problems are banners; May's bounces live in the month in review", () => {
  const al = run("debtAlarmsHtml(debtState())");
  assert.ok(!al.includes("PAYMENT BOUNCED"), "May is not this month");
  assert.ok(al.includes("NO PAYMENT SINCE 28/05/2026"), "an HMRC gap is a problem today");
  const rev = run("debtReviewHtml(debtState())");
  assert.ok(rev.includes("May 2026") && rev.includes("HMRC £900.00 bounced on 27/05/2026"));
});

ok("the cockpit takes the advisor's answer: short of cash is never Comfortable", () => {
  run(`S.ym = "2026-10"; S.settings.cashBuffer = 2000;`);
  const dc = J(run("debtCashCheck()"));
  assert.ok(dc.short && dc.x < 0, "the advisor is negative");
  assert.strictEqual(dc.hmrc, "28/05/2026");
  assert.strictEqual(J(run("cashStatus(9000, debtCashCheck())")).word, "Protect cash");
  const act = J(run("cashflowAction(9000, 0, debtCashCheck())"));
  assert.ok(!/keep going/.test(act.text) && act.tone === "stop");
  assert.ok(/HMRC has had nothing since 28\/05\/2026/.test(act.why));
});

ok("…an HMRC gap alone is not Comfortable either", () => {
  run(`S.debtDoc.settings.bank = { amount: 90000, date: "2026-10-27", source: "manual" };`);
  const dc = J(run("debtCashCheck()"));
  assert.ok(!dc.short && dc.hmrc);
  assert.strictEqual(J(run("cashStatus(9000, debtCashCheck())")).word, "Tight");
  assert.strictEqual(J(run("cashflowAction(9000, 0, debtCashCheck())")).text, "Sort HMRC's Time to Pay");
});

ok("a past month on the cockpit is judged on its own numbers, as before", () => {
  run(`S.ym = "2026-08";`);
  assert.strictEqual(run("debtCashCheck()"), null);
  assert.strictEqual(J(run("cashStatus(9000, debtCashCheck())")).word, "Comfortable");
});

console.log(pass + " passed");
