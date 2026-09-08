// v131 — "Challenge my week": one copy, and Claude argues with you about every line.
//
// Ash: "I want to be able to copy and paste it into Claude, and for Claude to challenge me
// on all of my income and expenses, I want to become more frugal… something that's going to
// instantly turn Claude into a financial guru, with a breakdown of all transactions for
// that week."
//
// Two halves, and both have to be right:
//
//  THE PROMPT has to ask for an ARGUMENT. Reading his own numbers back to him is the
//  failure mode, and the thing a model will do by default if you let it. So the prompt
//  names the job (finance director, blunt), the goal (frugality without damaging what
//  earns), and six instructions that are all verbs — challenge, rank, flag, protect,
//  challenge the income too, and ask me questions back.
//
//  THE DATA has to carry what you cannot challenge a payment without: the line itself,
//  what that supplier costs over a YEAR at this rate, and the standing costs that did not
//  happen to fall inside this particular week. Plus the honesty that keeps it usable —
//  pot moves marked as not-spending so they are never "saved", and the run-rates flagged
//  as projections rather than bills.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/finance-env.cjs");

const FIN = fs.readFileSync(path.join(__dirname, "..", "finances.html"), "utf8");
const R = (id, date, dir, amount, desc, cat, km, src) =>
  ({ id, date, dir, amount, desc, cat: cat || "", km: km || "", src: src || "", hash: id });

// the week of 2026-08-06 (Thursday) → 2026-08-12
const AUG = [
  R("a1", "2026-08-06", "in", 2988.20, "FASTER PAYMENTS RECEIPT REF.STRIPE FROM Stripe Payments UK Ltd", "", "", "stripe"),
  R("a2", "2026-08-07", "in", 3405.60, "BILL PAYMENT VIA FASTER PAYMENT FROM GC C1 GOCARDLESS LTD REFERENCE MEMBERSHIPS", "", "", "gocardless"),
  R("a3", "2026-08-08", "in", 298.00, "SUMUP PAYMENTS LTD ON 07-08-2026", "", "", "sumup"),
  R("a4", "2026-08-06", "out", 1180.00, "CARD PAYMENT TO FACEBK *D3CPMYZRS2 ON 05-08-2026", "Marketing", "Optional"),
  R("a5", "2026-08-06", "out", 249.00, "CARD PAYMENT TO ONTRAPORT INC ON 05-08-2026", "Software", "Optional"),
  R("a6", "2026-08-08", "out", 12.40, "CARD PAYMENT TO COSTA COFFEE ON 07-08-2026", "Other", "Can Cut"),
  R("a7", "2026-08-07", "out", 143.22, "CARD PAYMENT TO AMAZON BUSINESS ON 06-08-2026", "", ""),
  R("a8", "2026-08-08", "out", 980.00, "FASTER PAYMENTS TO BODYSCULPT TRANSFORMATION CENTRES LTD", "Transfer", ""),
  // outside the week — must not appear
  R("a9", "2026-08-20", "out", 77.77, "CARD PAYMENT TO A LATER SHOP ON 19-08-2026", "Retail", "Can Cut"),
];
const JUL = [
  R("b1", "2026-07-01", "out", 2450, "BILL PAYMENT VIA FASTER PAYMENT TO WARRINGTON PROPERTY REFERENCE RENT", "Rent", "Essential"),
  R("b2", "2026-07-20", "out", 2450, "BILL PAYMENT VIA FASTER PAYMENT TO WARRINGTON PROPERTY REFERENCE RENT", "Rent", "Essential"),
  R("b3", "2026-07-05", "out", 249.00, "CARD PAYMENT TO ONTRAPORT INC ON 04-07-2026", "Software", "Optional"),
  R("b4", "2026-07-06", "out", 1290, "CARD PAYMENT TO FACEBK *D3CPMYZRS2 ON 05-07-2026", "Marketing", "Optional"),
];

let pass = 0;
const ok = (n, f) => { f(); pass++; console.log("  ok " + n); };
const okA = async (n, f) => { await f(); pass++; console.log("  ok " + n); };

