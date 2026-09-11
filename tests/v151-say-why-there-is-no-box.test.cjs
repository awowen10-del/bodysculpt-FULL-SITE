// v149 — the grid shows up on the daily page, without a second copy of the grid engine.
//
// Ash: "Can we have it, so what's displayed on the weekly calendar (and what's moved around)
// also shows on the Google Calendar on the daily dashboard?"
//
// The obvious way would have been to teach daily.html how placements work. It would have
// needed the schedule engine, cadence, this week's move/skip exceptions and within-cell
// order — several hundred lines of the most intricate code in the suite, kept in step with
// index.html's copy by hand. This repo already has one duplicated engine (the v93 rich-notes
// sanitiser) and it survives only because a parity test runs both halves over the same
// inputs. A second one would not have been worth it.
//
// So: NOTHING IS DUPLICATED. renderWeeklyPlan has already worked the whole grid out by the
// time it draws it, and wpPublishAgenda writes down what it decided — cell key to titles.
// daily.html reads that and does no thinking at all. This file's job is to keep it that way.
//
// The other thing it guards is that a display cache cannot hurt the plan. `weekly-agenda-*`
// is derived from data that already exists, it is written only when it has changed, and a
// failed write is swallowed — a daily dashboard missing today's tasks must never be allowed
// to interrupt planning the week.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const WEEKLY = read("index.html");
const DAILY = read("daily.html");
const STORE_SRC = path.join(__dirname, "..", "netlify", "functions", "kpi-store.js");
const wjs = WEEKLY.slice(WEEKLY.indexOf("<script>", WEEKLY.indexOf("</style>")) + 8, WEEKLY.lastIndexOf("</script>"));
const djs = DAILY.slice(DAILY.lastIndexOf("<script>") + 8, DAILY.lastIndexOf("</script>"));
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function fakeStore(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    _m: m,
    async get(k, o) { const v = m.get(k); if (v === undefined) return null;
      return (o && o.type === "json") ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, v); },
    async list(o) { const p = (o && o.prefix) || "";
      return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })), directories: [] }; },
  };
}
async function loadHandler() {
  const src = fs.readFileSync(STORE_SRC, "utf8");
  const patched = src.replace(/^import \{ getStore \} from "@netlify\/blobs";$/m,
    "const getStore = () => globalThis.__fakeStore;");
  const tmp = path.join(os.tmpdir(), "kpi-store-v149-" + process.pid + ".mjs");
  fs.writeFileSync(tmp, patched);
  const mod = await import("file://" + tmp);
  fs.unlinkSync(tmp);
  return mod.default;
}
const GET = (h, qs) => h(new Request("https://x/.netlify/functions/kpi-store?" + qs));
const POST = (h, body) => h(new Request("https://x/.netlify/functions/kpi-store",
  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

(async () => {
  /* ================= 0. the stamp ================= */
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(read("monthly.html"));
  // relaxed once v152 shipped: the newest release's test pins the exact stamp.
  assert.ok(Number(stamp[1]) >= 151, "monthly.html is stamped v151 or later");
  const text = "build v" + stamp[1] + " · " + stamp[2];
  for (const f of ["index.html", "finances.html", "daily.html", "social.html"]) {
    assert.ok(read(f).includes(text), f + " carries the same stamp");
  }

  /* ============ 1. THERE IS STILL ONLY ONE GRID ENGINE ============
     If daily.html ever learns any of this, the two copies will drift and the daily page will
     start quietly disagreeing with the plan — which is worse than showing nothing. */
  const ENGINE = [
    "wpEffectivePlacements", "wpScheduledPlacements", "wpExceptionsMap", "wpNormException",
    "wpCadenceCells", "wpCadenceOf", "wpOrderCellRefs", "wpCellOrderMap", "wpResolveRef",
    "wpIsScheduledRef", "wpRecurDays", "placements", "cellOrder", "exceptions",
  ];
  const dailyCode = stripComments(djs);
  for (const name of ENGINE) {
    assert.ok(!dailyCode.includes(name),
      "daily.html must not know what " + name + " is — it reads the answer, it does not work it out");
  }
  // …and the weekly page still owns all of it
  for (const name of ["wpEffectivePlacements", "wpScheduledPlacements", "wpResolveRef"]) {
    assert.ok(wjs.includes("function " + name), "index.html still defines " + name);
  }
  // the publish is a straight transcription of what the grid was ALREADY given
  assert.ok(/const gridPlacements = wpEffectivePlacements\(\);\s*\n[\s\S]{0,160}?wpPublishAgenda\(gridPlacements\);/.test(wjs),
    "the agenda is published from the very placements the grid draws — not recomputed");

  /* ============ 2. a display cache cannot hurt the plan ============ */
  const pub = wjs.slice(wjs.lastIndexOf("/*", wjs.indexOf("PUBLISHING THE GRID")), wjs.indexOf("function renderWeeklyPlan"));
  const pubCode = stripComments(pub);
  assert.ok(/method: "POST"/.test(pubCode), "it does write — otherwise this proves nothing");
  assert.ok(/body: payload/.test(pubCode) && /weeklyAgenda: \{ weekEnding, cells \}/.test(pubCode),
    "…and the only thing it ever posts is { weeklyAgenda: { weekEnding, cells } }");
  assert.ok(!/weeklyplan|weeklyPlan|recurringDefaults|trainingDefaults|checkin|settings/.test(pubCode),
    "it names no other store payload — it cannot write a plan, a default or a check-in");
  assert.ok(/if \(payload === wpAgendaLast\) return;/.test(pubCode),
    "an unchanged grid writes nothing, so idle renders and week-flicking cost no requests");
  assert.ok(/\.catch\(\(\) => \{ wpAgendaLast = ""; \}\)/.test(pubCode),
    "a failed write is swallowed and retried on the next render");
  assert.ok(/catch \(e\) \{ \/\* never let the cache disturb the plan \*\/ \}/.test(pub),
    "…and nothing it can throw reaches the render");

  /* ============ 3. the store route ============ */
  const SEED = {
    "weekly-plan-2026-09-14": JSON.stringify({ weekEnding: "2026-09-14", placements: { "6-9:mon": ["project:p1"] } }),
    "weekly-recurring-defaults": JSON.stringify([{ id: "r1", title: "Team huddle", days: ["mon"] }]),
    "planning-2026-Q3": JSON.stringify({ year: 2026, quarter: "Q3", goals: [{ id: "g1" }] }),
    "weeks": JSON.stringify([{ weekEnding: "2026-09-05", leads: 40 }]),
  };
  const store = fakeStore(SEED);
  globalThis.__fakeStore = store;
  const h = await loadHandler();

  let r = await GET(h, "weeklyagenda=2026-09-14");
  assert.deepStrictEqual(await r.json(), { agenda: null }, "a week never published reads back as null, not an error");

  r = await POST(h, { weeklyAgenda: {
    weekEnding: "2026-09-14",
    cells: {
      "6-9:mon": [{ title: "Team huddle", kind: "recurring", done: true },
                  { title: "Weekly scorecard", kind: "project", done: false }],
      "1-3:thu": [{ title: "  Content shoot  ", kind: "buffer" }],
      // the ones that must not survive
      "nonsense": [{ title: "Bad key" }],
      "6-9:mon:extra": [{ title: "Also bad" }],
      "5-8:fri": [{ title: "", kind: "project" }, "not an object", { kind: "project" }],
      "10-12:tue": Array.from({ length: 40 }, (_, i) => ({ title: "t" + i, kind: "project" })),
      "6-9:sat": [{ title: "Odd kind", kind: "SOMETHING_ELSE" }],
    },
  } });
  assert.strictEqual(r.status, 200, "a good agenda is accepted");
  const wrote = await r.json();
  assert.strictEqual(wrote.cells, 4, "four cells survived: two good, one capped, one coerced");

  r = await GET(h, "weeklyagenda=2026-09-14");
  const ag = (await r.json()).agenda;
  assert.deepStrictEqual(Object.keys(ag.cells).sort(), ["1-3:thu", "10-12:tue", "6-9:mon", "6-9:sat"],
    "a cell key must be <slot>:<day> and nothing else");
  assert.strictEqual(ag.cells["1-3:thu"][0].title, "Content shoot", "titles are trimmed");
  assert.strictEqual(ag.cells["6-9:mon"][0].done, true, "done state rides along");
  assert.strictEqual(ag.cells["6-9:mon"][1].done, false, "…and so does not-done");
  assert.strictEqual(ag.cells["10-12:tue"].length, 12, "a silly number of tasks is capped, not rejected");
  assert.strictEqual(ag.cells["6-9:sat"][0].kind, "project", "an unknown kind falls back rather than getting in");
  assert.ok(ag.updatedAt, "the server stamps when it arrived");

  r = await POST(h, { weeklyAgenda: { cells: {} } });
  assert.strictEqual(r.status, 400, "an agenda with no week has nowhere to live");
  r = await GET(h, "weeklyagenda=nonsense");
  assert.strictEqual(r.status, 400, "…and a nonsense week is refused rather than guessed at");

  // AND IT TOUCHED NOTHING ELSE — rule 5, checked rather than assumed
  for (const [k, v] of Object.entries(SEED)) {
    assert.strictEqual(store._m.get(k), v, k + " came back byte-identical after the agenda writes");
  }
  assert.ok([...store._m.keys()].filter((k) => !(k in SEED)).every((k) => k.startsWith("weekly-agenda-")),
    "…and the only new key is the agenda's own");
  delete globalThis.__fakeStore;

  /* ============ 4. a task reads as a task, not as an appointment ============ */
  // A job you have given yourself the afternoon for must not pretend to start at 14:00.
  const bands = /const WP_BANDS = \[([\s\S]*?)\];/.exec(djs);
  assert.ok(bands, "daily.html knows the bands' labels and start hours");
  const parsed = [...bands[1].matchAll(/\["([0-9-]+)",\s*"([^"]+)",\s*(\d+)\]/g)].map((m) => [m[1], m[2], Number(m[3])]);
  assert.deepStrictEqual(parsed.map((b) => b[0]), ["6-9", "10-12", "1-3", "5-8"], "all four bands");
  assert.deepStrictEqual(parsed.map((b) => b[2]), [6, 9, 12, 17], "…each with the hour it starts, for ordering");
  assert.ok(/<span class="ct-t">' \+ esc\(row\.bandLabel\)/.test(djs),
    "a task shows its BAND where an appointment shows a clock time");
  assert.ok(/sortAt: t\.hour/.test(djs) && /\.sort\(\(a, b\) => a\.sortAt - b\.sortAt\)/.test(djs),
    "…and the two are interleaved by when they start");
  assert.ok(/\.ct-item\.ct-task\{border-left-color:var\(--teal\)/.test(DAILY),
    "a task is a different colour from an appointment");
  assert.ok(/href="\/index\.html"/.test(djs), "…and clicking it goes to the plan, not to Google");
  // the day is both things, so the count is both things
  assert.ok(/todayTasks\.filter\(\(t\) => !t\.done\)\.length/.test(djs),
    "'still to come' counts unfinished tasks as well as coming appointments");
  assert.ok(/planned, " \+ mine\.length \+ " booked/.test(djs), "…and says which is which");
  // a week whose plan was never opened says so rather than looking empty
  assert.ok(/no tasks yet — <a href="\/index\.html">open the weekly plan<\/a>/.test(djs),
    "an unpublished week says so, instead of implying there is nothing planned");

  /* ============ 5. v150: TICKING FROM EITHER PAGE ============
     Ash: "Can I not have the ability to tick them off on the Daily Calendar, just like I can
     the weekly? And the two sync so if I tick off on the daily it ticks off on the weekly
     and vice versa."

     Where a tick LIVES differs by task type — a project task carries `done` on the item, a
     recurring one is a key in recurringDone, and that key gains the day only when the task
     runs on more than one. That rule stays in index.html beside wpSetDone. The agenda
     carries the resolved ADDRESS, the daily page posts a boolean to it, and the store writes
     to the address it is handed. Nobody but index.html knows the rule. */
  assert.ok(/function wpDoneTarget\(source, item, day\)/.test(wjs), "the weekly page resolves each tick's address");
  assert.ok(/wpMultiDay\(item\) && day \? item\.id \+ ":" \+ day : String\(item\.id\)/.test(wjs),
    "…including the rule that only a multi-day task's key carries the day");
  assert.ok(/tgt: wpDoneTarget\(source, it, day\)/.test(wjs), "…and it rides along with the row");
  // the daily page still knows nothing
  for (const name of ["wpSetDone", "wpIsDone", "recurringDone", "trainingDone", "projectItems", "bufferItems"]) {
    assert.ok(!dailyCode.includes(name),
      "daily.html must not know about " + name + " — it posts to an address, it does not know the rules");
  }

  // the store applies it, and refuses anything that is not one of the two shapes
  const store2 = fakeStore({
    "weekly-plan-2026-09-14": JSON.stringify({
      weekEnding: "2026-09-14",
      projectItems: [{ id: "p1", title: "Ad copy", done: false }],
      recurringDone: {},
    }),
    "weekly-agenda-2026-09-14": JSON.stringify({ weekEnding: "2026-09-14", cells: {
      "1-3:mon": [{ title: "Ad copy", kind: "project", done: false, tgt: { l: "projectItems", k: "p1" } }],
      "6-9:tue": [{ title: "Huddle", kind: "recurring", done: false, tgt: { m: "recurringDone", k: "r1:tue" } }],
    } }),
    "planning-2026-Q3": JSON.stringify({ year: 2026, quarter: "Q3", goals: [{ id: "g1" }] }),
  });
  globalThis.__fakeStore = store2;
  const h2 = await loadHandler();

  let t = await POST(h2, { weeklyTick: { weekEnding: "2026-09-14", tgt: { l: "projectItems", k: "p1" }, done: true } });
  assert.strictEqual(t.status, 200, "a project task ticks");
  let plan = JSON.parse(store2._m.get("weekly-plan-2026-09-14"));
  assert.strictEqual(plan.projectItems[0].done, true, "…on the item itself");
  assert.strictEqual(plan.projectItems[0].title, "Ad copy", "…without disturbing anything else on it");

  t = await POST(h2, { weeklyTick: { weekEnding: "2026-09-14", tgt: { m: "recurringDone", k: "r1:tue" }, done: true } });
  assert.strictEqual(t.status, 200, "a recurring task ticks");
  plan = JSON.parse(store2._m.get("weekly-plan-2026-09-14"));
  assert.deepStrictEqual(plan.recurringDone, { "r1:tue": true }, "…as a key in its own map");

  // the display cache is kept honest in the same breath
  const ag2 = JSON.parse(store2._m.get("weekly-agenda-2026-09-14"));
  assert.strictEqual(ag2.cells["1-3:mon"][0].done, true, "the cached agenda is updated too");
  assert.strictEqual(ag2.cells["6-9:tue"][0].done, true, "…for both");

  // and untick works, because a tick you cannot take back is a trap
  t = await POST(h2, { weeklyTick: { weekEnding: "2026-09-14", tgt: { l: "projectItems", k: "p1" }, done: false } });
  assert.strictEqual(JSON.parse(store2._m.get("weekly-plan-2026-09-14")).projectItems[0].done, false, "…and unticks");

  // REFUSALS. This is the one route on the daily page that can reach a plan.
  for (const bad of [
    { m: "somethingElse", k: "x" },                 // not a map it may write
    { l: "weeks", k: "x" },                         // not a list it may write
    { l: "projectItems", k: "../../etc" },          // not an id
    { l: "projectItems", k: "p1:monday" },          // day must be three letters
    { k: "p1" },                                    // no destination at all
    "nope",
  ]) {
    const bad1 = await POST(h2, { weeklyTick: { weekEnding: "2026-09-14", tgt: bad, done: true } });
    assert.strictEqual(bad1.status, 400, "a bad tick target is refused: " + JSON.stringify(bad));
  }
  const noWeek = await POST(h2, { weeklyTick: { weekEnding: "2026-09-21", tgt: { l: "projectItems", k: "p1" }, done: true } });
  assert.strictEqual(noWeek.status, 404, "a tick does not bring a week into existence");
  assert.ok(!store2._m.has("weekly-plan-2026-09-21"), "…and writes no plan for it");
  const gone = await POST(h2, { weeklyTick: { weekEnding: "2026-09-14", tgt: { l: "projectItems", k: "deleted" }, done: true } });
  assert.strictEqual(gone.status, 404, "…nor tick a task that is no longer in the plan");
  assert.strictEqual(JSON.parse(store2._m.get("planning-2026-Q3")).goals[0].id, "g1",
    "and the quarterly review is byte-for-byte where it was through all of that");
  delete globalThis.__fakeStore;

  /* ============ 6. one is Google's, one is yours, and you can see which ============ */
  assert.ok(/class="ct-src ct-src-goog"/.test(djs) && /Google<\/span>/.test(djs),
    "an appointment says where it came from");
  assert.ok(/class="ct-src ct-src-plan">Weekly plan/.test(djs), "…and so does a task");
  assert.ok(/class="cal-key"/.test(DAILY) && /Booked in Google Calendar/.test(DAILY) &&
    /Planned on your weekly dashboard/.test(DAILY), "…and the card carries a key for both");
  // the strongest signal is the one you do not have to read
  assert.ok(/class="ct-box" role="checkbox"/.test(djs), "a task has a box you can tick");
  assert.ok(/class="cal-tbox" role="checkbox"/.test(djs), "…in the week strip as well as today");
  assert.ok(!/class="cal-ev[^"]*"[\s\S]{0,200}?role="checkbox"/.test(djs),
    "…and an appointment has no box at all, which is the difference you can see without reading");
  // ticking must feel instant, and must not lie
  assert.ok(/row\.done = want;\s*\n\s*renderCalendar\(\);/.test(djs), "the tick lands on screen first");
  assert.ok(/row\.done = was;/.test(djs), "…and is put straight back if the store refuses it");

  /* ============ 7. v151: A MISSING BOX MUST SAY WHY ============
     Ash: "I can't see a way to tick on the daily card?"

     Because his stored agenda was published by v149, before rows carried a tick address —
     so every box silently had nothing to hook onto. A feature that renders as simply absent
     is the worst kind of broken: it looks like it was never built, and it looks like the
     reader is missing something obvious. Exactly the v144 dead-button failure again. */
  assert.ok(/function agendaNeedsRepublish\(\)/.test(djs), "the page notices when rows have no tick address");
  assert.ok(/cell\.some\(\(row\) => !row\.tgt\)/.test(djs), "…by looking for the address itself");
  assert.ok(/No tick boxes yet — <a href="\/index\.html">open the weekly plan once<\/a>/.test(djs),
    "…and says so, with the one action that fixes it");
  assert.ok(/} else if \(warn\) warn\.remove\(\);/.test(djs),
    "…and takes the message away again once it is no longer true");

  console.log("v151-say-why-there-is-no-box.test: all assertions passed");
})();
