// v152 — the check-in, the non-negotiables and the focus timer move to the daily page.
//
// Ash: "remove the 'today' functionality from the weekly dashboard. What I need now is that
// to be on the daily dashboard, the questions, check-ins and things and focus timer and
// things like that. Also, whilst you're at it, make the focus timer more prominent for me —
// it needs to be like 'wow, this is time sensitive, focus'."
//
// All three lived in a modal on the WEEKLY page, which was always the wrong address: that
// page is where you decide what a week looks like, and none of this is about a week.
//
// This release is the ADDITIVE half — it builds them here and leaves the weekly copy alone.
// Deleting the old one is its own release, on purpose: both halves write the same
// `daily-checkins` entries, so nothing is duplicated or fought over, and if the new one
// turns out to have a gap against real data the old one is still there. Removing first and
// discovering the gap afterwards would have left him with neither.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const DAILY = read("daily.html");
const js = DAILY.slice(DAILY.lastIndexOf("<script>") + 8, DAILY.lastIndexOf("</script>"));
const style = DAILY.slice(DAILY.indexOf("<style>") + 7, DAILY.indexOf("</style>"));

(async () => {
  /* ================= 0. the stamp ================= */
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(read("monthly.html"));
  assert.strictEqual(stamp[1], "153", "monthly.html is stamped v153");
  assert.strictEqual(stamp[2], "stop-asking-me-to-sign-in", "…as the release that renewed instead of asking");
  const text = "build v153 · stop-asking-me-to-sign-in";
  for (const f of ["index.html", "finances.html", "daily.html", "social.html"]) {
    assert.ok(read(f).includes(text), f + " carries the same stamp");
  }

  /* ============ 1. the three questions, unchanged in substance ============ */
  const fields = [...js.matchAll(/\{ key: "([a-zA-Z]+)",\s+label: "([^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepStrictEqual(fields.map((f) => f[0]), ["mind", "gratitude", "oneThing"],
    "the same three questions, in the same order");
  assert.ok(/If you only complete one thing today, what is it\?/.test(js),
    "…worded as they were — this is a move, not a redesign");
  assert.ok(/const CK_EVENING_HOUR = 14;/.test(js), "the evening loop-closer still opens at 2pm");
  assert.ok(/Did you do the one thing\?/.test(js), "…and still asks the same question");

  /* ============ 2. plain text, deliberately ============
     The modal used the v70 rich editor. Porting it would have meant a SECOND copy of that
     sanitiser, and this codebase already keeps one uneasy pair of them honest with a parity
     test. Three short prose answers never needed bold. */
  assert.ok(/<textarea id="ck_' \+ f\.key/.test(js), "the answers are plain textareas");
  for (const name of ["wpNotesToEditorHtml", "wpSanitizeNotesHtml", "wp:rich", "contenteditable"]) {
    assert.ok(!js.includes(name), "no second copy of the rich-text engine came along: " + name);
  }
  // …and anything already written WITH formatting still reads correctly
  assert.ok(/esc\(richToText\(val\)\)/.test(js), "an answer saved with formatting is flattened for editing");
  assert.ok(/esc\(richToText\(entry\.oneThing\)\)|richToText\(entry\.oneThing\)/.test(js),
    "…and for display");

  /* ============ 3. the store is untouched ============ */
  assert.ok(/JSON\.stringify\(\{ checkin: next \}\)/.test(js),
    "it posts the same { checkin } payload the modal did");
  assert.ok(/\.\.\.ckEntry\(date\), \.\.\.patch, date/.test(js),
    "…merging into the day's existing entry rather than replacing it");
  assert.ok(/if \(back && back\.checkin\) checkinAll\[date\] = back\.checkin;/.test(js),
    "…and taking the server's re-cleaned copy back");
  // only fields on screen are read, so saving the summary cannot blank hidden answers
  assert.ok(/const el = \$\("ck_" \+ f\.key\);\s*\n\s*if \(el\) patch\[f\.key\] = el\.value;/.test(js),
    "only the boxes actually on screen are read — the v80 rule, kept");

  /* ============ 4. the non-negotiables are TICKED here now ============ */
  const habits = [...js.matchAll(/\{ id: "([a-z]+)",\s+short:/g)].map((m) => m[1]);
  assert.deepStrictEqual(habits, ["read", "mobility", "house"], "the same three habits");
  assert.ok(/data-habit="/.test(js) && /ckToggleHabit\(el\.dataset\.habit\)/.test(js),
    "each one is a button that toggles");
  assert.ok(/habits\[id\] = !habits\[id\];/.test(js), "…flipping just that habit");
  assert.ok(/aria-pressed="/.test(js), "…and says so to a screen reader");

  /* ============ 5. THE TIMER, AND WHY IT LOOKS LIKE THAT ============
     "it needs to be like 'wow, this is time sensitive, focus'." Idle it is four small
     buttons. Running it pins itself across the page under the app bar. */
  assert.ok(/\.ftbar\{position:sticky/.test(style), "a running block pins itself to the top");
  assert.ok(/\.ft-clock\{font-size:46px/.test(style), "…with the clock at 46px");
  assert.ok(/\.ftbar \.ft-fill\{position:absolute/.test(style), "…and the block visibly draining");
  assert.ok(/document\.title = ftFmt\(left\) \+ " · " \+ FT_TITLE;/.test(js),
    "…and the countdown written into the browser tab, legible from another tab entirely");
  assert.ok(/document\.title = FT_TITLE;/.test(js), "…and put back when the block ends");
  // the last five minutes are the ones that need saying
  assert.ok(/m <= 1 \? "last" : m <= 5 \? "soon" : "run"/.test(js), "under 5 minutes reads differently; under 1, again");
  assert.ok(/\.ftbar\.soon \.ft-clock\{color:var\(--amber-2\);animation:ftbreathe/.test(style), "amber and breathing");
  assert.ok(/\.ftbar\.last \.ft-clock\{color:var\(--red-2\);animation:ftbreathe/.test(style), "then red and faster");
  assert.ok(/@media\(prefers-reduced-motion:reduce\)\{[\s\S]{0,200}?animation:none/.test(style),
    "…and somebody who asked for less movement gets the colour without the pulse");
  // the v68 engine came over intact, because it was right
  assert.ok(/return Math\.max\(0, ftTimer\.endAt - Date\.now\(\)\);/.test(js),
    "time left is DERIVED from a timestamp, never decremented — a backgrounded tab comes back correct");
  assert.ok(/ftTimer\.pausedRemaining = Math\.max\(0, ftTimer\.endAt - Date\.now\(\)\);/.test(js),
    "…and pausing freezes what is left rather than stopping a counter");
  assert.ok(/if \(ftTick\) \{ clearInterval\(ftTick\); ftTick = null; \}/.test(js),
    "the one interval is cleared whenever nothing is running");
  // a tick must not disturb what you are typing
  assert.ok(/const clock = \$\("ftClock"\);\s*\n\s*if \(clock\) clock\.textContent/.test(js),
    "a tick patches the clock text — it does not re-render the page under your cursor");
  assert.ok(/function ftChime\(\)/.test(js) && /AudioContext/.test(js),
    "it makes a noise when the block ends, generated rather than fetched");
  assert.ok(/catch \(e\) \{ \/\* a browser that will not make a noise is not a broken timer \*\/ \}/.test(js),
    "…and a browser that refuses is not an error");

  /* ============ 6. the card gets out of the way once the day has started ============ */
  assert.ok(/card\.classList\.add\("open"\)/.test(js) && /card\.classList\.remove\("open"\)/.test(js),
    "the questions card opens and closes");
  assert.ok(/class="ck-sum"/.test(js), "once started it is one line");
  assert.ok(/Three questions\. Two minutes\./.test(js), "…and says what it is asking for before you start");
  // and every control on it is wired where it is rendered — the v144 rule
  const wired = js.slice(js.indexOf("function renderCheckin"));
  for (const id of ["ckStart", "ckSkip", "ckEdit", "ckYes", "ckNo"]) {
    assert.ok(new RegExp('on\\("' + id + '"').test(wired), "#" + id + " is wired in the same function that renders it");
  }

  /* ============ 7. the weekly page still has its copy, for now ============
     Stated rather than assumed, because the ORDER was the point: build it here, let him use
     it against real data, then delete the other one. */
  const WEEKLY = read("index.html");
  assert.ok(/function wpOpenToday\(\)/.test(WEEKLY),
    "the weekly Today modal is still there — removing it is the next release, not this one");
  // and both halves write the same entries, so there is nothing to reconcile
  assert.ok(/\?checkins=1/.test(WEEKLY) && /\?checkins=1/.test(js),
    "both read the same daily-checkins map");

  /* ============ 8. v153: AN EXPIRED TOKEN IS NOT A SIGN-OUT ============
     Ash: "it's asking me to sign into my gmail and calendar again. why?"

     Because Google's access tokens last about an hour, and on load the page read the stored
     one, found it expired, and went straight to showing a Connect button. The CONSENT behind
     it lasts until it is withdrawn — only the token expires — so the right move is to swap it
     for a fresh one without telling anybody. That is what prompt:"" is for, and it was
     written but never called. */
  assert.ok(/async function gcalTryRenew\(\)/.test(js), "there is a quiet renewal");
  assert.ok(/if \(gcalClientId && !gcalReady\(\)\) await gcalTryRenew\(\);/.test(js),
    "…and the page load tries it BEFORE anything decides nobody is signed in");
  assert.ok(/requestAccessToken\(\{ prompt: silent \? "" : "consent" \}\)/.test(js),
    "…using the silent prompt, which shows no window at all");
  // the sign-in script is async, and a renewal that gives up because it is late looks
  // exactly like being signed out
  assert.ok(/function gcalWaitForGoogle\(ms\)/.test(js), "it waits for the sign-in script to arrive");
  assert.ok(/if \(!\(await gcalWaitForGoogle\(\)\)\) return false;/.test(js), "…before deciding it cannot renew");
  const WEEKLY2 = read("index.html");
  assert.ok(/function wpCalWaitForGoogle\(ms\)/.test(WEEKLY2), "the weekly page had the same hole, and the same fix");
  assert.ok(/if \(!\(await wpCalWaitForGoogle\(\)\)\) throw new Error\("no client"\);/.test(WEEKLY2),
    "…waiting before its own silent renewal gives up");

  console.log("v153-stop-asking-me-to-sign-in.test: all assertions passed");
})();