(async () => {
  ok("every page carries the same stamp", () => {
    // relaxed once v132 shipped: the newest test pins the exact stamp, this one only checks
    // the build never goes backwards and that the pages agree on it.
    const m = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(FIN);
    assert.ok(m && Number(m[1]) >= 131, "finances.html carries a v131-or-later stamp");
    const S = "build v" + m[1] + " · " + m[2];
    const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    assert.ok(read("monthly.html").includes('<span class="mp-stage">' + S + "</span>"), "monthly shows it");
    assert.ok(read("index.html").includes(S), "index carries it");
  });

  /* ================= 1. the prompt asks for an argument ================= */
  ok("the prompt turns Claude into someone who argues, not someone who summarises", () => {
    // v132 split the preamble into a shared head (both reports use it) and a tail that asks
    // for what was learned back. The six-point brief this test is about is the head.
    const block = /const CHALLENGE_PROMPT_HEAD = \[([\s\S]*?)\n\];/.exec(FIN);
    assert.ok(block, "the prompt lives in one named place, not buried in the builder");
    const text = block[1];
    assert.ok(/You are my finance director\./.test(text), "it casts the role in the first line");
    assert.ok(/blunt/.test(text) && /hard to impress/.test(text), "…and the manner");
    assert.ok(/gym in Warrington/.test(text), "it says what the business is");
    assert.ok(/frugal/.test(text), "…and what I am trying to do");
    assert.ok(/__SCOPE__/.test(text), "…with one line left for the scope, so both reports share it");
    assert.ok(/Do not read my own numbers back to me\./.test(text),
      "it forbids the failure mode outright");
    // six instructions, and every one of them is a verb aimed at me
    const steps = [...text.matchAll(/^\s*"  (\d)\. ([A-Z][A-Z ]+)/gm)].map((m) => [m[1], m[2].trim()]);
    assert.deepStrictEqual(steps.map((s) => s[0]), ["1", "2", "3", "4", "5", "6"], "six numbered instructions");
    assert.ok(/CHALLENGE EACH PAYMENT/.test(text), "1 — go line by line");
    assert.ok(/RANK WHAT TO CUT/.test(text), "2 — order it by what it saves");
    assert.ok(/FLAG/.test(text), "3 — duplicates, creep, unused");
    assert.ok(/TELL ME WHAT NOT TO TOUCH/.test(text), "4 — protect what earns");
    assert.ok(/CHALLENGE THE INCOME/.test(text), "5 — the income gets it too");
    assert.ok(/ASK ME/.test(text), "6 — it has to put questions BACK to me");
    assert.ok(/cost me a YEAR/.test(text), "…priced over a year, which is where the decision is");
    assert.ok(/single biggest saving/.test(text), "it has to land on one thing to do");
    assert.ok(/No flattery, no filler/.test(text), "and no padding");
    assert.ok(/nothing that is not above board/.test(text), "…or anything dodgy");
  });

  /* ================= 2. the data behind it ================= */
  const { ctx, el, clipboard } = await boot({ txns: { "2026-07": JUL, "2026-08": AUG }, now: "2026-08-10" });
  const text = await ctx.buildWeekChallenge();

  ok("the prompt and the data arrive as one copy", () => {
    assert.ok(text.startsWith("You are my finance director."), "the instruction leads");
    assert.ok(text.includes("=".repeat(78)), "…then a rule, then the evidence");
    assert.ok(text.indexOf("THE WEEK:") > text.indexOf("You are my finance director."), "in that order");
  });

  ok("every transaction of that week is there, and nothing else is", () => {
    assert.ok(/EVERY TRANSACTION THIS WEEK  \(8 in total, nothing left out\)/.test(text),
      "all eight lines of the week, counted");
    for (const r of AUG.filter((x) => x.date <= "2026-08-12")) {
      assert.ok(text.includes(r.desc.slice(0, 40)), "the line for " + r.id + " is in it");
    }
    assert.ok(!text.includes("A LATER SHOP"), "a payment outside the week is not");
    // and each line carries what you need to judge it
    assert.ok(/06\/08\/2026 OUT +£1,180\.00  Marketing +Optional +CARD PAYMENT TO FACEBK/.test(text),
      "date, direction, amount, category, cut-marking, description");
    assert.ok(/UNCATEGORISED +not marked/.test(text), "…and says so when I have not marked one");
  });

  ok("my own money moving between my own pots is never mistaken for spending", () => {
    assert.ok(/MOVE +£980\.00  own pot/.test(text), "a transfer is marked MOVE, not OUT");
    assert.ok(/must not be counted as a saving/.test(text), "…and the prompt says why in words");
    assert.ok(/Money out +£1,584\.62/.test(text), "the week's spend excludes the pot move");
  });

  ok("each supplier is quoted at what it costs over a year", () => {
    const table = text.slice(text.indexOf("WHAT I PAID THIS WEEK"), text.indexOf("REGULAR COSTS"));
    assert.ok(/~ a year/.test(table), "the annual rate is the point of the table");
    assert.ok(/FACEBK +£1,180\.00 +£2,470\.00 +2 +£14,820/.test(table),
      "this week, the history, how many times, and the yearly run-rate");
    assert.ok(/ONTRAPORT INC[\s\S]*?£2,988/.test(table), "£249 a month is £2,988 a year — that is the argument");
    assert.ok(/projection from the/.test(text), "…and it is honest that a run-rate is a projection");
  });

  ok("the standing costs that missed this week are still put up for challenge", () => {
    const block = text.slice(text.indexOf("REGULAR COSTS THAT DID NOT FALL IN THIS WEEK"));
    assert.ok(/WARRINGTON PROPERTY/.test(block), "the rent is in the argument even in a week it was not paid");
    assert.ok(!/WARRINGTON PROPERTY/.test(text.slice(text.indexOf("WHAT I PAID THIS WEEK"), text.indexOf("REGULAR COSTS"))),
      "…and is not double-counted as a payment made this week");
  });

  ok("the income side is there to be challenged too", () => {
    const block = text.slice(text.indexOf("WHERE THIS WEEK'S INCOME CAME FROM"));
    assert.ok(/stripe +£2,988\.20/.test(block) && /gocardless +£3,405\.60/.test(block)
      && /sumup +£298\.00/.test(block), "every source, with what it brought in");
    assert.ok(/Allocatable income +£6,393\.80/.test(text), "what actually gets split");
    assert.ok(/Tax pot 15% +£959\.07/.test(text) && /Investment 4% +£255\.75/.test(text), "and how");
    assert.ok(/cash cushion is £2,000/.test(text), "…against the rule I am supposed to run to");
    assert.ok(/THE MONTH SO FAR — Aug 2026/.test(text), "the month around it, for proportion");
  });

  /* ================= 3. the two picks in the report tab ================= */
  // v134 turned the two picks into ONE button plus a fold: the week is the weekly ritual,
  // the longer view is a once-a-month thing and no longer competes with it. What this test
  // is about — the week is offered, it says which week, and it is wired — is unchanged.
  ok("the report leads with the week, and says which week", () => {
    const view = FIN.slice(FIN.indexOf('<div class="view" id="v-report"'), FIN.indexOf('<!-- the sort-out wizard'));
    assert.ok(/<div class="chead">Have Claude challenge you<\/div>/.test(view), "a real heading");
    assert.ok(/<button type="button" class="rep-go" id="repWeek">/.test(view), "one button, unmissable");
    assert.ok(/<span class="t">Copy this week for Claude<\/span>/.test(view), "named for what it does");
    assert.ok(/id="repWeekRange"/.test(view), "…and it says which week it means");
    assert.ok(/id="repRangeLabel"/.test(view), "the longer view still says which months");
    assert.ok(/\$\("repWeek"\)\.onclick = \(\) => copyChallenge\(\);/.test(FIN), "the button is wired");
  });

  await okA("copying it also shows you exactly what went on the clipboard", async () => {
    ctx.setView("report");
    await ctx.copyChallenge();
    assert.strictEqual(el("repBox").hidden, false, "the receipt appears once there is something to show");
    assert.ok(el("repText").textContent.startsWith("You are my finance director."),
      "the preview is the thing that was copied, not a different report");
    assert.ok(/Copied — \d+ lines\./.test(el("repMsg").textContent), "…and it says how much");
    assert.strictEqual(clipboard.length, 1, "one copy went to the clipboard");
    assert.strictEqual(clipboard[0], el("repText").textContent, "…and it is what is on screen");
  });

  console.log("v131-challenge-my-week.test: " + pass + " checks passed");
})();
