// v244 — replies and chases written from Ash's own skill.
//
// Ash, 2026-10-22: "The slop is the 'Write it with Claude' button. The morning drafts from the
// scheduled routine are good." And for the money card, his ladder: day 8 a friendly nudge,
// day 15 the same tone plus a heads-up about sessions going on hold, day 22 a Slack message
// for him to send to Gaz. Strict order — only once the previous one was actually SENT. Stops
// the moment they pay anything or reply. And over all of it: "NOTHING SENDS BY ITSELF."
//
// What this pins:
//   1. the skill copy on the server is Ash's skill, word for word
//   2. THE LADDER, run for real over every case he named
//   3. one member is one chase; a closed debt starts again at the 1st nudge
//   4. the chase prompts say what he said, and the card link lives in ONE constant
//   5. NOTHING SENDS: no send path exists in the new server code, the jobs are locked
//   6. the reply writer: skill as system prompt, whole thread, the morning run's skips
//   7. the page: the funnels, the [ASH: …] guard on Send, the stage chip, the Slack copy
//   8. the Stripe feed: 60 days on screen, 14 days to settle, "paid anything" reported
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = (f) => path.join(__dirname, "..", f);
const read = (f) => fs.readFileSync(root(f), "utf8");
const DAILY = read("daily.html");
const js = DAILY.slice(DAILY.lastIndexOf("<script>") + 8, DAILY.lastIndexOf("</script>"));
// a top-level function's source, by name
const fn = (name) => {
  const i = js.indexOf("function " + name + "(");
  assert.ok(i >= 0, "daily.html has " + name);
  let depth = 0, j = js.indexOf("{", i);
  for (; j < js.length; j++) { if (js[j] === "{") depth++; else if (js[j] === "}" && --depth === 0) break; }
  return js.slice(i, j + 1);
};

const DAY = 86400000;
const NOW = Date.parse("2026-10-22T09:00:00Z");
const ago = (d) => new Date(NOW - d * DAY).toISOString();

