// v312: the welcome card — GHL task + dashboard job, ticked together, with name, address and
// something personal from the coaches' Post-Shift Checklist posts.
const assert = require("assert");
const path = require("path");
(async () => {
  const m = await import("file://" + path.join(__dirname, "..", "netlify", "lib", "welcome-card.js"));
  // name and address
  assert.equal(m.fullName({ firstName: "JODIE", lastName: "wane" }), "Jodie Wane");
  assert.equal(m.fullName({ firstName: "mary-jane", lastName: "o'neil" }), "Mary-Jane O'Neil");
  assert.deepEqual(m.addressLines({ address1: " 4 Oak Road ", city: "Warrington", postalCode: "WA1 2AB" }), ["4 Oak Road", "Warrington", "WA1 2AB"]);

  // the checklist post, as Slack stores it
  const post = (ts, coach, lines) => ({ ts: String(ts), text: "Post-shift checklist from " + coach, blocks: [
    { type: "header", text: { type: "plain_text", text: "✅ Post-Shift Checklist" } },
    { type: "context", elements: [{ type: "mrkdwn", text: `*${coach}*  •  Tue 24 Nov at 21:56, Tuesday - Late` }] },
    ...lines.map((t) => ({ type: "section", text: { type: "mrkdwn", text: t } })) ] });
  const msgs = [
    post(1795000000, "Grace Terry", ["✅  *Any new trialists on their first week?*  Yes\n> Jodie Wane, loving it, her daughter's wedding is in June so she wants to feel strong"]),
    post(1795100000, "Dan", ["✅  *Any post-session updates on members?*  Yes\n> Jodie smashed her deadlift PB"]),
    post(1795200000, "Dan", ["✅  *Any post-session updates on members?*  Yes\n> Jodiex typo line and Sam was great"]),
    { ts: "1795300000", text: "lunch anyone? Jodie?" },   // not a checklist post
  ];
  const lines = m.checklistLines(msgs);
  assert.ok(lines.some((l) => l.coach === "Grace Terry" && /daughter's wedding/.test(l.text)), "coach and detail read from the blocks");
  const hits = m.mentionsOf(lines, "Jodie", "Wane");
  assert.equal(hits.length, 2, "whole-word first name only, checklist posts only");
  assert.ok(hits[0].full && /wedding/.test(hits[0].text), "full-name mentions first");
  assert.ok(!hits.some((h) => /^Any /.test(h.text)), "question lines are not mentions");
  assert.deepEqual(m.mentionsOf(lines, "", "Wane"), []);

  // what goes in both tasks
  const body = m.cardBody({ name: "Jodie Wane", address: ["4 Oak Road", "WA1 2AB"], personal: "Her daughter is getting married in June.", mentions: hits, link: "https://x/c1" });
  assert.ok(/Name: Jodie Wane/.test(body) && /Address: 4 Oak Road, WA1 2AB/.test(body) && /Something personal: Her daughter/.test(body));
  assert.ok(/From the coaches' shift notes:\n- Jodie Wane, loving it/.test(body) && /\(Grace Terry, 2026-/.test(body));
  const bare = m.cardBody({ name: "Sam", address: [], personal: "", mentions: [] });
  assert.ok(/Address: NOT ON GHL/.test(bare) && /Nothing in the coaches' shift notes yet/.test(bare), "says what's missing, never guesses");

  // the tick rule: either side ticked -> both ticked, then the pair is closed
  assert.equal(m.decide(false, false), "wait");
  assert.equal(m.decide(true, false), "complete-ghl");
  assert.equal(m.decide(false, true), "tick-dashboard");
  assert.equal(m.decide(true, true), "close");

  // the gate lets GHL in at this one address, and the function checks its own key
  const fs = require("fs");
  const gate = fs.readFileSync(path.join(__dirname, "..", "netlify", "edge-functions", "gate.js"), "utf8");
  assert.ok(gate.includes('path === "/.netlify/functions/welcome-card"'));
  const fn = fs.readFileSync(path.join(__dirname, "..", "netlify", "functions", "welcome-card.js"), "utf8");
  assert.ok(/WELCOME_CARD_SECRET/.test(fn) && /status: 404/.test(fn));
  const toml = fs.readFileSync(path.join(__dirname, "..", "netlify.toml"), "utf8");
  assert.ok(/\[functions\."welcome-card-sync"\]\s*\n\s*schedule = "\*\/5 \* \* \* \*"/.test(toml));
  console.log("v312 welcome card: ok");
})().catch((e) => { console.error(e); process.exit(1); });
