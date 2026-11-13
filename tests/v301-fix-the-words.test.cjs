// v301 — fix a task's wording where you read it.
//
// Ash: "I need to be able to edit these, right now I can't. If I make a typo or need to change
// something I have to delete it and start again. This is on the weekly view but I'm pretty
// sure it's on the daily, too."
//
// The Daily page's own edit code is RUN (recording fetch) against the REAL kpi-store route and
// the REAL projects function, so "the new name is stored where the job lives" is checked in
// the store, not in the page. The weekly page's chip code is pinned by what it must contain.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const DAILY = read("daily.html");
const WEEKLY = read("index.html");
const DJS = DAILY.slice(DAILY.lastIndexOf("<script>") + 8, DAILY.lastIndexOf("</script>"));
function bodyOf(js, name) {
  const m = new RegExp("\\n(?:async )?function " + name + "\\s*\\(").exec(js);
  assert.ok(m, "the page defines " + name + "()");
  let i = js.indexOf("{", m.index + m[0].length - 1), depth = 0, j = i;
  for (; j < js.length; j++) {
    if (js[j] === "{") depth++;
    else if (js[j] === "}") { depth--; if (!depth) break; }
  }
  return js.slice(i, j + 1);
}
const line = (re) => { const m = DJS.match(re); assert.ok(m, "the page has " + re); return m[0]; };

const WEEK = "2026-11-09", NEXT = "2026-11-16", LAST = "2026-11-02";