(async () => {
  const chase = await import("file://" + root("netlify/lib/chase.js"));
  const drafts = await import("file://" + root("netlify/lib/mail-drafts.js"));
  const gmail = await import("file://" + root("netlify/lib/gmail.js"));
  const { SKILL_TEXT } = await import("file://" + root("netlify/lib/email-skill.js"));

  /* ============ 1. the skill: one master, every copy the same ============
     v244.1, Ash: "One source of truth." netlify/lib/email-skill.js is the master;
     `npm run sync-skill` (scripts/sync-email-skill.mjs) writes it out. Every copy that exists
     on the machine running the tests must match it exactly. */
  {
    const { targets, MASTER } = await import("file://" + root("scripts/sync-email-skill.mjs"));
    const { SKILL_FRONTMATTER } = await import("file://" + root("netlify/lib/email-skill.js"));
    assert.strictEqual(MASTER, SKILL_FRONTMATTER + SKILL_TEXT, "a copy is the header plus the master text");
    assert.ok(/^---\nname: bodysculpt-email-replies\n/.test(SKILL_FRONTMATTER), "…with the skill's own name");
    const found = targets().filter((t) => fs.existsSync(t));
    for (const t of found) {
      assert.strictEqual(fs.readFileSync(t, "utf8"), MASTER,
        t + " has drifted from netlify/lib/email-skill.js — run `npm run sync-skill` (and upload the zip to claude.ai if it is a synced copy)");
    }
    if (!found.length) console.log("  (no copies of the skill on this machine — drift check skipped)");
    assert.ok(read("package.json").includes('"sync-skill": "node scripts/sync-email-skill.mjs"'), "one command: npm run sync-skill");
    const script = read("scripts/sync-email-skill.mjs");
    assert.ok(/if \(!fs\.existsSync\(t\)\)/.test(script) && /copyFileSync\(t, t \+ "\.bak"\)/.test(script),
      "the sync only overwrites copies that exist, and backs each one up first");

    // the v244.1 rules are in the master
    assert.ok(/£195/.test(SKILL_TEXT) && /skipthequeue/.test(SKILL_TEXT) && /Hands off/.test(SKILL_TEXT), "the facts and the hands-off list");
    assert.ok(!/Two to six short paragraphs/.test(SKILL_TEXT), "the old length rule is gone");
    for (const rule of [/Length: usually 2–5 sentences/, /Match them: a one-line casual email gets a short casual reply/,
      /Answer what they actually asked in the first line or two/, /Never promise anything Ash hasn't agreed to in the thread/,
      /At most one `\[ASH: …\]` placeholder per draft\. If more than one fact is missing, don't\s+draft: flag it NEEDS ASH/]) {
      assert.ok(rule.test(SKILL_TEXT), "the skill has: " + rule);
    }
    assert.ok(drafts.systemPrompt().startsWith(SKILL_TEXT), "the skill IS the reply writer's system prompt");
  }

  /* ============ 1b. the button: medium first, low if medium is too slow, never a timeout ============ */
  {
    const savedFetch = globalThis.fetch, savedKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-test";
    // a fake Claude: each effort answers after its own delay (or fails), and honours cancel
    const fakeClaude = (plan) => async (url, init) => {
      const effort = JSON.parse(init.body).output_config.effort;
      const p = plan[effort];
      await new Promise((res, rej) => {
        const t = setTimeout(res, p.ms);
        if (init.signal) init.signal.addEventListener("abort", () => { clearTimeout(t); const e = new Error("aborted"); e.name = "AbortError"; rej(e); });
      });
      if (p.fail) return new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), { status: 529, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "x", stop_reason: "end_turn",
        content: [{ type: "text", text: "Hi Karen — " + effort }], usage: { input_tokens: 1, output_tokens: 1 } }),
        { status: 200, headers: { "content-type": "application/json" } });
    };
    const d = { messages: [{ id: "m1", mine: false, fromName: "Karen", text: "Can I move Tuesday?", at: 0 }], replyTo: { name: "Karen", email: "k@x" } };
    const fast = { mode: "button", waitMs: 200, deadlineMs: 500 };
    try {
      globalThis.fetch = fakeClaude({ medium: { ms: 20 }, low: { ms: 10 } });
      let r = await drafts.writeReply(d, fast);
      assert.deepStrictEqual([r.effort, r.text], ["medium", "Hi Karen — medium"], "medium in time: medium is used, even though low was quicker");

      globalThis.fetch = fakeClaude({ medium: { ms: 5000 }, low: { ms: 50 } });
      r = await drafts.writeReply(d, fast);
      assert.deepStrictEqual([r.effort, r.text], ["low", "Hi Karen — low"], "medium too slow: the low draft comes back instead");

      globalThis.fetch = fakeClaude({ medium: { ms: 10, fail: true }, low: { ms: 80 } });
      r = await drafts.writeReply(d, fast);
      assert.strictEqual(r.effort, "low", "medium failing outright: low still answers");

      globalThis.fetch = fakeClaude({ medium: { ms: 5000 }, low: { ms: 5000 } });
      const t0 = Date.now();
      await assert.rejects(drafts.writeReply(d, fast), (e) => e.slow === true, "both too slow: a SLOW error, which the page retries quietly");
      assert.ok(Date.now() - t0 < 1500, "…and it gives up at the deadline, inside the function's wall");
    } finally {
      globalThis.fetch = savedFetch;
      if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey;
    }
    const lib = read("netlify/lib/mail-drafts.js");
    assert.ok(/const MEDIUM_WAIT_MS = 15000;/.test(lib) && /const BUTTON_DEADLINE_MS = 22500;/.test(lib), "15s for medium, everything over by 22.5s of the 26s wall");
    const ask = fn("mailAskClaude");
    assert.ok(/if \(!e \|\| !e\.slow\) throw e;/.test(ask) && (ask.match(/mailAi\("POST", \{ op: "write"/g) || []).length === 2,
      "the page tries once more by itself when Claude was slow");
    assert.ok(/err\.slow = !!data\.slow \|\| r\.status === 502 \|\| r\.status === 504;/.test(fn("mailAi")),
      "…including when the function itself ran out of time");
  }

  /* ============ 2. THE LADDER ============ */
  const { ladder, STAGES, FINAL_CONTACT } = chase;
  assert.deepStrictEqual(STAGES.map((s) => [s.id, s.day, s.label]),
    [["nudge1", 8, "1st nudge"], ["nudge2", 15, "2nd nudge"], ["final", 22, "final"]], "Ash's days and Ash's labels");
  assert.strictEqual(FINAL_CONTACT, "Gaz");

  const debt = (days, extra) => Object.assign({ key: "c:cus_1", name: "Jen Lawton", email: "jen@x.com", amount: 14310,
    kinds: ["subscription"], overdueFrom: ago(days), paidSince: null, handsOff: "" }, extra || {});
  const rec = (days, extra) => Object.assign({ overdueFrom: ago(days) }, extra || {});
  const n = (id, at) => ({ draftId: "r-" + id, messageId: "m-" + id, threadId: "t-" + id, subject: "s", to: "jen@x.com",
    preview: "Hi Jen", draftedAt: at || ago(1) });
  const sent = (d) => ({ sent: true, sentAt: ago(d), draftExists: false });
  const waiting = { sent: false, sentAt: "", draftExists: true };
  const deleted = { sent: false, sentAt: "", draftExists: false };

  let v = ladder(debt(5), rec(5), {}, NOW);
  assert.strictEqual(v.stage, "early"); assert.strictEqual(v.action, "none"); assert.strictEqual(v.tag, "", "nothing before day 8");

  v = ladder(debt(8), rec(8), {}, NOW);
  assert.strictEqual(v.stage, "nudge1"); assert.strictEqual(v.action, "write"); assert.strictEqual(v.tag, "1st nudge", "day 8: the 1st nudge");

  v = ladder(debt(9), rec(9, { nudge1: n(1) }), { nudge1: waiting }, NOW);
  assert.strictEqual(v.action, "draft-ready"); assert.strictEqual(v.messageId, "m-1", "a drafted nudge points at its Gmail draft");

  // STRICT ORDER: never sent, so day 30 is still the 1st nudge
  v = ladder(debt(30), rec(30, { nudge1: n(1) }), { nudge1: waiting }, NOW);
  assert.strictEqual(v.stage, "nudge1", "day 30, 1st nudge never sent: still the 1st nudge — never skip ahead");
  v = ladder(debt(30), rec(30), {}, NOW);
  assert.strictEqual(v.stage, "nudge1", "…and with no draft at all, the 1st nudge is what gets written");

  v = ladder(debt(10), rec(10, { nudge1: n(1) }), { nudge1: deleted }, NOW);
  assert.strictEqual(v.action, "draft-gone", "a draft Ash deleted is not put back by itself");

  v = ladder(debt(12), rec(12, { nudge1: n(1) }), { nudge1: sent(3) }, NOW);
  assert.strictEqual(v.action, "waiting"); assert.strictEqual(v.tag, "1st nudge sent", "sent, before day 15: waiting");

  v = ladder(debt(16), rec(16, { nudge1: n(1) }), { nudge1: sent(7) }, NOW);
  assert.strictEqual(v.stage, "nudge2"); assert.strictEqual(v.action, "write", "sent, day 15+: the 2nd nudge");

  v = ladder(debt(25), rec(25, { nudge1: n(1), nudge2: n(2) }), { nudge1: sent(15), nudge2: waiting }, NOW);
  assert.strictEqual(v.stage, "nudge2", "day 25, 2nd nudge not sent: still the 2nd nudge, not Gaz");

  v = ladder(debt(20), rec(20, { nudge1: n(1), nudge2: n(2) }), { nudge1: sent(11), nudge2: sent(4) }, NOW);
  assert.strictEqual(v.action, "waiting"); assert.strictEqual(v.tag, "2nd nudge sent");

  v = ladder(debt(22), rec(22, { nudge1: n(1), nudge2: n(2) }), { nudge1: sent(14), nudge2: sent(7) }, NOW);
  assert.strictEqual(v.stage, "final"); assert.strictEqual(v.action, "slack", "day 22: no third email — Slack, for Ash to send");
  assert.ok(/^Hey Gaz, can you get in touch with Jen Lawton directly/.test(v.slack), "…asking Gaz to contact them directly");
  assert.ok(/emailed them twice/.test(v.slack) && /jen@x\.com/.test(v.slack), "…saying what has been tried, and how to reach them");

  v = ladder(debt(24), rec(24, { nudge1: n(1), nudge2: n(2), final: { text: "edited", draftedAt: ago(2), sentAt: NOW - DAY } }),
    { nudge1: sent(15), nudge2: sent(8) }, NOW);
  assert.strictEqual(v.action, "done"); assert.strictEqual(v.slack, "edited");

  /* v244, Ash: "the day numbers are minimums, not fixed dates." Each later stage waits 7 days
     after the previous one was SENT, and never comes before its own day. */
  assert.strictEqual(chase.GAP_DAYS, 7);
  v = ladder(debt(15), rec(15, { nudge1: n(1) }), { nudge1: sent(1) }, NOW);
  assert.strictEqual(v.action, "waiting", "1st sent on day 14: nothing on day 15");
  assert.strictEqual(v.dueAt, new Date(NOW + 6 * DAY).toISOString(), "…the 2nd is due 7 days after the 1st went");
  assert.ok(/suggested from /.test(v.note), "…and the row says when");
  v = ladder(debt(20), rec(20, { nudge1: n(1) }), { nudge1: sent(6) }, NOW);
  assert.strictEqual(v.action, "waiting", "…still nothing on day 20");
  v = ladder(debt(21), rec(21, { nudge1: n(1) }), { nudge1: sent(7) }, NOW);
  assert.strictEqual(v.stage, "nudge2"); assert.strictEqual(v.action, "write", "…day 21: the 2nd nudge");
  v = ladder(debt(14), rec(14, { nudge1: n(1) }), { nudge1: sent(6) }, NOW);
  assert.strictEqual(v.action, "waiting", "1st sent day 8: never earlier than day 15, week gone or not");
  v = ladder(debt(15), rec(15, { nudge1: n(1) }), { nudge1: sent(7) }, NOW);
  assert.strictEqual(v.stage, "nudge2", "…day 15 it is");
  v = ladder(debt(25), rec(25, { nudge1: n(1), nudge2: n(2) }), { nudge1: sent(11), nudge2: sent(4) }, NOW);
  assert.strictEqual(v.action, "waiting", "2nd sent on day 21: no Gaz on day 25");
  assert.strictEqual(v.dueAt, new Date(NOW + 3 * DAY).toISOString(), "…Gaz is due 7 days after the 2nd went");
  v = ladder(debt(28), rec(28, { nudge1: n(1), nudge2: n(2) }), { nudge1: sent(14), nudge2: sent(7) }, NOW);
  assert.strictEqual(v.action, "slack", "…day 28: Gaz");
  v = ladder(debt(21), rec(21, { nudge1: n(1), nudge2: n(2) }), { nudge1: sent(13), nudge2: sent(7) }, NOW);
  assert.strictEqual(v.action, "waiting", "gap met on day 21, but Gaz never comes before day 22");

  // it stops: paid anything, or replied — whatever stage it had reached
  v = ladder(debt(30, { paidSince: { at: ago(1), amount: 2000 } }), rec(30, { nudge1: n(1) }), { nudge1: sent(20) }, NOW);
  assert.strictEqual(v.stage, "paid"); assert.strictEqual(v.action, "none"); assert.ok(/£20/.test(v.note), "paid anything: stopped, and says what");
  v = ladder(debt(18), rec(18, { nudge1: n(1) }), { replied: { at: ago(2), threadId: "t9" }, nudge1: sent(9) }, NOW);
  assert.strictEqual(v.stage, "replied"); assert.strictEqual(v.tag, "they've replied"); assert.strictEqual(v.action, "none");

  // hands-off and impossible
  v = ladder(debt(30, { handsOff: "open dispute" }), rec(30), {}, NOW);
  assert.strictEqual(v.tag, "NEEDS ASH"); assert.strictEqual(v.action, "none", "a dispute is never chased");
  v = ladder(debt(10, { email: "" }), rec(10), {}, NOW);
  assert.strictEqual(v.action, "none", "no email on Stripe: nothing to draft");

  /* ============ 3. one member, one chase; a new episode starts over ============ */
  {
    const money = {
      disputes: [{ id: "dp", email: "dave@x.com", name: "Dave Smith" }],
      pastDue: [{ id: "sub_1", kind: "subscription", customerId: "cus_1", name: "Jen Lawton", email: "jen@x.com", amount: 14310, overdueFrom: ago(9) }],
      failed: [
        { id: "ch_1", kind: "charge", customerId: "cus_1", name: "Jen Lawton", email: "jen@x.com", amount: 9900, overdueFrom: ago(20), paidSince: null },
        { id: "ch_2", kind: "charge", customerId: "", name: "Dave Smith", email: "dave@x.com", amount: 9900, overdueFrom: ago(12), paidSince: null },
      ],
    };
    const ds = chase.debtsFromMoney(money);
    assert.strictEqual(ds.length, 2, "Jen's two rows are one chase");
    const jen = ds.find((d) => d.key === "c:cus_1");
    assert.strictEqual(jen.overdueFrom, ago(20), "…dated from her earliest overdue row");
    assert.strictEqual(jen.amount, 14310 + 9900);
    assert.ok(ds.find((d) => d.key === "e:dave@x.com").handsOff, "anyone with an open dispute is hands-off");

    const fresh = chase.recordFor({ debts: { "c:cus_1": { overdueFrom: ago(90), nudge1: n(1), closedAt: ago(40) } } }, jen);
    assert.ok(!fresh.nudge1 && fresh.overdueFrom === ago(20), "a closed record is a past episode — falling behind again starts at the 1st nudge");
    const open = chase.recordFor({ debts: { "c:cus_1": { overdueFrom: ago(35), nudge1: n(1) } } }, jen);
    assert.strictEqual(open.overdueFrom, ago(35), "an open record keeps the EARLIEST date — a membership's period start moves on monthly");
  }

  /* ============ 4. what the chases say ============ */
  {
    const d = { key: "k", name: "jen lawton", email: "j@x", amount: 9900, kinds: ["charge"], overdueFrom: ago(9) };
    const p1 = chase.chasePrompt(d, { overdueFrom: ago(9) }, "nudge1");
    assert.ok(p1.includes(chase.CARD_UPDATE_URL), "the 1st nudge carries the card link");
    assert.ok(/it's Ash, just wanted to check in/.test(p1) && /Usually when this happens people have had a new card/.test(p1), "…and Ash's own gist");
    assert.ok(/do not copy it verbatim/.test(p1), "…as a gist, not a script");
    assert.ok(/first name: Jen\n/.test(p1), "first name, capitalised");
    assert.ok(/Do not quote the amount, threaten anything/.test(p1), "not a bank");
    const p2 = chase.chasePrompt(d, { overdueFrom: ago(16) }, "nudge2");
    assert.ok(/SAME friendly tone/.test(p2) && /'More direct' is not my voice/.test(p2), "the 2nd nudge is the same voice");
    assert.ok(/I'd hate to have to put your sessions on hold/.test(p2) && p2.includes(chase.CARD_UPDATE_URL), "…plus the heads-up and the link");

    assert.strictEqual(chase.CARD_UPDATE_URL, "https://bodysculpt.securechkout.com/update");
    const lib = read("netlify/lib/chase.js");
    assert.ok(/TODO\(GoHighLevel\)/.test(lib), "the link is marked for swapping to the GoHighLevel page");
    assert.strictEqual((lib.match(/securechkout\.com/g) || []).length, 1, "…and written in one place only");
  }

  /* ============ 5. NOTHING SENDS ============ */
  {
    const libs = ["netlify/lib/gmail.js", "netlify/lib/mail-drafts.js", "netlify/lib/chase.js",
      "netlify/functions/mail-ai.js", "netlify/functions/money-chase.js",
      "netlify/functions/mail-drafts-background.js", "netlify/functions/mail-drafts-scheduled.js"].map((f) => [f, read(f)]);
    for (const [f, src] of libs) {
      const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      assert.ok(!/messages\/send|drafts\/send|sendDraft|sendMessage/.test(code), f + " has no way to send an email");
      assert.ok(!/slack\.com|chat\.postMessage|lib\/slack\.js/.test(code), f + " has no way to post to Slack");
    }
    const g = read("netlify/lib/gmail.js").replace(/\/\/.*$/gm, "");
    assert.ok(!/method: "PUT"|method: "DELETE"|\/modify|\/trash/.test(g), "lib/gmail.js cannot change or delete a draft or a message");
    // two POSTs in the file: renewing the sign-in at Google's token address, and the draft
    const posts = [...g.matchAll(/(\S+)\(([^)]*?), \{ method: "POST"/g)].map((m) => m[2]);
    assert.ok(/fetch\(TOKEN_URL, \{\s*method: "POST"/.test(g), "one POST renews the sign-in, at Google's token address");
    assert.deepStrictEqual(posts, ['"drafts"'], "…and the only POST to Gmail itself is createDraft");

    const bg = read("netlify/functions/mail-drafts-background.js");
    assert.ok(/!secret \|\| req\.headers\.get\("x-mail-trigger"\) !== secret/.test(bg), "the morning run starts only for the holder of SYNC_TRIGGER_SECRET");
    for (const f of ["netlify/functions/mail-ai.js", "netlify/functions/money-chase.js"]) {
      assert.ok(/if \(!\(await deviceOk\(req\)\)\) return json\(/.test(read(f)), f + " answers only a connected browser — it reads Ash's mail");
    }
    const toml = read("netlify.toml");
    assert.ok(/\[functions\."mail-drafts-scheduled"\]\s*\n\s*schedule = "30 6 \* \* 1-5"/.test(toml), "weekday mornings");
  }

  /* ============ 6. the reply writer ============ */
  {
    assert.ok(/sonnet/.test(drafts.MODELS.classify) && /opus/.test(drafts.MODELS.write), "Sonnet sorts, Opus writes");
    const M = (id, mine, text, at) => ({ id, mine, fromName: mine ? "Ash" : "Karen", fromEmail: mine ? "a@b" : "k@x", text, at });
    const detail = { messages: [M("m1", false, "Can I move Tuesday?", Date.parse("2026-10-20T10:00:00Z")), M("m2", true, "Sure", 0),
      M("m3", false, "And what is the price after?", 0)], replyTo: { name: "Karen", email: "k@x" } };
    const pb = drafts.replyPrompt(detail, { mode: "button", brief: "say Gold", current: "" });
    assert.ok(/--- Karen, 2026-10-20 ---\nCan I move Tuesday\?/.test(pb) && /--- Ash \(me\)/.test(pb), "the whole thread, who said what");
    assert.ok(/What Ash wants this reply to say: say Gold/.test(pb) && /pressed the button himself/.test(pb), "the brief; and the button writes even a hands-off one — Ash chose to");
    assert.ok(/There is already a draft\. Rewrite it/.test(drafts.replyPrompt(detail, { mode: "button", current: "old" })), "a rewrite keeps what is right");
    assert.ok(/NEEDS ASH: /.test(drafts.replyPrompt(detail, { mode: "morning" })), "the morning run flags hands-off instead of drafting");
    const long = { messages: [M("a", false, "OLDEST " + "x".repeat(12000), 0), M("b", false, "NEWEST", 0)], replyTo: { name: "K" } };
    const pl = drafts.replyPrompt(long, {});
    assert.ok(pl.includes("NEWEST") && !pl.includes("OLDEST"), "a long thread is trimmed from the front");

    const t = drafts.triageStep;
    const base = { messages: [{ id: "m1" }], hasDraft: false, lastIsMine: false, replyTo: { email: "k@x" } };
    assert.strictEqual(t({ ...base, hasDraft: true }, null), "skip:has-draft", "a thread with a draft (the routine's, or Ash's) is never drafted again — no doubles");
    assert.strictEqual(t({ ...base, lastIsMine: true }, null), "skip:answered");
    assert.strictEqual(t(base, { lastMsgId: "m1" }), "known", "already sorted at this message: not redone");
    assert.strictEqual(t(base, { lastMsgId: "m0" }), "classify", "a new message is sorted again");

    const cp = drafts.classifyPrompt([{ ref: "1", from: "a", subject: "b", text: "c" }]);
    assert.ok(/hands_off/.test(cp) && /not_client/.test(cp) && /newsletters/.test(cp), "the sorter knows the four kinds");
    assert.deepStrictEqual(drafts.CLASSIFY_SCHEMA.properties.threads.items.properties.kind.enum, ["lead", "client", "hands_off", "not_client"]);

    // the message itself
    const dec = (r) => Buffer.from(r.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const fresh = dec(gmail.buildRaw({ toName: "Jen Lawton", toEmail: "jen@x.com", subject: "Quick check-in about your payment", text: "Hi Jen,\nAsh" }));
    assert.ok(/^To: Jen Lawton <jen@x\.com>\r\nSubject: Quick check-in about your payment\r\n/.test(fresh) && !/In-Reply-To/.test(fresh), "a 1st nudge is a fresh email");
    const reply = dec(gmail.buildRaw({ toEmail: "jen@x.com", subject: "Quick check-in", inReplyTo: "<a@b>", text: "x" }));
    assert.ok(/Subject: Re: Quick check-in/.test(reply) && /In-Reply-To: <a@b>/.test(reply), "a 2nd nudge is a reply on the same thread");
  }

  /* ============ 7. the page ============ */
  {
    assert.ok(/const MAIL_AI = "\/\.netlify\/functions\/mail-ai";/.test(js) && /const MONEY_CHASE = "\/\.netlify\/functions\/money-chase";/.test(js), "two fixed addresses");
    assert.strictEqual((js.match(/fetch\(MAIL_AI/g) || []).length, 1, "mail-ai has one funnel");
    assert.strictEqual((js.match(/fetch\(MONEY_CHASE/g) || []).length, 1, "money-chase has one funnel");
    assert.ok(/"X-Device-Key": gcalDevice/.test(fn("mailAi")) && /"X-Device-Key": gcalDevice/.test(fn("moneyChase")), "…both carry the device key");

    const send = fn("mailSend");
    assert.ok(/if \(\/\\\[ASH:\/i\.test\(text\)\) \{ mailNote\(threadId, "Not sent/.test(send), "Send refuses a reply with an [ASH: …] gap in it");
    assert.ok(send.indexOf("[ASH:") < send.indexOf("gmailSend("), "…before anything goes to Gmail");

    const flag = fn("mailFlagHtml");
    assert.ok(/hands_off/.test(flag) && /Needs Ash/.test(flag) && /not_client/.test(flag), "the row says NEEDS ASH or Not a client");
    assert.ok(/if \(!t \|\| hasDraft\) return "";/.test(flag), "…and nothing at all where there is a draft, or no sorting — the row is as it was");

    const row = fn("moneyRowHtml");
    assert.ok(/class="mstage s-'/.test(row) && /esc\(chase\.tag\)/.test(row), "the stage sits beside the member's name");
    assert.ok(/firstOfThem \? mchaseHtml\(chase\)/.test(row), "…the next step once per member");
    assert.ok(/<div class="mrow /.test(row) && /<a class="mrow-link"/.test(row), "the row is a box with the Stripe link inside — buttons cannot live in a link");

    const ch = fn("mchaseHtml");
    assert.ok(/draftUrl\(v\.messageId\)/.test(ch) && /Open the draft in Gmail/.test(ch), "an email chase opens in Gmail's drafts");
    assert.ok(/data-chase-copy/.test(ch) && /slack:\/\/open/.test(ch), "the Slack message is copied by Ash and sent from Slack");
    assert.ok(!/fetch\(/.test(ch) && !/fetch\(/.test(fn("wireMoneyCard")), "the card itself calls nothing but the funnel");
    assert.ok(/Undo \\u2014 not sent/.test(ch), "\"I've sent it to Gaz\" can be taken back where it was pressed");
    assert.ok(/loadMoneyChase\(\);/.test(fn("loadAll")), "the ladder loads after the card paints");
    assert.ok(/if \(!gcalDevice\) return;/.test(fn("loadMoneyChase")), "…and only for a connected browser");
  }

  /* ============ 8. the Stripe feed: wider window, same settling ============ */
  {
    const SRC = read("netlify/functions/stripe-feed.js");
    assert.ok(/const FAILED_WINDOW_DAYS = 60;/.test(SRC) && /const SETTLE_WINDOW_DAYS = 14;/.test(SRC), "60 days on screen, 14 to settle");
    const tmp = path.join(os.tmpdir(), "stripe-v244-" + process.pid + ".mjs");
    fs.writeFileSync(tmp, SRC);
    const mod = await import("file://" + tmp);
    fs.unlinkSync(tmp);
    const S = Math.floor(Date.now() / 1000), D = 86400;
    const cust = { id: "cus_j", email: "jen@x.com", name: "Jen Lawton" };
    const charges = [
      { id: "ch_f", status: "failed", amount: 14310, currency: "gbp", created: S - 40 * D, customer: cust, billing_details: {}, failure_message: "Your card has expired." },
      { id: "ch_p", status: "succeeded", amount: 14310, currency: "gbp", created: S - 10 * D, customer: cust, billing_details: {} },
    ];
    const saved = globalThis.fetch;
    globalThis.fetch = async (url) => ({ ok: true, status: 200,
      json: async () => ({ data: String(url).includes("/charges") ? charges : [], has_more: false }) });
    let out;
    try { out = await mod.readMoney("rk_test_x"); } finally { globalThis.fetch = saved; }
    assert.strictEqual(out.windowDays, 60);
    assert.strictEqual(out.failed.length, 1, "a 40-day-old failure is still on the card — the old 14-day window lost it");
    assert.strictEqual(out.failed[0].overdueFrom, new Date((S - 40 * D) * 1000).toISOString(), "…dated from its first failure");
    assert.ok(out.failed[0].paidSince && out.failed[0].paidSince.amount === 14310,
      "next month's payment is reported as 'paid since' (the chase stops) …");
    assert.ok(/paid something since, but nothing that settles this one/.test(out.failed[0].why),
      "… but does NOT clear last month's debt — over 60 days the same amount again is a billing cycle");
    assert.strictEqual(out.failed[0].customerId, "cus_j");
  }

  console.log("v244-replies-and-chases.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
