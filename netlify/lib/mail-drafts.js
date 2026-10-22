// netlify/lib/mail-drafts.js  (v244)
//
// The replies on the Daily page's "Needs a reply" card, written from Ash's own skill.
//
// Ash: "The slop is the 'Write it with Claude' button. The morning drafts from the scheduled
// routine are good." The difference was the instructions. The button used to send four
// generic lines ("warm, direct, sign off as Ash") and no facts, so it wrote a generic email.
// The routine works from the bodysculpt-email-replies skill: his voice learned from ~30 sent
// threads, the real prices, timetable, links and policies, and a list of things never to
// draft. Now every reply on this site is written from that skill (netlify/lib/email-skill.js)
// as Claude's system prompt, with the whole thread as context.
//
// TWO CALLERS, ONE WRITER:
//   · the button (mail-ai.js op "write") — Ash asks for one reply, it fills the editor;
//   · the morning job (mail-drafts-background.js) — sorts the inbox with Sonnet, writes a
//     reply with Opus for each lead or client, and saves it as a GMAIL DRAFT on the thread.
//
// NOTHING SENDS. The job's only write to Gmail is createDraft (see lib/gmail.js, which has no
// send at all). A thread that already has a draft is skipped — that is how this and the old
// scheduled routine can both run for a week without doubling up, and how a draft Ash has
// edited can never be overwritten.
//
// Its own blob store, `bodysculpt-mail`, so nothing here can reach the KPI store:
//   mail-triage   { threads: { [threadId]: { kind, reason, lastMsgId, draftId, at } } }
//   mail-run      { running, startedAt, finishedAt, trigger, counts, error }
import { getStore } from "@netlify/blobs";
import Anthropic from "@anthropic-ai/sdk";
import { SKILL_TEXT } from "./email-skill.js";
import { gmailGet, createDraft, threadDetail, conversationText, buildRaw, myAddress } from "./gmail.js";

// Sonnet sorts, Opus writes — Ash's split.
export const MODELS = { classify: "claude-sonnet-5-5", write: "claude-opus-5-5" };

export const STORE = "bodysculpt-mail";
const store = () => getStore({ name: STORE, consistency: "strong" });
export const TRIAGE_KEY = "mail-triage";
export const RUN_KEY = "mail-run";

export const env = (k) => String(process.env[k] || "").trim();
export const clip = (s, n) => String(s == null ? "" : s).slice(0, n);

const MAX_THREADS = 30;                 // per morning run — the card itself shows about this many
const RUN_STALE_MS = 14 * 60 * 1000;    // a run "in progress" this old has died
const TRIAGE_KEEP_DAYS = 45;            // classifications older than this are forgotten
const THREAD_CHARS = 9000;              // the newest part of a long thread

// The four Triage labels the scheduled routine applies. FYI is left out: nothing there needs
// a reply by definition. Must match TIERS in daily.html.
const TRIAGE_LABELS = ["Triage/Urgent", "Triage/Today", "Triage/This week"];
const INBOX_QUERY = "in:inbox is:unread newer_than:3d";

export async function readJSON(key, fallback) {
  try { return (await store().get(key, { type: "json" })) || fallback; } catch { return fallback; }
}
export async function writeJSON(key, value) { await store().setJSON(key, value); }

/* ---------- how the skill is used here ----------
   The skill was written for Claude with Gmail tools (get_thread, create_draft, a report).
   Here the code reads the thread and saves the draft, so Claude is told it only writes. */
const SKILL_ADAPTER =
  "\n\n---\n\nHOW YOU ARE BEING USED HERE\n" +
  "You are not using any tools. The thread has been read for you and is below. The code that called you saves the draft; it never sends.\n" +
  "Return ONLY the body of the email, exactly as it should appear: no subject line, no preamble, no notes to Ash, no markdown, no quotation marks around it.\n" +
  "Unknown facts get an [ASH: ...] placeholder, as the skill says — Ash fills them in before he sends. Never invent a fact to avoid one.\n" +
  "Run the skill's Verification checks on your draft before you answer.";

export const systemPrompt = () => SKILL_TEXT + SKILL_ADAPTER;

