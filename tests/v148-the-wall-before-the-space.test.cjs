// v148 — the appointments you did not make yourself, inside the grid where you plan.
//
// Ash: "often things can get missed — such as appointments that are added to my Google
// Calendar automatically … the calendar I have on there is more my 'work blocks' and tasks
// are dragged onto there … Do I need the google calendar in the daily dashboard? Do I also
// use the google calendar on the weekly dashboard? Or keep that standalone?"
//
// None of those three. The problem is not where the calendar LIVES, it is that the weekly
// grid — the place where he decides where work goes — cannot see what is already committed.
// A second copy of the week strip on that page would have been two views of one truth and
// exactly the same eyeballing problem that is failing now.
//
// So an appointment is drawn INTO the cell it falls in: Thursday's 2pm consultation sits in
// Thursday 12–3, above the tasks, so the wall is visible before the space.
//
// THE TWO THINGS THIS FILE EXISTS TO GUARANTEE, because this page holds live plan data with
// no backup:
//
//   1. It cannot change the CALENDAR. There is no write path on index.html at all — not a
//      single request to Google carries a method.
//   2. It cannot change the PLAN. Appointments are rendered and never stored: they do not
//      enter placements, timeBlocks, or anything wpSaveSection writes. Not one save path is
//      touched by this release.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const WEEKLY = read("index.html");
const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));
const js = WEEKLY.slice(WEEKLY.indexOf("<script>", WEEKLY.indexOf("</style>")) + 8, WEEKLY.lastIndexOf("</script>"));

