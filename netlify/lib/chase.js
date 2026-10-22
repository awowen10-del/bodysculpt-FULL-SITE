// netlify/lib/chase.js  (v244)
//
// The chase ladder on the Daily page's "Money needing attention" card: for anyone overdue on
// Stripe, the next message Ash might send, already written, waiting for him.
//
// THE POLICY IS ASH'S, word for word as he gave it (2026-10-22). Nothing here is invented:
//   day 8   1st nudge — a friendly check-in from him: "it's been over a week — is everything
//           OK? Usually when this happens people have had a new card", and the card link.
//   (v244: days are MINIMUMS. Each later stage also waits GAP_DAYS (7) after the previous one
//   was actually sent: 1st sent on day 14 → 2nd on day 21. Gaz likewise, 7 days after the 2nd.)
//   day 15  2nd nudge — SAME tone. "'More direct' is not my voice." The only addition is a
//           heads-up: "I'd hate to have to put your sessions on hold", and the link again.
//   day 22  no third email. A Slack message for Ash to send to Gaz, asking him to contact the
//           member directly.
//   · everyone overdue on Stripe — memberships AND the second £99 of a split-pay challenge;
//   · the moment they pay ANYTHING, or reply, the chase stops and the row says so;
//   · STRICT ORDER. The next stage is only suggested once Ash has actually SENT the one before
//     (seen in Gmail: the draft went, or there is a message from him on that thread). A first
//     nudge never sent is still the suggestion on day 30. Never skip ahead.
//   · disputes (and anyone with one open) are hands-off: flagged NEEDS ASH, never chased.
//
// AND THE RULE OVER ALL OF IT: "NOTHING SENDS BY ITSELF … The dashboard suggests; I act."
// The emails are Gmail DRAFTS (lib/gmail.js can create a draft and cannot send). The Slack
// message is TEXT on the card, with a copy button — this file never talks to Slack.
//
// Its state sits beside the mail triage in store `bodysculpt-mail`:
//   chase-state        { debts: { [personKey]: Record } }       (chase-state-test in test mode)
//   Record = { name, email, overdueFrom, nudge1?, nudge2?, final?, closedAt? }
//   nudge  = { draftId, messageId, threadId, subject, to, preview, draftedAt }
//   final  = { text, draftedAt, sentAt? }
import { getStore } from "@netlify/blobs";
import Anthropic from "@anthropic-ai/sdk";
import { SKILL_TEXT } from "./email-skill.js";
import { gmailGet, createDraft, buildRaw, header } from "./gmail.js";
import { MODELS, env, clip } from "./mail-drafts.js";

/* ===================== THE SETTINGS — change them here ===================== */

// Where a member updates their card. TODO(GoHighLevel): this is the Ontraport checkout page.
// Swap it for the GoHighLevel card-update page once that exists — this is the only place it
// is written, and both nudges use it.
export const CARD_UPDATE_URL = "https://bodysculpt.securechkout.com/update";

// The ladder, in days overdue. `label` is the tag on the row.
export const STAGES = [
  { id: "nudge1", day: 8,  label: "1st nudge" },
  { id: "nudge2", day: 15, label: "2nd nudge" },
  { id: "final",  day: 22, label: "final" },
];
export const FINAL_CONTACT = "Gaz";

// Ash (v244): "the day numbers are minimums, not fixed dates." Each later stage waits this
// many days after the one before was actually SENT — and never comes before its own day.
// So a 1st nudge sent on day 14 means the 2nd on day 21, not day 15.
export const GAP_DAYS = 7;

// The subject of the first nudge (the second is a reply on the same thread).
export const CHASE_SUBJECT = "Quick check-in about your payment";

/* TEST MODE. Set CHASE_TEST_EMAIL in Netlify (e.g. your own address) and every chase draft is
   addressed THERE instead of to the member, with the member named in the subject — and the
   ladder keeps its memory under a separate key, so a week of testing leaves no trace on the
   real one. Remove the variable to go live. */
export const testEmail = () => env("CHASE_TEST_EMAIL").toLowerCase();
const stateKey = () => (testEmail() ? "chase-state-test" : "chase-state");

/* ========================================================================= */

const DAY_MS = 86400000;
const store = () => getStore({ name: "bodysculpt-mail", consistency: "strong" });

export async function readState() {
  try { return (await store().get(stateKey(), { type: "json" })) || { debts: {} }; } catch { return { debts: {} }; }
}
export async function writeState(st) { await store().setJSON(stateKey(), st); }

