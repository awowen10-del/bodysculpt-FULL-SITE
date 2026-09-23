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
  /* v221 CHANGED THIS LIST. It named the card the check-in arrived in — CK_FIELDS,
     renderCheckin(), ckStart. That card is gone: the questions are asked by focus mode's
     morning now, and asking them twice on one page was the noise Ash described. What v80 is
     actually about is unchanged and still checked — the check-in belongs to the DAILY page,
     it is one record per date, and it is written through one payload. */
  for (const here of ["function ckEntry(", "function ckSave(", "JSON.stringify({ checkin: next })",
                      "const CK_HABITS", "CK_EVENING_HOUR"]) {
    assert.ok(DAILY.includes(here), "…and the daily page has " + here);
  }
  assert.ok(/id="fm_mind"/.test(DAILY) && /id="fm_one"/.test(DAILY),
    "…and the questions themselves are asked in exactly one place, focus mode's morning");
  console.log("v80-daily-checkin: all assertions passed (retired — see v154-the-day-moved)");
})().catch((e) => { console.error(e); process.exit(1); });
