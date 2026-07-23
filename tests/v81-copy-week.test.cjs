// v81 harness — the "Copy week" button. Assembles the whole week as clean, AI-readable
// plain text: week date → daily check-ins (skipping empty days) → tasks with real done-state
// (per-day recurringDone/trainingDone) + a stats line → time blocks → notes (both tabs) →
// review checklist + wins/notDone/blockers. Asserts the content, the plain-text conversion
// (bullets → "- ", checkboxes → "[ ]/[x]"), that no markup/markers/raw ids leak, that empty
// sections/days are skipped, and that the copy path uses the shared clipboard helper + flashes.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const WEEK = "2026-03-16"; // a Monday inside NAV_WEEKS
const MARK = "<!--wp:rich-->";

function richWeek() {
  const defaults = [
    { id: "r1", title: "Standup", days: ["mon", "tue", "wed"], time: "6-9" }, // multi-day
    { id: "r2", title: "Weekly Scorecard" },                                   // single/unscheduled
  ];
  const training = [{ id: "t1", title: "Leg day", days: ["mon"], time: "6-9" }];
  const plans = {
    [WEEK]: {
      weekEnding: WEEK,
      projectItems: [{ id: "p1", title: "Ship Copy Week", done: true }, { id: "p2", title: "Fix bug", done: false }],
      bufferItems: [{ id: "b1", title: "Email members", done: false }],
      placements: { "6-9:mon": ["recurring:r1", "training:t1"], "1-3:tue": ["project:p1"] },
      timeBlocks: { "6-9": { mon: "deep work" }, "5-8": { wed: "gym" } },
      recurringDone: { "r1:mon": true, "r1:tue": true, "r2": true },
      trainingDone: { "t1": true },
      notes: MARK + "<b>big idea</b><ul><li>one</li><li>two</li></ul>",
      foodNotes: MARK + "protein every meal",
      review: { wins: "shipped v81", notDone: "the audit", carryForward: "", blockers: "none" },
      reviewChecklist: { training: true, todo: true },
    },
  };
  const checkins = {
    "2026-03-16": { date: "2026-03-16", mind: MARK + "clear head", gratitude: MARK + "family", oneThing: MARK + "<b>Ship it</b>", oneThingDone: true, doneNote: MARK + "nailed it", dismissed: true },
    "2026-03-17": { date: "2026-03-17", dismissed: true }, // skipped/empty → must be omitted
    "2026-03-18": { date: "2026-03-18", oneThing: MARK + "Rest", dismissed: true }, // partial → included
  };
  return { defaults, training, plans, checkins };
}

