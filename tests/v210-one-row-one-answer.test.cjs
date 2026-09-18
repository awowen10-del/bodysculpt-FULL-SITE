// v210 — a credit's category is about that payment, not about the merchant.
//
// Ash marked ONE credit as a directors loan and every other credit on the Income tab
// turned into a directors loan with it.
//
// The cause was a category error, not a missing null check. onCellChange has always done
// two extra things whenever a category is set: it learns a rule from the merchant, and it
// fills in every other uncategorised row in the month that the rule now covers. That is
// the best thing about the page — categorising is a one-time act — and it is correct for
// an EXPENSE, because an expense category is a fact about a merchant: rent is always rent.
// It was written when a credit could not carry a category at all, so it never checked the
// direction. v208 let credits carry one, and the block happily learned "GC C1 BODYSCULPT →
// Directors loan" and swept it across every takings line sharing that description.
//
// A credit's category is a fact about ONE PAYMENT — "this particular £2,090.74 is borrowed
// and I owe it back". There is nothing about the merchant to learn, so nothing is learned.
const assert = require("assert");
const { boot } = require("./lib/finance-env.cjs");

// A month shaped like his: several takings lines sharing a description, because that is
// what makes one click able to hit all of them.
const SEP = [
  { id: "gc1", hash: "gc1", date: "2026-09-02", dir: "in", amount: 480.00, desc: "GC C1 BODYSCULPT TRANSFO", src: "gocardless", cat: "" },
  { id: "gc2", hash: "gc2", date: "2026-09-09", dir: "in", amount: 520.00, desc: "GC C1 BODYSCULPT TRANSFO", src: "gocardless", cat: "" },
  { id: "gc3", hash: "gc3", date: "2026-09-16", dir: "in", amount: 610.00, desc: "GC C1 BODYSCULPT TRANSFO", src: "gocardless", cat: "" },
  { id: "st1", hash: "st1", date: "2026-09-04", dir: "in", amount: 1840.00, desc: "STRIPE PAYMENTS", src: "stripe", cat: "" },
  { id: "loanin", hash: "loanin", date: "2026-09-08", dir: "in", amount: 2090.74, desc: "CAPITAL ONE", src: "other", cat: "" },
  { id: "rent", hash: "rent", date: "2026-09-04", dir: "out", amount: 1200.00, desc: "PTS PROPERTY LTD", cat: "", km: "" },
  { id: "amz1", hash: "amz1", date: "2026-09-05", dir: "out", amount: 24.99, desc: "CARD PAYMENT TO AMAZON UK", cat: "", km: "" },
  { id: "amz2", hash: "amz2", date: "2026-09-11", dir: "out", amount: 51.40, desc: "CARD PAYMENT TO AMAZON UK", cat: "", km: "" },
];
const clone = () => JSON.parse(JSON.stringify(SEP));
const at = (rows, id) => rows.find((r) => r.id === id);

// Drive the real handler the page attaches to the <select>, rather than calling
// onCellChange with a hand-made object — the wiring is part of what is under test.
const setCell = async (b, id, field, value) => {
  const el = { dataset: { id, f: field }, value, classList: { toggle() {} } };
  await b.ctx.onCellChange(el);
  await b.settle(); await b.settle();
};

const toastButton = (els) => (els.get("toast").children || []).find((c) => c.className === "undo") || null;

let pass = 0;
const checks = [];
const ok = (name, fn) => checks.push([name, fn]);

