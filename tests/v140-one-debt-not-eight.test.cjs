// v137→v140 — a failed payment is not the same thing as money you are owed.
//
// Ash, the morning after the Stripe key went in: "it's showing failed payments that have
// actually since gone through."
//
// He is right, and it is the failure mode that kills a dashboard. A card bounces on the
// Tuesday, Stripe retries on the Thursday, the money lands — and the Tuesday failure stays
// in the API forever. Show those and within a fortnight the card is wallpaper; then the one
// that genuinely needs him is sitting in the middle of it and gets missed too.
//
// The fix is not a cleverer filter on charges. It is asking the right object. For anything
// on a membership, STRIPE IS COLLECTING AN INVOICE — the charges under it are just
// attempts, and the invoice's status is the only thing that says whether the money arrived.
// Three backstops cover the rest:
//
//   1. the invoice says paid (or void — cancelled, so nothing to chase)
//   2. another attempt on the same PaymentIntent succeeded
//   3. no invoice at all (a one-off): the same customer paid the SAME amount within a week
//   4. that customer is already on the "stopped paying" list, where the row says it better
//
// The one mistake this must never make is the opposite one — clearing a failure that has
// NOT been paid. So the amount match in (3) is exact, the payment has to come after the
// failure, and an invoice that is open, draft or uncollectible keeps the row. All four are
// checked below, in both directions.
//
// v138 REBUILT THIS after Ash found it still wrong. See the block marked "the cases v137
// got wrong" below, and the long note in the function. In short: an open invoice used to
// END the check instead of merely failing that one test; identity was the customer id
// alone; and the amount had to match to the penny. All three are fixed and pinned here.
//
// And it must not go quietly silent: the count it cleared comes back in the payload so the
// page can say what it took off. A card that drops rows without saying so is a card you
// stop trusting, which is the thing being fixed.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const SRC = read(path.join("netlify", "functions", "stripe-feed.js"));
const DAILY = read("daily.html");
const scriptOf = (src) => src.slice(src.lastIndexOf("<script>") + 8, src.lastIndexOf("</script>"));

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

/* Run the real function with Stripe faked. `parts` supplies each list endpoint's data.
   `nowUnix` pins the clock, so a fixture taken from a real Stripe export can use the dates
   it actually has rather than being rewritten as "n days ago". */
async function run(parts, nowUnix) {
  const tmp = path.join(os.tmpdir(), "stripe-v137-" + process.pid + "-" + Math.random().toString(36).slice(2) + ".mjs");
  fs.writeFileSync(tmp, SRC);
  const mod = await import("file://" + tmp);
  fs.unlinkSync(tmp);
  const savedEnv = { ...process.env }, savedFetch = globalThis.fetch, savedNow = Date.now;
  process.env.STRIPE_SECRET_KEY = "rk_test_x";
  if (nowUnix) Date.now = () => nowUnix * 1000;
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    seen.push(u);
    let data = [];
    if (u.includes("/disputes")) data = parts.disputes || [];
    else if (u.includes("status=past_due")) data = parts.pastDue || [];
    else if (u.includes("status=unpaid")) data = parts.unpaid || [];
    else if (u.includes("/charges")) data = parts.charges || [];
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
  try {
    const res = await mod.default(new Request("https://x/.netlify/functions/stripe-feed"));
    return { body: await res.json(), seen };
  } finally {
    globalThis.fetch = savedFetch;
    Date.now = savedNow;
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    Object.assign(process.env, savedEnv);
  }
}

