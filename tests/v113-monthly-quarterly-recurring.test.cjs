// v113: monthly and quarterly recurring tasks — the two tabs v75 left as "coming soon".
//
// A recurring task can now carry an optional `cadence`:
//   cadence:"monthly"   + monthlyRule   { type:"dayOfMonth",     day:1..31|"last",                        slot }
//                                       { type:"ordinalWeekday", ordinal:1..4|"last", weekday:"mon".."sun", slot }
//   cadence:"quarterly" + quarterlyRule { type:"monthOfQuarter", month:1..3, day:1..31|"last",            slot }
//                                       { type:"ordinalWeekday", ordinal, weekday, monthOfQuarter:1..3,   slot }
// Absent (or "weekly") is EVERY existing task, unchanged and unmigrated.
//
// The interesting half is the resolver: a rule → a real date → the week containing it → that
// day's column → the task's slot. The rest is deliberately not new — the resolved cell goes
// into wpScheduledPlacements alongside the weekly ones, so live derivation (v83), the per-week
// exception overlay (v82), chips, done-state, drag, the Today modal and Copy Week are the SAME
// shared path a weekly recurring task takes. Nothing about them is forked for cadence.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, expandRecurring } = require("./lib/env.cjs");

const WEEKLY = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const MONTHLY = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const STORE_SRC = fs.readFileSync(
  path.join(__dirname, "..", "netlify", "functions", "kpi-store.js"), "utf8");

const dragEv = () => ({ dataTransfer: { setData() {} } });
const dropEv = () => ({
  preventDefault() {},
  currentTarget: { classList: { remove() {} } },
  dataTransfer: { getData: () => "" },
});
const cell = (P, k) => Array.from(P[k] || []);
// Values that come back from the vm sandbox carry the sandbox's Array/Object prototypes, and
// assert.deepStrictEqual compares prototypes — so anything crossing that boundary is brought
// back to plain Node values first. Nothing about the assertion's meaning changes.
const plain = (v) => JSON.parse(JSON.stringify(v));
const html = (env) => env.ctx.document.getElementById("wpBody").innerHTML;
function stubAsk(ctx, answer) {
  const asks = [];
  ctx.wpAsk = async () => { asks.push(1); return answer; };
  return asks;
}
// a cadence task in the shape the app stores it
const monthly = (id, title, rule) => ({ id, title, cadence: "monthly", monthlyRule: rule, time: rule.slot });
const quarterly = (id, title, rule) => ({ id, title, cadence: "quarterly", quarterlyRule: rule, time: rule.slot });

async function week(wk, defaults, plan) {
  const env = await boot({ defaults: defaults || [], plans: { [wk]: Object.assign({ weekEnding: wk }, plan || {}) } });
  await env.ctx.loadWeeklyPlan(wk);
  await env.settle();
  return env;
}

