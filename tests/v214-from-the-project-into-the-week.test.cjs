// v214 — from the project into the week.
//
// Ash: "Let's say I know I want to work on the Ontraport Migration. Let's say I have 5-10
// jobs inside of that, and I decide on a Sunday review I want to focus on 3 of them on
// Monday, how do I seamlessly move them from the Project to the Weekly Plan?"
//
// The answer is the v61 monthly pull, widened: a step is PULLED, not copied, and the weekly
// task keeps a link home. Two directions (a picker on the weekly page, a day-row on the
// board) and one meaning for a tick.
//
// What this test is actually protecting:
//
//  1. ONE TICK, NOT TWO. Ticking a pulled step off in the weekly plan marks the step done on
//     the board and — Ash's call — moves its card to the finished stage. The rule lives once,
//     server-side, in netlify/lib/projects.js. The thing the asking did not settle is what
//     happens on an UNTICK, and the answer has to be "back where it came from", or every
//     mis-tick strands a card in Done. `colBefore` is what remembers.
//
//  2. THE WEEKLY PAGE CANNOT OVERWRITE A BOARD. It talks to the projects store through one
//     narrow route that can only touch one step's done-state and its note of which week it
//     went to. It never sends a whole project. Asserted by reading the page, and by driving
//     the route against a seeded store.
//
//  3. THE BOARD CANNOT OVERWRITE A WEEK. Pushing a step into the week is a read-modify-write,
//     and a failed READ must never be followed by a write — that is how a whole week gets
//     replaced by one task.
//
//  4. THE TWO PAGES AGREE WHICH WEEK IT IS. index.html files a plan under the Monday that
//     starts the week, worked out in UTC, and calls it "weekEnding". If projects.html
//     disagreed by a day, tasks would land in a week nobody is looking at. Both functions are
//     lifted out and RUN here, against a year of dates.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = (f) => path.join(__dirname, "..", f);
const read = (f) => fs.readFileSync(root(f), "utf8");
const PROJECTS = read("projects.html");
const WEEKLY = read("index.html");
const scriptOf = (src) => src.slice(src.lastIndexOf("<script>") + 8, src.lastIndexOf("</script>"));
const PJS = scriptOf(PROJECTS);
const WJS = scriptOf(WEEKLY);
const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));
const PSTYLE = styleOf(PROJECTS), WSTYLE = styleOf(WEEKLY);
function bodyOf(js, name) {
  const re = new RegExp("\\n(?:async )?function " + name + "\\s*\\(", "g");
  const m = re.exec(js);
  assert.ok(m, "the page defines " + name + "()");
  let i = js.indexOf("{", m.index + m[0].length - 1), depth = 0, j = i;
  for (; j < js.length; j++) {
    if (js[j] === "{") depth++;
    else if (js[j] === "}") { depth--; if (!depth) break; }
  }
  return js.slice(i, j + 1);
}

/* the blob store, faked */
function fakeStore(seed) {
  const m = new Map(Object.entries(seed || {}));
  const wrote = [];
  return {
    _m: m, _wrote: wrote,
    async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
    async getWithMetadata(k) { const v = m.get(k); if (v === undefined) return null; return { data: v, metadata: {} }; },
    async set(k, v) { wrote.push(k); m.set(k, v); },
    async list(o) { const p = (o && o.prefix) || "";
      return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })), directories: [] }; },
  };
}
const SEED_OTHER = {
  "weekly-plan-2026-09-21": JSON.stringify({ weekEnding: "2026-09-21", projectItems: [{ id: "t1", title: "Call the landlord" }] }),
  "planning-2026-Q2": JSON.stringify({ year: 2026, quarter: "Q2", goals: [{ id: "g1", title: "The Q2 review" }] }),
  "weeks": JSON.stringify([{ weekEnding: "2026-08-31", leads: 41 }]),
};

