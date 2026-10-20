// v223 — the team Slack, on the Daily Dashboard.
//
// Ash: "I want to add a section on my dashboard (probably at the top) that reads my
// Bodysculpt slack and basically gives me a summary on what I have missed, and more
// importantly, what I need to know and what I should take action on / step in — with drafts
// ready to post. I should basically be able to manage my team slack from here as the leader
// of the business, making sure I'm engaging with my team, especially their post-session
// updates. It has to fit nicely on to the page."
//
// What is pinned here:
//   1. THE READ. Every channel and DM he is in, a week of it, his own unread marker, the
//      threads; bots' DMs skipped; his own messages kept as the sample of how he writes.
//   2. THE SORT. Claude's answer is joined back to real messages — a ref that was not read
//      is dropped; every Post-Shift Checklist is listed even if Claude missed it; one he has
//      reacted to or replied under counts as answered.
//   3. THE GUARD. The site has no login, so a write names a conversation by its id in the
//      current brief and the function takes the channel and thread FROM THE BRIEF, never
//      from the request. Undo deletes only what this dashboard posted.
//   4. ISOLATION. Its own blob store; nothing in it names the KPI store.
//   5. THE PAGE. One funnel with a closed list of operations; the card sits second on the
//      page, under the day and above the week; the way back is on the row that went.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const DAILY = read("daily.html");
const js = DAILY.slice(DAILY.lastIndexOf("<script>") + 8, DAILY.lastIndexOf("</script>"));
const LIB = read("netlify/lib/slack.js");
const FEED = read("netlify/functions/slack-feed.js");
const BG = read("netlify/functions/slack-brief-background.js");

/* ---------- a fake world: blob store, Slack, Claude ---------- */
function fakeStore() {
  const m = new Map();
  return {
    _m: m,
    async get(k, o) { const v = m.get(k); if (v === undefined) return null; return o && o.type === "json" ? JSON.parse(v) : v; },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async set(k, v) { m.set(k, v); },
  };
}
const ME = "U05ASH";
const T = (minsAgo) => ((Date.now() - minsAgo * 60000) / 1000).toFixed(6);
function slackWorld() {
  const calls = [];
  const posted = [];
  const ts = {
    q: T(300), shift: T(600), shiftOld: T(2000), seen: T(2700), mine: T(5000), dm: T(100), old: T(60 * 24 * 10),
  };
  const history = {
    CGEN: [
      { type: "message", user: "UGRACE", ts: ts.q, text: "<@" + ME + "> Cal says he has been charged twice — can someone look?", reply_count: 1, latest_reply: T(290) },
      { type: "message", subtype: "bot_message", bot_profile: { name: "Workflow" }, ts: ts.shift,
        text: ":white_check_mark: Post-Shift Checklist\n*Gaz*  •  Mon 19 Oct, 21:00, Monday - Late\n> Zara put in her notice. Laura's back was sore." },
      { type: "message", subtype: "bot_message", bot_profile: { name: "Workflow" }, ts: ts.shiftOld,
        text: "Post-Shift Checklist\n*grace*  •  Sun 18 Oct, 09:00\n> All good", reactions: [{ name: "muscle", users: [ME], count: 1 }] },
      { type: "message", user: "UDAN", ts: ts.seen, text: "Plates are on order" },
      { type: "message", user: ME, ts: ts.mine, text: "Morning team, any progress on Halloween?" },
      { type: "message", subtype: "channel_join", user: "UDAN", ts: T(50), text: "joined" },
      { type: "message", user: ME, ts: ts.old, text: "Jesus we need new plates" },
    ],
    DGRACE: [{ type: "message", user: "UGRACE", ts: ts.dm, text: "Can I swap Thursday?" }],
    DBOT: [{ type: "message", user: "UBOT", ts: T(10), text: "Your weekly digest" }],
  };
  const world = {};
  const fetchStub = async (url, o) => {
    const u = new URL(url);
    const method = u.pathname.replace("/api/", "");
    const q = Object.fromEntries(u.searchParams.entries());
    const body = o && o.body ? JSON.parse(o.body) : null;
    calls.push({ method, q, body });
    const ok = (d) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => Object.assign({ ok: true }, d) });
    switch (method) {
      case "auth.test": return ok({ user_id: ME, team: "Bodysculpt", url: "https://bodysculpt.slack.com/" });
      case "users.list": return ok({ members: [
        { id: ME, profile: { real_name: "Ashley Owen", display_name: "" } },
        { id: "UGRACE", profile: { real_name: "Grace Terry", display_name: "" } },
        { id: "UDAN", profile: { real_name: "Dan Baker", display_name: "" } },
        { id: "UBOT", is_bot: true, profile: { real_name: "Digest" } },
      ] });
      case "users.conversations":
        if (world.noMpim && /mpim/.test(q.types)) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: false, error: "missing_scope", needed: "mpim:read" }) };
        return ok({ channels: [
        { id: "CGEN", name: "general", is_channel: true },
        { id: "DGRACE", is_im: true, user: "UGRACE" },
        { id: "DBOT", is_im: true, user: "UBOT" },
      ] });
      case "conversations.info": return ok({ channel: { last_read: q.channel === "CGEN" ? T(2500) : "0" } });
      case "conversations.history": return ok({ messages: (history[q.channel] || []).filter((m) => Number(m.ts) >= Number(q.oldest)) });
      case "conversations.replies": return ok({ messages: [
        { ts: q.ts, last_read: T(295) },
        { user: "UDAN", ts: T(290), text: "I'll look on shift" },
      ] });
      case "chat.postMessage": posted.push(body); return ok({ ts: "1700000000.000100" });
      case "chat.delete": return ok({});
      case "reactions.add": return ok({});
      case "reactions.remove": return ok({});
      default: throw new Error("unexpected Slack call " + method);
    }
  };
  return Object.assign(world, { calls, posted, ts, fetchStub });
}

