// v219 — one thing in front of you.
//
// Ash: "I genuinely struggle to focus unless what I need to focus on is in front of me…
// there's nothing on there that's obvious what has to get done today… I need a big button
// that says 'start today' which asks me the daily questions, then once I've submitted them
// it tells me what to focus on, either all jobs or next job, and then once I've completed
// all them it sends me my end of day review… it's like tunnel vision, remove all the noise
// & then just focus on what's in front of you."
//
// He was right about the diagnosis before the cure: today's jobs WERE on the page, as a
// panel inside the calendar card, third down. The page never said "here is today".
//
// What this pins, in the order it can hurt:
//
//  1. WHAT COUNTS AS TODAY. His call: the weekly plan's blocks for today, plus any project
//     step dated today that never made it onto the plan. The queue builder is LIFTED OUT AND
//     RUN here, because a queue that quietly contains the wrong things is worse than no
//     queue — you would focus hard on the wrong work.
//
//  2. IT NEVER GATES THE DAY. The questions are skippable and the ordinary dashboard is
//     still underneath. A morning where he skips everything must not hide his jobs.
//
//  3. NO DEAD ENDS. Every job has Done, Not this one (to the back of today's queue — his
//     call) and Park it.
//
//  4. PARK IT IS HONEST. It writes to the DAY's record, never to the weekly plan. Nothing
//     here quietly rewrites a week.
//
//  5. THE PLAN DOES NOT WAIT ON GOOGLE. Found while looking at it: the agenda read was
//     bundled into the calendar read, so with no Google sign-in the page knew nothing about
//     what was planned. Survivable when today's jobs were a sub-panel; not survivable now
//     they are the point of the page.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const PAGE = read("daily.html");
const JS = PAGE.slice(PAGE.lastIndexOf("<script>") + 8, PAGE.lastIndexOf("</script>"));
const STYLE = PAGE.slice(PAGE.indexOf("<style>") + 7, PAGE.indexOf("</style>"));
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