(async () => {
  console.log("v210 one row, one answer:");

  /* ================= the bug ================= */

  ok("THE BUG: marking one credit as a directors loan leaves every other credit alone", async () => {
    const b = await boot({ txns: { "2026-09": clone() }, now: "2026-09-20" });
    await setCell(b, "loanin", "cat", "Directors loan");
    assert.strictEqual(at(b.S.rows, "loanin").cat, "Directors loan", "the one he clicked");
    for (const id of ["gc1", "gc2", "gc3", "st1"]) {
      assert.strictEqual(at(b.S.rows, id).cat, "", id + " is untouched");
    }
  });

  ok("…even when the other credits share its description word for word", async () => {
    // The shape that did the damage: three GoCardless lines with identical descriptions.
    const b = await boot({ txns: { "2026-09": clone() }, now: "2026-09-20" });
    await setCell(b, "gc1", "cat", "Directors loan");
    assert.strictEqual(at(b.S.rows, "gc1").cat, "Directors loan");
    assert.strictEqual(at(b.S.rows, "gc2").cat, "", "the identical line beside it is not swept up");
    assert.strictEqual(at(b.S.rows, "gc3").cat, "");
  });

  ok("…and marking one as a Transfer does not sweep either", async () => {
    const b = await boot({ txns: { "2026-09": clone() }, now: "2026-09-20" });
    await setCell(b, "gc2", "cat", "Transfer");
    assert.strictEqual(at(b.S.rows, "gc2").cat, "Transfer");
    assert.strictEqual(at(b.S.rows, "gc1").cat, "");
    assert.strictEqual(at(b.S.rows, "gc3").cat, "");
  });

  ok("a credit never teaches a rule, so no future import is poisoned either", async () => {
    const b = await boot({ txns: { "2026-09": clone() }, now: "2026-09-20" });
    await setCell(b, "loanin", "cat", "Directors loan");
    await setCell(b, "gc1", "cat", "Transfer");
    assert.deepStrictEqual([...b.S.rules], [], "nothing was learned from either");
    assert.strictEqual(b.posts.filter((p) => p.finRules).length, 0, "and nothing was written to the rules table");
  });

  ok("the money follows: only that one credit leaves Money in", async () => {
    const b = await boot({ txns: { "2026-09": clone() }, now: "2026-09-20" });
    const before = b.fn.moneyIn(b.S.rows);
    await setCell(b, "loanin", "cat", "Directors loan");
    assert.strictEqual(b.fn.moneyIn(b.S.rows), before - 2090.74, "£2,090.74 and not a penny more");
  });

  ok("the credit change is still saved", async () => {
    const b = await boot({ txns: { "2026-09": clone() }, now: "2026-09-20" });
    await setCell(b, "loanin", "cat", "Directors loan");
    await new Promise((r) => setTimeout(r, 700));   // past the save debounce
    await b.settle();
    assert.strictEqual(at(b.store.txns["2026-09"], "loanin").cat, "Directors loan");
  });

  /* ================= what must NOT have changed ================= */

  ok("an EXPENSE still teaches a rule and still fills in the others — that is the whole page", async () => {
    const b = await boot({ txns: { "2026-09": clone() }, now: "2026-09-20" });
    await setCell(b, "amz1", "cat", "Retail");
    assert.strictEqual(at(b.S.rows, "amz2").cat, "Retail", "the second Amazon line is filled in");
    assert.ok(b.S.rules.some((r) => r.cat === "Retail"), "and it was remembered");
  });

  ok("…and an expense sweep can now be taken back in one click", async () => {
    const b = await boot({ txns: { "2026-09": clone() }, now: "2026-09-20" });
    await setCell(b, "amz1", "cat", "Retail");
    const undo = toastButton(b.els);
    assert.ok(undo, "N rows changed on one click, so there is an Undo on it");
    undo.onclick();
    await b.settle(); await b.settle();
    assert.strictEqual(at(b.S.rows, "amz2").cat, "", "the other row is back as it was");
    assert.strictEqual(at(b.S.rows, "amz1").cat, "Retail", "but the one he actually clicked keeps its answer");
    assert.deepStrictEqual([...b.S.rules], [], "and the rule that caused the sweep is gone with it");
  });

  ok("an expense that sweeps nothing says so quietly, with nothing to undo", async () => {
    const b = await boot({ txns: { "2026-09": clone() }, now: "2026-09-20" });
    await setCell(b, "rent", "cat", "Rent");
    assert.strictEqual(toastButton(b.els), null);
    assert.ok(b.S.rules.some((r) => r.cat === "Rent"), "it is still remembered for next time");
  });

  /* ================= getting back what was already lost ================= */

  ok("the Income view names every credit that is not being counted as income", async () => {
    const rows = clone();
    // the state Ash was left in: the sweep marked all of them
    for (const r of rows) if (r.dir === "in") r.cat = "Directors loan";
    const b = await boot({ txns: { "2026-09": rows }, now: "2026-09-20" });
    b.S.filter = "in";
    b.ctx.renderTxns();
    assert.strictEqual(b.els.get("incNote").hidden, false);
    const note = b.els.get("incNoteText").textContent;
    assert.ok(note.includes("5 credits are marked as not income"), "how many");
    assert.ok(note.includes("5 as a directors loan"), "and as what");
    assert.ok(note.includes("£5,540.74"), "and what it is worth — the figure missing from Money in");
  });

  ok("…and puts them all back to income in one click", async () => {
    const rows = clone();
    for (const r of rows) if (r.dir === "in") r.cat = "Directors loan";
    const b = await boot({ txns: { "2026-09": rows }, now: "2026-09-20" });
    assert.strictEqual(b.fn.moneyIn(b.S.rows), 0, "every penny of income is being ignored");
    await b.ctx.resetCreditsToIncome();
    assert.strictEqual(b.fn.moneyIn(b.S.rows), 5540.74);
    assert.ok(b.S.rows.filter((r) => r.dir === "in").every((r) => !r.cat));
    assert.ok(b.store.txns["2026-09"].filter((r) => r.dir === "in").every((r) => !r.cat), "and it is saved");
  });

  ok("…which is itself undoable, in case some of them were right", async () => {
    const rows = clone();
    at(rows, "loanin").cat = "Directors loan";
    at(rows, "gc1").cat = "Transfer";
    const b = await boot({ txns: { "2026-09": rows }, now: "2026-09-20" });
    await b.ctx.resetCreditsToIncome();
    assert.strictEqual(b.fn.moneyIn(b.S.rows), 5540.74);
    const undo = toastButton(b.els);
    assert.ok(undo);
    undo.onclick();
    await b.settle(); await b.settle(); await b.settle();
    assert.strictEqual(at(b.S.rows, "loanin").cat, "Directors loan", "each one back to what it was");
    assert.strictEqual(at(b.S.rows, "gc1").cat, "Transfer", "including which of the two it was");
  });

  ok("the band is not shown when nothing is excluded, and not on the other views", async () => {
    const b = await boot({ txns: { "2026-09": clone() }, now: "2026-09-20" });
    b.S.filter = "in";
    b.ctx.renderTxns();
    assert.strictEqual(b.els.get("incNote").hidden, true, "nothing excluded, nothing to say");
    const rows = clone();
    at(rows, "loanin").cat = "Directors loan";
    const c = await boot({ txns: { "2026-09": rows }, now: "2026-09-20" });
    c.S.filter = "all";
    c.ctx.renderTxns();
    assert.strictEqual(c.els.get("incNote").hidden, true, "and it belongs on the Income view");
  });

  ok("a reset with nothing to reset writes nothing", async () => {
    const b = await boot({ txns: { "2026-09": clone() }, now: "2026-09-20" });
    const saves = b.posts.filter((p) => p.finTxns).length;
    await b.ctx.resetCreditsToIncome();
    assert.strictEqual(b.posts.filter((p) => p.finTxns).length, saves);
  });

  /* ================= the rule that was already learned ================= */

  ok("a rule learned from an income line is flagged in Settings, not silently deleted", async () => {
    const b = await boot({ txns: { "2026-09": clone() }, now: "2026-09-20",
      rules: [{ match: "GC C1 BODYSCULPT TRANSFO", cat: "Directors loan", km: "" },
              { match: "PTS PROPERTY LTD", cat: "Rent", km: "Essential" }] });
    b.ctx.renderSettings();
    assert.strictEqual(b.els.get("ruleWarn").hidden, false);
    const warn = b.els.get("ruleWarn").textContent;
    assert.ok(warn.includes("GC C1 BODYSCULPT TRANSFO"), "it names the rule");
    assert.ok(!warn.includes("PTS PROPERTY"), "and not the good one beside it");
    assert.ok(/Nothing has been deleted/.test(warn), "his rules are his — it flags, he decides");
    assert.strictEqual(b.S.rules.length, 2, "and nothing was removed behind his back");
  });

  ok("the weekly pot move is NOT flagged — a Transfer rule on your own account is correct", async () => {
    const b = await boot({ txns: { "2026-09": clone() }, now: "2026-09-20",
      rules: [{ match: "BODYSCULPT TRANSFORMATION CENTRES", cat: "Transfer", km: "" }] });
    b.ctx.renderSettings();
    assert.strictEqual(b.els.get("ruleWarn").hidden, true, "that is the pot move, and it is right");
  });

  ok("nothing is flagged when there is nothing wrong", async () => {
    const b = await boot({ txns: { "2026-09": clone() }, now: "2026-09-20",
      rules: [{ match: "PTS PROPERTY LTD", cat: "Rent", km: "Essential" }] });
    b.ctx.renderSettings();
    assert.strictEqual(b.els.get("ruleWarn").hidden, true);
  });

  for (const [name, fn] of checks) { await fn(); pass++; console.log("  ok " + name); }
  console.log("v210 one-row-one-answer: " + pass + " checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
