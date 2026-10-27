// v265: the Debts tab — "I want to pay every business debt off, in the right order, and I
// want this tab to make me do it."
//
// Runs the page's own debt engine against transactions shaped like Ash's statements, and
// the real kpi-store handler against a fake blob store. The acceptance checks from the
// brief are pinned here: payments vs borrowing, bounced pairs, FlexiPay plans vs the term
// loan, the advisor's working, the Capital on Tap projection, and "nothing invented".
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
console.log("v265 debts:");

ok("Capital on Tap: DDs are payments, receipts are borrowing, and only entries after the statement move the balance", () => {
  const s = st(), L = J(s.L.cot);
  assert.deepStrictEqual(L.filter((e) => e.type === "payment").map((e) => e.amount), [-517.14, -800.42]);
  assert.deepStrictEqual(L.filter((e) => e.type === "borrowing").map((e) => e.amount), [2090.74, 851.2, 1200]);
  assert.strictEqual(s.info.cot.bal, 8403.75, "8,004.17 − 800.42 + 1,200 — September is history");
});

ok("NEW BORROWING is flagged for September and October", () => {
  const html = run("debtAlarmsHtml(debtState())");
  assert.ok(html.includes("NEW BORROWING — Oct 2026") && html.includes("NEW BORROWING — Sep 2026"));
});

ok("the May reversals are bounced payments on HMRC, FlexiPay and the term loan", () => {
  const s = st();
  for (const id of ["hmrc", "flexi", "fcloan"]) assert.ok(J(s.L[id]).some((e) => e.bounced && e.amount < 0), id + " shows a bounce");
  assert.ok(!J(s.L.hmrc).some((e) => e.amount === -999), "a row deleted for another reason is not a payment");
  assert.ok(run("debtAlarmsHtml(debtState())").includes("NO PAYMENT SINCE 28/05/2026"));
});

ok("6PMT34X is a FlexiPay plan with 2 left — not the term loan", () => {
  const s = st();
  assert.ok(!J(s.L.fcloan).some((e) => /6PMT34X/.test(e.desc)));
  assert.ok(J(s.L.fcloan).some((e) => /6BP27PA/.test(e.desc) && e.date === "2026-10-23"));
  assert.strictEqual(J(s.info.flexi.plans).find((p) => p.ref === "6PMT34X").left, 2);
  assert.strictEqual(s.info.flexi.bal, 858.29);
});

ok("a payment to an unseen FlexiPay reference after the opening date is a new plan and new borrowing", () => {
  ctx.__extra = R("2026-11-05", "out", 50, "DIRECT DEBIT PAYMENT TO FUNDING CIRCLE REF NEWREF1, MANDATE NO 0099");
  const L = J(run("debtLedgers(S.debtDoc, S.debtRows.concat([__extra]), '2026-11-06').flexi"));
  const b = L.find((e) => e.newPlan === "NEWREF1");
  assert.ok(b && b.type === "borrowing" && b.amount === 150, "3 × £50 borrowed");
});

ok("nothing is invented: a debt with no opening figure has no balance and is left out of projections", () => {
  const s = st();
  for (const id of ["fcloan", "sanloan", "neil", "hmrc", "very"]) assert.strictEqual(s.info[id].bal, null, id);
  assert.deepStrictEqual(J(s.states).map((x) => x.d.id).sort(), ["cot", "flexi"]);
  const html = run("debtWaterfallHtml(debtState())");
  assert.ok((html.match(/enter from statement/g) || []).length >= 5);
});

ok("Capital on Tap from ~£8,400 at £1,200: Jul 2027, ~£1,525; minimum-only ~44 months, ~£4,450", () => {
  const p = J(run(`(() => { const d = S.debtDoc.debts.find((x) => x.id === "cot");
    return { fix: debtProject([{ d, bal: 8400, plans: [] }], "plan", 0, [], "2026-10"),
             min: debtProject([{ d, bal: 8400, plans: [] }], "min", 0, [], "2026-10") }; })()`));
  assert.strictEqual(p.fix.clears.cot, "2027-07");
  assert.ok(Math.abs(p.fix.interest - 1500) < 100, "interest " + p.fix.interest);
  assert.ok(Math.abs(p.min.months.length - 44) <= 1, "months " + p.min.months.length);
  assert.ok(Math.abs(p.min.interest - 4450) < 150, "interest " + p.min.interest);
});

ok("Neil is 0% and never overpaid, even dragged to the top of the order", () => {
  run(`S.debtDoc.debts.find((d) => d.id === "neil").opening = { amount: 5000, date: "2026-10-01" };
       S.debtDoc.settings.order = ["neil", "cot", "flexi"];`);
  assert.ok(!run("debtOrder(S.debtDoc)").includes("neil"));
  const p = J(run(`(() => { const d = S.debtDoc.debts.find((x) => x.id === "neil");
    return debtProject([{ d, bal: 5000, plans: [] }], "roll", 3000, ["neil"], "2026-10"); })()`));
  assert.strictEqual(p.months.length, 5, "£1,000 a month, extras refused");
  run(`S.debtDoc.debts.find((d) => d.id === "neil").opening = { amount: null, date: null }; S.debtDoc.settings.order = [];`);
});

