// v247 — one person across Stripe records, and "no email on file".
//
// Ash: "Elaine Brook shows as '1st nudge', £195 declined 28 Sep, 'nothing has come in since', no
// email on file. That's wrong — her second payment went through."
//
// What Stripe actually holds (read live, 2026-10-22), all on 28 Sep:
//   12:03  declined £195   NO customer record   card ••2608   "Elaine Brook"   email only in metadata
//   17:52  declined £195   customer A (her email)  card ••2608   "Elaine Brook"
//   19:01  PAID £195       customer B (her email)  card ••9684   "E brook"
// No two-at-a-time check linked 12:03 to 19:01. Now charges are joined into PEOPLE first, by a
// shared customer record, email (incl. Ontraport's metadata) or card — and a name NEVER joins
// on its own (Ash: "names never join alone").
//
// What this pins:
//   1. Elaine, replayed from the real records: nothing owed, one debt cleared
//   2. …through either link alone: the metadata email, or the card-then-email chain
//   3. the metadata email becomes the row's email
//   4. a shared name with nothing else in common does NOT join two people
//   5. no email: no chase stage — tagged "no email on file", resolved by hand
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = (f) => path.join(__dirname, "..", f);
const SRC = fs.readFileSync(root("netlify/functions/stripe-feed.js"), "utf8");
const AT = Math.floor(Date.parse("2026-10-22T20:00:00Z") / 1000);

async function run(charges) {
  const tmp = path.join(os.tmpdir(), "stripe-v247-" + process.pid + "-" + Math.random().toString(36).slice(2) + ".mjs");
  fs.writeFileSync(tmp, SRC);
  const mod = await import("file://" + tmp);
  fs.unlinkSync(tmp);
  const savedFetch = globalThis.fetch, savedNow = Date.now;
  Date.now = () => AT * 1000;
  globalThis.fetch = async (url) => ({ ok: true, status: 200,
    json: async () => ({ data: String(url).includes("/charges") ? charges : [], has_more: false }) });
  try { return await mod.readMoney("rk_test_x"); }
  finally { globalThis.fetch = savedFetch; Date.now = savedNow; }
}

// Elaine's three charges, as Stripe returned them, cut to the fields that matter. The customer
// is EXPANDED, as stripe-feed asks for (expand[]=data.customer).
const CUST_A = { id: "cus_VLJvyDXssMInW8", name: "Elaine brook", email: "brookelaine52@gmail.com" };
const CUST_B = { id: "cus_VLQRppmQfOih0b", name: "Elaine Brook", email: "brookelaine52@gmail.com" };
const META = (contact, order) => ({ contact_id: contact, email: "brookelaine52@gmail.com", name: "Elaine brook", order_id: order });
const c1203 = { id: "ch_3UKdHjD9ikRmzvzF0kezow4i", status: "failed", amount: 19500, currency: "gbp", created: 1790597035,
  customer: null, payment_intent: null, failure_message: "Your card was declined.", description: "6 Week Challenge",
  billing_details: { email: null, name: "Elaine Brook" }, receipt_email: null, metadata: META("3900", "7421"),
  payment_method_details: { card: { fingerprint: "8qFCvDzQKaHjdmmR", last4: "2608" } } };
const c1752 = { id: "ch_3UKiixD9ikRmzvzF1Ds7YS8J", status: "failed", amount: 19500, currency: "gbp", created: 1790617943,
  customer: CUST_A, payment_intent: "pi_3UKiixD9ikRmzvzF1HO1lfza", failure_message: "Your card has insufficient funds.",
  billing_details: { email: null, name: "Elaine Brook" }, receipt_email: null, metadata: META("3900", "7422"),
  payment_method_details: { card: { fingerprint: "8qFCvDzQKaHjdmmR", last4: "2608" } } };
const c1901 = { id: "ch_3UKjmuD9ikRmzvzF0mLUAwyo", status: "succeeded", amount: 19500, currency: "gbp", created: 1790622066,
  customer: CUST_B, payment_intent: "pi_3UKjmuD9ikRmzvzF0XUlNZC9",
  billing_details: { email: null, name: "E brook" }, receipt_email: null, metadata: META("3901", "7426"),
  payment_method_details: { card: { fingerprint: "IxNx3MehDZr1w8ky", last4: "9684" } } };