function client() {
  if (!env("ANTHROPIC_API_KEY")) throw new Error("ANTHROPIC_API_KEY is not set.");
  return new Anthropic();
}

function textOf(msg) {
  if (msg.stop_reason === "refusal") throw new Error("Claude declined to write this one.");
  const text = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (!text) throw new Error("Claude sent nothing back" + (msg.stop_reason ? " (" + msg.stop_reason + ")" : "") + ".");
  return text.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
}

/* ---------- writing one reply ----------
   `mode` "button": Ash pressed Write/Rewrite himself, so he has already decided to answer —
   the Hands-off list is his to apply, and Claude writes. "morning": the job is deciding on
   his behalf, so a hands-off email gets the answer "NEEDS ASH: <why>" instead of a draft. */
export function replyPrompt(detail, opts) {
  const o = opts || {};
  return (
    (o.mode === "morning"
      ? "This is the weekday morning inbox run. If this email is on the skill's Hands-off list, do not draft: answer with exactly one line, \"NEEDS ASH: \" followed by what they want.\n\n"
      : "Ash pressed the button himself, so always write the reply: even if the topic is on the Hands-off list, and even if more than one fact is missing (give each its own [ASH: ...] placeholder) — he is here to fill them in.\n\n") +
    (o.brief ? "What Ash wants this reply to say: " + o.brief + "\n\n" : "") +
    (o.current ? "There is already a draft. Rewrite it in line with that, keeping anything that is still right:\n\"\"\"\n" + o.current + "\n\"\"\"\n\n" : "") +
    "Today is " + new Date(o.now || Date.now()).toISOString().slice(0, 10) + ".\n\n" +
    "The conversation so far, oldest first:\n\n" + conversationText(detail.messages, THREAD_CHARS) +
    "\n\nWrite Ash's reply to the latest message from " + ((detail.replyTo && detail.replyTo.name) || "them") + "."
  );
}

/* v244.1, Ash: "try medium first; if the call is going to exceed the limit, fall back to low
   and still return a draft. I should never see an error from the button for a timeout."

   The button lives inside a 26-second function, and one medium-effort Opus call can take
   most of that. Trying medium and THEN low would leave low no time. So both start at once:
   medium is given MEDIUM_WAIT_MS to finish, and if it has not (or it failed), the low one —
   by then usually done — is the answer. Whichever loses is cancelled. The morning job has
   fifteen minutes and simply writes at medium. */
const MEDIUM_WAIT_MS = 15000;     // medium's chance, from the moment both start
const BUTTON_DEADLINE_MS = 22500; // everything ends here, inside the 26s wall with room to reply
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function writeOnce(detail, o, effort, signal) {
  return client().messages.create({
    model: MODELS.write,
    max_tokens: 4000,
    output_config: { effort },
    system: systemPrompt(),
    messages: [{ role: "user", content: replyPrompt(detail, o) }],
  }, { signal, maxRetries: 0 }).then(textOf);
}

// Returns { text, effort } — effort says which one was used, for the log and the page.
export async function writeReply(detail, opts) {
  const o = opts || {};
  if (o.mode === "morning") return { text: await writeOnce(detail, o, "medium"), effort: "medium" };

  const started = Date.now();
  const waitMs = o.waitMs || MEDIUM_WAIT_MS, deadlineMs = o.deadlineMs || BUTTON_DEADLINE_MS;   // tests shrink these
  const medStop = new AbortController(), lowStop = new AbortController();
  // settled, never rejecting: a loser that errors after the race must not crash anything
  const settle = (p) => p.then((text) => ({ text }), (err) => ({ err }));
  const med = settle(writeOnce(detail, o, "medium", medStop.signal));
  const low = settle(writeOnce(detail, o, "low", lowStop.signal));
  const stopAll = () => { medStop.abort(); lowStop.abort(); };

  // 1. medium, if it is back in time
  const first = await Promise.race([med, sleep(waitMs).then(() => null)]);
  if (first && first.text) { lowStop.abort(); return { text: first.text, effort: "medium" }; }

  // 2. otherwise low — and if low has failed, whatever medium manages before the deadline
  const left = () => Math.max(0, deadlineMs - (Date.now() - started));
  const second = await Promise.race([low, sleep(left()).then(() => null)]);
  if (second && second.text) { medStop.abort(); return { text: second.text, effort: "low" }; }
  const last = first ? null : await Promise.race([med, sleep(left()).then(() => null)]);
  stopAll();
  if (last && last.text) return { text: last.text, effort: "medium" };

  // Neither in time. Said plainly — the page tries once more by itself before showing it.
  const why = (second && second.err) || (first && first.err) || null;
  const err = new Error(why && !/abort/i.test(String(why.message)) ? why.message : "Claude is slow right now.");
  err.slow = !why || /abort|timeout|overloaded|529|429/i.test(String(why.message));
  throw err;
}

