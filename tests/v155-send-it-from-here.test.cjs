// v155 — the reply is sent from the card, not from Gmail.
//
// Ash brought in someone else's dashboard (the "command-center" skill) and asked what it did
// better: "you can see they have the ability to draft and send emails from their dashboard
// and we don't have that." True. Ours listed the decisions and then sent you to Gmail to make
// them — open the thread, find the draft, press Send. Three tabs for a one-word answer.
//
// What changed: a row unfolds. The whole conversation, the draft in full, an editor, Send.
// And where the other dashboard's "AI reply" was a dozen keyword templates, this one asks
// the same Claude proxy the weekly review uses — from the actual thread, with a one-line
// brief from Ash if he wants to give one.
//
// What did NOT change, and is pinned here: the Google scope. `gmail.modify` already covered
// drafting and sending; the page had simply never used it. What the page may DO is still two
// short closed lists — three thread operations and now four send operations — and the store
// is still written in exactly two places, neither of them new.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const DAILY = read("daily.html");
const js = DAILY.slice(DAILY.lastIndexOf("<script>") + 8, DAILY.lastIndexOf("</script>"));
const style = DAILY.slice(DAILY.indexOf("<style>") + 7, DAILY.indexOf("</style>"));
const fn = (name) => {
  const i = js.indexOf("function " + name + "(");
  assert.ok(i >= 0, "function " + name + " exists");
  return js.slice(i, js.indexOf("\n}\n", i) + 3);
};
const between = (a, b) => js.slice(js.indexOf(a), js.indexOf(b));

