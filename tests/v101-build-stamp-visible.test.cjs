// v101: the build stamp is on screen on BOTH pages, and both carry the same suite build.
//
// Why this test exists: monthly.html's stamp was only an HTML comment, so the Monthly
// Report never displayed a build at all; index.html had the only visible stamp and it read
// v98, because v99 and v100 changed monthly.html only. A refresh after a monthly-only
// release therefore looked completely unchanged. This asserts the three stamp strings agree,
// so a release that bumps one file and forgets the other fails here instead of on screen.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/monthly-env.cjs");

const MONTHLY = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const WEEKLY = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const STAMP = /build v(\d+) · ([a-z0-9-]+)/;

(async () => {
  /* ---------- 1. every page carries a stamp, in the same format ---------- */
  const comment = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(MONTHLY);
  assert.ok(comment, "monthly.html carries its machine-readable stamp comment");

  const monthlyVisible = /<span class="mp-stage">([^<]+)<\/span>/.exec(MONTHLY);
  assert.ok(monthlyVisible, "monthly.html renders a build stamp on screen");
  const weeklyVisible = /<span class="stage" style="[^"]*">([^<]+)<\/span>/.exec(WEEKLY);
  assert.ok(weeklyVisible, "index.html renders a build stamp on screen");

  /* ---------- 2. …and they are all the SAME build ---------- */
  const mText = monthlyVisible[1].trim();
  const wText = weeklyVisible[1].trim();
  assert.strictEqual(mText, "build " + comment[1].replace(/^/, "v") + " · " + comment[2],
    "monthly.html's on-screen stamp matches its comment");
  assert.strictEqual(wText, mText,
    "the Weekly Dashboard and Monthly Report show the SAME build — bump both, or this fails");

  // the slug moves with each release; what this test guards is that the two pages agree and
  // that the stamp is visible — the exact current stamp is the newest test's job.
  const [, num] = STAMP.exec(mText);
  assert.ok(Number(num) >= 101, "the suite build is v101 or later");

  /* ---------- 3. the stamp is real page content, not a comment ---------- */
  {
    // it must sit inside <body> — a stamp in <head> or in a comment is invisible, which is
    // the entire bug this release fixes
    const bodyStart = MONTHLY.indexOf("<body>");
    assert.ok(MONTHLY.indexOf('<span class="mp-stage">') > bodyStart, "the monthly stamp is inside <body>");
    assert.ok(/\.mp-stage\{[^}]*display:inline-block/.test(MONTHLY), "…and is styled as a visible pill");
    assert.ok(!/\.mp-(footer|stage)\{[^}]*display:none/.test(MONTHLY), "…and is not hidden");
    // it survives a render — nothing in the app overwrites the footer
    const env = await boot({ plans: {} });
    const footer = env.ctx.document.getElementById("mpBody");
    assert.ok(footer, "the plan body renders independently of the footer");
    assert.ok(MONTHLY.indexOf('<footer class="mp-footer">') > MONTHLY.indexOf('<div id="mpBody">'),
      "the footer sits outside #mpBody, so redrawing the plan never wipes it");
  }

  /* ---------- 4. nothing else moved ---------- */
  assert.ok(/<span class="stage" id="srcPill">● Your data<\/span>/.test(WEEKLY),
    "the weekly footer's data pill is unchanged");
  assert.strictEqual((MONTHLY.match(/build v\d+ · [a-z0-9-]+/g) || []).length, 2,
    "monthly.html declares its build in exactly two places (comment + visible)");
  assert.strictEqual((WEEKLY.match(/build v\d+ · [a-z0-9-]+/g) || []).length, 1,
    "index.html declares its build once");

  console.log("v101-build-stamp-visible.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
