// v226 — upfront memberships get their own box, and the bank statement is checked for
// anyone who paid straight into the bank.
//
// Ash: "Should upfront payments really be under recurring???" — no: several months paid at
// once is not monthly subscription money. "Is there a way to upload my bank statement and
// for the website to pull any upfront payments from it?" — the statement he already uploads
// on the Finances page is read by the takings review. Trial revenue stays the 6 weeks only.
//
// Pinned here:
//   1. THE SORT — trial first, then upfront ("upfront", "12 for 10", "10 for £999"), else recurring.
//   2. CHARGED counts the new box everywhere it is worked out.
//   3. THE BANK CHECK — only money in from a person; payouts, own transfers, loans left out;
//      a mark adds to the right box and un-marking takes it back off; marks save with the month.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.join(__dirname, "..");
const M = fs.readFileSync(path.join(ROOT, "monthly.html"), "utf8");

(async () => {
  const L = await import(path.join(ROOT, "netlify/lib/takings.js"));
  /* 1. the sort */
  const k = L.kindOf;
  assert.strictEqual(k("6 Week Challenge"), "trial");
  assert.strictEqual(k("6-Week Challenge Referral"), "trial");
  assert.strictEqual(k("12 FOR 10 UPFRONT - 3 PW"), "upfront");
  assert.strictEqual(k("BF - 10 for £999"), "upfront");
  assert.strictEqual(k("Upfront 6 months"), "upfront");
  assert.strictEqual(k("02. 12 Coaching Sessions + Classes"), "recurring", "'12 Coaching Sessions' is not '12 for 10'");
  assert.strictEqual(k("03. 8 Coaching Sessions + Classes"), "recurring");
  assert.strictEqual(k("Membership - 199"), "recurring");
  assert.strictEqual(k("6 week upfront"), "trial", "trial wins");
  const { fields } = L.combine(
    { ok: true, recurring: 100, trial: 50, upfront: 685.5, fees: 3 },
    { ok: true, recurring: 20, fees: 1 }, { ok: true, other: 10, fees: 0.5, feesKnown: true });
  assert.deepStrictEqual(fields, { recurringRev: 120, trialRev: 50, upfrontRev: 685.5, otherRev: 10, processingFees: 4.5 });
  assert.strictEqual(L.combine({ ok: false, error: "x" }, { ok: true, recurring: 1, fees: 0 }, { ok: true, other: 0, fees: 0, feesKnown: true }).fields.upfrontRev, null);

  /* 2. Charged counts it */
  assert.ok(/case "charged": \{[\s\S]*?u=g\("upfrontRev"\)[\s\S]*?return n\(r\) \+ n\(t\) \+ n\(u\) \+ n\(o\);/.test(M), "computed charged");
  assert.ok(/const charged = recRev \+ trialRev \+ upRev \+ otherRev;/.test(M), "live charged in the panel");
  assert.ok(/id="m_upfrontRev"/.test(M) && /upfrontRev:"m_upfrontRev"/.test(M) && /MONEY_FIELDS = \["recurringRev","trialRev","upfrontRev"/.test(M));
  assert.ok(/\["m_recurringRev","m_trialRev","m_upfrontRev"/.test(M), "typing in it recalculates");
  assert.ok(/\["Revenue","Upfront Memberships", aMan\("upfrontRev"\)/.test(M), "a KPI tile");
  assert.ok(/rec\.bankPicks = Object\.assign\(\{\}, tkPicks\)/.test(M), "marks save with the month");

  /* 3. the bank check, run for real */
  const block = M.slice(M.indexOf("const TK_FIELDS = ["), M.indexOf("// The 4th-of-the-month run keeps last month's pull."));
  const inputs = {};
  const el = (id) => (inputs[id] = inputs[id] || { value: "", hidden: true, innerHTML: "", textContent: "", addEventListener() {}, querySelectorAll: () => [] });
  const ctx = {
    document: { getElementById: el }, console,
    isNum: (v) => typeof v === "number" && isFinite(v), esc: (x) => String(x), gbp: (v) => "£" + v.toFixed(2),
    ymLabel: (y) => y, updateLiveCalcFields() {}, MONTHREC: { "2026-09": {} }, STORE: "/store", TAKINGS: "/t",
    MONEY_INPUTS: { recurringRev: "m_recurringRev", trialRev: "m_trialRev", upfrontRev: "m_upfrontRev", otherRev: "m_otherRev", processingFees: "m_processingFees" },
    fetch: async (u) => ({ ok: true, json: async () => u.includes("finsettings") ? { settings: { sources: { stripe: "STRIPE", gocardless: "GC C1", sumup: "SUMUP" }, transferKeyword: "BODYSCULPT TRANSFORMATION CENTRES" } } : { rows: [
      { id: "a", date: "2026-09-30", dir: "in", amount: 750, desc: "FASTER PAYMENTS RECEIPT REF.JACKIE MC FROM MCSHANE J" },
      { id: "b", date: "2026-09-30", dir: "in", amount: 821.58, desc: "FASTER PAYMENTS RECEIPT REF.STRIPE FROM STRIPE PAYMENTS UK LTD" },
      { id: "c", date: "2026-09-07", dir: "in", amount: 668.27, desc: "FASTER PAYMENTS RECEIPT REF.BODYSCULPTTR FROM GC C1" },
      { id: "d", date: "2026-09-01", dir: "in", amount: 13.28, desc: "FASTER PAYMENTS RECEIPT FROM SUMUP PAYMENTS ACCOUNT" },
      { id: "e", date: "2026-09-16", dir: "in", amount: 2090.74, desc: "FASTER PAYMENTS RECEIPT FROM CAPITAL ON TAP", cat: "Directors loan" },
      { id: "f", date: "2026-09-28", dir: "in", amount: 1000, desc: "TRANSFER FROM BODYSCULPT TRANSFORMATION CENTRES LTD" },
      { id: "g", date: "2026-09-29", dir: "in", amount: 851.2, desc: "FASTER PAYMENTS RECEIPT FROM CAPITAL ON TAP" },
      { id: "h", date: "2026-09-12", dir: "out", amount: 40, desc: "CARD PAYMENT TO AMAZON" },
      { id: "i", date: "2026-09-13", dir: "in", amount: 99, desc: "DELETED ONE", del: true },
    ] } }),
  };
  vm.createContext(ctx);
  vm.runInContext(block + "\n;this.api={tkApply,tkPick,tkTotals,get bank(){return tkBank},get picks(){return tkPicks}};", ctx);
  const pull = { ok: true, month: "2026-09", fields: { recurringRev: 20046.2, trialRev: 1713, upfrontRev: 685.5, otherRev: 336.5, processingFees: 370.79 }, sources: {} };
  ctx.api.tkApply(pull);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepStrictEqual(ctx.api.bank.rows.map((r) => r.id), ["a"], "only Jackie — not payouts, own transfers, loans, money out or deleted rows");
  assert.strictEqual(ctx.api.bank.to, "2026-09-30");
  ctx.api.tkPick("a", "upfront");
  assert.strictEqual(inputs.m_upfrontRev.value, "1435.50", "Jackie's £750 lands in Upfront");
  assert.strictEqual(inputs.m_recurringRev.value, "20046.20");
  ctx.api.tkPick("a", "monthly");
  assert.strictEqual(inputs.m_upfrontRev.value, "685.50", "moving it takes it back off Upfront");
  assert.strictEqual(inputs.m_recurringRev.value, "20796.20", "…and onto Recurring");
  ctx.api.tkPick("a", "none");
  assert.strictEqual(inputs.m_recurringRev.value, "20046.20", "un-marking takes it off again");
  // a saved mark comes back on the next review
  ctx.MONTHREC["2026-09"].bankPicks = { a: { kind: "upfront", amount: 750, date: "2026-09-30", desc: "JACKIE" } };
  vm.runInContext("tkCur = null;", ctx);
  ctx.api.tkApply(pull);
  assert.strictEqual(inputs.m_upfrontRev.value, "1435.50", "saved marks are put back");
  // a box the pull couldn't fill is left alone, marks and all
  vm.runInContext("tkCur = null;", ctx);
  inputs.m_upfrontRev.value = "42";
  ctx.api.tkApply({ ...pull, fields: { ...pull.fields, upfrontRev: null } });
  assert.strictEqual(inputs.m_upfrontRev.value, "42");
  console.log("v226 upfront + bank: OK");
})().catch((e) => { console.error(e); process.exit(1); });