(async () => {
  /* ================= 0. the stamp ================= */
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(read("monthly.html"));
  // relaxed once v156 shipped: the newest release's test pins the exact stamp.
  assert.ok(Number(stamp[1]) >= 155, "monthly.html is stamped v155 or later");
  const text = "build v" + stamp[1] + " · " + stamp[2];
  for (const f of ["index.html", "finances.html", "daily.html", "social.html"]) {
    assert.ok(read(f).includes(text), f + " carries the same stamp");
  }

  /* ============ 1. the scope is the SAME; the lists of what it may do are closed ============ */
  assert.ok(/GCAL_SCOPE = "https:\/\/www\.googleapis\.com\/auth\/calendar\.events" \+\s*" https:\/\/www\.googleapis\.com\/auth\/gmail\.modify";/.test(js),
    "calendar.events + gmail.modify, exactly as v147 left it — no new consent screen");
  assert.ok(!/gmail\.send|gmail\.compose|auth\/mail\.google\.com/.test(js), "…and no wider scope crept in");
  assert.ok(/const GMAIL_WRITES = \["modify", "trash", "untrash"\];/.test(js), "the three thread operations are unchanged");
  const ops = between("const GMAIL_SEND_OPS = {", "};\nasync function gmailSend");
  const names = [...ops.matchAll(/^\s+([a-zA-Z]+): +\{ method: "([A-Z]+)", +path: /gm)].map((m) => [m[1], m[2]]);
  assert.deepStrictEqual(names, [["createDraft", "POST"], ["updateDraft", "PUT"], ["sendDraft", "POST"], ["sendMessage", "POST"]],
    "four send operations, named, with their methods — and no fifth");
  assert.ok(/"drafts"/.test(ops) && /"drafts\/" \+ encodeURIComponent\(id\)/.test(ops) && /"drafts\/send"/.test(ops) && /"messages\/send"/.test(ops),
    "…each a fixed Gmail path");
  const send = fn("gmailSend");
  assert.ok(/const spec = GMAIL_SEND_OPS\[op\];\s*if \(!spec\) throw/.test(send), "an unknown operation is refused before any request is built");
  assert.ok(/fetch\(GMAIL_BASE \+ spec\.path\(id\), \{\s*method: spec\.method,/.test(send), "…and the request is GMAIL_BASE plus the table's path, nothing else");
  assert.strictEqual((js.match(/GMAIL_BASE \+ spec\.path\(id\)/g) || []).length, 1, "there is one send funnel");
  assert.strictEqual((js.match(/await gmailSend\(/g) || []).length, 5,
    "five call sites: update+send for a draft, send for none, update or create for Save as draft");
  for (const m of js.matchAll(/gmailSend\("([a-zA-Z]+)"/g)) {
    assert.ok(names.some((n) => n[0] === m[1]), "every call names an operation in the table: " + m[1]);
  }
  // the store is still written in exactly two places, and they are the same two
  const storeWrites = [...js.matchAll(/fetch\(API, \{[\s\S]{0,400}?\}\);/g)].map((m) => m[0]);
  assert.strictEqual(storeWrites.length, 2, "the store is written in exactly two places, as before");
  assert.deepStrictEqual(storeWrites.map((w) => /JSON\.stringify\(\{ ([a-zA-Z]+)[:,]/.exec(w)[1]).sort(), ["checkin", "weeklyTick"],
    "…with the same two payloads");
  assert.ok(/const MENTOR = "\/\.netlify\/functions\/mentor-ai";/.test(js), "the AI proxy is a fixed address");
  assert.strictEqual((js.match(/fetch\(MENTOR/g) || []).length, 1, "…used from one place");

  /* ============ 2. the row is a button that unfolds ============ */
  const row = fn("mailItemHtml");
  assert.ok(/'<div class="mail' \+/.test(row) && !/'<a class="mail'/.test(row), "a row is a div, not a link — an editor cannot live inside an anchor");
  assert.ok(/role="button" tabindex="0"/.test(row) && /aria-expanded="' \+ \(open \? "true" : "false"\)/.test(row), "…a keyboard-reachable button that says whether it is open");
  assert.ok(/<a class="mail-tool" href="' \+ esc\(href\) \+ '" target="_blank" rel="noopener"/.test(row) && /Open in Gmail<\/a>/.test(row),
    "Open in Gmail is a real link among the tools, not the only thing a click can do");
  assert.ok(/it\.why && !open \?/.test(row), "the opening line stands in for the email, and goes once the email is on screen");
  assert.ok(/hasDraft && !open\s*\?/.test(row) && /Review and send/.test(row), "the collapsed draft block offers Review and send");
  assert.ok(/\(open \? mailOpenHtml\(it\) : ""\)/.test(row), "an open row renders its conversation and reply");
  const opened = fn("mailOpenHtml");
  assert.ok(/Reading the conversation…/.test(opened), "while the thread loads it says so");
  assert.ok(/mailMsgHtml\(m, i === msgs\.length - 1\)/.test(opened) && /mailReplyHtml\(it, th\)/.test(opened), "then the messages, then the reply");
  const msg = fn("mailMsgHtml");
  assert.ok(/<details class="msg">/.test(msg) && /<div class="msg latest">/.test(msg), "older messages fold; the latest is open");
  assert.ok(/Quoted earlier messages hidden/.test(msg), "…and says when quoted text was cut");
  const reply = fn("mailReplyHtml");
  assert.ok(/<textarea class="reply-text" id="rt_'/.test(reply), "the reply is a plain textarea");
  assert.ok(/data-send="/.test(reply) && /Send reply/.test(reply), "…with Send");
  assert.ok(/data-savedraft="/.test(reply) && /Save as draft/.test(reply), "…Save as draft");
  assert.ok(/data-ai="/.test(reply) && /Write it with Claude/.test(reply) && /Rewrite with Claude/.test(reply), "…and Claude, who writes or rewrites");
  assert.ok(/draftUrl\(th\.draftId\) : threadUrl\(id\)/.test(reply), "…and Gmail's own composer is still one click away");
  assert.ok(/mailReplyText\.has\(id\) \? mailReplyText\.get\(id\) : \(th\.draftBody \|\| ""\)/.test(reply),
    "the box shows what was typed if anything was, else the triage's draft in full");
  assert.ok(/\.mail\.open\{/.test(style) && /\.reply-text\{/.test(style) && /\.msg-body\{white-space:pre-wrap/.test(style), "the styles exist");
  // what is typed is kept the moment it is typed
  const wiring = js.slice(js.indexOf("function wireMailCard"), js.indexOf("READING THE INBOX"));
  assert.ok(/ta\.addEventListener\("input", \(\) => mailReplyText\.set\(id, ta\.value\)\)/.test(wiring),
    "every keystroke lands in mailReplyText, so no re-render can lose it");
  assert.ok(/e\.target\.closest\("\.mail-open"\)/.test(wiring) && /e\.target\.closest\("a"\)/.test(wiring),
    "a click inside the unfolded part, or on a link, does not toggle the row");
  assert.ok(/if \(e\.target !== el\) return;/.test(wiring), "Enter or Space toggles the row only when the row itself has focus");
  for (const id of ["data-send", "data-savedraft", "data-ai", "data-open"]) {
    assert.ok(new RegExp("\\[" + id + "\\]").test(wiring) || new RegExp(id + "\\]").test(wiring), id + " is wired in wireMailCard");
  }
  // the list itself still reads headers only — bodies come one thread at a time, on request
  assert.ok(/format=metadata&metadataHeaders=From&metadataHeaders=Subject/.test(js), "the list is still read as headers only");
  assert.strictEqual((js.match(/\?format=full/g) || []).length, 1, "format=full is asked for in one place…");
  assert.ok(/gmailGet\("threads\/" \+ encodeURIComponent\(threadId\) \+ "\?format=full"\)/.test(fn("mailLoadThread")), "…the open row's own thread");

  /* ============ 3. sending: draft → update + send; none → send ============ */
  const ms = fn("mailSend");
  assert.ok(/if \(th\.draftId\) \{\s*await gmailSend\("updateDraft", th\.draftId, \{ message: \{ raw, threadId \} \}\);\s*await gmailSend\("sendDraft", "", \{ id: th\.draftId \}\);/.test(ms),
    "a thread with a draft: the final text goes into THAT draft, then the draft is sent");
  assert.ok(/\} else \{\s*await gmailSend\("sendMessage", "", \{ raw, threadId \}\);/.test(ms), "a thread without one: a message is sent on the thread");
  assert.ok(/if \(!text\) \{ mailNote\(threadId, "There is nothing in the reply to send\."/.test(ms), "an empty box does not send");
  assert.ok(/if \(mailBusy\.has\(threadId\)\) return;/.test(ms), "a double click does not send twice");
  assert.ok(/Your text is still here/.test(ms), "a failed send keeps the text and says so");
  assert.ok(/mailUndo = \{ kind: "sent"/.test(ms), "a sent reply announces itself on the card");
  assert.ok(/removeLabelIds: \["UNREAD"\]\.concat\(labelId \? \[labelId\] : \[\]\)/.test(ms), "…and the thread leaves the list as read and unlabelled");
  const undo = between("if (mailUndo) {", "// The stale-brief warning");
  assert.ok(/mailUndo\.kind === "sent" \? "" : '<button type="button" class="undobtn" id="mailUndoBtn">Undo<\/button>'/.test(undo),
    "a sent email offers no Undo button — it cannot be unsent, and a false button is worse than none");
  const save = fn("mailSaveDraft");
  assert.ok(/gmailSend\("updateDraft", th\.draftId/.test(save) && /gmailSend\("createDraft", "", \{ message: \{ raw, threadId \} \}\)/.test(save),
    "Save as draft updates the existing draft or creates one on the thread");
  assert.ok(/th\.draftId = \(made && made\.id\) \|\| "";/.test(save), "…and remembers the new draft's id so the next Send uses it");

  /* ============ 4. Claude writes; nothing leaves without Send ============ */
  const ask = fn("mailAskClaude");
  assert.ok(!/gmailSend|gmailWrite/.test(ask), "asking Claude never touches Gmail");
  assert.ok(/ta\.value = text;\s*mailReplyText\.set\(threadId, text\);/.test(ask), "the answer fills the box, and only the box");
  assert.ok(/model: "opus", maxTokens: 900, effort: "low"/.test(ask), "a short reply at low effort — quick, not a board report");
  assert.ok(/Your text is unchanged/.test(ask), "a failure leaves what was there");
  const prompt = fn("mailAiPrompt");
  assert.ok(/on behalf of Ash, who owns Bodysculpt, a gym in Warrington/.test(prompt), "Claude knows whose voice it is");
  assert.ok(/sign off as Ash/.test(prompt) && /no placeholders in square brackets/.test(prompt), "…writes a finished reply, not a template");
  assert.ok(/Do not invent facts, prices, dates or availability/.test(prompt), "…and does not make things up");
  assert.ok(/There is already a draft\. Rewrite it/.test(prompt) && /What Ash wants this reply to say/.test(prompt), "…rewrites when there is a draft, and takes a brief");
  assert.ok(/MAIL_AI_THREAD_CHARS = 9000/.test(js) && /\.slice\(-MAIL_AI_THREAD_CHARS\)/.test(prompt), "a very long thread is trimmed from the front, keeping the newest");

  /* ============ 5. honest copy ============ */
  const setup = fn("mailSetupHtml");
  assert.ok(!/Read is all it can do/.test(setup), "the connect card no longer claims the page is read-only");
  assert.ok(/sends a reply <b>only when you press Send<\/b>/.test(setup) && /cannot permanently delete anything/.test(setup),
    "…it says what the page does with the permission, and what it cannot");
  assert.ok(!/READ ONLY\. `gmail\.readonly`/.test(js), "the v143 comment no longer says read only");

  /* ============ 6. the pure parts, run for real ============ */
  const src = between("/* ---------- reading one thread in full ---------- */", "/* ---------- send, save, ask ---------- */") +
    fn("gmSender") + between("const gmHeader = (msg, name) => {", "// \"Karen Whitfield") + fn("mailAiPrompt") + "\nconst MAIL_AI_THREAD_CHARS = 9000;\n";
  const ctx = vm.createContext({ atob, btoa, TextEncoder, TextDecoder, Uint8Array, console,
    mailThreads: new Map(), mailOpenId: null, renderMail() {}, gmailGet: async () => ({}) });
  vm.runInContext(src + "\nthis.out = { gmAddress, gmBody, gmHtmlToText, gmVisible, gmBuildReply, gmB64Url, gmThreadDetail, mailAiPrompt };", ctx);
  const { gmAddress, gmBody, gmHtmlToText, gmVisible, gmBuildReply, gmThreadDetail, mailAiPrompt } = ctx.out;
  const b64url = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const fromB64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

  // addresses
  assert.strictEqual(gmAddress("Karen Whitfield <karen@co.uk>"), "karen@co.uk");
  assert.strictEqual(gmAddress("karen@co.uk"), "karen@co.uk");
  assert.strictEqual(gmAddress('"Whitfield, Karen" <k.w@co.uk>'), "k.w@co.uk");

  // bodies: text/plain wins, nested parts are walked, html is flattened
  const plain = { mimeType: "text/plain", body: { data: b64url("Hi Ash,\r\n\r\nIs Tuesday ok?\r\n") } };
  const html = { mimeType: "text/html", body: { data: b64url("<div>Hi Ash,<br><br>Is <b>Tuesday</b> ok?&nbsp;&amp; Wed</div><style>p{}</style>") } };
  assert.strictEqual(gmBody({ mimeType: "multipart/alternative", parts: [html, plain] }), "Hi Ash,\n\nIs Tuesday ok?", "text/plain is preferred whatever the order");
  assert.strictEqual(gmBody({ mimeType: "multipart/mixed", parts: [{ mimeType: "multipart/alternative", parts: [html] }] }),
    "Hi Ash,\n\nIs Tuesday ok? & Wed", "html is flattened when there is no text, however deep it sits");
  assert.strictEqual(gmHtmlToText("<ul><li>one</li><li>two</li></ul><p>x &#39;y&#x27;</p>"), "- one\n- two\nx 'y'");
  assert.strictEqual(gmBody(plain), "Hi Ash,\n\nIs Tuesday ok?", "a bare part works too");
  assert.strictEqual(gmBody({}), "", "nothing is an empty string, not a crash");

  // quoted text: ">" lines and everything under "On … wrote:", including the wrapped kind
  let v = gmVisible("Yes please.\n\nOn Mon, 14 Sep 2026 at 09:12, Ash\n<ash@bodysculptwarrington.com> wrote:\n> Can you do Tuesday?\n> Ash");
  assert.deepStrictEqual({ ...v }, { text: "Yes please.", hidden: true }, "the reply alone, with the quote cut — even when Gmail wraps the 'On … wrote:' line");
  v = gmVisible("Line one\n> old\nLine two");
  assert.deepStrictEqual({ ...v }, { text: "Line one\nLine two", hidden: true });
  v = gmVisible("Just this.");
  assert.deepStrictEqual({ ...v }, { text: "Just this.", hidden: false }, "nothing cut, and it says so");
  v = gmVisible("Thanks\n\nFrom: Karen\nSent: Monday\nSubject: x\n\nold stuff");
  assert.deepStrictEqual({ ...v }, { text: "Thanks", hidden: true }, "Outlook's header block is a quote too");

  // the message that goes
  let raw = fromB64url(gmBuildReply({ toName: "Karen Whitfield", toEmail: "karen@co.uk", subject: "Tuesday session",
    inReplyTo: "<abc@mail.gmail.com>", references: "<first@x>", text: "Yes, Tuesday works.\n\nAsh" }));
  const cut = raw.indexOf("\r\n\r\n");
  const head = raw.slice(0, cut), body = raw.slice(cut + 4);
  const hl = head.split("\r\n");
  assert.ok(hl.includes("To: Karen Whitfield <karen@co.uk>"), "To carries the name and the address");
  assert.ok(hl.includes("Subject: Re: Tuesday session"), "Re: is added");
  assert.ok(hl.includes("In-Reply-To: <abc@mail.gmail.com>"), "In-Reply-To names the message it answers");
  assert.ok(hl.includes("References: <first@x> <abc@mail.gmail.com>"), "References is the old chain plus that message");
  assert.ok(hl.includes("Content-Type: text/plain; charset=utf-8"), "plain text, utf-8");
  assert.strictEqual(body, "Yes, Tuesday works.\r\n\r\nAsh", "the body is what was typed, with mail line endings");
  raw = fromB64url(gmBuildReply({ toName: "", toEmail: "k@x.com", subject: "RE: already", text: "ok" }));
  assert.ok(/^Subject: RE: already$/m.test(raw), "Re: is not doubled");
  assert.ok(/^To: k@x\.com$/m.test(raw), "no name means the bare address");
  assert.ok(!/In-Reply-To/.test(raw), "no message id means no threading headers, not empty ones");
  raw = fromB64url(gmBuildReply({ toName: "Zoë", toEmail: "z@x.com", subject: "Café — £10 credit", text: "£10 it is" }));
  assert.ok(/^To: z@x\.com$/m.test(raw), "a name that is not plain ASCII is dropped rather than sent wrongly");
  assert.ok(/^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/m.test(raw), "a subject that is not plain ASCII is encoded the standard way");
  assert.strictEqual(Buffer.from(/=\?UTF-8\?B\?([^?]+)\?=/.exec(raw)[1], "base64").toString("utf8"), "Re: Café — £10 credit", "…and decodes back to itself");
  assert.ok(raw.endsWith("£10 it is"), "the body carries the £ as utf-8");

  // a thread, as Gmail hands it back
  const M = (id, from, labels, text, extra) => ({ id, labelIds: labels, internalDate: String(1700000000000 + Number(id.slice(1)) * 1000),
    payload: { mimeType: "text/plain", headers: [{ name: "From", value: from }, { name: "Subject", value: "Re: Sessions" },
      { name: "Message-ID", value: "<" + id + "@x>" }].concat(extra || []), body: { data: b64url(text) } } });
  const th = gmThreadDetail({ id: "t1", messages: [
    M("m1", "Karen <karen@co.uk>", ["INBOX"], "Can I move Tuesday?"),
    M("m2", "Ash <ash@bodysculptwarrington.com>", ["SENT"], "Which day suits?"),
    M("m3", "Karen <karen@co.uk>", ["INBOX", "UNREAD"], "Thursday?", [{ name: "Reply-To", value: "Karen Mobile <km@co.uk>" }, { name: "References", value: "<m1@x> <m2@x>" }]),
    M("d1", "Ash <ash@bodysculptwarrington.com>", ["DRAFT"], "Thursday is fine — see you at 6.\n\nAsh"),
  ] });
  assert.deepStrictEqual(Array.from(th.messages, (m) => m.id), ["m1", "m2", "m3"], "the draft is not part of the conversation");
  assert.deepStrictEqual(Array.from(th.messages, (m) => m.mine), [false, true, false], "SENT is what makes a message mine");
  assert.strictEqual(th.draftId, "d1", "the draft is kept aside…");
  assert.strictEqual(th.draftBody, "Thursday is fine — see you at 6.\n\nAsh", "…in full, for the editor");
  assert.strictEqual(th.replyTo.email, "km@co.uk", "the reply goes to Reply-To when they set one");
  assert.strictEqual(th.replyTo.name, "Karen Mobile");
  assert.strictEqual(th.replyTo.messageId, "<m3@x>", "…answering their latest message");
  assert.strictEqual(th.replyTo.references, "<m1@x> <m2@x>");
  const mineLast = gmThreadDetail({ id: "t2", messages: [M("m1", "Karen <karen@co.uk>", [], "Hi"), M("m2", "Ash <a@b.com>", ["SENT"], "Hello")] });
  assert.strictEqual(mineLast.replyTo.email, "karen@co.uk", "when the last message is mine, the reply still goes to them");
  assert.strictEqual(gmThreadDetail({ messages: [] }).replyTo, null, "an empty thread has nobody to reply to");
  // the prompt Claude gets
  const p = mailAiPrompt(th, "", "say yes but 6.30 not 6");
  assert.ok(/--- Karen, 2023-11-14 ---\nCan I move Tuesday\?/.test(p) && /--- Ash \(me\)/.test(p), "the conversation is laid out with who said what");
  assert.ok(/What Ash wants this reply to say: say yes but 6\.30 not 6/.test(p), "…and the brief");
  assert.ok(!/There is already a draft/.test(p), "no draft, no rewrite instruction");
  assert.ok(/There is already a draft/.test(mailAiPrompt(th, "old text", "")), "a draft asks for a rewrite");

  /* ============ 7. v155.1: a hidden thing says it is hidden ============
     Ash, over a card reading "Nothing needs a reply" with FYI 8 and nothing else: "Any ideas
     why it's showing NO emails that need a reply?" Because Unread only was ticked and every
     Urgent/Today thread had been read — and a tier with nothing unread simply did not render.
     Gmail's own per-label counts were already on hand; they just were not being shown. */
  const render = fn("renderMail");
  assert.ok(/const readOnly = mailUnreadOnly && src\.source !== "brief" && !!st && st\.total - st\.unread > 0;\s*if \(!mine\.length && !readOnly\) continue;/.test(render),
    "a tier with nothing unread but something read still renders its heading");
  assert.ok(/readHidden \? readHidden \+ " already read/.test(render) && /untick Unread only to see/.test(render),
    "…and the first line counts the hidden ones instead of saying nothing");
  assert.ok(/readHidden = \(mailUnreadOnly && src\.source !== "brief"\)/.test(render) && /t\.id !== "fyi"/.test(render),
    "the hidden count is exact (labels.list) and excludes FYI, which never needed a reply");
  const tierH = fn("tierHtml");
  assert.ok(/\(items\.length \? "" : " \\u2014 untick Unread only to see " \+ \(hidden === 1 \? "it" : "them"\)\)/.test(tierH),
    "an all-read tier's heading says how to see them");
  assert.ok(/if \(!items\.length\) return '<div class="tier tier-' \+ esc\(tier\.id\) \+ '">' \+ head \+ "<\/div>";/.test(tierH),
    "an all-read FYI tier is a heading with no toggle to show nothing");

  console.log("v155-send-it-from-here.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
