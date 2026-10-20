// Shared library: the team Slack, read and answered from the Daily Dashboard  (v223)
//
// WHAT THIS IS FOR. Ash leads the team in Slack — #general, #coaches, #onboarding and the
// rest — and the coaches file a Post-Shift Checklist into #general after every shift. He
// wanted one place on his dashboard that says: what did I miss, what do I need to know, what
// should I step in on — with the reply already written, ready to post. Especially the
// post-session updates: a coach who writes up their shift and hears nothing back stops
// writing them up.
//
// HOW IT WORKS.
//   1. READ. A Slack *user* token (SLACK_USER_TOKEN, xoxp-…) reads every channel and DM Ash
//      is a member of, three weeks back, plus the threads under anything recent. Ash's own
//      read marker in each channel (`last_read`) says what he has genuinely not seen.
//   2. SORT. One Claude call (structured output, so the answer is always the same shape)
//      turns it into: a short summary of what was missed, the facts worth knowing, the
//      things to step in on — each with a reply drafted in Ash's voice, learned from his own
//      messages in the same read — and every Post-Shift Checklist with an acknowledgement.
//   3. KEEP. The result is written to its own blob store, `bodysculpt-slack`. Nothing here
//      can reach the KPI / weekly / monthly / quarterly data: different store, different
//      function, nothing shared.
//   4. ANSWER. Ash presses Send on the dashboard and the reply is posted AS HIM, in the
//      thread it answers. It can be taken back for ten minutes (chat.delete), and only a
//      message this dashboard posted can be taken back.
//
// WHAT IT WILL NOT DO: post anywhere Ash is not a member, delete anything it did not post,
// or post on its own. Every message that goes is one Ash pressed Send on.
import { getStore } from "@netlify/blobs";
import Anthropic from "@anthropic-ai/sdk";

const SLACK = "https://slack.com/api/";
export const STORE = "bodysculpt-slack";
const store = () => getStore({ name: STORE, consistency: "strong" });

export const BRIEF_KEY = "slack-brief";
export const STATE_KEY = "slack-state";

const DAY = 86400;
export const LOOK_BACK_DAYS = 7;      // what can still need him
const VOICE_DAYS = 21;                // how far back his own messages are read to learn his voice
const MAX_THREADS = 60;               // threads opened per build — plenty for a gym's week
export const UNDO_SECONDS = 600;      // how long a sent message can be taken back
const BUILD_STALE_MS = 6 * 60 * 1000; // a build "in progress" this old has died

export const env = (k) => String(process.env[k] || "").trim();
export const clip = (s, n) => String(s == null ? "" : s).slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- the Slack Web API ---------------- */

export async function slack(method, params, post) {
  const token = env("SLACK_USER_TOKEN");
  if (!token) throw new Error("SLACK_USER_TOKEN is not set.");
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    if (post) {
      res = await fetch(SLACK + method, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(params || {}),
      });
    } else {
      const qs = new URLSearchParams();
      Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== "") qs.set(k, String(v)); });
      res = await fetch(SLACK + method + "?" + qs.toString(), { headers: { Authorization: "Bearer " + token } });
    }
    // Slack's rate limit answers 429 with how long to wait. A gym's workspace should never
    // see it, but a build that died on the first busy second would be a poor morning.
    if (res.status === 429) {
      const wait = Math.min(20, Number(res.headers.get("retry-after")) || 2);
      await sleep(wait * 1000);
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      const err = new Error(slackErrorText(data.error, data.needed) );
      err.slackError = data.error || "http_" + res.status;
      throw err;
    }
    return data;
  }
  throw new Error("Slack kept saying it was busy. Try again in a minute.");
}

// Slack's error codes are terse. The ones Ash could actually meet, in words.
function slackErrorText(code, needed) {
  const map = {
    invalid_auth: "Slack did not accept the token. It may have been revoked — make a new one (SLACK-SETUP.md).",
    not_authed: "SLACK_USER_TOKEN is not set.",
    token_revoked: "The Slack token was revoked. Make a new one (SLACK-SETUP.md).",
    account_inactive: "The Slack account behind the token is no longer active.",
    missing_scope: "The Slack app is missing a permission" + (needed ? " (" + needed + ")" : "") + ". Add it in the app's OAuth & Permissions page, reinstall, and paste the new token.",
    channel_not_found: "Slack could not find that channel.",
    not_in_channel: "You are not a member of that channel.",
    is_archived: "That channel has been archived.",
    msg_too_long: "That message is too long for Slack.",
    message_not_found: "Slack could not find that message — it may already have been deleted.",
    cant_delete_message: "Slack will not let this message be deleted.",
    already_reacted: "Already reacted.",
  };
  return map[code] || ("Slack said: " + (code || "unknown error"));
}

