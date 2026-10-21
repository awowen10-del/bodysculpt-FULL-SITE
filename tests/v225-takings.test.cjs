// v225 — the month's takings, pulled from Stripe, GoCardless and SumUp.
//
// Ash: "I collect 4 revenue numbers; Charged Revenue, Recurring revenue, Trial revenue and
// finally revenue [banked] ... We collect money via Sumup, Stripe & GoCardless. Surely
// there's a way for you to pull these in with a button."
// His rules: GoCardless ONLY takes recurring; Stripe takes recurring AND trial, told apart by
// the payment's name ("6 week", "6-week" or "referral"); SumUp is only extra income (meal
// prep); refunds come off the month they're refunded in.
//
// Pinned here:
//   1. THE MONTH is the UK month — BST and GMT boundaries both.
//   2. THE SORT — names, refunds by refund date, lost chargebacks, fees from all three.
//   3. A BOX IS ONLY FILLED WHEN EVERY SOURCE IT NEEDS ANSWERED.
//   4. THE PAGE fills the boxes and never saves; "Put back" is on the review itself.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const SEP = { start: Date.UTC(2026, 7, 31, 23), end: Date.UTC(2026, 8, 30, 23) };
const u = (ms) => Math.floor(ms / 1000);
const inv = (desc) => ({ object: "invoice", lines: { data: [{ description: desc }] } });

