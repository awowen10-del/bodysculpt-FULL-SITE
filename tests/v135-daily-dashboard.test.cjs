// v135 — the Daily Dashboard.
//
// Ash: "I need it to be even more accessible … a simple opportunity to see things that are
// important to me on a daily basis including: access to emails and access to disputed or
// failed payments on Stripe … I already have a daily email triage set up in the scheduled
// jobs on Claude, is there a way to integrate that? … a hierarchy of importance list on my
// dashboard would be good."
//
// So: a fifth page, first in the top nav, that reads two feeds and writes nothing.
//   · EMAIL  — the scheduled triage already labels the inbox Triage/Urgent, Triage/Today,
//              Triage/This week, Triage/FYI. Those four labels ARE the hierarchy, so they
//              are the page's four tiers and the store's four accepted values. The job
//              sends a digest to kpi-store under `daily-briefs`; the page reads it back.
//   · MONEY  — netlify/functions/stripe-feed, which keeps the Stripe key server-side.
//
// The claim this file exists to defend, above everything else: **daily.html cannot write.**
// The live blob store holds the KPI history and the quarterly reviews with no backup, and
// this is the page that will sit open in a tab all day. So it gets exactly one fetch, that
// fetch takes no options, and there is no second argument anywhere it could grow one.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const DAILY = read("daily.html");
const STORE_SRC = path.join(__dirname, "..", "netlify", "functions", "kpi-store.js");
const STRIPE_SRC = read(path.join("netlify", "functions", "stripe-feed.js"));
const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));
const scriptOf = (src) => src.slice(src.lastIndexOf("<script>") + 8, src.lastIndexOf("</script>"));