(async () => {
  /* ---------- 1: the assembled text has every populated section, in order, no markup ---------- */
  {
    const { defaults, training, plans, checkins } = richWeek();
    const { ctx } = await boot({ defaults, training, plans, checkins });
    await ctx.loadWeeklyPlan(WEEK);
    const txt = ctx.wpBuildWeekText();

    // week header
    assert.ok(txt.includes("Week beginning 16 March 2026"), "week date in the header");
    // sensible section order: week → check-ins → tasks → time blocks → notes → review
    const order = ["WEEKLY SUMMARY", "DAILY CHECK-INS", "TASKS", "TIME BLOCKS", "NOTES", "END-OF-WEEK REVIEW"];
    let last = -1;
    order.forEach((h) => { const at = txt.indexOf(h); assert.ok(at > last, `${h} present and in order`); last = at; });

    // no HTML tags, no rich marker, no raw ids/keys
    assert.ok(!/<[a-z/!]/i.test(txt), "no HTML markup in the output");
    assert.ok(!txt.includes("wp:rich"), "no rich-text marker leaks");
    assert.ok(!txt.includes("recurring:") && !txt.includes("project:") && !txt.includes("training:") && !txt.includes("buffer:"), "no raw refs/ids");
    assert.ok(!txt.includes("r1") && !txt.includes("p1") && !txt.includes("t1"), "no internal item ids");
  }

  /* ---------- 2: daily check-ins — content in, empty days skipped ---------- */
  {
    const { defaults, training, plans, checkins } = richWeek();
    const { ctx } = await boot({ defaults, training, plans, checkins });
    await ctx.loadWeeklyPlan(WEEK);
    const txt = ctx.wpBuildWeekText();
    assert.ok(txt.includes("Mon 16 March 2026:"), "the answered Monday is included");
    assert.ok(txt.includes("On my mind: clear head") && txt.includes("Grateful for: family") && txt.includes("One thing: Ship it"), "the three answers appear");
    assert.ok(txt.includes("Did the one thing: Yes — nailed it"), "the evening close-the-loop is included with its note");
    assert.ok(txt.includes("Wed 18 March 2026:") && txt.includes("One thing: Rest"), "a partially-answered day is included");
    assert.ok(!txt.includes("17 March"), "the empty/skipped Tuesday is omitted (no blank block)");
  }

  /* ---------- 3: tasks use the real done-state (per-day) + a per-category stats line ---------- */
  {
    const { defaults, training, plans, checkins } = richWeek();
    const { ctx } = await boot({ defaults, training, plans, checkins });
    await ctx.loadWeeklyPlan(WEEK);
    const txt = ctx.wpBuildWeekText();
    // multi-day recurring shows per-day recurringDone
    assert.ok(txt.includes("Standup: Mon [x], Tue [x], Wed [ ]"), "multi-day recurring shows per-day done-state");
    assert.ok(txt.includes("[x] Weekly Scorecard"), "single recurring uses its plain done key");
    assert.ok(txt.includes("[x] Ship Copy Week") && txt.includes("[ ] Fix bug"), "project done-state");
    assert.ok(txt.includes("[ ] Email members"), "buffer done-state");
    assert.ok(txt.includes("[x] Leg day"), "training done-state (trainingDone)");
    // stats line: completed vs planned per category
    assert.ok(txt.includes("Stats (done/planned): Recurring 1/2, Project 1/2, Buffer 0/1, Training 1/1"), "per-category stats line");
  }

  /* ---------- 4: time blocks resolve refs to titles + free text ---------- */
  {
    const { defaults, training, plans, checkins } = richWeek();
    const { ctx } = await boot({ defaults, training, plans, checkins });
    await ctx.loadWeeklyPlan(WEEK);
    const txt = ctx.wpBuildWeekText();
    assert.ok(txt.includes("Standup, Leg day — deep work"), "placed tasks (by title) + free text render together");
    assert.ok(txt.includes("Ship Copy Week"), "a placed project shows by title, not id");
    assert.ok(txt.includes("gym"), "free-text-only slot included");
  }

  /* ---------- 5: notes (both tabs) via the shared plain-text conversion ---------- */
  {
    const { defaults, training, plans, checkins } = richWeek();
    const { ctx } = await boot({ defaults, training, plans, checkins });
    await ctx.loadWeeklyPlan(WEEK);
    const txt = ctx.wpBuildWeekText();
    assert.ok(txt.includes("Notes / Brain Dump:"), "brain dump heading");
    assert.ok(txt.includes("big idea") && txt.includes("- one") && txt.includes("- two"), "rich HTML → plain, bullets become '- '");
    assert.ok(txt.includes("Intentions Around Food:") && txt.includes("protein every meal"), "food tab included");
  }

  /* ---------- 6: review — checklist ticks + wins / not done / blockers ---------- */
  {
    const { defaults, training, plans, checkins } = richWeek();
    const { ctx } = await boot({ defaults, training, plans, checkins });
    await ctx.loadWeeklyPlan(WEEK);
    const txt = ctx.wpBuildWeekText();
    assert.ok(txt.includes("[x] Training sessions diarised + checked in with coach"), "a ticked ritual step");
    assert.ok(txt.includes("[ ] Reflect on last week"), "an unticked step shown too");
    assert.ok(txt.includes("Wins this week:\nshipped v81"), "wins");
    assert.ok(txt.includes("What didn't get done:\nthe audit"), "what didn't get done");
    assert.ok(txt.includes("Issues / blockers:\nnone"), "issues/blockers");
  }

  /* ---------- 7: empty sections are skipped entirely (no padded headings) ---------- */
  {
    // a near-empty week: only a couple of tasks, nothing else
    const plans = { [WEEK]: { weekEnding: WEEK, projectItems: [{ id: "p1", title: "Solo task", done: false }], bufferItems: [], placements: {}, timeBlocks: {}, review: {}, reviewChecklist: {} } };
    const { ctx } = await boot({ plans });
    await ctx.loadWeeklyPlan(WEEK);
    const txt = ctx.wpBuildWeekText();
    assert.ok(txt.includes("WEEKLY SUMMARY") && txt.includes("TASKS") && txt.includes("Solo task"), "the populated bits are present");
    assert.ok(!txt.includes("DAILY CHECK-INS"), "no check-ins heading when there are none");
    assert.ok(!txt.includes("TIME BLOCKS"), "no time-blocks heading when empty");
    assert.ok(!txt.includes("NOTES"), "no notes heading when empty");
    assert.ok(!txt.includes("END-OF-WEEK REVIEW"), "no review heading when empty");
  }

  /* ---------- 8: the button renders in the review header + the copy path flashes feedback ---------- */
  {
    const { defaults, training, plans, checkins } = richWeek();
    const { ctx } = await boot({ defaults, training, plans, checkins });
    await ctx.loadWeeklyPlan(WEEK);
    // button lives in the End-of-Week Review header
    const body = ctx.document.getElementById("wpBody").innerHTML;
    const reviewAt = body.indexOf("End-of-Week Review");
    const btnAt = body.indexOf("wpCopyWeek()");
    assert.ok(btnAt !== -1 && body.includes("Copy week"), "the Copy week button is rendered");
    assert.ok(Math.abs(btnAt - reviewAt) < 400, "…in the review card header");

    // copy path: uses the shared clipboard helper, flashes "Copied ✓"
    const copied = [];
    ctx.navigator.clipboard = { writeText: (t) => { copied.push(t); return Promise.resolve(); } };
    await ctx.wpCopyWeek();
    assert.strictEqual(copied.length, 1, "wrote once to the clipboard");
    assert.ok(copied[0].includes("WEEKLY SUMMARY") && copied[0].includes("Standup: Mon [x]"), "the whole assembled week hit the clipboard");
    assert.strictEqual(ctx.document.getElementById("wpmsg-copyweek").textContent, "Copied ✓", "Copied ✓ feedback shown in the review header");
  }

  console.log("v81-copy-week.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
