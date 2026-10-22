// netlify/lib/gmail.js  (v244)
//
// Gmail, from the SERVER. Until v244 only the page talked to Gmail, with the hour's token
// google-auth.js hands a connected browser. The morning draft job runs with nobody's browser
// open, so it reads the same long-lived credential google-auth.js keeps (store
// `bodysculpt-kpi`, keys `google-auth` / `google-auth-access`) and renews the hour's pass the
// same way. Nothing new is asked of Google: the permission is still gmail.modify.
//
// WHAT THIS FILE MAY DO TO MAIL, and it is a short list on purpose:
//   read           threads, messages, a search
//   createDraft    a NEW draft (on a thread, or a fresh email to a member)
// There is no send here, no update of an existing draft, no label change and no delete. A
// draft Ash has edited can therefore never be overwritten by the job, and nothing the job
// writes can leave the Drafts folder without Ash pressing Send himself.
//
// The parsing below is the page's own (daily.html gmThreadDetail / gmVisible / gmBuildReply),
// ported to Node, so the server and the page read an email the same way.
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me/";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const KEY_GRANT = "google-auth";
const KEY_ACCESS = "google-auth-access";
const KEY_DEVICES = "google-auth-devices";
const ACCESS_SLACK_MS = 2 * 60 * 1000;

const authStore = () => getStore({ name: "bodysculpt-kpi", consistency: "strong" });
const hash = (s) => createHash("sha256").update(String(s)).digest("hex");

/* ---------- who may ask ----------
   This site has no login. Anything that reads Ash's mail, or writes a draft into it, asks for
   the same DEVICE KEY google-auth.js gives a browser that completed Google's sign-in as Ash
   (header X-Device-Key). A stranger with the URL gets nothing. */
export async function deviceOk(req) {
  const key = String((req.headers && req.headers.get("x-device-key")) || "");
  if (!/^[0-9a-f]{64}$/.test(key)) return false;
  const devices = (await authStore().get(KEY_DEVICES, { type: "json" })) || {};
  return !!devices[hash(key)];
}

