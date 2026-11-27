// v314: 1-year anniversary cards. Who is due and when, sessions in their year, couples, the task, ticks.
const assert = require("assert");
const path = require("path");
(async () => {
  const a = await import("file://" + path.join(__dirname, "..", "netlify", "lib", "anniversary-card.js"));
  assert.equal(a.anniversaryOf("2025-12-07"), "2026-12-07");
  assert.equal(a.anniversaryOf("2024-02-29"), "2025-03-01");
  const now = Date.parse("2026-11-27T10:00:00Z");
  const mem = (id, since, o) => Object.assign({ id, name: "P " + id, since, tid: id }, o);
  const members = [mem("a", "2025-12-11"), mem("b", "2025-12-12"), mem("c", "2025-11-05"), mem("d", "2025-10-27"),
    mem("e", "2025-12-01", { leaving: true }), mem("f", "2024-12-01"), mem("g", "2025-12-08")];
  // 14 days ahead (11 Dec in, 12 Dec not), up to 30 days late (5 Nov in, 27 Oct out), never anyone leaving, first year only
  assert.deepEqual(a.due(members, {}, now).map((x) => x.m.id), ["c", "g", "a"]);
  assert.deepEqual(a.due(members, { g: { date: "2026-12-08" } }, now).map((x) => x.m.id), ["c", "a"], "already has this year's card");
  // sessions in the first year only
  assert.equal(a.isoWeekStart("2026-W01"), "2025-12-29");
  assert.equal(a.yearSessions({ "2025-W48": 9, "2025-W50": 3, "2026-W10": 2, "2026-W50": 4 }, "2025-12-07", "2026-12-07"), 5);
  // couples
  assert.equal(a.partnerOf({ id: "1", name: "Matt Bacon", since: "2025-12-15" }, [{ id: "1", name: "Matt Bacon", since: "2025-12-15" }, { id: "2", name: "Helen Bacon", since: "2025-12-15" }]), "Helen Bacon");
  assert.equal(a.partnerOf({ id: "1", name: "Matt Bacon", since: "2025-12-15" }, [{ id: "3", name: "Sue Bacon", since: "2025-12-16" }]), "");
  // the task note
  const body = a.taskBody({ name: "Kerry Mercer", address: [], date: "2026-12-07", sessions: 146, card: "Happy one year, Kerry!", label: "Kerry, one year at Bodysculpt", partner: "", link: "L" });
  ["Name: Kerry Mercer", "Address: NOT ON GHL", "Monday 7 December", "Sessions in their first year: 146", "For the card:\nHappy one year, Kerry!", "For the bottle label: Kerry, one year at Bodysculpt"].forEach((x) => assert.ok(body.includes(x), x));
  // ticks: Sent in the tracker, or the member's own 1-year job
  assert.ok(a.trackerDone({ sent: { by: "Ash" } }, []));
  assert.ok(a.trackerDone({ email: "k@x", name: "Kerry Mercer" }, [{ email: "K@x", completed: ["anniversary"] }]));
  assert.ok(!a.trackerDone({ email: "k@x", name: "Kerry Mercer" }, [{ email: "k@x", completed: ["welcome_card"] }]));
  console.log("v314-anniversary: OK");
})().catch((e) => { console.error(e); process.exit(1); });
