// v246 — "Sorted" on the Money card.
//
// Ash: a "Sorted" button on each overdue row that "marks it resolved in the dashboard: no more
// chases, row shown as 'resolved by Ash on [date]'. Does not touch Stripe and make sure it
// updates the: X payments are still unpaid — £XXX in the balance".
//
// What this pins:
//   1. the ladder: sorted beats every stage, says when, and suggests nothing
//   2. it covers the rows that were there — a NEW failure for the same member is chased
//   3. Stripe is not touched: the operation writes the ladder's own record and nothing else
//   4. the page: one function decides what is open, and the headline, the total, the groups
//      and the top tile all count from it — run for real
//   5. the button, the way back on the card, and "Not sorted after all"
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = (f) => path.join(__dirname, "..", f);
const read = (f) => fs.readFileSync(root(f), "utf8");
const DAILY = read("daily.html");
const js = DAILY.slice(DAILY.lastIndexOf("<script>") + 8, DAILY.lastIndexOf("</script>"));
const fn = (name) => {
  const i = js.indexOf("function " + name + "(");
  assert.ok(i >= 0, "daily.html has " + name);
  let depth = 0, j = js.indexOf("{", i);
  for (; j < js.length; j++) { if (js[j] === "{") depth++; else if (js[j] === "}" && --depth === 0) break; }
  return js.slice(i, j + 1);
};

const DAY = 86400000;
const NOW = Date.parse("2026-10-22T09:00:00Z");
const ago = (d) => new Date(NOW - d * DAY).toISOString();