// v139: every fixture charge gets its OWN name unless one is passed. They used to share a
// default of "A Member", which — once the resolver learned to match people by name — quietly
// made every charge in a fixture the same person and several tests pass for the wrong
// reason. A test fixture that shares an identity by accident is worse than no fixture.
let nameSeq = 0;
function uniqName() {
  let n = nameSeq++, s = "";
  do { s = "abcdefghijklmnopqrstuvwxyz"[n % 26] + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return "Person " + s;
}

// A failed charge, with whatever context the case under test needs.
const failed = (id, opts) => ({
  id, status: "failed", amount: (opts && opts.amount) || 4900, currency: "gbp",
  created: NOW - ((opts && opts.daysAgo) != null ? opts.daysAgo : 3) * DAY,
  failure_message: "Your card has expired.",
  billing_details: { name: (opts && opts.name) || uniqName() },
  customer: opts && opts.customer,
  payment_intent: opts && opts.intent,
  invoice: opts && opts.invoice,
});
const paid = (id, opts) => ({
  id, status: "succeeded", amount: (opts && opts.amount) || 4900, currency: "gbp",
  created: NOW - ((opts && opts.daysAgo) != null ? opts.daysAgo : 1) * DAY,
  billing_details: { name: (opts && opts.name) || uniqName() },
  customer: opts && opts.customer,
  payment_intent: opts && opts.intent,
});
const sub = (id, customer, status) => ({
  id, status: status || "past_due", customer: { id: customer, name: "Past Due Person", email: "p@x.com" },
  current_period_start: NOW - 9 * DAY, currency: "gbp",
  items: { data: [{ quantity: 1, price: { unit_amount: 5900, currency: "gbp" } }] },
});

(async () => {
  /* ================= 0. the stamp ================= */
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(read("monthly.html"));
  assert.ok(stamp, "monthly.html carries a build stamp");
  assert.strictEqual(stamp[1], "140", "monthly.html is stamped v140");
  assert.strictEqual(stamp[2], "one-debt-not-eight", "…as the release that stopped counting attempts as problems");
  const text = "build v140 · one-debt-not-eight";
  for (const f of ["index.html", "finances.html", "daily.html", "social.html"]) {
    assert.ok(read(f).includes(text), f + " carries the same stamp");
  }

  /* ================= 1. the invoice is asked for at all ================= */
  let out = await run({});
  const chargeCall = out.seen.find((u) => u.includes("/charges"));
  assert.ok(/expand%5B%5D=data.invoice|expand\[\]=data\.invoice/.test(decodeURIComponent(chargeCall).replace(/\+/g, "")) ||
    decodeURIComponent(chargeCall).includes("expand[]=data.invoice"),
    "the charges call expands the invoice — without it none of this can be decided");

  /* ================= 2. THE CASE ASH HIT: paid on the retry ================= */
  out = await run({
    charges: [
      failed("ch_bounced", { customer: "cus_1", intent: "pi_1", invoice: { id: "in_1", status: "paid" } }),
      paid("ch_worked", { customer: "cus_1", intent: "pi_1", daysAgo: 1 }),
    ],
  });
  assert.deepStrictEqual(out.body.failed, [], "a failure whose invoice was paid is GONE from the list");
  assert.strictEqual(out.body.resolved.count, 1, "…but it is counted, not silently dropped");
  assert.strictEqual(out.body.resolved.amount, 4900, "…with the amount it was for");
  assert.deepStrictEqual(out.body.resolved.reasons, ["the invoice was paid"], "…and why it was cleared");
  assert.strictEqual(out.body.totals.count, 0, "nothing needs him");

  /* ================= 3. …and the opposite, which must NOT be cleared ================= */
  // An unanswered invoice and no payment since: this is money he is owed, and it stays.
  for (const status of ["open", "draft", "uncollectible"]) {
    out = await run({ charges: [failed("ch_x", { customer: "cus_2", invoice: { id: "in_2", status } }) ] });
    assert.strictEqual(out.body.failed.length, 1,
      "an invoice that is " + status + " with nothing paid since STAYS on the list");
    assert.strictEqual(out.body.resolved.count, 0, "…and is not counted as cleared");
  }
  // void means it was cancelled, so there is nothing to chase either
  out = await run({ charges: [failed("ch_v", { customer: "cus_2", invoice: { id: "in_3", status: "void" } })] });
  assert.strictEqual(out.body.failed.length, 0, "a cancelled invoice is not money owed");
  assert.deepStrictEqual(out.body.resolved.reasons, ["the invoice was cancelled"], "…and says so");

  /* ================= 4. a later attempt on the same PaymentIntent ================= */
  out = await run({
    charges: [
      failed("ch_a", { customer: "cus_3", intent: "pi_9" }),          // no invoice: a one-off
      paid("ch_b", { customer: "cus_3", intent: "pi_9", daysAgo: 2 }),
    ],
  });
  assert.strictEqual(out.body.failed.length, 0, "the same payment succeeding on a retry clears it");
  assert.deepStrictEqual(out.body.resolved.reasons, ["it went through on a retry"], "…for that reason");

  /* ================= 5. the one-off backstop, and its limits ================= */
  // same customer, same amount, two days later -> that was them paying it
  out = await run({
    charges: [failed("ch_c", { customer: "cus_4", daysAgo: 5, amount: 3500 }),
              paid("ch_d", { customer: "cus_4", daysAgo: 3, amount: 3500 })],
  });
  assert.strictEqual(out.body.failed.length, 0, "same customer, same amount, afterwards -> cleared");
  assert.deepStrictEqual(out.body.resolved.reasons, ["they paid it again"], "…for that reason");

  // A SMALLER payment does not clear it — that is them paying for something else, or
  // paying part of it. (A BIGGER one does, as of v138: see 6b(c). v137 required the amount
  // to match to the penny, which was too strict for how people actually settle up.)
  out = await run({
    charges: [failed("ch_e", { customer: "cus_5", daysAgo: 5, amount: 9900 }),
              paid("ch_f", { customer: "cus_5", daysAgo: 3, amount: 3500 })],
  });
  assert.strictEqual(out.body.failed.length, 1,
    "a smaller payment does not clear a failure — nothing covering it in full");

  // a payment BEFORE the failure proves nothing
  out = await run({
    charges: [failed("ch_g", { customer: "cus_6", daysAgo: 2, amount: 3500 }),
              paid("ch_h", { customer: "cus_6", daysAgo: 6, amount: 3500 })],
  });
  assert.strictEqual(out.body.failed.length, 1, "last month's payment does not settle this month's failure");

  // v139: there is no longer a cutoff INSIDE the fortnight — that arbitrary line is what
  // missed Jennifer Lawton by two hours. Two payments from one person at one amount twelve
  // days apart are not a billing cycle, they are somebody sorting something out. What still
  // holds the line is the window itself: a failure older than the lookback is not fetched
  // at all, so it cannot be cleared or shown either way.
  out = await run({
    charges: [failed("ch_i", { customer: "cus_7", daysAgo: 13, amount: 3500 }),
              paid("ch_j", { customer: "cus_7", daysAgo: 1, amount: 3500 })],
  });
  assert.strictEqual(out.body.failed.length, 0, "twelve days later, same person, same amount: settled");

  // A different customer paying a COMMON amount never counts — that is just another member
  // paying the standard price. (A different customer paying a RARE amount is a different
  // matter entirely, and is the whole of Jennifer Lawton's case: see 6d.)
  out = await run({
    charges: [
      failed("ch_k", { customer: "cus_8", daysAgo: 4, amount: 3500, name: "Alan Briggs" }),
      paid("ch_l", { customer: "cus_9", daysAgo: 2, amount: 3500, name: "Bev Clark" }),
      paid("ch_l2", { customer: "cus_10b", daysAgo: 2, amount: 3500, name: "Colin Dean" }),
      paid("ch_l3", { customer: "cus_11b", daysAgo: 3, amount: 3500, name: "Dawn Ellis" }),
    ],
  });
  assert.strictEqual(out.body.failed.length, 1, "somebody else paying the usual price clears nothing");

  /* ================= 6. no saying the same thing twice ================= */
  out = await run({
    pastDue: [sub("sub_1", "cus_10")],
    charges: [failed("ch_m", { customer: "cus_10", daysAgo: 2 })],
  });
  assert.strictEqual(out.body.pastDue.length, 1, "the membership row stays — that money IS still owed");
  assert.strictEqual(out.body.failed.length, 0, "…and the failed charge does not repeat it underneath");
  assert.deepStrictEqual(out.body.resolved.reasons, ["shown under Stopped paying"], "…and says where it went");
  assert.strictEqual(out.body.totals.count, 1, "one problem is counted once");

  /* ============ 6b. THE CASES v137 GOT WRONG (v138) ============
     Ash: "Jen Lawton's payment is showing as insufficient funds, that was last pulled
     through on the 6th, but full payment was then made on the 8th."

     Three separate faults could each produce that row on their own, so each is pinned on
     its own below. The first is the one that mattered: an open invoice ENDED the check. */

  // (a) THE SHORT-CIRCUIT. An invoice still open, and she paid two days later by some other
  //     route. v137 returned at the invoice and never looked. It is evidence, not proof.
  out = await run({
    charges: [
      failed("ch_jen", { customer: "cus_jen", name: "Jen Lawton", daysAgo: 4, amount: 4900,
        invoice: { id: "in_jen", status: "open", amount_remaining: 4900 } }),
      paid("ch_jen_paid", { customer: "cus_jen", name: "Jen Lawton", daysAgo: 2, amount: 4900 }),
    ],
  });
  assert.strictEqual(out.body.failed.length, 0,
    "an OPEN invoice no longer ends the check — she paid, so the row goes");
  assert.deepStrictEqual(out.body.resolved.reasons, ["they paid it again"], "…cleared by the payment, not the invoice");

  // …and the same shape with NOTHING paid since still stands, so the fall-through has not
  // simply turned the invoice test off.
  out = await run({
    charges: [failed("ch_jen2", { customer: "cus_jen", daysAgo: 4, invoice: { id: "in_j2", status: "open", amount_remaining: 4900 } })],
  });
  assert.strictEqual(out.body.failed.length, 1, "an open invoice with no payment since still stands");
  assert.strictEqual(out.body.failed[0].why, "The invoice behind this is still open in Stripe.",
    "…and the row says what is keeping it there");

  // an invoice marked paid only by amount_remaining:0 counts as paid
  out = await run({ charges: [failed("ch_ar", { customer: "cus_ar", invoice: { id: "in_ar", status: "open", amount_remaining: 0 } })] });
  assert.strictEqual(out.body.failed.length, 0, "nothing left to collect on the invoice is paid, whatever the label says");

  // (b) IDENTITY. A payment taken through a link, a fresh checkout or the card machine may
  //     carry no customer at all, or a different one. The same email, or the same card, or
  //     the same full name, is the same person.
  //
  //     v139 note: these deliberately use a COMMON amount and pad the fortnight with other
  //     people paying it, so the amount rule added for Jennifer Lawton cannot fire and each
  //     case tests the identity signal it is named after and nothing else.
  const CROWD = [
    paid("crowd1", { customer: "cus_p1", daysAgo: 2, amount: 3500, name: "Colin Dean" }),
    paid("crowd2", { customer: "cus_p2", daysAgo: 3, amount: 3500, name: "Dawn Ellis" }),
    paid("crowd3", { customer: "cus_p3", daysAgo: 4, amount: 3500, name: "Eve Fisher" }),
  ];
  out = await run({
    charges: [
      failed("ch_e1", { customer: "cus_e", daysAgo: 6, amount: 3500, name: "Gary Hall" }),
      { id: "ch_e2", status: "succeeded", amount: 3500, currency: "gbp", created: NOW - 2 * DAY,
        billing_details: { name: "Ivy Jones", email: "ivy@example.com" } },
      ...CROWD,
    ],
  });
  assert.strictEqual(out.body.failed.length, 1, "with no shared identity there is nothing to match on");

  out = await run({
    charges: [
      { ...failed("ch_e3", { daysAgo: 6, amount: 3500 }), customer: undefined,
        billing_details: { name: "Gary Hall", email: "g.hall@example.com" } },
      { id: "ch_e4", status: "succeeded", amount: 3500, currency: "gbp", created: NOW - 2 * DAY,
        billing_details: { name: "Someone Else", email: "G.Hall@Example.com" } },
      ...CROWD,
    ],
  });
  assert.strictEqual(out.body.failed.length, 0, "the same email is the same person, whatever the case");

  out = await run({
    charges: [
      { ...failed("ch_f1", { daysAgo: 6, amount: 3500 }), customer: undefined, billing_details: {},
        payment_method_details: { card: { fingerprint: "fp_same" } } },
      { id: "ch_f2", status: "succeeded", amount: 3500, currency: "gbp", created: NOW - 2 * DAY,
        billing_details: {}, payment_method_details: { card: { fingerprint: "fp_same" } } },
      ...CROWD,
    ],
  });
  assert.strictEqual(out.body.failed.length, 0, "the same card is the same person, with no customer record at all");

  // a first name alone is never an identity — half a gym is called Jen
  out = await run({
    charges: [
      { ...failed("ch_g1", { daysAgo: 6, amount: 3500 }), customer: "cus_g1", billing_details: { name: "Jen" } },
      { id: "ch_g2", status: "succeeded", amount: 3500, currency: "gbp", created: NOW - 2 * DAY,
        customer: "cus_g2", billing_details: { name: "Jen" } },
      ...CROWD,
    ],
  });
  assert.strictEqual(out.body.failed.length, 1, "one word is not a name to match people on");

  // (c) THE AMOUNT. Paying MORE than the failure, afterwards, settles it — people pay a
  //     bounced amount along with something else all the time.
  out = await run({
    charges: [failed("ch_m1", { customer: "cus_m", daysAgo: 4, amount: 3500 }),
              paid("ch_m2", { customer: "cus_m", daysAgo: 2, amount: 9900 })],
  });
  assert.strictEqual(out.body.failed.length, 0, "a bigger payment afterwards covers it");
  assert.deepStrictEqual(out.body.resolved.reasons, ["they paid at least that much afterwards"],
    "…recorded as the less certain reason, not passed off as an exact match");

  // paying LESS does not, and the row says exactly that
  out = await run({
    charges: [failed("ch_m3", { customer: "cus_n", daysAgo: 4, amount: 9900 }),
              paid("ch_m4", { customer: "cus_n", daysAgo: 2, amount: 1000 })],
  });
  assert.strictEqual(out.body.failed.length, 1, "a smaller payment does not cover it");
  assert.strictEqual(out.body.failed[0].why, "They have paid since, but less than this — nothing covering it in full.",
    "…and the row says so, rather than looking like nothing happened");

  // the ordering rules survive the loosening
  out = await run({
    charges: [failed("ch_o1", { customer: "cus_o", daysAgo: 2, amount: 3500 }),
              paid("ch_o2", { customer: "cus_o", daysAgo: 6, amount: 9900 })],
  });
  assert.strictEqual(out.body.failed.length, 1, "a bigger payment BEFORE the failure still settles nothing");

  /* ============ 6d. JENNIFER LAWTON — HER ACTUAL NINE ROWS (v140) ============
     Ash sent his Stripe list, and it settles two arguments at once.

       £143.10  Succeeded  jennifercooney@hotmail.co.uk  Visa ····0011   8 Sept, 11:27
       £143.10  Failed     jennifercooney@hotmail.co.uk  Visa ····0011   6 Sept, 11:24
       £143.10  Failed     …same…                                        4 Sept, 11:25
       £143.10  Failed                                                   2 Sept, 11:32
       £143.10  Failed                                                  31 Aug,  11:24
       £143.10  Failed                                                  29 Aug,  11:24
       £143.10  Failed                                                  27 Aug,  11:25
       £143.10  Failed                                                  25 Aug,  11:25
       £143.10  Failed                                                  23 Aug,  11:02

     FIRST: the identity was there all along. Every row carries the same email and the same
     card. Last time I reasoned from the dashboard NAME ("Mrs Jennifer Lawton") that the
     records must belong to different people — the name is the billing name and the email is
     the customer's, and I inferred a mismatch that did not exist. What was actually missing
     was `expand[]=data.customer`: on a subscription charge `billing_details.email` is
     usually empty and the address lives on the customer record, so the one field that tied
     nine rows together was never loaded.

     SECOND, and Ash's point: "There are others who pay £143.10 though. You can't blindly
     assume from the amount they're all the same people." Correct, and £143.10 is the price
     of a coaching block, not a fingerprint. v139's rarity rule is gone. Identity AND amount.

     THIRD: eight failures for ONE thing she owed. Stripe retried every other day at 11:25
     until it worked. Eight rows is not eight problems. */
  const JEN = (id, status, day, hour, min) => ({
    id, status, amount: 14310, currency: "gbp",
    created: Math.floor(Date.UTC(2026, 8, day, hour, min) / 1000),
    failure_message: status === "failed" ? "Your card has insufficient funds." : undefined,
    // the name is the BILLING name and the email is the CUSTOMER's — exactly as Stripe shows it
    billing_details: { name: "Mrs Jennifer Lawton" },
    customer: { id: "cus_jen", name: "Mrs Jennifer Lawton", email: "jennifercooney@hotmail.co.uk" },
    payment_method_details: { card: { fingerprint: "fp_0011", last4: "0011" } },
    invoice: { id: "in_jen_" + id, status: "open", amount_remaining: 14310 },
  });
  // Sept days as given; the August ones are day 31, 29, 27, 25, 23 of month index 7.
  const AUG = (id, day, hour, min) => ({ ...JEN(id, "failed", 1, hour, min),
    created: Math.floor(Date.UTC(2026, 7, day, hour, min) / 1000) });
  const JEN_ROWS = [
    JEN("ch_ok", "succeeded", 8, 11, 27),
    JEN("ch_f6", "failed", 6, 11, 24),
    JEN("ch_f4", "failed", 4, 11, 25),
    JEN("ch_f2", "failed", 2, 11, 32),
    AUG("ch_a31", 31, 11, 24),
    AUG("ch_a29", 29, 11, 24),
    AUG("ch_a27", 27, 11, 25),
    AUG("ch_a25", 25, 11, 25),
    AUG("ch_a23", 23, 11, 2),
  ];
  // The whole run sits inside a fortnight ending just after the successful payment.
  const AT_10_SEPT = Math.floor(Date.UTC(2026, 8, 10, 15, 0) / 1000);

  out = await run({ charges: JEN_ROWS }, AT_10_SEPT);
  assert.deepStrictEqual(out.body.failed, [],
    "eight failed attempts and one success is ONE debt, and it is paid — nothing is shown");
  assert.strictEqual(out.body.resolved.count, 1,
    "counted as ONE payment cleared, not eight — that is what it was");
  assert.strictEqual(out.body.resolved.attempts, 8, "…with the eight attempts behind it reported");
  assert.deepStrictEqual(out.body.resolved.reasons, ["they paid it again"],
    "cleared by the payment matching her, not by the figure looking rare");

  // The identity that does the work is the CUSTOMER's email, which only exists because the
  // customer is expanded. Take that away and it must not silently fall back to guessing.
  const custCall = (await run({ charges: [] })).seen.find((u) => u.includes("/charges"));
  assert.ok(decodeURIComponent(custCall).includes("expand[]=data.customer"),
    "the charges call expands the customer — the email lives there, not on billing_details");

  // AND THE THING ASH OBJECTED TO IS GONE: another member paying the same price, on the same
  // day, clears nothing. This is the exact case v139 would have got wrong.
  const OTHER = {
    id: "ch_other", status: "succeeded", amount: 14310, currency: "gbp",
    created: Math.floor(Date.UTC(2026, 8, 9, 9, 0) / 1000),
    billing_details: { name: "Someone Else" },
    customer: { id: "cus_other", name: "Someone Else", email: "someone@example.com" },
    payment_method_details: { card: { fingerprint: "fp_9999" } },
  };
  out = await run({ charges: [AUG("ch_lonely", 29, 11, 24), OTHER] }, AT_10_SEPT);
  assert.strictEqual(out.body.failed.length, 1,
    "somebody else paying £143.10 does not clear her failure — the amount is a price, not a person");
  assert.strictEqual(out.body.resolved.count, 0, "…and nothing is quietly cleared");

  // One row for the run, and it says how long this has been going on — which is the useful
  // fact, and one no single attempt could tell him.
  out = await run({ charges: JEN_ROWS.filter((r) => r.status === "failed") }, AT_10_SEPT);
  assert.strictEqual(out.body.failed.length, 1, "eight attempts collapse to one row");
  assert.strictEqual(out.body.failed[0].attempts, 8, "…which knows there were eight");
  assert.ok(out.body.failed[0].firstFailedAt.startsWith("2026-08-23"),
    "…and when it started: " + out.body.failed[0].firstFailedAt);
  assert.strictEqual(out.body.failed[0].amount, 14310, "…for the amount owed ONCE, not eight times");
  assert.strictEqual(out.body.totals.failed, 14310, "…and the total is what she owes, not £1,144.80");

  // two different debts from the same person stay apart
  out = await run({ charges: [
    { ...AUG("ch_p1", 29, 11, 24), amount: 14310 },
    { ...AUG("ch_p2", 28, 9, 0), amount: 4900 },
  ] }, AT_10_SEPT);
  assert.strictEqual(out.body.failed.length, 2, "the same person owing two different amounts is two things");

  /* ============ 6c. the window is fetched whole ============
     A gym billing a few hundred memberships puts more than 100 charges through a
     fortnight. A cross-check that can only see the first page leaves failures on screen
     that were paid — the very thing being fixed. */
  {
    const page1 = Array.from({ length: 100 }, (_, i) => paid("bulk" + i, { customer: "cus_b" + i, daysAgo: 1 }));
    const page2 = [paid("ch_late", { customer: "cus_late", daysAgo: 2, amount: 4900 }),
                   failed("ch_early", { customer: "cus_late", daysAgo: 5, amount: 4900 })];
    const tmp = path.join(os.tmpdir(), "stripe-pages-" + process.pid + ".mjs");
    fs.writeFileSync(tmp, SRC);
    const mod = await import("file://" + tmp);
    fs.unlinkSync(tmp);
    const savedEnv = { ...process.env }, savedFetch = globalThis.fetch;
    process.env.STRIPE_SECRET_KEY = "rk_test_x";
    let chargeCalls = 0;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (!u.includes("/charges")) return { ok: true, status: 200, json: async () => ({ data: [] }) };
      chargeCalls++;
      const first = !u.includes("starting_after");
      return { ok: true, status: 200,
        json: async () => ({ data: first ? page1 : page2, has_more: first }) };
    };
    let body;
    try {
      const res = await mod.default(new Request("https://x/.netlify/functions/stripe-feed"));
      body = await res.json();
    } finally {
      globalThis.fetch = savedFetch;
      for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
      Object.assign(process.env, savedEnv);
    }
    assert.strictEqual(chargeCalls, 2, "it went back for the second page");
    assert.strictEqual(body.failed.length, 0,
      "a failure on page two, paid on page two, is cleared — one page of 100 would have shown it");
  }

  /* ================= 7. a real morning: some of each ================= */
  out = await run({
    disputes: [{ id: "dp_1", status: "needs_response", amount: 4900, currency: "gbp", created: NOW - 2 * DAY,
      evidence_details: { due_by: NOW + 3 * DAY }, charge: { billing_details: { name: "R. Whitehead" } } }],
    pastDue: [sub("sub_2", "cus_20")],
    charges: [
      failed("ch_1", { customer: "cus_21", invoice: { id: "in_a", status: "paid" } }),   // sorted itself out
      failed("ch_2", { customer: "cus_22", intent: "pi_2" }),                            // still owed
      paid("ch_3", { customer: "cus_23", daysAgo: 1, amount: 7900 }),                    // an unrelated payment,
                                                                                        // deliberately a different
                                                                                        // figure from any failure
      failed("ch_4", { customer: "cus_20", daysAgo: 1 }),                                // already past due
      failed("ch_5", { customer: "cus_24", daysAgo: 6, amount: 2500 }),                  // still owed
      paid("ch_6", { customer: "cus_24", daysAgo: 4, amount: 1000 }),                    // …only part of it
    ],
  });
  assert.strictEqual(out.body.disputes.length, 1, "the dispute stands");
  assert.strictEqual(out.body.pastDue.length, 1, "the membership stands");
  assert.deepStrictEqual(out.body.failed.map((r) => r.id), ["ch_2", "ch_5"],
    "exactly the two that nobody has paid — ch_2 three days ago, then ch_5 six days ago");
  assert.strictEqual(out.body.resolved.count, 2, "two were checked and cleared");
  assert.strictEqual(out.body.totals.failed, 2500 + 4900, "the total is what is STILL owed");
  assert.strictEqual(out.body.totals.count, 4, "four things need him, not six");

  /* ================= 8. the page says what it took off ================= */
  const js = scriptOf(DAILY);
  assert.ok(/stripeState\.resolved/.test(js), "the page reads the cleared count");
  assert.ok(/class="cleared"/.test(js), "…and has a line to put it on");
  assert.ok(/failed and (has|have) since been paid/.test(js), "…in words, not a number on its own");
  assert.ok(/cleared: \["Already sorted"/.test(js), "…with an explainer for what it means");
  // the heading stopped claiming more than it shows
  assert.ok(/moneyGroupHtml\("Still unpaid"/.test(js),
    "the group is called what it is now — still unpaid, not merely failed");
  assert.ok(/still unpaid/.test(js), "the doorway line says the same");
  // and the all-clear reassures rather than just going blank
  assert.ok(/without you having to do anything/.test(js),
    "a morning where everything sorted itself out says so");
  // Every response shape carries `resolved`, so the page never has to null-check it on the
  // very paths where it is already coping with something being wrong. Driven, not grepped.
  {
    const savedEnv = { ...process.env };
    delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_API_KEY;
    const tmp = path.join(os.tmpdir(), "stripe-shape-" + process.pid + ".mjs");
    fs.writeFileSync(tmp, SRC);
    const mod = await import("file://" + tmp);
    fs.unlinkSync(tmp);
    const res = await mod.default(new Request("https://x/.netlify/functions/stripe-feed"));
    const body = await res.json();
    assert.strictEqual(body.configured, false, "no key means configured:false");
    assert.deepStrictEqual(body.resolved, { count: 0, attempts: 0, amount: 0, reasons: [] },
      "…and it still carries an empty resolved block");
    Object.assign(process.env, savedEnv);
  }
  {
    const savedEnv = { ...process.env }, savedFetch = globalThis.fetch;
    process.env.STRIPE_SECRET_KEY = "rk_test_x";
    globalThis.fetch = async () => { throw new Error("Stripe is having a morning"); };
    const tmp = path.join(os.tmpdir(), "stripe-shape2-" + process.pid + ".mjs");
    fs.writeFileSync(tmp, SRC);
    const mod = await import("file://" + tmp);
    fs.unlinkSync(tmp);
    const body = await (await mod.default(new Request("https://x/.netlify/functions/stripe-feed"))).json();
    globalThis.fetch = savedFetch;
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    Object.assign(process.env, savedEnv);
    assert.strictEqual(body.ok, false, "a Stripe outage is flagged");
    assert.deepStrictEqual(body.resolved, { count: 0, attempts: 0, amount: 0, reasons: [] },
      "…and carries an empty resolved block too");
  }

  /* ================= 9. it is still read-only =================
     Checked against the CODE, not against the prose: the file's own header uses the words
     "refunds" and "cancels" to promise it does neither, and an assertion that greps the
     whole file for those words fails on the promise instead of on a breach of it. */
  const code = SRC.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const fetches = [...code.matchAll(/fetch\s*\(/g)];
  assert.strictEqual(fetches.length, 1, "the feed reaches Stripe from exactly one place");
  assert.ok(/const res = await fetch\(STRIPE_API \+ path \+ qs\(params \|\| \[\]\), \{\s*\n\s*headers:/.test(code),
    "…and that call passes headers only — no method, so it can only ever GET");
  assert.ok(!/method:\s*["'](POST|DELETE|PUT|PATCH)["']/.test(code), "no write verb anywhere in the code");
  for (const p of ["/refunds", "/subscription_items", "/payment_intents/"]) {
    assert.ok(!code.includes('"' + p), "the feed never addresses " + p);
  }

  console.log("v137-still-unpaid.test: all assertions passed");
})();
