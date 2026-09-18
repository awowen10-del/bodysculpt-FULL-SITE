// v211 — the report may not decide for itself that a payment repeats.
//
// Ash: "you are trying to calculate what a lot of the subscriptions make out to be per
// year, but you do not know whether these are one off payments or subscriptions and I'm
// not sure it's fair to assume."
//
// He is right, and it was worse than an unfair assumption — it was asserted. One table was
// headed "REGULAR PAYMENTS — anything here is a subscription or a standing cost", and every
// merchant in the weekly report carried a "~ a year" figure of (what it cost) ÷ (months it
// appeared in) × 12. A single £400 payment came out as £4,800 a year. Two ad payments of
// different sizes came out as £14,820 a year. Those figures are then what gets ranked, cut
// and acted on, so a guess dressed as a number is worse than no number at all.
//
// The page cannot know what is a subscription. It CAN measure how much the history looks
// like one, and say only that. Two questions, both answerable from the rows: does it come
// every month, and is it the same amount? Both yes is the only combination worth a yearly
// figure. Everything else gets a dash and a question.
const assert = require("assert");
const { boot } = require("./lib/finance-env.cjs");

const R = (id, date, dir, amount, desc, cat = "", km = "") =>
  ({ id, hash: id, date, dir, amount, desc, cat, km });

// Six months, containing one of each shape on purpose.
const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const HISTORY = {};
MONTHS.forEach((ym, i) => {
  const d = (day) => ym + "-" + String(day).padStart(2, "0");
  HISTORY[ym] = [
    // income, so the report has something to be about
    R("in" + i, d(3), "in", 5000, "FASTER PAYMENTS RECEIPT REF.STRIPE FROM Stripe Payments UK Ltd"),
    // a real subscription: same price, every single month
    R("ont" + i, d(5), "out", 249.00, "CARD PAYMENT TO ONTRAPORT INC ON 04-" + ym.slice(5) + "-2026", "Software", "Optional"),
    // a real monthly cost that moves about: ad spend
    R("fb" + i, d(6), "out", 900 + i * 130, "CARD PAYMENT TO FACEBK *D3CPMYZRS2 ON 05-" + ym.slice(5) + "-2026", "Marketing", "Optional"),
  ];
});
// bought something at the same shop twice, six weeks apart, for wildly different amounts
HISTORY["2026-05"].push(R("amz1", "2026-05-11", "out", 43.20, "CARD PAYMENT TO AMAZON BUSINESS ON 10-05-2026", "Retail", "Optional"));
HISTORY["2026-08"].push(R("amz2", "2026-08-14", "out", 311.75, "CARD PAYMENT TO AMAZON BUSINESS ON 13-08-2026", "Retail", "Optional"));
// and one thing, once: a new bench
HISTORY["2026-06"].push(R("bench", "2026-06-18", "out", 400.00, "CARD PAYMENT TO STRENGTHSHOP ON 17-06-2026", "Retail", "Optional"));

const sixMonths = () => JSON.parse(JSON.stringify(HISTORY));
// the row of the long report's table for one merchant
const rowFor = (text, who) => (text.split("\n").find((l) => l.includes(who)) || "");

let pass = 0;
const checks = [];
const ok = (name, fn) => checks.push([name, fn]);

