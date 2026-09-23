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
    const build = new Function(
      "agendaForDay", "agendaDayKey", "agendaWeekOf", "ckEntry", "ckToday", "fmProjects",
      "return (function fmBuildQueue()" + bodyOf(JS, "fmBuildQueue") + ")");

    const agenda = [
      { title: "Team huddle", kind: "recurring", done: true, bandLabel: "6 – 9",
        tgt: { m: "recurringDone", k: "r1:wed" }, cellKey: "6-9:wed", idx: 0 },
      { title: "Build the tag map", kind: "project", done: false, bandLabel: "12 – 3",
        tgt: { l: "projectItems", k: "t_map" }, cellKey: "1-3:wed", idx: 0 },
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
    ] }];
    const entry = { parked: [] };
    const run = () => build(() => agenda, () => "wed", () => WEEK, () => entry, () => TODAY, projects)();

    let q = run();
    assert.deepStrictEqual(q.map((j) => j.title),
      ["Team huddle", "Build the tag map", "Point the website forms at GoHighLevel", "Already finished"],
      "today is the plan's blocks in band order, then the things dated today that never got planned");
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
    assert.strictEqual(q.length, 3, "…and only that one");

    // a week with no plan at all is empty, not broken
    const empty = build(() => [], () => "wed", () => WEEK, () => ({ parked: [] }), () => TODAY, [])();
    assert.deepStrictEqual(empty, [], "no plan and no dated steps is an empty day, not an error");
  }

  /* =====================================================================
     2. IT NEVER GATES THE DAY
     ===================================================================== */
  {
    assert.ok(/id="fmSkipQ">Skip for today</.test(JS), "the questions can be skipped");
    const wire = bodyOf(JS, "fmWire");
    assert.ok(/on\("fmSkipQ", async \(\) => \{[\s\S]*?fmStage = "day"/.test(wire),
      "…and skipping goes straight to the jobs, rather than out");
    // the mode is an overlay over the page, not a replacement for it
    assert.ok(/<div class="fm" id="fmWrap" hidden>/.test(PAGE), "focus mode starts hidden");
    assert.ok(/\.fm\{position:fixed;inset:0/.test(STYLE), "…and is laid over the page when it opens");
    assert.ok(/Everything else on this page is still here, underneath/.test(PAGE),
      "…the ordinary dashboard is untouched beneath it");
    const close = bodyOf(JS, "fmCloseMode");
    assert.ok(/renderStartDay\(\); renderToday\(\); renderCalendar\(\);/.test(close),
      "closing it puts you back on a page that is up to date");
    assert.ok(/e\.key === "Escape" && fmOpen/.test(JS), "Escape is always a way out");
    // and the button tells you where the day is up to rather than just sitting there
    const start = bodyOf(JS, "renderStartDay");
    for (const state of ["Start today", "Focus on today", "Close the day", "Today is closed off"]) {
      assert.ok(start.includes('"' + state + '"'), "the button says " + state + " when that is where the day is");
    }
  }

  /* =====================================================================
     3. NO DEAD ENDS, AND PARK IT IS HONEST
     ===================================================================== */
  {
    const day = bodyOf(JS, "fmDayHtml");
    assert.ok(/id="fmDone"/.test(day) && /id="fmSkip"/.test(day) && /id="fmPark"/.test(day),
      "every job offers Done, Not this one, and Park it");
    assert.ok(/fmLeft\(\)\.length > 1 \?/.test(day),
      "…except that there is nothing to skip TO when it is the last one, so that button goes");
    // his call: skipping sends it to the back of today
    const skip = bodyOf(JS, "fmSkipCurrent");
    assert.ok(/fmQueue\.splice\(i, 1\);\s*fmQueue\.push\(job\);/.test(skip),
      "Not this one sends it to the back of today's queue, to come round again");
    // park writes to the DAY, never to the plan
    const park = bodyOf(JS, "fmParkCurrent");
    assert.ok(/ckSave\(\{ parked \}\)/.test(park), "Park it is written on the day's own record");
    assert.ok(!/weeklyTick|weeklyPlan|stepLink/.test(park), "…and touches neither the weekly plan nor the board");
    assert.ok(/a fact about a day, and the plan has no field for it/.test(JS),
      "…and the reason is written down where the next person will read it");
    // a day with nothing in it says what to do about it rather than showing a void
    assert.ok(/Nothing is planned for today\./.test(day), "an empty day says so");
    assert.ok(/weekly planner<\/a>, and from any/.test(day), "…and says where jobs come from");
    assert.ok(/has not been opened since it last changed/.test(day),
      "…including the one case where the day only LOOKS empty");
  }

  /* =====================================================================
     4. THE TICK, EITHER KIND, AND THE WRITE-UP
     ===================================================================== */
  {
    const set = bodyOf(JS, "fmSetDone");
    assert.ok(set.indexOf("job.done = want") < set.indexOf("await tickTask"),
      "a tick moves on screen before the request — one that waits for the network feels broken");
    assert.ok(/job\.done = was;/.test(set), "…and goes back if the store would not take it");
    assert.ok(/if \(job\.source === "plan"\) await tickTask\(job\.tgt, want\);\s*else await fmTickStep\(job, want\);/.test(set),
      "a planned job ticks through the weekly plan; a dated step ticks through the board");
    // the evening
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

  console.log("v219-one-thing-in-front-of-you: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
