// v209 — a way back from a delete, at the moment you need it.
//
// v208 shipped the delete and put the way back on a chip beside the filters. Ash deleted
// two rows by mistake and reported there was no way of adding them back. The chip was
// there and working — a reload proves it in v208 — but it looked like one more grey filter
// pill among four others, on a page he mostly reads on a phone where they wrap onto a
// second line. "It is on screen" and "he can find it" are not the same claim, and only the
// second one matters.
//
// So: Undo now sits ON the confirmation of the delete, where the mistake actually happens;
// the chip is amber rather than grey; and the deleted list explains itself and can put
// everything back in one go. This file holds those to their word.
const assert = require("assert");
const { boot } = require("./lib/finance-env.cjs");

const SEP = [
  { id: "a", hash: "a", date: "2026-09-03", dir: "in", amount: 1840.00, desc: "STRIPE PAYMENTS", src: "stripe", cat: "" },
  { id: "b", hash: "b", date: "2026-09-04", dir: "out", amount: 1200.00, desc: "PTS PROPERTY LTD", cat: "Rent", km: "Essential" },
  { id: "tax", hash: "tax", date: "2026-09-05", dir: "in", amount: 1075.56, desc: "TRANSFER FROM TAX ACCOUNT", src: "other", cat: "" },
  { id: "loanin", hash: "loanin", date: "2026-09-08", dir: "in", amount: 2090.74, desc: "CAPITAL ONE", src: "other", cat: "" },
];
const clone = () => JSON.parse(JSON.stringify(SEP));
const at = (rows, id) => rows.find((r) => r.id === id);

// The toast is built from real nodes so it can carry a button; this is what is on it.
const toastOf = (els) => {
  const el = els.get("toast");
  const kids = el.children || [];
  return {
    text: kids.length ? kids.map((c) => c.textContent).join(" ") : el.textContent,
    button: kids.find((c) => c.className === "undo") || null,
    live: el.classList.contains("act"),
  };
};

let pass = 0;
const checks = [];
const ok = (name, fn) => checks.push([name, fn]);