/* ---------- sorting the inbox ----------
   One Sonnet call for the whole morning: who each email is from and whether it gets a draft.
   The skill goes in as well, because its Trigger and Hands-off sections ARE the rules. */
export const CLASSIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["threads"],
  properties: {
    threads: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "kind", "reason"],
        properties: {
          ref: { type: "string" },
          kind: { type: "string", enum: ["lead", "client", "hands_off", "not_client"] },
          reason: { type: "string" },
        },
      },
    },
  },
};

export function classifyPrompt(items) {
  return (
    "Sort each email below for Ash's morning inbox run, using the skill's rules.\n" +
    "kind:\n" +
    "  lead — someone who is not a member yet asking about joining, prices, times, the challenge\n" +
    "  client — a current or past member, about their training, booking, billing or membership\n" +
    "  hands_off — a lead or client email on the skill's Hands-off list (dispute or chargeback, a refund request, hardship / illness / bereavement / money trouble, haggling over price). These are never drafted.\n" +
    "  not_client — anything else: newsletters, notifications, receipts, suppliers, the accountant, landlord, bank, HMRC, software, marketing, automated mail\n" +
    "reason: one short line Ash can read at a glance — for hands_off, what they want; otherwise who it is from and what about.\n" +
    "Return one entry per ref, using the refs exactly as given.\n\n" +
    items.map((it) =>
      "REF " + it.ref + "\nFrom: " + it.from + "\nSubject: " + it.subject + "\n" + clip(it.text, 1500)
    ).join("\n\n=====\n\n")
  );
}

export async function classify(items) {
  if (!items.length) return new Map();
  const msg = await client().messages.create({
    model: MODELS.classify,
    max_tokens: 4000,
    output_config: { effort: "low", format: { type: "json_schema", schema: CLASSIFY_SCHEMA } },
    system: SKILL_TEXT,
    messages: [{ role: "user", content: classifyPrompt(items) }],
  });
  let parsed;
  try { parsed = JSON.parse(textOf(msg)); } catch { throw new Error("Sonnet's sorting could not be read."); }
  const out = new Map();
  for (const t of parsed.threads || []) out.set(String(t.ref), { kind: t.kind, reason: clip(t.reason, 200) });
  return out;
}

/* ---------- the morning run ---------- */
export async function claimRun(trigger) {
  const run = await readJSON(RUN_KEY, {});
  if (run.running && Date.now() - (run.startedAt || 0) < RUN_STALE_MS) return false;
  await writeJSON(RUN_KEY, { ...run, running: true, startedAt: Date.now(), trigger, error: "" });
  return true;
}

async function listIds(q) {
  const r = await gmailGet("threads?" + q);
  return (r.threads || []).map((t) => t.id);
}

// Which threads the run looks at: what the triage labelled as needing a reply, plus anything
// unread in the inbox from the last three days. Each thread once.
async function candidateIds() {
  const labels = await gmailGet("labels");
  const byName = new Map((labels.labels || []).map((l) => [String(l.name), l.id]));
  const lists = await Promise.all([
    ...TRIAGE_LABELS.filter((n) => byName.has(n)).map((n) => listIds("labelIds=" + encodeURIComponent(byName.get(n)) + "&maxResults=15")),
    listIds("q=" + encodeURIComponent(INBOX_QUERY) + "&maxResults=" + MAX_THREADS),
  ]);
  return [...new Set([].concat(...lists))].slice(0, MAX_THREADS);
}