/* The blob store, faked — the same shape tests/v122-store-isolation.test.cjs uses. */
function fakeStore(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    _m: m,
    async get(k, o) { const v = m.get(k); if (v === undefined) return null;
      return (o && o.type === "json") ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, v); },
    async list(o) { const p = (o && o.prefix) || "";
      return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })), directories: [] }; },
  };
}
async function loadHandler() {
  const src = fs.readFileSync(STORE_SRC, "utf8");
  const patched = src.replace(/^import \{ getStore \} from "@netlify\/blobs";$/m,
    "const getStore = () => globalThis.__fakeStore;");
  const tmp = path.join(os.tmpdir(), "kpi-store-v135-" + process.pid + ".mjs");
  fs.writeFileSync(tmp, patched);
  const mod = await import("file://" + tmp);
  fs.unlinkSync(tmp);
  return mod.default;
}
const GET = (h, qs) => h(new Request("https://x/.netlify/functions/kpi-store?" + qs));
const POST = (h, body) => h(new Request("https://x/.netlify/functions/kpi-store",
  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

/* The Stripe function, with fetch faked, so the routes and the shaping under test are
   exactly what ships. */
async function loadStripe(env, responder) {
  const tmp = path.join(os.tmpdir(), "stripe-feed-v135-" + process.pid + ".mjs");
  fs.writeFileSync(tmp, STRIPE_SRC);
  const mod = await import("file://" + tmp + "?v=" + Math.random());
  fs.unlinkSync(tmp);
  const savedEnv = { ...process.env };
  const savedFetch = globalThis.fetch;
  for (const k of ["STRIPE_SECRET_KEY", "STRIPE_API_KEY"]) delete process.env[k];
  Object.assign(process.env, env || {});
  if (responder) globalThis.fetch = async (url) => ({ ok: true, status: 200, json: async () => responder(String(url)) });
  try {
    const res = await mod.default(new Request("https://x/.netlify/functions/stripe-feed"));
    return { res, body: await res.json() };
  } finally {
    globalThis.fetch = savedFetch;
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    Object.assign(process.env, savedEnv);
  }
}

(async () => {
  /* ================= 0. the stamp — this is the newest release, so it is exact =========== */
  const MONTHLY = read("monthly.html");
  // relaxed once v136 shipped: the newest release's test pins the exact stamp, this one
  // only checks the build never goes backwards and that the pages still agree on it.
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(MONTHLY);
  assert.strictEqual(stamp[1], "147", "monthly.html is stamped v147");
  assert.strictEqual(stamp[2], "not-for-me", "…as the release that let him clear things off");
  const text = "build v" + stamp[1] + " · " + stamp[2];
  for (const f of ["index.html", "finances.html", "daily.html"]) {
    assert.ok(read(f).includes(text), f + " carries the same stamp");
  }

  /* ================= 1. THE STORE IS READ-ONLY FROM THIS PAGE =================
     v135 stated this as "daily.html contains no POST". That was a proxy for the thing that
     matters, and v136's calendar breaks the proxy without touching the thing — creating a
     Google Calendar event cannot reach a KPI week. So the precise version of the claim now
     lives in tests/v136-calendar-and-social.test.cjs, which pins BOTH halves: every store
     read goes through jget with no options, and everything carrying a method goes to
     googleapis.com and nowhere else. What stays here is the half this file was written for. */
  const js = scriptOf(DAILY);
  assert.ok(/async function jget\(url\) \{\s*const r = await fetch\(url\);/.test(js),
    "the store is read through jget(url), which passes no options at all");
  assert.ok(!/\bStore\.save\b/.test(js), "…and there is no save path on the page");
  // every URL it reads is a known read endpoint
  assert.ok(/jget\(API \+ "\?dailybriefs=1"\)/.test(js), "it reads the daily briefs");
  assert.ok(/jget\(API \+ "\?checkins=1"\)/.test(js), "it reads today's check-in");
  assert.ok(/jget\(STRIPE_FEED\)/.test(js), "it reads the Stripe feed");
  // one feed being down must not blank the other two
  assert.ok(/Promise\.allSettled\(/.test(js), "the three reads are settled, not raced — a dead feed loses one card");

  /* ============ 1b. v143: THE CARD READS GMAIL ITSELF ============
     Ash's triage is a claude.ai routine. It runs on Anthropic's servers — laptop shut,
     Chrome closed, it still runs — but a routine can reach his mail and CANNOT reach an
     outside web address, so the push this file was built around was never going to happen.
     The dashboard reads the labels instead of waiting to be told about them, which is the
     better half of the bargain anyway: nothing between the two to break, nothing to go
     stale, and a morning the job did not run shows fewer labels rather than an empty card. */
  /* v147 traded gmail.readonly for gmail.modify, because Ash asked to clear things off the
     card and a dashboard that hides an email while it sits there unread is just a second
     inbox to keep tidy. What matters is the LINE THAT WAS NOT CROSSED: modify can mark
     read, relabel and bin; it cannot send mail as him, and it cannot permanently delete.
     Permanent deletion needs the full mail.google.com scope, which is asserted absent. */
  assert.ok(/gmail\.modify/.test(js), "the page asks for Gmail modify — read, relabel, bin");
  assert.ok(!/gmail\.send|gmail\.compose|auth\/mail\.google\.com/.test(js),
    "…and nothing wider: it cannot send as him, and it cannot delete anything for good");
  assert.ok(/GMAIL_WRITES = \["modify", "trash", "untrash"\]/.test(js),
    "…with the three things it may do written down and checked");
  // the read path takes no options, exactly like the store's
  assert.ok(/async function gmailGet\(path\) \{[\s\S]{0,200}?fetch\(GMAIL_BASE \+ path, \{ headers: \{ Authorization/.test(js),
    "Gmail is read through one function that passes a url and headers and nothing else");
  assert.ok(/const GMAIL_BASE = "https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/";/.test(js),
    "…against a fixed Google address");
  // one token covers both, and a token granted before Gmail was asked for is not reused
  assert.ok(/GCAL_SCOPE\.split\(" "\)\.every\(/.test(js),
    "a stored token that does not cover every scope now needed is discarded, not used and failed with");
  assert.ok(/if \(t && !t\.scope\) return null;/.test(js), "…as is one saved before scopes were recorded");

  // the labels ARE the tiers, and one thread read gives the row everything
  assert.ok(/gmailGet\("labels"\)/.test(js), "it looks the Triage label ids up by name");
  assert.ok(/gmailGet\("threads\?labelIds="/.test(js), "…lists the threads under each");
  assert.ok(/format=metadata&metadataHeaders=From&metadataHeaders=Subject/.test(js),
    "…and reads only the headers it needs, not whole messages");
  assert.ok(/\(m\.labelIds \|\| \[\]\)\.includes\("DRAFT"\)/.test(js),
    "the saved reply is found as the DRAFT-labelled message in the thread");
  assert.ok(/draftPreview: draft \? String\(draft\.snippet/.test(js),
    "…and previewed from its own snippet, so no message body is ever fetched");
  // quota: a busy inbox must not take the card down
  assert.ok(/async function inChunks\(/.test(js) && /GM_CONCURRENCY/.test(js),
    "thread reads are chunked, so a busy inbox does not trip Gmail's per-second quota");
  assert.ok(/catch \{ return null; \}/.test(js), "…and one awkward thread costs its own row only");

  // live wins, but a pushed brief still enriches it — the "why" only ever comes from the job
  assert.ok(/function mailItems\(\)/.test(js), "the two sources are reconciled in one place");
  assert.ok(/why: p\.why \|\| it\.why/.test(js),
    "a pushed brief's hand-written reason wins over the email's own opening line");
  assert.ok(/if \(!mailLive\) return \{ items: pushed/.test(js),
    "…and the brief alone still works if Gmail is not connected");

  /* ============ 1c. v143.1: A BUTTON WITH NO HANDLER ============
     Ash: "Nothing is actually happening when I click 'Connect Gmail'."

     It rendered a perfectly good button and attached nothing to it: the wiring sat at the
     foot of renderMail, and the setup-card branch RETURNS before reaching it. That is the
     worst way for something to be broken — it looks like it worked, and it looks like the
     user's fault. So the wiring lives in one function now, and both paths call it. */
  assert.ok(/function wireMailCard\(body\) \{/.test(js), "the card's wiring lives in one place");
  const renderMailBody = js.slice(js.indexOf("function renderMail()"), js.indexOf("function wireMailCard"));
  assert.strictEqual((renderMailBody.match(/wireMailCard\(body\);/g) || []).length, 2,
    "…and renderMail calls it on BOTH paths — the early setup-card return included");
  // every id the setup card can put on screen must be wired, or this happens again
  const setupHtml = js.slice(js.indexOf("function mailSetupHtml"), js.indexOf("function renderMail"));
  const wiring = js.slice(js.indexOf("function wireMailCard"));
  for (const m of setupHtml.matchAll(/id="([a-zA-Z]+)"/g)) {
    assert.ok(wiring.includes('$("' + m[1] + '")'),
      "#" + m[1] + " is rendered by the setup card and must be wired in wireMailCard");
  }
  // and the OTHER way a sign-in button can silently do nothing
  assert.ok(/error_callback/.test(js), "a blocked or dismissed Google popup is caught");
  assert.ok(/popup_failed_to_open/.test(js) && /Allow pop-ups/.test(js),
    "…and turned into a sentence that says what to do about it");
  assert.ok(/mc\.textContent = "Waiting for Google…"/.test(js),
    "the button says something happened the moment it is pressed");

  /* ============ 1d. v145: "Gmail API has not been used in project 189946618351…" ============
     Ash enabled the Calendar API, connected, and got a paragraph of Google's own prose with
     a URL buried in the middle of it. The two APIs are switched on separately, so doing one
     and not the other lands here every time — it is not an edge case, it is the next step,
     and it deserves a sentence and a button rather than a stack trace. */
  assert.ok(/has not been used in project\|it is disabled\|accessNotConfigured/.test(js) ||
    /has not been used in project/.test(js), "the not-enabled error is recognised, not just displayed");
  assert.ok(/The Gmail API is not switched on yet/.test(js), "…and answered in plain words");
  assert.ok(/Enable the Gmail API/.test(js), "…with a button");
  assert.ok(/\(https:\\\/\\\/console\\\.\[\^\\s\]\+\)/.test(js) || /https:\\\/\\\/console/.test(js),
    "…that uses the link Google put in the message, project id and all");
  assert.ok(/apis\/library\/gmail\.googleapis\.com/.test(js),
    "…and a fallback for when Google words it differently");
  assert.ok(/Google\\u2019s own words/.test(js),
    "the original message is kept underneath, so nothing is hidden from someone who wants it");

  /* ============ 1e. v146: AN EMAIL YOU HAVE READ IS NOT A JOB ============
     Ash: "I need the ability to 'hide' emails that have been read. This should only show
     unread emails."

     Unread only is the DEFAULT, not an option to go and find — the card is meant to be the
     short list of what is left, and a fortnight of read threads buries it. The filtering is
     done by Gmail (UNREAD is a label like any other) rather than by fetching threads and
     throwing them away, and the "already read" figures come from labels.list, which was
     already being called and carries exact per-label totals. */
  assert.ok(/let mailUnreadOnly = \(\(\) => \{[\s\S]{0,140}?!== "0"/.test(js),
    "unread only is the default, and remembered per browser");
  assert.ok(/mailUnreadOnly \? "&labelIds=UNREAD" : ""/.test(js),
    "Gmail does the filtering — the page does not fetch read threads to discard them");
  assert.ok(/id="mailUnread"/.test(js) && /Unread only/.test(js), "there is a switch, on the card itself");
  assert.ok(/\$\("mailUnread"\)/.test(wiring) || /const un = \$\("mailUnread"\)/.test(js),
    "…and it is wired in wireMailCard with everything else");
  // the counts are Gmail's own, not a guess
  assert.ok(/threadsTotal\) \|\| 0, unread: Number\(l\.threadsUnread\)/.test(js),
    "the exact totals come from labels.list, which was already being fetched");
  assert.ok(/st\.total - st\.unread/.test(js) && /already read<\/span>/.test(js),
    "each tier says how many it is hiding");
  assert.ok(/unread: msgs\.some\(\(m\) => \(m\.labelIds \|\| \[\]\)\.includes\("UNREAD"\)\)/.test(js) ||
    /const unread = msgs\.some/.test(js),
    "a thread counts as unread if any message in it is — the same rule Gmail's own list uses");
  // showing them all must not make read ones look like work
  assert.ok(/it\.unread === false \? " read" : ""/.test(js), "a read row is marked when they are shown");
  assert.ok(/\.mail\.read \.mail-subj\{font-weight:500/.test(styleOf(DAILY)),
    "…and reads as context rather than as a job");
  // an empty card with the filter on means something quite different from a broken one
  assert.ok(/reason === "unread-none"/.test(js), "nothing unread has its own state");
  assert.ok(/That is the inbox done, not the card broken/.test(js), "…and says which it is");

  /* ============ 1f. v147: GETTING RID OF WHAT DOES NOT NEED HIM ============
     Ash: "Lots of crap I don't need on there. Can we have the option to remove, delete, get
     rid of any email that doesn't need my attention please."

     "Not for me" marks the thread READ and takes the Triage label off it. BOTH, deliberately:
     read alone leaves it labelled, so it comes back the moment Unread only is switched off;
     unlabelled alone leaves it sitting unread in the inbox for ever. Together it means what
     it says. And every one of these is undoable — the bin is Gmail's bin, thirty days, and
     this page could not delete permanently if it wanted to. */
  assert.ok(/removeLabelIds: remove/.test(js) && /\["UNREAD"\]\.concat\(labelId \? \[labelId\] : \[\]\)/.test(js),
    "clearing takes the UNREAD flag AND the tier label off, not one or the other");
  assert.ok(/gmailWrite\(threadId, "trash", \{\}\)/.test(js), "there is a bin, and it is Gmail's own");
  assert.ok(/async function mailClearTier\(tierId\)/.test(js),
    "a whole tier can go at once — 'read it or don't' is not worth ten clicks");
  assert.ok(/data-cleartier=/.test(js) && /Clear all/.test(js), "…with a control to do it");

  // UNDO, for all three, offered rather than mentioned
  assert.ok(/async function mailUndoLast\(\)/.test(js), "the last thing cleared can be put back");
  assert.ok(/gmailWrite\(row\.threadId, "untrash"/.test(js), "…out of the bin");
  assert.ok(/addLabelIds: \(row\.labelId \? \[row\.labelId\] : \[\]\)\.concat\(row\.wasUnread \? \["UNREAD"\] : \[\]\)/.test(js),
    "…or back onto the list, unread again ONLY if it was unread before");
  assert.ok(/class="undobar"/.test(js) && /id="mailUndoBtn"/.test(js),
    "and the undo is a button on screen, not a thing you have to know about");
  assert.ok(/Gmail keeps it for 30 days/.test(js), "…which says what binning actually means");

  // a row that vanishes from the screen but not from Gmail would be a lie
  assert.ok(/mailLive = \(mailLive \|\| \[\]\)\.concat\(\[it\]\);/.test(js),
    "if Gmail refuses the change, the row comes straight back");
  assert.ok(/failed\.push\(it\)/.test(js) && /could not be cleared/.test(js),
    "…and a part-failed bulk clear returns the ones that did not go, and says how many");

  /* ================= 2. the page's shape ================= */
  assert.ok(/<title>Bodysculpt Daily<\/title>/.test(DAILY), "daily.html has its own title");
  // the palette is the suite's, byte for byte, so the fifth page cannot drift from the four
  const paletteOf = (src) => {
    const st = styleOf(src);
    const i = st.indexOf(":root{", st.indexOf(":root{") + 1);   // the SECOND :root is the palette
    return st.slice(i, st.indexOf("}", i) + 1);
  };
  assert.strictEqual(paletteOf(DAILY), paletteOf(read("index.html")),
    "daily.html carries the suite palette, byte for byte");
  // no literal colour outside it (the v121 rule, applied to the new page)
  const dailyStyle = styleOf(DAILY);
  const afterTokens = dailyStyle.slice(dailyStyle.indexOf(paletteOf(DAILY)) + paletteOf(DAILY).length);
  const literal = afterTokens.replace(/rgba\(var\(--[a-z0-9-]+\)[^)]*\)/g, "").match(/#[0-9a-fA-F]{3,8}\b/g);
  assert.ok(!literal, "no literal colour below the palette block (found " + (literal || []).join(", ") + ")");
  // every icon it asks for is defined in its own sprite
  const sprite = /<svg width="0" height="0"[\s\S]*?<\/defs><\/svg>/.exec(DAILY);
  assert.ok(sprite, "daily.html carries the sprite");
  const defined = new Set([...sprite[0].matchAll(/<symbol id="(ic-[a-z-]+)"/g)].map((m) => m[1]));
  const asked = new Set([...DAILY.matchAll(/href=\\?"#(ic-[a-z-]+)"/g)].map((m) => m[1]));
  for (const id of asked) assert.ok(defined.has(id), "#" + id + " is asked for and resolves");
  for (const id of ["ic-sun", "ic-mail", "ic-card"]) assert.ok(defined.has(id), "#" + id + " joined the sprite");
  // the three new symbols are on every page, so the sprite stays one thing
  for (const f of ["index.html", "monthly.html", "quarterly.html", "finances.html"]) {
    for (const id of ["ic-sun", "ic-mail", "ic-card"]) {
      assert.ok(read(f).includes('<symbol id="' + id + '"'), f + " carries #" + id);
    }
  }

  /* ================= 3. the hierarchy is the Gmail labels ================= */
  // If these two lists ever disagree, an item the triage pushes is silently dropped on the
  // way into the store, and the tier simply never appears. Same four names, same order.
  const pageTiers = [...js.matchAll(/\{ id: "([a-z]+)",\s+name: "([^"]+)",\s+label: "([^"]+)"/g)];
  assert.deepStrictEqual(pageTiers.map((m) => m[1]), ["urgent", "today", "week", "fyi"],
    "the page's tiers are the hierarchy, hardest first");
  assert.deepStrictEqual(pageTiers.map((m) => m[3]),
    ["Triage/Urgent", "Triage/Today", "Triage/This week", "Triage/FYI"],
    "…and each one names the Gmail label the scheduled triage actually applies");
  const storeSrc = fs.readFileSync(STORE_SRC, "utf8");
  const storeTiers = /const BRIEF_TIERS = \[([^\]]+)\]/.exec(storeSrc);
  assert.ok(storeTiers, "kpi-store declares the accepted tiers");
  assert.deepStrictEqual(storeTiers[1].match(/"([a-z]+)"/g).map((s) => s.slice(1, -1)),
    pageTiers.map((m) => m[1]), "…and the store accepts exactly the tiers the page renders");
  // the FYI pile is a count you can ignore, not a fifth queue
  assert.ok(/let fyiOpen = false;/.test(js), "the FYI pile starts shut");

  /* ================= 4. the store route, against the real handler ================= */
  const SEED = {
    "weeks": JSON.stringify([{ weekEnding: "2026-08-31", leads: 41 }]),
    "planning-2026-Q2": JSON.stringify({ year: 2026, quarter: "Q2", goals: [{ id: "g1", title: "The Q2 review" }] }),
    "daily-checkins": JSON.stringify({ "2026-09-09": { date: "2026-09-09", oneThing: "Call the landlord" } }),
    "weekly-plan-2026-09-05": JSON.stringify({ weekEnding: "2026-09-05", tasks: [{ id: "t1" }] }),
  };
  const store = fakeStore(SEED);
  globalThis.__fakeStore = store;
  const h = await loadHandler();

  // empty to start with — a page loaded before the first push must get {} and not a 500
  let r = await GET(h, "dailybriefs=1");
  assert.strictEqual(r.status, 200, "an empty brief map is a 200");
  assert.deepStrictEqual(await r.json(), { briefs: {} }, "…and an empty map");

  // a real push round-trips
  r = await POST(h, { dailyBrief: {
    date: "2026-09-10",
    summary: "Two need you before lunch.",
    items: [
      { tier: "urgent", from: "Companies House", subject: "Confirmation statement overdue", why: "Filing is late.", action: "File today", threadId: "18fabc123", receivedAt: "2026-09-10T06:40:00Z" },
      { tier: "today", from: "A member", subject: "Cancelling", why: "Wants to cancel.", action: "Ring", threadId: "18fabc124" },
      { tier: "fyi", from: "A newsletter", subject: "Weekly roundup" },
      // the ones that must not survive the door
      { tier: "SCREAMING", from: "Nobody", subject: "Made-up tier" },
      { tier: "urgent" },                                     // nothing to show
      { tier: "week", subject: "x", threadId: "../../etc" },  // an id that is not an id
      "not even an object",
    ],
    lastUpdated: "PLEASE OVERWRITE ME",                        // an unknown field
  } });
  assert.strictEqual(r.status, 200, "a good brief is accepted");
  let out = await r.json();
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(out.counts, { urgent: 1, today: 1, week: 1, fyi: 1 },
    "the counts are DERIVED from the surviving rows, so headings cannot lie");

  r = await GET(h, "dailybriefs=1");
  const briefs = (await r.json()).briefs;
  const brief = briefs["2026-09-10"];
  assert.ok(brief, "the brief comes back under its date");
  assert.strictEqual(brief.items.length, 4, "the junk rows were dropped, not stored");
  assert.ok(!brief.items.some((i) => i.tier === "SCREAMING"), "an unknown tier does not get in");
  assert.strictEqual(brief.items[3].threadId, "etc", "a thread id is stripped to id characters");
  assert.ok(!("lastUpdated" in brief), "unknown top-level fields are dropped");
  assert.ok(brief.generatedAt, "the server stamps when it arrived");
  assert.strictEqual(brief.items[0].subject, "Confirmation statement overdue", "the real rows are kept verbatim");

  /* ---- v142: THE REPLY IS ALREADY WRITTEN ----
     Ash: "I have a scheduled task that basically reads my inbox, tags my emails based on
     the importance of needing a reply, DRAFTS THAT REPLY AND SAVES IT."

     That changes what this card is for. It is not a list of work — the work is done — it is
     a list of decisions: read it, send it. So the draft travels with the item and the page
     shows what it says, because a reply you have to open Gmail to read is a reply you will
     put off reading. */
  r = await POST(h, { dailyBrief: {
    date: "2026-09-12",
    items: [
      { tier: "urgent", from: "Karen at Whitfield & Co", subject: "VAT return", why: "Chased twice.",
        action: "Send the reply", threadId: "18aa1", draftId: "r-8899001122",
        draftPreview: "Hi Karen,\n\n  Sorry for the delay — the Q2   figures are attached.\n" },
      { tier: "today", from: "A member", subject: "Cancelling", action: "Ring them", threadId: "18aa2" },
      // an id that is not an id, and a preview that is mostly whitespace
      { tier: "week", from: "Someone", subject: "Later", draftId: "../../etc/passwd", draftPreview: "   \n\t  " },
    ],
  } });
  out = await r.json();
  assert.strictEqual(out.drafted, 2, "the store counts how many replies are written, derived from the rows");

  r = await GET(h, "dailybriefs=1");
  const withDrafts = (await r.json()).briefs["2026-09-12"];
  assert.strictEqual(withDrafts.items[0].draftId, "r-8899001122", "a draft id rides along with the item");
  assert.strictEqual(withDrafts.items[0].draftPreview,
    "Hi Karen, Sorry for the delay — the Q2 figures are attached.",
    "…and the preview arrives as one clean line, whatever whitespace the job sent");
  assert.strictEqual(withDrafts.items[1].draftId, "", "an item with no draft carries none");
  assert.strictEqual(withDrafts.items[1].draftPreview, "", "…and no preview either");
  assert.strictEqual(withDrafts.items[2].draftId, "etcpasswd", "a draft id is stripped to id characters");
  assert.strictEqual(withDrafts.items[2].draftPreview, "", "whitespace is not a preview");
  assert.strictEqual(withDrafts.drafted, 2, "the count survives the round trip");

  // and the page shows it
  assert.ok(/const hasDraft = !!\(it\.draftId \|\| it\.draftPreview\);/.test(js),
    "the row knows whether its reply is written");
  assert.ok(/class="mail-draft"/.test(js), "…and gives it its own block, not a footnote");
  assert.ok(/Reply written/.test(js), "…that says so in words");
  assert.ok(/mail-dtext/.test(js), "…and shows what it actually says");
  assert.ok(/draftUrl = \(id\) => GMAIL \+ "drafts\?compose="/.test(js),
    "…linking straight to Gmail's composer when there is an id to link to");
  assert.ok(/GMAIL \+ "drafts"/.test(js), "…and to the drafts folder when there is not");
  // an <a> inside an <a> is not valid markup and browsers pull it apart
  assert.ok(!/<a class="mail-dgo"/.test(js), "the draft link is not a nested anchor");
  assert.ok(/data-draft="/.test(js) && /window\.open\(el\.dataset\.draft/.test(js),
    "…it is a span that opens itself");
  assert.ok(/role="link" tabindex="0"/.test(js), "…reachable by keyboard, and announced as a link");
  assert.ok(/e\.stopPropagation\(\)/.test(js), "…and its click does not also open the thread underneath");
  assert.ok(/replies are written and waiting to be sent/.test(js),
    "the card's first line says how many replies are waiting, not just how many emails there are");

  // a date is required — a brief with no date has nowhere to live
  r = await POST(h, { dailyBrief: { summary: "no date", items: [] } });
  assert.strictEqual(r.status, 400, "a brief with no date is refused");

  // the item cap holds
  r = await POST(h, { dailyBrief: { date: "2026-09-11",
    items: Array.from({ length: 200 }, (_, i) => ({ tier: "fyi", from: "x", subject: "s" + i })) } });
  assert.strictEqual((await r.json()).counts.fyi, 60, "a huge morning is truncated to the cap, not rejected");

  // the map prunes, so one blob cannot grow forever
  for (let d = 1; d <= 40; d++) {
    await POST(h, { dailyBrief: { date: "2026-10-" + String(d).padStart(2, "0"), items: [] } });
  }
  const kept = Object.keys(JSON.parse(store._m.get("daily-briefs")));
  assert.strictEqual(kept.length, 30, "the map keeps the newest 30 days");
  assert.strictEqual(kept[kept.length - 1], "2026-10-40", "…the newest is still there");
  assert.ok(!kept.includes("2026-09-10"), "…and the oldest fell off the back");

  // AND NOTHING ELSE WAS TOUCHED. This is rule 5, checked rather than assumed.
  for (const [k, v] of Object.entries(SEED)) {
    assert.strictEqual(store._m.get(k), v, k + " came back byte-identical after every brief write");
  }
  delete globalThis.__fakeStore;

  /* ================= 5. the Stripe feed ================= */
  // no key is a normal state with instructions, not a 500 with a stack trace
  let s = await loadStripe({});
  assert.strictEqual(s.res.status, 200, "an unconfigured Stripe feed still answers 200");
  assert.strictEqual(s.body.configured, false, "…and says it is not configured");
  assert.deepStrictEqual([s.body.disputes, s.body.pastDue, s.body.failed], [[], [], []],
    "…with empty lists, so the page renders the same shape either way");

  // with a key: the four reads, the filtering, and the shaping
  const SECRET = "rk_test_THIS_MUST_NEVER_LEAVE_THE_SERVER";
  const seen = [];
  s = await loadStripe({ STRIPE_SECRET_KEY: SECRET }, (url) => {
    seen.push(url);
    if (url.includes("/disputes")) return { data: [
      { id: "dp_1", amount: 4900, currency: "gbp", reason: "fraudulent", status: "needs_response",
        created: 1757000000, evidence_details: { due_by: Math.floor(Date.now() / 1000) + 3 * 86400 },
        charge: { billing_details: { name: "A Member", email: "a@x.com" } } },
      { id: "dp_2", amount: 9900, currency: "gbp", status: "won", charge: null },   // history
    ] };
    if (url.includes("status=past_due")) return { data: [
      { id: "sub_1", status: "past_due", current_period_start: 1756000000,
        customer: { name: "B Member", email: "b@x.com" },
        items: { data: [{ quantity: 1, price: { unit_amount: 5000, currency: "gbp" } }] } },
    ] };
    if (url.includes("status=unpaid")) return { data: [] };
    if (url.includes("/charges")) return { data: [
      { id: "ch_1", status: "failed", amount: 3500, currency: "gbp", created: 1757100000,
        failure_message: "Your card has expired.", billing_details: { name: "C Member" } },
      { id: "ch_2", status: "succeeded", amount: 3500, currency: "gbp", created: 1757100000, billing_details: {} },
    ] };
    return { data: [] };
  });
  assert.strictEqual(s.body.ok, true, "a configured feed answers ok");
  assert.strictEqual(seen.length, 4, "four reads: disputes, past_due, unpaid, charges");
  assert.ok(seen.every((u) => u.startsWith("https://api.stripe.com/v1/")), "…all of them to Stripe");
  assert.strictEqual(s.body.disputes.length, 1, "a won dispute is history and does not appear");
  assert.strictEqual(s.body.disputes[0].name, "A Member", "the expanded charge names the member");
  assert.ok(s.body.disputes[0].url.startsWith("https://dashboard.stripe.com/disputes/"), "a dispute links to Stripe");
  assert.strictEqual(s.body.pastDue[0].amount, 5000, "a past-due membership carries its price");
  assert.strictEqual(s.body.pastDue[0].name, "B Member", "…and the expanded customer names it");
  assert.strictEqual(s.body.failed.length, 1, "a succeeded charge is not a failed one");
  assert.strictEqual(s.body.failed[0].reason, "Your card has expired.", "the failure reads as a sentence");
  assert.strictEqual(s.body.totals.count, 3, "three things need Ash today");
  // THE KEY NEVER LEAVES THE SERVER
  assert.ok(!JSON.stringify(s.body).includes(SECRET), "the Stripe key is nowhere in the response body");
  assert.ok(!DAILY.includes("sk_live") && !DAILY.includes("rk_live") && !/sk_test|rk_test/.test(DAILY),
    "…and no key of any kind is baked into the page");

  // Stripe having a bad morning is a sentence on a card, never a broken page
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "Invalid API Key provided" } }) });
  s = await loadStripe({ STRIPE_SECRET_KEY: SECRET }, null);
  globalThis.fetch = savedFetch;
  assert.strictEqual(s.res.status, 200, "a Stripe error still answers 200");
  assert.strictEqual(s.body.ok, false, "…flagged as not ok");
  assert.ok(/Invalid API Key/.test(s.body.error), "…carrying the sentence the page shows");

  /* ================= 6. it degrades into instructions, never into a blank ============= */
  assert.ok(/function mailSetupHtml\(/.test(js), "no brief yet has its own state");
  assert.ok(/Stripe is not connected yet/.test(js), "no Stripe key has its own state");
  assert.ok(/No check-in yet today/.test(js), "no check-in has its own state");
  // with nothing switched on at all, the four Gmail labels are still one click away
  assert.ok(/TIERS\.map\(\(t\) => '<a class="abtn" href="' \+ esc\(labelUrl\(t\.label\)\)/.test(js),
    "…and the unconfigured mail card still links straight into the four Gmail labels");
  // the money alarm exists but ships hidden, so an empty morning says nothing
  assert.ok(/<a class="fin-alert" id="moneyAlert"[^>]*\shidden>/.test(DAILY),
    "the money alarm ships hidden and is shown only when there is money in trouble");

  /* ================= 7. the setup doc is real and says the right endpoint ============= */
  const doc = read("DAILY-SETUP.md");
  assert.ok(/dailyBrief/.test(doc), "DAILY-SETUP.md documents the payload key the store accepts");
  assert.ok(/kpi-store/.test(doc), "…and the endpoint it goes to");
  for (const t of ["Triage/Urgent", "Triage/Today", "Triage/This week", "Triage/FYI"]) {
    assert.ok(doc.includes(t), "…and names the " + t + " label the job already applies");
  }

  console.log("v135-daily-dashboard.test: all assertions passed");
})();