function world() {
  const calls = [];
  const charges = [
    { id: "ch_1", status: "succeeded", paid: true, currency: "gbp", amount: 4500, invoice: inv("1 × Unlimited Membership (at £45.00 / month)"), balance_transaction: { fee: 90 } },
    { id: "ch_2", status: "succeeded", paid: true, currency: "gbp", amount: 4500, invoice: inv("1 × Unlimited Membership (at £45.00 / month)"), balance_transaction: { fee: 90 } },
    { id: "ch_3", status: "succeeded", paid: true, currency: "gbp", amount: 9900, description: "6 Week Challenge", invoice: null, balance_transaction: { fee: 180 } },
    { id: "ch_4", status: "succeeded", paid: true, currency: "gbp", amount: 4900, description: "Referral offer", balance_transaction: { fee: 100 } },
    { id: "ch_5", status: "succeeded", paid: true, currency: "gbp", amount: 9900, invoice: inv("1 × 6-week transformation"), balance_transaction: { fee: 180 } },
    { id: "ch_6", status: "failed", paid: false, currency: "gbp", amount: 4500, description: "Unlimited Membership" },
  ];
  const refunds = [
    // a trial paid in AUGUST, refunded in September — comes off September's trials
    { id: "re_1", status: "succeeded", currency: "gbp", amount: 9900, charge: { description: "6 WEEK challenge" }, balance_transaction: { fee: 0 } },
  ];
  const disputes = [
    { id: "dp_1", status: "lost", amount: 4500, charge: { invoice: inv("Unlimited Membership") } },
    { id: "dp_2", status: "needs_response", amount: 4500, charge: { description: "x" } },
  ];
  const stripeFees = [{ id: "txn_f", type: "stripe_fee", amount: -250 }];

  const gcPayments = [
    { id: "PM1", status: "paid_out", amount: 3500, currency: "GBP" },
    { id: "PM2", status: "confirmed", amount: 3500, currency: "GBP" },
    { id: "PM3", status: "submitted", amount: 3500, currency: "GBP" },
    { id: "PM4", status: "failed", amount: 3500, currency: "GBP" },
    { id: "PM5", status: "charged_back", amount: 3500, currency: "GBP" },
  ];
  const gcItems = {
    PO1: [
      { type: "payment_paid_out", amount: "3500.0", links: { payment: "PM1" } },
      { type: "gocardless_fee", amount: "-60.0", links: { payment: "PM1" } },
      { type: "payment_paid_out", amount: "3500.0", links: { payment: "PMAUG" } },
      { type: "gocardless_fee", amount: "-60.0", links: { payment: "PMAUG" } },   // August's — not ours
    ],
    PO2: [
      { type: "payment_paid_out", amount: "3500.0", links: { payment: "PM2" } },
      { type: "gocardless_fee", amount: "-60.0", links: { payment: "PM2" } },
      { type: "app_fee", amount: "-10.0", links: { payment: "PM2" } },
    ],
  };
  const sumupItems = [
    { transaction_code: "T1", amount: 12.5, currency: "GBP", status: "SUCCESSFUL", type: "PAYMENT" },
    { transaction_code: "T2", amount: 30.0, currency: "GBP", status: "SUCCESSFUL", type: "PAYMENT" },
    { transaction_code: "T3", amount: 8.0, currency: "GBP", status: "FAILED", type: "PAYMENT" },
    { transaction_code: "T4", amount: 5.0, currency: "GBP", status: "SUCCESSFUL", type: "REFUND" },
  ];
  const sumupFin = [{ transaction_code: "T1", fee_amount: 0.21 }, { transaction_code: "T2", fee_amount: 0.51 }, { transaction_code: "TOTHER", fee_amount: 9 }];

  const page = (arr, params) => {
    // Stripe pagination: 2 per page, to exercise has_more
    const after = params.get("starting_after");
    const i = after ? arr.findIndex((x) => x.id === after) + 1 : 0;
    const data = arr.slice(i, i + 2);
    return { data, has_more: i + 2 < arr.length };
  };
  const fx = async (url) => {
    const U = new URL(url);
    calls.push(U);
    const P = U.searchParams;
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (U.host === "api.stripe.com") {
      assert.strictEqual(P.get("created[gte]"), String(u(SEP.start)), "Stripe window starts at UK midnight 1 Sept");
      assert.strictEqual(P.get("created[lt]"), String(u(SEP.end)), "Stripe window ends at UK midnight 1 Oct");
      if (U.pathname === "/v1/charges") return ok(page(charges, P));
      if (U.pathname === "/v1/refunds") return ok(page(refunds, P));
      if (U.pathname === "/v1/disputes") return ok(page(disputes, P));
      if (U.pathname === "/v1/balance_transactions") { assert.strictEqual(P.get("type"), "stripe_fee"); return ok(page(stripeFees, P)); }
    }
    if (U.host === "api.gocardless.com") {
      if (U.pathname === "/payments") {
        assert.strictEqual(P.get("charge_date[gte]"), "2026-09-01");
        assert.strictEqual(P.get("charge_date[lte]"), "2026-09-30");
        // cursor pagination: first 3, then the rest
        if (!P.get("after")) return ok({ payments: gcPayments.slice(0, 3), meta: { cursors: { after: "c1" } } });
        return ok({ payments: gcPayments.slice(3), meta: { cursors: { after: null } } });
      }
      if (U.pathname === "/refunds") return ok({ refunds: [{ id: "RF1", amount: 3500, status: "paid" }, { id: "RF2", amount: 100, status: "failed" }], meta: { cursors: {} } });
      if (U.pathname === "/payouts") return ok({ payouts: [{ id: "PO1" }, { id: "PO2" }], meta: { cursors: {} } });
      if (U.pathname === "/payout_items") return ok({ payout_items: gcItems[P.get("payout")] || [], meta: { cursors: {} } });
    }
    if (U.host === "api.sumup.com") {
      if (U.pathname === "/v0.1/me/transactions/history") {
        if (!P.get("oldest_ref")) return ok({ items: sumupItems.slice(0, 2), links: [{ rel: "next", href: "limit=100&oldest_ref=T2" }] });
        return ok({ items: sumupItems.slice(2), links: [] });
      }
      if (U.pathname === "/v0.1/me/financials/transactions") return ok(sumupFin);
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: "no route " + url } }) };
  };
  return { fx, calls };
}