/* ---------------- the store ---------------- */

export async function readJSON(key, fallback) {
  try {
    const v = await store().get(key, { type: "json" });
    return v == null ? fallback : v;
  } catch { return fallback; }
}
export async function writeJSON(key, value) { await store().setJSON(key, value); }

/* State is the part Ash changes by hand: what he has dealt with, and what the dashboard has
   posted for him. It is read-modify-written against a FRESH read every time, so a build
   running in the background can never put back a row he has just cleared. */
export function emptyState() { return { handled: {}, sent: [] }; }
export async function readState() {
  const s = await readJSON(STATE_KEY, null);
  const st = s && typeof s === "object" ? s : emptyState();
  if (!st.handled || typeof st.handled !== "object") st.handled = {};
  if (!Array.isArray(st.sent)) st.sent = [];
  return st;
}
export async function patchState(fn) {
  const st = await readState();
  const next = fn(st) || st;
  // a month of "dealt with" is more than enough memory; older keys can never come back
  // into a seven-day read anyway
  const cutoff = Date.now() - 30 * DAY * 1000;
  Object.keys(next.handled).forEach((k) => { if ((next.handled[k] && next.handled[k].at || 0) < cutoff) delete next.handled[k]; });
  next.sent = next.sent.filter((s) => (s.at || 0) > cutoff).slice(-200);
  await writeJSON(STATE_KEY, next);
  return next;
}

export async function readBrief() { return readJSON(BRIEF_KEY, null); }

/* A build announces itself before it starts, so two presses of Refresh (or Refresh at the
   moment the morning job runs) start one build, not two. */
export async function claimBuild(trigger) {
  const cur = (await readBrief()) || {};
  if (cur.building && Date.now() - (cur.buildingSince || 0) < BUILD_STALE_MS) return false;
  await writeJSON(BRIEF_KEY, { ...cur, building: true, buildingSince: Date.now(), buildTrigger: trigger || "", buildError: "" });
  return true;
}

/* ---------------- reading Slack ---------------- */

// Turns Slack's markup into words: <@U123> → @Name, <#C1|general> → #general,
// <https://x|label> → label, and the three escaped characters back.
export function slackText(text, users) {
  return String(text || "")
    .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id) => "@" + ((users[id] && users[id].name) || "someone"))
    .replace(/<#([CG][A-Z0-9]+)\|([^>]*)>/g, (_, id, name) => "#" + (name || id))
    .replace(/<!(here|channel|everyone)[^>]*>/g, "@$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}

// A workflow's post (the Post-Shift Checklist) can arrive with its words in `blocks` and a
// thin `text`. Read whichever says more.
function blocksText(blocks) {
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== "object") return;
    if (node.type === "text" && typeof node.text === "string") { out.push(node.text); return; }
    if (node.type === "user" && node.user_id) { out.push("<@" + node.user_id + ">"); return; }
    if ((node.type === "mrkdwn" || node.type === "plain_text") && typeof node.text === "string") { out.push(node.text + "\n"); return; }
    if (node.type === "rich_text_section" || node.type === "rich_text_preformatted") { walk(node.elements); out.push("\n"); return; }
    if (node.type === "rich_text_list") { (node.elements || []).forEach((el) => { out.push("• "); walk(el); }); return; }
    if (node.type === "rich_text_quote") { out.push("> "); walk(node.elements); out.push("\n"); return; }
    walk(node.text); walk(node.elements); walk(node.fields);
  };
  walk(blocks);
  return out.join("").replace(/\n{3,}/g, "\n\n").trim();
}
function rawText(m) {
  const t = String(m.text || "");
  const b = m.blocks ? blocksText(m.blocks) : "";
  return b.length > t.length + 20 ? b : (t || b);
}

export const SHIFT_RE = /post[- ]?shift checklist/i;

