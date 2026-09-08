// v129 — the boxes line up, and a job done in the dashboard ticks itself off.
//
// v130 UPDATE: the cash-status row came back OUT of the automatic set. v129 ticked it
// whenever the status came back green or amber, reading the job as "the number is fine".
// Ash reads it as "I have looked at it" — a decision, not a state, and nothing on the page
// can witness it: "that should be a manual switch." So the evidence rule below now has one
// automatic tick that comes from the numbers (nothing left uncategorised) rather than two.
//
// Two things Ash asked for, looking at the cockpit on a wide screen:
//
//  1. "I do not like the alignment of boxes here." The main column and the rail started on
//     the same line and stopped on different ones — the Profit First card ended, then a
//     stretch of nothing sat under it while the rail ran on. Inside the card the same
//     fault: the income lines were four rows against three pot boxes, so the left half
//     stopped halfway up. Now the columns STRETCH to a shared bottom edge, the card's
//     footnote sits on that edge instead of dangling above it, and what actually left the
//     account moved under the income it came from, which balances the two halves and
//     reads in the order it happened.
//
//  2. "When I actually do something inside of this — such as import statements, it should
//     automatically tick off that job for me… any other job that's done inside of this
//     dashboard should tick off automatically once it's actually done."
//
// The rule the ticking follows, and what this test pins:
//   · a job ticks ONLY on evidence of it happening — an import that added rows, or nothing
//     left uncategorised;
//   · a tick is never taken away, EXCEPT the pots row, which belongs to the Mark-the-money-
//     as-moved button and follows it both ways: undo means it did not happen;
//   · every job the page cannot witness stays manual — the cash-status check, the
//     accountant, the invoices, Stripe, Ontraport, and doing the week's one action. A wrong
//     tick is worse than a missing one, because you would stop trusting the list.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/finance-env.cjs");

const FIN = fs.readFileSync(path.join(__dirname, "..", "finances.html"), "utf8");
const STYLE = FIN.slice(FIN.indexOf("<style>") + 7, FIN.indexOf("</style>"));
const ruleOf = (sel) => {
  const m = new RegExp("\\n  " + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{[^}]*\\}").exec(STYLE);
  return m ? m[0] : null;
};
const ROW = (id, dir, amount, cat, desc) => ({ id, date: "2026-08-06", dir, amount, cat: cat || "",
  desc: desc || (dir === "in" ? "FASTER PAYMENTS RECEIPT REF.STRIPE FROM Stripe Payments UK Ltd" : "CARD PAYMENT TO A SHOP ON 05-08-2026"),
  src: dir === "in" ? "stripe" : "", km: "", hash: id });

let pass = 0;
const ok = (name, fn) => { const r = fn(); pass++; console.log("  ok " + name); return r; };
const okA = async (name, fn) => { await fn(); pass++; console.log("  ok " + name); };

