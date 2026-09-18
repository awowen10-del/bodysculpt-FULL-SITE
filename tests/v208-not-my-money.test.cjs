// v208 — money that is not mine.
//
// Two real statements started this. £1,075.56 came from the tax account into the main
// account and the page called it income. £2,090.74 was drawn off the Capital One card and
// paid straight out again as a directors loan, and the page called one half income and the
// other half spending. Neither is either: the first is the same money changing pocket, and
// the second is borrowed money passing through on its way back out.
//
// Three things had to be true and one of them was not:
//   1. a credit marked "Transfer" must STAY marked — it did not. kpi-store's cleanTxn
//      wrote `cat: dir === "out" ? ... : ""`, so the answer was accepted by the page,
//      posted, and thrown away by the server. Reopen the month and it was income again.
//      That is the bug this file exists for; the first block below is its regression.
//   2. there had to be somewhere to put a directors loan, which there was not.
//   3. a row had to be deletable — and a delete must survive the next import of an
//      overlapping statement, or the line simply walks back in on Friday.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { boot } = require("./lib/finance-env.cjs");

const SRC = path.join(__dirname, "..", "netlify", "functions", "kpi-store.js");

let pass = 0;
const checks = [];
const ok = (name, fn) => checks.push([name, fn]);

/* ---------------------------------------------------------------------------
   THE SERVER. The real handler against a fake blob store — same swap as
   v122-store-isolation, so the routing and the whitelist under test are what ships.
   --------------------------------------------------------------------------- */
function fakeStore() {
  const m = new Map();
  return {
    _m: m,
    async get(k, o) { const v = m.get(k); if (v === undefined) return null;
      return (o && o.type === "json") ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, v); },
    async list(o) { const p = (o && o.prefix) || "";
      return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })), directories: [] }; },
  };
}

async function loadHandler() {
  const src = fs.readFileSync(SRC, "utf8");
  const patched = src.replace(/^import \{ getStore \} from "@netlify\/blobs";$/m,
    "const getStore = () => globalThis.__fakeStore;");
  const tmp = path.join(os.tmpdir(), "kpi-store-v208-" + process.pid + ".mjs");
  fs.writeFileSync(tmp, patched);
  const mod = await import("file://" + tmp);
  fs.unlinkSync(tmp);
  return mod.default;
}

