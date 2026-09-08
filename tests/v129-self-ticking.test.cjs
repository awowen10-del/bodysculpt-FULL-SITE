// v129 — the boxes line up, and a job done in the dashboard ticks itself off.
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
//   · a job ticks ONLY on evidence of it happening — an import that added rows, nothing
//     left uncategorised, a cash status that is actually green or amber;
//   · a tick is never taken away, EXCEPT the pots row, which belongs to the Mark-the-money-
//     as-moved button and follows it both ways: undo means it did not happen;
//   · the four jobs that happen outside this dashboard (the accountant, the invoices,
//     Stripe, Ontraport) stay manual. A wrong tick is worse than a missing one, because
//     you would stop trusting the list.
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
    const S = "build v129 · self-ticking";
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
    assert.ok(/\.ck-main>\.card>\.pf-do\{margin-top:auto;\}/.test(STYLE),
      "the slack lands between the figures and the ask — the band anchors the bottom edge");
    assert.ok(/\.ck-rail>\.card:last-child\{flex:1 1 auto;\}/.test(STYLE),
      "whichever column is shorter, the last rail card takes up the slack");
  });

  ok("the week's two halves balance, and read in the order it happened", () => {
    const grid = /<div class="pf-grid">([\s\S]*?)<\/div>\s*<div class="pf-do"/.exec(FIN);
    assert.ok(grid, "the week still has its two-column grid");
    const halves = grid[1].split(/<\/div>\s*<div>/);
    assert.strictEqual(halves.length, 2, "two halves");
    assert.ok(/id="pfLines"/.test(halves[0]) && /id="pfSeen"/.test(halves[0]),
      "what came in, then what actually left, in the same half");
    assert.ok(halves[0].indexOf('id="pfLines"') < halves[0].indexOf('id="pfSeen"'), "…in that order");
    assert.ok(/id="pfPots"/.test(halves[1]) && !/id="pfSeen"/.test(halves[1]),
      "the pots have the other half to themselves");
    assert.ok(/#pfSeen:not\(:empty\)\{[^}]*border-top:1px solid var\(--line\)/.test(STYLE),
      "…ruled off from the income above it, but only when it says something");
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
  await okA("the jobs the numbers can prove tick themselves", async () => {
    const { el, store, S } = await boot({ txns: { "2026-08": [ROW("a", "in", 3000), ROW("b", "out", 200, "Rent")] }, now: "2026-08-10" });
    const cl = store.weeks[S.weekStart].checklist;
    assert.strictEqual(cl.review, true, "nothing uncategorised — the review job is done");
    assert.strictEqual(cl.cash, true, "the month is comfortably in front — the cash check passes");
    assert.strictEqual(el("ckProgress").textContent, "2 of 9 done", "…and the card says so");
    // and only those two: the jobs that happen elsewhere are untouched
    for (const k of ["import", "pots", "acct", "invoice", "stripe", "ontra", "action"]) {
      assert.ok(!cl[k], k + " is not claimed without evidence");
    }
  });

  // b) the evidence has to actually be there
  await okA("…and stay untouched when the evidence is not there", async () => {
    const { store, S } = await boot({ txns: { "2026-08": [ROW("c", "in", 100), ROW("d", "out", 900, "")] }, now: "2026-08-10" });
    const cl = (store.weeks[S.weekStart] || {}).checklist || {};
    assert.ok(!cl.review, "an uncategorised expense means the review job is not done");
    assert.ok(!cl.cash, "…and a month spending ahead of income is not a passed cash check");
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
    assert.ok(el("ckProgress").textContent.startsWith("3 of 9"), "and still counted");
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
