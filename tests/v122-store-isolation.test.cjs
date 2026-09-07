// v122: the finance module must be unable to touch anything the planning pages store.
//
// This is the guarantee that matters on a deploy: weekly plans, monthly plans, quarterly
// planning, KPI weeks, check-ins and recurring defaults are LIVE DATA with no backup, and
// adding finance routes to the same function must not put a scratch on any of it. So this
// test boots the REAL kpi-store handler against a fake blob store, seeds it with a record
// of every existing kind, drives every finance route, and then asserts the seeded records
// come back byte-identical.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SRC = path.join(__dirname, "..", "netlify", "functions", "kpi-store.js");

// The blob store, faked: a Map with the same get/set/list surface the handler uses.
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

// Every kind of record the planning pages own, with content that is easy to spot.
const SEED = {
  "weeks": JSON.stringify([{ weekEnding: "2026-08-31", leads: 41, trialSales: 9, recurring: 312 }]),
  "settings": JSON.stringify({ leadTarget: 50, cpaTarget: 40 }),
  "months": JSON.stringify([{ ym: "2026-08", revenue: 41000 }]),
  "planning-2026-Q3": JSON.stringify({ year: 2026, quarter: "Q3", goals: [{ id: "g1", title: "Open the second room" }] }),
  "weekly-plan-2026-08-31": JSON.stringify({ weekEnding: "2026-08-31", tasks: [{ id: "t1", title: "Call the landlord" }] }),
  "weekly-recurring-defaults": JSON.stringify([{ id: "r1", title: "Team huddle", days: ["mon"] }]),
  "weekly-training-defaults": JSON.stringify([{ id: "tr1", title: "Squat", days: ["tue"] }]),
  "daily-checkins": JSON.stringify({ "2026-08-29": { date: "2026-08-29", oneThing: "Finish the rota" } }),
  "monthly-plan-2026-08": JSON.stringify({ ym: "2026-08", focus: [{ id: "f1", title: "Fix churn" }] }),
};

async function loadHandler() {
  // The real file, with only its one import swapped for the fake store — so the routing,
  // the guards and the key names under test are exactly what ships.
  const src = fs.readFileSync(SRC, "utf8");
  assert.ok(/^import \{ getStore \} from "@netlify\/blobs";$/m.test(src),
    "the store import is the single line this test swaps");
  const state = { store: null };
  const patched = src.replace(/^import \{ getStore \} from "@netlify\/blobs";$/m,
    "const getStore = () => globalThis.__fakeStore;");
  const tmp = path.join(os.tmpdir(), "kpi-store-isolation-" + process.pid + ".mjs");
  fs.writeFileSync(tmp, patched);
  const mod = await import("file://" + tmp);
  fs.unlinkSync(tmp);
  return { handler: mod.default, state };
}

