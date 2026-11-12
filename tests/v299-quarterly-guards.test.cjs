// v299: the quarterly review is the record that must never be lost. These are the audit's
// routes to losing or misfiling it, each reproduced before the fix and pinned shut here.
const assert = require("assert");
const { boot, sleep } = require("./lib/quarterly-env.cjs");
const q = (quarter, extra) => Object.assign({ year: 2026, quarter, goals: [{ title: "ROCK-A" }, { title: "ROCK-B" }],
  reviewNotes: { wentWell: "WENT-WELL", slipped: "", numbersShowed: "", needsAttention: "" },
  issues: [{ title: "I1" }, { title: "I2" }, { title: "I3" }], opportunities: [], nextQuarterGoals: [], priorities: [],
  decisionSummary: { quarterTruth: "TRUTH", committedRocks: "COMMITTED" }, lastUpdated: "2026-07-05T10:00:00.000Z" }, extra);

(async () => {
  // 1. a save made while viewing another year is filed under THAT year
  {
    const h = await boot({ blobs: { "planning-2026-Q2": q("Q2") } });
    await h.ev("changeYear(1)"); await h.ev("selectQuarter(1)");
    assert.strictEqual(h.ev("planTag"), "2027-Q2");
    h.ev("planData.goals=[{title:'2027 ROCK'}]");
    await h.ev("savePlanningSection({goals: planData.goals}, null, null)");
    assert.deepStrictEqual(h.blobs["planning-2026-Q2"].goals.map((g) => g.title), ["ROCK-A", "ROCK-B"], "2026-Q2 is untouched");
    assert.strictEqual(h.blobs["planning-2027-Q2"].goals[0].title, "2027 ROCK", "the save landed in 2027-Q2");
  }
  // 2. in January, a save on last year's Q4 stays in last year's Q4
  {
    const h = await boot({ now: "2027-01-10T10:00:00Z", blobs: {} });
    await h.ev("changeYear(-1)"); await h.ev("selectQuarter(3)");
    h.ev("planData.reviewNotes={wentWell:'Q4 2026 REVIEW TEXT'}");
    await h.ev("savePlanningSection({reviewNotes: planData.reviewNotes}, null, null)");
    assert.strictEqual(h.blobs["planning-2026-Q4"].reviewNotes.wentWell, "Q4 2026 REVIEW TEXT");
    assert.ok(!h.blobs["planning-2027-Q4"], "nothing was filed under 2027");
  }
  // 3. a review that fails to load: an error, and no Save can store a blank over it
  {
    const h = await boot({ blobs: { "planning-2026-Q3": q("Q3") } });
    h.failGet.push({ re: /\?planning=2026-Q3/, times: 1 });
    await h.ev("selectQuarter(2)");
    assert.ok(/didn't load/.test(h.els.get("planPanels").innerHTML), "the page says the quarter did not load");
    h.posts.length = 0;
    await h.ev("savePlanningSection({goals: [], issues: [], reviewNotes: {}}, null, null)");
    assert.strictEqual(h.posts.filter((p) => p.body.planning).length, 0, "nothing is saved from a quarter that did not load");
    assert.strictEqual(h.blobs["planning-2026-Q3"].issues.length, 3);
    await h.ev("selectQuarter(2)");
    assert.strictEqual(h.ev("planData.issues.length"), 3, "Try again loads the real quarter");
  }
  // 4. a stale page is refused by the store instead of overwriting newer work
  {
    const h = await boot({ blobs: { "planning-2026-Q3": q("Q3") } });
    await h.ev("selectQuarter(2)");
    h.blobs["planning-2026-Q3"] = q("Q3", { issues: [{ title: "I1" }, { title: "I2" }, { title: "I3" }, { title: "ADDED ELSEWHERE" }], lastUpdated: "2026-11-12T09:00:00.000Z" });
    h.posts.length = 0;
    await h.ev("savePlanningSection({issues: planData.issues}, null, null)");
    assert.strictEqual(h.posts.filter((p) => p.body.planning)[0].body.base, "2026-07-05T10:00:00.000Z", "a save carries the version the page loaded");
    assert.strictEqual(h.blobs["planning-2026-Q3"].issues.length, 4, "the newer list is not overwritten");
  }
  // 5. two quick quarter changes: the slower, older answer is dropped
  {
    const h = await boot({ blobs: { "planning-2026-Q2": q("Q2", { goals: [{ title: "Q2-ONLY" }] }), "planning-2026-Q3": q("Q3", { goals: [{ title: "Q3-ONLY" }] }) } });
    h.delayGet.push({ re: /\?planning=2026-Q3/, ms: 120 });
    const a = h.ev("selectQuarter(2)"); const b = h.ev("selectQuarter(1)");
    await Promise.all([a, b]); await sleep(160);
    assert.strictEqual(h.ev("planTag"), "2026-Q2");
    assert.strictEqual(h.ev("planLoadedTag"), "2026-Q2");
    assert.strictEqual(h.ev("planData.goals[0].title"), "Q2-ONLY", "Q2's data is under Q2's name");
  }
  // 6. the routing read: a failure throws rather than answering "empty"
  {
    const h = await boot({ blobs: { "planning-2026-Q3": q("Q3") } });
    h.failGet.push({ re: /\?planning=2026-Q3/, times: 5 });
    let threw = false;
    try { await h.ev("qapExistingTargetItems('2026-Q3','issues')"); } catch (e) { threw = true; }
    assert.ok(threw, "a failed read is an error, never an empty list to write back");
    h.failGet.length = 0;
    const list = await h.ev("qapExistingTargetItems('2026-Q3','issues')");
    assert.strictEqual(list.length, 3);
    assert.strictEqual(h.ev("qapBase['2026-Q3']"), "2026-07-05T10:00:00.000Z", "and the version read is kept for the write");
  }
  // 7. Save Progress with nothing unsaved sends nothing (it used to re-send all 15 answers)
  {
    const h = await boot({ blobs: { "qtt-2026-Q3": { tag: "2026-Q3", schema: 2, answers: { q1: { text: "A REAL ANSWER", updatedAt: "2026-10-01T00:00:00Z" } }, lastUpdated: "2026-10-01T00:00:00Z" } } });
    h.failGet.push({ re: /\?qtt=2026-Q3/, times: 1 });
    await h.ev("selectQuarter(2)"); await sleep(40);
    h.posts.length = 0;
    await h.ev("qttSaveAll()"); await sleep(40);
    assert.strictEqual(h.posts.filter((p) => p.body.qtt).length, 0, "no blanks are written after a failed load");
    assert.strictEqual(h.blobs["qtt-2026-Q3"].answers.q1.text, "A REAL ANSWER");
  }
  console.log("v299-quarterly-guards.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
