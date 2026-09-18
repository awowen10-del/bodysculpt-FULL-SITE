// v212 — the transactions export.
//
// Ash: "I would like the ability to export the transactions tab so if I need to send it to
// Claude, I can... but it has to be tidy. It needs to explain the difference between
// transfers, directors loans, personal drawings etc — otherwise it will query me line to
// line and that will be slow."
//
// The last sentence is the requirement. A bank export on its own buys an interrogation:
// what is this £2,090.74 in from Capital One, why is £300 going to yourself every week, is
// this payment to you wages or a loan. Every one of those is already answered on this page,
// so the file has to carry the answers or they get asked one line at a time.
//
// CSV rather than PDF or XLSX. A PDF has to be re-parsed out of laid-out text; XLSX needs a
// zip writer in a page with no build step; CSV is every row exactly, opens in Excel, and is
// the only one of the three that can carry a plain-English preamble without special
// handling — as long as the preamble is real CSV rows rather than "#" comments, which is
// what these checks are mostly about.
const assert = require("assert");
const { boot } = require("./lib/finance-env.cjs");

const R = (id, date, dir, amount, desc, cat = "", km = "", src = "", del = false) =>
  ({ id, hash: id, date, dir, amount, desc, cat, km, src, del });

// One of every shape, including the two payments to himself on the same day that are NOT
// the same kind of thing — the pair that would otherwise generate a question.
const SEP = [
  R("a", "2026-09-03", "in", 1840.00, "FASTER PAYMENTS RECEIPT REF.STRIPE FROM Stripe Payments UK Ltd", "", "", "stripe"),
  R("b", "2026-09-04", "out", 1200.00, "BILL PAYMENT VIA FASTER PAYMENT TO PTS PROPERTY LTD", "Rent", "Essential"),
  R("c", "2026-09-05", "in", 1075.56, "TRANSFER FROM TAX ACCOUNT", "Transfer", "", "transfer"),
  R("d", "2026-09-08", "in", 2090.74, "CAPITAL ONE", "Directors loan", "", "other"),
  R("e", "2026-09-08", "out", 2090.74, "FASTER PAYMENTS TO ASHLEY OWEN", "Directors loan", ""),
  R("f", "2026-09-10", "out", 300.00, "FASTER PAYMENTS TO BODYSCULPT TRANSFORMATION CENTRES", "Transfer", ""),
  R("g", "2026-09-12", "out", 1500.00, "FASTER PAYMENTS TO ASHLEY OWEN", "Owners Pay", "Essential"),
  R("h", "2026-09-14", "out", 24.99, 'CARD PAYMENT TO "CANVA", 24.99 GBP', "Software", "Optional"),
  R("i", "2026-09-15", "out", 13.00, "A DUPLICATE ROW", "", "", "", true),
];
const AUG = [
  R("j", "2026-08-03", "in", 1600.00, "FASTER PAYMENTS RECEIPT REF.STRIPE FROM Stripe Payments UK Ltd", "", "", "stripe"),
  R("k", "2026-08-04", "out", 1200.00, "BILL PAYMENT VIA FASTER PAYMENT TO PTS PROPERTY LTD", "Rent", "Essential"),
];
const months = () => JSON.parse(JSON.stringify({ "2026-08": AUG, "2026-09": SEP }));

// A real CSV reader, so the checks below are about the FILE and not about the string that
// happened to be built. Anything the parser cannot read is a bug in the file.
function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\r") { /* part of CRLF */ }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const build = async (b, n) => {
  b.els.get("expRange").value = String(n);
  const { rows, label } = await b.ctx.exportRows();
  return b.ctx.buildTxnCsv(rows, label);
};
// the data table: everything from the header row down
const table = (csv) => {
  const rows = parseCsv(csv);
  const h = rows.findIndex((r) => r[0] === "Date" && r[1] === "Description");
  return { head: rows[h], body: rows.slice(h + 1).filter((r) => r.length > 1) };
};
const colOf = (head, name) => head.indexOf(name);
const find = (t, desc) => t.body.find((r) => r[1].includes(desc));

let pass = 0;
const checks = [];
const ok = (name, fn) => checks.push([name, fn]);