const POST = (h, body) => h(new Request("https://x/.netlify/functions/kpi-store",
  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const GET = (h, qs) => h(new Request("https://x/.netlify/functions/kpi-store?" + qs));

// One round trip: save these rows, read the month back.
async function roundTrip(handler, rows) {
  await POST(handler, { finTxns: { ym: "2026-09", rows } });
  const got = await (await GET(handler, "fintxns=2026-09")).json();
  return got.rows;
}

/* ---------------------------------------------------------------------------
   THE PAGE.
   --------------------------------------------------------------------------- */
// The two statement lines that started this, plus enough ordinary trade around them
// that the totals have something to be wrong about.
const SEP = [
  { id: "a", hash: "a", date: "2026-09-03", dir: "in", amount: 1840.00, desc: "STRIPE PAYMENTS", src: "stripe", cat: "" },
  { id: "b", hash: "b", date: "2026-09-04", dir: "out", amount: 1200.00, desc: "PTS PROPERTY LTD", cat: "Rent", km: "Essential" },
  // the tax pot coming back — his own money, wrongly counted as income
  { id: "tax", hash: "tax", date: "2026-09-05", dir: "in", amount: 1075.56, desc: "TRANSFER FROM TAX ACCOUNT", src: "other", cat: "" },
  // the card draw, and the same money paid out to himself the same day
  { id: "loanin", hash: "loanin", date: "2026-09-08", dir: "in", amount: 2090.74, desc: "CAPITAL ONE", src: "other", cat: "" },
  { id: "loanout", hash: "loanout", date: "2026-09-08", dir: "out", amount: 2090.74, desc: "ASHLEY OWEN", cat: "Owners Pay", km: "Essential" },
  // a genuine weekly pot move, which must keep behaving exactly as it always has
  { id: "pot", hash: "pot", date: "2026-09-10", dir: "out", amount: 300.00, desc: "BODYSCULPT TRANSFORMATION CENTRES", cat: "Transfer", km: "" },
];
const clone = () => JSON.parse(JSON.stringify(SEP));
const at = (rows, id) => rows.find((r) => r.id === id);

(async () => {
  console.log("v208 not my money:");
  const handler = await loadHandler();
  globalThis.__fakeStore = fakeStore();

  /* ================= the bug ================= */

  ok("THE BUG: a credit marked Transfer is still marked Transfer when the month is reopened", async () => {
    const rows = await roundTrip(handler, [
      { id: "x1", hash: "x1", date: "2026-09-05", dir: "in", amount: 1075.56,
        desc: "TRANSFER FROM TAX ACCOUNT", cat: "Transfer", src: "transfer" },
    ]);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].cat, "Transfer",
      "the answer was posted and accepted — it must come back, or the row is income again");
  });

  ok("a credit marked as a directors loan comes back marked as a directors loan", async () => {
    const rows = await roundTrip(handler, [
      { id: "x2", hash: "x2", date: "2026-09-08", dir: "in", amount: 2090.74,
        desc: "CAPITAL ONE", cat: "Directors loan", src: "other" },
    ]);
    assert.strictEqual(rows[0].cat, "Directors loan");
  });

  ok("but a credit cannot be given an expense category", async () => {
    const rows = await roundTrip(handler, [
      { id: "x3", hash: "x3", date: "2026-09-08", dir: "in", amount: 10, desc: "WHATEVER", cat: "Software" },
    ]);
    assert.strictEqual(rows[0].cat, "", "Software is not one of the three things a credit can be");
  });

  ok("an expense keeps whatever category it was given, including the two that count nowhere", async () => {
    const rows = await roundTrip(handler, [
      { id: "y1", hash: "y1", date: "2026-09-04", dir: "out", amount: 1200, desc: "PTS PROPERTY LTD", cat: "Rent" },
      { id: "y2", hash: "y2", date: "2026-09-10", dir: "out", amount: 300, desc: "OWN POT", cat: "Transfer" },
      { id: "y3", hash: "y3", date: "2026-09-08", dir: "out", amount: 2090.74, desc: "ASHLEY OWEN", cat: "Directors loan" },
    ]);
    assert.deepStrictEqual(rows.map((r) => r.cat).sort(), ["Directors loan", "Rent", "Transfer"]);
  });

  ok("a deleted row is KEPT in the store, flagged rather than dropped", async () => {
    const rows = await roundTrip(handler, [
      { id: "d1", hash: "d1", date: "2026-09-05", dir: "in", amount: 1075.56, desc: "GONE", del: true },
      { id: "d2", hash: "d2", date: "2026-09-06", dir: "in", amount: 20, desc: "STAYS" },
    ]);
    assert.strictEqual(rows.length, 2, "nothing is thrown away — that is what makes it undoable");
    assert.strictEqual(at(rows, "d1").del, true);
    assert.strictEqual(at(rows, "d2").del, false, "and a normal row is explicitly not deleted");
  });

  ok("a long id survives, so two payments to one merchant on one day stay separate rows", async () => {
    // The id IS the dedupe hash. At the old 40-character cap these two truncated to the
    // same string, and editing one silently edited the other.
    const h1 = "2026-09-09|CARD PAYMENT TO AMAZON MARKETPLACE LONDON GB|13.99|out";
    const h2 = "2026-09-09|CARD PAYMENT TO AMAZON MARKETPLACE LONDON GB|48.50|out";
    assert.strictEqual(h1.slice(0, 40), h2.slice(0, 40), "they really do collide at 40");
    const rows = await roundTrip(handler, [
      { id: h1, hash: h1, date: "2026-09-09", dir: "out", amount: 13.99, desc: "AMAZON", cat: "Retail" },
      { id: h2, hash: h2, date: "2026-09-09", dir: "out", amount: 48.50, desc: "AMAZON", cat: "Retail" },
    ]);
    assert.strictEqual(rows.length, 2);
    assert.notStrictEqual(rows[0].id, rows[1].id, "two rows, two ids");
    assert.ok(rows.map((r) => r.id).includes(h1), "and the id is the whole hash, untruncated");
  });

  /* ================= the page ================= */

  ok("out of the box, the tax-account credit and the card draw are counted as income", async () => {
    // The starting position, stated plainly, so the fixes below have something to be a fix TO.
    const { S, fn } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    assert.strictEqual(fn.moneyIn(S.rows), 1840 + 1075.56 + 2090.74);
  });

  ok("marking the tax-account credit as a Transfer takes it out of money in", async () => {
    const rows = clone();
    at(rows, "tax").cat = "Transfer";
    const { S, fn } = await boot({ txns: { "2026-09": rows }, now: "2026-09-15" });
    assert.strictEqual(fn.moneyIn(S.rows), 1840 + 2090.74, "£1,075.56 is not income");
    assert.strictEqual(fn.transfersIn(S.rows), 1075.56, "it is money coming back from his own pot");
  });

  ok("both halves of the directors loan drop out — the credit AND the payment to himself", async () => {
    const rows = clone();
    at(rows, "loanin").cat = "Directors loan";
    at(rows, "loanout").cat = "Directors loan";
    const { S, fn } = await boot({ txns: { "2026-09": rows }, now: "2026-09-15" });
    assert.strictEqual(fn.moneyIn(S.rows), 1840 + 1075.56, "the draw is not income");
    assert.strictEqual(fn.moneyOut(S.rows), 1200, "and paying himself with it is not spending");
    assert.strictEqual(fn.loanIn(S.rows), 2090.74);
    assert.strictEqual(fn.loanOut(S.rows), 2090.74);
  });

  ok("and a directors loan is never mistaken for the weekly pot move", async () => {
    // This is why it is not just another Transfer: the Profit First week reads the transfer
    // figures as "what actually left the account for your pots", and £2,090.74 landing in
    // there would say the pots were moved when they were not.
    const rows = clone();
    at(rows, "loanout").cat = "Directors loan";
    const { S, fn } = await boot({ txns: { "2026-09": rows }, now: "2026-09-15" });
    assert.strictEqual(fn.transfersOut(S.rows), 300, "only the real pot move, not the loan");
  });

  ok("neither kind shows up in the breakdown of where the money went", async () => {
    const rows = clone();
    at(rows, "loanout").cat = "Directors loan";
    const { ctx, els } = await boot({ txns: { "2026-09": rows }, now: "2026-09-15" });
    ctx.renderBreakdown();
    const html = els.get("bdRows").innerHTML;
    assert.ok(html.includes("Rent"), "the rent is in it");
    assert.ok(!html.includes("Directors loan"), "the loan is not");
    assert.ok(!html.includes("Transfer"), "and nor is the pot move, as before");
  });

  ok("money that does not count is still named on the cockpit, never silently dropped", async () => {
    const rows = clone();
    at(rows, "tax").cat = "Transfer";
    at(rows, "loanin").cat = "Directors loan";
    at(rows, "loanout").cat = "Directors loan";
    const { els } = await boot({ txns: { "2026-09": rows }, now: "2026-09-15" });
    const note = els.get("xferNote").textContent;
    assert.ok(/Not counted above/.test(note));
    assert.ok(note.includes("£300.00"), "the pot move is named");
    assert.ok(note.includes("£1,075.56"), "the money brought back is named");
    assert.ok(/directors loan/.test(note) && note.includes("£2,090.74"), "the loan is named");
  });

  ok("the credit dropdown offers exactly income, Transfer and Directors loan", async () => {
    const { ctx, S } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    const html = ctx.inSelect(at(S.rows, "tax"));
    assert.strictEqual((html.match(/<option/g) || []).length, 3);
    assert.ok(html.includes("Transfer"));
    assert.ok(html.includes("Directors loan"));
    assert.ok(!html.includes("Rent"), "a credit never gets the expense list");
  });

  ok("both non-counting categories are offered on an expense even if the saved list predates them", async () => {
    // The seeded settings list is the old one, with Transfer and no Directors loan — which
    // is exactly what is in the live store right now.
    const { fn } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    const cats = [...fn.catList()];
    assert.strictEqual(cats[cats.length - 2], "Transfer");
    assert.strictEqual(cats[cats.length - 1], "Directors loan");
    assert.strictEqual(cats.filter((c) => c === "Transfer").length, 1, "and not listed twice");
  });

  ok("the Own accounts box takes a list, so more than one account name is recognised", async () => {
    const { ctx } = await boot({ txns: {}, now: "2026-09-15",
      settings: { transferKeyword: "BODYSCULPT TRANSFORMATION CENTRES, TAX ACCOUNT, CAPITAL ONE" } });
    assert.ok(ctx.looksLikeTransfer("TRANSFER TO BODYSCULPT TRANSFORMATION CENTRES"));
    assert.ok(ctx.looksLikeTransfer("TRANSFER FROM TAX ACCOUNT"));
    assert.ok(ctx.looksLikeTransfer("CAPITAL ONE"));
    assert.ok(!ctx.looksLikeTransfer("STRIPE PAYMENTS"), "and an ordinary credit is untouched");
  });

  ok("one keyword with no comma behaves exactly as it did before", async () => {
    const { ctx } = await boot({ txns: {}, now: "2026-09-15" });
    assert.ok(ctx.looksLikeTransfer("TRANSFER TO BODYSCULPT TRANSFORMATION CENTRES LTD"));
    assert.ok(!ctx.looksLikeTransfer("GC C1 BODYSCULPT"));
  });

  ok("an empty box still matches nothing at all", async () => {
    const { ctx } = await boot({ txns: {}, now: "2026-09-15", settings: { transferKeyword: "  ,  " } });
    assert.ok(!ctx.looksLikeTransfer("ANYTHING"), "an empty list must never match every row");
  });

  /* ================= deleting a line ================= */

  ok("deleting a line takes it out of every total", async () => {
    const { ctx, S, fn } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    await ctx.setDeleted("tax", true);
    assert.strictEqual(fn.moneyIn(S.rows), 1840 + 2090.74);
    assert.strictEqual(S.rows.length, 5, "it is off the page");
    assert.strictEqual(S.all.length, 6, "but still in the month");
  });

  ok("…and the deleted row is written back to the store, not erased from it", async () => {
    const { ctx, store } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    await ctx.setDeleted("tax", true);
    const saved = store.txns["2026-09"];
    assert.strictEqual(saved.length, 6, "the month still has six rows");
    assert.strictEqual(at(saved, "tax").del, true);
    assert.strictEqual(at(saved, "tax").amount, 1075.56, "with its figures intact, ready to be put back");
  });

  ok("…so the next import of an overlapping statement does not bring it back", async () => {
    // The whole reason a delete is a flag and not a removal: the hash has to stay in the
    // month, because the hash is what the importer checks.
    const rows = clone();
    at(rows, "tax").del = true;
    const { ctx } = await boot({ txns: { "2026-09": rows }, now: "2026-09-15" });
    const existing = await ctx.loadMonthsFor([{ date: "2026-09-05" }]);
    const have = new Set(existing["2026-09"].map((r) => r.hash));
    assert.ok(have.has("tax"), "the deleted row's hash is still there for the importer to find");
  });

  ok("putting it back restores it exactly", async () => {
    const { ctx, S, fn } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    await ctx.setDeleted("tax", true);
    await ctx.setDeleted("tax", false);
    assert.strictEqual(S.rows.length, 6);
    assert.strictEqual(fn.moneyIn(S.rows), 1840 + 1075.56 + 2090.74);
    assert.strictEqual(fn.deletedRows().length, 0);
  });

  ok("a deleted row is never offered for categorising and never counted as needing review", async () => {
    const rows = clone();
    const stray = { id: "stray", hash: "stray", date: "2026-09-11", dir: "out",
      amount: 44, desc: "SOMETHING ODD", cat: "", km: "", del: true };
    rows.push(stray);
    const { S, els, ctx } = await boot({ txns: { "2026-09": rows }, now: "2026-09-15" });
    assert.strictEqual(S.rows.filter((r) => r.dir === "out" && !r.cat).length, 0);
    ctx.renderTxns();
    assert.ok(!/need a category/.test(els.get("txMsg").textContent));
    assert.ok(els.get("txMsg").textContent.includes("1 deleted"), "but it is counted, and said");
  });

  ok("the Deleted chip appears only once something has been deleted", async () => {
    const { ctx, els } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    ctx.renderTxns();
    assert.strictEqual(els.get("binChip").hidden, true, "an empty bin is nothing to look at");
    await ctx.setDeleted("tax", true);
    assert.strictEqual(els.get("binChip").hidden, false);
    assert.strictEqual(els.get("binChip").textContent, "Deleted (1)");
  });

  ok("the deleted list shows the deleted rows and nothing else", async () => {
    const { ctx, S } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    await ctx.setDeleted("tax", true);
    S.filter = "deleted";
    const shown = [...ctx.visibleRows()].map((r) => r.id);
    assert.deepStrictEqual(shown, ["tax"]);
  });

  ok("a failed save puts the row straight back, so the page never lies about what is stored", async () => {
    const { ctx, S, fn } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    const realFetch = ctx.fetch;
    ctx.fetch = (url, o) => (o && o.method === "POST")
      ? Promise.reject(new Error("offline")) : realFetch(url, o);
    await ctx.setDeleted("tax", true);
    ctx.fetch = realFetch;
    assert.strictEqual(fn.deletedRows().length, 0, "the delete was rolled back");
    assert.strictEqual(S.rows.length, 6);
  });

  /* ================= nothing else moved ================= */

  ok("an ordinary month is totalled exactly as it was before any of this", async () => {
    const { S, fn, els } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    assert.strictEqual(fn.moneyOut(S.rows), 1200 + 2090.74, "the pot move is still excluded");
    assert.strictEqual(fn.transfersOut(S.rows), 300);
    assert.ok(els.get("statRow").innerHTML.includes("Money in"), "and the cockpit still renders");
  });

  for (const [name, fn] of checks) { await fn(); pass++; console.log("  ok " + name); }
  console.log("v208 not-my-money: " + pass + " checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