function msgAuthor(m, users) {
  if (m.user && users[m.user]) return users[m.user].name;
  if (m.user) return "Someone";
  return (m.bot_profile && m.bot_profile.name) || m.username || "Workflow";
}

export function permalink(teamUrl, channel, ts) {
  const base = String(teamUrl || "https://app.slack.com/").replace(/\/+$/, "");
  return base + "/archives/" + channel + "/p" + String(ts).replace(".", "");
}

async function allPages(method, params, key) {
  const out = [];
  let cursor = "";
  for (let i = 0; i < 10; i++) {
    const data = await slack(method, { ...params, cursor });
    out.push(...(data[key] || []));
    cursor = data.response_metadata && data.response_metadata.next_cursor;
    if (!cursor) break;
  }
  return out;
}

export async function readWorkspace() {
  const me = await slack("auth.test");
  const users = {};
  for (const u of await allPages("users.list", { limit: 200 }, "members")) {
    const p = u.profile || {};
    users[u.id] = {
      name: p.display_name || p.real_name || u.real_name || u.name || "Someone",
      real: p.real_name || u.real_name || "",
      first: String(p.real_name || u.real_name || p.display_name || u.name || "").split(/\s+/)[0],
      bot: !!u.is_bot || u.id === "USLACKBOT",
      deleted: !!u.deleted,
    };
  }
  // Group DMs need mpim:read. A token without it still reads every channel and DM — the
  // first live token was made without it, and the whole read failing over the one kind of
  // conversation this gym barely uses would have been the wrong trade.
  let channels;
  try {
    channels = await allPages("users.conversations",
      { types: "public_channel,private_channel,im,mpim", exclude_archived: true, limit: 200 }, "channels");
  } catch (e) {
    if (e.slackError !== "missing_scope") throw e;
    channels = await allPages("users.conversations",
      { types: "public_channel,private_channel,im", exclude_archived: true, limit: 200 }, "channels");
  }
  return { me: me.user_id, team: me.team, teamUrl: me.url, users, channels };
}

function channelLabel(c, users) {
  if (c.is_im) return "DM · " + ((users[c.user] && users[c.user].name) || "someone");
  if (c.is_mpim) return "Group DM";
  return "#" + (c.name || c.id);
}

/* Everything the brief is built from. Returned as plain data so the prompt, the page and
   the tests all read the same thing. */