(async () => {
  /* ================= 0. the stamp ================= */
  ok("every page carries the v129 stamp", () => {
    const S = "build v131 · challenge-my-week";
    const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    assert.ok(FIN.includes("<!-- " + S + " -->"), "finances.html stamped v129");
    assert.ok(read("monthly.html").includes('<span class="mp-stage">' + S + "</span>"), "monthly shows it");
    assert.ok(read("index.html").includes(S), "index carries it");
  });

  /* ================= 1. the boxes line up ================= */
  ok("the two columns end on the same line", () => {
    assert.ok(/\.ck-grid\{[^}]*align-items:stretch/.test(STYLE), "the columns stretch to a shared bottom");
    assert.ok(!/\.ck-grid\{[^}]*align-items:start/.test(STYLE), "…the ragged-bottom version is gone");
    assert.ok(/\.ck-main\{[^}]*flex-direction:column/.test(STYLE), "the main column is a column");
    assert.ok(/\.ck-main>\.card\{[^}]*flex:1 1 auto/.test(STYLE), "…and its card fills it");
    assert.ok(/\.ck-main>\.card\{[^}]*flex-direction:column/.test(STYLE), "…as a column itself");
    // v130: no more pooling the slack in one hole above the ask — it spreads across the
    // gaps between the card's sections, where a few pixels in four places is invisible.
    assert.ok(/\.ck-main>\.card\{justify-content:space-between;\}/.test(STYLE),
      "the slack spreads across the card's gaps");
    assert.ok(!/margin-top:auto/.test(STYLE.slice(STYLE.indexOf(".ck-main"), STYLE.indexOf(".cardhead"))),
      "…and nothing is shoved to the bottom edge to hide it");
    assert.ok(/\.ck-rail>\.card:last-child\{flex:1 1 auto;\}/.test(STYLE),
      "whichever column is shorter, the last rail card takes up the slack");
  });

  // v130 replaced the two-column week with one column, which is the deeper fix: two lists
  // of different lengths can never end level, and the longer one decided where the card
  // stopped. One column also happens to be the order the week happens in.
  ok("the week reads down the page, in the order it happens", () => {
    const card = FIN.slice(FIN.indexOf('Profit First — this week'), FIN.indexOf('<aside class="ck-rail">'));
    assert.ok(!/pf-grid/.test(card), "the two-column grid is gone");
    const order = ["pfLines", "pfSplit", "pfPots", "pfSeen", "pfDo", "pfHint"].map((id) => card.indexOf('id="' + id + '"'));
    order.forEach((i, n) => assert.ok(i > 0, order[n] + " is present"));
    assert.deepStrictEqual(order.slice().sort((a, b) => a - b), order,
      "what came in → how it splits → what actually left → what to do → the footnote");
    assert.ok(/#pfSeen:not\(:empty\)\{[^}]*border-top:1px solid var\(--line\)/.test(STYLE),
      "what actually left is ruled off from the plan above it, but only when it says something");
  });

  ok("the split is drawn, not just listed", () => {
    assert.ok(/<div class="split" id="pfSplit"><\/div>/.test(FIN), "the bar has a home in the markup");
    assert.ok(/\.split\{[^}]*display:flex/.test(STYLE) && /\.split:empty\{display:none;\}/.test(STYLE),
      "…and disappears when there is nothing to split");
    // the three segments take the three pot colours, so bar and rows read as one thing
    assert.ok(/\.split \.s-tax\{background:var\(--orange\)/.test(STYLE), "tax is the brand");
    assert.ok(/\.split \.s-inv\{background:var\(--blue\)/.test(STYLE), "investment is the blue");
    assert.ok(/\.split \.s-ops\{background:var\(--green\)/.test(STYLE), "what is left is the green");
    assert.ok(/Math\.max\(\(v \/ allocatable\) \* 100, v > 0 \? 1\.5 : 0\)/.test(FIN),
      "a small pot keeps a sliver of width instead of vanishing");
  });

  /* ================= 2. the ticking rules ================= */
  ok("the rules are stated where the next person will read them", () => {
    assert.ok(/const ckLabel = \(id\)/.test(FIN), "a tick names the job it ticked");
    assert.ok(/async function ckAuto\(id, on\)/.test(FIN), "one door for every automatic tick");
    assert.ok(/if \(!S\.weekStart\) return;/.test(FIN), "…which does nothing before the week exists");
    assert.ok(/} catch \{ return; \}\s*\/\/ offline/.test(FIN), "…and nothing when the save fails");
    assert.ok(/const cl = \{ \.\.\.cur, \[id\]: !!on \};/.test(FIN),
      "a tick is written true/false — never deleted, because the store merges checklists");
  });

  // a) nothing left to categorise, and the month is in front → those two tick themselves
  await okA("the job the numbers can prove ticks itself", async () => {
    const { el, store, S } = await boot({ txns: { "2026-08": [ROW("a", "in", 3000), ROW("b", "out", 200, "Rent")] }, now: "2026-08-10" });
    const cl = store.weeks[S.weekStart].checklist;
    assert.strictEqual(cl.review, true, "nothing uncategorised — the review job is done");
    assert.strictEqual(el("ckProgress").textContent, "1 of 9 done", "…and the card says so");
    // and only that one. The month here is comfortably in front, which under v129 would
    // have ticked the cash row as well: looking at a number is a decision, not a state.
    assert.ok(!cl.cash, "the cash-status check stays a manual switch, however healthy the month");
    for (const k of ["import", "pots", "acct", "invoice", "stripe", "ontra", "action"]) {
      assert.ok(!cl[k], k + " is not claimed without evidence");
    }
    assert.ok(!/ckAuto\("cash"/.test(FIN), "nothing anywhere ticks the cash row for you");
  });

  // b) the evidence has to actually be there
  await okA("…and stay untouched when the evidence is not there", async () => {
    const { store, S } = await boot({ txns: { "2026-08": [ROW("c", "in", 100), ROW("d", "out", 900, "")] }, now: "2026-08-10" });
    const cl = (store.weeks[S.weekStart] || {}).checklist || {};
    assert.ok(!cl.review, "an uncategorised expense means the review job is not done");
    assert.ok(!cl.cash, "…and the cash row is untouched either way");
  });

  // c) the pots row follows its button in both directions
  await okA("the pots row follows its button, both ways", async () => {
    const { el, store, S, settle } = await boot({ txns: { "2026-08": [ROW("e", "in", 2000), ROW("f", "out", 100, "Rent")] }, now: "2026-08-10" });
    await el("pfMoved").onclick();
    await settle();
    assert.strictEqual(store.weeks[S.weekStart].checklist.pots, true, "marking it moved ticks the row");
    assert.strictEqual(store.weeks[S.weekStart].moved, true);
    await el("pfMoved").onclick();
    await settle();
    // written as false, not deleted: the store merges checklists so nothing is ever lost
    assert.strictEqual(store.weeks[S.weekStart].checklist.pots, false, "undoing it takes the tick back");
    assert.strictEqual(store.weeks[S.weekStart].moved, false);
    // …and undoing does not disturb the ticks the numbers earned
    assert.strictEqual(store.weeks[S.weekStart].checklist.review, true, "the other ticks survive");
  });

  // d) a tick you made yourself is never taken away
  await okA("a tick you made yourself is never taken away", async () => {
    const { ctx, el, store, S, settle } = await boot({ txns: { "2026-08": [ROW("g", "in", 3000), ROW("h", "out", 100, "Rent")] }, now: "2026-08-10" });
    // tick a manual job by hand, the way the checkbox does
    await ctx.ckAuto("stripe", true);
    await settle();
    assert.strictEqual(store.weeks[S.weekStart].checklist.stripe, true);
    // now make the automatic ones run again — they must not tidy it away
    ctx.renderStats();
    await settle();
    assert.strictEqual(store.weeks[S.weekStart].checklist.stripe, true, "still there");
    assert.ok(el("ckProgress").textContent.startsWith("2 of 9"), "and still counted");
  });

  // e) an import that lands rows ticks the import job
  await okA("importing a statement ticks the import job", async () => {
    const { ctx, store, S, settle } = await boot({ txns: { "2026-08": [ROW("i", "in", 3000), ROW("j", "out", 100, "Rent")] }, now: "2026-08-10" });
    assert.ok(!store.weeks[S.weekStart].checklist.import, "not claimed before an import happens");
    await ctx.ckAuto("import", true);
    await settle();
    assert.strictEqual(store.weeks[S.weekStart].checklist.import, true, "…and ticked once one has");
    // the import routine is what calls it, right where the rows land
    const commit = FIN.slice(FIN.indexOf('toast(added + " transaction"'));
    assert.ok(/if \(added\) await ckAuto\("import", true\);/.test(commit.slice(0, 400)),
      "the import ticks it on the way out, and only when something was actually added");
  });

  // f) writing a tick must never disturb what the week already recorded
  await okA("an automatic tick never disturbs the money the week recorded", async () => {
    const { ctx, el, store, S, settle } = await boot({ txns: { "2026-08": [ROW("k", "in", 2000), ROW("l", "out", 100, "Rent")] }, now: "2026-08-10" });
    await el("pfMoved").onclick();
    await settle();
    const before = { ...store.weeks[S.weekStart] };
    await ctx.ckAuto("invoice", true);
    await settle();
    const after = store.weeks[S.weekStart];
    assert.strictEqual(after.moved, before.moved, "moved is carried through");
    assert.strictEqual(after.tax, before.tax, "so is the tax that was moved");
    assert.strictEqual(after.invest, before.invest, "…and the investment");
    assert.strictEqual(after.checklist.pots, true, "…and every tick already there");
  });

  console.log("v129-self-ticking.test: " + pass + " checks passed");
})();