async function loadHandler(store) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bodysculpt-v214-"));
  fs.mkdirSync(path.join(dir, "lib")); fs.mkdirSync(path.join(dir, "functions"));
  fs.writeFileSync(path.join(dir, "lib", "projects.js"),
    read("netlify/lib/projects.js").replace(/^import \{ getStore \} from "@netlify\/blobs";$/m,
      "const getStore = () => globalThis.__fakeStore;"));
  fs.writeFileSync(path.join(dir, "functions", "projects.js"), read("netlify/functions/projects.js"));
  globalThis.__fakeStore = store;
  const mod = await import("file://" + path.join(dir, "functions", "projects.js") + "?t=" + Date.now());
  return mod.default;
}
const POST = (h, body) => h(new Request("https://x/.netlify/functions/projects",
  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const GET = (h, qs) => h(new Request("https://x/.netlify/functions/projects?" + qs));

function boardProject(extra) {
  return Object.assign({
    id: "p_ghl", name: "Migrate from Ontraport to GoHighLevel", summary: "", status: "active",
    accent: "orange", startDate: "", targetDate: "",
    columns: [{ id: "todo", name: "To do", done: false }, { id: "doing", name: "Doing", done: false },
              { id: "done", name: "Done", done: true }],
    steps: [
      { id: "s_map", title: "Build the tag map", notes: "", col: "doing", urgency: "high", due: "",
        tags: [], checklist: [], files: [], done: false, week: "", day: "", slot: "", colBefore: "",
        del: false, order: 0, createdAt: "", updatedAt: "" },
      { id: "s_gone", title: "Already finished", notes: "", col: "done", urgency: "low", due: "",
        tags: [], checklist: [], files: [], done: true, week: "", day: "", slot: "", colBefore: "",
        del: false, order: 1, createdAt: "", updatedAt: "" },
    ],
    canvas: [], archived: false, createdAt: "", lastUpdated: "",
  }, extra || {});
}

(async () => {
  /* =====================================================================
     1. ONE TICK, NOT TWO — and a way back from it
     ===================================================================== */
  {
    const store = fakeStore(SEED_OTHER);
    const h = await loadHandler(store);
    await POST(h, { project: boardProject() });

    // tick it off from the weekly plan
    let r = await POST(h, { stepLink: { projectId: "p_ghl", stepId: "s_map", done: true } });
    assert.strictEqual(r.status, 200, "the weekly plan can tick a step off");
    let step = (await r.json()).step;
    assert.strictEqual(step.done, true, "the step is done");
    assert.strictEqual(step.col, "done", "…and Ash's call: the card moved itself to the finished stage");
    assert.strictEqual(step.colBefore, "doing", "…remembering it came from Doing");

    // …and untick it. This is the half the asking did not settle.
    r = await POST(h, { stepLink: { projectId: "p_ghl", stepId: "s_map", done: false } });
    step = (await r.json()).step;
    assert.strictEqual(step.done, false, "unticking unticks it");
    assert.strictEqual(step.col, "doing", "…and puts the card back in Doing, not stranded in Done");
    assert.strictEqual(step.colBefore, "", "…with nothing left to remember");

    // a card already sitting in Done, dragged there by hand, is not moved anywhere by an untick
    r = await POST(h, { stepLink: { projectId: "p_ghl", stepId: "s_gone", done: false } });
    step = (await r.json()).step;
    assert.strictEqual(step.col, "done", "a card he put in Done himself stays where he put it");

    // a board with no finished stage still ticks — it just has nowhere to move to
    await POST(h, { project: boardProject({ id: "p_flat",
      columns: [{ id: "a", name: "Open", done: false }, { id: "b", name: "Shut", done: false }],
      steps: [{ id: "s_1", title: "A job", notes: "", col: "a", urgency: "normal", due: "", tags: [],
        checklist: [], files: [], done: false, week: "", day: "", slot: "", colBefore: "", del: false, order: 0,
        createdAt: "", updatedAt: "" }] }) });
    r = await POST(h, { stepLink: { projectId: "p_flat", stepId: "s_1", done: true } });
    step = (await r.json()).step;
    assert.strictEqual(step.done, true, "a board with no Done stage still ticks the step off");
    assert.strictEqual(step.col, "a", "…and leaves the card where it is");

    /* 1b. the route is the NARROWEST thing that could work */
    const before = store._m.get("proj-p_ghl");
    // nothing else on the step, or on the project, may be reachable through it
    r = await POST(h, { stepLink: { projectId: "p_ghl", stepId: "s_map",
      title: "HACKED", del: true, name: "HACKED", steps: [], columns: [] } });
    const j = await r.json();
    assert.strictEqual(j.unchanged, true, "a stepLink carrying nothing it is allowed to change changes nothing");
    assert.strictEqual(store._m.get("proj-p_ghl"), before, "…and does not write at all — a no-op must not bump lastUpdated");
    const proj = JSON.parse(store._m.get("proj-p_ghl"));
    assert.strictEqual(proj.name, "Migrate from Ontraport to GoHighLevel", "the project's name is not reachable through this route");
    assert.strictEqual(proj.steps.length, 2, "…nor is adding or removing a step");
    assert.strictEqual(proj.steps.find((s) => s.id === "s_map").title, "Build the tag map", "…nor is a step's title");
    assert.strictEqual((await POST(h, { stepLink: { projectId: "nope", stepId: "s_map", done: true } })).status, 404,
      "a project that does not exist is a 404, not a new one");

    /* 1c. which week a step went to */
    r = await POST(h, { stepLink: { projectId: "p_ghl", stepId: "s_map", week: "2026-09-21", day: "mon" } });
    step = (await r.json()).step;
    assert.strictEqual(step.week, "2026-09-21", "the step records the week it was pulled into");
    assert.strictEqual(step.day, "mon", "…and the day");
    assert.strictEqual(step.slot, "6-9", "…and which time band, defaulted when none was named");
    r = await POST(h, { stepLink: { projectId: "p_ghl", stepId: "s_map", week: "2026-09-21", day: "mon", slot: "1-3" } });
    assert.strictEqual((await r.json()).step.slot, "1-3", "…or the one that was named");
    r = await POST(h, { stepLink: { projectId: "p_ghl", stepId: "s_map", week: "", day: "mon" } });
    step = (await r.json()).step;
    assert.strictEqual(step.week, "", "taking it out of the week clears the week");
    assert.strictEqual(step.day, "", "…and the day with it — a day with no week is not an answer");
    assert.strictEqual(step.slot, "", "…and the time band too");
    r = await POST(h, { stepLink: { projectId: "p_ghl", stepId: "s_map", week: "2026-09-21", day: "someday" } });
    assert.strictEqual((await r.json()).step.day, "", "a day that is not a day is dropped, not stored");

    /* 1d. and none of it touched anything else */
    for (const k of Object.keys(SEED_OTHER)) {
      assert.strictEqual(store._m.get(k), SEED_OTHER[k], k + " is byte-identical — the projects store still reaches nothing else");
    }
    for (const k of store._wrote) assert.ok(/^proj-/.test(k), "only project keys were written — saw " + k);
  }

  /* =====================================================================
     2. THE WEEKLY PAGE: it pulls, and it can only ever tick
     ===================================================================== */
  {
    assert.ok(/const WP_PROJECTS = "\/\.netlify\/functions\/projects";/.test(WJS),
      "the weekly page knows the projects store by one constant");
    // THE SAFETY CLAIM: every write it makes there is a stepLink. Comments stripped first —
    // this suite keeps catching itself on the note that explains the rule.
    const bare = WJS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const posts = [...bare.matchAll(/fetch\(WP_PROJECTS[\s\S]{0,400}?\)/g)].map((m) => m[0]);
    assert.ok(posts.length >= 2, "it does talk to the projects store (" + posts.length + " calls)");
    for (const call of posts) {
      if (!/method\s*:\s*"POST"/.test(call)) continue;
      assert.ok(/stepLink/.test(call), "every POST the weekly page makes to the projects store is a stepLink");
      assert.ok(!/\bproject\s*:/.test(call), "…and never carries a whole project");
    }
    assert.ok(/WP_PROJECTS \+ "\?list=1"/.test(bare), "it reads the list of projects to offer their steps");

    // the picker sits beside the monthly one, in the Projects box
    assert.ok(/wpMonthlyPickerHtml\(\) \+ wpProjectPickerHtml\(\)/.test(WJS),
      "the Projects box offers both pulls — from Monthly, and from a project");
    assert.ok(/onclick="wpProjPullOpen\(\)"/.test(WJS), "…and the new one opens the picker");

    // what a pulled task carries: the title and a link home, and nothing else
    const confirm = bodyOf(WJS, "wpProjPullConfirm");
    for (const f of ["linkId", "sourceProjectId", "sourceStepId", 'source: "project-step"']) {
      assert.ok(confirm.includes(f), "a pulled task carries " + f);
    }
    for (const f of ["notes", "checklist", "tags", "files", "due"]) {
      assert.ok(!new RegExp("\\b" + f + "\\s*:").test(confirm),
        "a pulled task does NOT carry the step's " + f + " — the week is a schedule, not a second copy");
    }
    // it arrives PLACED, which is the whole point of picking a day
    assert.ok(/wpPlan\.placements\[cellKey\]/.test(confirm), "…and lands on the grid cell that was chosen");
    assert.ok(/const cellKey = slot \+ ":" \+ day;/.test(confirm), "…keyed the way every other placement is");
    assert.ok(/await wpSaveSection\("project"\)/.test(confirm), "the week is saved");
    // the board is told afterwards, and a failure there cannot cost the week
    assert.ok(confirm.indexOf('wpSaveSection("project")') < confirm.indexOf("WP_PROJECTS"),
      "the week is saved BEFORE the board is told, so a projects store that is down cannot lose the plan");

    // no duplicates: a step already in this week cannot be pulled twice
    assert.ok(/function wpProjStepsAlready\(\)/.test(WJS), "it knows what is already in this week");
    assert.ok(/if\(already\.has\(stepId\)\) continue;/.test(confirm), "…and refuses to add one twice");
    assert.ok(/inWeek\?"checked disabled"/.test(WJS), "…and shows it as already there rather than hiding it");

    // the tick goes home, next to the monthly one, and after the week's own save
    const toggle = bodyOf(WJS, "wpToggleDoneRef");
    assert.ok(/await wpPropagateProjectDone\(item, checked\)/.test(toggle),
      "ticking a pulled step off propagates to its board");
    assert.ok(toggle.indexOf("wpSaveSection(section)") < toggle.indexOf("wpPropagateProjectDone"),
      "…after the week has saved its own tick, never instead of it");
    const prop = bodyOf(WJS, "wpPropagateProjectDone");
    assert.ok(/stepLink/.test(prop) && /catch\s*\(e\)\s*\{\s*return null;\s*\}/.test(prop),
      "…and a projects store that is down returns null rather than throwing into the tick");

    // a projects store that will not answer costs the weekly page nothing but the picker
    const load = WJS.slice(WJS.indexOf("wpProjects = { list: [], loaded: false };"));
    assert.ok(/catch\(e\)\{ wpProjects = \{ list: \[\], loaded: false \}; \}/.test(load),
      "a failed read leaves the list empty");
    assert.ok(/const any = \(wpProjects\.list\|\|\[\]\)\.some/.test(WJS),
      "…and with no projects there is no picker to click");
  }

  /* =====================================================================
     3. THE BOARD: it reads the week before it writes one
     ===================================================================== */
  {
    const setWeek = bodyOf(PJS, "setStepWeek");
    assert.ok(/await readWeek\(week\)/.test(setWeek), "it reads the week first");
    assert.ok(/catch \(e\) \{ toast\("Could not reach the weekly plan — nothing was changed\."\); return; \}/.test(setWeek),
      "A FAILED READ IS NEVER FOLLOWED BY A WRITE — that is how a whole week gets replaced by one task");
    assert.ok(setWeek.indexOf("readWeek") < setWeek.indexOf("writeWeek"), "…read, then write, in that order");
    const readW = bodyOf(PJS, "readWeek");
    assert.ok(/if \(!r\.ok\) throw new Error/.test(readW), "a non-OK read throws rather than returning an empty week");
    const writeW = bodyOf(PJS, "writeWeek");
    assert.ok(/weeklyPlan: \{ weekEnding: week, projectItems: items, placements \}/.test(writeW),
      "it sends back only the two parts of a week it touched");
    for (const f of ["timeBlocks", "notes", "foodNotes", "recurringDone", "exceptions", "reviewChecklist"]) {
      assert.ok(!writeW.includes(f), "it never sends the week's " + f);
    }
    // one task, one place
    assert.ok(/stripRef\(refOf\(it\)\)/.test(setWeek), "moving a step to another day moves it, rather than cloning it");
    assert.ok(/if \(!day\) \{/.test(setWeek), '"Not this week" takes it back out again');
    assert.ok(/toastUndo\(/.test(setWeek), "and the way back is on the confirmation, as everywhere else");
    assert.ok(/writeWeek\(week, before\.items, before\.placements\)/.test(setWeek),
      "…undo puts back exactly what was read, not a guess at it");

    // the drawer offers the days, and the card says what was chosen
    assert.ok(/<label>This week<\/label>/.test(PJS), "the step drawer has a This week row");
    assert.ok(/data-w=""' \+ \(inWeek \? "" : ' class="on"'\) \+ '>Not this week</.test(PJS),
      "…including the way out of it");
    assert.ok(/mini wk/.test(PJS) && /this week<\/span>/.test(PJS), "a card that is on the week says so");

    // ticking here means what it means there: one implementation, server-side
    const tog = bodyOf(PJS, "toggleStepDone");
    assert.ok(/stepLink: \{ projectId: p\.id, stepId: s\.id, done: want \}/.test(tog),
      "the board's own tick goes through the same route as the weekly plan's");
    assert.ok(/await flush\(\);/.test(tog) && tog.indexOf("await flush()") < tog.indexOf("stepLink"),
      "…after flushing, so a pending whole-project write cannot land afterwards and undo the move");
    assert.ok(/catch \(e\) \{[\s\S]*?pCommit\(\);/.test(tog), "…and an unreachable store still ticks it locally");
  }

  /* =====================================================================
     4. THE TWO PAGES AGREE WHICH WEEK IT IS
     Not read — RUN. index.html files a plan under the Monday that starts the week, in UTC,
     and calls it "weekEnding"; projects.html has to land on the same string or a pushed task
     goes into a week nobody is looking at.
     ===================================================================== */
  {
    // both functions, lifted out of the pages verbatim and run
    const wFn = new Function("return (function mondayOf(d)" + bodyOf(WJS, "mondayOf") + ")")();
    const pFn = new Function("return (" + "function weekKeyNow(when)" + bodyOf(PJS, "weekKeyNow") + ")")();
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const t = Date.UTC(2026, 0, 1) + i * 86400000 + (i % 24) * 3600000;   // a year, at varying hours
      const fromWeekly = wFn(new Date(t)).toISOString().slice(0, 10);
      const fromBoard = pFn(t);
      assert.strictEqual(fromBoard, fromWeekly,
        "the two pages agree on the week for " + new Date(t).toISOString() + " (board " + fromBoard + " vs weekly " + fromWeekly + ")");
      checked++;
    }
    assert.strictEqual(checked, 400, "checked a year of dates");
    // and it really is a Monday, so the agreement is not two identical mistakes
    assert.strictEqual(new Date(pFn(Date.UTC(2026, 8, 27)) + "T00:00:00Z").getUTCDay(), 1,
      "…and the week they agree on starts on a Monday");
    assert.strictEqual(pFn(Date.UTC(2026, 8, 27)), "2026-09-21", "Sunday 27 Sep 2026 belongs to the week starting Mon 21 Sep");
    assert.strictEqual(pFn(Date.UTC(2026, 8, 28)), "2026-09-28", "…and Monday 28 Sep starts the next one");
  }

  /* =====================================================================
     5. THE TIME BANDS ARE THE SAME FOUR
     A placement key is "<slot>:<day>" and a slot the weekly grid has never heard of puts a
     task in a cell that does not exist.
     ===================================================================== */
  {
    const weeklyRows = /const WP_TIME_ROWS = (\[[\s\S]*?\]);/.exec(WJS);
    assert.ok(weeklyRows, "the weekly page's time rows are readable");
    const rows = new Function("return " + weeklyRows[1])().filter((r) => r[0] !== "notes");
    const boardSlots = /const WEEK_SLOTS = (\[[\s\S]*?\]);/.exec(PJS);
    assert.ok(boardSlots, "the board's time bands are readable");
    const slots = new Function("return " + boardSlots[1])();
    assert.deepStrictEqual(slots.map((s) => s[0]), rows.map((r) => r[0]),
      "the board offers exactly the weekly grid's time bands, by the same keys");
    // …and so does the store that has to validate them
    const libSlots = /export const SLOTS = (\[[^\]]*\]);/.exec(read("netlify/lib/projects.js"));
    assert.ok(libSlots, "the store names the time bands too");
    assert.deepStrictEqual(new Function("return " + libSlots[1])(), rows.map((r) => r[0]),
      "…and the store's list is the weekly grid's list, so a stored slot always names a real cell");
    const weeklyDays = new Function("return " + /const WP_DAYS = (\[[\s\S]*?\]);/.exec(WJS)[1])();
    const boardDays = new Function("return " + /const WEEK_DAYS = (\[[\s\S]*?\]);/.exec(PJS)[1])();
    assert.deepStrictEqual(boardDays.map((d) => d[0]), weeklyDays.map((d) => d[0]),
      "…and the same seven days, in the same order");
  }

  /* =====================================================================
     6. A SCROLLING COLUMN MUST SCROLL, NOT SQUASH
     Found by looking at the step drawer on a short window: both new panels are column flex
     boxes with one scrolling child, and a column flex box shrinks its children BEFORE it
     scrolls. The step's title had been given 35px and was rendering at 14, which reads as a
     step whose name has been cut off rather than as a layout bug. It is a whole class of
     bug — it fires on any field either panel gains — so it is pinned as the rule, not the
     instance.
     ===================================================================== */
  {
    assert.ok(/\.dr-body\{[^}]*min-height:0/.test(PSTYLE), "the step drawer's body can actually scroll");
    assert.ok(/\.dr-body > \*\{flex:0 0 auto;\}/.test(PSTYLE),
      "…and its fields keep their own height instead of being squashed to fit");
    assert.ok(/\.wp-pp-body\{[^}]*min-height:0/.test(WSTYLE), "the pull panel's list can actually scroll");
    assert.ok(/\.wp-pp-body > \*\{flex:0 0 auto;\}/.test(WSTYLE),
      "…and its projects keep their own height too");
    // the step opens at its name, whatever the screen height
    assert.ok(/\$\("drBody"\)\.scrollTop = 0;/.test(PJS), "a step always opens at its title");
  }

  console.log("v214-from-the-project-into-the-week: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