export async function readSlack(nowSec) {
  const now = nowSec || Date.now() / 1000;
  const ws = await readWorkspace();
  const oldestVoice = now - VOICE_DAYS * DAY;
  const oldestWork = now - LOOK_BACK_DAYS * DAY;

  const channels = [];
  const roots = [];          // messages from the last seven days that start a conversation
  const voice = [];          // Ash's own words, to write like him
  for (const c of ws.channels) {
    // a DM with a bot or a deactivated account is never something to answer
    if (c.is_im && (!ws.users[c.user] || ws.users[c.user].bot || ws.users[c.user].deleted)) continue;
    let lastRead = 0;
    try {
      const info = await slack("conversations.info", { channel: c.id });
      lastRead = Number(info.channel && info.channel.last_read) || 0;
    } catch { /* last_read is a nicety; the channel is still read */ }
    let msgs = [];
    try {
      msgs = await allPages("conversations.history", { channel: c.id, oldest: String(oldestVoice), limit: 200 }, "messages");
    } catch (e) {
      channels.push({ id: c.id, label: channelLabel(c, ws.users), dm: !!(c.is_im || c.is_mpim), unread: 0, error: e.message });
      continue;
    }
    const label = channelLabel(c, ws.users);
    let unread = 0;
    for (const m of msgs) {
      if (m.subtype && !/^(bot_message|thread_broadcast|file_share)$/.test(m.subtype)) continue; // joins, topic changes…
      const ts = Number(m.ts);
      const mine = m.user === ws.me;
      const text = slackText(rawText(m), ws.users);
      if (mine && text.trim()) voice.push({ ts, channel: label, text: clip(text, 700) });
      if (ts < oldestWork) continue;
      // No read marker from Slack (it can be missing on a DM) counts as unread; the
      // caught-up line in the brief is what stops that from bringing old messages back.
      const isUnread = !mine && (lastRead === 0 || ts > lastRead);
      if (isUnread) unread++;
      roots.push({
        ref: c.id + ":" + m.ts,
        channel: c.id, channelLabel: label, dm: !!(c.is_im || c.is_mpim),
        ts: m.ts, at: Math.round(ts * 1000),
        author: msgAuthor(m, ws.users), authorId: m.user || "", mine,
        text: clip(text, 4000),
        unread: isUnread,
        shift: SHIFT_RE.test(text),
        replyCount: Number(m.reply_count) || 0,
        latestReply: Number(m.latest_reply) || 0,
        reactions: (m.reactions || []).map((r) => ({ name: r.name, mine: (r.users || []).includes(ws.me), count: r.count || 0 })),
        link: permalink(ws.teamUrl, c.id, m.ts),
        replies: [],
        // when someone OTHER than him last said something in this conversation
        last: mine ? 0 : Math.round(ts * 1000),
      });
    }
    channels.push({ id: c.id, label, dm: !!(c.is_im || c.is_mpim), unread });
  }

  // The threads under the newest conversations, so "did anyone answer?" has an answer.
  const threaded = roots.filter((r) => r.replyCount > 0).sort((a, b) => b.latestReply - a.latestReply).slice(0, MAX_THREADS);
  for (const r of threaded) {
    try {
      const data = await slack("conversations.replies", { channel: r.channel, ts: r.ts, limit: 100 });
      const msgs = data.messages || [];
      // a thread he follows carries his read marker on its first message
      const parent = msgs.find((m) => m.ts === r.ts) || {};
      const threadRead = Number(parent.last_read) || 0;
      r.replies = msgs.filter((m) => m.ts !== r.ts).map((m) => ({
        ts: m.ts, at: Math.round(Number(m.ts) * 1000),
        author: msgAuthor(m, ws.users), mine: m.user === ws.me,
        text: clip(slackText(rawText(m), ws.users), 1500),
      }));
      // a reply he has not read makes the conversation unread, wherever its first message is
      if (threadRead && r.replies.some((x) => !x.mine && Number(x.ts) > threadRead)) r.unread = true;
      r.last = Math.max(r.last, ...r.replies.filter((x) => !x.mine).map((x) => x.at));
    } catch { /* the root still shows; its replies are one tap away in Slack */ }
  }

  roots.sort((a, b) => a.at - b.at);
  voice.sort((a, b) => b.ts - a.ts);
  return {
    me: ws.me, teamUrl: ws.teamUrl, team: ws.team,
    meName: (ws.users[ws.me] && ws.users[ws.me].name) || "Ash",
    users: ws.users, channels, roots, voice: voice.slice(0, 40),
  };
}

/* ---------------- Claude: what it all means ---------------- */

// The one shape the answer must take. Structured output, so the page never meets a
// half-formed reply. Every row points back at a message by `ref` ("<channel>:<ts>"), and a
// ref that is not in what was read is dropped — Claude cannot invent a conversation.
export const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "know", "actions", "sessions"],
  properties: {
    summary: { type: "string" },
    know: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["text", "ref"],
        properties: { text: { type: "string" }, ref: { type: "string" } },
      },
    },
    actions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["ref", "kind", "urgency", "title", "why", "draft"],
        properties: {
          ref: { type: "string" },
          kind: { type: "string", enum: ["reply", "step_in", "decide", "chase", "praise"] },
          urgency: { type: "string", enum: ["now", "today", "this_week"] },
          title: { type: "string" },
          why: { type: "string" },
          draft: { type: "string" },
        },
      },
    },
    sessions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["ref", "coach", "shift", "headline", "flags", "draft"],
        properties: {
          ref: { type: "string" },
          coach: { type: "string" },
          shift: { type: "string" },
          headline: { type: "string" },
          flags: { type: "array", items: { type: "string" } },
          draft: { type: "string" },
        },
      },
    },
  },
};

