// v67 harness — the Today focus modal. Assertions: the modal renders ONLY today's
// placements (never another day's); ticking done in the modal writes the exact same
// recurringDone keys as the grid path (per-day "<id>:<day>" for multi-day tasks,
// plain "<id>" for single-day); notes edited in the modal persist through the normal
// weekly notes save; a week that doesn't contain today shows the off-week message.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const ALL_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Same week math as the app (mondayOf / getUTCDay), computed from one Date so the
// test agrees with the script about what "today" is regardless of when it runs.
const NOW = new Date();
function mondayIso(d) {
  const x = new Date(d);
  const back = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - back);
  x.setUTCHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}
const WEEK = mondayIso(NOW);               // the real current week's Monday
const TODAY = ALL_DAYS[NOW.getUTCDay()];   // today's grid day-key
const OTHER = TODAY === "mon" ? "tue" : "mon"; // any other day in the same week
const NEXT = (() => { const d = new Date(WEEK + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();

(async () => {
  const defaults = [
    // multi-day recurring: placed today AND another day — modal must show only today's chip
    { id: "r1", title: "Standup", days: [TODAY, OTHER], time: "6-9", link: "example.com/standup" },
    // recurring placed ONLY on another day — must not appear in the modal at all
    { id: "r2", title: "Scorecard", days: [OTHER], time: "10-12" },
  ];
  const plans = {
    [WEEK]: {
      weekEnding: WEEK,
      projectItems: [{ id: "p1", title: "Ship v67", done: false }],
      placements: {
        ["6-9:" + TODAY]: ["recurring:r1"],
        ["6-9:" + OTHER]: ["recurring:r1"],
        ["10-12:" + OTHER]: ["recurring:r2"],
        ["1-3:" + TODAY]: ["project:p1"],
      },
      notes: "weekly notes here",
      timeBlocks: { "5-8": { [TODAY]: "free text tonight" } },
    },
    [NEXT]: { weekEnding: NEXT, placements: { ["6-9:" + TODAY]: ["recurring:r1"] } },
  };
  const { ctx, posts } = await boot({ defaults, plans });
  await ctx.loadWeeklyPlan(WEEK);
  const st = ctx.__wpState;

  // ---------- 0: the Today button sits in the Time Blocks header; grid chips unchanged ----------
  const gridHtml = ctx.document.getElementById("wpBody").innerHTML;
  assert.ok(gridHtml.includes(`class="wp-today-btn"`) && gridHtml.includes("wpOpenToday()"), "Today button rendered in the grid header");
  assert.ok(gridHtml.includes(`wpToggleDoneRef('recurring:r1',this.checked,'${TODAY}')`), "grid chips still use the grid done path after the chip-render extraction");

  // ---------- 1: modal shows ONLY today's placements ----------
  ctx.wpOpenToday();
  const ov = ctx.document.getElementById("wpTodayOverlay");
  assert.strictEqual(ov.hidden, false, "overlay unhidden on open");
  assert.strictEqual(ctx.document.body.style.overflow, "hidden", "page scroll locked while open");
  let html = ctx.document.getElementById("wpTodayBody").innerHTML;
  assert.ok(html.includes(`wpTodayToggleDone('recurring:r1',this.checked,'${TODAY}')`), "today's recurring chip rendered, ticking via the modal path");
  assert.ok(html.includes(`wpTodayToggleDone('project:p1',this.checked,'${TODAY}')`), "today's project chip rendered");
  assert.ok(!html.includes(`,'${OTHER}')`), "no chip carries another day's tick handler");
  assert.ok(!html.includes("recurring:r2"), "a task placed only on another day does not appear");
  assert.ok(!html.includes("Scorecard"), "…nor does its title");
  assert.ok(html.includes("wp-recur"), "recurring chip keeps the teal accent class");
  assert.ok(html.includes(`href="https://example.com/standup"`) && html.includes("wp-chip-link"), "↗ link rendered via wpValidUrl");
  assert.ok(!html.includes("draggable"), "modal chips are not draggable — read-and-tick only");
  assert.ok(html.includes("free text tonight"), "today's free-text block text shown");
  assert.ok(html.includes("weekly notes here"), "weekly notes shown in the modal");

  // ---------- 2: ticking done in the modal writes the SAME keys as the grid ----------
  await ctx.wpTodayToggleDone("recurring:r1", true, TODAY);
  const rd = st.plan.recurringDone;
  assert.strictEqual(rd["r1:" + TODAY], true, "multi-day task done under the per-day key");
  assert.ok(!("r1" in rd), "no plain key invented for a multi-day task");
  await ctx.wpTodayToggleDone("project:p1", true, TODAY);
  assert.strictEqual(st.plan.projectItems.find((x) => x.id === "p1").done, true, "project item done flag set");
  // the tick was SAVED through the normal section path
  const tickSaves = posts.filter((p) => p.body.weeklyPlan && p.body.weeklyPlan.recurringDone);
  assert.ok(tickSaves.some((p) => p.body.weeklyPlan.recurringDone["r1:" + TODAY] === true), "per-day done key round-trips to the store");
  // reflected in the weekly grid underneath (wpToggleDoneRef re-rendered it)…
  assert.ok(ctx.document.getElementById("wpBody").innerHTML.includes(`"checkbox" checked`), "weekly grid re-rendered with the tick");
  // …and in the re-rendered modal
  html = ctx.document.getElementById("wpTodayBody").innerHTML;
  assert.ok(html.includes(`"checkbox" checked`), "modal re-rendered showing the tick");

  // ---------- 3: notes edited in the modal persist to the weekly notes ----------
  ctx.document.getElementById("wpTodayNotes").value = "edited in the modal";
  await ctx.wpTodaySaveNotes();
  assert.strictEqual(st.plan.notes, "edited in the modal", "wpPlan.notes updated from the modal");
  const noteSaves = posts.filter((p) => p.body.weeklyPlan && "notes" in p.body.weeklyPlan);
  const lastNotes = noteSaves[noteSaves.length - 1];
  assert.ok(lastNotes, "notes section save posted");
  assert.strictEqual(lastNotes.body.weeklyPlan.notes, "edited in the modal", "same weekly notes field written to the store");
  assert.strictEqual(lastNotes.body.weeklyPlan.weekEnding, WEEK, "saved against the viewed week");
  // unchanged value → no duplicate save
  const savesBefore = posts.length;
  await ctx.wpTodaySaveNotes();
  assert.strictEqual(posts.length, savesBefore, "no redundant save when notes are unchanged");
  // re-render shows the edited notes (weekly view and modal read the same field)
  ctx.wpRenderTodayBody();
  assert.ok(ctx.document.getElementById("wpTodayBody").innerHTML.includes("edited in the modal"), "modal re-render reads the same notes value");
  ctx.renderWeeklyPlan();
  assert.ok(ctx.document.getElementById("wpBody").innerHTML.includes("edited in the modal"), "weekly Notes panel shows the modal edit");

  // ---------- 4: close restores scroll and hides ----------
  ctx.document.getElementById("wpTodayNotes").value = "edited in the modal"; // fake DOM keeps a detached element — align it so close doesn't re-save
  ctx.wpCloseToday();
  assert.strictEqual(ctx.document.body.style.overflow, "", "page scroll restored on close");
  await new Promise((r) => setTimeout(r, 250));
  assert.strictEqual(ctx.document.getElementById("wpTodayOverlay").hidden, true, "overlay hidden after the close transition");

  // ---------- 5: today outside the viewed week → clear message, no chips ----------
  await ctx.loadWeeklyPlan(NEXT);
  ctx.wpOpenToday();
  html = ctx.document.getElementById("wpTodayBody").innerHTML;
  assert.ok(html.includes("isn't in the week you're viewing"), "off-week message shown");
  assert.ok(!html.includes("wpTodayToggleDone"), "no tickable chips rendered for a week that doesn't contain today");
  ctx.wpCloseToday();

  console.log("v67-today.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
