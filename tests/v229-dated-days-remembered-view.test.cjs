// v229 — the Time Blocks grid says its dates, and remembers how many days you look at.
//
// 1. Column headers read "Mon 19", "Tue 20"… for the week being viewed (a week crossing
//    into a new month reads "… Sat 31, Sun 1" — no month needed), today's column is marked,
//    and the ‹ range › label carries the dates too ("Mon 19 – Fri 23").
// 2. The day COUNT (1/2/3/5/7) is remembered on this device in localStorage ("wp.dayCount"),
//    never in the weekly plan store. The START is not: a load opens on today when today is in
//    the week, else Monday, exactly as before. Junk or unavailable storage means 7.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const heads = (ctx) => {
  const html = ctx.document.getElementById("wpBody").innerHTML;
  return [...html.matchAll(/class="wp-dayname">([^<]*)</g)].map((m) => m[1]);
};
const html = (ctx) => ctx.document.getElementById("wpBody").innerHTML;
const pad = (n) => String(n).padStart(2, "0");
const utcMonday = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const THIS = utcMonday();
const TODAY_IDX = (new Date().getUTCDay() + 6) % 7;
const week = (w) => ({ [w]: { weekEnding: w, placements: {} } });

(async () => {
  /* 1. the dates */
  {
    const { ctx } = await boot({ plans: Object.assign(week("2026-10-19"), week("2026-10-26")) });
    await ctx.loadWeeklyPlan("2026-10-19");
    assert.strictEqual(heads(ctx).join(","), "Mon 19,Tue 20,Wed 21,Thu 22,Fri 23,Sat 24,Sun 25",
      "Week 43 reads Mon 19 … Sun 25");
    await ctx.loadWeeklyPlan("2026-10-26");
    assert.strictEqual(heads(ctx).join(","), "Mon 26,Tue 27,Wed 28,Thu 29,Fri 30,Sat 31,Sun 1",
      "Week 44 reads Mon 26 … Sun 1 — the month crossing is right without a month");
    assert.ok(/wp-locpill|wp-loctext|wp-locset/.test(html(ctx)), "the location line is still in the header");

    // the range label
    ctx.wpSetDayCount(5);
    ctx.wpSlideDays(-1); ctx.wpSlideDays(-1); ctx.wpSlideDays(-1);
    assert.ok(html(ctx).includes("Mon 26 – Fri 30"), "the ‹ range › label carries the dates");
    ctx.wpSetDayCount(1);
    assert.ok(/wp-dv-range">(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}</.test(html(ctx)), "…one day reads as just that day");
  }

  /* 2. today's column is marked — only in the week that holds today */
  {
    const NEXT = new Date(Date.parse(THIS + "T00:00:00Z") + 7 * 86400000).toISOString().slice(0, 10);
    const { ctx } = await boot({ plans: Object.assign(week(THIS), week(NEXT)) });
    await ctx.loadWeeklyPlan(THIS);
    const marked = [...html(ctx).matchAll(/wp-dayhead wp-dayhead-today"[\s\S]*?class="wp-dayname">([^<]*)</g)].map((m) => m[1]);
    const todayNum = String(Number(new Date(Date.parse(THIS + "T00:00:00Z") + TODAY_IDX * 86400000).toISOString().slice(8, 10)));
    assert.strictEqual(marked.length, 1, "exactly one column is today");
    assert.ok(marked[0].endsWith(" " + todayNum), "…and it is today's date");
    await ctx.loadWeeklyPlan(NEXT);
    assert.ok(!/wp-dayhead-today/.test(html(ctx)), "another week has no today column");
  }

  /* 3. the day count is remembered on this device */
  {
    // pick 5 → stored under one key, and nowhere in the weekly plan
    const a = await boot({ plans: week(THIS) });
    await a.ctx.loadWeeklyPlan(THIS);
    a.ctx.wpSetDayCount(5);
    assert.strictEqual(a.ctx.localStorage.getItem("wp.dayCount"), "5", "the count is saved on this device");
    assert.ok(!a.posts.some((p) => p.body && p.body.weeklyPlan && JSON.stringify(p.body.weeklyPlan).includes("dayCount")),
      "…and never sent to the weekly plan store");

    // "reload" on the same browser: the stored count is applied before the first render,
    // opening on today
    const b = await boot({ plans: week(THIS), storage: { "wp.dayCount": "5" } });
    await b.ctx.loadWeeklyPlan(THIS);
    assert.strictEqual(b.ctx.__wpState.dayCount, 5, "a reload keeps 5 days");
    assert.strictEqual(heads(b.ctx).length, 5, "…and draws 5 columns");
    assert.strictEqual(b.ctx.__wpState.dayStart, Math.min(TODAY_IDX, 7 - 5), "…opening on today (clamped to fit the week)");

    const c = await boot({ plans: week(THIS), storage: { "wp.dayCount": "3" } });
    await c.ctx.loadWeeklyPlan(THIS);
    assert.strictEqual(c.ctx.__wpState.dayCount, 3, "3 days, closed and reopened, is still 3");

    // a different browser: nothing stored → the whole week
    const d = await boot({ plans: week(THIS) });
    await d.ctx.loadWeeklyPlan(THIS);
    assert.strictEqual(d.ctx.__wpState.dayCount, 7, "a browser with nothing stored shows 7 days");

    // the page opens on the current week, so the first load is what seeds the window; stepping
    // to another week afterwards leaves it where it is, exactly as before v229
    const e = await boot({ plans: Object.assign(week(THIS), week("2026-03-16")), storage: { "wp.dayCount": "3" } });
    await e.ctx.loadWeeklyPlan(THIS);
    const start = e.ctx.__wpState.dayStart;
    await e.ctx.loadWeeklyPlan("2026-03-16");
    assert.strictEqual(e.ctx.__wpState.dayStart, start, "changing week does not move the window");
    assert.strictEqual(e.ctx.__wpState.dayCount, 3, "…or change the count");
    // and the default itself is unchanged: a week without today starts at Monday
    assert.strictEqual(e.ctx.wpDefaultDayStart(3), 0, "wpDefaultDayStart is Monday for a week without today");
  }

  /* 4. junk or unavailable storage is simply 7 */
  {
    for (const junk of ["9", "abc", "", "4", "-1"]) {
      const { ctx } = await boot({ plans: week(THIS), storage: { "wp.dayCount": junk } });
      assert.strictEqual(ctx.__wpState.dayCount, 7, "a stored " + JSON.stringify(junk) + " falls back to 7");
    }
    const { ctx } = await boot({ plans: week(THIS) });
    ctx.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    assert.strictEqual(ctx.wpReadDayCount(), 7, "storage that throws on read is 7");
    await ctx.loadWeeklyPlan(THIS);
    ctx.wpSetDayCount(3);
    assert.strictEqual(ctx.__wpState.dayCount, 3, "…and a write that throws still changes the view");
  }

  console.log("v229-dated-days-remembered-view: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