const normName = (v) => String(v || "").toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
export const firstName = (name) => {
  const n = String(name || "").trim().replace(/^(mr|mrs|miss|ms|dr)\.?\s+/i, "");
  if (!n || n.includes("@")) return "";
  const f = n.split(/\s+/)[0];
  return f.charAt(0).toUpperCase() + f.slice(1).toLowerCase();
};
const pounds = (p) => "£" + (Math.round(Number(p) || 0) / 100).toFixed(2).replace(/\.00$/, "");
const dayWords = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.getUTCDate() + " " + ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()];
};

/* ---------- from the Money card's rows to one debt per person ----------
   `money` is exactly what stripe-feed's readMoney returns, so the ladder works from the rows
   the card shows. One PERSON is one chase, however many rows they have: two emails to one
   member about two failures would be the bank-like thing Ash does not want. */
export function personKey(row) {
  if (row.customerId) return "c:" + row.customerId;
  if (row.email) return "e:" + String(row.email).trim().toLowerCase();
  return "r:" + row.id;
}

export function debtsFromMoney(money) {
  const disputed = new Set();
  for (const d of (money && money.disputes) || []) {
    if (d.email) disputed.add("e:" + String(d.email).trim().toLowerCase());
    if (normName(d.name).includes(" ")) disputed.add("n:" + normName(d.name));
  }
  const byKey = new Map();
  const rows = [...((money && money.pastDue) || []), ...((money && money.failed) || [])];
  for (const r of rows) {
    const key = personKey(r);
    let d = byKey.get(key);
    if (!d) {
      d = { key, name: r.name || "", email: r.email || "", rowIds: [], amount: 0, kinds: [], overdueFrom: "", paidSince: null, handsOff: "" };
      byKey.set(key, d);
    }
    d.rowIds.push(r.id);
    d.amount += Number(r.amount) || 0;
    d.kinds.push(r.kind);
    if (!d.email && r.email) d.email = r.email;
    if (!d.name && r.name) d.name = r.name;
    const from = r.overdueFrom || r.since || r.firstFailedAt || r.createdAt || "";
    if (from && (!d.overdueFrom || from < d.overdueFrom)) d.overdueFrom = from;
    if (r.paidSince && (!d.paidSince || r.paidSince.at > d.paidSince.at)) d.paidSince = r.paidSince;
    const e = String(r.email || "").trim().toLowerCase();
    if ((e && disputed.has("e:" + e)) || (normName(r.name).includes(" ") && disputed.has("n:" + normName(r.name)))) {
      d.handsOff = "They have an open dispute with their bank — that is yours to answer, not a chase.";
    }
  }
  return [...byKey.values()];
}

/* The record for this debt, or a fresh one. A record that was CLOSED (the debt went away)
   belongs to a past episode: the same member falling behind again in March starts at the
   1st nudge, not wherever January left off. */
export function recordFor(state, debt) {
  const rec = state.debts[debt.key];
  if (!rec || rec.closedAt) return { name: debt.name, email: debt.email, overdueFrom: debt.overdueFrom };
  // a membership's period start moves on each month it stays unpaid; the debt began at the earliest
  const from = [rec.overdueFrom, debt.overdueFrom].filter(Boolean).sort()[0] || "";
  return { ...rec, overdueFrom: from };
}

export const daysOverdue = (fromIso, now) => {
  const t = Date.parse(fromIso);
  return isFinite(t) ? Math.floor((now - t) / DAY_MS) : 0;
};

/* ---------- THE LADDER ----------
   Pure: the debt, its record, and what Gmail says (`facts`), to what the row shows.
   facts = { replied: {at, threadId}|null,
             nudge1: {sent, sentAt, draftExists}|null, nudge2: {…}|null }
   Returns { stage, tag, action, note, … } where action is one of
     none | write | draft-ready | draft-gone | waiting | slack | done */
