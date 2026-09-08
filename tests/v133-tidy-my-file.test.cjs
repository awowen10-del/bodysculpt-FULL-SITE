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
    const S = "build v134 · one-path";
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

  /* ================= 4. …and then the brief stopped staying behind ================= */
  // v133 added a copy WITHOUT the brief, for a project whose instructions already carried
  // it. v134 removed it again, and that reversal is the point worth pinning: it saved a few
  // hundred words out of thousands, and cost a rule to remember and a wrong button to press
  // on a Thursday morning. One copy, working in any chat anywhere, beats two that differ in
  // a way you have to hold in your head.
  await okA("there is one copy of the week, and it always carries the brief", async () => {
    const { ctx } = await boot({ txns: { "2026-08": AUG }, now: "2026-08-10", notes: SIX });
    const text = await ctx.buildWeekChallenge();
    assert.ok(/You are my finance director\./.test(text), "the brief is always there");
    assert.ok(/CHALLENGE EACH PAYMENT/.test(text), "…all six questions of it");
    assert.ok(/WHAT I HAVE ALREADY TOLD YOU/.test(text), "…and the file with it");
    SIX.forEach((f) => assert.ok(text.includes(f), "…every line of it: " + f.slice(0, 18)));
    // the variant, and the button that reached it, are gone rather than hidden
    assert.ok(!/repWeekPlain/.test(FIN), "no second week button anywhere");
    // the comment explaining the reversal stays; what must be gone is the UI and the rule
    const view = FIN.slice(FIN.indexOf('<div class="view" id="v-report"'), FIN.indexOf("<!-- the sort-out wizard"));
    assert.ok(!/without the brief/i.test(view), "…and no rule about when to use one, on screen");
    assert.strictEqual(await ctx.buildWeekChallenge(false), text,
      "the old argument is inert — there is only one thing it can build");
  });

  ok("the one button is the loud thing on the page", () => {
    const view = FIN.slice(FIN.indexOf('<div class="view" id="v-report"'), FIN.indexOf("<!-- the sort-out wizard"));
    assert.ok(/class="rep-go" id="repWeek"/.test(view), "the week copy is the primary action");
    assert.ok(/\.rep-go\{[^}]*background:var\(--orange\)/.test(FIN), "…and it looks like one");
    assert.ok(/id="repMoreBtn"/.test(view) && /id="repMore" hidden/.test(view),
      "the longer view is folded away until asked for");
    assert.ok(/id="repBox" hidden/.test(view), "and the wall of monospace only appears once you copy");
  });

  console.log("v133-tidy-my-file.test: " + pass + " checks passed");
})();