(async () => {
  console.log("v211 don't assume it repeats:");

  const b = await boot({ txns: sixMonths(), now: "2026-09-20" });
  b.ctx.setView("report");
  await new Promise((r) => setTimeout(r, 30));
  b.els.get("repRange").value = "6";
  const report = await b.ctx.buildReport(false);

  /* ================= what the table is allowed to claim ================= */

  ok("THE CLAIM: the table no longer says everything in it is a subscription", async () => {
    assert.ok(!/anything here is a subscription or a standing cost/.test(report),
      "the page cannot know that, so it must not say it");
    assert.ok(/WHAT COMES BACK — AND WHAT ONLY LOOKS LIKE IT DOES/.test(report));
  });

  ok("the same amount every month for six months IS quoted at a yearly rate", async () => {
    const row = rowFor(report, "ONTRAPORT INC");
    assert.ok(/same amount, monthly/.test(row), "six months, £249 every time: " + row);
    assert.ok(/£2,988/.test(row), "£249 x 12, quoted off the repeating amount — not an average");
  });

  ok("a monthly cost that moves about is quoted as a rate, and labelled as one", async () => {
    // ad spend climbing £900 -> £1,550. It really is monthly, so a run rate is fair — but
    // it must not be presented as a fixed price.
    const row = rowFor(report, "FACEBK");
    assert.ok(/monthly, varies/.test(row), row);
    assert.ok(/£\d/.test(row.split("monthly, varies")[1]), "a figure is still given");
    assert.ok(!/same amount/.test(row), "…but never described as a fixed cost");
  });

  ok("two visits to the same shop six months apart get NO yearly figure", async () => {
    const row = rowFor(report, "AMAZON BUSINESS");
    assert.ok(/now and then/.test(row), row);
    assert.ok(/—\s*$|—\s+\w/.test(row.split("now and then")[1]), "a dash, not £710 a year");
    assert.ok(!/£710|£354/.test(row), "nothing invented from two unrelated orders");
  });

  ok("something bought once is never annualised, and is not called a regular payment", async () => {
    // £400 once in six months was read as £4,800 a year by the old code.
    assert.ok(!/£4,800/.test(report), "the invented figure is gone");
    const table = report.slice(report.indexOf("WHAT COMES BACK"), report.indexOf("BIGGEST SINGLE"));
    assert.ok(!/STRENGTHSHOP/.test(table), "one payment is not something that comes back");
    assert.ok(/STRENGTHSHOP/.test(report), "…but it is still in the report, under the biggest payments");
  });

  ok("…and where a one-off DOES have to be listed, it is labelled as one", async () => {
    // The weekly challenge lists every supplier paid that week, however new. That is where
    // a bench bought once has to be told apart from a subscription, by name.
    const c = await boot({ txns: sixMonths(), now: "2026-06-20" });
    c.S.weekStart = c.ctx.weekStartOf("2026-06-18", c.S.settings.weekStartDow);
    const week = await c.ctx.buildWeekChallenge();
    const line = week.split("\n").find((l) => /STRENGTHSHOP/.test(l) && /once only|monthly|now and then/.test(l));
    assert.ok(line, "the bench is in this week's supplier table");
    assert.ok(/once only/.test(line), line);
    assert.ok(/—/.test(line.split("once only")[1]), "with a dash where the yearly figure would be");
  });

  ok("every table carrying a yearly figure carries the warning under it", async () => {
    assert.ok(/'pattern' is what the history shows, not something I have told you/.test(report));
    assert.ok(/ASK ME whether one of those is a subscription before you/.test(report));
    assert.ok(/do not annualise it yourself/.test(report));
  });

  /* ================= the brief that goes with it ================= */

  ok("the brief forbids filling in the gap, and says what to do instead", async () => {
    const forClaude = await b.ctx.buildReport(true);
    assert.ok(/DO NOT INVENT ONE/.test(forClaude));
    assert.ok(/do not multiply the payment up yourself/.test(forClaude));
    assert.ok(/need to know if these repeat/.test(forClaude),
      "the unknowns get ranked separately, not mixed in with the real numbers");
  });

  ok("…and the weekly challenge says the same thing", async () => {
    const week = await b.ctx.buildWeekChallenge();
    assert.ok(/what the history does/.test(week) && /does not say about each supplier/.test(week),
      "the scope line no longer promises a yearly figure for everything");
    assert.ok(/only given where the same amount has come out month after month/.test(week));
    assert.ok(!/WHAT THAT SUPPLIER COSTS ME A YEAR AT THIS RATE/.test(week),
      "…and neither does the table heading");
  });

  /* ================= the measure itself ================= */

  ok("the shape is decided by the rows, and the thresholds are the stated ones", async () => {
    const sh = b.fn.spendShape;
    const rows = (n, amount, startMonth = 4) => Array.from({ length: n }, (_, i) =>
      ({ ym: "2026-0" + (startMonth + i), amount: typeof amount === "function" ? amount(i) : amount }));
    assert.strictEqual(sh(rows(1, 400), 6).shape, "once only");
    assert.strictEqual(sh(rows(1, 400), 6).perYear, null);
    assert.strictEqual(sh(rows(2, 249), 6).shape, "now and then", "two months out of six is not monthly");
    assert.strictEqual(sh(rows(6, 249), 6).shape, "same amount, monthly");
    assert.strictEqual(sh(rows(6, 249), 6).perYear, 2988);
    assert.strictEqual(sh(rows(6, (i) => 900 + i * 130), 6).shape, "monthly, varies");
    assert.strictEqual(sh(rows(3, 249), 6).shape, "now and then", "three of six is only half the time");
    assert.strictEqual(sh(rows(3, 249), 3).shape, "same amount, monthly", "three of three is");
  });

  ok("a 5% wobble is still the same subscription; a real jump is not", async () => {
    const sh = b.fn.spendShape;
    const at = (amts) => sh(amts.map((amount, i) => ({ ym: "2026-0" + (4 + i), amount })), 6);
    assert.strictEqual(at([249, 249, 249, 249, 249, 255]).shape, "same amount, monthly",
      "a price rise of 2% does not turn a subscription into a mystery");
    assert.strictEqual(at([249, 249, 249, 249, 480, 900]).shape, "monthly, varies",
      "…but a third of the payments being wildly different does");
  });

  ok("two months of history is never enough to call anything", async () => {
    const sh = b.fn.spendShape;
    const two = [{ ym: "2026-08", amount: 249 }, { ym: "2026-09", amount: 249 }];
    assert.strictEqual(sh(two, 2).shape, "too little history");
    assert.strictEqual(sh(two, 2).perYear, null, "however much £249 twice looks like a subscription");
  });

  ok("a yearly figure is quoted off the repeating amount, not the average", async () => {
    // One month a supplier double-charged. The average would quote the subscription 8%
    // high for the next twelve months, and that error is the whole basis of a cut decision.
    const sh = b.fn.spendShape;
    const rows = [249, 249, 249, 498, 249, 249].map((amount, i) => ({ ym: "2026-0" + (4 + i), amount }));
    const got = sh(rows, 6);
    assert.strictEqual(got.shape, "same amount, monthly");
    assert.strictEqual(got.perYear, 2988, "the £498 month does not drag the yearly figure up");
  });

  for (const [name, fn] of checks) { await fn(); pass++; console.log("  ok " + name); }
  console.log("v211 dont-assume-it-repeats: " + pass + " checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
