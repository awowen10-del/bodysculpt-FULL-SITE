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
     3. v227: THE BOARD NO LONGER WRITES INTO A WEEK OR THE DAILY CACHE
     v216 copied a dated step into the week and into the daily page's agenda, then kept the
     copies' ticks in line from three directions. v227 replaced all of it with one rule: the
     weekly and daily pages read the step itself. So the board writes the step and nothing
     else, and there is nothing left to reconcile.
     ===================================================================== */
  {
    const bare = JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const gone of ["syncAgenda", "syncWeekDone", "reconcileWeek", "readWeek", "writeWeek", "weeklyAgenda", "weeklyPlan"]) {
      assert.ok(!new RegExp("\\b" + gone + "\\b").test(bare), "the board no longer has " + gone);
    }
    assert.ok(!/syncWeekDone|reconcileWeek/.test(bodyOf(JS, "toggleStepDone") + bodyOf(JS, "init")),
      "ticking on the board is one stepLink write, and loading the board reads no week");

    /* the daily page's own rule is unchanged: its only way into a weekly plan is one tick */
    const daily = read("daily.html");
    const dailyJs = daily.slice(daily.lastIndexOf("<script>") + 8, daily.lastIndexOf("</script>"));
    const dbare = dailyJs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(/weeklyTick/.test(dbare), "the daily page ticks plan tasks through the weeklyTick route");
    assert.ok(!/weeklyPlan\s*:/.test(dbare), "…and can never write a weekly plan itself");
    assert.ok(!/weeklyAgenda\s*:/.test(dbare), "…nor the agenda cache it reads");
  }

  /* =====================================================================
     4. A STEP ON THE AGENDA, AGAINST THE REAL STORE
     The weekly page now publishes a project step's agenda row with WHICH step it is
     ({ p, s }) instead of an address in the plan. The store has to keep that row — and the
     plan-tick route has to refuse it, because a step's tick is not a plan's to hold.
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
    m.set("weekly-plan-" + WEEK, JSON.stringify({ weekEnding: WEEK, projectItems: [], placements: {} }));
    let r = await POST({ weeklyAgenda: { weekEnding: WEEK, cells: {
      "6-9:thu": [{ title: "Team huddle", kind: "recurring", done: false, tgt: { m: "recurringDone", k: "r1:thu" } }],
      "any:thu": [{ title: "Point the website forms and ads at GoHighLevel", kind: "project", done: false,
        tgt: { p: "p1", s: "s8" } }],
    } } });
    assert.strictEqual(r.status, 200, "the cache takes a step row");
    const agenda = (await (await GET("weeklyagenda=" + WEEK)).json()).agenda;
    assert.deepStrictEqual(agenda.cells["any:thu"][0].tgt, { p: "p1", s: "s8" },
      "…keeping which step it is, so the daily page can tick the STEP");
    assert.ok(agenda.cells["6-9:thu"], "…and the Anytime row sits beside the others, not instead of them");

    r = await POST({ weeklyTick: { weekEnding: WEEK, tgt: { p: "p1", s: "s8" }, done: true } });
    assert.strictEqual(r.status, 400, "a step's tick is refused by the plan-tick route — it is not the plan's to hold");
    assert.deepStrictEqual(JSON.parse(m.get("weekly-plan-" + WEEK)).projectItems, [], "…and the plan is untouched");
    assert.ok(!m.has("proj-p1"), "the weekly store still holds nothing of the projects store's");
  }

  console.log("v216-a-date-is-a-plan: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