let claudeAnswer = null;
let claudePrompt = "";
class FakeAnthropic {
  constructor() {
    this.messages = {
      stream: (p) => ({ finalMessage: async () => { claudePrompt = p.messages[0].content; return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(claudeAnswer) }] }; } }),
      create: async (p) => { claudePrompt = p.messages[0].content; return { stop_reason: "end_turn", content: [{ type: "text", text: "Thanks Gaz, great shift." }] }; },
    };
  }
}

async function loadModules() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v223-"));
  fs.mkdirSync(path.join(dir, "lib")); fs.mkdirSync(path.join(dir, "functions"));
  fs.writeFileSync(path.join(dir, "lib", "slack.mjs"), LIB
    .replace('import { getStore } from "@netlify/blobs";', "const getStore = (o) => { globalThis.__storeName = o.name; return globalThis.__fakeStore; };")
    .replace('import Anthropic from "@anthropic-ai/sdk";', "const Anthropic = globalThis.__FakeAnthropic;"));
  fs.writeFileSync(path.join(dir, "functions", "slack-feed.mjs"), FEED.replace('from "../lib/slack.js"', 'from "../lib/slack.mjs"'));
  const lib = await import("file://" + path.join(dir, "lib", "slack.mjs"));
  const feed = (await import("file://" + path.join(dir, "functions", "slack-feed.mjs"))).default;
  return { lib, feed };
}

