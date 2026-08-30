// v118: the Table view's quarter SUMMARY column, audited cell by cell.
//
// The bug it fixes: the "Cost Per Acquisition" summary divided the quarter's ad spend by
// membership SIGN-UPS, while every weekly cell in that same row divides by TRIAL SALES
// (derive()'s definition). The summary was therefore a different metric from the row it
// sat in, and read far worse than reality — on the fixture below, £101 instead of £66.
//
// Everything else in the column is pinned here too, because "does the summary total what it
// should" is the question this test exists to keep answered: sums where a sum is meant, a
// BLENDED rate where a rate is meant (total ÷ total, never the average of the weekly rates),
// the latest reading for a snapshot metric, and a mean for attendance.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/env.cjs");

const WEEKLY = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const MONTHLY = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");

// weekEnding, adSpend, leads, trialSales, signups, cancellations, recurring, paused,
// trialists, totalActive, attendance
const W = (weekEnding, adSpend, leads, trialSales, signups, cancellations, recurring,
           paused, trialists, totalActive, attendance) =>
  ({ weekEnding, adSpend, leads, trialSales, signups, cancellations, recurring,
     recurringSource: "recorded", paused, trialists, totalActive, attendance });

// Four Q2 weeks of history (the app needs >= 5 dated weeks before it trusts the series,
// and prevWeek-derived fields need a predecessor), then a full Q3.
const WEEKS = [
  W("2026-06-06", 100.00,  8, 2, 1, 0, 160, 1, 10, 170, 60),
  W("2026-06-13", 120.00, 10, 1, 2, 1, 161, 1, 11, 171, 62),
  W("2026-06-20", 150.00, 12, 3, 1, 0, 162, 1, 12, 172, 64),
  W("2026-06-27", 180.00, 14, 2, 2, 1, 163, 1, 13, 173, 66),
  /* ---- Q3 ---- */
  W("2026-07-04", 210.50, 18, 4, 3, 1, 165, 2, 18, 175, 70),
  W("2026-07-11", 305.25, 26, 5, 2, 0, 167, 2, 19, 177, 68),
  W("2026-07-18",   0.00,  0, 0, 1, 2, 166, 2, 19, 176, 65),   // a week with no ads at all
  W("2026-07-25", 412.80, 33, 6, 4, 1, 169, 3, 21, 180, 72),
  W("2026-08-01", 190.00, 15, 2, 1, 0, 170, 3, 21, 181, 69),
  W("2026-08-08", 260.45, 21, 3, 2, 1, 171, 3, 22, 183, 71),
  W("2026-08-15", 355.00, 28, 7, 5, 2, 174, 3, 24, 186, 73),
  W("2026-08-22", 120.30, 11, 1, 0, 0, 174, 3, 24, 186, 67),
  W("2026-08-29", 480.90, 39, 8, 6, 1, 179, 4, 26, 190, 74),
  W("2026-09-05", 275.00, 22, 4, 3, 2, 180, 4, 26, 191, 70),
  W("2026-09-12", 330.15, 27, 5, 2, 0, 182, 4, 27, 193, 72),
  W("2026-09-19",  95.00,  9, 1, 1, 1, 182, 4, 27, 193, 68),
  W("2026-09-26", 405.60, 34, 6, 4, 0, 186, 5, 29, 198, 75),   // the quarter's LAST week
];
const Q3 = WEEKS.filter((w) => w.weekEnding >= "2026-07-01" && w.weekEnding <= "2026-09-30");
const S = (k) => Q3.reduce((a, w) => a + (w[k] || 0), 0);
const money = (v) => "£" + Math.round(v).toLocaleString("en-GB");

