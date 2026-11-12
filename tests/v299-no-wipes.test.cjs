// v299: the ways the audit of 12 Nov 2026 found a record could be wiped or misfiled by the
// app itself. Each assertion pins one of them shut.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const INDEX = read("index.html"), MONTHLY = read("monthly.html"), QUARTERLY = read("quarterly.html"), STORE = read("netlify/functions/kpi-store.js");

// 1. nothing can reset or bulk-seed the KPI weeks any more
assert.ok(!/searchParams\.get\("reset"\)/.test(STORE), "the ?reset=YES route is gone");
assert.ok(!/body\.seedAll/.test(STORE), "the seedAll route is gone");
assert.ok(!/body\.monthsBulk/.test(STORE), "the monthsBulk route is gone");
assert.ok(!/reset=YES/.test(INDEX) && !/seedAll/.test(INDEX), "the Weekly page never resets or seeds");
assert.ok(!/async reset\(\)|async seed\(\)/.test(INDEX), "Store.reset and Store.seed are gone");
assert.ok(!/const SEED_2026|function runSeed|get\("seed"\)/.test(MONTHLY), "Monthly's ?seed=YES is gone");

// 2. no handler in the store changes data on a GET
{
  const gets = STORE.split(/\n/).map((l, i) => [l, i]).filter(([l]) => /req\.method === "GET"/.test(l));
  for (const [, i] of gets) {
    const block = STORE.split(/\n/).slice(i, i + 12).join("\n").split(/\n\s*\}\n/)[0];
    assert.ok(!/store\.(set|delete)\(/.test(block) || /cache|Cache|agenda/.test(block), "a GET handler near line " + (i + 1) + " writes to the store");
  }
}

// 3. the server refuses a week whose date is not a real date
assert.ok(/week\.weekEnding must be a real date/.test(STORE));

// 4. Store.all: a bad row is skipped, a failed load is an error, and neither writes anything
(async () => {
  const src = INDEX.slice(INDEX.indexOf("const SEED=["), INDEX.indexOf("function kpiSourceNote"));
  const run = async (reply) => {
    const calls = [];
    const fetch = async (u, o) => { calls.push((o && o.method) || "GET " + u); return reply(); };
    const f = new Function("fetch", src + "; return Store.all().then(w => ({ w, DATA_SOURCE, KPI_BAD_ROWS }));");
    return { ...(await f(fetch)), calls };
  };
  const good = Array.from({ length: 8 }, (_, i) => ({ weekEnding: "2026-09-" + String(5 + i).padStart(2, "0"), leads: i }));
  let r = await run(async () => ({ ok: true, json: async () => ({ weeks: good.concat([{ weekEnding: "20226-11-07", leads: 3 }]) }) }));
  assert.strictEqual(r.w.length, 8, "the eight good weeks are kept");
  assert.strictEqual(r.KPI_BAD_ROWS, 1);
  assert.strictEqual(r.DATA_SOURCE, "live");
  assert.strictEqual(r.calls.length, 1, "one read and nothing else: no reset, no seed");

  r = await run(async () => ({ ok: true, json: async () => ({ weeks: good.slice(0, 2) }) }));
  assert.strictEqual(r.w.length, 2, "two real weeks are two real weeks, not a reason to reset");
  assert.strictEqual(r.calls.length, 1);

  r = await run(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  assert.strictEqual(r.DATA_SOURCE, "error", "a failed load is reported as a failed load");
  assert.strictEqual(r.calls.length, 1);

  r = await run(async () => { throw new Error("offline"); });
  assert.strictEqual(r.DATA_SOURCE, "error");

  r = await run(async () => ({ ok: true, json: async () => ({ weeks: [] }) }));
  assert.strictEqual(r.DATA_SOURCE, "sample", "an empty store shows the sample, labelled as sample");
  assert.strictEqual(r.calls.length, 1, "and still writes nothing");

  // an offline save answers false instead of throwing (the form used to stick on "Saving…")
  const f = new Function("fetch", src + "; return Promise.all([Store.save({weekEnding:'2026-11-07'}), Store.saveSettings({})]);");
  assert.deepStrictEqual(await f(async () => { throw new Error("offline"); }), [false, false]);
  assert.ok(/DATA_SOURCE==='error'\)\{ msg\.textContent='Your numbers did not load/.test(INDEX), "saving a week is refused after a failed load");

  // 5. Quarterly: a save is filed under the year of the quarter on screen
  assert.ok(/planning: Object\.assign\(\{ year: tagYearOf\(planTag\), quarter: planTag\.split\("-"\)\[1\] \}, patch\)/.test(QUARTERLY));
  assert.ok(!/planning: Object\.assign\(\{ year: YEAR\b/.test(QUARTERLY));
  const tagYearOf = new Function("selYear", "return " + /function tagYearOf\(tag\)\{[^\n]+\}/.exec(QUARTERLY)[0].replace("function tagYearOf", "function"))(2026);
  assert.strictEqual(tagYearOf("2027-Q2"), 2027);
  assert.strictEqual(tagYearOf("2025-Q4"), 2025);
  console.log("v299-no-wipes.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