(async () => {
  process.env.SLACK_USER_TOKEN = "xoxp-test";
  process.env.ANTHROPIC_API_KEY = "sk-test";
  globalThis.__fakeStore = fakeStore();
  globalThis.__FakeAnthropic = FakeAnthropic;
  const world = slackWorld();
  globalThis.fetch = world.fetchStub;
  const { lib, feed } = await loadModules();

  /* ================= 1. the read ================= */
  const data = await lib.readSlack(Date.now() / 1000);
  const refs = data.roots.map((r) => r.ref);
  assert.ok(refs.includes("CGEN:" + world.ts.q) && refs.includes("DGRACE:" + world.ts.dm), "the channel and the DM are read");
  assert.ok(!refs.some((r) => r.startsWith("DBOT:")), "a bot's DM is never something to answer");
  assert.ok(!data.roots.some((r) => /joined/.test(r.text)), "joins and topic changes are not conversations");
  assert.ok(!refs.includes("CGEN:" + world.ts.old), "ten days back is outside the week");
  assert.ok(data.voice.some((v) => /new plates/.test(v.text)) && data.voice.some((v) => /Halloween/.test(v.text)),
    "…but his own older words are kept, to write like him");
  const q = data.roots.find((r) => r.ref === "CGEN:" + world.ts.q);
  assert.ok(/@Ashley Owen Cal says/.test(q.text), "a mention reads as a name, not an id");
  assert.ok(q.unread, "newer than his read marker = unread");
  assert.ok(!data.roots.find((r) => r.ref === "CGEN:" + world.ts.seen).unread, "older than his read marker = read");
  assert.ok(data.roots.find((r) => r.ref === "DGRACE:" + world.ts.dm).unread, "no read marker from Slack counts as unread");
  assert.strictEqual(q.replies.length, 1, "the thread under it is read");
  const shift = data.roots.find((r) => r.ref === "CGEN:" + world.ts.shift);
  assert.ok(shift.shift && !data.roots.find((r) => r.ref === "CGEN:" + world.ts.mine).shift, "a Post-Shift Checklist is recognised, and only that");
  assert.strictEqual(shift.link, "https://bodysculpt.slack.com/archives/CGEN/p" + world.ts.shift.replace(".", ""), "Open in Slack goes to the message itself");

  // the first live token had every scope but mpim:read — the read carries on without group DMs
  world.noMpim = true;
  const noM = await lib.readWorkspace();
  assert.ok(noM.channels.some((c) => c.id === "CGEN") && noM.channels.some((c) => c.id === "DGRACE"),
    "a token without mpim:read still reads every channel and DM");
  assert.ok(world.calls.some((c) => c.method === "users.conversations" && !/mpim/.test(c.q.types)), "…by asking again without group DMs");
  world.noMpim = false;

  /* ================= 2. the sort ================= */
  claudeAnswer = {
    summary: "Grace flagged a double charge.",
    know: [{ text: "Zara has handed in her notice.", ref: "CGEN:" + world.ts.shift }, { text: "made up", ref: "CGEN:999.000" }],
    actions: [
      { ref: "CGEN:" + world.ts.q, kind: "reply", urgency: "now", title: "Answer Grace about Cal", why: "Money taken wrongly.", draft: "Thanks @Grace, @Dan I'll ring Cal today." },
      { ref: "CNOPE:1.0", kind: "reply", urgency: "now", title: "invented", why: "", draft: "" },
      { ref: "CGEN:" + world.ts.shift, kind: "reply", urgency: "today", title: "a checklist sneaking in as an action", why: "", draft: "" },
      { ref: "DGRACE:" + world.ts.dm, kind: "decide", urgency: "this_week", title: "Grace wants to swap Thursday", why: "Needs your yes.", draft: "Yes that's fine" },
      { ref: "CGEN:" + world.ts.mine, kind: "decide", urgency: "now", title: "reply to his own message", why: "", draft: "Right, this is on me" },
    ],
    sessions: [],
  };
  const brief = await lib.buildBrief(Date.now());
  // v224: only unread. Dan's message he has read in Slack never reaches Claude or the card.
  assert.ok(!claudePrompt.includes("Plates are on order"), "v224: a message he has read is not put in front of Claude");
  assert.ok(/HOW ASHLEY OWEN WRITES[\s\S]*Halloween/.test(claudePrompt), "Claude is shown how he writes");
  assert.ok(claudePrompt.includes("ref CGEN:" + world.ts.q), "…and every conversation with its ref");
  assert.deepStrictEqual(brief.actions.map((a) => a.id), ["CGEN:" + world.ts.q, "DGRACE:" + world.ts.dm],
    "an invented ref is dropped, a checklist is never an action, his own message is never answered, and the list runs most urgent first");
  assert.ok(/leave it for him in square brackets/.test(claudePrompt), "a draft leaves his decisions to him");
  assert.strictEqual(brief.know.length, 1, "a fact pointing at nothing that was read is dropped");
  assert.strictEqual(brief.sessions.length, 2, "EVERY checklist is listed, even with Claude silent about them");
  assert.strictEqual(brief.sessions[0].coach, "Gaz", "…the coach is read off the checklist itself");
  assert.ok(!brief.sessions[0].acknowledged && brief.sessions[1].acknowledged, "a checklist he has reacted to counts as answered");
  assert.ok(brief.voice && brief.people.some((p) => p.first === "Dan"), "the voice sample and the names are kept for posting");
  await globalThis.__fakeStore.setJSON(lib.BRIEF_KEY, brief);

  /* ================= 3. the guard ================= */
  const call = async (method, body) => {
    const res = await feed(new Request("https://x.test/.netlify/functions/slack-feed", method === "GET" ? {} : { method: "POST", body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  let r = await call("GET");
  assert.ok(r.body.ready.slack && r.body.ready.claude && r.body.brief.actions.length === 2, "GET hands the page the brief");
  assert.ok(!("voice" in r.body.brief), "…without his voice sample, which only the server needs");

  const before = world.posted.length;
  r = await call("POST", { op: "send", id: "CEVIL:1.0", text: "hello", channel: "CEVIL" });
  assert.strictEqual(r.status, 404, "a conversation not on the card cannot be posted to");
  assert.strictEqual(world.posted.length, before, "…and Slack is never asked");

  r = await call("POST", { op: "send", id: "CGEN:" + world.ts.q, text: "Thanks @Grace, @Dan <b>I'll</b> ring Cal", channel: "CEVIL", thread_ts: "9" });
  assert.ok(r.body.ok, "a reply on the card posts");
  const sent = world.posted[world.posted.length - 1];
  assert.strictEqual(sent.channel, "CGEN", "…into the card's channel, whatever the request said");
  assert.strictEqual(sent.thread_ts, world.ts.q, "…in the thread it answers");
  assert.strictEqual(sent.text, "Thanks <@UGRACE>, <@UDAN> &lt;b&gt;I'll&lt;/b&gt; ring Cal", "@Name becomes a real mention; Slack markup is escaped");

  r = await call("POST", { op: "send", id: "DGRACE:" + world.ts.dm, text: "Yes" });
  assert.ok(!("thread_ts" in world.posted[world.posted.length - 1]), "a DM is answered in the DM, not in a thread");

  r = await call("GET");
  assert.deepStrictEqual(r.body.brief.actions, [], "what he answered leaves the card");
  assert.strictEqual(r.body.brief.undoable.length, 2, "…and can still be taken back");

  r = await call("POST", { op: "undo", id: "CGEN:" + world.ts.q });
  const del = world.calls.filter((c) => c.method === "chat.delete");
  assert.ok(r.body.ok && del.length === 1 && del[0].body.ts === "1700000000.000100" && del[0].body.channel === "CGEN",
    "undo deletes exactly the message the dashboard posted");
  r = await call("POST", { op: "undo", id: "CGEN:" + world.ts.q });
  assert.strictEqual(r.status, 404, "…once");
  assert.strictEqual(world.calls.filter((c) => c.method === "chat.delete").length, 1, "…and never anything else");
  r = await call("GET");
  assert.ok(r.body.brief.actions.some((a) => a.id === "CGEN:" + world.ts.q), "undone = back on the card");

  r = await call("POST", { op: "react", id: "CGEN:" + world.ts.shift });
  const re = world.calls.filter((c) => c.method === "reactions.add").pop();
  assert.ok(r.body.ok && re.body.channel === "CGEN" && re.body.timestamp === world.ts.shift && re.body.name === "muscle", "Just react adds a :muscle: to that checklist");
  r = await call("GET");
  assert.ok(r.body.brief.sessions.find((s) => s.id === "CGEN:" + world.ts.shift).acknowledged, "…and it moves to answered");

  r = await call("POST", { op: "done", id: "DGRACE:" + world.ts.dm });
  assert.ok(r.body.ok);
  r = await call("POST", { op: "restore", id: "DGRACE:" + world.ts.dm });
  r = await call("GET");
  assert.ok(r.body.brief.actions.some((a) => a.id === "DGRACE:" + world.ts.dm), "No reply needed can be undone");

  r = await call("POST", { op: "draft", id: "CGEN:" + world.ts.shift, ask: "shorter" });
  assert.ok(r.body.ok && r.body.text && /What he wants: shorter/.test(claudePrompt) && /Morning team/.test(claudePrompt),
    "Write it with Claude rewrites from the thread, the ask, and his voice");

  // the prompt leaves out what he has dealt with
  await lib.patchState((st) => { st.handled["CGEN:" + world.ts.q] = { at: Date.now(), how: "done" }; return st; });
  lib.briefPrompt(data, await lib.readState(), Date.now()).includes("ref CGEN:" + world.ts.q) &&
    assert.fail("a conversation he marked dealt with is not put in front of Claude again");

  /* ================= v224: "I'm caught up" ================= */
  // the brief in the store still holds everything; the line empties the card at once
  r = await call("POST", { op: "restore", id: "CGEN:" + world.ts.q });
  r = await call("GET");
  assert.ok(r.body.brief.actions.length && r.body.brief.sessions.length && r.body.brief.summary, "before: the card has rows");
  r = await call("POST", { op: "caughtup" });
  assert.ok(r.body.ok && r.body.caughtUpAt > 0, "I'm caught up draws the line at now");
  r = await call("GET");
  assert.deepStrictEqual([r.body.brief.actions.length, r.body.brief.sessions.length, r.body.brief.know.length, r.body.brief.summary],
    [0, 0, 0, ""], "…and the card empties straight away, summary and all");
  r = await call("POST", { op: "caughtup", undo: true });
  r = await call("GET");
  assert.ok(r.body.brief.actions.length && r.body.brief.sessions.length, "Undo puts everything back");
  r = await call("POST", { op: "caughtup" });
  const quiet = await lib.buildBrief(Date.now() + 1000);
  assert.deepStrictEqual([quiet.actions.length, quiet.sessions.length], [0, 0], "the next read finds nothing new");
  claudePrompt = "";
  await lib.buildBrief(Date.now() + 2000);
  assert.strictEqual(claudePrompt, "", "…and nothing new costs nothing — Claude is not asked");
  // something said after the line comes through
  const later = lib.onlyUnread([{ unread: true, last: Date.now() + 60000 }, { unread: true, last: 1 }, { unread: false, last: Date.now() + 60000 }], Date.now());
  assert.strictEqual(later.length, 1, "only what is unread AND new since the line");
  assert.ok(/id="slCaughtUp"/.test(js) && /id="slCaughtUndo">Undo</.test(js), "the button, with its Undo on the card");
  assert.ok(/Nothing unread in Slack/.test(js), "an empty card says so plainly");

  /* ================= 4. isolation ================= */
  assert.strictEqual(globalThis.__storeName, "bodysculpt-slack", "its own blob store");
  for (const [name, src] of [["lib", LIB], ["feed", FEED], ["background", BG]]) {
    assert.ok(!/bodysculpt-kpi|kpi-store/.test(src), name + " never names the KPI store");
  }
  assert.ok(/\[functions\."slack-brief-scheduled"\]\s*\n\s*schedule = "0 6,14 \* \* \*"/.test(read("netlify.toml")), "read before the day starts, and after the morning shift");

  /* ================= 5. the page ================= */
  const slackFetches = js.match(/fetch\(SLACK_FEED/g) || [];
  assert.strictEqual(slackFetches.length, 1, "one funnel posts to the Slack card's function");
  assert.ok(/const SL_OPS = \["refresh", "send", "react", "undo", "done", "restore", "draft", "caughtup"\];/.test(js), "…with a closed list of operations");
  assert.ok(/if \(!SL_OPS\.includes\(op\)\) throw/.test(js), "…checked before anything is sent");
  for (const m of js.matchAll(/slPost\("([a-z]+)"/g)) assert.ok(/refresh|send|react|undo|done|restore|draft|caughtup/.test(m[1]), "every call names a listed operation: " + m[1]);
  assert.ok(!/xoxp|SLACK_USER_TOKEN/.test(js.replace(/<code>SLACK_USER_TOKEN<\/code>/g, "")), "the token never comes near the page");

  const iTop = DAILY.indexOf('<div class="day-top">'), iSl = DAILY.indexOf('id="slCard"'), iCal = DAILY.indexOf('id="calCard"');
  assert.ok(iTop > 0 && iTop < iSl && iSl < iCal, "the card sits second: under the day, above the week");
  assert.ok(/\.sl-card\{margin:0 0 var\(--sp-4\);padding:18px 20px 20px;\}/.test(DAILY) && /\.cal-card\{margin:0 0 var\(--sp-4\);padding:18px 20px 20px;\}/.test(DAILY),
    "…with exactly the week card's spacing, so the column lines up");
  assert.ok(/@media\(max-width:1020px\)\{ \.sl-grid\{grid-template-columns:1fr;/.test(DAILY), "two columns on a wide screen, one on a phone — the same break as the page's grid");
  assert.ok(/class="mail sl-row/.test(js), "a row is the email card's row, so the two lists read alike");
  assert.ok(/function slGoneHtml[\s\S]*?undobtn[\s\S]*?Undo/.test(js) && /const SL_UNDO_MS = 20000;/.test(js),
    "the Undo is on the row that just went, for twenty seconds");
  assert.ok(/<symbol id="ic-chat"/.test(DAILY), "the card's icon is in the sprite");
  assert.ok(/slackLoad\(\{ quiet: !!slBrief \}\);/.test(js), "the dashboard's load reads the card without waiting on it");
  assert.ok(fs.existsSync(path.join(ROOT, "SLACK-SETUP.md")), "the setup steps the card links to exist");

  console.log("v223-team-slack.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