export function ladder(debt, rec, facts, now) {
  const f = facts || {};
  const days = daysOverdue(rec.overdueFrom || debt.overdueFrom, now);
  const base = { key: debt.key, days, name: debt.name, email: debt.email };

  if (debt.handsOff) return { ...base, stage: "needs-ash", tag: "NEEDS ASH", action: "none", note: debt.handsOff };
  if (debt.paidSince) {
    return { ...base, stage: "paid", tag: "paid", action: "none",
      note: "Paid " + pounds(debt.paidSince.amount) + " on " + dayWords(debt.paidSince.at) + " — chasing stopped." };
  }
  if (f.replied) {
    return { ...base, stage: "replied", tag: "they've replied", action: "none", threadId: f.replied.threadId || "",
      note: "They emailed you on " + dayWords(f.replied.at) + " — chasing stopped. Their email is in your inbox." };
  }
  const s1 = STAGES[0], s2 = STAGES[1], s3 = STAGES[2];
  if (days < s1.day) {
    return { ...base, stage: "early", tag: "", action: "none",
      note: "Day " + days + " — the 1st nudge is suggested from day " + s1.day + "." };
  }
  if (!debt.email) {
    return { ...base, stage: s1.id, tag: s1.label, action: "none", note: "Stripe has no email address for them, so there is nothing to draft." };
  }

  // One email stage: draft it, show the draft, or wait for the next day on the ladder.
  const emailStage = (st) => {
    const r = rec[st.id], g = f[st.id];
    if (r && g && g.sent) return null;                                  // done — move on
    if (r && g && g.draftExists) {
      return { ...base, stage: st.id, tag: st.label, action: "draft-ready", draftId: r.draftId, messageId: r.messageId,
        preview: r.preview || "", to: r.to || "", note: "Drafted " + dayWords(r.draftedAt) + " — in your Gmail drafts, waiting for you." };
    }
    if (r && g && !g.draftExists) {
      // Ash deleted it without sending. That is his decision; the job never puts it back.
      return { ...base, stage: st.id, tag: st.label, action: "draft-gone",
        note: "The draft from " + dayWords(r.draftedAt) + " was deleted without being sent." };
    }
    if (r && !g) {
      // Gmail could not be asked just now — say what is known, suggest nothing new.
      return { ...base, stage: st.id, tag: st.label, action: "draft-ready", draftId: r.draftId, messageId: r.messageId,
        preview: r.preview || "", to: r.to || "", note: "Drafted " + dayWords(r.draftedAt) + "." };
    }
    return { ...base, stage: st.id, tag: st.label, action: "write",
      note: "Day " + days + " — the " + st.label + " is due." };
  };

  // When a later stage falls due: its own minimum day, or GAP_DAYS after the previous one was
  // sent — whichever is LATER.
  const start = Date.parse(rec.overdueFrom || debt.overdueFrom) || now;
  const dueAt = (st, prevSentAt) => Math.max(start + st.day * DAY_MS, (Date.parse(prevSentAt) || 0) + GAP_DAYS * DAY_MS);

  const one = emailStage(s1);
  if (one) return one;
  const due2 = dueAt(s2, f.nudge1.sentAt);
  if (now < due2) {
    return { ...base, stage: s1.id, tag: s1.label + " sent", action: "waiting", dueAt: new Date(due2).toISOString(),
      note: "Sent " + dayWords(f.nudge1.sentAt) + ". The 2nd nudge is suggested from " + dayWords(new Date(due2).toISOString()) + " if nothing comes in." };
  }
  const two = emailStage(s2);
  if (two) return two;
  const due3 = dueAt(s3, f.nudge2.sentAt);
  if (now < due3) {
    return { ...base, stage: s2.id, tag: s2.label + " sent", action: "waiting", dueAt: new Date(due3).toISOString(),
      note: "Sent " + dayWords(f.nudge2.sentAt) + ". From " + dayWords(new Date(due3).toISOString()) + " this goes to " + FINAL_CONTACT + "." };
  }
  if (rec.final && rec.final.sentAt) {
    return { ...base, stage: s3.id, tag: s3.label, action: "done", slack: rec.final.text,
      note: "Passed to " + FINAL_CONTACT + " on " + dayWords(new Date(rec.final.sentAt).toISOString()) + "." };
  }
  return { ...base, stage: s3.id, tag: s3.label, action: "slack",
    slack: (rec.final && rec.final.text) || slackForGaz(debt, rec, f),
    note: "Day " + days + ". No third email — this one goes to " + FINAL_CONTACT + " on Slack, from you." };
}

/* The final stage's message. A template, not Claude: it is Ash to his own coach, it says only
   what the record knows, and it must be on the card instantly. He edits it as he sends it. */
