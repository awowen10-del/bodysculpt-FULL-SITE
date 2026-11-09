// v290 — done for today: tick off a big job for today, and carry it on another day.
//
// Ash: "some jobs … have so much in there, it's going to be impossible to do it all in one
// sitting; so I can't actually tick it off, BUT, for peace of mind, and to make it feel like
// I've had a successful day … I NEED to be able to tick it off."
//
// What must hold:
//   • the store keeps a sitting in its own list (worked-list) and writes NOTHING else;
//   • on the weekly page, "done for today" leaves a TICKED copy on today and moves the step
//     itself to the day picked — the step is not finished, and its checklist goes with it;
//   • the ticked copy is never saved into the week's plan, and never ticks the step;
//   • Undo puts the step back and takes the tick away;
//   • with every checklist item ticked, the panel offers to finish it instead;
//   • the daily page's Today list shows the sitting ticked, and its button sits on steps only.
//
// Dates come from the real clock, so the test means the same thing whatever day it runs.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { boot } = require("./lib/env.cjs");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const pad = (n) => String(n).padStart(2, "0");
const localYmd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const TODAY = localYmd(new Date());
const addDays = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOfYmd = (ymd) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const dayOf = (ymd) => DAYS[new Date(ymd + "T00:00:00Z").getUTCDay()];
const THIS = mondayOfYmd(TODAY);
const TOMORROW = addDays(TODAY, 1);

const step = (id, extra) => Object.assign({ id, title: "Step " + id, col: "todo", urgency: "normal", due: "",
  tags: [], notes: "", checklist: [], files: [], done: false, del: false, order: 0,
  week: "", day: "", slot: "", colBefore: "" }, extra || {});
const ck = (n, done) => Array.from({ length: n }, (_, i) => ({ id: "c" + i, text: "Item " + i, done: i < done }));
const PROJECT = () => ({
  id: "p1", name: "6 Week Challenge", status: "active", accent: "orange", archived: false,
  columns: [{ id: "todo", name: "To do", done: false }, { id: "done", name: "Done", done: true }],
  steps: [
    step("s_big", { title: "Focus day 1 — Build the six-week challenge automation", week: THIS, day: dayOf(TODAY), slot: "10-12",
      checklist: ck(31, 15) }),
    step("s_full", { title: "Everything ticked", week: THIS, day: dayOf(TODAY), slot: "1-3", checklist: ck(3, 3) }),
  ],
  canvas: [],
});
const emptyWeek = (w) => ({ weekEnding: w, projectItems: [], bufferItems: [], placements: {} });
const workedPosts = (posts) => posts.filter((p) => p.body && p.body.worked).map((p) => p.body.worked);