(async () => {
  /* ============ 1. Elaine, from the real records ============ */
  let out = await run([c1901, c1752, c1203]);
  assert.deepStrictEqual(out.failed, [], "Elaine paid £195 at 19:01 — nothing is owed and nothing is shown");
  assert.strictEqual(out.resolved.count, 1, "her two declines are ONE debt, cleared once");
  assert.strictEqual(out.resolved.attempts, 2, "…with both attempts behind it");
  assert.deepStrictEqual(out.resolved.reasons, ["they paid it again"]);

  /* ============ 2. either link on its own is enough ============ */
  // (a) the metadata email alone: the 12:03 decline and the payment, nothing in between
  out = await run([c1901, c1203]);
  assert.deepStrictEqual(out.failed, [], "the email Ontraport left in metadata joins the 12:03 decline to the payment");
  // (b) the chain alone: no metadata anywhere — 12:03 → 17:52 by the card, 17:52 → 19:01 by the customer email
  const noMeta = (c) => ({ ...c, metadata: {} });
  out = await run([noMeta(c1901), noMeta(c1752), noMeta(c1203)]);
  assert.deepStrictEqual(out.failed, [], "card, then email: records join through each other, not just in pairs");
  // and without the link, it is (correctly) still owed — the join is what clears it
  out = await run([noMeta(c1901), noMeta(c1203)]);
  assert.strictEqual(out.failed.length, 1, "with no shared card, customer or email, she cannot be recognised — and is not guessed at");

  /* ============ 3. the metadata email is the row's email ============ */
  out = await run([c1203]);
  assert.strictEqual(out.failed.length, 1);
  assert.strictEqual(out.failed[0].email, "brookelaine52@gmail.com", "no customer, no billing email — the metadata one is used");
  assert.strictEqual(out.failed[0].why, "Nothing has come in from them since.");

  /* ============ 4. a name never joins on its own ============ */
  const sarah = (id, status, cust, card, email, created) => ({ id, status, amount: 14900, currency: "gbp", created,
    customer: { id: cust, name: "Sarah Jones", email }, billing_details: { name: "Sarah Jones" }, metadata: {},
    failure_message: status === "failed" ? "Your card was declined." : undefined,
    payment_method_details: { card: { fingerprint: card } } });
  out = await run([
    sarah("ch_s1", "failed", "cus_s1", "fp_s1", "sarah.j@one.com", AT - 6 * 86400),
    sarah("ch_s2", "succeeded", "cus_s2", "fp_s2", "sjones@two.com", AT - 2 * 86400),
  ]);
  assert.strictEqual(out.failed.length, 1, "two Sarah Joneses with nothing else in common are two people");
  assert.strictEqual(out.failed[0].paidSince, null, "…and the other Sarah's payment does not stop this Sarah's chase");
  const src = SRC.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/"n:"/.test(src) && !/normName/.test(src), "there is no name key left to join on");

  /* ============ 5. no email on file ============ */
  const chase = await import("file://" + root("netlify/lib/chase.js"));
  const NOW = Date.parse("2026-10-22T09:00:00Z");
  const debt = (extra) => Object.assign({ key: "r:x", name: "Luke Woodward", email: "", amount: 23800, kinds: ["charge"],
    rowIds: ["ch_x"], overdueFrom: new Date(NOW - 12 * 86400000).toISOString(), paidSince: null, handsOff: "" }, extra || {});
  let v = chase.ladder(debt(), { overdueFrom: debt().overdueFrom }, {}, NOW);
  assert.strictEqual(v.stage, "no-email"); assert.strictEqual(v.tag, "no email on file", "tagged, not given a chase stage");
  assert.strictEqual(v.action, "none", "nothing to write, nothing to send");
  assert.ok(/press Sorted/.test(v.note), "…and it says how to resolve it by hand");
  v = chase.ladder(debt({ overdueFrom: new Date(NOW - 3 * 86400000).toISOString() }), {}, {}, NOW);
  assert.strictEqual(v.tag, "no email on file", "from day one — not a stage it reaches later");
  v = chase.ladder(debt(), { sorted: { at: NOW, rowIds: ["ch_x"] } }, {}, NOW);
  assert.strictEqual(v.stage, "sorted", "Sorted resolves it");
  const daily = fs.readFileSync(root("daily.html"), "utf8");
  assert.ok(/\.mstage\.s-no-email/.test(daily), "the tag has its own colour on the card");

  console.log("v247-one-person.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
