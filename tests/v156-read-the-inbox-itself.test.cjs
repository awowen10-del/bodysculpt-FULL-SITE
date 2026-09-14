// v156 — the card reads the inbox itself.
//
// Ash: "for this to work it assumes Claude is triaging all my emails first but for instance
// that hasn't happened this morning." A card that is a view of four labels is empty on any
// morning the job did not run, however full the inbox is. He asked for the other dashboard's
// approach — read the inbox, live — and that is what this is, with one thing kept: a thread
// the triage HAS labelled still sits under its tier. The rest of the unread inbox is ranked
// the other dashboard's way (a keyword score, noise pushed down) into Inbox and Everything
// else. No label is written by this page; the scheduled triage still owns them.
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
  // relaxed once v157 shipped: the newest release's test pins the exact stamp.
  assert.ok(Number(stamp[1]) >= 156, "monthly.html is stamped v156 or later");
  const text = "build v" + stamp[1] + " · " + stamp[2];
  for (const f of ["index.html", "finances.html", "daily.html", "social.html"]) {
    assert.ok(read(f).includes(text), f + " carries the same stamp");
  }

  /* ============ 1. the inbox is read, and no labels is not an error ============ */
  const load = fn("loadGmail");
  assert.ok(/gmailGet\("threads\?q=" \+ encodeURIComponent\(mailUnreadOnly \? GM_INBOX_QUERY_UNREAD : GM_INBOX_QUERY_ALL\)/.test(load),
    "the inbox itself is listed, by query");
  assert.ok(/const GM_INBOX_QUERY_UNREAD = "in:inbox is:unread";/.test(js), "…unread and in the inbox, as the other dashboard reads it");
  assert.ok(/const GM_INBOX_QUERY_ALL = "in:inbox newer_than:14d";/.test(js), "…or the last fortnight when Unread only is off");
  assert.ok(/gmailGet\("threads\?labelIds="/.test(load), "the four Triage labels are still listed too");
  assert.ok(!/mailError = "none"/.test(js) && !/missing\.length === TIERS\.length/.test(load),
    "no Triage labels at all is no longer a dead end — the inbox is read regardless");
  assert.ok(/const seen = new Set\(\);/.test(load) && /if \(seen\.has\(id\)\) continue;/.test(load),
    "a thread on both a label and the inbox is read once");
  assert.ok(/format=metadata&metadataHeaders=From&metadataHeaders=Subject/.test(load), "…headers only, as before");
  assert.ok(/\(b\.score \|\| 0\) - \(a\.score \|\| 0\) \|\| String\(b\.receivedAt\)\.localeCompare\(String\(a\.receivedAt\)\)/.test(load),
    "ranked by score, then newest first");
  // the scope and the funnels did not move
  assert.ok(/GCAL_SCOPE = "https:\/\/www\.googleapis\.com\/auth\/calendar\.events" \+\s*" https:\/\/www\.googleapis\.com\/auth\/gmail\.modify";/.test(js), "the scope is unchanged");
  assert.ok(/const GMAIL_WRITES = \["modify", "trash", "untrash"\];/.test(js), "…and the thread operations");
  assert.ok(!/addLabelIds[^\n]*mailLabelIds|gmPriority[^\n]*gmailWrite/.test(js), "this page writes no Triage label of its own");

  /* ============ 2. the two live sections, and the order ============ */
  assert.ok(/const LIVE_TIERS = \[\s*\{ id: "inbox", name: "Inbox",\s+href: GMAIL \+ "inbox"/.test(js), "Inbox is a section that links to the inbox");
  assert.ok(/\{ id: "other", name: "Everything else",\s+href: GMAIL \+ "inbox",[^\n]*fold: true \}/.test(js), "Everything else is a folded section");
  assert.ok(/const MAIL_ORDER = \["urgent", "today", "inbox", "week", "fyi", "other"\];/.test(js),
    "urgent, today, what has just landed, the rest of the week, then the two piles");
  const render = fn("renderMail");
  assert.ok(/for \(const tier of MAIL_ORDER\.map\(tierById\)\)/.test(render), "…and that is the order rendered");
  assert.ok(/i\.tier !== "fyi" && i\.tier !== "other"/.test(render), "Everything else does not count as needing you");
  const tierH = fn("tierHtml");
  assert.ok(/tier\.label \? labelUrl\(tier\.label\) : tier\.href/.test(tierH), "a live section's Open in Gmail goes to the inbox, not a label it has not got");
  assert.ok(/if \(tier\.id === "fyi" \|\| tier\.fold\)/.test(tierH) && /"otherToggle"/.test(tierH), "either pile folds to a count");
  const wiring = js.slice(js.indexOf("function wireMailCard"), js.indexOf("READING THE INBOX"));
  assert.ok(/\$\("otherToggle"\)/.test(wiring) && /otherOpen = !otherOpen/.test(wiring), "…and the second toggle is wired");
  assert.ok(/\.tier-inbox  \.tier-dot\{background:var\(--orange\);\}/.test(style) && /\.tier-other  \.mail\{border-left-color:var\(--line\);\}/.test(style), "the sections have their colours");
  // the page's own four tiers are exactly what they were (v135 pins them against the store)
  const pageTiers = [...js.matchAll(/\{ id: "([a-z]+)",\s+name: "([^"]+)",\s+label: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(pageTiers, ["urgent", "today", "week", "fyi"], "the four labelled tiers are untouched");
  assert.ok(!/Your inbox has no Triage labels on it yet/.test(js), "the 'no labels' message is gone with the state");
  assert.ok(/Nothing unread in your inbox\./.test(js), "an empty unread inbox says so");

  /* ============ 3. the ranking and the tier decision, run for real ============ */
  const src = "const GMAIL = 'https://mail.google.com/mail/u/0/#';\nvar mailLabelIds = { urgent: 'Label_21', today: 'Label_22', week: 'Label_23', fyi: 'Label_24' };\n" +
    between("const TIERS = [", "const labelUrl = ") +
    between("const gmHeader = (msg, name) => {", "// \"Karen Whitfield") + fn("gmSender") + fn("gmThreadToItem");
  const ctx = vm.createContext({ console });
  vm.runInContext(src + "\nthis.out = { gmPriority, gmThreadToItem };", ctx);
  const { gmPriority, gmThreadToItem } = ctx.out;

  assert.strictEqual(gmPriority("Karen <k@x> Re: cancel next week", []), 2, "one hit is +2");
  assert.strictEqual(gmPriority("Karen <k@x> Re: PT session next week", []), 4, "two hits are +4");
  assert.strictEqual(gmPriority("Your receipt — ideal, accepted", []), 0, "whole words only: receipt is not pt, ideal is not deal");
  assert.strictEqual(gmPriority("Karen <k@x> direct debit failed", []), 2, "a two-word entry matches as a phrase");
  assert.strictEqual(gmPriority("Karen <k@x> invoice for the deal", ["IMPORTANT"]), 7, "two hits and Important is 2+2+3");
  assert.ok(gmPriority("Newsletter: 10 tips <noreply@shop.com>", []) < 0, "newsletter and noreply sink it, once");
  assert.ok(gmPriority("Great deal on shoes", ["CATEGORY_PROMOTIONS"]) < 0, "so does Gmail's own Promotions tab, even with a hot word");
  assert.strictEqual(gmPriority("hello there", []), 0, "nothing either way is zero");

  const M = (id, from, labels, subject, snippet) => ({ id, labelIds: labels, internalDate: String(1700000000000 + Number(id.slice(1)) * 1000), snippet,
    payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] } });
  const labelled = gmThreadToItem({ id: "t1", messages: [M("m1", "K <k@x>", ["INBOX", "UNREAD", "Label_22"], "Anything", "")] }, "inbox");
  assert.strictEqual(labelled.tier, "today", "a thread carrying a Triage label goes under its tier, whichever list found it");
  assert.strictEqual(labelled.score, 0, "…and is not scored");
  const fromLabelList = gmThreadToItem({ id: "t1", messages: [M("m1", "K <k@x>", ["INBOX", "Label_21"], "x", "")] }, "urgent");
  assert.strictEqual(fromLabelList.tier, "urgent", "a thread found under a label keeps that tier");
  const hot = gmThreadToItem({ id: "t2", messages: [M("m1", "Karen <k@x>", ["INBOX", "UNREAD", "IMPORTANT"], "Can I book a PT session?", "and pay the invoice")] }, "inbox");
  assert.strictEqual(hot.tier, "inbox", "an unlabelled thread that looks like it needs you is Inbox");
  assert.ok(hot.score >= 7, "…with its score carried for the sort: " + hot.score);
  const noise = gmThreadToItem({ id: "t3", messages: [M("m1", "Shop <noreply@shop.com>", ["INBOX", "UNREAD", "CATEGORY_PROMOTIONS"], "Sale ends today", "unsubscribe")] }, "inbox");
  assert.strictEqual(noise.tier, "other", "an unlabelled thread that looks like noise is Everything else");
  const plain = gmThreadToItem({ id: "t4", messages: [M("m1", "Bob <b@x>", ["INBOX", "UNREAD"], "Hi", "just saying hello")] }, "inbox");
  assert.strictEqual(plain.tier, "inbox", "a plain unlabelled email is Inbox, not hidden — zero is not noise");
  const late = gmThreadToItem({ id: "t5", messages: [M("m1", "K <k@x>", ["INBOX"], "old", ""), M("m2", "K <k@x>", ["INBOX", "UNREAD", "Label_24"], "new", "")] }, "inbox");
  assert.strictEqual(late.tier, "fyi", "a label on any message in the thread counts");

  console.log("v156-read-the-inbox-itself.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