/* Decide what a thread needs, from what is already known. Pure, so it can be tested.
   Returns "skip:<why>" or "classify" (or "known" — already sorted at this message). */
export function triageStep(detail, known) {
  if (!detail || !detail.messages.length) return "skip:empty";
  if (detail.hasDraft) return "skip:has-draft";             // the routine, or Ash, got there first
  if (detail.lastIsMine) return "skip:answered";
  if (!detail.replyTo || !detail.replyTo.email) return "skip:nobody-to-reply-to";
  const last = detail.messages[detail.messages.length - 1];
  if (known && known.lastMsgId === last.id) return "known";  // nothing new since it was sorted
  return "classify";
}

export async function runMorning(opts) {
  const now = (opts && opts.now) || Date.now();
  const log = (opts && opts.log) || (() => {});
  const triage = await readJSON(TRIAGE_KEY, { threads: {} });
  const threads = triage.threads || {};
  const me = await myAddress();
  const counts = { looked: 0, drafted: 0, handsOff: 0, notClient: 0, skipped: 0, failed: 0 };

  const ids = await candidateIds();
  const details = [];
  for (const id of ids) {
    try { details.push(threadDetail(await gmailGet("threads/" + encodeURIComponent(id) + "?format=full"))); }
    catch { counts.failed++; }
  }
  counts.looked = details.length;

  const toSort = [];
  for (const d of details) {
    // a thread where the "other person" is Ash himself (a note to self, a forward) is not a reply
    if (d.replyTo && d.replyTo.email.toLowerCase() === me) { counts.skipped++; continue; }
    const step = triageStep(d, threads[d.id]);
    if (step.startsWith("skip:") || step === "known") { counts.skipped++; continue; }
    const last = d.messages[d.messages.length - 1];
    toSort.push({ ref: String(toSort.length + 1), d, from: last.from, subject: last.subject, text: last.text });
  }

  const sorted = await classify(toSort);
  for (const it of toSort) {
    const d = it.d;
    const last = d.messages[d.messages.length - 1];
    const c = sorted.get(it.ref) || { kind: "not_client", reason: "Sonnet did not sort this one." };
    const rec = { kind: c.kind, reason: c.reason, lastMsgId: last.id, at: now, draftId: "" };
    if (c.kind === "lead" || c.kind === "client") {
      try {
        const { text } = await writeReply(d, { mode: "morning", now });
        const flagged = /^NEEDS ASH:/i.exec(text);
        if (flagged) {
          rec.kind = "hands_off";
          rec.reason = clip(text.replace(/^NEEDS ASH:\s*/i, ""), 200) || c.reason;
          counts.handsOff++;
        } else {
          const raw = buildRaw({
            toName: d.replyTo.name !== d.replyTo.email ? d.replyTo.name : "",
            toEmail: d.replyTo.email, subject: d.replyTo.subject,
            inReplyTo: d.replyTo.messageId, references: d.replyTo.references, text,
          });
          const made = await createDraft(raw, d.id);
          rec.draftId = (made && made.id) || "";
          counts.drafted++;
        }
      } catch (e) {
        rec.error = clip((e && e.message) || "Could not write it.", 200);
        counts.failed++;
      }
    } else if (c.kind === "hands_off") counts.handsOff++;
    else counts.notClient++;
    threads[d.id] = rec;
    log({ thread: d.id, kind: rec.kind, drafted: !!rec.draftId });
  }

  // forget what is long gone, so the record cannot grow without end
  const cutoff = now - TRIAGE_KEEP_DAYS * 86400000;
  for (const [id, r] of Object.entries(threads)) if ((r.at || 0) < cutoff) delete threads[id];
  await writeJSON(TRIAGE_KEY, { threads });
  return counts;
}

/* What the page is shown: the sorting, per thread. Never a draft's text — that is in Gmail,
   which the page reads itself. */
export async function triageForPage() {
  const t = await readJSON(TRIAGE_KEY, { threads: {} });
  const out = {};
  for (const [id, r] of Object.entries(t.threads || {})) out[id] = { kind: r.kind, reason: r.reason, at: r.at, drafted: !!r.draftId, error: r.error || "" };
  return out;
}