async function realStore() {
  const m = new Map();
  const writes = [];
  globalThis.__fakeStore = {
    async get(k, o) { const v = m.get(k); if (v === undefined) return null; return o && o.type === "json" ? JSON.parse(v) : v; },
    async set(k, v) { writes.push(k); m.set(k, v); },
    async list() { return { blobs: [], directories: [] }; },
  };
  const tmp = path.join(os.tmpdir(), "kpi-store-v290-" + process.pid + "-" + Date.now() + ".mjs");
  fs.writeFileSync(tmp, read("netlify/functions/kpi-store.js").replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => globalThis.__fakeStore;"));
  const h = (await import("file://" + tmp)).default;
  fs.unlinkSync(tmp);
  const post = async (body) => {
    const r = await h(new Request("https://x/.netlify/functions/kpi-store", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    return r.status;
  };
  const list = async () => (await (await h(new Request("https://x/.netlify/functions/kpi-store?worked=1"))).json()).items;
  return { post, list, writes };
}

(async () => {
  /* 1. THE STORE — its own list, nothing else touched, junk refused */
  {
    const s = await realStore();
    const rec = { id: "wabc", tgt: { p: "p1", s: "s_big" }, title: "Focus day 1", project: "6WC", date: TODAY, week: THIS,
      day: dayOf(TODAY), slot: "10-12", check: "15 of 31", to: TOMORROW, from: { week: THIS, day: dayOf(TODAY), slot: "10-12", due: "" }, junk: 1 };
    assert.strictEqual(await s.post({ worked: { add: rec } }), 200);
    let l = await s.list();
    assert.strictEqual(l.length, 1, "the sitting is recorded");
    assert.strictEqual(l[0].key, "step:p1:s_big", "against the step's address");
    assert.strictEqual(l[0].check, "15 of 31", "with how far the checklist had got");
    assert.ok(!("junk" in l[0]), "only the named fields are kept");
    assert.deepStrictEqual(s.writes, ["worked-list"], "recording a sitting writes the worked list and NOTHING else");
    await s.post({ worked: { add: rec } });
    assert.strictEqual((await s.list()).length, 1, "the same sitting sent twice is one sitting");
    for (const bad of [{ add: { ...rec, tgt: { p: "../x", s: "y" } } }, { add: { ...rec, title: "" } }, { add: { ...rec, day: "funday" } },
      { remove: { id: "../x" } }, {}]) {
      assert.strictEqual(await s.post({ worked: bad }), 400, "refused: " + JSON.stringify(bad).slice(0, 60));
    }
    await s.post({ worked: { remove: { id: "wabc" } } });
    assert.strictEqual((await s.list()).length, 0, "remove takes it away");
  }

  /* 2. THE WEEKLY PANEL — offers it; offers to finish when everything is ticked */
  {
    const { ctx } = await boot({ projects: [PROJECT()], plans: { [THIS]: emptyWeek(THIS) } });
    await ctx.loadWeeklyPlan(THIS);
    const big = ctx.wpProjItemById("ps-s_big");
    const html = ctx.wpWorkedHtml(big, ctx.wpStepDetail(big));
    assert.ok(/Done for today/.test(html) && html.includes(TOMORROW), "the panel offers done-for-today, carrying on tomorrow");
    assert.ok(/type="date"/.test(html), "…or a day picked");
    const full = ctx.wpProjItemById("ps-s_full");
    const h2 = ctx.wpWorkedHtml(full, ctx.wpStepDetail(full));
    assert.ok(/All done\? Tick it off/.test(h2) && !/carry on/i.test(h2), "a job with every item ticked is offered the finish instead");
  }

  /* 3. DONE FOR TODAY — ticked copy on today, the step moves, nothing finished, Undo */
  {
    const { ctx, posts, projects, settle } = await boot({ projects: [PROJECT()], plans: { [THIS]: emptyWeek(THIS) } });
    await ctx.loadWeeklyPlan(THIS);
    let undo = null;
    ctx.wpToastUndo = (msg, fn) => { undo = { msg, fn }; };
    const n0 = posts.length;
    await ctx.wpWorkedGo("ps-s_big", TOMORROW);
    await settle();
    const st = projects[0].steps.find((x) => x.id === "s_big");
    const w = workedPosts(posts.slice(n0));
    assert.strictEqual(w.length, 1, "one sitting recorded");
    const rec = w[0].add;
    assert.deepStrictEqual([rec.date, rec.day, rec.slot, rec.check, rec.to], [TODAY, dayOf(TODAY), "10-12", "15 of 31", TOMORROW],
      "today, in the block it was in, at 15 of 31, carrying on tomorrow");
    assert.strictEqual(st.done, false, "the step itself is NOT finished");
    assert.strictEqual(st.week, mondayOfYmd(TOMORROW), "the step has moved to tomorrow's week");
    assert.strictEqual(st.day, dayOf(TOMORROW), "…and day");
    assert.strictEqual(st.slot, "10-12", "…keeping its time block");
    assert.strictEqual(st.checklist.filter((c) => c.done).length, 15, "its checklist is untouched — it carries on where it stopped");
    assert.ok(undo && /Ticked for today/.test(undo.msg), "the confirmation says so, with Undo on it");

    // the ticked copy, if today is in the week on screen (it is: we loaded THIS)
    const copy = ctx.wpProjItemById("ps-wk-" + rec.id);
    assert.ok(copy && copy.source === "project-worked", "a ticked copy is on today");
    assert.ok(ctx.wpIsDone("project", copy), "…and it reads as done");
    assert.strictEqual(ctx.wpDoneTarget("project", copy), null, "…with no tick address the daily page could use on the step");
    assert.ok(/wp-worked/.test(ctx.wpChipHtml("project:" + copy.id, dayOf(TODAY), "", "10-12:" + dayOf(TODAY))), "it draws as a worked chip");
    const saved = ctx.wpPersistable("projectItems", [copy, { id: "real", title: "x" }]);
    assert.deepStrictEqual(saved.map((x) => x.id), ["real"], "a save never sends the copy into the week's plan");
    const pl = ctx.wpPersistable("placements", { ["10-12:" + dayOf(TODAY)]: ["project:" + copy.id, "buffer:b1"] });
    assert.deepStrictEqual(pl["10-12:" + dayOf(TODAY)], ["buffer:b1"], "…nor its place in the grid");

    // unticking the copy does not touch the step
    const n1 = posts.length;
    await ctx.wpToggleDoneRef("project:" + copy.id, false);
    await settle();
    assert.ok(!posts.slice(n1).some((p) => p.body && p.body.stepLink), "unticking the copy never writes to the step");
    assert.deepStrictEqual(workedPosts(posts.slice(n1)).map((x) => x.remove && x.remove.id), [rec.id], "…it only takes the sitting away");
    assert.ok(!ctx.wpProjItemById("ps-wk-" + rec.id), "…and the copy goes");
  }

  /* 4. UNDO — the step goes back, the tick comes off */
  {
    const { ctx, posts, projects, settle } = await boot({ projects: [PROJECT()], plans: { [THIS]: emptyWeek(THIS) } });
    await ctx.loadWeeklyPlan(THIS);
    let undo = null;
    ctx.wpToastUndo = (msg, fn) => { undo = { msg, fn }; };
    await ctx.wpWorkedGo("ps-s_big", addDays(TODAY, 9));
    await settle();
    const rec = workedPosts(posts).find((x) => x.add).add;
    await undo.fn();
    await settle();
    const st = projects[0].steps.find((x) => x.id === "s_big");
    assert.deepStrictEqual([st.week, st.day, st.slot], [THIS, dayOf(TODAY), "10-12"], "Undo puts the step back exactly where it was");
    assert.ok(workedPosts(posts).some((x) => x.remove && x.remove.id === rec.id), "…and takes the sitting away");
    assert.ok(!ctx.wpProjItemById("ps-wk-" + rec.id), "…so no tick is left on today");
  }

  /* 5. NOTHING FOR TODAY, THE PAST, OR A FINISHED STEP */
  {
    const { ctx, posts, settle } = await boot({ projects: [PROJECT()], plans: { [THIS]: emptyWeek(THIS) } });
    await ctx.loadWeeklyPlan(THIS);
    await ctx.wpWorkedGo("ps-s_big", TODAY);
    await ctx.wpWorkedGo("ps-s_big", addDays(TODAY, -1));
    await ctx.wpWorkedGo("ps-s_big", "");
    await settle();
    assert.strictEqual(workedPosts(posts).length, 0, "carrying on today, yesterday or nowhere does nothing");
  }

  /* 6. THE DAILY PAGE — its pieces are where they belong */
  {
    const D = read("daily.html");
    assert.ok(/data-tl="worked"/.test(D) && /tlStepOf\(j\) \? '<button type="button" class="tl-a" data-tl="worked"/.test(D),
      "the Today list's done-for-today button is on project steps only");
    assert.ok(/wkToday\(\)\.forEach\(\(r\) => jobs\.push\(wkJob\(r\)\)\)/.test(D), "today's sittings are rows on the Today list");
    assert.ok(/if \(via === "worked" && f && to\) return wkGo\(j, f, to, slot\)/.test(D), "confirming goes through wkGo");
    assert.ok(/wkPost\(\{ add: rec \}\)[\s\S]{0,300}tlCancelStep\(j, f, to, slot\)/.test(D), "the sitting is recorded BEFORE the step moves");
    assert.ok(/tlVia\(\) !== "worked" && tlMoveSlots/.test(D), "it never offers to carry on later today");
  }

  console.log("v290 done for today: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
