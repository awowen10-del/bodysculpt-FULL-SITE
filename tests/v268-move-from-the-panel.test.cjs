// v268 — move a job from its panel.
//
// Ash: "I should be able to move it here. A simple Move: tomorrow, and then a calendar to
// select the date. And again that should move everywhere — in every area of the dashboard."
//
// "Everywhere" is the v227/v252 rule: the step is the one place a project job lives, so the
// move is ONE stepLink write, read back off the served board. A dated step's date moves with
// it; an undated one is NOT handed a deadline. It keeps its time block. A move into another
// week takes the daily calendar's display copy with it (weeklyCancel + toWeek). The way back
// is on the confirmation, and it puts the step back exactly where it was.
//
// Dates come from the real clock, so the test means the same thing whatever day it runs.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const pad = (n) => String(n).padStart(2, "0");
const localYmd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const TODAY = localYmd(new Date());
const addDays = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOfYmd = (ymd) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const dayOf = (ymd) => DAYS[new Date(ymd + "T00:00:00Z").getUTCDay()];
const THIS = mondayOfYmd(TODAY);
const TOMORROW = addDays(TODAY, 1);
const NEXT_WED = addDays(THIS, 9);   // always next week

const step = (id, extra) => Object.assign({ id, title: "Step " + id, col: "todo", urgency: "normal", due: "",
  tags: [], notes: "", checklist: [], files: [], done: false, del: false, order: 0,
  week: "", day: "", slot: "", colBefore: "" }, extra || {});
const PROJECT = () => ({
  id: "p1", name: "Ads back on & leads worked", status: "active", accent: "orange", archived: false,
  columns: [{ id: "todo", name: "To do", done: false }, { id: "done", name: "Done", done: true }],
  steps: [
    // dated today, at 10–12 — like "Record 1-3 problem ads" on Thu 29
    step("s_dated", { title: "Record 1-3 problem ads", due: TODAY, week: THIS, day: dayOf(TODAY), slot: "10-12",
      notes: "Talking head, one problem per ad." }),
    // undated, pulled onto today with no notes at all
    step("s_bare", { title: "Email to S&P List", week: THIS, day: dayOf(TODAY), slot: "1-3" }),
  ],
  canvas: [],
});
const emptyWeek = (w) => ({ weekEnding: w, projectItems: [], bufferItems: [], placements: {} });
const cancels = (posts) => posts.filter((p) => p.body && p.body.weeklyCancel).map((p) => p.body.weeklyCancel);

