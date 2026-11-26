// v313: every new catch-up booking is posted once in #coaches, with what they want to talk about.
const assert = require("assert");
const path = require("path");
(async () => {
  const m = await import("file://" + path.join(__dirname, "..", "netlify", "lib", "catchup-slack.js"));
  const now = Date.parse("2026-11-26T12:00:00Z");
  const b = (o) => Object.assign({ id: "a", name: "Jodie Wane", who: "dan", date: "2026-12-07", time: "18:00", note: "Wedding in June", createdAt: "2026-11-26T11:58:00Z", status: "booked" }, o);
  const msg = m.message(b());
  assert.ok(msg.includes("Jodie Wane, Monday 7 December at 6pm, in the gym with Dan"));
  assert.ok(msg.includes("Wedding in June"));
  assert.ok(!msg.includes("Zoom link"));
  assert.ok(m.message(b({ who: "ash" })).includes("Ash has a GHL task to send the Zoom link"));
  const list = [b(), b({ id: "b", status: "cancelled" }), b({ id: "c", createdAt: "2026-11-20T10:00:00Z" }), b({ id: "d" })];
  assert.deepEqual(m.toPost(list, ["d"], now).map((x) => x.id), ["a"]);   // not cancelled, not old, not already posted
  assert.equal(m.COACHES_CHANNEL, "C06RM572THC");
  console.log("v313-catchup-slack: ok");
})().catch((e) => { console.error(e); process.exit(1); });