(async () => {
  /* =====================================================================
     1. WHAT COUNTS AS TODAY — run, not read
     ===================================================================== */
  {
    const TODAY = "2026-03-18";            // a Wednesday
    const WEEK = "2026-03-16";             // the Monday that starts it
    // v227: a planned project step is matched by the ids on its row (agendaStepOf), never by
    // title — and steps past their date come after today's
    // v230: it reads THIS week's agenda (agendaToday), whatever the calendar card is showing
    const build = (agendaForDay, agendaDayKey, agendaWeekOf, ckEntry, ckToday, fmProjects) => new Function(
      "agendaForDay", "agendaDayKey", "agendaWeekOf", "ckEntry", "ckToday", "fmProjects",
      "const agendaToday = () => null;\n" +
      "function agendaStepOf(row)" + bodyOf(JS, "agendaStepOf") + "\n" +
      "function fmDaysLate(due, today)" + bodyOf(JS, "fmDaysLate") + "\n" +
      "return (function fmBuildQueue(includeParked)" + bodyOf(JS, "fmBuildQueue") + ")")(agendaForDay, agendaDayKey, agendaWeekOf, ckEntry, ckToday, fmProjects);

    const agenda = [
      { title: "Team huddle", kind: "recurring", done: true, bandLabel: "6 – 9",
        tgt: { m: "recurringDone", k: "r1:wed" }, cellKey: "6-9:wed", idx: 0 },
      { title: "Build the tag map", kind: "project", done: false, bandLabel: "12 – 3",
        tgt: { p: "p1", s: "s_planned" }, cellKey: "1-3:wed", idx: 0 },
      // a row published before v150 has no tick address — it cannot be finished from here
      { title: "An old row with no address", kind: "project", done: false, bandLabel: "12 – 3",
        tgt: null, cellKey: "1-3:wed", idx: 1 },
    ];
    const step = (id, extra) => Object.assign({ id, title: "Step " + id, del: false, done: false,
      due: "", week: "", day: "", slot: "" }, extra || {});
    const projects = [{ id: "p1", name: "Migrate from Ontraport to GoHighLevel", steps: [
      step("s_due", { title: "Point the website forms at GoHighLevel", due: TODAY }),
      step("s_planned", { title: "Build the tag map", due: TODAY, week: WEEK, day: "wed", slot: "1-3" }),
      step("s_other", { title: "Dated another day", due: "2026-03-25" }),
      step("s_none", { title: "No date at all" }),
      step("s_del", { title: "Deleted", due: TODAY, del: true }),
      step("s_done", { title: "Already finished", due: TODAY, done: true }),
      step("s_late", { title: "Should have been Monday", due: "2026-03-16" }),
      step("s_later", { title: "Should have been last week", due: "2026-03-11" }),
      step("s_latedone", { title: "Late but finished", due: "2026-03-16", done: true }),
    ] }];
    const entry = { parked: [] };
    const run = () => build(() => agenda, () => "wed", () => WEEK, () => entry, () => TODAY, projects)();

    let q = run();
    assert.deepStrictEqual(q.map((j) => j.title),
      ["Should have been last week", "Should have been Monday",
       "Team huddle", "Build the tag map", "Point the website forms at GoHighLevel", "Already finished"],
      "v230: the overdue first (oldest first), then the plan's blocks in band order, then the things dated today that never got planned");
    // v227: overdue says how late
    assert.strictEqual(q.find((j) => j.title === "Should have been Monday").when, "2 days late", "an overdue step says how late it is");
    assert.strictEqual(q.find((j) => j.title === "Should have been last week").late, 7, "…in days");
    assert.ok(!q.some((j) => j.title === "Late but finished"), "a late step that is done is not overdue");
    // the planned step is matched by ID, so its checklist comes with it
    assert.strictEqual(q.find((j) => j.title === "Build the tag map").step.step.id, "s_planned",
      "a planned row finds its step by projectId + stepId");
    assert.ok(!q.some((j) => j.title === "An old row with no address"),
      "a row with no tick address is left out — a job you cannot finish has no place in a queue about finishing");
    assert.ok(!q.some((j) => j.title === "Dated another day"), "a step dated another day is not today");
    assert.ok(!q.some((j) => j.title === "No date at all"), "…nor one with no date");
    assert.ok(!q.some((j) => j.title === "Deleted"), "…nor a deleted one");
    assert.strictEqual(q.filter((j) => j.title === "Build the tag map").length, 1,
      "A STEP ALREADY ON TODAY'S PLAN APPEARS ONCE — matched on where it is planned, not on its title");
    assert.ok(q.some((j) => j.title === "Already finished" && j.done),
      "a step already done still appears, so the evening review can count it");

    // what each job carries
    const planned = q.find((j) => j.title === "Team huddle");
    assert.strictEqual(planned.source, "plan", "a planned job knows it came from the plan");
    assert.strictEqual(planned.when, "6 – 9", "…and which block it is in");
    assert.deepStrictEqual(planned.tgt, { m: "recurringDone", k: "r1:wed" }, "…and how to tick it");
    const dated = q.find((j) => j.title === "Point the website forms at GoHighLevel");
    assert.strictEqual(dated.source, "step", "a dated job knows it came from a board");
    assert.strictEqual(dated.from, "Migrate from Ontraport to GoHighLevel", "…and which project, so it can say so");
    assert.strictEqual(dated.projectId + "/" + dated.stepId, "p1/s_due", "…and how to tick it");
    assert.ok(q.every((j) => j.key), "every job has a key of its own");
    assert.strictEqual(new Set(q.map((j) => j.key)).size, q.length, "…and no two share one");

    // parked jobs are gone from today
    entry.parked = [q.find((j) => j.title === "Build the tag map").key];
    q = run();
    assert.ok(!q.some((j) => j.title === "Build the tag map"), "a job put aside is off today's list");
    assert.strictEqual(q.length, 5, "…and only that one");

    // a week with no plan at all is empty, not broken
    const empty = build(() => [], () => "wed", () => WEEK, () => ({ parked: [] }), () => TODAY, [])();
    assert.deepStrictEqual(empty, [], "no plan and no dated steps is an empty day, not an error");
    // v230: the Today list asks for the parked ones too, to fold them at the foot
    entry.parked = [q.find((j) => j.title === "Team huddle").key];
    const withParked = build(() => agenda, () => "wed", () => WEEK, () => entry, () => TODAY, projects)(true);
    assert.ok(withParked.some((j) => j.title === "Team huddle"), "asked to, it includes what was put aside");
  }

  /* =====================================================================
     2. IT NEVER GATES THE DAY
     v230: the morning questions are still Start today's job; saved OR skipped, they close
     and leave you on the page, where the jobs are now listed.
     ===================================================================== */
  {
    assert.ok(/id="fmSkipQ">Skip for today</.test(JS), "the questions can be skipped");
    const wire = bodyOf(JS, "fmWire");
    assert.ok(/on\("fmSkipQ", async \(\) => \{[\s\S]*?fmCloseMode\(\)/.test(wire),
      "…and skipping goes back to the page and its list");
    assert.ok(!/fmStage = "day"/.test(JS), "there is no one-at-a-time stage any more");
    assert.ok(/<div class="fm" id="fmWrap" hidden>/.test(PAGE), "focus mode starts hidden");
    assert.ok(/\.fm\{position:fixed;inset:0/.test(STYLE), "…and is laid over the page when it opens");
    const close = bodyOf(JS, "fmCloseMode");
    assert.ok(/renderStartDay\(\); renderToday\(\); renderTodayList\(\); renderCalendar\(\);/.test(close),
      "closing it puts you back on a page that is up to date, list and all");
    assert.ok(/e\.key === "Escape" && fmOpen/.test(JS), "Escape is always a way out");
    const start = bodyOf(JS, "renderStartDay");
    for (const state of ["Start today", "Close the day", "Today is closed off"]) {
      assert.ok(start.includes('"' + state + '"'), "the button says " + state + " when that is where the day is");
    }
  }

  /* =====================================================================
     3. v230: THE TODAY LIST — every job, on the page
     ===================================================================== */
  {
    assert.ok(/<section class="card tl-card" id="tlCard">/.test(PAGE), "the page has a Today list");
    assert.ok(PAGE.indexOf('<div class="day-top">') < PAGE.indexOf('id="tlCard"') &&
      PAGE.indexOf('id="tlCard"') < PAGE.indexOf('id="slCard"'),
      "…directly under the start strip and the One thing / Focus block card");
    const jobs = bodyOf(JS, "tlJobs");
    assert.ok(/key: "one"/.test(jobs) && jobs.indexOf('key: "one"') < jobs.indexOf("fmBuildQueue(true)"),
      "the One Thing leads the list");
    const list = bodyOf(JS, "renderTodayList");
    assert.ok(/done \+ " of " \+ live\.length \+ " done"/.test(list), "the header says how many are done");
    assert.ok(/live\.filter\(\(j\) => !j\.done\)\.concat\(live\.filter\(\(j\) => j\.done\)\)/.test(list),
      "done rows sink to the bottom rather than vanishing");
    assert.ok(/Parked \(" \+ parked\.length \+ "\)/.test(list), "parked jobs fold into one line at the foot");
    assert.ok(/Nothing is planned for today\./.test(list) && /has not been opened since it last changed/.test(list),
      "an empty day says so, and says where jobs come from");
    const row = bodyOf(JS, "tlRowHtml");
    for (const act of ["tick", "more", "focus", "park", "unpark", "min", "keep", "fin-done"]) {
      assert.ok(row.includes('data-tl="' + act + '"'), "a row offers " + act);
    }
    assert.ok(/ftDialHtml\("and dial in"\)/.test(row), "a running row offers Dial in as a second button — never automatic");
    // park writes to the DAY, never to the plan
    const park = bodyOf(JS, "tlPark");
    assert.ok(/ckSave\(\{ parked \}\)/.test(park), "later is written on the day's own record");
    assert.ok(!/weeklyTick|weeklyPlan|stepLink/.test(park), "…and touches neither the weekly plan nor the board");
    // finishing a job ends its block
    assert.ok(/if \(want && ftTimer && ftTimer\.jobKey === j\.key\) ftReset\(\);/.test(bodyOf(JS, "tlTick")),
      "ticking a job while its timer runs stops the timer");
  }

  /* =====================================================================
     4. THE TICK, EITHER KIND, AND THE WRITE-UP
     ===================================================================== */
  {
    const set = bodyOf(JS, "fmSetDone");
    assert.ok(set.indexOf("setLocal(want)") < set.indexOf("await tickTask"),
      "a tick moves on screen before the request — one that waits for the network feels broken");
    assert.ok(/setLocal\(was\);/.test(set), "…and goes back if the store would not take it");
    assert.ok(/if \(job\.source === "plan"\) await tickTask\(job\.tgt, want, agendaWeekOf\(0\)\);\s*else await fmTickStep\(job, want\);/.test(set),
      "a planned job ticks through THIS week's plan; a dated step ticks through the board");
    const eve = bodyOf(JS, "fmEveningHtml");
    assert.ok(/job" \+ \(done\.length === 1 \? "" : "s"\) \+ " done/.test(eve), "the write-up counts what got done");
    assert.ok(/Still open/.test(eve) && /put aside/.test(eve), "…what did not, and what was put aside");
    assert.ok(/What is carrying into tomorrow\?/.test(eve), "…and asks the one question worth asking");
    assert.ok(/These stay where they are — on your weekly plan for today\./.test(eve),
      "…and is honest that it has not moved anything for you");
    assert.ok(/id="fmBackToDay"/.test(eve), "…with a way back to the jobs if it was opened early");
    assert.ok(/best-evidenced part of all this/.test(eve), "…and says why it is worth two minutes");
  }

  /* =====================================================================
     5. THE PLAN DOES NOT WAIT ON GOOGLE
     ===================================================================== */
  {
    const ref = bodyOf(JS, "calRefresh");
    assert.ok(/const agenda = loadAgenda\(\)/.test(ref), "the plan's grid is read on its own");
    assert.ok(ref.indexOf("loadAgenda()") < ref.indexOf("if (!gcalClientId"),
      "…BEFORE the Google check, so no sign-in still means you can see your day");
    assert.ok(/await agenda; return;/.test(ref), "…and it is waited for even when Google is absent");
    assert.ok(/THE PLAN'S GRID IS OURS, AND IT MUST NOT WAIT ON GOOGLE/.test(JS),
      "…and why is written down, because the old shape looked deliberate");
    // reading the projects store is a read, and it is not allowed to hold the page up
    assert.ok(/fmLoadProjects\(\)\.then\(\(\) => \{ renderStartDay\(\)/.test(JS),
      "the project list loads after the page, and updates it when it lands");
    assert.ok(/catch \(e\) \{ fmProjects = \[\]; \}/.test(bodyOf(JS, "fmLoadProjects")),
      "…and a projects store that will not answer costs the day nothing but those jobs");
  }

  /* =====================================================================
     6. THE STORE KEEPS THE NEW FIELDS
     The check-in's cleaner is a whitelist. A field the page starts sending that is not on it
     is silently eaten on the next save — the trap this codebase has hit before.
     ===================================================================== */
  {
    const src = read("netlify/functions/kpi-store.js");
    const m = new Map();
    globalThis.__fakeStore = {
      async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
      async set(k, v) { m.set(k, v); },
      async list() { return { blobs: [], directories: [] }; },
    };
    const tmp = path.join(os.tmpdir(), "kpi-store-v219-" + process.pid + ".mjs");
    fs.writeFileSync(tmp, src.replace(/^import \{ getStore \} from "@netlify\/blobs";$/m,
      "const getStore = () => globalThis.__fakeStore;"));
    const h = (await import("file://" + tmp)).default;
    fs.unlinkSync(tmp);
    const POST = (body) => h(new Request("https://x/.netlify/functions/kpi-store",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

    const r = await POST({ checkin: { date: "2026-03-18", mind: "a lot", oneThing: "Ship the migration",
      oneThingWhen: "1-3", parked: ["plan:projectItems:t_map"], dayNote: "GHL support still quiet",
      closedAt: "2026-03-18T18:30:00.000Z" } });
    assert.strictEqual(r.status, 200, "the day saves");
    const back = (await r.json()).checkin;
    assert.strictEqual(back.oneThingWhen, "1-3", "the band the one thing is for survives");
    assert.deepStrictEqual(back.parked, ["plan:projectItems:t_map"], "what was put aside survives");
    assert.strictEqual(back.dayNote, "GHL support still quiet", "the end-of-day line survives");
    assert.strictEqual(back.closedAt, "2026-03-18T18:30:00.000Z", "…and when the day was closed");
    assert.strictEqual(back.oneThing, "Ship the migration", "…and nothing that was already kept is lost");

    // a band the weekly grid does not have is not a band
    const bad = (await (await POST({ checkin: { date: "2026-03-18", oneThingWhen: "midnight" } })).json()).checkin;
    assert.strictEqual(bad.oneThingWhen, "", "a band that names no row of the grid is dropped");
    // the four the page offers are the four the store takes
    const bands = /const CHECKIN_BANDS = (\[[^\]]*\]);/.exec(src);
    const pageBands = /const FM_BANDS = (\[[\s\S]*?\]);/.exec(JS);
    assert.ok(bands && pageBands, "both name their bands");
    assert.deepStrictEqual(new Function("return " + bands[1])(),
      new Function("return " + pageBands[1])().map((b) => b[0]),
      "the bands the page offers are exactly the bands the store keeps");
  }

  /* =====================================================================
     7. v220: WHAT IS INSIDE THE JOB
     Ash: "if there's a task we're doing that has checklists inside of it, they are being
     shown as well." A job pulled from a board brings its checklist with it, and that
     checklist ticks from here — reading one you cannot tick sends you to the board, which is
     the friction this whole mode exists to remove.
     ===================================================================== */
  {
    const projects = [{ id: "p1", name: "Migrate from Ontraport to GoHighLevel", steps: [
      { id: "s1", title: "Build the tag map", del: false, done: false, due: "", week: "2026-03-16", day: "wed",
        notes: "Old name left, new name right.", files: [{ id: "f1", name: "audit.md" }],
        checklist: [{ id: "c1", text: "Tags", done: true }, { id: "c2", text: "Custom fields", done: false }] },
      { id: "s2", title: "Build the tag map", del: false, done: false, due: "", week: "", day: "",
        notes: "", files: [], checklist: [] },                      // same title, NOT planned today
    ] }];
    // v227: matched by the ids the weekly page writes on the row — never by title
    assert.ok(!/function fmStepForPlanned/.test(JS), "the title-match fallback is gone");
    const find = new Function("fmProjects", "return (function agendaStepOf(row)" + bodyOf(JS, "agendaStepOf") + ")")(projects);
    const hit = find({ title: "Build the tag map", tgt: { p: "p1", s: "s1" } });
    assert.ok(hit && hit.step.id === "s1", "a planned row finds its step by projectId + stepId — two steps can share a title");
    assert.strictEqual(find({ title: "Build the tag map", tgt: { p: "p1", s: "s2" } }).step.id, "s2", "…so the same title finds the other step when the ids say so");
    assert.strictEqual(find({ title: "Build the tag map", tgt: { l: "projectItems", k: "t1" } }), null, "…and a row with no step ids is no step at all");

    const detail = new Function("return (function fmDetail(job)" + bodyOf(JS, "fmDetail") + ")")();
    const d = detail({ step: hit });
    assert.strictEqual(d.list.length, 2, "the checklist comes through");
    assert.strictEqual(d.done, 1, "…with its state");
    assert.strictEqual(d.notes, "Old name left, new name right.", "…and the notes");
    assert.strictEqual(d.files.length, 1, "…and the files");
    assert.strictEqual(detail({ step: { project: {}, step: { checklist: [], notes: "", files: [] } } }), null,
      "a step with nothing inside it shows nothing — no empty panel under the job");
    assert.strictEqual(detail({}), null, "and a job that is not a step at all shows nothing");

    // v230: it renders inline under its row, behind the ▸, as ticks
    const html = bodyOf(JS, "tlDetailHtml");
    assert.ok(/Checklist — ' \+ d\.done \+ " of " \+ d\.list\.length/.test(html), "the checklist is counted");
    assert.ok(/data-tl="ck" data-ck="/.test(html), "…and every item is a tick");
    assert.ok(/if \(open\) h \+= tlDetailHtml\(j\);/.test(bodyOf(JS, "tlRowHtml")),
      "the notes and checklist are behind the ▸ — the list stays a list");
    // ticking is optimistic and reverts, like every other tick in the suite
    const tick = bodyOf(JS, "fmTickCheck");
    assert.ok(tick.indexOf("c.done = !was") < tick.indexOf("await fetch"), "the box moves before the request");
    assert.ok(/c\.done = was; fmAfterChange\(\);/.test(tick), "…and goes back if the board will not take it");
  }

  console.log("v219-one-thing-in-front-of-you: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
