// v132 — Claude stops asking me the same questions every week.
//
// Ash: "included in the prompts — the ability for claude to learn in the chat. for example,
// i do not want it to ask me the same questions each week."
//
// A pasted conversation has no memory: every Thursday it starts from nothing and asks about
// the same £249 line it asked about last Thursday. The chat cannot fix that, so the
// dashboard does — the memory travels WITH the paste:
//
//   1. Everything Ash has already answered is kept in one blob (finance-notes) as plain
//      sentences, in the words he used.
//   2. Every prompt prints them under WHAT I HAVE ALREADY TOLD YOU and forbids asking about
//      any of them again — and asks Claude to speak up if the figures now contradict one.
//   3. Every prompt closes by asking for an ADD TO MY FILE block: one plain sentence per
//      new thing learned, each true on its own without the conversation around it.
//   4. Pasting that block back into the Report tab is one action, and it accepts the block
//      verbatim — heading, bullets, numbering and all. Asking someone to tidy it first is
//      how a loop like this stops being used.
//
// Both reports share the brief now, so the weekly challenge and the longer view can never
// ask the same question twice between them.
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
const FACTS = [
  "Ontraport is my CRM and every membership sign-up runs through it, so it is not optional.",
  "The gym floor is leased until March 2028 and the rent is fixed for that term.",
];

let pass = 0;
const ok = (n, f) => { f(); pass++; console.log("  ok " + n); };
const okA = async (n, f) => { await f(); pass++; console.log("  ok " + n); };

