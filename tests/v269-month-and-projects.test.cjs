// v269: a monthly focus item can BE a project. The month holds which projects are on it and
// one line of goal; steps, dates and ticks stay on the project and travel only through
// stepLink, so nothing on this page can overwrite a board. A failed project list must never
// unpick the plan.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, openPlan } = require("./lib/monthly-env.cjs");

const root = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(root, "monthly.html"), "utf8");
const STORE = fs.readFileSync(path.join(root, "netlify/functions/kpi-store.js"), "utf8");
const WEEKLY = fs.readFileSync(path.join(root, "index.html"), "utf8");
const YM = "2026-11";

const ymdOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const step = (id, extra) => Object.assign({ id, title: "Step " + id, col: "todo", done: false, del: false, due: "", week: "", day: "", slot: "", order: 1 }, extra);
const project = (id, name, steps) => ({ id, name, status: "active", archived: false, columns: [{ id: "todo", name: "To do" }, { id: "done", name: "Done", done: true }], steps });
const linked = { id: "f1", title: "Old name", rockRef: "1", notes: "keep me", done: false, projectId: "p1", goal: "Moved across" };
const legacy = { id: "f2", title: "Typed in August", rockRef: "", notes: "", done: true };
const plan = () => ({ ym: YM, focus: [Object.assign({}, linked), Object.assign({}, legacy)] });

(async () => {
  /* ---------- the store keeps the two new fields, or the link dies on the first save ---------- */
  assert.ok(/projectId: 40, goal: 400/.test(STORE), "cleanMonthlyFocus's whitelist carries projectId and goal");

  /* ---------- a save keeps everything on a linked item ---------- */
  {
    const env = await boot({ plans: { [YM]: plan() }, projects: [project("p1", "New name", [step("a")]), project("p2", "On the shelf", [])] });
    env.ctx.mpToast = () => {};
    await openPlan(env, YM);
    assert.strictEqual(env.posts.length, 0, "opening the month writes nothing");
    const html = env.body.innerHTML;
    assert.ok(html.includes("New name"), "the tile shows the project's own name");
    assert.ok(html.includes("Make it a project"), "an old typed item can become a project");
    assert.ok(html.includes("Typed in August"), "…and is still there");
    assert.ok(html.includes("On the shelf"), "a project not on the month waits on the shelf");
    await env.ctx.mpSaveSection("focus");
    const f = env.posts[0].body.monthlyPlan.focus;
    const it = f.find((x) => x.id === "f1");
    assert.strictEqual(it.projectId, "p1", "the link survives a save");
    assert.strictEqual(it.goal, "Moved across", "…so does the goal");
    assert.strictEqual(it.notes, "keep me", "…and the old notes");
    assert.strictEqual(it.rockRef, "1", "…and the Rock");
    assert.strictEqual(it.title, "New name", "a rename on the board reaches the month");
    assert.strictEqual(f.find((x) => x.id === "f2").done, true, "the old item is untouched");
  }

  /* ---------- a project list that fails to load unpicks nothing ---------- */
  {
    const env = await boot({ plans: { [YM]: plan() } });
    env.ctx.mpToast = () => {};
    await openPlan(env, YM);
    assert.ok(env.body.innerHTML.includes("didn't load"), "it says so");
    await env.ctx.mpSaveSection("focus");
    const it = env.posts[0].body.monthlyPlan.focus.find((x) => x.id === "f1");
    assert.strictEqual(it.projectId, "p1", "the link is kept");
    assert.strictEqual(it.title, "Old name", "…with the name it last knew");
  }

  /* ---------- the one thing each project needs ---------- */
  {
    const env = await boot({ plans: { [YM]: plan() }, projects: [] });
    const key = (steps) => env.ctx.mpStateOf(project("x", "X", steps)).key;
    assert.strictEqual(key([]), "steps", "no steps: needs steps");
    assert.strictEqual(key([step("a")]), "day", "a step with no day: needs a day");
    assert.strictEqual(key([step("a", { due: ymdOffset(-2) })]), "late", "a passed day: late");
    assert.strictEqual(key([step("a", { due: ymdOffset(1) })]), "ready", "a coming day: on your plan");
    assert.strictEqual(key([step("a", { due: ymdOffset(1), done: true })]), "finished", "all done: finished");
    assert.strictEqual(key([step("a", { due: ymdOffset(1), del: true })]), "steps", "a deleted step does not count");
    assert.strictEqual(key([step("a"), step("b", { due: ymdOffset(1) })]), "ready", "a dated step is the next step");
  }

  /* ---------- giving a step a day: stepLink only, and the v252 deadline rule ---------- */
  {
    const projects = [project("p1", "P", [step("a"), step("b", { due: ymdOffset(-1), week: "2026-10-26", day: "mon" })])];
    const env = await boot({ plans: { [YM]: plan() }, projects });
    env.ctx.mpToast = () => {};
    await openPlan(env, YM);
    await env.ctx.mpSetDay("p1", "a", "2026-11-18");
    await env.settle();
    const undated = env.posts.find((p) => p.body.stepLink && p.body.stepLink.stepId === "a").body.stepLink;
    assert.strictEqual(undated.week, "2026-11-16", "the week is the Monday of that week");
    assert.strictEqual(undated.day, "wed", "…and the day is right");
    assert.ok(!("due" in undated), "an undated step is not handed a deadline");
    await env.ctx.mpSetDay("p1", "b", "2026-11-18");
    await env.settle();
    const dated = env.posts.find((p) => p.body.stepLink && p.body.stepLink.stepId === "b").body.stepLink;
    assert.strictEqual(dated.due, "2026-11-18", "a dated step's date moves with it");
    assert.ok(env.posts.some((p) => p.body.weeklyCancel), "…and its calendar copy moves too");
    assert.ok(!env.posts.some((p) => p.body.project), "a whole project is never sent to change a step");
  }

  /* ---------- carrying forward keeps the link, and never doubles a project ---------- */
  {
    const nextMonth = "2026-12";
    const env = await boot({ plans: { [YM]: plan(), [nextMonth]: { ym: nextMonth, focus: [{ id: "z", title: "P", projectId: "p1" }] } }, projects: [project("p1", "P", [])] });
    env.ctx.mpToast = () => {};
    await openPlan(env, YM);
    await env.ctx.mpPushForward("focus", "f1");
    await env.settle();
    assert.strictEqual(env.plans[nextMonth].focus.length, 1, "a project already in that month is not added twice");
  }

  /* ---------- Weekly's dropdown does not offer a bare copy of a project's name ---------- */
  assert.ok(/!p\.projectId && !already\.has/.test(WEEKLY), "linked items stay out of Pull from Monthly");

  /* ---------- the panel is a real dialog, and the month remembers its place only that month ---------- */
  assert.ok(HTML.includes('document.createElement("dialog")') && HTML.includes("showModal()"), "the panel keeps keyboard focus inside it");
  assert.ok(HTML.includes("selectedMonthPickedIn"), "an old month is not reopened forever");

  console.log("v269-month-and-projects.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
