// v80 — the daily check-in.
//
// RETIRED BY v154. The daily check-in lived in a modal on the WEEKLY dashboard. Ash: "remove the
// 'today' functionality from the weekly dashboard … I need now is that to be on the daily
// dashboard, the questions, check-ins and things and focus timer and things like that."
//
// The behaviour did not go away, it moved — and its assertions moved with it, to
// tests/v154-the-day-moved.test.cjs, which drives the version that now ships. What is left
// here is a TOMBSTONE: it asserts the weekly page really is rid of it, so a future edit
// cannot quietly put a second copy back and leave two places writing the same day.
//
// The original file is in the git history at v153 if the old assertions are ever wanted.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const WEEKLY = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const DAILY = fs.readFileSync(path.join(__dirname, "..", "daily.html"), "utf8");

(async () => {
  for (const gone of ["wpCheckinStart", "wpCheckinSkip", "wpCheckinBlockHtml", "WP_CHECKIN_FIELDS", "wpCheckinSaveFromEditors"]) {
    assert.ok(!WEEKLY.includes(gone), "the weekly page is rid of " + gone);
  }
  for (const here of ["const CK_FIELDS", "function renderCheckin()", "ckStart", "JSON.stringify({ checkin: next })"]) {
    assert.ok(DAILY.includes(here), "…and the daily page has " + here);
  }
  console.log("v80-daily-checkin: all assertions passed (retired — see v154-the-day-moved)");
})().catch((e) => { console.error(e); process.exit(1); });