(async () => {
  ok("every page carries the v132 stamp", () => {
    const S = "build v132 · claude-remembers";
    const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    assert.ok(FIN.includes("<!-- " + S + " -->"), "finances.html stamped v132");
    assert.ok(read("monthly.html").includes('<span class="mp-stage">' + S + "</span>"), "monthly shows it");
    assert.ok(read("index.html").includes(S), "index carries it");
  });

  /* ================= 1. the file has a home of its own ================= */
  ok("the file is its own blob, and cannot disturb anything else", () => {
    assert.ok(/const FIN_NOTES_KEY = "finance-notes";/.test(STORE), "one key, named for what it holds");
    assert.ok(/url\.searchParams\.get\("finnotes"\) === "1"/.test(STORE), "it can be read");
    assert.ok(/body\.finNotes && Array\.isArray\(body\.finNotes\.facts\)/.test(STORE), "…and written");
    // the sanitiser: sentences, capped, nothing else gets through
    const write = STORE.slice(STORE.indexOf("body.finNotes"), STORE.indexOf("Save one week's pot move"));
    assert.ok(/finStr\(typeof f === "string" \? f\.trim\(\) : "", 500\)/.test(write), "a fact is a string, capped");
    assert.ok(/\.filter\(Boolean\)/.test(write), "blank lines never land");
    assert.ok(/\.slice\(0, 300\)/.test(write), "…and the list cannot grow without limit");
  });

  /* ================= 2. what the prompt does with it ================= */
  await okA("an empty file still tells Claude the file exists", async () => {
    const { ctx } = await boot({ txns: { "2026-08": AUG }, now: "2026-08-10" });
    const text = await ctx.buildWeekChallenge();
    assert.ok(/WHAT I HAVE ALREADY TOLD YOU/.test(text), "the section is always there");
    assert.ok(/nothing yet — this is the first time/.test(text), "…and says so when it is empty");
    assert.ok(/ADD TO MY FILE/.test(text), "the ask for what it learns is there from the start");
  });

  await okA("a filled file is stated as fact, and put out of bounds", async () => {
    const { ctx } = await boot({ txns: { "2026-08": AUG }, now: "2026-08-10", notes: FACTS });
    const text = await ctx.buildWeekChallenge();
    const block = text.slice(text.indexOf("WHAT I HAVE ALREADY TOLD YOU"));
    FACTS.forEach((f) => assert.ok(block.includes("· " + f), "the file carries: " + f.slice(0, 30)));
    assert.ok(/DO NOT ASK ME ABOUT ANY OF IT AGAIN/.test(block), "and says not to ask again, in as many words");
    assert.ok(/Treat it as fact/.test(block), "…treating my answers as settled");
    assert.ok(/contradict/.test(block), "…while still allowed to tell me when it has gone stale");
    // instruction 6 has to point AT the file, or the ban is just decoration
    assert.ok(/ONLY what I have not already[\s\S]*?WHAT I HAVE ALREADY TOLD YOU/.test(text),
      "the questions instruction names the file it must check first");
  });

  await okA("the longer view asks the same question, and carries the same file", async () => {
    const { ctx } = await boot({ txns: { "2026-08": AUG }, now: "2026-08-10", notes: FACTS });
    const big = await ctx.buildReport(true);
    assert.ok(/You are my finance director\./.test(big), "the same brief, not a weaker one");
    assert.ok(/CHALLENGE EACH PAYMENT/.test(big) && /ASK ME/.test(big), "the same six instructions");
    FACTS.forEach((f) => assert.ok(big.includes(f), "…and the same file travels with it"));
    assert.ok(/ADD TO MY FILE/.test(big), "…and it too hands back what it learned");
    // the scope line is the only difference
    assert.ok(/Below is where it has gone over/.test(big), "the longer view says it is the shape");
    const week = await ctx.buildWeekChallenge();
    assert.ok(/Below is EVERY transaction from one week/.test(week), "the weekly one says it is every line");
    assert.ok(!/Below is where it has gone over/.test(week), "…and they do not blur into each other");
  });

  /* ================= 3. getting the answers back in ================= */
  await okA("the ADD TO MY FILE block pastes back verbatim", async () => {
    const { ctx, S, store } = await boot({ txns: { "2026-08": AUG }, now: "2026-08-10" });
    const pasted = [
      "ADD TO MY FILE",
      "- Ontraport is my CRM and every sign-up runs through it.",
      "* The lease runs to March 2028.",
      "2. Facebook ads are the only thing bringing new members in.",
      "",
      "  · Costa is me buying coffee for staff on a Friday.  ",
      "=====",
    ].join("\n");
    const n = await ctx.addFacts(pasted);
    assert.strictEqual(n, 4, "four facts, however they were punctuated");
    assert.deepStrictEqual(store.notes.facts, [
      "Ontraport is my CRM and every sign-up runs through it.",
      "The lease runs to March 2028.",
      "Facebook ads are the only thing bringing new members in.",
      "Costa is me buying coffee for staff on a Friday.",
    ], "the heading, the bullets, the numbering and the rule are all stripped");
    assert.deepStrictEqual(S.notes, store.notes.facts, "…and what is on screen is what was saved");

    // pasting the same block twice must not double the file
    const again = await ctx.addFacts(pasted);
    assert.strictEqual(again, 0, "nothing new the second time");
    assert.strictEqual(store.notes.facts.length, 4, "…and the file did not grow");
  });

  await okA("a fact can be forgotten when it stops being true", async () => {
    const { ctx, store } = await boot({ txns: { "2026-08": AUG }, now: "2026-08-10", notes: FACTS });
    await ctx.removeFact(0);
    assert.deepStrictEqual(store.notes.facts, [FACTS[1]], "the one I dropped is gone from the store");
    const text = await ctx.buildWeekChallenge();
    assert.ok(!text.includes(FACTS[0]), "…and stops being sent");
    assert.ok(text.includes(FACTS[1]), "…while the rest stays");
  });

  /* ================= 4. the panel that does it ================= */
  ok("the file is visible and editable where the copying happens", () => {
    const view = FIN.slice(FIN.indexOf('<div class="view" id="v-report"'), FIN.indexOf("<!-- the sort-out wizard"));
    assert.ok(/<div class="chead">What Claude already knows/.test(view), "it has a heading of its own");
    assert.ok(/data-tip="file"/.test(view), "…and an explainer, like every other term on this page");
    assert.ok(/id="factList"/.test(view) && /id="factIn"/.test(view) && /id="factAdd"/.test(view),
      "the list, the box to paste into, and the button");
    assert.ok(/id="factCount"/.test(view), "…and a count, so you can see it growing");
    assert.ok(/ADD TO MY FILE block/.test(view), "the placeholder names the block it wants");
    assert.ok(/renderFacts\(\);/.test(FIN), "…and it is drawn when the report opens");
  });

  console.log("v132-claude-remembers.test: " + pass + " checks passed");
})();