// the summary (last) cell of each row, keyed by the row's metric label
function summaryColumn(ctx, quarter) {
  ctx.renderScorecard(quarter);
  const out = {};
  ctx.document.getElementById("scorecardTable").innerHTML.split("<tr>").slice(1).forEach((r) => {
    const label = /class="metric">([^<]+)</.exec(r);
    const cell = /<td class="summary">([^<]*)<\/td>/.exec(r);
    if (label && cell) out[label[1]] = cell[1];
  });
  return out;
}
// every weekly cell of one row, in week order
function weekCells(ctx, label) {
  const rows = ctx.document.getElementById("scorecardTable").innerHTML.split("<tr>").slice(1);
  const r = rows.find((x) => x.includes(`class="metric">${label}<`)) || "";
  const cells = r.match(/<td class="[^"]*">([^<]*)<\/td>/g) || [];
  return cells.map((c) => /">([^<]*)<\/td>/.exec(c)[1]).slice(1, -1);   // drop the label and summary cells
}

(async () => {
  /* ================= 0. the build stamp ================= */
  // v119 relaxed this: the newest release's test pins the exact stamp, older ones only
  // check the build never goes backwards and that the two pages agree.
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(MONTHLY);
  assert.ok(stamp && Number(stamp[1]) >= 118, "monthly.html stamped v118 or later");
  assert.ok(WEEKLY.includes("build v" + stamp[1] + " · " + stamp[2]), "index.html carries the same stamp");

  const env = await boot({ weeks: WEEKS, plans: {} });
  await env.settle();
  const ctx = env.ctx;

  /* ================= 1. the quarter holds the weeks it should ================= */
  {
    const derived = Array.from(ctx.__fbState.derived);
    assert.strictEqual(derived.length, WEEKS.length, "the app loaded the planted history");
    const q3 = derived.filter((d) => ctx.quarterOf(d.weekEnding) === "2026-Q3");
    assert.strictEqual(q3.length, 13, "Q3 holds its thirteen weeks");
    assert.deepStrictEqual(Array.from(q3.map((w) => w.weekEnding)), Q3.map((w) => w.weekEnding),
      "…exactly the Jul–Sep weeks, in order");
    // a week is filed by the date it ENDS — the same rule the quarter selector uses
    assert.strictEqual(ctx.quarterOf("2026-07-04"), "2026-Q3", "a week ending 4 Jul is a Q3 week");
    assert.strictEqual(ctx.quarterOf("2026-06-27"), "2026-Q2", "…and the one before it is not");
  }

  /* ================= 1b. the quarter is EXACTLY its own weeks, and nothing else ========
     The summary is only trustworthy if the filter behind it is airtight, so this pins the
     bucketing itself: every calendar day files into its own quarter, the four boundaries are
     clean, the year is part of the key, and weeks from the SAME quarter of another year
     cannot leak into the totals. ================================================== */
  {
    // boundaries, from both sides
    [["2026-03-31", "2026-Q1"], ["2026-04-01", "2026-Q2"],
     ["2026-06-30", "2026-Q2"], ["2026-07-01", "2026-Q3"],
     ["2026-09-30", "2026-Q3"], ["2026-10-01", "2026-Q4"],
     ["2026-12-31", "2026-Q4"], ["2027-01-01", "2027-Q1"]].forEach(([iso, q]) => {
      assert.strictEqual(ctx.quarterOf(iso), q, `${iso} files into ${q}`);
    });

    // exhaustive: no day of a year lands in a quarter that isn't its own
    const misfiled = [];
    for (let m = 0; m < 12; m++) {
      for (let day = 1; day <= 31; day++) {
        const dt = new Date(Date.UTC(2026, m, day));
        if (dt.getUTCMonth() !== m) continue;          // skip 31 Apr and friends
        const iso = dt.toISOString().slice(0, 10);
        const want = `2026-Q${Math.floor(m / 3) + 1}`;
        if (ctx.quarterOf(iso) !== want) misfiled.push([iso, ctx.quarterOf(iso), want]);
      }
    }
    assert.deepStrictEqual(misfiled, [], "every day of the year files into its own quarter");

    // …parsed as UTC, so a machine west of Greenwich can't shunt a boundary week back a day
    assert.ok(/function quarterOf[\s\S]{0,200}T00:00:00Z/.test(WEEKLY),
      "the date is read as UTC, so the local timezone can never move a week between quarters");

    // the same quarter of a DIFFERENT year is a different bucket, and stays out of the totals
    assert.strictEqual(ctx.quarterOf("2025-07-04"), "2025-Q3", "2025-Q3 is not 2026-Q3");
    const clean = summaryColumn(ctx, "2026-Q3");
    const withLastYear = await boot({
      weeks: [
        W("2025-07-05", 999.99, 500, 99, 99, 99, 100, 9, 99, 199, 99),
        W("2025-08-02", 999.99, 500, 99, 99, 99, 100, 9, 99, 199, 99),
        W("2025-09-27", 999.99, 500, 99, 99, 99, 100, 9, 99, 199, 99),
        ...WEEKS,
      ],
      plans: {},
    });
    await withLastYear.settle();
    assert.deepStrictEqual(summaryColumn(withLastYear.ctx, "2026-Q3"), clean,
      "adding a whole 2025-Q3 changes nothing about 2026-Q3's summary");
    assert.strictEqual(summaryColumn(withLastYear.ctx, "2025-Q3")["Leads"], "1500",
      "…and 2025-Q3 totals only its own weeks");

    // the picker offers exactly the quarters the data actually spans, so what you select is
    // what gets filtered — one function decides both
    ctx.buildQuarterSelector();
    const opts = (ctx.document.getElementById("quarterSel").innerHTML.match(/value="([^"]+)"/g) || [])
      .map((m) => /value="([^"]+)"/.exec(m)[1]);
    assert.deepStrictEqual(opts, ["2026-Q2", "2026-Q3"], "the picker lists only the quarters with data");
    assert.strictEqual(ctx.document.getElementById("quarterSel").value, "2026-Q3",
      "…and opens on the quarter of the most recent week");
  }

  /* ================= 2. THE FIX: CPA is spend ÷ trial sales, top to bottom ============= */
  {
    const sum = summaryColumn(ctx, "2026-Q3");
    const spend = S("adSpend"), trials = S("trialSales"), signups = S("signups");

    assert.strictEqual(sum["Cost Per Acquisition"], money(spend / trials),
      "the quarter's CPA is its ad spend divided by its trial sales");
    assert.notStrictEqual(money(spend / trials), money(spend / signups),
      "…and the fixture is chosen so the two definitions genuinely differ");
    assert.notStrictEqual(sum["Cost Per Acquisition"], money(spend / signups),
      "…so it is NOT dividing by membership sign-ups any more");
    assert.strictEqual(sum["Cost Per Acquisition"], "£66", "on this quarter that is £66, not £101");
    assert.ok(/totTrials\?gbp\(totSpend\/totTrials\)/.test(WEEKLY),
      "…and the summary divides by the quarter's trial sales in the source, not its sign-ups");

    // and it is the same metric as the weekly cells sitting beside it
    const cells = weekCells(ctx, "Cost Per Acquisition");
    assert.strictEqual(cells.length, 13, "every Q3 week has a CPA cell");
    Q3.forEach((w, i) => {
      assert.strictEqual(cells[i], w.trialSales ? money(w.adSpend / w.trialSales) : "—",
        `week ${w.weekEnding}'s CPA cell is its own spend ÷ trial sales`);
    });
    assert.strictEqual(cells[2], "—", "a week with no trial sales shows a dash, not a divide-by-zero");
  }

  /* ================= 3. the rest of the summary column ================= */
  {
    const sum = summaryColumn(ctx, "2026-Q3");
    const spend = S("adSpend"), leads = S("leads");

    // straight sums
    assert.strictEqual(sum["Ad Spend"], money(spend), "ad spend is the sum of the quarter's weeks");
    assert.strictEqual(sum["Ad Spend"], "£3,441", "…£3,441 on this quarter");
    assert.strictEqual(sum["Leads"], String(leads), "leads add up");
    assert.strictEqual(sum["Leads"], "283", "…283 on this quarter");
    assert.strictEqual(sum["Trial Sales"], String(S("trialSales")), "trial sales add up");
    assert.strictEqual(sum["Membership Sign Ups"], String(S("signups")), "sign-ups add up");
    assert.strictEqual(sum["Cancellations"], String(S("cancellations")), "cancellations add up");
    assert.strictEqual(sum["Net Gain"], "+" + (S("signups") - S("cancellations")),
      "net gain is the quarter's sign-ups less its cancellations, signed");

    // a rate over the whole quarter — total ÷ total, NOT the mean of the weekly rates
    assert.strictEqual(sum["Cost Per Lead"], money(spend / leads),
      "cost per lead is the quarter's spend divided by the quarter's leads");
    assert.ok(/totLeads\?gbp\(totSpend\/totLeads\)/.test(WEEKLY),
      "…computed as total spend over total leads, never as the mean of the weekly rates");

    // snapshots — a headcount is a reading, not something you add up
    assert.strictEqual(sum["Recurring Members"], "186", "recurring members is the quarter's LAST reading");
    assert.strictEqual(sum["Paused Members"], "5", "…so is paused");
    assert.strictEqual(sum["Total Active Trialists"], "29", "…and active trialists");
    assert.strictEqual(sum["Total Active"], "198", "…and total active");
    assert.ok(sum["Recurring Members"] !== String(S("recurring")), "…none of them are summed");

    // attendance is a percentage, so it averages
    const att = Q3.map((w) => w.attendance);
    assert.strictEqual(sum["Attendance"], Math.round(att.reduce((a, b) => a + b, 0) / att.length) + "%",
      "attendance is the mean of the quarter's weeks");
  }

  /* ================= 4. a snapshot metric skips the weeks that have none ============= */
  // The last three weeks record no paused/trialist count. The summary must fall back to the
  // last week that actually has one, not show a blank because the final week is empty.
  // (Recurring members is different: the app derives an unrecorded week from the one before
  // it plus that week's net gain, so it always has a value — asserted here so the two
  // behaviours stay distinguishable.)
  {
    const holes = WEEKS.map((w, i) => (i >= 14 ? { ...w, paused: null, trialists: null } : w));
    const e2 = await boot({ weeks: holes, plans: {} });
    await e2.settle();
    const sum = summaryColumn(e2.ctx, "2026-Q3");
    assert.strictEqual(sum["Paused Members"], "4",
      "the last reading is the last one actually RECORDED, not a blank final week");
    assert.strictEqual(sum["Total Active Trialists"], "26", "…same rule for active trialists");
    assert.strictEqual(sum["Recurring Members"], "186",
      "recurring members still reads the final week — the app derives it when it is not recorded");
  }

  /* ================= 5. an empty quarter says so rather than dividing by zero ========= */
  {
    const sum = summaryColumn(ctx, "2026-Q1");
    assert.deepStrictEqual(Object.keys(sum), [], "a quarter with no weeks renders no summary row");
    assert.ok(ctx.document.getElementById("scorecardTable").innerHTML.includes("No data for this quarter."),
      "…it says there is no data");

    // and a quarter that ran no ads must not show £NaN or £Infinity anywhere
    const noAds = WEEKS.map((w) => ({ ...w, adSpend: 0, leads: 0 }));
    const e3 = await boot({ weeks: noAds, plans: {} });
    await e3.settle();
    const s3 = summaryColumn(e3.ctx, "2026-Q3");
    assert.strictEqual(s3["Cost Per Lead"], "—", "no leads → no cost per lead");
    assert.strictEqual(s3["Cost Per Acquisition"], "£0", "no spend → the CPA is £0, not NaN");
    assert.ok(!JSON.stringify(s3).match(/NaN|Infinity/), "nothing in the column is NaN or Infinity");
  }

  console.log("v118-quarter-summary-cpa.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