(async () => {
  /* 1. THE PANEL OFFERS IT — on every step, notes or none */
  {
    const { ctx } = await boot({ projects: [PROJECT()], plans: { [THIS]: emptyWeek(THIS) } });
    await ctx.loadWeeklyPlan(THIS);
    const bare = ctx.wpProjItemById("ps-s_bare");
    assert.ok(bare, "the undated step is on today");
    assert.ok(ctx.wpStepDetail(bare), "a step with nothing written on it still opens");
    const html = ctx.wpStepMoveHtml(bare, ctx.wpStepFor(bare).step);
    assert.ok(/Tomorrow/.test(html), "the panel offers Tomorrow");
    assert.ok(html.includes(TOMORROW), "…meaning the real tomorrow");
    assert.ok(/type="date"/.test(html) && />Move</.test(html), "…and a date to pick, with Move");

    // already on tomorrow: the one tap is the day after
    const s = ctx.wpStepFor(bare).step;
    const keep = { week: s.week, day: s.day };
    s.week = mondayOfYmd(TOMORROW); s.day = dayOf(TOMORROW);
    const h2 = ctx.wpStepMoveHtml(bare, s);
    assert.ok(/Day after/.test(h2) && h2.includes(addDays(TOMORROW, 1)), "a job already on tomorrow offers the day after");
    Object.assign(s, keep);
  }

  /* 2. TOMORROW — a dated step: date, day and week move on the board; time block kept */
  {
    const { ctx, posts, projects, settle } = await boot({ projects: [PROJECT()], plans: { [THIS]: emptyWeek(THIS) } });
    await ctx.loadWeeklyPlan(THIS);
    let undo = null;
    ctx.wpToastUndo = (msg, fn) => { undo = { msg, fn }; };
    const n0 = posts.length;
    await ctx.wpStepMoveToDate("ps-s_dated", TOMORROW);
    await settle();
    const st = projects[0].steps.find((x) => x.id === "s_dated");
    assert.strictEqual(st.due, TOMORROW, "the board's due date is tomorrow");
    assert.strictEqual(st.week, mondayOfYmd(TOMORROW), "…in tomorrow's week");
    assert.strictEqual(st.day, dayOf(TOMORROW), "…on tomorrow's day");
    assert.strictEqual(st.slot, "10-12", "…in the same time block");
    const crossed = mondayOfYmd(TOMORROW) !== THIS;
    assert.strictEqual(cancels(posts.slice(n0)).length, crossed ? 1 : 0,
      "the calendar copy is carried across only when the move crosses into another week");
    assert.ok(undo && /moved to/.test(undo.msg), "the confirmation says where it went, with Undo on it");

    await undo.fn();
    await settle();
    assert.strictEqual(st.due, TODAY, "Undo puts the date back");
    assert.strictEqual(st.day, dayOf(TODAY), "…and the day");
    assert.strictEqual(st.slot, "10-12", "…and the time block");
  }

  /* 3. A PICKED DATE IN ANOTHER WEEK — an undated step is not handed a deadline */
  {
    const { ctx, posts, projects, settle } = await boot({ projects: [PROJECT()], plans: { [THIS]: emptyWeek(THIS) } });
    await ctx.loadWeeklyPlan(THIS);
    let undo = null;
    ctx.wpToastUndo = (msg, fn) => { undo = { msg, fn }; };
    const n0 = posts.length;
    await ctx.wpStepMoveToDate("ps-s_bare", NEXT_WED);
    await settle();
    const st = projects[0].steps.find((x) => x.id === "s_bare");
    assert.strictEqual(st.due, "", "an undated step stays undated");
    assert.strictEqual(st.week, addDays(THIS, 7), "…and is planned into next week");
    assert.strictEqual(st.day, "wed", "…on Wednesday");
    assert.strictEqual(st.slot, "1-3", "…at the same time");
    assert.ok(!ctx.wpProjItemById("ps-s_bare"), "it has left this week's grid");
    const c = cancels(posts.slice(n0));
    assert.strictEqual(c.length, 1, "the daily calendar's copy is moved once");
    assert.deepStrictEqual({ from: c[0].weekEnding, to: c[0].toWeek, cell: c[0].to, tgt: c[0].tgt },
      { from: THIS, to: addDays(THIS, 7), cell: "1-3:wed", tgt: { p: "p1", s: "s_bare" } },
      "…out of this week, onto next Wednesday 1–3");

    const n1 = posts.length;
    await undo.fn();
    await settle();
    assert.strictEqual(st.week, THIS, "Undo brings it back to this week");
    assert.strictEqual(st.day, dayOf(TODAY), "…to today");
    assert.ok(ctx.wpProjItemById("ps-s_bare"), "…and onto the grid");
    const back = cancels(posts.slice(n1));
    assert.ok(back.length === 1 && back[0].weekEnding === addDays(THIS, 7) && back[0].toWeek === THIS,
      "…and its calendar copy comes back too");
  }

  /* 4. NOTHING HAPPENS FOR THE SAME DAY OR A NONSENSE DATE */
  {
    const { ctx, posts, settle } = await boot({ projects: [PROJECT()], plans: { [THIS]: emptyWeek(THIS) } });
    await ctx.loadWeeklyPlan(THIS);
    const n0 = posts.length;
    await ctx.wpStepMoveToDate("ps-s_dated", TODAY);
    await ctx.wpStepMoveToDate("ps-s_dated", "");
    await settle();
    assert.ok(!posts.slice(n0).some((p) => p.body && p.body.stepLink), "no write for the day it is already on, or no date");
  }

  console.log("v268 move from the panel: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