export function slackForGaz(debt, rec, facts) {
  const f = facts || {};
  const when = [f.nudge1 && f.nudge1.sentAt, f.nudge2 && f.nudge2.sentAt].filter(Boolean).map((x) => dayWords(x));
  return "Hey " + FINAL_CONTACT + ", can you get in touch with " + (debt.name || debt.email) + " directly please? " +
    "Their payment (" + pounds(debt.amount) + ") has been overdue since " + dayWords(rec.overdueFrom || debt.overdueFrom) + ". " +
    "I've emailed them twice" + (when.length === 2 ? " (" + when.join(" and ") + ")" : "") + " and not heard anything back. " +
    "Can you have a word and let me know how you get on? Their email is " + (debt.email || "not on Stripe") + ".";
}

/* ---------- what Gmail says ---------- */
async function nudgeFacts(n) {
  if (!n || !n.threadId) return null;
  try {
    const th = await gmailGet("threads/" + encodeURIComponent(n.threadId) + "?format=metadata&metadataHeaders=Message-ID");
    const msgs = th.messages || [];
    const sentMsg = msgs.filter((m) => (m.labelIds || []).includes("SENT") && !(m.labelIds || []).includes("DRAFT")).pop();
    return {
      sent: !!sentMsg,
      sentAt: sentMsg ? new Date(Number(sentMsg.internalDate)).toISOString() : "",
      sentMessageId: sentMsg ? header(sentMsg, "message-id") : "",
      draftExists: msgs.some((m) => (m.labelIds || []).includes("DRAFT")),
    };
  } catch (e) {
    // the thread itself is gone (a deleted draft takes its one-message thread with it)
    if (e.status === 404) return { sent: false, sentAt: "", draftExists: false };
    return null;
  }
}

async function repliedFacts(debt, rec) {
  if (!debt.email) return null;
  const after = Math.floor((Date.parse(rec.overdueFrom || debt.overdueFrom) || 0) / 1000);
  try {
    const r = await gmailGet("messages?maxResults=1&q=" + encodeURIComponent("from:" + debt.email + " after:" + after));
    const m = (r.messages || [])[0];
    if (!m) return null;
    const full = await gmailGet("messages/" + encodeURIComponent(m.id) + "?format=minimal");
    return { at: new Date(Number(full.internalDate)).toISOString(), threadId: m.threadId };
  } catch { return null; }
}

export async function gmailFacts(debt, rec) {
  const [replied, nudge1, nudge2] = await Promise.all([repliedFacts(debt, rec), nudgeFacts(rec.nudge1), nudgeFacts(rec.nudge2)]);
  return { replied, nudge1, nudge2 };
}

/* ---------- writing a nudge ---------- */
export function chasePrompt(debt, rec, stageId) {
  const what = debt.kinds.includes("subscription") ? "their monthly membership" : "a payment (a membership payment or the second instalment of the 6 Week Challenge split pay)";
  const gist = stageId === "nudge1"
    ? "Ash's own gist for this one (use the skill for the voice — do not copy it verbatim):\n" +
      "\"Hey [name], it's Ash, just wanted to check in as we've not been able to collect your payment and it's been over a week — is everything OK? Usually when this happens people have had a new card, so if that's the case you can update your details here: [link]\""
    : "This is the SECOND nudge, as a reply under the first one, which got no answer. SAME friendly tone as the first — Ash: \"'More direct' is not my voice.\" " +
      "The only thing that changes is a gentle heads-up, his gist: \"I'd hate to have to put your sessions on hold, so can you let me know what's going on or update your card here: [link]\". Do not repeat the first email.";
  return (
    "Write a short email from Ash to a member whose payment has not gone through. It is a check-in, not a demand: Ash, not a bank.\n\n" +
    gist + "\n\n" +
    "Facts you may use:\n" +
    "  their first name: " + (firstName(debt.name) || "(not known — open with \"Hi there,\")") + "\n" +
    "  what it is for: " + what + "\n" +
    "  overdue since: " + dayWords(rec.overdueFrom || debt.overdueFrom) + "\n" +
    "  the link to update their card: " + CARD_UPDATE_URL + "\n" +
    "Do not quote the amount, threaten anything, mention fees, or cite policy. No [ASH: ...] placeholders are needed — everything required is above.\n" +
    "Return only the body of the email."
  );
}

const SYSTEM = () => SKILL_TEXT +
  "\n\n---\n\nHOW YOU ARE BEING USED HERE\nYou are writing a payment check-in for Ash to review. You use no tools; the code saves it as a Gmail draft and never sends it. " +
  "Return ONLY the email body: no subject, no preamble, no markdown. The skill's facts about card updates and the 'update your billing information' emails apply.";

