// v119 harness — three changes in one release:
//   1. Inter is the typeface on all three pages (with the system stack still behind it);
//   2. the daily non-negotiables left the End-of-Week Review for their own card, directly
//      under the calendar;
//   3. the End-of-Week Review is a GUIDED FLOW — a modal that walks one step at a time.
// The flow stores nothing new: every step writes through an existing field and an existing
// save path, and (the trap this feature creates) writes through the CARD in #wpBody first,
// because wpSaveSection → wpSyncFromDom re-reads those fields from there.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/env.cjs");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const WEEKLY = read("index.html");
const MONTHLY = read("monthly.html");
const QUARTERLY = read("quarterly.html");

const WEEK = "2026-03-16"; // a Monday inside NAV_WEEKS
const IDS = ["training", "food", "priorities", "reflect", "todo", "motivation", "copyai"];
const plain = (o) => JSON.parse(JSON.stringify(o));
const planSaves = (posts, key) => posts.filter((p) => p.body.weeklyPlan && key in p.body.weeklyPlan);

(async () => {
  /* ================= 0. the build stamp ================= */
  assert.ok(/<!-- build v119 · eow-review-flow -->/.test(MONTHLY), "monthly.html stamped v119 · eow-review-flow");
  assert.ok(WEEKLY.includes("build v119 · eow-review-flow"), "index.html carries the same stamp");

  /* ================= 1. Inter, on all three pages ================= */
  for (const [label, src] of [["index.html", WEEKLY], ["monthly.html", MONTHLY], ["quarterly.html", QUARTERLY]]) {
    assert.ok(src.includes("fonts.googleapis.com/css2?family=Inter"), label + " loads Inter");
    assert.ok(src.includes('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'), label + " preconnects the font host");
    const m = /body\{font-family:([^;]+);/.exec(src);
    assert.ok(m, label + " sets the body font once");
    assert.ok(/^"Inter",/.test(m[1]), label + " puts Inter at the front of the stack");
    assert.ok(m[1].includes("-apple-system") && m[1].includes("sans-serif"), label + " keeps the system fallback behind it");
    // everything else on the page inherits — no second font-family stack anywhere
    const stacks = (src.match(/font-family:(?!inherit)/g) || []).length;
    const mono = (src.match(/font-family:ui-monospace/g) || []).length;
    assert.strictEqual(stacks - mono, 1, label + " declares exactly one non-inherited, non-mono stack");
  }

  /* ================= 2. the non-negotiables card sits under the calendar ================= */
  {
    const { ctx } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    const html = ctx.document.getElementById("wpBody").innerHTML;

    const grid = html.indexOf('class="wp-box wp-grid-box"');
    const card = html.indexOf('class="wp-box wp-nn-box"');
    const review = html.indexOf("End-of-Week Review");
    assert.ok(grid !== -1 && card !== -1 && review !== -1, "grid, non-negotiables card and review all render");
    assert.ok(grid < card, "the non-negotiables card comes after the calendar");
    assert.ok(card < review, "…and before the End-of-Week Review");
    assert.ok(html.indexOf('class="wp-nnw"') > card && html.indexOf('class="wp-nnw"') < review,
      "the tracker itself renders inside that card, not inside the review");
    assert.ok(html.includes("0 of 21 this week"), "the card header carries the week total");
    // it is still READ-ONLY: nothing between the card and the review card can be ticked
    const block = html.slice(card, review);
    assert.ok(!/<input|onclick|onchange/.test(block), "the non-negotiables card is a read-only summary");
    // and the review card no longer holds a tracker of its own
    assert.strictEqual((html.match(/class="wp-nnw"/g) || []).length, 1, "exactly one tracker on the page");
  }

  /* ================= 3. the steps are the checklist, plus a closing screen ================= */
  {
    const { ctx } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    const steps = Array.from(ctx.wpEowSteps());
    assert.strictEqual(steps.length, IDS.length + 1, "one step per checklist item, plus the finish screen");
    assert.deepStrictEqual(steps.slice(0, IDS.length).map((s) => s.id), IDS, "steps follow WP_REVIEW_CHECKLIST order");
    assert.strictEqual(steps[steps.length - 1].id, "__finish", "the last screen is the closing one");
    // the launcher is on the card, and the flow's overlay lives OUTSIDE #wpBody
    const html = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(html.includes("wpEowOpen()"), "the review card offers a way into the flow");
    assert.ok(html.includes("0 of 7 steps done"), "the launcher shows the week's progress");
    assert.ok(!html.includes('id="wpEowOverlay"'), "the flow's modal is not inside the re-rendered body");
    assert.ok(WEEKLY.includes('<div id="wpEowOverlay"'), "…it is static markup on the page");
  }

  /* ================= 4. opening picks up at the first unticked step ================= */
  {
    const { ctx } = await boot({
      plans: { [WEEK]: { weekEnding: WEEK, placements: {}, reviewChecklist: { training: true, food: true } } },
    });
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpEowOpen();
    assert.strictEqual(ctx.__wpState.eowOpen, true, "the flow is open");
    assert.strictEqual(ctx.__wpState.eowStep, 2, "opens on 'priorities' — the first step not yet ticked");
    assert.strictEqual(ctx.document.getElementById("wpEowTitle").textContent,
      "Business + personal priorities planned", "the header names the step");
    assert.ok(ctx.document.getElementById("wpEowFoot").innerHTML.includes("Step 3 of 8"), "footer counts the step");
    assert.strictEqual(ctx.document.getElementById("wpEowOverlay").hidden, false, "the overlay is shown");
    assert.strictEqual(ctx.document.body.style.overflow, "hidden", "the page behind is scroll-locked");
    ctx.wpEowClose();
    assert.strictEqual(ctx.__wpState.eowOpen, false, "…and closes");
    assert.strictEqual(ctx.document.body.style.overflow, "", "the scroll lock is released");
  }
  {
    // a fully ticked week opens straight on the closing screen
    const full = Object.fromEntries(IDS.map((id) => [id, true]));
    const { ctx } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {}, reviewChecklist: full } } });
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpEowOpen();
    assert.strictEqual(ctx.__wpState.eowStep, IDS.length, "all done → the finish screen");
    const body = ctx.document.getElementById("wpEowBody").innerHTML;
    assert.ok(body.includes("7 of 7 steps done"), "the score is shown");
    assert.ok(body.includes("Every step done"), "…and nothing is left open");
    assert.ok(ctx.document.getElementById("wpEowFoot").innerHTML.includes("wpEowFinishWeek()"), "the finish action is offered");
  }

  /* ================= 5. working through the steps ticks them off ================= */
  {
    const { ctx, posts } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpEowOpen();
    assert.strictEqual(ctx.__wpState.eowStep, 0, "a fresh week starts at step 1");

    ctx.wpEowNext();                       // training: mark done → next
    assert.strictEqual(ctx.__wpState.eowStep, 1, "moved on to 'food'");
    assert.deepStrictEqual(plain(ctx.__wpState.plan.reviewChecklist), { training: true }, "the step it left is ticked");

    ctx.wpEowSkip();                       // food: skipped, NOT ticked
    assert.strictEqual(ctx.__wpState.eowStep, 2, "skipping still moves on");
    assert.deepStrictEqual(plain(ctx.__wpState.plan.reviewChecklist), { training: true }, "a skipped step is not ticked");

    ctx.wpEowGo(0);                        // back to the start
    assert.strictEqual(ctx.__wpState.eowStep, 0, "jumped back");
    ctx.wpEowNext();                       // already ticked → advances without un-ticking
    assert.deepStrictEqual(plain(ctx.__wpState.plan.reviewChecklist), { training: true }, "an already-ticked step is left alone");

    // the tick can be taken back from inside the flow
    await ctx.wpEowToggle("training");
    assert.strictEqual(Object.keys(ctx.__wpState.plan.reviewChecklist).length, 0, "un-ticked from the flow");

    // every tick went through the EXISTING review save path, and dragged nothing else in
    const saves = planSaves(posts, "reviewChecklist");
    assert.strictEqual(saves.length, 2, "one save per tick — the two that changed, and no more");
    saves.forEach((p) => {
      assert.deepStrictEqual(Object.keys(p.body.weeklyPlan).sort(), ["review", "reviewChecklist", "weekEnding"],
        "the flow's ticks save on the review path only");
    });
    // the flow never invents a store key of its own
    assert.ok(!posts.some((p) => p.body.weeklyPlan && ("eow" in p.body.weeklyPlan || "reviewFlow" in p.body.weeklyPlan)),
      "no new stored field");
  }

  /* ================= 6. the food step writes the Intentions Around Food tab ================= */
  {
    const { ctx, posts } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {}, foodNotes: "old" } } });
    await ctx.loadWeeklyPlan(WEEK);
    // the card's editors exist on screen (the stub resolves [data-field=…] to them once created)
    const cardFood = ctx.document.getElementById("wpWeekFoodEd");
    cardFood.innerHTML = "old";

    ctx.wpEowOpen();
    ctx.wpEowGo(1);
    const step = ctx.document.getElementById("wpEowBody").innerHTML;
    assert.ok(step.includes("What needs fixing this week?"), "the food step asks what needs fixing");
    assert.ok(step.includes('id="wpEowFoodEd"'), "…in a rich editor");
    assert.ok(step.includes("Intentions Around Food"), "…and says where it lands");

    ctx.document.getElementById("wpEowFoodEd").innerHTML = "cut the late-night grazing";
    await ctx.wpEowSaveNotesField("foodNotes", "wpEowFoodEd");
    assert.ok(ctx.__wpState.plan.foodNotes.includes("cut the late-night grazing"), "the plan's foodNotes took the edit");
    assert.strictEqual(cardFood.innerHTML, ctx.wpNotesToEditorHtml(ctx.__wpState.plan.foodNotes),
      "the CARD's editor was written through first, so wpSyncFromDom can't re-read a stale value");
    const save = planSaves(posts, "foodNotes").pop();
    assert.ok(save, "saved through the foodNotes section");
    assert.deepStrictEqual(Object.keys(save.body.weeklyPlan).sort(), ["foodNotes", "weekEnding"],
      "foodNotes is never bundled with notes or anything else");
    assert.strictEqual(ctx.__wpState.plan.notes, "", "the brain dump is untouched");
  }

  /* ================= 7. the to-do step writes the brain dump ================= */
  {
    const { ctx, posts } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {}, notes: "old" } } });
    await ctx.loadWeeklyPlan(WEEK);
    const cardNotes = ctx.document.getElementById("wpWeekNotesEd");
    cardNotes.innerHTML = "old";

    ctx.wpEowOpen();
    ctx.wpEowGo(4);
    assert.ok(ctx.document.getElementById("wpEowBody").innerHTML.includes('id="wpEowNotesEd"'), "the to-do step hosts the brain dump");

    ctx.document.getElementById("wpEowNotesEd").innerHTML = "ring the accountant";
    await ctx.wpEowSaveNotesField("notes", "wpEowNotesEd");
    assert.ok(ctx.__wpState.plan.notes.includes("ring the accountant"), "the plan's notes took the edit");
    assert.strictEqual(cardNotes.innerHTML, ctx.wpNotesToEditorHtml(ctx.__wpState.plan.notes), "the card editor is in sync");
    const save = planSaves(posts, "notes").pop();
    assert.deepStrictEqual(Object.keys(save.body.weeklyPlan).sort(), ["notes", "weekEnding"], "saved on the notes path alone");
    assert.strictEqual(ctx.__wpState.plan.foodNotes, "", "the food tab is untouched");
  }

  /* ================= 8. the reflect step writes the review fields ================= */
  {
    const { ctx, posts } = await boot({
      plans: { [WEEK]: { weekEnding: WEEK, placements: {}, review: { wins: "", notDone: "", carryForward: "", blockers: "" } } },
    });
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpEowOpen();
    ctx.wpEowGo(3);
    const body = ctx.document.getElementById("wpEowBody").innerHTML;
    ["Wins this week", "What didn't get done?", "Issues / blockers"].forEach((l) =>
      assert.ok(body.includes(l), "the reflect step carries the field: " + l));
    assert.ok(body.includes('class="wp-nnw"'), "…and the week's non-negotiables to reflect against");

    ctx.document.getElementById("wpEowRev_wins").value = "40 trials booked";
    ctx.document.getElementById("wpEowRev_blockers").value = "no cover on Thursday";
    await ctx.wpEowSaveReview();
    assert.strictEqual(ctx.__wpState.plan.review.wins, "40 trials booked", "wins captured");
    assert.strictEqual(ctx.__wpState.plan.review.blockers, "no cover on Thursday", "blockers captured");
    assert.strictEqual(ctx.__wpState.plan.review.notDone, "", "an untouched field stays as it was");
    const save = planSaves(posts, "review").pop();
    assert.deepStrictEqual(Object.keys(save.body.weeklyPlan).sort(), ["review", "reviewChecklist", "weekEnding"],
      "saved on the existing review path");
    assert.strictEqual(save.body.weeklyPlan.review.wins, "40 trials booked", "…carrying the new value");
  }

  /* ================= 9. a commit only ever reads the step that is on screen ================= */
  {
    const { ctx } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {}, foodNotes: "keep me", notes: "keep me too" } } });
    await ctx.loadWeeklyPlan(WEEK);
    ctx.document.getElementById("wpWeekFoodEd").innerHTML = "keep me";
    ctx.document.getElementById("wpWeekNotesEd").innerHTML = "keep me too";
    ctx.wpEowOpen();
    ctx.wpEowGo(0);                          // the training step edits nothing
    ctx.document.getElementById("wpEowFoodEd").innerHTML = "";   // an off-screen editor, empty
    ctx.document.getElementById("wpEowNotesEd").innerHTML = "";
    ctx.wpEowCommit();
    assert.strictEqual(ctx.__wpState.plan.foodNotes, "keep me", "an off-screen editor is never read");
    assert.strictEqual(ctx.__wpState.plan.notes, "keep me too", "…for either field");
    // and a commit while the flow is shut is a no-op
    ctx.wpEowClose();
    ctx.wpEowCommit();
    assert.strictEqual(ctx.__wpState.plan.foodNotes, "keep me", "a closed flow writes nothing");
  }

  /* ================= 10. ticking a step commits what's on it first ================= */
  {
    // wpEowToggle re-renders the step in place (progress, the Done label), which rebuilds the
    // body from wpPlan. Anything typed and not yet committed has to be captured BEFORE that,
    // or the re-render throws it away.
    const { ctx } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    ctx.document.getElementById("wpWeekFoodEd").innerHTML = "";
    ctx.wpEowOpen();
    ctx.wpEowGo(1);
    ctx.document.getElementById("wpEowFoodEd").innerHTML = "more protein at breakfast";  // typed, never blurred
    await ctx.wpEowToggle("food");
    assert.ok(ctx.__wpState.plan.foodNotes.includes("more protein at breakfast"),
      "typing survives ticking the step off");
    assert.deepStrictEqual(plain(ctx.__wpState.plan.reviewChecklist), { food: true }, "…and the tick landed");
  }

  /* ================= 11. the training step reads the real training list ================= */
  {
    const { ctx } = await boot({
      plans: { [WEEK]: { weekEnding: WEEK, placements: {} } },
      training: [
        { id: "t1", title: "Lower body", days: ["mon", "thu"], time: "6-9" },
        { id: "t2", title: "Swim", days: [], time: "" },
      ],
    });
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpEowOpen();
    ctx.wpEowGo(0);
    const body = ctx.document.getElementById("wpEowBody").innerHTML;
    assert.ok(body.includes("Lower body") && body.includes("Swim"), "every session is listed");
    assert.ok(body.includes("Mon Thu"), "a booked session shows its days");
    assert.ok(body.includes("No day set"), "one without a day is called out");
    assert.ok(body.includes("wp-eow-li-warn"), "…and flagged");
    assert.ok(!body.includes("<input type=\"checkbox\" onchange=\"wpToggleDone"), "the step is read-only about training");
  }

  console.log("v119-eow-review-flow.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