(async () => {
  /* ================= 0. the build stamp ================= */
  // ">= v113" — the exact stamp is the newest version's test to assert; both pages still have
  // to agree on it (v101).
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(MONTHLY);
  assert.ok(stamp && Number(stamp[1]) >= 113, "monthly.html stamped v113 or later");
  assert.ok(WEEKLY.includes("build v" + stamp[1] + " · " + stamp[2]), "index.html carries the same stamp");

  const env0 = await week("2026-03-16", []);
  const c = env0.ctx;
  const iso = (d) => (d ? d.toISOString().slice(0, 10) : null);

  /* ================= 1. RESOLVER: day of month, across real months ================= */
  {
    // an ordinary day resolves to itself, in every length of month
    assert.strictEqual(iso(c.wpDayOfMonthDate(2026, 0, 15)), "2026-01-15", "15th of a 31-day month");
    assert.strictEqual(iso(c.wpDayOfMonthDate(2026, 3, 15)), "2026-04-15", "…of a 30-day month");
    assert.strictEqual(iso(c.wpDayOfMonthDate(2026, 1, 15)), "2026-02-15", "…of February");
    assert.strictEqual(iso(c.wpDayOfMonthDate(2026, 0, 1)), "2026-01-01", "the 1st");

    // THE OVERFLOW CLAMP — the whole point. A raw Date.UTC(2026,1,31) would roll into March.
    assert.strictEqual(iso(c.wpDayOfMonthDate(2026, 1, 31)), "2026-02-28",
      "the 31st of February clamps to the 28th — it never rolls into March");
    assert.strictEqual(iso(c.wpDayOfMonthDate(2026, 1, 30)), "2026-02-28", "…and so does the 30th");
    assert.strictEqual(iso(c.wpDayOfMonthDate(2026, 1, 29)), "2026-02-28", "…and the 29th, in a non-leap year");
    assert.strictEqual(iso(c.wpDayOfMonthDate(2024, 1, 31)), "2024-02-29",
      "…while a LEAP February clamps to the 29th");
    assert.strictEqual(iso(c.wpDayOfMonthDate(2024, 1, 29)), "2024-02-29", "…which the 29th reaches exactly");
    assert.strictEqual(iso(c.wpDayOfMonthDate(2026, 3, 31)), "2026-04-30", "the 31st of a 30-day month clamps");
    assert.strictEqual(iso(c.wpDayOfMonthDate(2026, 8, 31)), "2026-09-30", "…September too");
    assert.strictEqual(iso(c.wpDayOfMonthDate(2026, 0, 31)), "2026-01-31", "…and a 31-day month is untouched");

    // "last day" is a first-class choice, not a 31 that happens to clamp
    assert.strictEqual(iso(c.wpDayOfMonthDate(2026, 1, "last")), "2026-02-28", "last day of Feb 2026");
    assert.strictEqual(iso(c.wpDayOfMonthDate(2024, 1, "last")), "2024-02-29", "…of a leap Feb");
    assert.strictEqual(iso(c.wpDayOfMonthDate(2026, 3, "last")), "2026-04-30", "…of a 30-day month");
    assert.strictEqual(iso(c.wpDayOfMonthDate(2026, 11, "last")), "2026-12-31", "…of December");

    // junk resolves to nothing rather than to a wrong day
    [0, -3, "", null, undefined, "nonsense", NaN].forEach((bad) =>
      assert.strictEqual(c.wpDayOfMonthDate(2026, 0, bad), null, "an invalid day resolves to nothing: " + String(bad)));
  }

  /* ================= 2. RESOLVER: ordinal weekday, incl. the fallback ================= */
  {
    // Feb 2026 starts on a Sunday, so its Mondays are 2, 9, 16, 23 — four of them.
    assert.strictEqual(iso(c.wpOrdinalWeekdayDate(2026, 1, 1, "mon")), "2026-02-02", "1st Monday of Feb 2026");
    assert.strictEqual(iso(c.wpOrdinalWeekdayDate(2026, 1, 2, "mon")), "2026-02-09", "2nd Monday");
    assert.strictEqual(iso(c.wpOrdinalWeekdayDate(2026, 1, 3, "mon")), "2026-02-16", "3rd Monday");
    assert.strictEqual(iso(c.wpOrdinalWeekdayDate(2026, 1, 4, "mon")), "2026-02-23", "4th Monday");
    assert.strictEqual(iso(c.wpOrdinalWeekdayDate(2026, 1, "last", "mon")), "2026-02-23",
      "…which is also the LAST Monday");

    // THE FALLBACK: February 2026 has no 5th Monday. The task must not vanish for the month.
    assert.strictEqual(iso(c.wpOrdinalWeekdayDate(2026, 1, 5, "mon")), "2026-02-23",
      "a 5th Monday that doesn't exist falls back to the last one — never silently dropped");
    assert.strictEqual(iso(c.wpOrdinalWeekdayDate(2026, 1, 9, "mon")), "2026-02-23", "…however far past the end");

    // the first day of a month IS its first occurrence of that weekday
    assert.strictEqual(iso(c.wpOrdinalWeekdayDate(2026, 0, 1, "thu")), "2026-01-01",
      "1 Jan 2026 is a Thursday, so it is January's 1st Thursday");
    // …and the last day of a month can be its last occurrence
    assert.strictEqual(iso(c.wpOrdinalWeekdayDate(2026, 0, "last", "sat")), "2026-01-31",
      "31 Jan 2026 is a Saturday — January's last Saturday");

    // "last weekday" across a spread of months and weekdays
    assert.strictEqual(iso(c.wpOrdinalWeekdayDate(2026, 1, "last", "fri")), "2026-02-27", "last Friday of Feb");
    assert.strictEqual(iso(c.wpOrdinalWeekdayDate(2026, 2, "last", "fri")), "2026-03-27", "…of March");
    assert.strictEqual(iso(c.wpOrdinalWeekdayDate(2026, 10, "last", "sun")), "2026-11-29", "last Sunday of Nov");
    assert.strictEqual(iso(c.wpOrdinalWeekdayDate(2026, 7, 3, "fri")), "2026-08-21", "3rd Friday of Aug");

    // every weekday key resolves (the mon..sun ↔ getUTCDay mapping is right end to end)
    [["mon", 1], ["tue", 2], ["wed", 3], ["thu", 4], ["fri", 5], ["sat", 6], ["sun", 0]].forEach(([k, idx]) => {
      const d = c.wpOrdinalWeekdayDate(2026, 5, 1, k);
      assert.ok(d, "1st " + k + " of June 2026 resolves");
      assert.strictEqual(d.getUTCDay(), idx, "…and it really is a " + k);
      assert.ok(d.getUTCDate() <= 7, "…and it is the FIRST one in the month");
    });
    assert.strictEqual(c.wpOrdinalWeekdayDate(2026, 0, 1, "funday"), null, "an unknown weekday resolves to nothing");
  }

  /* ================= 3. RESOLVER: quarterly, in the right quarter ================= */
  {
    const r = { type: "monthOfQuarter", month: 2, day: 15, slot: "6-9" };
    // the quarter comes from the month being resolved, so every month of a quarter agrees
    [[0, "2026-02-15"], [1, "2026-02-15"], [2, "2026-02-15"],
     [3, "2026-05-15"], [4, "2026-05-15"], [5, "2026-05-15"],
     [6, "2026-08-15"], [7, "2026-08-15"], [8, "2026-08-15"],
     [9, "2026-11-15"], [10, "2026-11-15"], [11, "2026-11-15"]].forEach(([m, want]) =>
      assert.strictEqual(iso(c.wpResolveQuarterlyRule(r, 2026, m)), want,
        "month " + m + " resolves to its own quarter's 2nd month"));

    // month-of-quarter 1 and 3 pick out the quarter's edges
    const first = { type: "monthOfQuarter", month: 1, day: 1, slot: "6-9" };
    const third = { type: "monthOfQuarter", month: 3, day: "last", slot: "6-9" };
    assert.strictEqual(iso(c.wpResolveQuarterlyRule(first, 2026, 4)), "2026-04-01", "Q2 month 1 = April");
    assert.strictEqual(iso(c.wpResolveQuarterlyRule(third, 2026, 4)), "2026-06-30", "Q2 month 3, last day = 30 June");
    assert.strictEqual(iso(c.wpResolveQuarterlyRule(third, 2026, 1)), "2026-03-31", "Q1 month 3, last day = 31 March");

    // the clamp reaches quarterly rules too — Q1's 2nd month is February
    const q31 = { type: "monthOfQuarter", month: 2, day: 31, slot: "6-9" };
    assert.strictEqual(iso(c.wpResolveQuarterlyRule(q31, 2026, 0)), "2026-02-28", "a quarterly 31st clamps in February");
    assert.strictEqual(iso(c.wpResolveQuarterlyRule(q31, 2024, 0)), "2024-02-29", "…to the 29th in a leap year");

    // ordinal weekday, scoped to a month of the quarter
    const qo = { type: "ordinalWeekday", ordinal: 1, weekday: "mon", monthOfQuarter: 1, slot: "6-9" };
    assert.strictEqual(iso(c.wpResolveQuarterlyRule(qo, 2026, 0)), "2026-01-05", "1st Monday of Q1's 1st month");
    assert.strictEqual(iso(c.wpResolveQuarterlyRule(qo, 2026, 3)), "2026-04-06", "…of Q2's");
    assert.strictEqual(iso(c.wpResolveQuarterlyRule(qo, 2026, 6)), "2026-07-06", "…of Q3's");
    assert.strictEqual(iso(c.wpResolveQuarterlyRule(qo, 2026, 9)), "2026-10-05", "…of Q4's");
    // and the ordinal fallback still applies inside a quarter
    const qlast = { type: "ordinalWeekday", ordinal: 5, weekday: "mon", monthOfQuarter: 2, slot: "6-9" };
    assert.strictEqual(iso(c.wpResolveQuarterlyRule(qlast, 2026, 0)), "2026-02-23",
      "a 5th Monday of Q1's 2nd month falls back to the last one");
  }

  /* ================= 4. date → week: only the week that contains it ================= */
  {
    // 1st of the month, at 9–11.30. Feb 1 2026 is a Sunday, so it lands in the week of 26 Jan.
    const t = monthly("m1", "Invoices", { type: "dayOfMonth", day: 1, slot: "10-12" });
    assert.deepStrictEqual(plain(c.wpCadenceCells(t, "2026-01-26")), ["10-12:sun"],
      "the occurrence lands in the week containing it, in that day's column and its slot");
    ["2026-02-02", "2026-02-09", "2026-02-16"].forEach((wk) =>
      assert.deepStrictEqual(plain(c.wpCadenceCells(t, wk)), [], "…and in NO other week of the month: " + wk));
    // …and March's occurrence appears in ITS week, not February's
    assert.deepStrictEqual(plain(c.wpCadenceCells(t, "2026-02-23")), ["10-12:sun"],
      "the week of 23 Feb runs to 1 March, so it holds March's occurrence");
    assert.deepStrictEqual(plain(c.wpCadenceDatesInWeek(t, "2026-02-23")), ["2026-03-01"], "…which is 1 March");

    // a month-boundary week resolves BOTH its months — the 31st is January's, in that week
    const t31 = monthly("m2", "Month end", { type: "dayOfMonth", day: 31, slot: "6-9" });
    assert.deepStrictEqual(plain(c.wpCadenceDatesInWeek(t31, "2026-01-26")), ["2026-01-31"],
      "the week of 26 Jan spans into February, and picks up January's 31st");
    assert.deepStrictEqual(plain(c.wpCadenceDatesInWeek(t31, "2026-02-23")), ["2026-02-28"],
      "…and February's clamped occurrence lands in the week holding 28 Feb");

    // QUARTER BOUNDARY: the week of 30 March runs into April, so Q2's occurrence is in it
    const q = quarterly("q1", "Quarter kickoff", { type: "monthOfQuarter", month: 1, day: 1, slot: "1-3" });
    assert.deepStrictEqual(plain(c.wpCadenceDatesInWeek(q, "2026-03-30")), ["2026-04-01"],
      "a week straddling a quarter boundary resolves the quarter its occurrence is in");
    assert.deepStrictEqual(plain(c.wpCadenceCells(q, "2026-03-30")), ["1-3:wed"], "…in the right day and slot");
    assert.deepStrictEqual(plain(c.wpCadenceDatesInWeek(q, "2026-06-29")), ["2026-07-01"], "…the same at Q2→Q3");
    assert.deepStrictEqual(plain(c.wpCadenceDatesInWeek(q, "2026-12-28")), ["2027-01-01"],
      "…and across a YEAR boundary, into the next year's Q1");
    ["2026-04-06", "2026-05-04", "2026-06-01"].forEach((wk) =>
      assert.deepStrictEqual(plain(c.wpCadenceCells(q, wk)), [], "a quarterly task is in no other week of its quarter: " + wk));

    // a task with a cadence but no usable rule simply doesn't place — it never guesses a day
    assert.deepStrictEqual(plain(c.wpCadenceCells({ id: "x", cadence: "monthly" }, "2026-01-26")), [],
      "a cadence with no rule places nothing");
    assert.deepStrictEqual(plain(c.wpCadenceCells({ id: "x", title: "t" }, "2026-01-26")), [],
      "…and a task with no cadence is not a cadence task");
  }

  /* ================= 5. THE GRID: one week only, right day, right slot ================= */
  {
    const REF = "recurring:m1";
    const task = monthly("m1", "Invoices", { type: "dayOfMonth", day: 1, slot: "10-12" });

    const hit = await week("2026-01-26", [task]);
    const E = hit.ctx.wpEffectivePlacements();
    assert.deepStrictEqual(cell(E, "10-12:sun"), [REF], "the monthly task is on the grid in its resolved cell");
    assert.strictEqual(Object.keys(E).filter((k) => cell(E, k).includes(REF)).length, 1,
      "…in exactly one cell — one occurrence, not a weekly pattern");
    assert.ok(html(hit).includes("Invoices"), "…and it renders");

    // the month's other weeks hold nothing
    for (const wk of ["2026-02-02", "2026-02-09", "2026-02-16"]) {
      const miss = await week(wk, [task]);
      const M = miss.ctx.wpEffectivePlacements();
      assert.ok(!Object.keys(M).some((k) => cell(M, k).includes(REF)),
        "the monthly task is on no cell in the week of " + wk);
    }

    // quarterly likewise
    const QREF = "recurring:q1";
    const qtask = quarterly("q1", "Quarter kickoff", { type: "ordinalWeekday", ordinal: 1, weekday: "mon", monthOfQuarter: 1, slot: "5-8" });
    const qhit = await week("2026-07-06", [qtask]);   // 1st Monday of Q3's 1st month = 6 July
    assert.deepStrictEqual(cell(qhit.ctx.wpEffectivePlacements(), "5-8:mon"), [QREF],
      "the quarterly task lands on its resolved Monday");
    for (const wk of ["2026-07-13", "2026-08-03", "2026-09-07"]) {
      const qmiss = await week(wk, [qtask]);
      const M = qmiss.ctx.wpEffectivePlacements();
      assert.ok(!Object.keys(M).some((k) => cell(M, k).includes(QREF)),
        "the quarterly task is absent from the quarter's other weeks: " + wk);
    }
    // …and it comes back next quarter, on its own resolved day
    const nextQ = await week("2026-10-05", [qtask]);   // 1st Monday of Q4's 1st month = 5 Oct
    assert.deepStrictEqual(cell(nextQ.ctx.wpEffectivePlacements(), "5-8:mon"), [QREF],
      "the quarterly task returns the following quarter");
  }

  /* ================= 6. DERIVED, never frozen (v83) ================= */
  {
    const task = monthly("m1", "Invoices", { type: "dayOfMonth", day: 1, slot: "10-12" });
    const env = await week("2026-01-26", [task]);
    assert.deepStrictEqual(plain(env.ctx.__wpState.plan.placements), {},
      "a cadence task writes NO stored placement — its cell is derived every render");
    assert.ok(!env.posts.some((p) => p.body.weeklyPlan),
      "…and simply viewing a week with one saves nothing");

    // editing the rule moves it everywhere at once, with no per-week repair
    await env.ctx.wpSetCadence("m1", "monthly", { type: "dayOfMonth", day: 2, slot: "6-9" });
    await env.settle();
    const E = env.ctx.wpEffectivePlacements();
    assert.ok(!cell(E, "10-12:sun").includes("recurring:m1"), "the old cell is gone the moment the rule changes");
    assert.deepStrictEqual(plain(env.ctx.wpCadenceDatesInWeek(env.ctx.__wpState.defaults[0], "2026-01-26")), [],
      "…and 2 Feb is in the NEXT week, so this week now holds nothing");
    const moved = await week("2026-02-02", [env.ctx.__wpState.defaults[0]]);
    assert.deepStrictEqual(cell(moved.ctx.wpEffectivePlacements(), "6-9:mon"), ["recurring:m1"],
      "…where the edited rule now puts it");

    // a stale stored placement from any source is stripped, exactly as for a weekly task
    const stale = await week("2026-02-09", [task], { placements: { "6-9:wed": ["recurring:m1"] } });
    const S = stale.ctx.wpEffectivePlacements();
    assert.ok(!cell(S, "6-9:wed").includes("recurring:m1"),
      "a stored placement of a cadence task is a stale mirror — the rule wins");
  }

  /* ================= 7. the v82 per-week exception layer covers it ================= */
  {
    const task = monthly("m1", "Invoices", { type: "dayOfMonth", day: 1, slot: "10-12" });
    assert.ok(env0.ctx.wpIsScheduledRef, "the scheduled-ref test exists");

    // SKIP this week's single occurrence
    const sk = await week("2026-01-26", [task]);
    stubAsk(sk.ctx, "week");
    await sk.ctx.wpChipRemove(null, "recurring:m1", "10-12:sun");
    await sk.settle();
    const ex = sk.ctx.__wpState.plan.exceptions["recurring:m1"];
    assert.ok(ex && ex.type === "skip", "removing the chip records a skip, not a deletion");
    assert.strictEqual(ex.from, "10-12:sun", "…against the cell the rule resolved to");
    assert.ok(!Object.keys(sk.ctx.wpEffectivePlacements()).some((k) => cell(sk.ctx.wpEffectivePlacements(), k).includes("recurring:m1")),
      "…so the occurrence is hidden this week");
    assert.ok(sk.ctx.__wpState.defaults.some((d) => d.id === "m1"), "…while the task itself survives");
    assert.ok(sk.ctx.__wpState.defaults[0].cadence === "monthly", "…with its cadence intact");

    // MOVE this week's occurrence
    const mv = await week("2026-01-26", [task]);
    stubAsk(mv.ctx, "week");
    mv.ctx.wpChipDragStart(dragEv(), "recurring:m1", "10-12:sun");
    await mv.ctx.wpCellDrop(dropEv(), "6-9", "tue");
    await mv.settle();
    const mex = mv.ctx.__wpState.plan.exceptions["recurring:m1"];
    assert.ok(mex && mex.type === "move", "dragging the chip records a move");
    assert.strictEqual(mex.from, "10-12:sun", "…from the resolved cell");
    assert.strictEqual(mex.to, "6-9:tue", "…to the dropped one");
    const ME = mv.ctx.wpEffectivePlacements();
    assert.deepStrictEqual(cell(ME, "6-9:tue"), ["recurring:m1"], "…and it renders where it was moved to");
    assert.ok(!cell(ME, "10-12:sun").includes("recurring:m1"), "…not where the rule put it");
    assert.strictEqual(mv.ctx.__wpState.defaults[0].monthlyRule.day, 1, "the RULE is untouched by a one-week move");
    assert.strictEqual(mv.ctx.__wpState.defaults[0].monthlyRule.slot, "10-12", "…slot and all");

    // it does not roll over: the same task in a later week is back on its rule
    const later = await week("2026-02-23", [mv.ctx.__wpState.defaults[0]]);
    assert.deepStrictEqual(cell(later.ctx.wpEffectivePlacements(), "10-12:sun"), ["recurring:m1"],
      "a move in one week never leaks into another — the next occurrence follows the rule");
  }

  /* ================= 8. the shared path: chip, done, rename, delete ================= */
  {
    const task = monthly("m1", "Invoices", { type: "dayOfMonth", day: 1, slot: "10-12" });

    // it renders as the SAME recurring chip, with the teal accent
    const env = await week("2026-01-26", [task]);
    const chip = env.ctx.wpChipHtml("recurring:m1", "sun", "grid", "10-12:sun");
    assert.ok(chip.includes("wp-cellchip") && chip.includes("wp-recur"),
      "a cadence task renders the ordinary recurring chip");
    assert.ok(chip.includes("Invoices") && chip.includes('draggable="true"'), "…draggable, like any other");

    // done-state through the shared tick path — one occurrence, so the plain per-week key
    await env.ctx.wpToggleDoneRef("recurring:m1", true, "sun");
    await env.settle();
    assert.strictEqual(env.ctx.__wpState.plan.recurringDone["m1"], true,
      "ticking it writes the ordinary per-week recurring done key");
    assert.ok(env.ctx.wpIsDone("recurring", env.ctx.__wpState.defaults[0]), "…and it reads back as done");
    assert.ok(env.ctx.wpChipHtml("recurring:m1", "sun", "grid", "10-12:sun").includes("wp-done"),
      "…so the chip renders done");
    // done is per week, like every other recurring task
    const fresh = await week("2026-02-23", [task]);
    assert.ok(!fresh.ctx.wpIsDone("recurring", fresh.ctx.__wpState.defaults[0]),
      "…and the next occurrence starts unticked");

    // rename through the shared inline-title path — id, cadence and rule all survive
    const rn = await week("2026-01-26", [task]);
    // same technique as v77: the blur handler reads the edited value through
    // document.querySelector('[data-item-title=…]'), which the stub DOM has to stand in for
    rn.ctx.document.querySelector = () => ({ value: "Invoices + VAT" });
    await rn.ctx.wpDefaultTitleBlur("recurring", "m1");
    await rn.settle();
    const renamed = rn.ctx.__wpState.defaults[0];
    assert.strictEqual(renamed.title, "Invoices + VAT", "the title changes");
    assert.strictEqual(renamed.id, "m1", "…the id does not");
    assert.strictEqual(renamed.cadence, "monthly", "…nor the cadence");
    assert.strictEqual(renamed.monthlyRule.day, 1, "…nor the rule");
    assert.deepStrictEqual(cell(rn.ctx.wpEffectivePlacements(), "10-12:sun"), ["recurring:m1"],
      "…and it is still on the grid");

    // delete through the shared removal path
    const del = await week("2026-01-26", [task]);
    await del.ctx.wpRemoveRecurring("m1", true);
    await del.settle();
    assert.strictEqual(del.ctx.__wpState.defaults.length, 0, "the task is gone from the list");
    assert.ok(!Object.keys(del.ctx.wpEffectivePlacements()).some((k) =>
      cell(del.ctx.wpEffectivePlacements(), k).includes("recurring:m1")), "…and off the grid");
    assert.ok(del.posts.some((p) => Array.isArray(p.body.recurringDefaults)), "…saved on the normal defaults path");
  }

  /* ================= 9. the Today modal and Copy Week see it too ================= */
  {
    // both read wpEffectivePlacements, so this is really a check that nothing bypasses it
    const task = monthly("m1", "Invoices", { type: "dayOfMonth", day: 1, slot: "10-12" });
    const env = await week("2026-01-26", [task]);
    const P = env.ctx.wpEffectivePlacements();
    assert.deepStrictEqual(cell(P, "10-12:sun"), ["recurring:m1"], "the one derivation both surfaces read");
    const copy = env.ctx.wpCopyWeekText ? env.ctx.wpCopyWeekText() : null;
    if (copy !== null) assert.ok(copy.includes("Invoices"), "Copy week includes the occurrence");
    assert.ok(/const todayPlacements = wpEffectivePlacements\(\)/.test(WEEKLY),
      "the Today modal reads the same effective placements");
    assert.ok(/const tbPlacements = wpEffectivePlacements\(\)/.test(WEEKLY),
      "…and so does Copy week");
  }

  /* ================= 10. the tabs, the counts, the badge, the editor ================= */
  {
    const defaults = [
      { id: "d1", title: "Inbox zero", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], time: "6-9" },
      { id: "w1", title: "Scorecard", days: ["mon"], time: "6-9" },
      monthly("m1", "Invoices", { type: "dayOfMonth", day: 1, slot: "10-12" }),
      monthly("m2", "Payroll", { type: "ordinalWeekday", ordinal: "last", weekday: "fri", slot: "5-8" }),
      quarterly("q1", "Quarter kickoff", { type: "ordinalWeekday", ordinal: 1, weekday: "mon", monthOfQuarter: 1, slot: "5-8" }),
    ];
    const env = await week("2026-01-26", defaults);
    expandRecurring(env.ctx);   // v114: the card starts collapsed; this block reads inside it

    // counts, from the same derivation
    const h0 = html(env);
    assert.ok(h0.includes(`Daily <span class="wp-ntab-count">1</span>`), "Daily count = 1");
    assert.ok(h0.includes(`Weekly <span class="wp-ntab-count">1</span>`), "Weekly count = 1");
    assert.ok(h0.includes(`Monthly <span class="wp-ntab-count">2</span>`), "Monthly count = 2");
    assert.ok(h0.includes(`Quarterly <span class="wp-ntab-count">1</span>`), "Quarterly count = 1");
    assert.strictEqual(env.ctx.wpRecurTab(defaults[2]), "monthly", "a monthly task derives into the Monthly tab");
    assert.strictEqual(env.ctx.wpRecurTab(defaults[4]), "quarterly", "…and a quarterly one into Quarterly");

    // the Monthly tab lists its tasks, with their badges and its own add control
    env.ctx.wpRecurSwitchTab("monthly");
    const hm = html(env);
    assert.ok(hm.includes('data-item-title="recurring:m1"'), "the Monthly tab lists its tasks as editable rows");
    assert.ok(hm.includes('data-item-title="recurring:m2"'), "…both of them");
    assert.ok(!hm.includes('data-item-title="recurring:w1"'), "…and none from another tab");
    assert.ok(hm.includes("+ Add monthly task"), "…with its own add control");
    assert.ok(!hm.includes("+ Add recurring"), "…instead of the weekly one");
    assert.ok(hm.includes('class="wp-cad-badge wp-cad-monthly"'), "a monthly task wears a cadence badge");
    assert.ok(hm.includes("Monthly · 1st"), "…reading what the rule says");
    assert.ok(hm.includes("Monthly · Last Fri"), "…including an ordinal-weekday rule");

    // the Quarterly tab, the same way
    env.ctx.wpRecurSwitchTab("quarterly");
    const hq = html(env);
    assert.ok(hq.includes('data-item-title="recurring:q1"'), "the Quarterly tab lists its task");
    assert.ok(hq.includes("+ Add quarterly task"), "…with its own add control");
    assert.ok(hq.includes('class="wp-cad-badge wp-cad-quarterly"'), "…and a quarterly badge");
    assert.ok(hq.includes("Qtly · 1st Mon · M1"), "…naming the ordinal, the weekday and the month of quarter");

    // labels, directly
    assert.strictEqual(env.ctx.wpCadenceLabel(defaults[2]), "Monthly · 1st", "day-of-month label");
    assert.strictEqual(env.ctx.wpCadenceLabel(monthly("x", "t", { type: "dayOfMonth", day: "last", slot: "6-9" })),
      "Monthly · last day", "last-day label");
    assert.strictEqual(env.ctx.wpCadenceLabel(quarterly("x", "t", { type: "monthOfQuarter", month: 3, day: 15, slot: "6-9" })),
      "Qtly · M3 15th", "quarterly day label");

    // the pill says where it is THIS week — or that it isn't due
    assert.strictEqual(env.ctx.wpPlacedLabel("recurring:m1"), "Sun 9 – 11.30",
      "the pill shows this week's resolved day and slot");
    assert.strictEqual(env.ctx.wpPlacedLabel("recurring:q1"), "Not this week",
      "…and says so plainly when the task isn't due this week");

    // the 📅 button opens the RULE editor for a cadence task, the day editor for a weekly one
    assert.ok(/if\(item && wpCadenceOf\(item\)\) return wpOpenCadencePopup\(id, anchor\);/.test(WEEKLY),
      "the shared popup entry point routes a cadence task to the rule editor");
    assert.ok(/function wpApplyCadencePopup\(id, cadence\)/.test(WEEKLY), "…which applies through one writer");
    assert.ok(/\.wp-cad-badge\{/.test(WEEKLY), "the badge is really styled");
    // the editor shows only the fields the chosen rule kind actually uses. `hidden` alone is
    // not enough: .wp-popup-row sets display:flex, and an author display beats the attribute's
    // UA rule — without this the "Day" row stayed visible next to an ordinal-weekday rule.
    assert.ok(/\.wp-popup-row\[hidden\]\{display:none;\}/.test(WEEKLY),
      "a hidden popup row is really hidden");
    assert.ok(/function wpCadTypeSwitch\(kind\)/.test(WEEKLY), "…and switching rule kind toggles them");
    assert.ok(/\.wp-cad-badge\.wp-cad-quarterly\{/.test(WEEKLY), "…with the two cadences tellable apart");
  }

  /* ================= 11. writing a rule: validation and mutual exclusion ================= */
  {
    const env = await week("2026-01-26", [monthly("m1", "Invoices", { type: "dayOfMonth", day: 1, slot: "10-12" })]);

    // a valid edit persists through the ordinary defaults save
    await env.ctx.wpSetCadence("m1", "monthly", { type: "ordinalWeekday", ordinal: "2", weekday: "tue", slot: "6-9" });
    await env.settle();
    const saved = env.posts.filter((p) => Array.isArray(p.body.recurringDefaults)).pop().body.recurringDefaults[0];
    assert.strictEqual(saved.cadence, "monthly", "the cadence is saved");
    assert.deepStrictEqual(saved.monthlyRule, { type: "ordinalWeekday", ordinal: 2, weekday: "tue", slot: "6-9" },
      "…with the rule normalised into exactly the documented shape (the '2' became a number)");
    assert.ok(!("days" in saved), "…and no day-set alongside it");
    assert.strictEqual(saved.time, "6-9", "…with item.time kept in step with the rule's slot");

    // an invalid rule CLEARS the cadence rather than storing something half-formed
    await env.ctx.wpSetCadence("m1", "monthly", { type: "ordinalWeekday", ordinal: 9, weekday: "nope", slot: "6-9" });
    await env.settle();
    const it = env.ctx.__wpState.defaults[0];
    assert.ok(!it.cadence && !it.monthlyRule, "an unusable rule leaves a plain recurring task, not a broken one");
    assert.strictEqual(it.title, "Invoices", "…the task itself is untouched");

    // setting a weekly day-set ends the cadence, and vice versa
    const both = await week("2026-01-26", [monthly("m1", "Invoices", { type: "dayOfMonth", day: 1, slot: "10-12" })]);
    await both.ctx.wpSetRecurrence("m1", ["mon", "wed"], "6-9", "recurring");
    await both.settle();
    const w = both.ctx.__wpState.defaults[0];
    assert.deepStrictEqual(plain(w.days), ["mon", "wed"], "a day-set applies");
    assert.ok(!w.cadence && !w.monthlyRule, "…and ends the cadence — the two are mutually exclusive");
    await both.ctx.wpSetCadence("m1", "quarterly", { type: "monthOfQuarter", month: 2, day: 10, slot: "1-3" });
    await both.settle();
    const q = both.ctx.__wpState.defaults[0];
    assert.strictEqual(q.cadence, "quarterly", "…and setting a cadence back");
    assert.ok(!q.days, "…drops the day-set");
    assert.ok(!q.monthlyRule && q.quarterlyRule, "…and only the rule for the cadence in force is kept");

    // a rule edit clears any one-week exception, exactly as a schedule edit does (v82)
    const ex = await week("2026-01-26", [monthly("m1", "Invoices", { type: "dayOfMonth", day: 1, slot: "10-12" })]);
    stubAsk(ex.ctx, "week");
    await ex.ctx.wpChipRemove(null, "recurring:m1", "10-12:sun");
    await ex.settle();
    assert.ok(ex.ctx.__wpState.plan.exceptions["recurring:m1"], "an exception exists");
    await ex.ctx.wpSetCadence("m1", "monthly", { type: "dayOfMonth", day: 5, slot: "6-9" });
    await ex.settle();
    assert.ok(!ex.ctx.__wpState.plan.exceptions["recurring:m1"],
      "editing the rule drops it — the occurrence it referred to no longer exists");
  }

  /* ================= 12. persistence: load normalisation + the store whitelist ================= */
  {
    // a stored task round-trips
    const env = await week("2026-01-26", [
      { id: "m1", title: "Invoices", cadence: "monthly", monthlyRule: { type: "dayOfMonth", day: "last", slot: "1-3" } },
      // a cadence with a broken rule loads as an ordinary recurring task, never half-applied
      { id: "b1", title: "Broken", cadence: "monthly", monthlyRule: { type: "dayOfMonth", day: 0, slot: "6-9" } },
      // an unknown cadence is ignored entirely
      { id: "b2", title: "Odd", cadence: "fortnightly", monthlyRule: { type: "dayOfMonth", day: 3, slot: "6-9" } },
      // days AND a cadence: the rule wins and the day-set is dropped, so there is only ever one schedule
      { id: "b3", title: "Both", days: ["mon"], time: "6-9", cadence: "monthly", monthlyRule: { type: "dayOfMonth", day: 9, slot: "6-9" } },
    ]);
    const [m1, b1, b2, b3] = env.ctx.__wpState.defaults;
    assert.strictEqual(m1.cadence, "monthly", "a valid stored cadence loads");
    assert.deepStrictEqual(plain(m1.monthlyRule), { type: "dayOfMonth", day: "last", slot: "1-3" }, "…with its rule");
    assert.strictEqual(m1.time, "1-3", "…and item.time seeded from the rule's slot");
    assert.ok(!b1.cadence && !b1.monthlyRule, "a broken rule loads as a plain recurring task");
    assert.strictEqual(b1.title, "Broken", "…keeping its title");
    assert.ok(!b2.cadence, "an unrecognised cadence is ignored");
    assert.strictEqual(b3.cadence, "monthly", "a task with both loads as its cadence");
    assert.ok(!b3.days, "…and loses the day-set, so it can only ever have one schedule");

    // …and the save path writes the same three fields, never a day-set beside them
    await env.ctx.wpSaveDefaults();
    await env.settle();
    const out = env.posts.filter((p) => Array.isArray(p.body.recurringDefaults)).pop().body.recurringDefaults;
    const sm = out.find((x) => x.id === "m1");
    assert.strictEqual(sm.cadence, "monthly", "the cadence is written");
    assert.deepStrictEqual(sm.monthlyRule, { type: "dayOfMonth", day: "last", slot: "1-3" }, "…with its rule");
    assert.ok(!out.some((x) => x.cadence && x.days), "no saved task carries both a cadence and a day-set");
    assert.ok(!out.find((x) => x.id === "b1").cadence, "…and the broken one saves as a plain task");

    // the store whitelists the same three fields, with the same discipline
    assert.ok(/function cleanRecurringCadence\(t\)/.test(STORE_SRC), "the store has a cadence whitelist");
    assert.ok(/d\.cadence = cadence\.cadence;/.test(STORE_SRC), "…applied to recurringDefaults");
    assert.ok(/"monthlyRule" : "quarterlyRule"/.test(STORE_SRC), "…storing only the rule for the cadence in force");
    assert.ok(/delete d\.days;/.test(STORE_SRC), "…and dropping a day-set beside it");
    // it really validates: run it
    const sandbox = { module: {}, Number, Math, Array };
    require("vm").createContext(sandbox);
    const at = STORE_SRC.indexOf("const CADENCE_WEEKDAYS");
    require("vm").runInContext(
      STORE_SRC.slice(at, STORE_SRC.indexOf("\n}", STORE_SRC.indexOf("function cleanRecurringCadence")) + 2) +
      "\n;module.exports = { cleanRecurringCadence };", sandbox);
    const clean = sandbox.module.exports.cleanRecurringCadence;
    assert.deepStrictEqual(plain(clean({ cadence: "monthly", monthlyRule: { type: "dayOfMonth", day: "31", slot: "6-9", junk: 1 } })),
      { cadence: "monthly", rule: { type: "dayOfMonth", day: 31, slot: "6-9" } },
      "the store normalises a rule field by field and drops unknown keys");
    assert.strictEqual(clean({ cadence: "monthly", monthlyRule: { type: "dayOfMonth", day: 99, slot: "6-9" } }), null,
      "…rejects an out-of-range day");
    assert.strictEqual(clean({ cadence: "quarterly", quarterlyRule: { type: "monthOfQuarter", month: 5, day: 1, slot: "6-9" } }), null,
      "…an out-of-range month of quarter");
    assert.strictEqual(clean({ cadence: "monthly", monthlyRule: { type: "ordinalWeekday", ordinal: 1, weekday: "xxx", slot: "6-9" } }), null,
      "…an unknown weekday");
    assert.strictEqual(clean({ cadence: "weekly", monthlyRule: { type: "dayOfMonth", day: 1 } }), null,
      "…and a plain weekly task carries no cadence at all");
    assert.deepStrictEqual(plain(clean({ cadence: "quarterly", quarterlyRule: { type: "ordinalWeekday", ordinal: "last", weekday: "fri", monthOfQuarter: 3, slot: "5-8" } })),
      { cadence: "quarterly", rule: { type: "ordinalWeekday", ordinal: "last", weekday: "fri", monthOfQuarter: 3, slot: "5-8" } },
      "…while a full quarterly ordinal rule survives intact");
  }

  /* ================= 13. NOTHING ELSE MOVED: no cadence = exactly as before ================= */
  {
    // a weekly recurring task derives its cells the same way it always did
    const WEEK = "2026-03-16";
    const env = await week(WEEK, [
      { id: "r1", title: "Scorecard", days: ["mon", "wed"], time: "6-9" },
      monthly("m1", "Invoices", { type: "dayOfMonth", day: 1, slot: "10-12" }),
    ]);
    const E = env.ctx.wpEffectivePlacements();
    assert.deepStrictEqual(cell(E, "6-9:mon"), ["recurring:r1"], "the weekly task is on Monday");
    assert.deepStrictEqual(cell(E, "6-9:wed"), ["recurring:r1"], "…and Wednesday, in every week, as before");
    assert.ok(!Object.keys(E).some((k) => cell(E, k).includes("recurring:m1")),
      "…and the monthly one is simply not due this week");
    assert.strictEqual(env.ctx.wpRecurTab(env.ctx.__wpState.defaults[0]), "weekly",
      "a task with no cadence still derives its tab from its days");
    assert.strictEqual(env.ctx.wpIsScheduledRef("recurring:r1"), true, "…and is still a scheduled ref");
    assert.strictEqual(env.ctx.wpIsScheduledRef("recurring:m1"), true, "…as is a cadence task, so v82 covers both");

    // an unscheduled recurring task is untouched by any of this
    const off = await week(WEEK, [{ id: "u1", title: "Someday" }]);
    assert.strictEqual(off.ctx.wpRecurTab(off.ctx.__wpState.defaults[0]), "weekly", "an unscheduled task is Weekly");
    assert.strictEqual(off.ctx.wpCadenceOf(off.ctx.__wpState.defaults[0]), "", "…with no cadence");
    assert.deepStrictEqual(plain(off.ctx.wpEffectivePlacements()), {}, "…and no derived cell");

    // the v62 rollover must not seed a cadence task (it would freeze a cell that is derived)
    assert.ok(/filter\(d=>!wpRecurDays\(d\) && !wpCadenceOf\(d\)\)/.test(WEEKLY),
      "the rollover's seedable set excludes cadence tasks, exactly as it excludes day-set ones");
    const seeded = await boot0();
    assert.deepStrictEqual(plain(seeded.ctx.__wpState.plan.placements), {},
      "…so a fresh week seeds nothing from the previous week's cadence occurrence");
  }

  async function boot0() {
    const task = monthly("m1", "Invoices", { type: "dayOfMonth", day: 1, slot: "10-12" });
    const env = await boot({
      defaults: [task],
      plans: {
        "2026-01-26": { weekEnding: "2026-01-26", placements: { "10-12:sun": ["recurring:m1"] } },
        "2026-02-02": { weekEnding: "2026-02-02" },
      },
    });
    await env.ctx.loadWeeklyPlan("2026-02-02");
    await env.settle();
    return env;
  }

  console.log("v113-monthly-quarterly-recurring.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
