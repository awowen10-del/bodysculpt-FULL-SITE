// v133 — the file can be tidied, not just added to; and the paste can leave the brief behind.
//
// Two things, both from Ash reading v132 back:
//
//  1. "after six months or so, some of those lines will be out of date or repeated" — an
//     accreting list rots, and all of it goes into every prompt. So the loop gets its second
//     half: hand the whole file to Claude, ask for a consolidated version, and REPLACE the
//     list instead of appending. The HEADING on the pasted block decides which happens
//     (ADD TO MY FILE vs REPLACE MY FILE), so there is no mode to set and nothing to get
//     wrong — and the store keeps the version before the last write, so a bad tidy is one
//     click from being undone. Losing the file to a clumsy consolidation is exactly the
//     kind of data loss that would stop the loop being used at all.
//
//  2. "I've now got the instructions and the details in this project, do I need the big
//     prompt at the start of every new conversation?" — inside a Project whose instructions
//     already carry the brief, no. So the week can be copied WITHOUT it. The standing file
//     still travels, because the file lives in the dashboard, not in the project.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/finance-env.cjs");

const FIN = fs.readFileSync(path.join(__dirname, "..", "finances.html"), "utf8");
const STORE = fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "kpi-store.js"), "utf8");
const R = (id, date, dir, amount, desc, cat, km, src) =>
  ({ id, date, dir, amount, desc, cat: cat || "", km: km || "", src: src || "", hash: id });
const AUG = [
  R("a1", "2026-08-06", "in", 2000, "FASTER PAYMENTS RECEIPT REF.STRIPE FROM Stripe Payments UK Ltd", "", "", "stripe"),
  R("a2", "2026-08-06", "out", 249, "CARD PAYMENT TO ONTRAPORT INC ON 05-08-2026", "Software", "Optional"),
];
const SIX = [
  "Ontraport is my CRM.",
  "Ontraport is the CRM and every sign-up goes through it.",
  "Membership is £45 a month.",
  "Membership is £52 a month from June.",
  "The lease runs to March 2028.",
  "Costa is coffee for the staff.",
];

let pass = 0;
const ok = (n, f) => { f(); pass++; console.log("  ok " + n); };
const okA = async (n, f) => { await f(); pass++; console.log("  ok " + n); };