(async () => {
  console.log("v209 a way back:");

  ok("deleting a row offers Undo there and then, not somewhere else on the page", async () => {
    const { ctx, els } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    await ctx.setDeleted("tax", true);
    const t = toastOf(els);
    assert.ok(t.button, "there is a button on the confirmation");
    assert.strictEqual(t.button.textContent, "Undo");
    assert.ok(t.live, "and the toast is clickable, not a pointer-events:none label");
  });

  ok("…and it names the row, so Undo is not a guess about which one", async () => {
    const { ctx, els } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    await ctx.setDeleted("tax", true);
    const t = toastOf(els);
    assert.ok(t.text.includes("05/09/2026"), "the date");
    assert.ok(t.text.includes("£1,075.56"), "and the amount");
  });

  ok("clicking Undo puts the row back and the totals with it", async () => {
    const { ctx, S, fn, els, settle } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    const before = fn.moneyIn(S.rows);
    await ctx.setDeleted("tax", true);
    assert.notStrictEqual(fn.moneyIn(S.rows), before);
    toastOf(els).button.onclick();
    await settle(); await settle(); await settle();
    assert.strictEqual(fn.deletedRows().length, 0);
    assert.strictEqual(fn.moneyIn(S.rows), before, "the month is exactly as it was");
    assert.strictEqual(S.rows.length, 4);
  });

  ok("putting a row back does NOT offer to undo the undo", async () => {
    const { ctx, els } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    await ctx.setDeleted("tax", true);
    await ctx.setDeleted("tax", false);
    assert.strictEqual(toastOf(els).button, null, "a plain confirmation, with nothing to press");
    assert.strictEqual(els.get("toast").classList.contains("act"), false);
  });

  ok("an ordinary toast never becomes clickable and never sits over the page", async () => {
    // The Undo toast has pointer-events on. Every other toast must give that back, or it
    // parks an invisible rectangle over whatever is under it for the next two seconds.
    const { ctx, els } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    await ctx.setDeleted("tax", true);
    assert.strictEqual(els.get("toast").classList.contains("act"), true);
    ctx.toast("something else happened");
    assert.strictEqual(els.get("toast").classList.contains("act"), false, "the act class is dropped again");
  });

  ok("the deleted list says what it is, how many, and which month", async () => {
    const { ctx, S, els } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    await ctx.setDeleted("tax", true);
    await ctx.setDeleted("loanin", true);
    S.filter = "deleted";
    ctx.renderTxns();
    assert.strictEqual(els.get("binNote").hidden, false);
    const note = els.get("binNoteText").textContent;
    assert.ok(note.includes("2 rows"), "how many");
    assert.ok(/Sep 2026/.test(note), "which month — deleting is per month, and that has bitten");
    assert.ok(/no import will bring them back/.test(note), "and what deleting actually did");
  });

  ok("the band is only on the deleted list, never over the real transactions", async () => {
    const { ctx, S, els } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    await ctx.setDeleted("tax", true);
    S.filter = "all";
    ctx.renderTxns();
    assert.strictEqual(els.get("binNote").hidden, true);
  });

  ok("Put them all back restores every deleted row in this month, in one save", async () => {
    const { ctx, S, fn, posts, store } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    const before = fn.moneyIn(S.rows);
    await ctx.setDeleted("tax", true);
    await ctx.setDeleted("loanin", true);
    const saves = posts.filter((p) => p.finTxns).length;
    await ctx.restoreAllDeleted();
    assert.strictEqual(fn.deletedRows().length, 0);
    assert.strictEqual(fn.moneyIn(S.rows), before, "both are back, and so is the figure");
    assert.strictEqual(posts.filter((p) => p.finTxns).length, saves + 1, "one write, not one per row");
    assert.ok(store.txns["2026-09"].every((r) => !r.del), "and the store agrees");
  });

  ok("…and it drops you back on the full list, not on an empty bin", async () => {
    const { ctx, S } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    await ctx.setDeleted("tax", true);
    S.filter = "deleted";
    await ctx.restoreAllDeleted();
    assert.strictEqual(S.filter, "all");
  });

  ok("the all-back button is not offered when there is only one to put back", async () => {
    const { ctx, S, els } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    await ctx.setDeleted("tax", true);
    S.filter = "deleted";
    ctx.renderTxns();
    assert.strictEqual(els.get("binRestoreAll").hidden, true, "the per-row arrow is the whole job");
    await ctx.setDeleted("loanin", true);
    ctx.renderTxns();
    assert.strictEqual(els.get("binRestoreAll").hidden, false);
  });

  ok("a failed restore-all leaves the page saying exactly what is stored", async () => {
    const { ctx, S, fn } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    await ctx.setDeleted("tax", true);
    await ctx.setDeleted("loanin", true);
    const realFetch = ctx.fetch;
    ctx.fetch = (url, o) => (o && o.method === "POST")
      ? Promise.reject(new Error("offline")) : realFetch(url, o);
    await ctx.restoreAllDeleted();
    ctx.fetch = realFetch;
    assert.strictEqual(fn.deletedRows().length, 2, "still deleted, because the save never landed");
    assert.strictEqual(S.rows.length, 2);
  });

  ok("restoring nothing does nothing at all", async () => {
    const { ctx, posts } = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    const saves = posts.filter((p) => p.finTxns).length;
    await ctx.restoreAllDeleted();
    assert.strictEqual(posts.filter((p) => p.finTxns).length, saves, "no empty write");
  });

  ok("the chip still carries the count, and still comes back after a reload", async () => {
    // The v208 behaviour this file is a follow-up to. It worked then and must keep working
    // — the change was to how it looks, not to whether it is there.
    const one = await boot({ txns: { "2026-09": clone() }, now: "2026-09-15" });
    await one.ctx.setDeleted("tax", true);
    await one.ctx.setDeleted("loanin", true);
    const two = await boot({ txns: { "2026-09": one.store.txns["2026-09"] }, now: "2026-09-15" });
    two.ctx.setView("txns");
    assert.strictEqual(two.els.get("binChip").hidden, false);
    assert.strictEqual(two.els.get("binChip").textContent, "Deleted (2)");
    assert.strictEqual(two.fn.deletedRows().length, 2);
  });

  for (const [name, fn] of checks) { await fn(); pass++; console.log("  ok " + name); }
  console.log("v209 a-way-back: " + pass + " checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