ok("the advisor shows its working: bank − due in 14 days − tax pot share − floor", () => {
  run(`S.debtDoc.settings.bank = { amount: 9000, date: "2026-10-27", source: "import" };`);
  const a = J(run("debtAdvisor(S.debtDoc, S.debtRows, debtState().L, '2026-10-27', S.settings)"));
  assert.ok(a.committed.some((c) => c.what === "PTS PROPERTY LTD" && c.date === "2026-10-28"), "rent on the 28th is due");
  assert.ok(a.committed.some((c) => c.what === "Neil Beresford buyout"), "Neil is due on the 27th");
  assert.ok(!a.committed.some((c) => c.what === "NEIL BERESFORD"), "…once, as a debt, not again as a regular payment");
  assert.strictEqual(a.since, "2026-10-20", "the last pot move");
  assert.strictEqual(a.taxRing, 180, "15% of £1,200 taken since");
  assert.strictEqual(Math.round(a.x * 100) / 100, Math.round((9000 - a.committedTotal - 180 - 2500) * 100) / 100);
  assert.strictEqual(a.target.id, "cot", "extra goes to the dearest debt");
});

ok("an 'I paid £___' waits, then drops out when the bank line arrives", () => {
  run(`S.debtDoc.manual = [{ id: "m1", debtId: "cot", date: "2026-10-15", type: "payment", amount: 800.42, pending: true }];`);
  assert.ok(!J(run("debtState().L.cot")).some((e) => e.id === "m1"), "matched by the 16/10 DD");
  run(`S.debtDoc.manual = [{ id: "m2", debtId: "cot", date: "2026-10-26", type: "payment", amount: 300, pending: true }];`);
  assert.ok(J(run("debtState().L.cot")).some((e) => e.id === "m2" && e.amount === -300), "unmatched — still counts");
  run(`S.debtDoc.manual = [];`);
});

ok("re-tagging gives debt payments their category, keeps the old one, and can take it back", () => {
  ctx.__copy = ROWS.map((r) => ({ ...r }));
  run("debtRetagRows(__copy, S.debtDoc.debts)");
  const neil = J(ctx.__copy).find((r) => /NEIL/.test(r.desc));
  assert.strictEqual(neil.cat, "Debt: Neil buyout");
  assert.strictEqual(neil.note, "Category before the Debts tab: Owners Pay");
  assert.strictEqual(J(ctx.__copy).find((r) => /FROM CAPITAL ON TAP/.test(r.desc)).cat, "Directors loan", "credits keep theirs");
  run(`S.debtDoc.debts.find((d) => d.id === "neil").payMatch = ["NOBODY"]; debtRetagRows(__copy, S.debtDoc.debts);`);
  assert.strictEqual(J(ctx.__copy).find((r) => /NEIL/.test(r.desc)).cat, "Owners Pay", "put back");
  run(`S.debtDoc.debts.find((d) => d.id === "neil").payMatch = ["NEIL BERESFORD"];`);
});

ok("debt repayments are their own line, like tax", () => {
  const rows = [{ dir: "in", amount: 1000, cat: "" }, { dir: "out", amount: 100, cat: "Rent" },
    { dir: "out", amount: 50, cat: "Tax" }, { dir: "out", amount: 30, cat: "Debt: HMRC" }];
  ctx.__r2 = rows;
  assert.strictEqual(run("debtOut(__r2)"), 30);
  const f = J(run("yearFigures(['2026-10'], { '2026-10': __r2 })"));
  assert.strictEqual(f.ytdDebt, 30);
  assert.strictEqual(f.ytdIn - f.ytdOut + f.ytdTax + f.ytdDebt, 900, "net before tax & debts");
});

ok("the 4% pot is the Debt pot while a debt costs more than 10% a year", () => {
  assert.strictEqual(run("potInvName()"), "Debt pot");
});

// ---------- the store ----------
function fakeStore() {
  const m = new Map();
  return { _m: m, async get(k, o) { const v = m.get(k); if (v === undefined) return null; return o && o.type === "json" ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, v); }, async list() { return { blobs: [], directories: [] }; } };
}
(async () => {
  const SRC = path.join(__dirname, "..", "netlify", "functions", "kpi-store.js");
  const code = fs.readFileSync(SRC, "utf8").replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => globalThis.__fakeStore;");
  const tmp = path.join(os.tmpdir(), "kpi-store-v265-" + process.pid + ".mjs");
  fs.writeFileSync(tmp, code);
  const h = (await import("file://" + tmp)).default; fs.unlinkSync(tmp);
  globalThis.__fakeStore = fakeStore();
  const GET = (qs) => h(new Request("https://x/?" + qs));
  const POST = (b) => h(new Request("https://x/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }));

  assert.strictEqual((await (await GET("findebts=1")).json()).doc, null, "nothing saved → the page seeds it");
  const seed = J(run("DEBT_SEED"));
  seed.debts[0].sneaky = "dropped"; seed.manual.push({ id: "x", debtId: "nope", date: "2026-10-01", type: "payment", amount: 1 });
  const saved = (await (await POST({ finDebts: seed })).json()).doc;
  assert.ok(!("sneaky" in saved.debts[0]), "unknown fields are dropped");
  assert.strictEqual(saved.manual.length, 0, "an entry for a debt that does not exist is dropped");
  assert.strictEqual(saved.debts.find((d) => d.id === "hmrc").opening.amount, null, "a missing figure stays null, never 0");
  assert.strictEqual(saved.debts.find((d) => d.id === "flexi").plans.length, 4);
  await POST({ finDebts: { ...saved, settings: { ...saved.settings, floor: 3000 } } });
  const raw = JSON.parse(globalThis.__fakeStore._m.get("finance-debts"));
  assert.strictEqual(raw.current.settings.floor, 3000);
  assert.strictEqual(raw.previous.settings.floor, 2500, "the version before is kept");
  pass++; console.log("  ok the store whitelists the document and keeps one step back");
  console.log(pass + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
