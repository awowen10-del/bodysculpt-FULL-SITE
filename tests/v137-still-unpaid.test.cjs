// v137 — a failed payment is not the same thing as money you are owed.
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

/* Run the real function with Stripe faked. `parts` supplies each list endpoint's data. */
async function run(parts) {
  const tmp = path.join(os.tmpdir(), "stripe-v137-" + process.pid + "-" + Math.random().toString(36).slice(2) + ".mjs");
  fs.writeFileSync(tmp, SRC);
  const mod = await import("file://" + tmp);
  fs.unlinkSync(tmp);
  const savedEnv = { ...process.env }, savedFetch = globalThis.fetch;
  process.env.STRIPE_SECRET_KEY = "rk_test_x";
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
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    Object.assign(process.env, savedEnv);
  }
}

// A failed charge, with whatever context the case under test needs.
const failed = (id, opts) => ({
  id, status: "failed", amount: (opts && opts.amount) || 4900, currency: "gbp",
  created: NOW - ((opts && opts.daysAgo) != null ? opts.daysAgo : 3) * DAY,
  failure_message: "Your card has expired.",
  billing_details: { name: (opts && opts.name) || "A Member" },
  customer: opts && opts.customer,
  payment_intent: opts && opts.intent,
  invoice: opts && opts.invoice,
});
const paid = (id, opts) => ({
  id, status: "succeeded", amount: (opts && opts.amount) || 4900, currency: "gbp",
  created: NOW - ((opts && opts.daysAgo) != null ? opts.daysAgo : 1) * DAY,
  billing_details: { name: (opts && opts.name) || "A Member" },
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
  assert.strictEqual(stamp[1], "137", "monthly.html is stamped v137");
  assert.strictEqual(stamp[2], "still-unpaid", "…as the still-unpaid release");
  const text = "build v137 · still-unpaid";
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
  for (const status of ["open", "draft", "uncollectible"]) {
    out = await run({ charges: [failed("ch_x", { customer: "cus_2", invoice: { id: "in_2", status } }) ] });
    assert.strictEqual(out.body.failed.length, 1,
      "an invoice that is " + status + " is money still owed and STAYS on the list");
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

  // a DIFFERENT amount is a different transaction, and must not clear it
  out = await run({
    charges: [failed("ch_e", { customer: "cus_5", daysAgo: 5, amount: 3500 }),
              paid("ch_f", { customer: "cus_5", daysAgo: 3, amount: 9900 })],
  });
  assert.strictEqual(out.body.failed.length, 1,
    "a different amount does not clear a failure — that is somebody buying something else");

  // a payment BEFORE the failure proves nothing
  out = await run({
    charges: [failed("ch_g", { customer: "cus_6", daysAgo: 2, amount: 3500 }),
              paid("ch_h", { customer: "cus_6", daysAgo: 6, amount: 3500 })],
  });
  assert.strictEqual(out.body.failed.length, 1, "last month's payment does not settle this month's failure");

  // and outside the retry window it is a fresh payment, not a retry of that one
  out = await run({
    charges: [failed("ch_i", { customer: "cus_7", daysAgo: 13, amount: 3500 }),
              paid("ch_j", { customer: "cus_7", daysAgo: 1, amount: 3500 })],
  });
  assert.strictEqual(out.body.failed.length, 1, "twelve days later is next month's payment, not a retry");

  // a different customer entirely, same amount, never counts
  out = await run({
    charges: [failed("ch_k", { customer: "cus_8", daysAgo: 4, amount: 3500 }),
              paid("ch_l", { customer: "cus_9", daysAgo: 2, amount: 3500 })],
  });
  assert.strictEqual(out.body.failed.length, 1, "somebody else paying does not clear his failure");

  /* ================= 6. no saying the same thing twice ================= */
  out = await run({
    pastDue: [sub("sub_1", "cus_10")],
    charges: [failed("ch_m", { customer: "cus_10", daysAgo: 2 })],
  });
  assert.strictEqual(out.body.pastDue.length, 1, "the membership row stays — that money IS still owed");
  assert.strictEqual(out.body.failed.length, 0, "…and the failed charge does not repeat it underneath");
  assert.deepStrictEqual(out.body.resolved.reasons, ["shown under Stopped paying"], "…and says where it went");
  assert.strictEqual(out.body.totals.count, 1, "one problem is counted once");

  /* ================= 7. a real morning: some of each ================= */
  out = await run({
    disputes: [{ id: "dp_1", status: "needs_response", amount: 4900, currency: "gbp", created: NOW - 2 * DAY,
      evidence_details: { due_by: NOW + 3 * DAY }, charge: { billing_details: { name: "R. Whitehead" } } }],
    pastDue: [sub("sub_2", "cus_20")],
    charges: [
      failed("ch_1", { customer: "cus_21", invoice: { id: "in_a", status: "paid" } }),   // sorted itself out
      failed("ch_2", { customer: "cus_22", intent: "pi_2" }),                            // still owed
      paid("ch_3", { customer: "cus_23", daysAgo: 1 }),                                  // an ordinary payment
      failed("ch_4", { customer: "cus_20", daysAgo: 1 }),                                // already past due
      failed("ch_5", { customer: "cus_24", daysAgo: 6, amount: 2500 }),                  // still owed
      paid("ch_6", { customer: "cus_24", daysAgo: 4, amount: 9900 }),                    // …for something else
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
  // the empty shapes carry the field, so the page never null-checks a missing one
  for (const shape of ["configured: false", "ok: false"]) {
    assert.ok(SRC.includes("resolved: { count: 0, amount: 0, reasons: [] }"),
      "the " + shape + " response carries an empty resolved block too");
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
