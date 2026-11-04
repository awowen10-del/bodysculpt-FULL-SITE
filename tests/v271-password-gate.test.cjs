// v271: one lock in front of every page and data address.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(root, "netlify/edge-functions/gate.js"), "utf8");

(async () => {
  const gate = await import(path.join(root, "netlify/edge-functions/gate.js"));
  let password = "correct horse";
  globalThis.Netlify = { env: { get: (k) => (k === "DASHBOARD_PASSWORD" ? password : "") } };
  const passed = new Response("page");
  const ctx = { next: () => passed };
  const go = (url, init) => gate.default(new Request("https://x.test" + url, init), ctx);
  const login = (pw, next) => go("/login", { method: "POST", body: new URLSearchParams({ password: pw, next: next || "/monthly.html" }),
    headers: { "content-type": "application/x-www-form-urlencoded" } });

  assert.deepStrictEqual(gate.config, { path: "/*" }, "it covers everything");

  /* ---------- locked ---------- */
  let r = await go("/monthly.html", { headers: { accept: "text/html" } });
  assert.strictEqual(r.status, 401);
  assert.ok((await r.text()).includes('type="password"'), "a page shows the sign-in");
  r = await go("/.netlify/functions/projects?list=1");
  assert.strictEqual(r.status, 401, "data needs a session");
  r = await go("/.netlify/functions/kpi-store?monthlyplan=2026-11");
  assert.strictEqual(r.status, 401);
  r = await go("/api/ads/x");
  assert.strictEqual(r.status, 401);

  /* ---------- signing in ---------- */
  r = await login("wrong");
  assert.strictEqual(r.status, 401, "a wrong password is refused");
  assert.ok(!r.headers.get("set-cookie"), "and gets no cookie");
  r = await login(password);
  assert.strictEqual(r.status, 303);
  assert.strictEqual(r.headers.get("location"), "/monthly.html");
  const cookie = r.headers.get("set-cookie");
  assert.ok(/HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Lax/.test(cookie), "the cookie can't be read by a script");
  const c = cookie.split(";")[0];
  r = await go("/.netlify/functions/projects?list=1", { headers: { cookie: c } });
  assert.strictEqual(r, passed, "a session gets through");

  r = await go("/monthly.html", { headers: { cookie: "bs_session=9999999999999." + "a".repeat(64) } });
  assert.strictEqual(r.status, 401, "a forged cookie does not");
  const old = await gate.sessionValue(password, Date.now() - 1000);
  r = await go("/monthly.html", { headers: { cookie: "bs_session=" + old } });
  assert.strictEqual(r.status, 401, "an expired one does not");
  password = "a new password";
  r = await go("/monthly.html", { headers: { cookie: c } });
  assert.strictEqual(r.status, 401, "changing the password signs every device out");
  password = "correct horse";

  /* ---------- nothing sends you off the site ---------- */
  assert.strictEqual(gate.safeNext("https://evil.test"), "/daily.html");
  assert.strictEqual(gate.safeNext("//evil.test"), "/daily.html");
  assert.strictEqual(gate.safeNext("/\\evil.test"), "/daily.html");
  assert.strictEqual(gate.safeNext("/monthly.html"), "/monthly.html");

  /* ---------- the ways through ---------- */
  r = await go("/.netlify/functions/ask-claude-agent?job=x");
  assert.strictEqual(r, passed, "the agent's door checks its own job token");
  r = await go("/.netlify/functions/ask-claude?job=x");
  assert.strictEqual(r.status, 401, "the door that starts jobs stays locked");
  process.env.DASHBOARD_PASSWORD = password;
  const { internalHeaders } = await import(path.join(root, "netlify/lib/internal.js"));
  r = await go("/.netlify/functions/takings-background", { method: "POST", headers: internalHeaders() });
  assert.strictEqual(r, passed, "a job inside the site gets through with the signed key");
  r = await go("/.netlify/functions/takings-background", { method: "POST", headers: { "x-dashboard-internal": "nope" } });
  assert.strictEqual(r.status, 401, "a made-up key does not");

  /* ---------- every job that calls the site carries the key ---------- */
  const dir = path.join(root, "netlify/functions");
  for (const f of fs.readdirSync(dir)) {
    const s = fs.readFileSync(path.join(dir, f), "utf8");
    if (/functions\/[a-z-]+-background/.test(s.replace(/^\s*(\/\/|\*).*$/gm, ""))) assert.ok(s.includes("...internalHeaders()"), f + " carries the key");
  }

  /* ---------- no password set: nothing is locked ---------- */
  password = "";
  r = await go("/monthly.html");
  assert.strictEqual(r, passed, "with no password the site stays open, so it can't lock Ash out by accident");

  console.log("v271-password-gate.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
