// v69 harness — the "Dial in" playlist link-out in the Focus Timer cluster.
// Assertions: the button renders in the idle preset row as a validated https anchor
// carrying target="_blank" + rel="noopener noreferrer"; wpValidUrl has NOT been
// loosened to accept non-http(s) schemes (the spotify: URI stays a hardcoded
// constant); first click suppresses the tab and attempts the app URI, with exactly
// one web-fallback re-click when the app doesn't take it — and none when it does.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const NOW = new Date();
function mondayIso(d) {
  const x = new Date(d);
  const back = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - back);
  x.setUTCHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}
const WEEK = mondayIso(NOW);
const APP_URI = "spotify:playlist:1VKtv1xJtFFkS3OsaFY3WZ";
const WEB_URL = "https://open.spotify.com/playlist/1VKtv1xJtFFkS3OsaFY3WZ";

(async () => {
  const plans = { [WEEK]: { weekEnding: WEEK, placements: {}, notes: "" } };
  const { ctx } = await boot({ plans });
  await ctx.loadWeeklyPlan(WEEK);

  // ---------- 1: renders in the idle timer cluster, href routed through wpValidUrl ----------
  ctx.wpOpenToday();
  let html = ctx.document.getElementById("wpTodayBody").innerHTML;
  assert.ok(html.includes(`class="wp-dialin"`), "Dial in button renders");
  assert.ok(html.includes(`href="${WEB_URL}"`), "href is the https fallback (validated form)");
  assert.ok(html.includes(`target="_blank"`), "fallback opens in a new tab");
  assert.ok(html.includes(`rel="noopener noreferrer"`), "fallback carries noopener noreferrer");
  const box = html.slice(html.indexOf(`id="wpTimerBox"`), html.indexOf("wp-today-row"));
  assert.ok(box.includes("wpStartTimer(30)") && box.includes("wp-dialin"), "sits in the same cluster as the presets");
  assert.strictEqual(ctx.wpValidUrl(WEB_URL), WEB_URL, "the anchor href is exactly wpValidUrl's output");
  assert.ok(!html.includes(`href="spotify:`), "the app URI is never rendered as a link href");

  // ---------- 2: wpValidUrl NOT loosened for custom schemes ----------
  [APP_URI, "spotify:track:abc", "javascript:alert(1)", "data:text/html,x", "ftp://x.com/a"].forEach((u) =>
    assert.strictEqual(ctx.wpValidUrl(u), null, "non-http(s) scheme still rejected: " + u)
  );
  assert.strictEqual(ctx.wpValidUrl("example.com/x"), "https://example.com/x", "bare-domain prefixing intact");

  // ---------- 3: app-first — first click suppresses the tab, attempts the URI, then ONE fallback ----------
  const a = { clicks: 0, lastReturn: null, click() { this.clicks++; this.lastReturn = ctx.wpDialIn(this); } };
  assert.strictEqual(ctx.wpDialIn(a), false, "first click: anchor default suppressed (no tab yet)");
  assert.strictEqual(ctx.window.location.href, APP_URI, "spotify: app URI attempted first");
  await new Promise((r) => setTimeout(r, 1450));
  assert.strictEqual(a.clicks, 1, "app didn't take it → exactly one fallback re-click");
  assert.strictEqual(a.lastReturn, true, "the re-click follows the https anchor (default allowed)");

  // ---------- 4: app takes over (page loses focus) → fallback suppressed, no double-open ----------
  ctx.window.location.href = "";
  const b = { clicks: 0, click() { this.clicks++; } };
  ctx.wpDialIn(b);
  const blurs = ctx.window._handlers.blur || [];
  assert.ok(blurs.length, "blur listener armed while waiting on the app");
  blurs[blurs.length - 1]();                 // the desktop app steals focus
  await new Promise((r) => setTimeout(r, 1450));
  assert.strictEqual(b.clicks, 0, "focus lost to the app → no web tab opened");
  assert.strictEqual((ctx.window._handlers.blur || []).length, 0, "listeners cleaned up after the wait window");

  // ---------- 5: timer and modal behaviour untouched ----------
  const t0 = Date.now();
  ctx.wpStartTimer(30);
  const st = ctx.__wpState;
  assert.ok(st.timer.endAt >= t0 + 30 * 60000, "timer still starts normally");
  html = ctx.document.getElementById("wpTimerBox").innerHTML;
  assert.ok(!html.includes("wp-dialin") || html.includes("wpTimerClock"), "running state renders the clock as before");
  ctx.wpResetTimer();
  ctx.wpCloseToday();
  assert.strictEqual(ctx.document.body.style.overflow, "", "close/scroll-lock behaviour unchanged");

  console.log("v69-dial-in.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