(async () => {
  /* ================= 0. the stamp ================= */
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(read("monthly.html"));
  assert.ok(stamp, "monthly.html carries a build stamp");
  assert.strictEqual(stamp[1], "148", "monthly.html is stamped v148");
  assert.strictEqual(stamp[2], "the-wall-before-the-space", "…as the release that put commitments in the grid");
  const text = "build v148 · the-wall-before-the-space";
  for (const f of ["index.html", "finances.html", "daily.html", "social.html"]) {
    assert.ok(read(f).includes(text), f + " carries the same stamp");
  }

  /* ============ 1. IT CANNOT CHANGE THE CALENDAR ============ */
  // Every fetch on this page that carries a method must be one the page already had; none
  // of them may be a Google one. The simplest true statement: no googleapis request has
  // options at all, because wpCalGet passes headers and nothing else.
  assert.ok(/async function wpCalGet\(path\) \{[\s\S]{0,260}?fetch\(WPCAL_BASE \+ path, \{ headers: \{ Authorization/.test(js),
    "the calendar is read through one function that passes a url and headers only");
  assert.ok(/const WPCAL_BASE = "https:\/\/www\.googleapis\.com\/calendar\/v3\/";/.test(js),
    "…against a fixed Google address");
  const googleWrites = [...js.matchAll(/fetch\(\s*WPCAL_BASE[^)]*,\s*\{[\s\S]{0,200}?method:/g)];
  assert.strictEqual(googleWrites.length, 0, "nothing on this page writes to Google");
  assert.ok(!/wpCal[A-Za-z]*\s*\([^)]*\)\s*\{[\s\S]{0,400}?method:\s*"POST"/.test(js),
    "…no calendar helper hides a POST inside it");
  // and it never asks for consent here — connecting is the daily page's job, once
  assert.ok(/requestAccessToken\(\{ prompt: "" \}\)/.test(js),
    "the weekly page only renews a sign-in quietly; it never opens a consent screen of its own");
  assert.ok(!/prompt: "consent"/.test(js), "…so nobody is asked to connect twice");
  assert.ok(/connect it on Today/.test(js), "…it points at the page that does the connecting");

  /* ============ 2. IT CANNOT CHANGE THE PLAN ============ */
  // The appointment layer must be render-only. If any of these ever fail, a display feature
  // has grown a way to write to a week's plan.
  // Start at the /* that OPENS the block's comment, not at a phrase inside it — otherwise
  // the comment has no opening delimiter left and the stripper below sails straight past it.
  const blockAt = js.lastIndexOf("/*", js.indexOf("WHAT IS ALREADY COMMITTED"));
  // …and end before wpCalRefresh, which legitimately reads the PUBLIC client id from the
  // store with a GET. That call is asserted separately below; what is under scrutiny here
  // is the layer that reads the calendar and draws it.
  const block = js.slice(blockAt, js.indexOf("async function wpCalRefresh"));
  assert.ok(block.length > 1000, "found the appointment block");
  // Checked against the CODE, not the prose: the block's own comment promises it will not
  // touch placements or timeBlocks, and a grep over the whole thing fails on the PROMISE
  // rather than on a breach of it. (v137's read-only assertion fell into the same hole, and
  // so did the first version of this one — a line filter missed the continuation lines of a
  // /* */ block, because they start with neither // nor *. Strip the comments properly.)
  const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const blockCode = stripComments(block);
  for (const forbidden of ["wpSaveSection", "placements", "timeBlocks", "wpPlan.", "Store.save", "WP_STORE +"]) {
    assert.ok(!blockCode.includes(forbidden),
      "the appointment layer must not touch " + forbidden + " — it renders, it does not store");
  }
  assert.ok(!/wpCalEvents\s*=\s*[^;]*wpPlan/.test(js), "…and never reads the plan into itself either");
  // the one place it does touch the store is a public config read, outside that block
  assert.ok(/fetch\(WP_STORE \+ "\?webconfig=1"\)/.test(js),
    "the only store call it adds is the public client id, which is a GET");

  /* ============ 3. an appointment lands where it actually falls ============ */
  const bands = /const WPCAL_BANDS = \[([\s\S]*?)\];/.exec(js);
  assert.ok(bands, "the bands' real hours are written down");
  const parsed = [...bands[1].matchAll(/\["([0-9-]+)",\s*([\d.]+),\s*([\d.]+)\]/g)]
    .map((m) => [m[1], Number(m[2]), Number(m[3])]);
  const rows = /const WP_TIME_ROWS = \[([\s\S]*?)\];/.exec(WEEKLY);
  const rowIds = [...rows[1].matchAll(/\["([a-z0-9-]+)","/g)].map((m) => m[1]);
  assert.deepStrictEqual(parsed.map((b) => b[0]), rowIds.filter((r) => r !== "notes"),
    "every band in the grid has hours, and no band exists that the grid does not have");

  // the mapping itself, exercised
  const band = new Function("WPCAL_BANDS", "d", `
    const h = d.getHours() + d.getMinutes() / 60;
    for (const [id, from, to] of WPCAL_BANDS) if (h >= from && h < to) return id;
    return "";`);
  const at = (h, m) => { const d = new Date(2026, 8, 10, h, m || 0); return d; };
  assert.strictEqual(band(parsed, at(6, 30)), "6-9", "a 6.30 start is in the first block");
  assert.strictEqual(band(parsed, at(10, 0)), "10-12", "a 10am start is in the second");
  assert.strictEqual(band(parsed, at(14, 0)), "1-3", "a 2pm consultation is in 12–3");
  assert.strictEqual(band(parsed, at(18, 30)), "5-8", "a 6.30pm class is in 5–8");
  // THE GAPS, which are the point: these must come back empty and be shown elsewhere
  assert.strictEqual(band(parsed, at(15, 30)), "", "3.30pm falls in no block at all");
  assert.strictEqual(band(parsed, at(11, 45)), "", "11.45 falls between the second and third");
  assert.strictEqual(band(parsed, at(21, 0)), "", "9pm is after every block");
  assert.strictEqual(band(parsed, at(5, 0)), "", "5am is before every block");
  // …and nothing that falls in a gap may be dropped
  assert.ok(/const wpCalLoose = \(dayKey\) =>[\s\S]{0,160}?!e\.band/.test(js),
    "anything outside every block is collected, not discarded");
  assert.ok(/wpCalLooseHtml\(dk\)}<\/th>/.test(WEEKLY),
    "…and shown on the day's heading, which is the failure this release exists to stop");
  assert.ok(/band: allDay \? "" : wpCalBandOf\(at\)/.test(js), "an all-day thing has no block, and is loose too");

  /* ============ 4. it reads as a wall, not as a task ============ */
  assert.ok(/const appts = rk === "notes" \? "" : wpCalChipsHtml\(dk, rk\);/.test(WEEKLY),
    "appointments are drawn per cell, and the Notes row is left alone");
  assert.ok(/<div class="wp-cellwrap">\$\{appts\}\$\{chips/.test(WEEKLY),
    "…ABOVE the tasks: you should see the wall before the space");
  const style = styleOf(WEEKLY);
  assert.ok(/\.wp-appt\{[\s\S]{0,320}?cursor:default/.test(style), "an appointment cannot be picked up");
  assert.ok(!/draggable/.test(/\.wp-appt[\s\S]{0,400}/.exec(style)[0]), "…it is not draggable");
  const chipHtml = /function wpCalChipsHtml\([\s\S]*?\n\}/.exec(js)[0];
  assert.ok(!/draggable|ondrag|onclick|wpChip/.test(chipHtml),
    "…and carries no drag, click or chip machinery at all");

  /* ============ 5. Google going down costs the appointments and nothing else ============ */
  assert.ok(/renderWeeklyPlan\(\);\s*\n[\s\S]{0,400}?wpCalRefresh\(\);/.test(js),
    "the plan renders FIRST; the calendar arrives afterwards");
  assert.ok(/catch \{ wpCalClientId = ""; \}/.test(js), "a missing config is not an error");
  assert.ok(/wpCalEvents = null;\s*\n\s*wpCalNote = "error";/.test(js), "a failed read leaves the plan untouched");
  assert.ok(/if \(wpPlan\) renderWeeklyPlan\(\);/.test(js), "…and only redraws when there is a plan to redraw");

  console.log("v148-the-wall-before-the-space.test: all assertions passed");
})();