(async () => {
  console.log("v212 hand it over:");

  const b = await boot({ txns: months(), now: "2026-09-20" });
  const csv = await build(b, 1);
  const t = table(csv);
  const C = (n) => colOf(t.head, n);

  /* ================= it is a real CSV ================= */

  ok("the whole file parses as CSV, preamble and all", async () => {
    const rows = parseCsv(csv);
    assert.ok(rows.length > 20, "it read something");
    // the preamble is CSV rows, not "#" comments — a spreadsheet must not choke on it
    assert.ok(!/^#/m.test(csv), "no comment syntax that only a human can skip");
    assert.strictEqual(rows[0][0], "Bodysculpt Warrington — transactions");
  });

  ok("a description containing a comma and a quote survives intact", async () => {
    // the classic CSV bug: one comma in a merchant name shifts every column after it
    const row = find(t, "CANVA");
    assert.strictEqual(row[1], 'CARD PAYMENT TO "CANVA", 24.99 GBP', "exactly as the bank wrote it");
    assert.strictEqual(row[C("Money out")], "24.99", "and the columns after it did not move");
    assert.strictEqual(row[C("Category")], "Software");
  });

  ok("it ends every line the way a spreadsheet expects", async () => {
    assert.ok(csv.endsWith("\r\n"), "CRLF, and a final newline");
  });

  /* ================= what Ash actually asked for ================= */

  ok("THE ASK: the file explains transfers, directors loans and drawings before the data", async () => {
    const head = csv.slice(0, csv.indexOf('"Date","Description"'));
    assert.ok(/READ THIS FIRST/.test(head), "and it says to read it");
    assert.ok(/Transfer — not counted/.test(head) && /between my OWN accounts/.test(head));
    assert.ok(/Directors loan — not counted/.test(head) && /I owe back/.test(head));
    assert.ok(/Deleted — not counted/.test(head));
    assert.ok(/Owners Pay/.test(head) && /This IS a cost and IS counted/.test(head),
      "the one that looks like the other two and is not — this is the question that gets asked");
  });

  ok("…and the legend is above the data, where it gets read", async () => {
    assert.ok(csv.indexOf("READ THIS FIRST") < csv.indexOf('"Date","Description"'));
  });

  ok("every row says what it counts as, in the words the legend used", async () => {
    const seen = {};
    for (const r of t.body) seen[r[C("Counts as")]] = (seen[r[C("Counts as")]] || 0) + 1;
    assert.deepStrictEqual(Object.keys(seen).sort(), [
      "Deleted — not counted", "Directors loan — not counted", "Income", "Spending",
      "Transfer — not counted",
    ]);
    // every label used in the data is defined in the legend above it
    const head = csv.slice(0, csv.indexOf('"Date","Description"'));
    for (const label of Object.keys(seen)) assert.ok(head.includes(label), label + " is explained");
  });

  ok("the two payments to himself on the same day are told apart", async () => {
    // £2,090.74 is the loan passing through; £1,500 is what he actually pays himself.
    // Same name, same account, same week — and not the same kind of thing at all.
    const both = t.body.filter((r) => r[1].includes("ASHLEY OWEN"));
    assert.strictEqual(both.length, 2);
    const loan = both.find((r) => r[C("Money out")] === "2090.74");
    const pay = both.find((r) => r[C("Money out")] === "1500.00");
    assert.strictEqual(loan[C("Counts as")], "Directors loan — not counted");
    assert.strictEqual(pay[C("Counts as")], "Spending");
    assert.strictEqual(pay[C("Category")], "Owners Pay", "…and says which kind of spending");
  });

  ok("a row that counts nowhere does not also carry a spending category", async () => {
    // "Directors loan" repeated under a column headed Category reads as a kind of
    // spending, which is the confusion the file is meant to remove.
    const loan = t.body.find((r) => r[C("Counts as")] === "Directors loan — not counted" && r[C("Money out")]);
    assert.strictEqual(loan[C("Category")], "");
    assert.strictEqual(loan[C("Keep or cut")], "");
  });

  /* ================= it has to add up ================= */

  ok("every line the bank showed is in it, including the deleted one", async () => {
    assert.strictEqual(t.body.length, SEP.length, "nine rows in, nine rows out");
    assert.ok(find(t, "A DUPLICATE ROW"), "the deleted row is present…");
    assert.strictEqual(find(t, "A DUPLICATE ROW")[C("Counts as")], "Deleted — not counted",
      "…and labelled, so the file still reconciles to the statement");
  });

  ok("the totals in the preamble are the page's own totals, and name what was left out", async () => {
    const head = csv.slice(0, csv.indexOf('"Date","Description"'));
    assert.ok(/"Money in","£1,840\.00"/.test(head), "the transfer in and the loan in are NOT income");
    assert.ok(/"Money out","£2,724\.99"/.test(head), "1200 + 1500 + 24.99; not the loan, pot move or deleted row");
    assert.ok(/of which Owners Pay \(my drawings\)","£1,500\.00"/.test(head));
    assert.ok(/transfers between my own accounts","£300\.00 out, £1,075\.56 back in"/.test(head));
    assert.ok(/directors loan","£2,090\.74 drawn, £2,090\.74 paid out"/.test(head));
    assert.ok(/deleted rows","1"/.test(head));
  });

  ok("the totals agree with what the cockpit shows", async () => {
    // if these two ever disagree, the file is arguing with the page it came from
    assert.strictEqual(b.fn.moneyIn(b.S.rows), 1840);
    assert.strictEqual(b.fn.moneyOut(b.S.rows), 2724.99);
  });

  /* ================= the shape of the thing ================= */

  ok("amounts are plain numbers in two columns, not signed text with a currency symbol", async () => {
    const inn = find(t, "STRIPE");
    assert.strictEqual(inn[C("Money in")], "1840.00");
    assert.strictEqual(inn[C("Money out")], "", "direction is which column it is in");
    assert.ok(!/[£-]/.test(inn[C("Money in")]), "a spreadsheet has to be able to sum it");
  });

  ok("dates are sortable, and the rows are in date order", async () => {
    const dates = t.body.map((r) => r[0]);
    assert.ok(dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
    assert.deepStrictEqual(dates, dates.slice().sort());
  });

  ok("income carries its source and no expense columns", async () => {
    const inn = find(t, "STRIPE");
    assert.strictEqual(inn[C("Source")], "stripe");
    assert.strictEqual(inn[C("Category")], "", "a credit has no expense category");
    const out = find(t, "PTS PROPERTY");
    assert.strictEqual(out[C("Source")], "", "and an expense has no source");
  });

  /* ================= how much of it ================= */

  ok("it can cover more than the month on screen", async () => {
    const wide = table(await build(b, 3));
    assert.strictEqual(wide.body.length, SEP.length + AUG.length);
    assert.ok(/"Period","Aug 2026 to Sep 2026"/.test(await build(b, 3)), "and says which months");
  });

  ok("the month on screen is taken from what is in hand, not re-fetched", async () => {
    // it must include an edit that has not been saved yet, and the deleted rows S.all holds
    b.els.get("expRange").value = "1";
    b.S.all.find((r) => r.id === "b").cat = "Website";
    const one = table(await build(b, 1));
    assert.strictEqual(find(one, "PTS PROPERTY")[colOf(one.head, "Category")], "Website");
    b.S.all.find((r) => r.id === "b").cat = "Rent";
  });

  ok("an empty month exports nothing rather than an empty file", async () => {
    const c = await boot({ txns: {}, now: "2026-09-20" });
    c.els.get("expRange").value = "1";
    await c.ctx.doExport(false);
    assert.ok(/Nothing to export/.test(c.els.get("toast").textContent));
  });

  /* ================= the two ways out ================= */

  ok("Copy puts the same file on the clipboard", async () => {
    const c = await boot({ txns: months(), now: "2026-09-20" });
    c.els.get("expRange").value = "1";
    await c.ctx.doExport(true);
    assert.strictEqual(c.clipboard.length, 1);
    assert.ok(/READ THIS FIRST/.test(c.clipboard[0]), "legend and all");
    assert.ok(/9 rows/.test(c.els.get("toast").textContent));
  });

  ok("Download names the file after the months it holds", async () => {
    const c = await boot({ txns: months(), now: "2026-09-20" });
    const made = [];
    c.ctx.document.createElement = (tag) => {
      const el = { tag, style: {}, click() { made.push({ href: this.href, download: this.download }); },
        remove() {}, setAttribute() {}, classList: { add() {}, remove() {}, toggle() {} },
        appendChild() {}, querySelectorAll: () => [], querySelector: () => null };
      return el;
    };
    c.els.get("expRange").value = "1";
    await c.ctx.doExport(false);
    assert.strictEqual(made.length, 1);
    assert.strictEqual(made[0].download, "bodysculpt-transactions-2026-09.csv");
    assert.ok(made[0].href.startsWith("data:text/csv;charset=utf-8,"));
    assert.ok(decodeURIComponent(made[0].href.split(",").slice(1).join(",")).includes("READ THIS FIRST"));
  });

  for (const [name, fn] of checks) { await fn(); pass++; console.log("  ok " + name); }
  console.log("v212 hand-it-over: " + pass + " checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