(async () => {
  ok("every page carries the v133 stamp", () => {
    const S = "build v133 · tidy-my-file";
    const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    assert.ok(FIN.includes("<!-- " + S + " -->"), "finances.html stamped v133");
    assert.ok(read("monthly.html").includes('<span class="mp-stage">' + S + "</span>"), "monthly shows it");
    assert.ok(read("index.html").includes(S), "index carries it");
  });

  /* ================= 1. the tidy-up prompt ================= */
  await okA("tidying up hands Claude the whole file and asks for a replacement", async () => {
    const { ctx, clipboard } = await boot({ txns: { "2026-08": AUG }, now: "2026-08-10", notes: SIX });
    await ctx.copyTidy();
    const text = clipboard[clipboard.length - 1];
    assert.ok(/needs consolidating/.test(text), "it says what the job is");
    assert.ok(/Merge anything that says the same thing twice/.test(text), "merge the repeats");
    assert.ok(/keep the later one and drop the earlier/.test(text), "…and settle contradictions by date");
    assert.ok(/Do not invent anything I have not said/.test(text), "no embroidery");
    assert.ok(/do not drop a line just because it is\n\s*small/.test(text), "…and no quiet pruning");
    assert.ok(/REPLACE MY FILE/.test(text), "it names the block it wants back");
    assert.ok(/unsure whether to drop something, keep it/.test(text), "when in doubt, keep");
    SIX.forEach((f) => assert.ok(text.includes("- " + f), "the whole file goes with it: " + f.slice(0, 20)));
    assert.ok(/MY FILE  \(6 lines\)/.test(text), "…counted, so a truncation would be obvious");
  });

  /* ================= 2. replace vs add is decided by the heading ================= */
  await okA("a REPLACE MY FILE block swaps the list; an ADD block appends", async () => {
    const { ctx, S, store } = await boot({ txns: { "2026-08": AUG }, now: "2026-08-10", notes: SIX });
    const tidied = [
      "REPLACE MY FILE",
      "- Ontraport is the CRM and every sign-up goes through it.",
      "- Membership is £52 a month from June.",
      "- The lease runs to March 2028.",
      "- Costa is coffee for the staff.",
    ].join("\n");
    const n = await ctx.addFacts(tidied);
    assert.strictEqual(n, 4, "four lines came back");
    assert.strictEqual(store.notes.facts.length, 4, "the file IS those four, not ten");
    assert.ok(!store.notes.facts.includes("Membership is £45 a month."), "the stale price is gone");
    assert.deepStrictEqual(S.notes, store.notes.facts, "screen and store agree");

    // …and a normal block still appends
    await ctx.addFacts("ADD TO MY FILE\n- Facebook ads bring in every new member.");
    assert.strictEqual(store.notes.facts.length, 5, "an ADD block adds");
  });

  ok("the heading is what decides, and it is stripped either way", () => {
    assert.ok(/const isReplaceBlock = \(text\) =>/.test(FIN), "there is one place that decides");
    assert.ok(/\^\\s\*\(\?:#\+\\s\*\)\?replace my file\\b/i.test(FIN.replace(/\\\\/g, "\\")),
      "…and it only fires when REPLACE MY FILE is the first thing said");
    assert.ok(/!\/\^\(\?:add to\|replace\) my file:\?\$\/i\.test\(l\)/.test(FIN),
      "neither heading ever becomes a fact of its own");
  });

  /* ================= 3. a bad tidy is one click from being undone ================= */
  ok("the store keeps the version before the last write", () => {
    const write = STORE.slice(STORE.indexOf("body.finNotes"), STORE.indexOf("Save one week's pot move"));
    assert.ok(/previous: Array\.isArray\(prev\.facts\) \? prev\.facts : \[\]/.test(write),
      "every write keeps what was there before it");
    assert.ok(/previous = saved && Array\.isArray\(saved\.previous\)/.test(STORE), "…and it comes back on read");
  });

  await okA("undo puts the file back", async () => {
    const { ctx, S, store } = await boot({ txns: { "2026-08": AUG }, now: "2026-08-10", notes: SIX });
    await ctx.addFacts("REPLACE MY FILE\n- One line, which is a mistake.");
    assert.strictEqual(store.notes.facts.length, 1, "the bad tidy landed");
    assert.deepStrictEqual(S.notesPrev, SIX, "…with the previous six to hand");
    await ctx.undoFacts();
    assert.deepStrictEqual(store.notes.facts, SIX, "and undo puts all six back");
    assert.strictEqual(S.notes.length, 6, "…on screen too");
  });

  ok("the tools appear only when they are any use", () => {
    assert.ok(/\$\("factTidy"\)\.hidden = S\.notes\.length < 5;/.test(FIN),
      "nothing to consolidate until there is a list worth consolidating");
    assert.ok(/undo\.hidden = !S\.notesPrev\.length;/.test(FIN), "undo hides when there is nothing behind you");
    assert.ok(/REPLACE MY FILE block swaps the list/.test(FIN), "and the panel says how replacing works");
  });

  /* ================= 4. the paste can leave the brief behind ================= */
  await okA("inside a project, the week can be copied without the brief", async () => {
    const { ctx } = await boot({ txns: { "2026-08": AUG }, now: "2026-08-10", notes: SIX });
    const full = await ctx.buildWeekChallenge(true);
    const bare = await ctx.buildWeekChallenge(false);

    assert.ok(/You are my finance director\./.test(full), "the full copy carries the brief");
    assert.ok(!/You are my finance director\./.test(bare), "the bare one does not");
    assert.ok(!/CHALLENGE EACH PAYMENT/.test(bare), "…nor the six questions");
    assert.ok(/This week's figures\. The brief is in my project instructions\./.test(bare),
      "…and says why, so a stray paste is never a mystery");

    // the file still travels — it lives in the dashboard, not in the project
    assert.ok(/WHAT I HAVE ALREADY TOLD YOU/.test(bare), "the standing file still goes");
    SIX.forEach((f) => assert.ok(bare.includes(f), "…all of it: " + f.slice(0, 18)));
    // and so does every figure
    assert.ok(/EVERY TRANSACTION THIS WEEK/.test(bare) && /ONTRAPORT INC/.test(bare),
      "…with the week itself");
    assert.ok(bare.length < full.length, "it is the same thing, minus the brief");
  });

  ok("both copies are offered where the copying happens", () => {
    const view = FIN.slice(FIN.indexOf('<div class="view" id="v-report"'), FIN.indexOf("<!-- the sort-out wizard"));
    assert.ok(/id="repWeekPlain"/.test(view), "there is a button for it");
    assert.ok(/This week, without the brief/.test(view), "…named for what it does");
    assert.ok(/inside a Claude Project whose instructions\s*\n?\s*already carry it/.test(view),
      "…and the hint says when to use it");
    assert.ok(/\$\("repWeekPlain"\)\.onclick = \(\) => copyChallenge\(false\);/.test(FIN), "wired");
    assert.ok(/\$\("repWeek"\)\.onclick = \(\) => copyChallenge\(\);/.test(FIN), "the full copy is unchanged");
  });

  console.log("v133-tidy-my-file.test: " + pass + " checks passed");
})();