(async () => {
  const chase = await import("file://" + root("netlify/lib/chase.js"));
  const debt = (extra) => Object.assign({ key: "c:cus_1", name: "Jen Lawton", email: "jen@x.com", amount: 14310,
    kinds: ["subscription"], rowIds: ["sub_1"], overdueFrom: ago(30), paidSince: null, handsOff: "" }, extra || {});

  /* ============ 1. the ladder ============ */
  const sortedRec = { overdueFrom: ago(30), sorted: { at: NOW - 2 * DAY, rowIds: ["sub_1"] } };
  let v = chase.ladder(debt(), sortedRec, {}, NOW);
  assert.strictEqual(v.stage, "sorted"); assert.strictEqual(v.tag, "sorted");
  assert.strictEqual(v.action, "none", "sorted: no more chases, at day 30 with a nudge long due");
  assert.ok(/^Resolved by Ash on 20 Oct\.$/.test(v.note), "…and the row says who and when: " + v.note);
  v = chase.ladder(debt(), { ...sortedRec, nudge1: { draftId: "d" } }, { nudge1: { sent: false, draftExists: true } }, NOW);
  assert.strictEqual(v.stage, "sorted", "a waiting draft does not bring it back");
  v = chase.ladder(debt({ handsOff: "dispute" }), sortedRec, {}, NOW);
  assert.strictEqual(v.stage, "sorted", "Ash's word beats every automatic stage, hands-off included");
  v = chase.ladder(debt(), { overdueFrom: ago(30) }, {}, NOW);
  assert.strictEqual(v.stage, "nudge1", "without it, the ladder as before");

  /* ============ 2. it covers what was there ============ */
  v = chase.ladder(debt({ rowIds: ["sub_1", "ch_new"] }), sortedRec, {}, NOW);
  assert.notStrictEqual(v.stage, "sorted", "a NEW failure for the same member is not swallowed by an old Sorted");
  assert.ok(chase.isSorted(debt(), sortedRec) && !chase.isSorted(debt(), { overdueFrom: ago(1) }));

  /* ============ 3. Stripe is not touched ============ */
  {
    const mc = read("netlify/functions/money-chase.js");
    const block = mc.slice(mc.indexOf('if (op === "sorted")'), mc.indexOf('return json({ ok: false, error: "Unknown operation." }'));
    assert.ok(/rec\.sorted = \{ at: now, rowIds: debt\.rowIds\.slice\(\) \}/.test(block) && /await writeState\(state\);/.test(block),
      "Sorted writes the ladder's own record …");
    assert.ok(!/fetch\(|stripe|draft|createDraft/i.test(block.replace(/readMoney/g, "")), "… and nothing else: no Stripe, no Gmail draft");
    assert.ok(!/api\.stripe\.com/.test(mc), "money-chase has no address for Stripe of its own");
    const feed = read("netlify/functions/stripe-feed.js").replace(/\/\/.*$/gm, "");
    assert.ok(!/method:\s*"(POST|PUT|DELETE)"/.test(feed), "and the Stripe read it shares can only GET");
  }

  /* ============ 4. the counts, run for real ============ */
  {
    const src = js.slice(js.indexOf("const moneyRowSorted = (r) => {"), js.indexOf("let moneyUndo = null;"));
    const ctx = vm.createContext({});
    vm.runInContext("let stripeState = null;\n" + src + "\nthis.set = (s) => { stripeState = s; }; this.live = moneyLive;", ctx);
    const row = (id, key, amount, kind) => ({ id, chaseKey: key, amount, kind });
    ctx.set({
      disputes: [{ id: "dp", amount: 4900 }],
      pastDue: [row("sub_1", "c:jen", 14310, "subscription"), row("sub_2", "c:mark", 16900, "subscription")],
      failed: [row("ch_1", "c:sophie", 9900, "charge"), row("ch_2", "c:tom", 14900, "charge"), row("ch_3", "c:jen", 9900, "charge")],
      chase: { "c:jen": { stage: "sorted" }, "c:mark": { stage: "nudge2" }, "c:sophie": { stage: "nudge1" }, "c:tom": { stage: "early" } },
    });
    const L = ctx.live();
    assert.strictEqual(L.p.length, 1, "Jen's membership is out of Stopped paying");
    assert.strictEqual(L.f.length, 2, "…and her failed charge out of Still unpaid");
    assert.strictEqual(L.sorted.length, 2, "…both set aside (v248: and not drawn at all)");
    assert.strictEqual(L.count, 1 + 1 + 2, "the count leaves her out");
    assert.strictEqual(L.total, 4900 + 16900 + 9900 + 14900, "…and so does the balance");
    ctx.set({ disputes: [], pastDue: [row("sub_1", "c:jen", 14310)], failed: [] });
    assert.strictEqual(ctx.live().count, 1, "without the ladder loaded (no connected browser), nothing is counted out");

    const rm = fn("renderMoney");
    assert.ok(/const live = moneyLive\(\);\s*const d = live\.d, p = live\.p, f = live\.f;/.test(rm), "the card's groups come from it");
    assert.ok(/const total = live\.total;/.test(rm), "…the '£… in the balance' figure too");
    assert.ok(/" still unpaid"/.test(rm) && /f\.length/.test(rm), "…and 'X payments are still unpaid' counts the open ones");
    assert.ok(/money = moneyLive\(\)\.count;/.test(js), "the 'payments to sort' tile at the top counts from it as well");
    assert.ok(/renderDayStats\(\)/.test(rm), "…and is redrawn whenever the card is");
  }

  /* ============ 5. the button and the way back ============ */
  {
    const ch = fn("mchaseHtml");
    assert.ok(/data-chase-sort="' \+ k \+ '"/.test(ch) && />Sorted<\/button>/.test(ch), "every overdue member's row has Sorted");
    assert.ok(/Nothing changes in Stripe\./.test(ch), "…which says it leaves Stripe alone");
    const w = fn("wireMoneyCard");
    assert.ok(/\[data-chase-sort\]/.test(w) && /moneyUndoBtn/.test(w), "Sorted wired, and the Undo");
    const rm = fn("renderMoney");
    assert.ok(/marked sorted \\u2014 off the card, no more chases\. Stripe is unchanged\./.test(rm) && /id="moneyUndoBtn">Undo/.test(rm),
      "the way back is on the confirmation itself, where the press happened");
    /* v248, Ash, over a screenshot of the "Sorted by you" group: "I don't want them showing as
       sorted. Just get rid of them." A sorted member leaves the card altogether. */
    assert.ok(!/Sorted by you/.test(js) && !/is-sorted/.test(DAILY) && !/Not sorted after all/.test(js), "no Sorted-by-you group, no struck-through rows");
    assert.ok(!/live\.sorted\.map/.test(rm), "sorted rows are not drawn anywhere on the card");
    assert.ok(/if \(!undo && \(!now \|\| now\.stage !== "sorted"\)\) \{ moneyUndo = null;/.test(fn("moneySorted")),
      "…and it only claims what actually happened");
  }

  console.log("v246-sorted.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