/* ---------- the hour's pass ---------- */
export async function accessToken() {
  const store = authStore();
  const cached = (await store.get(KEY_ACCESS, { type: "json" })) || null;
  if (cached && cached.token && cached.expires - ACCESS_SLACK_MS > Date.now()) return cached.token;
  const grant = (await store.get(KEY_GRANT, { type: "json" })) || null;
  if (!grant || !grant.refreshToken) throw new Error("Google is not connected — press Connect Gmail on the Daily page once.");
  const clientId = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error("GOOGLE_CLIENT_SECRET is not set in Netlify.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: grant.refreshToken, client_id: clientId, client_secret: secret, grant_type: "refresh_token" }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  // A dead credential is google-auth.js's to record and explain; this only says so.
  if (!res.ok) throw new Error("Google would not renew the sign-in (" + (body.error || res.status) + ") — connect Gmail again on the Daily page.");
  const expires = Date.now() + (Number(body.expires_in) || 3600) * 1000;
  await store.set(KEY_ACCESS, JSON.stringify({ token: body.access_token, expires, scope: body.scope || grant.scope || "" }));
  return body.access_token;
}

async function call(path, init) {
  const token = await accessToken();
  const res = await fetch(GMAIL + path, {
    ...(init || {}),
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((body && body.error && body.error.message) || ("Gmail returned " + res.status));
    err.status = res.status;
    throw err;
  }
  return body;
}

export const gmailGet = (path) => call(path);
// The ONE write. A new draft; never an update, never a send.
export const createDraft = (raw, threadId) =>
  call("drafts", { method: "POST", body: JSON.stringify({ message: threadId ? { raw, threadId } : { raw } }) });

export async function myAddress() {
  const p = await call("profile");
  return String(p.emailAddress || "").toLowerCase();
}

/* ---------- reading a message ---------- */
export const header = (msg, name) => {
  const hs = (msg && msg.payload && msg.payload.headers) || [];
  const h = hs.find((x) => String(x.name).toLowerCase() === name);
  return h ? String(h.value) : "";
};
export function senderName(raw) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw || "");
  if (m && m[1].trim()) return m[1].trim();
  if (m) return m[2].trim();
  return (raw || "").trim();
}
export function address(raw) {
  const m = /<([^>]+)>/.exec(raw || "");
  if (m) return m[1].trim();
  const bare = /[^\s"<>,;]+@[^\s"<>,;]+/.exec(raw || "");
  return bare ? bare[0] : String(raw || "").trim();
}
const decode = (data) => {
  try { return Buffer.from(String(data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); }
  catch { return ""; }
};
function htmlToText(html) {
  return String(html || "")
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
export function bodyText(payload) {
  const find = (p, type) => {
    if (!p) return null;
    if (p.mimeType === type && p.body && p.body.data) return p.body.data;
    for (const c of p.parts || []) { const f = find(c, type); if (f) return f; }
    return null;
  };
  const plain = find(payload, "text/plain");
  if (plain) return decode(plain).replace(/\r\n/g, "\n").trim();
  const html = find(payload, "text/html");
  return html ? htmlToText(decode(html)) : "";
}
// What they actually wrote: the quoted history underneath is cut, as the page cuts it.
export function visible(text) {
  const lines = String(text || "").split("\n");
  const keep = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const wroteAhead = /^\s*On\b/.test(l) && [1, 2, 3].some((k) => /wrote:\s*$/.test(lines.slice(i, i + k).join(" ").trimEnd()));
    if (wroteAhead || /^\s*-{2,}\s*(Original|Forwarded) Message\s*-{2,}/i.test(l) ||
        (/^\s*From: /.test(l) && /^\s*(Sent|Date): /.test(lines[i + 1] || ""))) break;
    if (/^\s*>/.test(l)) continue;
    keep.push(l);
  }
  return keep.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const isDraft = (m) => (m.labelIds || []).includes("DRAFT");
const isSent = (m) => (m.labelIds || []).includes("SENT");

/* One thread (format=full) -> what a reply needs. Same shape as the page's gmThreadDetail. */
export function threadDetail(thread) {
  const msgs = (thread.messages || []).filter(Boolean);
  const real = msgs.filter((m) => !isDraft(m)).map((m) => {
    const from = header(m, "from");
    return {
      id: m.id,
      fromName: senderName(from),
      fromEmail: address(from).toLowerCase(),
      replyToRaw: header(m, "reply-to"),
      from,
      subject: header(m, "subject"),
      messageId: header(m, "message-id"),
      references: header(m, "references"),
      mine: isSent(m),
      at: Number(m.internalDate) || 0,
      text: visible(bodyText(m.payload)),
    };
  });
  const target = real.slice().reverse().find((m) => !m.mine) || null;
  const toRaw = target ? (target.replyToRaw || target.from) : "";
  return {
    id: thread.id,
    messages: real,
    hasDraft: msgs.some(isDraft),
    lastIsMine: real.length ? real[real.length - 1].mine : false,
    labelIds: [].concat(...msgs.map((m) => m.labelIds || [])),
    replyTo: target ? { name: senderName(toRaw), email: address(toRaw), subject: target.subject,
      messageId: target.messageId, references: target.references } : null,
  };
}

/* The conversation as Claude reads it, oldest first, newest kept when it is long. */
export function conversationText(messages, maxChars) {
  return messages.map((m) =>
    "--- " + (m.mine ? "Ash (me)" : (m.fromName || m.fromEmail || "them")) +
    (m.at ? ", " + new Date(m.at).toISOString().slice(0, 10) : "") + " ---\n" + (m.text || "(no text)")
  ).join("\n\n").slice(-(maxChars || 9000));
}

/* ---------- the message that is drafted ----------
   Plain text, UTF-8, base64url. As daily.html gmBuildReply builds it, plus a mode for a
   FRESH email (no In-Reply-To) — the first chase to a member is not a reply to anything. */
const headerWord = (s) => /^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + Buffer.from(s, "utf8").toString("base64") + "?=";
export function buildRaw(r) {
  let subject = String(r.subject || "").trim();
  if (r.inReplyTo && !/^\s*re:/i.test(subject)) subject = "Re: " + subject;
  const to = r.toName && /^[\x20-\x7e]*$/.test(r.toName) && !/[<>",]/.test(r.toName)
    ? r.toName + " <" + r.toEmail + ">" : r.toEmail;
  const lines = [
    "To: " + to,
    "Subject: " + headerWord(subject),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
  ];
  if (r.inReplyTo) {
    lines.push("In-Reply-To: " + r.inReplyTo);
    lines.push("References: " + ((r.references ? r.references + " " : "") + r.inReplyTo).trim());
  }
  const msg = lines.join("\r\n") + "\r\n\r\n" + String(r.text || "").replace(/\r?\n/g, "\r\n");
  return Buffer.from(msg, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
