// v255 — add and diarise training from the End-of-Week Review.
//
// Ash: "it would be awesome to be able to actually add them from this screen here — and for
// it to sync onto the calendar and show in the training diary box too."
//
// The step writes through the Training card's own path (wpTraining + wpSetRecurrence), so the
// one save puts the session on the Training card, on every week's grid — next week included —
// and on Today. It never writes next week's record.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const WEEK = "2026-03-16";
const NEXT = "2026-03-23";
const tick = (ctx, days) => days.forEach((d) => { ctx.document.getElementById("wpEowTrainDay_" + d).checked = true; });

(async () => {
  /* 1. no training yet: the step offers to add, and adding puts it everywhere */
  {
    const { ctx, posts, settle } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpEowOpen(); ctx.wpEowGo(0); await settle();
    let body = ctx.document.getElementById("wpEowBody").innerHTML;
    assert.ok(body.includes("No training set up yet"), "empty state still says so");
    assert.ok(body.includes("wpEowTrainOpen('')"), "…and offers + Add a session");

    ctx.wpEowTrainOpen("");
    body = ctx.document.getElementById("wpEowBody").innerHTML;
    assert.ok(body.includes('id="wpEowTrainName"') && body.includes('id="wpEowTrainDay_mon"') && body.includes('id="wpEowTrainSlot"'),
      "the form asks for a name, days and a slot");

    // incomplete: nothing saved, a reason given
    ctx.document.getElementById("wpEowTrainName").value = "";
    await ctx.wpEowTrainSave();
    assert.strictEqual(ctx.__wpState.training.length, 0, "no name, nothing added");
    assert.ok(ctx.document.getElementById("wpEowBody").innerHTML.includes("Give the session a name"), "…and it says why");
    ctx.document.getElementById("wpEowTrainName").value = "Lower body";
    await ctx.wpEowTrainSave();
    assert.strictEqual(ctx.__wpState.training.length, 0, "no days, nothing added");
    assert.ok(ctx.document.getElementById("wpEowBody").innerHTML.includes("Tick at least one day"), "…and it says why");

    tick(ctx, ["mon", "thu"]);
    ctx.document.getElementById("wpEowTrainSlot").value = "5-8";
    const before = posts.length;
    await ctx.wpEowTrainSave(); await settle();
    const t = ctx.__wpState.training;
    assert.strictEqual(t.length, 1, "the session is on the Training list");
    assert.strictEqual(t[0].title, "Lower body");
    assert.deepStrictEqual(Array.from(t[0].days), ["mon", "thu"], "with its days");
    assert.strictEqual(t[0].time, "5-8", "and its slot");
    const saved = posts.slice(before).find((p) => Array.isArray(p.body.trainingDefaults));
    assert.ok(saved && saved.body.trainingDefaults.some((d) => d.title === "Lower body" && d.time === "5-8"),
      "saved through the Training list's own save");
    assert.ok(!posts.some((p) => p.body.weeklyPlan && p.body.weeklyPlan.weekEnding === NEXT), "next week's record is never written");

    const ref = "training:" + t[0].id;
    assert.ok((ctx.wpEffectivePlacements()["5-8:mon"] || []).includes(ref), "this week's grid has it");
    assert.ok((ctx.wpEowNextWeekCells()["5-8:thu"] || []).includes(ref), "next week's grid has it");
    body = ctx.document.getElementById("wpEowBody").innerHTML;
    assert.ok(body.includes("Lower body") && body.includes("Mon Thu · 5 – 8"), "the step now shows it diarised");
    assert.ok(ctx.document.getElementById("wpBody").innerHTML.includes('data-item-title="training:' + t[0].id + '"'),
      "the Training card underneath shows it");
  }

  /* 2. an unscheduled session gets Set days; a scheduled one skipped next week does not */
  {
    const { ctx, settle } = await boot({
      training: [
        { id: "t1", title: "Swim", days: [], time: "" },
        { id: "t2", title: "Run", days: ["tue"], time: "6-9" },
      ],
      plans: {
        [WEEK]: { weekEnding: WEEK, placements: {} },
        [NEXT]: { weekEnding: NEXT, placements: {}, exceptions: { "training:t2": { type: "skip", from: "6-9:tue" } } },
      },
    });
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpEowOpen(); ctx.wpEowGo(0); await settle();
    let body = ctx.document.getElementById("wpEowBody").innerHTML;
    assert.ok(body.includes("wpEowTrainOpen('t1')"), "Swim offers Set days");
    assert.ok(!body.includes("wpEowTrainOpen('t2')"), "a deliberately skipped session doesn't");

    ctx.wpEowTrainOpen("t1");
    tick(ctx, ["sat"]);
    ctx.document.getElementById("wpEowTrainSlot").value = "10-12";
    await ctx.wpEowTrainSave(); await settle();
    const swim = ctx.__wpState.training.find((x) => x.id === "t1");
    assert.deepStrictEqual(Array.from(swim.days), ["sat"], "Swim now has a standing day");
    assert.strictEqual(ctx.__wpState.training.length, 2, "no duplicate made");
    assert.ok((ctx.wpEowNextWeekCells()["10-12:sat"] || []).includes("training:t1"), "and is in next week");
  }

  /* 3. a filled-in form is saved by Mark done, not lost */
  {
    const { ctx, settle } = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    ctx.wpEowOpen(); ctx.wpEowGo(0); await settle();
    ctx.wpEowTrainOpen("");
    ctx.document.getElementById("wpEowTrainName").value = "Yoga";
    tick(ctx, ["wed"]);
    ctx.wpEowNext(); await settle();
    assert.ok(ctx.__wpState.training.some((x) => x.title === "Yoga"), "Mark done kept the session typed in");
    assert.strictEqual(ctx.__wpState.eowStep, 1, "and moved on");
  }

  console.log("v255-diarise-from-the-review.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