const GET = (h, qs) => h(new Request("https://x/.netlify/functions/kpi-store?" + qs));
const POST = (h, body) => h(new Request("https://x/.netlify/functions/kpi-store",
  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

let pass = 0;
const ok = (name) => { pass++; console.log("  ok " + name); };

(async () => {
  console.log("v122 store isolation:");
  const { handler } = await loadHandler();
  const store = fakeStore(SEED);
  globalThis.__fakeStore = store;
  const before = JSON.stringify([...store._m.entries()].sort());

  /* ---- 1. every finance route runs, and none of them touches a planning key ---- */
  await GET(handler, "finsettings=1");
  await GET(handler, "finrules=1");
  await GET(handler, "finmonths=1");
  await GET(handler, "fintxns=2026-08");
  await GET(handler, "finweek=2026-08-06");
  assert.strictEqual(JSON.stringify([...store._m.entries()].sort()), before,
    "no finance READ writes anything at all");
  ok("reading the finance routes writes nothing");

  await POST(handler, { finTxns: { ym: "2026-08", rows: [
    { id: "x", date: "2026-08-06", dir: "out", amount: 13, desc: "CARD PAYMENT TO CANVA", cat: "Software", hash: "h1" }] } });
  await POST(handler, { finSettings: { potTaxPct: 15, potInvestPct: 4 } });
  await POST(handler, { finRules: [{ match: "CANVA", cat: "Software", km: "Optional" }] });
  await POST(handler, { finWeek: { weekStart: "2026-08-06", moved: true, tax: 180, invest: 48 } });

  for (const k of Object.keys(SEED)) {
    assert.strictEqual(store._m.get(k), SEED[k], k + " is byte-identical after every finance write");
  }
  ok("every planning record survives the finance writes untouched");

  /* ---- 2. the finance writes landed, and only under finance-* ---- */
  const added = [...store._m.keys()].filter((k) => !(k in SEED));
  assert.deepStrictEqual(added.sort(),
    ["finance-rules", "finance-settings", "finance-txns-2026-08", "finance-week-2026-08-06"]);
  assert.ok(added.every((k) => k.startsWith("finance-")), "nothing was written outside the finance- namespace");
  ok("the finance writes land only under finance-*");

  /* ---- 3. the existing routes still behave exactly as before ---- */
  const weeks = await (await GET(handler, "")).json();
  assert.strictEqual(weeks.weeks[0].leads, 41, "GET / still returns the KPI weeks");
  const st = await (await GET(handler, "settings=1")).json();
  assert.strictEqual(st.settings.leadTarget, 50, "?settings=1 still returns the TARGETS, not finance settings");
  const pl = await (await GET(handler, "planning=2026-Q3")).json();
  assert.strictEqual(pl.planning.goals[0].title, "Open the second room");
  const wp = await (await GET(handler, "weeklyplan=2026-08-31")).json();
  assert.strictEqual(wp.plan.tasks[0].title, "Call the landlord");
  const mp = await (await GET(handler, "monthlyplan=2026-08")).json();
  assert.strictEqual(mp.plan.focus[0].title, "Fix churn");
  const ci = await (await GET(handler, "checkins=1")).json();
  assert.strictEqual(ci.checkins["2026-08-29"].oneThing, "Finish the rota");
  const rd = await (await GET(handler, "recurringdefaults=1")).json();
  assert.strictEqual(rd.defaults[0].title, "Team huddle");
  ok("every existing GET still resolves to its own handler");

  /* ---- 4. an existing POST is never swallowed by a finance guard ---- */
  await POST(handler, { settings: { leadTarget: 60, cpaTarget: 35 } });
  assert.strictEqual(JSON.parse(store._m.get("settings")).leadTarget, 60,
    "posting targets still writes the targets key");
  assert.ok(!("potTaxPct" in JSON.parse(store._m.get("settings"))),
    "and never leaks finance fields into it");
  await POST(handler, { planning: { year: 2026, quarter: "Q3", reviewNotes: { wentWell: "Full rooms" } } });
  const q = JSON.parse(store._m.get("planning-2026-Q3"));
  assert.strictEqual(q.goals[0].title, "Open the second room", "a partial planning save still merges, not replaces");
  assert.strictEqual(q.reviewNotes.wentWell, "Full rooms");
  ok("existing POSTs reach their own handlers, unchanged");

  /* ---- 5. the finance keys can never collide with a planning key ---- */
  const PLANNING_PREFIXES = ["weeks", "settings", "months", "planning-", "weekly-plan-",
    "weekly-recurring-defaults", "weekly-training-defaults", "daily-checkins",
    "location-defaults", "monthly-plan-", "qtt-"];
  for (const k of added) {
    for (const p of PLANNING_PREFIXES) {
      assert.ok(!(k === p || k.startsWith(p)), "finance key " + k + " must not sit under " + p);
    }
  }
  ok("no finance key can shadow a planning key");

  /* ---- 6. a finance route never fires on a planning-shaped request ---- */
  // The finance blocks sit ABOVE the older ones in the file; each has to be inert for
  // any request that is not its own, or an existing call would be answered by the wrong
  // handler. Driving every existing shape and getting the right answer (checks 3 and 4)
  // proves it, but assert the negative directly too.
  const fresh = fakeStore(SEED);
  globalThis.__fakeStore = fresh;
  await POST(handler, { weeklyPlan: { weekEnding: "2026-09-07", tasks: [] } });
  assert.ok([...fresh._m.keys()].every((k) => !k.startsWith("finance-")),
    "saving a weekly plan creates no finance keys");
  ok("a planning write never falls into a finance handler");

  console.log("v122 store isolation: " + pass + " checks passed");
})();
