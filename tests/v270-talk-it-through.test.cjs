// v270: Ash talks, his cloud Claude agent proposes a month, and nothing lands until he says yes.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, openPlan } = require("./lib/monthly-env.cjs");

const root = path.join(__dirname, "..");
const FN = fs.readFileSync(path.join(root, "netlify/functions/ask-claude.js"), "utf8");
const AGENT = fs.readFileSync(path.join(root, "netlify/functions/ask-claude-agent.js"), "utf8");
const YM = "2026-11";
const ymdOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const step = (id, title, extra) => Object.assign({ id, title, col: "todo", done: false, del: false, due: "", week: "", day: "", slot: "" }, extra);
const projects = () => [{ id: "p1", name: "Website move", status: "active", archived: false, columns: [], steps: [step("a", "Get a phone number"), step("b", "Dated step", { due: ymdOffset(1) })] }];

(async () => {
  const lib = await import(path.join(root, "netlify/lib/ask-claude.js"));

  /* ---------- only the known fields of a plan survive ---------- */
  {
    const clean = lib.cleanProposal({ month: YM, summary: "s", hack: "x", projects: [
      { projectId: "p1", name: "N", goal: "G", evil: 1, steps: [{ stepId: "a", title: "T", day: "nonsense", extra: 2 }, { title: "" }] },
      { name: "" }], leftOut: ["L", 4], question: "Q" });
    assert.deepStrictEqual(clean, { month: YM, summary: "s", projects: [{ projectId: "p1", name: "N", goal: "G",
      steps: [{ stepId: "a", title: "T", day: "" }] }], leftOut: ["L"], question: "Q" });
    assert.strictEqual(lib.cleanProposal({ projects: [] }), null, "an empty plan is no plan");
    assert.strictEqual(lib.cleanProposal("x"), null);
    assert.strictEqual(lib.cleanProposal({ projects: [{ name: "N", projectId: "../bad", steps: [] }] }).projects[0].projectId, "", "a bad id is dropped");
    const text = lib.fireText({ id: "J", token: "T", month: YM, text: "hello" }, "2026-11-04");
    assert.ok(text.startsWith("JOB: J\nTOKEN: T\nMONTH: 2026-11\nTODAY: 2026-11-04\nASH SAID:\nhello"), "the fired text carries the job");
  }

  /* ---------- the door is safe by construction ---------- */
  assert.ok(FN.includes('name: "bodysculpt-ask"'), "it has its own store");
  assert.ok(!/bodysculpt-kpi/.test(FN), "and cannot reach the KPI store");
  assert.ok(!/bodysculpt-kpi/.test(AGENT), "nor can the agent's door");
  assert.ok(/timingSafeEqual/.test(AGENT) && /job\.status !== "running"/.test(AGENT), "a job answers once, with its own token");
  assert.ok(!/job\.token/.test(FN.slice(FN.indexOf("function publicJob"), FN.indexOf("export default"))), "the token is never handed back");
  assert.ok(/MAX_PER_HOUR/.test(FN), "starting jobs is capped");

  /* ---------- switched off until the keys are there ---------- */
  {
    const env = await boot({ plans: { [YM]: { ym: YM, focus: [] } }, projects: projects() });
    await openPlan(env, YM);
    assert.ok(!env.body.innerHTML.includes("Turn this into a plan"), "no box with no connection");
    const on = await boot({ plans: { [YM]: { ym: YM, focus: [] } }, projects: projects(), askClaude: true });
    await openPlan(on, YM);
    assert.ok(on.body.innerHTML.includes("Turn this into a plan"), "the box appears once it is on");
    assert.strictEqual(on.posts.length, 0, "opening the month writes nothing");
  }

  /* ---------- applying a plan ---------- */
  {
    const env = await boot({ plans: { [YM]: { ym: YM, focus: [] } }, projects: projects(), askClaude: true });
    env.ctx.mpToast = () => {};
    await openPlan(env, YM);
    const day = ymdOffset(3);
    await env.ctx.mpApplyProposal({ projects: [
      { projectId: "p1", name: "Website move", goal: "Moved across", steps: [
        { stepId: "a", title: "Get a phone number", day },
        { stepId: "b", title: "Dated step", day },
        { stepId: "", title: "A brand new step", day: "" },
        { stepId: "", title: "Past day step", day: "2020-01-01" }] }] });
    await env.settle();
    const links = env.posts.filter((p) => p.body.stepLink).map((p) => p.body.stepLink);
    const undated = links.find((l) => l.stepId === "a"), dated = links.find((l) => l.stepId === "b");
    assert.ok(undated.day && !("due" in undated), "an undated step gets a day, not a deadline");
    assert.strictEqual(dated.due, day, "a dated step's date moves");
    assert.strictEqual(env.posts.filter((p) => p.body.addStep).length, 2, "new steps are added one at a time");
    assert.strictEqual(links.filter((l) => l.stepId.startsWith("s_")).length, 0, "a blank or past day is not written");
    assert.ok(!env.posts.some((p) => p.body.project), "an existing project is never sent whole");
    const it = env.plans[YM].focus[0];
    assert.strictEqual(it.projectId, "p1", "the project lands on the month");
    assert.strictEqual(it.goal, "Moved across", "with its goal");
  }

  console.log("v270-talk-it-through.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
