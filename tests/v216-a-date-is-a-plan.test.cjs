// v216 — a date is a plan, if you say so.
//
// Ash: "If I set a date on a task, it should move to the weekly and daily view… I want to
// do that tomorrow, I will select tomorrow & it should prompt me if it wants me to move
// that to my weekly and daily view, and if i say yes, it should move it there on the daily
// dashboard and the weekly planner."
//
// Three things had to be true for that to work, and each of them is a way it could have
// quietly not:
//
//  1. A DATE IS NOT ALWAYS THIS WEEK. v214 could only place a step into the week you were
//     standing in. A due date three weeks out means a different plan entirely, and moving a
//     step between two weeks means touching both of them — so every week involved is read
//     before a single one is written.
//
//  2. THE DAILY DASHBOARD DOES NOT READ THE WEEKLY PLAN. It reads `weekly-agenda-<week>`, a
//     cache the WEEKLY page publishes from its own placement engine. A task written straight
//     into a plan is invisible on the daily page until somebody opens the weekly planner. So
//     the row goes into that cache too — but ONLY into one that already exists, because a
//     cache holding one task claims the day holds one task, which would hide every recurring
//     and training item on it. When there is none, the confirmation says so in words.
//
//  3. A TICK HAS THREE PLACES TO HAPPEN NOW. The board tells the week (syncWeekDone); the
//     week tells the board (the v214 stepLink route); and the daily dashboard can only ever
//     write to a plan — so the board reads this week once on load and picks up what was
//     ticked off there. One direction each, and no two of them can fight.
//
// The date maths is RUN, not read: which week a date belongs to has to be the same answer
// the weekly page would give, or a task lands in a week nobody is looking at.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const PAGE = read("projects.html");
const WEEKLY = read("index.html");
const STYLE = PAGE.slice(PAGE.indexOf("<style>") + 7, PAGE.indexOf("</style>"));
const JS = PAGE.slice(PAGE.lastIndexOf("<script>") + 8, PAGE.lastIndexOf("</script>"));
const WJS = WEEKLY.slice(WEEKLY.lastIndexOf("<script>") + 8, WEEKLY.lastIndexOf("</script>"));
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
     1. WHICH WEEK A DATE BELONGS TO — the same answer the weekly page gives
     ===================================================================== */
  {
    const WEEK_DAYS = new Function("return " + /const WEEK_DAYS = (\[[\s\S]*?\]);/.exec(JS)[1])();
    const weekKeyOf = new Function("return (function weekKeyOf(ymdStr)" + bodyOf(JS, "weekKeyOf") + ")")();
    const dayKeyOf = new Function("WEEK_DAYS", "return (function dayKeyOf(ymdStr)" + bodyOf(JS, "dayKeyOf") + ")")(WEEK_DAYS);
    const mondayOf = new Function("return (function mondayOf(d)" + bodyOf(WJS, "mondayOf") + ")")();

    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const t = Date.UTC(2026, 0, 1) + i * 86400000;
      const ymd = new Date(t).toISOString().slice(0, 10);
      assert.strictEqual(weekKeyOf(ymd), mondayOf(new Date(t)).toISOString().slice(0, 10),
        "the week for " + ymd + " is the one the weekly page would file it under");
      // the day key has to agree with the week key: week + day index must be the date itself
      const idx = WEEK_DAYS.findIndex((d) => d[0] === dayKeyOf(ymd));
      const back = new Date(weekKeyOf(ymd) + "T00:00:00Z");
      back.setUTCDate(back.getUTCDate() + idx);
      assert.strictEqual(back.toISOString().slice(0, 10), ymd, "…and the day within it is the date itself");
      checked++;
    }
    assert.strictEqual(checked, 400, "checked a year of dates");
    // the boundaries, said out loud
    assert.strictEqual(weekKeyOf("2026-09-27"), "2026-09-21", "Sunday belongs to the week that started six days earlier");
    assert.strictEqual(dayKeyOf("2026-09-27"), "sun", "…as its Sunday");
    assert.strictEqual(weekKeyOf("2026-09-28"), "2026-09-28", "Monday starts its own week");
    assert.strictEqual(dayKeyOf("2026-09-28"), "mon", "…as its Monday");
    assert.strictEqual(weekKeyOf("nonsense"), "", "a date that is not a date is not a week");
    assert.strictEqual(dayKeyOf(""), "", "…nor a day");
  }

  /* =====================================================================
     2. THE OFFER — and when it stays out of the way
     ===================================================================== */
  {
    const WEEK_DAYS = new Function("return " + /const WEEK_DAYS = (\[[\s\S]*?\]);/.exec(JS)[1])();
    const MONTHS = new Function("return " + /const MONTHS = (\[[\s\S]*?\]);/.exec(JS)[1])();
    // the real functions, lifted out with their own parameter names — planLabel's is `step`
    // and offerFor's is `s`, and getting that wrong makes the body reference a global
    const ARG = { weekKeyNow: "when", weekKeyOf: "ymdStr", dayKeyOf: "ymdStr", planLabel: "step", offerFor: "s" };
    const src = Object.keys(ARG)
      .map((n) => "function " + n + "(" + ARG[n] + ")" + bodyOf(JS, n)).join("\n");
    const api = new Function("WEEK_DAYS", "MONTHS", "S", src + "\nreturn { weekKeyNow, weekKeyOf, dayKeyOf, planLabel, offerFor };");
    const S = { dateOffer: "" };
    const { weekKeyNow, planLabel, offerFor } = api(WEEK_DAYS, MONTHS, S);

    const today = new Date();
    const inDays = (n) => { const d = new Date(Date.now() + n * 86400000); return d.toISOString().slice(0, 10); };
    const step = (extra) => Object.assign({ id: "s1", due: "", week: "", day: "" }, extra || {});

    // no date, no offer
    assert.strictEqual(offerFor(step()), "", "a step with no date is not offered a plan");
    // a date that was just set, on a step not yet planned → offered
    const soon = inDays(1);
    S.dateOffer = "s1|" + soon;
    assert.ok(offerFor(step({ due: soon })), "setting a date offers to plan it");
    // …but only for the date that was just set
    S.dateOffer = "s1|2020-01-01";
    assert.strictEqual(offerFor(step({ due: soon })), "", "an old offer does not hang around on a new date");
    // already planned for exactly that day → nothing to offer
    S.dateOffer = "s1|" + soon;
    const w = api(WEEK_DAYS, MONTHS, S);
    assert.strictEqual(offerFor(step({ due: soon, week: w.weekKeyOf(soon), day: w.dayKeyOf(soon) })), "",
      "a step already planned for that very day is not offered it again");
    // a date in a week that has been and gone is not a plan
    S.dateOffer = "s1|" + inDays(-30);
    assert.strictEqual(offerFor(step({ due: inDays(-30) })), "", "a date in a week already gone is not offered");

    // how a plan reads
    assert.ok(/this week$/.test(planLabel({ week: weekKeyNow(), day: "mon" })), "this week says so");
    const next = new Date(Date.parse(weekKeyNow() + "T00:00:00Z") + 7 * 86400000).toISOString().slice(0, 10);
    assert.ok(/next week$/.test(planLabel({ week: next, day: "thu" })), "next week says so");
    const far = new Date(Date.parse(weekKeyNow() + "T00:00:00Z") + 28 * 86400000).toISOString().slice(0, 10);
    assert.ok(/^Thu \d{1,2} [A-Z][a-z]{2}$/.test(planLabel({ week: far, day: "thu" })),
      "further out gives the date itself, not 'in 4 weeks'");
    assert.strictEqual(planLabel({ week: "", day: "" }), "", "an unplanned step says nothing");

    /* the offer is a thing on the page, not a toast that vanishes before it is read */
    assert.ok(/data-offer="yes"/.test(JS) && /data-offer="no"/.test(JS), "the offer has both answers");
    assert.ok(/Put it on your plan for/.test(JS), "…and asks in words");
    assert.ok(/It goes on the weekly planner, and on your daily dashboard on the day\./.test(JS),
      "…and says where it will go, including that the daily one is on the day");
    assert.ok(/\.offer\{[^}]*margin-top:var\(--sp-3\)/.test(STYLE), "it sits under the date it is about");
    // saying yes plans it for the DATE, not for today
    assert.ok(/setStepWeek\(s, dayKeyOf\(s\.due\), s\.slot \|\| "6-9", weekKeyOf\(s\.due\)\)/.test(JS),
      "yes plans it for the day the date names, in the week that date falls in");
    // setting a date is what raises the offer, from either control
    assert.ok((JS.match(/S\.dateOffer = s\.due \? s\.id \+ "\|" \+ s\.due : "";/g) || []).length === 2,
      "both the date box and the quick buttons raise the offer");
  }

  /* =====================================================================
     3. THE DAILY DASHBOARD'S CACHE
     ===================================================================== */
  {
    const sync = bodyOf(JS, "syncAgenda");
    assert.ok(/weeklyagenda=/.test(sync), "it reads the week's agenda");
    assert.ok(/if \(!agenda \|\| !agenda\.cells\) return false;\s*\/\/ never invent one/.test(sync),
      "IT NEVER INVENTS ONE — a cache holding one task would claim the day holds one task, hiding the rest of it");
    assert.ok(/tgt: \{ l: "projectItems", k: a\.itemId \}/.test(sync),
      "the row carries the tick address the daily page needs, so it can be ticked off from there");
    assert.ok(/kind: "project"/.test(sync), "…and is the same kind of row the weekly page's engine would derive");
    assert.ok(/weeklyAgenda: \{ weekEnding: week, cells \}/.test(sync), "…and it writes only that week's cache");
    // the honest message when there is no cache to update
    assert.ok(/open the weekly planner once and it will show on your day too/.test(JS),
      "when there is no agenda yet, the confirmation says so rather than implying it is on the daily page");
    const setWeek = bodyOf(JS, "setStepWeek");
    assert.ok(setWeek.indexOf("writeWeek") < setWeek.indexOf("syncAgenda"),
      "the plan is written before the cache — the cache is a convenience, the plan is the record");

    /* what the store will accept, so the row is not silently dropped */
    const store = read("netlify/functions/kpi-store.js");
    assert.ok(/const AGENDA_KINDS = \["project", "buffer", "recurring", "training"\]/.test(store),
      '"project" is a kind the store keeps');
    assert.ok(/const TICK_LISTS = \["projectItems", "bufferItems"\]/.test(store),
      '"projectItems" is a tick address the store keeps');
  }

  /* =====================================================================
     4. THREE PLACES TO TICK, ONE DIRECTION EACH
     ===================================================================== */
  {
    // the board tells the week
    const tog = bodyOf(JS, "toggleStepDone");
    assert.ok(/syncWeekDone\(s\)/.test(tog), "ticking on the board tells the week");
    const swd = bodyOf(JS, "syncWeekDone");
    assert.ok(/if \(!mine \|\| !!mine\.done === !!step\.done\) return;/.test(swd),
      "…and says nothing when the week already agrees, so it never writes for the sake of it");
    assert.ok(/syncAgenda\(step\.week/.test(swd), "…updating the daily cache with it");
    // the daily dashboard can only write to a plan, so the board picks it up on load
    const rec = bodyOf(JS, "reconcileWeek");
    assert.ok(/it\.done && it\.sourceStepId/.test(rec), "the board reads this week for anything finished there");
    assert.ok(/if \(!step \|\| step\.done\) continue;/.test(rec), "…and only acts where the two disagree");
    assert.ok(/done: true/.test(rec) && !/done: false/.test(rec),
      "ONE DIRECTION ONLY: done in the plan ticks the board, never the reverse — the reverse is syncWeekDone's job");
    assert.ok(/reconcileWeek\(\);/.test(bodyOf(JS, "init")), "it runs when the page loads");
    const init = bodyOf(JS, "init");
    assert.ok(init.indexOf("showView(") < init.indexOf("reconcileWeek()"),
      "…after the first paint, never before it");
    assert.ok(/catch \(e\) \{ return; \}/.test(rec), "a plan that will not load costs the board nothing");
    /* The daily page's own rule is untouched, and the rule is narrower than "it writes one
       thing" — it also saves its own check-in, which is its own data. The claim that matters
       here is that its ONLY way into a weekly plan is a single tick: it cannot write a plan,
       and it cannot write the agenda cache this release now puts rows into. */
    const daily = read("daily.html");
    const dailyJs = daily.slice(daily.lastIndexOf("<script>") + 8, daily.lastIndexOf("</script>"));
    const bare = dailyJs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(/weeklyTick/.test(bare), "the daily page ticks through the weeklyTick route");
    assert.ok(!/weeklyPlan\s*:/.test(bare), "…and can never write a weekly plan itself");
    assert.ok(!/weeklyAgenda\s*:/.test(bare), "…nor the agenda cache it reads");
  }

  /* =====================================================================
     5. THE WHOLE CHAIN, AGAINST THE REAL STORE
     Every assertion above reads code. This one replays the exact three payloads the page
     sends into the REAL kpi-store handler and then asks, as the daily dashboard would, what
     is on Thursday — because "it appears on the daily dashboard" is the claim Ash made and
     the only way to be sure of it is to look.
     ===================================================================== */
  {
    const SRC = path.join(__dirname, "..", "netlify", "functions", "kpi-store.js");
    const src = fs.readFileSync(SRC, "utf8");
    const m = new Map();
    globalThis.__fakeStore = {
      async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
      async set(k, v) { m.set(k, v); },
      async list(o) { const p = (o && o.prefix) || "";
        return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })), directories: [] }; },
    };
    const tmp = path.join(os.tmpdir(), "kpi-store-v216-" + process.pid + ".mjs");
    fs.writeFileSync(tmp, src.replace(/^import \{ getStore \} from "@netlify\/blobs";$/m,
      "const getStore = () => globalThis.__fakeStore;"));
    const h = (await import("file://" + tmp)).default;
    fs.unlinkSync(tmp);
    const POST = (body) => h(new Request("https://x/.netlify/functions/kpi-store",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    const GET = (qs) => h(new Request("https://x/.netlify/functions/kpi-store?" + qs));

    const WEEK = "2026-09-21";
    // the week already has a plan and a published agenda — a Monday recurring task on it,
    // so we can see whether adding ours keeps it
    m.set("weekly-plan-" + WEEK, JSON.stringify({ weekEnding: WEEK,
      projectItems: [{ id: "tOld", title: "Something already planned", done: false }],
      placements: { "6-9:mon": ["project:tOld"] } }));
    m.set("weekly-agenda-" + WEEK, JSON.stringify({ weekEnding: WEEK, cells: {
      "6-9:mon": [{ title: "Something already planned", kind: "project", done: false, tgt: { l: "projectItems", k: "tOld" } }],
      "6-9:thu": [{ title: "Team huddle", kind: "recurring", done: false, tgt: { m: "recurringDone", k: "r1:thu" } }],
    } }));

    // 1. the page writes the plan
    let r = await POST({ weeklyPlan: { weekEnding: WEEK,
      projectItems: [
        { id: "tOld", title: "Something already planned", done: false },
        { id: "tNew", title: "Point the website forms and ads at GoHighLevel", done: false,
          linkId: "projstep:p1:s8:" + WEEK, source: "project-step",
          sourceProjectId: "p1", sourceStepId: "s8", sourceProjectName: "Migrate from Ontraport to GoHighLevel" },
      ],
      placements: { "6-9:mon": ["project:tOld"], "1-3:thu": ["project:tNew"] } } });
    assert.strictEqual(r.status, 200, "the plan takes the new task");
    const plan = (await r.json()).plan;
    assert.strictEqual(plan.projectItems.length, 2, "…alongside what was already there");
    assert.deepStrictEqual(plan.placements["1-3:thu"], ["project:tNew"], "…placed on Thursday afternoon");
    assert.deepStrictEqual(plan.placements["6-9:mon"], ["project:tOld"], "…and Monday is untouched");
    assert.strictEqual(plan.projectItems[1].sourceStepId, "s8", "…keeping its link back to the step");

    // 2. the page updates the daily dashboard's cache
    r = await POST({ weeklyAgenda: { weekEnding: WEEK, cells: {
      "6-9:mon": [{ title: "Something already planned", kind: "project", done: false, tgt: { l: "projectItems", k: "tOld" } }],
      "6-9:thu": [{ title: "Team huddle", kind: "recurring", done: false, tgt: { m: "recurringDone", k: "r1:thu" } }],
      "1-3:thu": [{ title: "Point the website forms and ads at GoHighLevel", kind: "project", done: false,
        tgt: { l: "projectItems", k: "tNew" } }],
    } } });
    assert.strictEqual(r.status, 200, "the cache takes the row");

    // 3. …and now: what does the DAILY DASHBOARD see on Thursday?
    const agenda = (await (await GET("weeklyagenda=" + WEEK)).json()).agenda;
    const thursday = [].concat(agenda.cells["6-9:thu"] || [], agenda.cells["1-3:thu"] || []);
    assert.strictEqual(thursday.length, 2, "Thursday holds two things");
    assert.ok(thursday.some((t) => t.title === "Team huddle"),
      "…the recurring task that was already there is STILL there — the cache was updated, not replaced");
    const mine = thursday.find((t) => t.title === "Point the website forms and ads at GoHighLevel");
    assert.ok(mine, "…and the step Ash dated is on it");
    assert.deepStrictEqual(mine.tgt, { l: "projectItems", k: "tNew" }, "…with the address the daily page ticks through");
    assert.strictEqual(mine.done, false, "…not done yet");

    // 4. tick it off from the daily dashboard, the only write that page can make
    r = await POST({ weeklyTick: { weekEnding: WEEK, tgt: { l: "projectItems", k: "tNew" }, done: true } });
    assert.strictEqual(r.status, 200, "the daily page can tick it");
    const after = JSON.parse(m.get("weekly-plan-" + WEEK));
    assert.strictEqual(after.projectItems.find((i) => i.id === "tNew").done, true, "…and the plan says so");
    const ag2 = JSON.parse(m.get("weekly-agenda-" + WEEK));
    assert.strictEqual(ag2.cells["1-3:thu"][0].done, true, "…and the cache with it");
    // which is exactly the state reconcileWeek() looks for when the board next loads:
    // done in the plan, still open on the board.
    assert.strictEqual(after.projectItems.find((i) => i.id === "tNew").sourceStepId, "s8",
      "…and the row still knows which step it was, so the board can pick the tick up");

    // nothing else in the store moved
    assert.ok(!m.has("proj-p1"), "the weekly store still holds nothing of the projects store's");
  }

  console.log("v216-a-date-is-a-plan: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