export async function writeChase(debt, rec, stageId) {
  if (!env("ANTHROPIC_API_KEY")) throw new Error("ANTHROPIC_API_KEY is not set.");
  const msg = await new Anthropic().messages.create({
    model: MODELS.write,
    max_tokens: 3000,
    output_config: { effort: "low" },
    system: SYSTEM(),
    messages: [{ role: "user", content: chasePrompt(debt, rec, stageId) }],
  });
  if (msg.stop_reason === "refusal") throw new Error("Claude declined to write this one.");
  const text = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (!text) throw new Error("Claude sent nothing back.");
  return text;
}

/* Write the stage's email and save it as a Gmail draft. The 2nd nudge goes on the 1st nudge's
   thread, as a reply to what was actually sent. Returns the nudge record. */
export async function draftNudge(debt, rec, stageId, facts) {
  const text = await writeChase(debt, rec, stageId);
  const test = testEmail();
  const to = test || debt.email;
  const realName = debt.name && /^[\x20-\x7e]*$/.test(debt.name) ? debt.name : "";
  const prev = stageId === "nudge2" ? rec.nudge1 : null;
  const prevFacts = stageId === "nudge2" ? (facts && facts.nudge1) : null;
  let subject = prev ? prev.subject : CHASE_SUBJECT;
  if (test && !prev) subject = "[TEST for " + (debt.name || debt.email) + " <" + debt.email + ">] " + subject;
  const raw = buildRaw({
    toName: test ? "" : realName, toEmail: to, subject,
    inReplyTo: prevFacts && prevFacts.sentMessageId ? prevFacts.sentMessageId : "",
    text,
  });
  const made = await createDraft(raw, prev ? prev.threadId : "");
  const msg = (made && made.message) || {};
  return {
    draftId: made.id || "", messageId: msg.id || "", threadId: msg.threadId || "",
    subject: subject, to, preview: clip(text.replace(/\s+/g, " "), 220), draftedAt: new Date().toISOString(),
  };
}

/* ---------- the whole card ----------
   `write`: false for the page (look only), true for the morning job (draft whatever is due
   and not yet drafted — never a draft Ash deleted). Returns { views, state }. */
export async function buildChase(money, opts) {
  const o = opts || {};
  const now = o.now || Date.now();
  const state = await readState();
  const debts = debtsFromMoney(money);
  const views = {};
  let changed = false;

  // Gmail is asked about everyone at once — a few calls each, in parallel, so the card is one
  // round trip slower rather than one per member. Nothing to ask about a debt younger than
  // the ladder, or one that is hands-off or paid.
  const allFacts = await Promise.all(debts.map((debt) => {
    const rec = recordFor(state, debt);
    const quiet = debt.handsOff || debt.paidSince || daysOverdue(rec.overdueFrom, now) < STAGES[0].day;
    return quiet ? {} : gmailFacts(debt, rec);
  }));

  for (const [i, debt] of debts.entries()) {
    let rec = recordFor(state, debt);
    let facts = allFacts[i];
    let view = ladder(debt, rec, facts, now);

    if (o.write && view.action === "write" && (view.stage === "nudge1" || view.stage === "nudge2")) {
      try {
        rec = { ...rec, [view.stage]: await draftNudge(debt, rec, view.stage, facts) };
        state.debts[debt.key] = rec; changed = true;
        facts = { ...facts, [view.stage]: { sent: false, sentAt: "", draftExists: true } };
        view = ladder(debt, rec, facts, now);
      } catch (e) {
        view = { ...view, error: clip((e && e.message) || "Could not write it.", 200) };
      }
    }
    if (o.write && view.action === "slack" && !(rec.final && rec.final.text)) {
      rec = { ...rec, final: { text: view.slack, draftedAt: new Date(now).toISOString() } };
      state.debts[debt.key] = rec; changed = true;
    }
    if (o.write && state.debts[debt.key] && state.debts[debt.key].overdueFrom !== rec.overdueFrom) {
      state.debts[debt.key] = { ...state.debts[debt.key], overdueFrom: rec.overdueFrom }; changed = true;
    }
    views[debt.key] = view;
  }

  // The morning job closes the records of debts that are no longer on the card, so the next
  // time the same member falls behind they start at the 1st nudge.
  if (o.write) {
    const live = new Set(debts.map((d) => d.key));
    for (const [k, r] of Object.entries(state.debts)) {
      if (!live.has(k) && !r.closedAt) { state.debts[k] = { ...r, closedAt: new Date(now).toISOString() }; changed = true; }
    }
  }
  if (changed) await writeState(state);
  return { views, debts };
}
