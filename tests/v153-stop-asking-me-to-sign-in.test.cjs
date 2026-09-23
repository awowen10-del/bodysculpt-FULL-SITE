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
  // relaxed once v154 shipped: the newest release's test pins the exact stamp.
  assert.ok(Number(stamp[1]) >= 153, "monthly.html is stamped v153 or later");
  const text = "build v" + stamp[1] + " · " + stamp[2];
  for (const f of ["index.html", "finances.html", "daily.html", "social.html"]) {
    assert.ok(read(f).includes(text), f + " carries the same stamp");
  }

  /* ============ 1. the three questions, unchanged in substance ============ */
  /* v221: the questions moved from a CK_FIELDS table into focus mode's morning as markup.
     Same three, same order, same words — read from where they now live. */
  const fields = [...js.matchAll(/<textarea id="fm_(mind|grat|one)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(fields, ["mind", "grat", "one"], "the same three questions, in the same order");
  assert.ok(/What\\u2019s on your mind today\?/.test(js), "…the first, worded as it was");
  assert.ok(/What are you grateful for\?/.test(js), "…the second");
  assert.ok(/If you only complete one thing today, what is it\?/.test(js),
    "…worded as they were — this is a move, not a redesign");
  assert.ok(/const CK_EVENING_HOUR = 14;/.test(js), "the evening loop-closer still opens at 2pm");
  assert.ok(/Did you do the one thing\?/.test(js), "…and still asks the same question");

  /* ============ 2. plain text, deliberately ============
     The modal used the v70 rich editor. Porting it would have meant a SECOND copy of that
     sanitiser, and this codebase already keeps one uneasy pair of them honest with a parity
     test. Three short prose answers never needed bold. */
  /* v221: the three boxes moved from the check-in card into focus mode's morning, and
     their ids moved with them. The claim is the one that mattered: PLAIN textareas, and no
     second copy of the rich-text engine anywhere on this page. */
  assert.ok(/<textarea id="fm_mind"/.test(js) && /<textarea id="fm_grat"/.test(js) && /<textarea id="fm_one"/.test(js),
    "the answers are plain textareas");
  for (const name of ["wpNotesToEditorHtml", "wpSanitizeNotesHtml", "wp:rich", "contenteditable"]) {
    assert.ok(!js.includes(name), "no second copy of the rich-text engine came along: " + name);
  }
  // …and anything already written WITH formatting still reads correctly
  // v221: the flattening moved with the boxes — same call, at the new ids
  assert.ok(/esc\(richToText\(e\.mind\)\)/.test(js) && /esc\(richToText\(e\.oneThing\)\)/.test(js),
    "an answer saved with formatting is flattened for editing");
  // v221: the entry is named `e` now that the card it belonged to is gone
  assert.ok(/richToText\(e\.oneThing\)\.trim\(\)/.test(js), "…and for display");

  /* ============ 3. the store is untouched ============ */
  assert.ok(/JSON\.stringify\(\{ checkin: next \}\)/.test(js),
    "it posts the same { checkin } payload the modal did");
  assert.ok(/\.\.\.ckEntry\(date\), \.\.\.patch, date/.test(js),
    "…merging into the day's existing entry rather than replacing it");
  assert.ok(/if \(back && back\.checkin\) checkinAll\[date\] = back\.checkin;/.test(js),
    "…and taking the server's re-cleaned copy back");
  /* THE v80 RULE, KEPT — by a simpler mechanism. It used to be enforced by sweeping only
     the boxes that were on screen (ckReadFields); v221 moved the boxes into focus mode and
     deleted the sweep, so a save from the day strip carries ONLY what it is changing, and
     ckSave rebuilds the rest from the stored entry. A one-field patch still cannot blank an
     answer that is not being shown — which is what the rule was ever about. */
  assert.ok(/try \{ await ckSave\(extra \|\| \{\}\); \}/.test(js),
    "a save carries only what it is changing");
  assert.ok(!/ckReadFields/.test(js.replace(/\/\*[\s\S]*?\*\//g, "")),
    "…there is no screen-sweep left to get wrong");
  assert.ok(/const next = \{ \.\.\.ckEntry\(date\), \.\.\.patch, date \};/.test(js),
    "…and the rest of the day comes from the stored entry, so nothing hidden is blanked");

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

  /* ============ 6. the questions get out of the way once the day has started ============
     v221: they used to do that by collapsing a card on this page to one line. They do it by
     not being on this page at all now — they are a step in focus mode, and the dashboard
     shows the ANSWER. Same behaviour, one fewer place for it to live. */
  assert.ok(!/class="ck-sum"/.test(js), "the collapsing card is gone");
  assert.ok(/<span class="tsum-k">One thing/.test(js), "…and the day strip shows the answer instead");
  assert.ok(/fmStage = "day"; fmQueue = fmBuildQueue\(\); fmRender\(\);/.test(js),
    "…and answering them moves straight on to the day, rather than back to a card");
  /* THE v144 RULE, KEPT: every control is wired in the function that renders it, so a
     render that returns early can never leave a button on screen with nothing behind it.
     v221 split these across two renderers — the day strip keeps the one-thing yes/no and
     the habits, focus mode's morning keeps the questions — so both are checked, each
     against its own function. */
  const strip = js.slice(js.indexOf("function renderToday"), js.indexOf("/* ---------- freshness"));
  for (const id of ["ckYes", "ckNo", "oneThingAdd"]) {
    assert.ok(new RegExp('on\\("' + id + '"').test(strip), "#" + id + " is wired where the day strip renders it");
  }
  assert.ok(/data-habit/.test(strip) && /addEventListener\("click", \(\) => ckToggleHabit/.test(strip),
    "…and so are the habits");
  const fmwire = js.slice(js.indexOf("function fmWire"));
  for (const id of ["fmSkipQ", "fmSaveQ", "fmOneYes", "fmOneNo"]) {
    assert.ok(new RegExp('on\\("' + id + '"').test(fmwire), "#" + id + " is wired where focus mode renders it");
  }

  /* ============ 7. …and v154 removed the weekly copy ============
     v152 asserted the weekly modal was STILL there, deliberately: build it here, use it
     against real data, then delete the other one. It has been used and the other one is
     gone, so the guard flips to guarding the opposite — there must never be two places
     writing the same day again. */
  const WEEKLY = read("index.html");
  assert.ok(!/function wpOpenToday\(\)/.test(WEEKLY), "the weekly Today modal is gone");
  // and both halves write the same entries, so there is nothing to reconcile
  assert.ok(/\?checkins=1/.test(WEEKLY) && /\?checkins=1/.test(js),
    "both read the same daily-checkins map");

  /* ============ 8. v153: AN EXPIRED TOKEN IS NOT A SIGN-OUT ============
     Ash: "it's asking me to sign into my gmail and calendar again. why?"

     Because Google's access tokens last about an hour, and on load the page read the stored
     one, found it expired, and went straight to showing a Connect button. The CONSENT behind
     it lasts until it is withdrawn — only the token expires — so the right move is to swap it
     for a fresh one without telling anybody.

     v161 superseded the MECHANISM, not the claim. v153 renewed through Google's sign-in
     script with prompt:"", which can only ever open a pop-up — and a browser blocks a
     pop-up that no click asked for, so on page load it never worked. The renewal now goes
     to the site's own google-auth function with a device key. What this section still
     pins is the claim: the page tries to renew BEFORE anything decides nobody is signed in,
     and never through a window. tests/v161 pins the new mechanism. */
  assert.ok(/async function gcalTryRenew\(\)/.test(js), "there is a quiet renewal");
  assert.ok(/if \(gcalClientId && !gcalReady\(\)\) await gcalTryRenew\(\);/.test(js),
    "…and the page load tries it BEFORE anything decides nobody is signed in");
  assert.ok(!/requestAccessToken|initTokenClient/.test(js),
    "…and not through Google's token client, whose renewal is a pop-up the browser blocks");
  const WEEKLY2 = read("index.html");
  assert.ok(/async function wpCalAuthSilent\(\)/.test(WEEKLY2), "the weekly page renews the same way");
  assert.ok(!/requestAccessToken|initTokenClient/.test(WEEKLY2), "…and not through a pop-up either");

  console.log("v153-stop-asking-me-to-sign-in.test: all assertions passed");
})();