/* ---------- one shared blob store behind both functions ---------- */
const m = new Map();
globalThis.__fakeStore = {
  async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
  async set(k, v) { m.set(k, v); },
  async delete(k) { m.delete(k); },
  async list(o) { const p = (o && o.prefix) || ""; return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })), directories: [] }; },
};
const put = (k, v) => m.set(k, JSON.stringify(v));
const get = (k) => (m.has(k) ? JSON.parse(m.get(k)) : null);
async function handlers() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bodysculpt-v301-"));
  fs.mkdirSync(path.join(dir, "lib")); fs.mkdirSync(path.join(dir, "functions"));
  const fake = (src) => src.replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => globalThis.__fakeStore;");
  fs.writeFileSync(path.join(dir, "lib", "projects.js"), fake(read("netlify/lib/projects.js")));
  fs.writeFileSync(path.join(dir, "functions", "projects.js"), read("netlify/functions/projects.js"));
  fs.writeFileSync(path.join(dir, "functions", "kpi-store.mjs"), fake(read("netlify/functions/kpi-store.js")));
  const proj = (await import("file://" + path.join(dir, "functions", "projects.js"))).default;
  const kpi = (await import("file://" + path.join(dir, "functions", "kpi-store.mjs"))).default;
  return async (url, body) => {
    const h = /projects/.test(url) ? proj : kpi;
    const r = await h(new Request("https://x" + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    return { status: r.status, json: r.status === 200 ? await r.json() : null };
  };
}

/* ---------- the Daily page's edit, in a sandbox ---------- */
function daily(call) {
  const sent = [];
  let renders = 0, after = 0;
  const fetch = async (url, o) => {
    const body = JSON.parse(o.body);
    sent.push({ url, body });
    const r = await call(url, body);
    return { ok: r.status === 200, status: r.status, json: async () => r.json };
  };
  const src = [
    "let tlEdit = null, wpAgenda = null, wpAgendaToday = null, calWeekOffset = 0;",
    line(/\nconst API = [^\n]*/), line(/\nconst PROJECTS = [^\n]*/),
    "const agendaWeekOf = () => '" + WEEK + "';",
    line(/\nconst tlStepOf = [^\n]*/),
    "function tlCanEdit(j)" + bodyOf(DJS, "tlCanEdit"),
    "async function tlRenamePost(tgt, title)" + bodyOf(DJS, "tlRenamePost"),
    "async function tlStepTitle(f, title)" + bodyOf(DJS, "tlStepTitle"),
    "async function tlEditGo(j)" + bodyOf(DJS, "tlEditGo"),
    "return { tlCanEdit, tlEditGo, set: (e) => { tlEdit = e; }, get: () => tlEdit, agenda: () => wpAgendaToday };",
  ].join("\n");
  const api = new Function("fetch", "renderTodayList", "fmAfterChange", src)(fetch, () => { renders++; }, () => { after++; });
  return { api, sent, counts: () => ({ renders, after }) };
}

const step = (id, title) => ({ id, title, col: "todo", urgency: "normal", due: "", tags: ["money"], notes: "kept notes",
  checklist: [], files: [], done: false, del: false, order: 0, week: WEEK, day: "sat", slot: "10-12", colBefore: "" });
const row = (title, kind, tgt) => ({ title, kind, done: false, tgt });

(async () => {
  const call = await handlers();
  put("proj-pM", { id: "pM", name: "Money straight", status: "active", archived: false,
    columns: [{ id: "todo", name: "To do", done: false }, { id: "done", name: "Done", done: true }],
    steps: [step("sDebts", "List all detbs with interest rates"), step("sOrder", "Agree payoff order")], canvas: [] });
  put("weekly-recurring-defaults", [{ id: "fin", title: "Weekly Finance Blokc", days: ["sat"], time: "10-12" }, { id: "lg", title: "Lead Generation", days: ["mon"], time: "6-9" }]);
  put("weekly-training-defaults", [{ id: "run", title: "Rnu", days: ["sat"], time: "6-9" }]);
  put("weekly-plan-" + WEEK, { weekEnding: WEEK, lastUpdated: "2026-11-13T10:00:00.000Z", projectItems: [],
    bufferItems: [{ id: "b1", title: "BF Offer Paeg", done: false }, { id: "b2", title: "Go over the emails once more", done: true }],
    placements: { "6-9:sat": ["buffer:b1", "buffer:b2"] }, recurringDone: {}, trainingDone: {}, notes: "kept" });
  const cells = () => ({ "6-9:sat": [row("Rnu", "training", { m: "trainingDone", k: "run" }), row("BF Offer Paeg", "buffer", { l: "bufferItems", k: "b1" })],
    "10-12:sat": [row("Weekly Finance Blokc", "recurring", { m: "recurringDone", k: "fin" })] });
  put("weekly-agenda-" + WEEK, { weekEnding: WEEK, cells: cells() });
  put("weekly-agenda-" + NEXT, { weekEnding: NEXT, cells: cells() });
  put("weekly-agenda-" + LAST, { weekEnding: LAST, cells: cells() });
  const titlesIn = (k) => Object.values(get(k).cells).flat().map((r) => r.title).sort();

  /* 1. THE STORE: a one-off task's name, in this week's list and nowhere else */
  {
    let r = await call("/kpi", { weeklyRename: { weekEnding: WEEK, tgt: { l: "bufferItems", k: "b1" }, title: "  BF Offer   Page " } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.title, "BF Offer Page", "the name is tidied: no stray spaces");
    const plan = get("weekly-plan-" + WEEK);
    assert.strictEqual(plan.bufferItems[0].title, "BF Offer Page", "the one-off is renamed in its week's list");
    assert.deepStrictEqual([plan.bufferItems[0].id, plan.bufferItems[0].done], ["b1", false], "…same task, same tick");
    assert.deepStrictEqual(plan.bufferItems[1], { id: "b2", title: "Go over the emails once more", done: true }, "…and the task next to it is untouched");
    assert.deepStrictEqual(plan.placements, { "6-9:sat": ["buffer:b1", "buffer:b2"] }, "it stays exactly where it sat");
    assert.strictEqual(plan.notes, "kept", "nothing else on the plan moves");
    assert.notStrictEqual(plan.lastUpdated, "2026-11-13T10:00:00.000Z", "the plan says it changed, so an open weekly page reloads instead of overwriting");
    assert.ok(titlesIn("weekly-agenda-" + WEEK).includes("BF Offer Page"), "the calendar copy says the same");
    assert.ok(r.json.agenda && r.json.agenda.weekEnding === WEEK, "…and it is handed back, so the page shows it at once");
    assert.ok(titlesIn("weekly-agenda-" + NEXT).includes("BF Offer Paeg"), "a one-off belongs to its week: next week's copy is not touched");

    // refusals: nothing is created, nothing is blanked
    r = await call("/kpi", { weeklyRename: { weekEnding: WEEK, tgt: { l: "bufferItems", k: "b1" }, title: "   " } });
    assert.strictEqual(r.status, 400, "a blank name is refused");
    assert.strictEqual(get("weekly-plan-" + WEEK).bufferItems[0].title, "BF Offer Page", "…and the task keeps its name");
    assert.strictEqual((await call("/kpi", { weeklyRename: { weekEnding: WEEK, tgt: { l: "bufferItems", k: "nope" }, title: "x" } })).status, 404, "a task that is not there is a 404");
    assert.strictEqual((await call("/kpi", { weeklyRename: { weekEnding: "2031-01-06", tgt: { l: "bufferItems", k: "b1" }, title: "x" } })).status, 404, "a week with no plan is not brought into being");
    assert.strictEqual(get("weekly-plan-2031-01-06"), null);
    assert.strictEqual((await call("/kpi", { weeklyRename: { weekEnding: WEEK, tgt: { p: "pM", s: "sDebts" }, title: "x" } })).status, 400, "a project step is not renamed through the plan route");
    assert.strictEqual((await call("/kpi", { weeklyRename: { weekEnding: WEEK, tgt: { l: "settings", k: "b1" }, title: "x" } })).status, 400, "only the two task lists can be reached");
    const long = await call("/kpi", { weeklyRename: { weekEnding: WEEK, tgt: { l: "bufferItems", k: "b2" }, title: "a".repeat(500) } });
    assert.strictEqual(long.json.title.length, 200, "a name is capped at 200 characters");
  }

  /* 2. THE STORE: a recurring / training job's name, on its list — so every week reads the same */
  {
    let r = await call("/kpi", { weeklyRename: { weekEnding: WEEK, tgt: { m: "recurringDone", k: "fin:sat" }, title: "Weekly Finance Block" } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(get("weekly-recurring-defaults"), [{ id: "fin", title: "Weekly Finance Block", days: ["sat"], time: "10-12" }, { id: "lg", title: "Lead Generation", days: ["mon"], time: "6-9" }],
      "the recurring job is renamed on its list; its days, time and the other jobs are untouched");
    assert.ok(titlesIn("weekly-agenda-" + WEEK).includes("Weekly Finance Block") && titlesIn("weekly-agenda-" + NEXT).includes("Weekly Finance Block"),
      "this week's and next week's calendar copies both follow");
    assert.ok(titlesIn("weekly-agenda-" + LAST).includes("Weekly Finance Blokc"), "a week already gone is left as it was written");
    r = await call("/kpi", { weeklyRename: { weekEnding: WEEK, tgt: { m: "trainingDone", k: "run" }, title: "Run" } });
    assert.strictEqual(get("weekly-training-defaults")[0].title, "Run", "a training job the same way, on the training list");
    assert.strictEqual(get("weekly-recurring-defaults").length, 2, "…and the recurring list is not its business");
    assert.strictEqual((await call("/kpi", { weeklyRename: { weekEnding: WEEK, tgt: { m: "recurringDone", k: "gone" }, title: "x" } })).status, 404);
  }

  /* 3. THE BOARD: a project step's title through stepLink, and nothing else about it */
  {
    let r = await call("/projects", { stepLink: { projectId: "pM", stepId: "sDebts", title: " List all debts with   interest rates " } });
    assert.strictEqual(r.json.step.title, "List all debts with interest rates", "the step is renamed on its board");
    const s = get("proj-pM").steps.find((x) => x.id === "sDebts");
    assert.deepStrictEqual([s.notes, s.tags, s.col, s.week, s.day, s.slot, s.done], ["kept notes", ["money"], "todo", WEEK, "sat", "10-12", false],
      "its notes, tags, stage, day and tick are untouched");
    assert.strictEqual(get("proj-pM").steps.find((x) => x.id === "sOrder").title, "Agree payoff order", "…and so is the step next to it");
    const before = m.get("proj-pM");
    r = await call("/projects", { stepLink: { projectId: "pM", stepId: "sDebts", title: "   " } });
    assert.strictEqual(r.json.unchanged, true, "a blank title changes nothing");
    r = await call("/projects", { stepLink: { projectId: "pM", stepId: "sDebts", title: "List all debts with interest rates" } });
    assert.strictEqual(r.json.unchanged, true, "the same title again changes nothing");
    assert.strictEqual(m.get("proj-pM"), before, "…and neither writes at all");
  }

  /* 4. THE DAILY PAGE: edit → Save, run for real against both stores */
  {
    const d = daily(call);
    const planJob = { key: "plan:bufferItems:b1", title: "BF Offer Page", source: "plan", kind: "buffer", tgt: { l: "bufferItems", k: "b1" }, row: {} };
    const recJob = { key: "plan:recurringDone:fin:sat", title: "Weekly Finance Block", source: "plan", kind: "recurring", tgt: { m: "recurringDone", k: "fin:sat" }, row: {} };
    const proj = get("proj-pM");
    const stepJob = { key: "step:pM:sOrder", title: "Agree payoff order", source: "plan", kind: "project", tgt: { p: "pM", s: "sOrder" },
      step: { project: proj, step: proj.steps.find((x) => x.id === "sOrder") } };
    assert.ok(d.api.tlCanEdit(planJob) && d.api.tlCanEdit(recJob) && d.api.tlCanEdit(stepJob), "a planner task, a recurring job and a project step can all be edited");
    assert.ok(!d.api.tlCanEdit({ source: "one", title: "x" }) && !d.api.tlCanEdit({ source: "back", title: "x" }) && !d.api.tlCanEdit({ source: "worked", title: "x", step: {} }),
      "your one thing has its own box; a waiting or worked-on row is a record, not a job to rename");
    assert.ok(!d.api.tlCanEdit({ source: "plan", title: "x", tgt: null }), "a row with no address cannot be edited");

    d.api.set({ key: planJob.key, value: "  Black Friday offer page " });
    await d.api.tlEditGo(planJob);
    assert.deepStrictEqual(d.sent[0], { url: "/.netlify/functions/kpi-store", body: { weeklyRename: { weekEnding: WEEK, tgt: { l: "bufferItems", k: "b1" }, title: "Black Friday offer page" } } },
      "a planner task sends one weeklyRename: the week, the address, the new name");
    assert.strictEqual(get("weekly-plan-" + WEEK).bufferItems[0].title, "Black Friday offer page", "…and the plan has it");
    assert.strictEqual(d.api.get(), null, "the box closes");
    assert.ok(Object.values(d.api.agenda().cells).flat().some((r) => r.title === "Black Friday offer page"), "the page's calendar copy is the fresh one");

    d.api.set({ key: stepJob.key, value: "Agree payoff order: highest interest first" });
    await d.api.tlEditGo(stepJob);
    assert.deepStrictEqual(d.sent[1], { url: "/.netlify/functions/projects", body: { stepLink: { projectId: "pM", stepId: "sOrder", title: "Agree payoff order: highest interest first" } } },
      "a project step sends one stepLink carrying only the title");
    assert.strictEqual(get("proj-pM").steps.find((x) => x.id === "sOrder").title, "Agree payoff order: highest interest first", "…and the board has it");
    assert.strictEqual(stepJob.step.step.title, "Agree payoff order: highest interest first", "…and so does the copy this page reads");

    // nothing to say sends nothing
    const n = d.sent.length;
    d.api.set({ key: recJob.key, value: "Weekly Finance Block" });
    await d.api.tlEditGo(recJob);
    assert.strictEqual(d.sent.length, n, "the same words send nothing");
    assert.strictEqual(d.api.get(), null);
    d.api.set({ key: recJob.key, value: "   " });
    await d.api.tlEditGo(recJob);
    assert.strictEqual(d.sent.length, n, "an empty box sends nothing");
    assert.ok(d.api.get() && /name/.test(d.api.get().error), "…it says to give it a name, and stays open");

    // a save that fails keeps the box open with the words still in it
    const bad = daily(async () => ({ status: 500, json: null }));
    bad.api.set({ key: recJob.key, value: "Weekly money hour" });
    await bad.api.tlEditGo(recJob);
    const e = bad.api.get();
    assert.ok(e && e.value === "Weekly money hour" && /did not save/.test(e.error) && !e.busy, "a failed save says so, keeps the words, and can be tried again");
    assert.strictEqual(bad.counts().after, 0, "…and the page does not pretend it changed");
  }

  /* 5. THE DAILY PAGE: what is on screen */
  {
    assert.ok(/class="tl-t tl-t-ed" data-tl="edit" role="button" tabindex="0" title="Click to change the wording">/.test(DJS), "a job's words are the way in: click them to edit");
    assert.ok(/\(!isParked && tlCanEdit\(j\)\s*\? '<span class="tl-t tl-t-ed"/.test(DJS), "…only where it can be edited");
    assert.ok(!/data-tl="edit"[^>]*>edit<\/button>/.test(DJS), "…and there is no extra button squeezing the title");
    assert.ok(/data-tl-edit aria-label="Job wording" value="' \+ esc\(tlEdit\.value\)/.test(DJS), "edit turns the words into a box, holding what was typed, escaped");
    assert.ok(/data-tl="ed-save">Save<\/button>/.test(DJS) && /data-tl="ed-x">Cancel<\/button>/.test(DJS), "with Save and Cancel beside it");
    assert.ok(/if \(e\.key === "Enter"\) \{ e\.preventDefault\(\); const j = tlFind\(tlEdit\.key\); if \(j\) tlEditGo\(j\); \}/.test(DJS), "Enter saves");
    assert.ok(/else if \(e\.key === "Escape"\) \{ e\.preventDefault\(\); tlEdit = null; renderTodayList\(\); \}/.test(DJS), "Escape leaves it as it was");
    assert.ok(/"tlEdit" in e\.target\.dataset\) tlEdit\.value = e\.target\.value;/.test(DJS), "what is typed survives a redraw");
  }

  /* 6. THE WEEKLY PAGE: the pencil on a chip */
  {
    const chip = WEEKLY.slice(WEEKLY.indexOf("function wpChipHtml("), WEEKLY.indexOf("/* ===== v70: RICH NOTES"));
    assert.ok(/class="wp-chip-edit" title="Change the wording"/.test(chip) && /onclick="wpChipEdit\(event,'\$\{ref\}'\)"/.test(chip), "every placed chip has a pencil");
    assert.ok(/\$\{linkOut\}\$\{editOut\}\$\{delOut\}<\/label>/.test(chip), "…sitting just before the ✕");
    assert.ok(/<symbol id="ic-pencil"/.test(WEEKLY), "the pencil is in the icon sheet");
    const edit = "function wpChipEdit(ev, ref)" + bodyOf(WEEKLY, "wpChipEdit");
    assert.ok(/chip\.draggable = false;/.test(edit), "the chip stops being draggable while its words are a box");
    assert.ok(/if\(e\.key === "Enter"\)\{ e\.preventDefault\(\); finish\(true\); \}/.test(edit) && /inp\.onblur = \(\)=>finish\(true\);/.test(edit), "Enter or clicking away saves");
    assert.ok(/else if\(e\.key === "Escape"\)\{ e\.preventDefault\(\); finish\(false\); \}/.test(edit), "Escape puts the old words back");
    assert.ok(/if\(save && next && next !== String\(item\.title\|\|""\)\)\{ wpChipRename\(ref, next\); return; \}/.test(edit), "an empty box, or the same words, changes nothing");

    // wpChipRename, run: each kind of task is saved where it lives
    const run = async (ref, item, opts) => {
      const calls = [];
      const o = opts || {};
      const fn = new Function("wpPlan", "wpSyncFromDom", "wpResolveRef", "wpStepFor", "wpStepsSync", "renderWeeklyPlan", "wpStepLink",
        "wpSaveTraining", "wpSaveDefaults", "wpSaveSection", "wpToast",
        bodyOf(WEEKLY, "wpCleanTitle").replace(/^\{/, "function wpCleanTitle(v){") + "\nreturn async function(ref, next)" + bodyOf(WEEKLY, "wpChipRename"));
      await fn({}, () => calls.push("sync"), () => item, () => o.f || null, () => calls.push("steps"), () => calls.push("render:" + (o.f ? o.f.step.title : item.title)),
        async (p, s, patch) => { calls.push("link:" + p + ":" + s + ":" + JSON.stringify(patch)); if (o.fail) throw new Error("no"); },
        async () => calls.push("saveTraining"), async () => calls.push("saveDefaults"), async (k) => calls.push("section:" + k), (t) => calls.push("toast"))(ref, o.next || " New   words ");
      return calls;
    };
    let it = { id: "b1", title: "Old" };
    assert.deepStrictEqual(await run("buffer:b1", it), ["sync", "render:New words", "section:buffer"], "a Buffer one-off: on screen, then the Buffer save");
    assert.strictEqual(it.title, "New words");
    it = { id: "p1", title: "Old" };
    assert.deepStrictEqual(await run("project:p1", it), ["sync", "render:New words", "section:project"], "a Project one-off: the Project save");
    it = { id: "r1", title: "Old" };
    assert.deepStrictEqual(await run("recurring:r1", it), ["sync", "render:New words", "saveDefaults"], "a recurring task: the recurring list");
    it = { id: "t1", title: "Old" };
    assert.deepStrictEqual(await run("training:t1", it), ["sync", "render:New words", "saveTraining"], "a training task: the training list");
    it = { id: "ps-s1", title: "Old", derived: true };
    let f = { project: { id: "pM" }, step: { id: "s1", title: "Old" } };
    assert.deepStrictEqual(await run("project:ps-s1", it, { f }), ["sync", "steps", "render:New words", 'link:pM:s1:{"title":"New words"}'],
      "a project step: on screen, then the board — and never into the week's own save");
    f = { project: { id: "pM" }, step: { id: "s1", title: "Old" } };
    const failed = await run("project:ps-s1", it, { f, fail: true });
    assert.deepStrictEqual(failed.slice(-3), ["steps", "render:Old", "toast"], "if the board refuses it, the old words come back and it says so");
    assert.strictEqual(f.step.title, "Old");
    it = { id: "b1", title: "Same" };
    assert.deepStrictEqual(await run("buffer:b1", it, { next: " Same " }), ["sync", "render:Same"], "the same words save nothing");
  }

  // the new styles use the theme's tokens only
  for (const [page, from, to] of [[WEEKLY, "/* v301: the pencil on a placed chip", ".wp-chip-in:focus{outline:none;}"], [DAILY, "/* v301: a job's words", ".tl-more{padding"]]) {
    const css = page.slice(page.indexOf(from), page.indexOf(to));
    assert.ok(css.length > 100 && !/#[0-9a-fA-F]{3,6}\b|rgba\(\d/.test(css), "tokens only");
  }
  console.log("v301 fix the words: OK");
})().catch((e) => { console.error(e); process.exit(1); });