function stamp(ms) {
  const d = new Date(ms);
  return d.toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function briefPrompt(data, state, nowMs) {
  const handled = state && state.handled ? state.handled : {};
  const lines = [];
  for (const r of data.roots) {
    if (handled[r.ref]) continue;
    const flags = [r.unread ? "UNREAD" : "", r.mine ? "ASH WROTE THIS" : "", r.shift ? "POST-SHIFT CHECKLIST" : "",
      r.reactions.some((x) => x.mine) ? "ASH REACTED" : ""].filter(Boolean).join(", ");
    lines.push("=== ref " + r.ref + " | " + r.channelLabel + " | " + stamp(r.at) + " | " + r.author + (flags ? " | " + flags : ""));
    lines.push(r.text);
    for (const x of r.replies) {
      lines.push("  ↳ " + (x.mine ? "ASH" : x.author) + " (" + stamp(x.at) + "): " + x.text.replace(/\n/g, "\n    "));
    }
    lines.push("");
  }
  const voice = data.voice.map((v) => "- (" + v.channel + ") " + v.text.replace(/\n/g, " ")).join("\n");
  const name = data.meName || "Ash";

  return (
    "You are the chief of staff for " + name + ", who owns and leads Bodysculpt, a small-group personal training gym in Warrington, UK. " +
    "Below is every conversation in the team Slack channels and DMs he is in that has something he has NOT read yet. " +
    "He reads this on his phone on the Daily Dashboard, often after time away, and he wants to lead his team well: stay on top of what matters, " +
    "back his coaches, and make sure nobody's update goes unanswered.\n\n" +
    "Today is " + stamp(nowMs) + " (UK time).\n\n" +
    "Each conversation starts with '=== ref <ref>'. Flags: UNREAD = he has not opened it in Slack; ASH WROTE THIS = his own message; " +
    "ASH REACTED = he has already reacted to it; POST-SHIFT CHECKLIST = a coach's end-of-shift report. Lines starting ↳ are thread replies; 'ASH' is him.\n\n" +
    "Produce:\n" +
    "1. summary — what is new since he last looked, in 1 to 4 plain sentences, most important first. Name people. Lead with anything that costs money, members or trust. " +
    "If nothing much happened, say so in one sentence.\n" +
    "2. know — up to 6 facts he needs to carry into his day that need no reply: cancellations and notice periods, injuries, new starters, " +
    "staff availability, payment problems someone has already handled, decisions the team made. One short sentence each, with the ref it came from. " +
    "Do not repeat anything that is also an action.\n" +
    "3. actions — the conversations where he should post something. Include: questions put to him or @mentions of him that he has not answered; " +
    "a teammate's question that nobody has answered for more than half a day; problems that need the owner (money taken wrongly, a complaint, " +
    "a member at risk of leaving, a safety or injury issue, a staffing gap); requests that need his yes or no (holidays, spend, schedule changes) — kind 'decide'; " +
    "his own questions to the team that nobody has answered — kind 'chase'; and a genuinely big win worth recognising publicly — kind 'praise'. " +
    "Do NOT include: anything already resolved in its thread, anything he has already answered after the last question, Post-Shift Checklists " +
    "(those go in sessions), or chatter. Never make an action out of a message ASH WROTE unless it is a 'chase'. " +
    "urgency: now = money, safety or a member about to leave; today = someone is waiting on him; this_week = everything else. " +
    "title: under 70 characters, what he has to do, e.g. 'Answer Grace about Cal being charged twice'. why: one sentence on why it needs him. " +
    "Order the list most urgent first; at most 8.\n" +
    "4. sessions — one entry for EVERY post marked POST-SHIFT CHECKLIST that he has not replied to in its thread and not reacted to, newest first. " +
    "coach: the coach's first name as written in the post. shift: the day and shift as written, e.g. 'Mon 19 Oct · Late'. " +
    "headline: one sentence on how the shift went, naming the member stories that matter. flags: short labels for anything that needs eyes " +
    "(e.g. 'Cancellation: Zara', 'Injury: Laura's back', 'Payment: Jamie bank details', 'At risk: Andy'), empty if none.\n\n" +
    "Every draft is a Slack message he will post AS HIMSELF, in that thread. Write it the way he writes — the examples of his own messages below are " +
    "the guide to his tone, length and phrasing. UK English. Warm, direct, like a boss who is also a coach. No corporate language, no em dashes, " +
    "no hashtags, no sign-off. Address the person by first name. " +
    "A session reply is 1 to 4 short lines: thank the coach for the specific thing they did well, picking out one or two members by name; " +
    "where there is a flag, say what happens next or ask the one question that moves it on. Never praise generically ('great job team'). " +
    "Never promise money, refunds or decisions he has not made. Where the reply depends on his answer to something " +
    "(a yes or no, a date, a time, an amount), leave it for him in square brackets, e.g. 'Yes, [1pm / 12pm] works', rather than choosing for him. " +
    "Automated reports posted from his account (such as a Morning Sales Brief) are information for the summary and know, never something to reply to. " +
    "If a teammate has already handled something, back them rather than redoing it.\n\n" +
    "Only use refs that appear below. If there is nothing for a section, return an empty list.\n\n" +
    "HOW " + name.toUpperCase() + " WRITES (his own recent messages):\n" + (voice || "(none found — keep it short, friendly and direct)") + "\n\n" +
    "WHAT HE HAS NOT READ:\n\n" + (lines.join("\n") || "(nothing)")
  );
}

export async function askClaude(prompt, schema, opts) {
  if (!env("ANTHROPIC_API_KEY")) throw new Error("ANTHROPIC_API_KEY is not set.");
  const client = new Anthropic();
  const params = {
    model: "claude-opus-5",
    max_tokens: (opts && opts.maxTokens) || 16000,
    output_config: { effort: (opts && opts.effort) || "high", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: prompt }],
  };
  const msg = opts && opts.stream === false
    ? await client.messages.create(params)
    : await client.messages.stream(params).finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("Claude declined to read this.");
  if (msg.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off.");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try { return JSON.parse(text); } catch { throw new Error("Claude's answer could not be read."); }
}

/* What the page is sent: Claude's reading, joined back to the real messages. Anything that
   points at a message that was not read is dropped here, and every Post-Shift Checklist he
   has not answered is listed even if Claude missed it — it just arrives without a draft. */
export function assembleBrief(data, ai, nowMs) {
  const byRef = new Map(data.roots.map((r) => [r.ref, r]));
  const msgView = (r) => ({
    ref: r.ref, channel: r.channel, channelLabel: r.channelLabel, dm: r.dm, ts: r.ts, at: r.at, last: r.last,
    author: r.author, text: r.text, link: r.link, unread: r.unread,
    replies: r.replies.slice(-12).map((x) => ({ author: x.author, mine: x.mine, at: x.at, text: x.text })),
  });
  const answered = (r) => r.reactions.some((x) => x.mine) || r.replies.some((x) => x.mine);

  const seen = new Set();
  const actions = [];
  for (const a of (ai && ai.actions) || []) {
    const r = byRef.get(a.ref);
    if (!r || seen.has(a.ref) || r.shift) continue;
    // His own message is only ever a "chase" — never a reply to himself. The first live read
    // made a "decide" out of his automated Morning Sales Brief in #sales; the prompt forbade
    // it and was not enough, so the rule lives here too.
    if (r.mine && a.kind !== "chase") continue;
    seen.add(a.ref);
    actions.push({ id: a.ref, kind: a.kind, urgency: a.urgency, title: clip(a.title, 140), why: clip(a.why, 400), draft: clip(a.draft, 3000), msg: msgView(r) });
  }
  const order = { now: 0, today: 1, this_week: 2 };
  actions.sort((a, b) => (order[a.urgency] - order[b.urgency]) || (b.msg.at - a.msg.at));

  const aiSessions = new Map(((ai && ai.sessions) || []).map((s) => [s.ref, s]));
  const sessions = data.roots.filter((r) => r.shift).map((r) => {
    const s = aiSessions.get(r.ref) || {};
    return {
      id: r.ref,
      coach: clip(s.coach || coachFromText(r.text), 40),
      shift: clip(s.shift || "", 60),
      headline: clip(s.headline || "", 400),
      flags: (Array.isArray(s.flags) ? s.flags : []).map((f) => clip(f, 60)).slice(0, 6),
      draft: clip(s.draft || "", 3000),
      acknowledged: answered(r),
      msg: msgView(r),
    };
  }).sort((a, b) => b.msg.at - a.msg.at);

  const know = ((ai && ai.know) || []).filter((k) => byRef.has(k.ref)).slice(0, 8)
    .map((k) => ({ text: clip(k.text, 300), ref: k.ref, link: byRef.get(k.ref).link, channelLabel: byRef.get(k.ref).channelLabel, last: byRef.get(k.ref).last }));

  return {
    v: 1,
    builtAt: nowMs,
    summary: clip((ai && ai.summary) || "", 1200),
    know, actions, sessions,
    channels: data.channels.map((c) => ({ id: c.id, label: c.label, dm: c.dm, unread: c.unread })),
    unreadTotal: data.channels.reduce((n, c) => n + (c.unread || 0), 0),
    teamUrl: data.teamUrl,
    me: data.me,
    meName: data.meName,
    // first names → ids, so "@Dan" in a draft becomes a real mention when it is posted
    // his own words, kept for "Write it with Claude" on a single reply — never sent to the page
    voice: data.voice.slice(0, 15).map((v) => "- " + clip(v.text.replace(/\n/g, " "), 300)).join("\n"),
    people: Object.entries(data.users).filter(([, u]) => !u.bot && !u.deleted).map(([id, u]) => ({ id, name: u.name, first: u.first })),
  };
}

function coachFromText(text) {
  // "*grace*  •  Mon 19 Oct, 21:00, Monday - Late" — the line under the checklist's title
  const m = /\n\s*\*?([A-Za-z][A-Za-z' -]{0,30}?)\*?\s+•/.exec(String(text || ""));
  return m ? m[1].trim() : "";
}

/* UNREAD ONLY (v224). Ash, once he was up to date: "from this point onwards can we only show
   unreads." A conversation is on the card when it has something he has not read in Slack
   (his channel or thread read marker says so) AND someone else said it after the line he
   drew with "I'm caught up". The first half drops what he reads in Slack; the second drops
   what was already there when he said he was up to date. */
export function onlyUnread(roots, caughtUpAt) {
  const line = Number(caughtUpAt) || 0;
  return roots.filter((r) => r.unread && r.last > line);
}

export async function buildBrief(nowMs) {
  const now = nowMs || Date.now();
  const data = await readSlack(now / 1000);
  const state = await readState();
  data.roots = onlyUnread(data.roots, state.caughtUpAt);
  // nothing unread is a quiet morning, not a question for Claude
  const ai = data.roots.length
    ? await askClaude(briefPrompt(data, state, now), BRIEF_SCHEMA)
    : { summary: "", know: [], actions: [], sessions: [] };
  return { ...assembleBrief(data, ai, now), caughtUpAt: Number(state.caughtUpAt) || 0 };
}

/* ---------------- posting ---------------- */

// "@Dan" → "<@U0B…>" when exactly one teammate has that first name (or that display name).
export function linkMentions(text, people) {
  const list = Array.isArray(people) ? people : [];
  return String(text || "").replace(/(^|[\s(])@([A-Za-z][A-Za-z'-]{1,30})\b/g, (all, pre, word) => {
    const w = word.toLowerCase();
    const hits = list.filter((p) => String(p.first || "").toLowerCase() === w || String(p.name || "").toLowerCase() === w);
    return hits.length === 1 ? pre + "<@" + hits[0].id + ">" : all;
  });
}

// Slack's own escaping for the three characters it treats as markup.
export function slackEscape(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function redraftPrompt(item, ask, current, voice) {
  const m = item.msg || {};
  const thread = [m.author + ": " + m.text].concat((m.replies || []).map((x) => (x.mine ? "ASH" : x.author) + ": " + x.text)).join("\n\n");
  return (
    "You write Slack replies for Ash, who owns and leads Bodysculpt, a small-group personal training gym in Warrington, UK. " +
    "Write the reply he will post in this thread, as himself. UK English, warm and direct, short, no em dashes, no sign-off, no corporate language. " +
    "Never promise money or decisions he has not stated.\n\n" +
    (voice ? "How he writes:\n" + voice + "\n\n" : "") +
    "Where: " + (m.channelLabel || "Slack") + "\n\nTHE THREAD:\n" + clip(thread, 9000) + "\n\n" +
    (current ? "His current draft:\n" + current + "\n\n" : "") +
    (ask ? "What he wants: " + ask + "\n\n" : "Write the best reply.\n\n") +
    "Return only the message text."
  );
}

export async function redraft(item, ask, current, voice) {
  if (!env("ANTHROPIC_API_KEY")) throw new Error("ANTHROPIC_API_KEY is not set.");
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 1500,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: redraftPrompt(item, ask, current, voice || "") }],
  });
  if (msg.stop_reason === "refusal") throw new Error("Claude declined to write this one.");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (!text) throw new Error("Claude returned nothing.");
  return clip(text, 3000);
}