(async () => {
  const L = await import(path.join(ROOT, "netlify/lib/takings.js"));
  const ENV = { STRIPE_SECRET_KEY: "rk_live_x", GOCARDLESS_ACCESS_TOKEN: "live_x", SUMUP_API_KEY: "sk_live_x" };
  const NOW = Date.UTC(2026, 9, 21, 9);

  /* 1. the UK month */
  const sep = L.monthBounds("2026-09");
  assert.strictEqual(sep.startMs, SEP.start, "September starts 23:00 UTC 31 Aug (BST)");
  assert.strictEqual(sep.endMs, SEP.end);
  const nov = L.monthBounds("2026-11");
  assert.strictEqual(nov.startMs, Date.UTC(2026, 10, 1, 0), "November starts at midnight UTC (GMT)");
  assert.strictEqual(L.monthBounds("2026-12").endMs, Date.UTC(2027, 0, 1, 0), "December rolls into the next year");
  assert.strictEqual(L.monthBounds("2026-13"), null);
  assert.strictEqual(L.lastMonthOf(new Date(Date.UTC(2026, 9, 4, 6))), "2026-09");
  assert.strictEqual(L.lastMonthOf(new Date(Date.UTC(2027, 0, 4, 6))), "2026-12");

  /* 2. names */
  for (const n of ["6 Week Challenge", "6-week", "6-Week Challenge", "6 weeks", "6week", "Referral offer", "REFERRAL"]) assert.ok(L.isTrialName(n), n);
  for (const n of ["Unlimited Membership", "16 week plan", "26-weeks", "", null]) assert.ok(!L.isTrialName(n), String(n));

  /* 3. a whole month */
  const w = world();
  const pull = await L.pullMonth("2026-09", ENV, w.fx, NOW);
  assert.ok(pull.ok);
  const st = pull.sources.stripe, gc = pull.sources.gocardless, su = pull.sources.sumup;
  assert.ok(st.ok, st.error); assert.ok(gc.ok, gc.error); assert.ok(su.ok, su.error);
  // Stripe: memberships 45+45, trials 99+49+99, failed ignored; refund of an August trial
  // (99) and a lost chargeback on a membership (45) come off September.
  assert.deepStrictEqual(st.gross, { recurring: 90, trial: 247 });
  assert.deepStrictEqual(st.refunds, { recurring: 45, trial: 99 });
  assert.strictEqual(st.recurring, 45); assert.strictEqual(st.trial, 148);
  assert.strictEqual(st.trialCount, 3);
  assert.strictEqual(st.fees, (90 + 90 + 180 + 100 + 180 + 250) / 100, "charge fees + Stripe's own bills");
  assert.ok(st.names.some((n) => n.name === "Unlimited Membership" && n.kind === "recurring" && n.count === 2), "invoice line, tidied");
  // GoCardless: paid_out + confirmed + submitted; failed and charged-back left out; refund off
  assert.strictEqual(gc.gross, 105); assert.strictEqual(gc.refunds, 35); assert.strictEqual(gc.recurring, 70);
  assert.strictEqual(gc.fees, 1.3, "only this month's payments' fee lines, app fee included");
  assert.strictEqual(gc.notPaidOut, 1); assert.strictEqual(gc.waiting, 1);
  // SumUp: 12.50 + 30 sold, 5 refunded; fees matched by code only
  assert.strictEqual(su.gross, 42.5); assert.strictEqual(su.refunds, 5); assert.strictEqual(su.other, 37.5);
  assert.strictEqual(su.fees, 0.72); assert.ok(su.feesKnown);
  assert.ok(w.calls.some((c) => c.searchParams.get("oldest_ref") === "T2"), "SumUp follows its next link");
  assert.strictEqual(w.calls.filter((c) => c.pathname === "/v1/charges").length, 3, "Stripe pages through has_more");
  // the four boxes
  assert.deepStrictEqual(pull.fields, { recurringRev: 115, trialRev: 148, otherRev: 37.5, processingFees: 10.92 });
  assert.strictEqual(pull.partial, false);
  assert.deepStrictEqual(pull.warnings, []);

  /* 4. a missing source never leaves a plausible wrong number */
  const w2 = world();
  const noGc = await L.pullMonth("2026-09", { ...ENV, GOCARDLESS_ACCESS_TOKEN: "" }, w2.fx, NOW);
  assert.strictEqual(noGc.fields.recurringRev, null, "Recurring needs GoCardless");
  assert.strictEqual(noGc.fields.processingFees, null, "Fees need GoCardless");
  assert.strictEqual(noGc.fields.trialRev, 148, "Trial is Stripe alone");
  assert.strictEqual(noGc.fields.otherRev, 37.5);
  assert.ok(noGc.warnings.some((x) => /GOCARDLESS_ACCESS_TOKEN/.test(x)));
  const denied = async (url) => url.includes("stripe") ? { ok: false, status: 403, json: async () => ({ error: { message: "The provided key 'rk_live_…' does not have the required permissions for this endpoint" } }) } : w2.fx(url);
  const noSt = await L.pullMonth("2026-09", ENV, denied, NOW);
  assert.strictEqual(noSt.fields.recurringRev, null); assert.strictEqual(noSt.fields.trialRev, null);
  assert.ok(/Balance, Invoices and Refunds/.test(noSt.sources.stripe.error), "says which Stripe permissions to add");
  const future = await L.pullMonth("2026-12", ENV, w2.fx, NOW);
  assert.ok(!future.ok, "a month that hasn't started is refused");
  const partial = await L.pullMonth("2026-10", ENV, async (url) => ({ ok: true, json: async () => (url.includes("gocardless") ? { payments: [], refunds: [], payouts: [], meta: { cursors: {} } } : url.includes("sumup") ? { items: [], links: [] } : { data: [], has_more: false }) }), NOW);
  assert.ok(partial.partial, "the current month says 'so far'");

  /* 4b. SumUp fees: when the financials lists don't carry them, each sale's own record does */
  const w3 = world();
  const perSale = async (url) => {
    const U = new URL(url);
    if (U.host === "api.sumup.com" && U.pathname.startsWith("/v0.1/me/financials/")) return { ok: true, json: async () => [{ transaction_code: "T1", amount: 12.5 }] };
    if (U.host === "api.sumup.com" && U.pathname === "/v0.1/me/transactions") {
      const fee = { T1: 0.21, T2: 0.51 }[U.searchParams.get("transaction_code")];
      return { ok: true, json: async () => ({ id: "x", events: [{ type: "PAYOUT", fee_amount: fee }] }) };
    }
    return w3.fx(url);
  };
  const ps = await L.pullMonth("2026-09", ENV, perSale, NOW);
  assert.ok(ps.sources.sumup.feesKnown, "found on the sales themselves");
  assert.strictEqual(ps.sources.sumup.fees, 0.72);
  assert.ok(ps.sources.sumup.feeTried.some((t) => /^transactions: 1 rows, 0 matched/.test(t)), "says what each place gave");
  assert.ok(!JSON.stringify(ps.sources.sumup.feeTried).includes("12.5"), "field names only, never values");

  /* 5. read-only and isolated */
  const LIB = read("netlify/lib/takings.js");
  assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(LIB), "the providers are only ever read");
  assert.ok(!/bodysculpt-kpi/.test(LIB), "it never names the KPI store");
  const TOML = read("netlify.toml");
  assert.ok(/\[functions\."takings-scheduled"\]\s*\n\s*schedule = "0 6 4 \* \*"/.test(TOML), "runs on the 4th");

  /* 6. the page fills, never saves, and the way back is on the review */
  const M = read("monthly.html");
  const tk = M.slice(M.indexOf("// ===================== v225: THE MONTH'S TAKINGS"), M.indexOf("// ===================== AI MONTHLY REVIEW"));
  assert.ok(tk.length > 1000);
  assert.ok(!/saveMonth|saveMoney\(|STORE/.test(tk), "the pull never writes the month — Save figures does");
  assert.ok(/id="tkUndo"/.test(tk) && /Put back what was there/.test(tk), "undo sits on the review");
  assert.ok(/function openMoney\(\)\{[\s\S]*?tkReset\(\);[\s\S]*?\n\}/.test(M), "opening the panel clears an old review");
  assert.ok(/getElementById\("tkPull"\)\.addEventListener\("click", tkPull\)/.test(M));
  assert.ok(/tkCheckReady\(\);/.test(M.slice(M.indexOf("async function boot()"))), "boot looks for a waiting pull");
  // only the four revenue boxes are touched
  assert.ok(/const TK_FIELDS = \[\["recurringRev"[\s\S]*?\["processingFees","Processing Fees"\]\];/.test(tk));
  console.log("v225 takings: OK");
})().catch((e) => { console.error(e); process.exit(1); });
