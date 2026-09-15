// v161 — connect once.
//
// Ash: "The first thing I want you to fix is the fact I am being asked to log into my Gmail
// account everytime I open this dashboard."
//
// v153 had already diagnosed the hour-long token and written a quiet renewal — through
// Google's sign-in script with prompt:"". That was right in principle and could never work
// in practice: the token client renews by OPENING A POP-UP, and every browser blocks a
// pop-up that no click asked for. Page load is not a click. So the renewal failed silently
// on every return visit, the card showed Connect, and Connect was wired to prompt:"consent"
// — the full Google screen, every time.
//
// The fix is the authorization-code flow: one consent screen per device, whose one-time
// code goes to a new Netlify function (google-auth) that swaps it for a refresh token the
// browser never sees, and hands the browser a DEVICE KEY. From then on an expired token is
// renewed by a plain POST — no window, no Google script — which is the only version of
// "quietly" a browser actually allows.
//
// What this test pins is the shape of that, and the lines that keep it safe:
//   1. the pages never use the token client again, and only the Connect CLICK opens a window
//   2. the function never gives out the refresh token, only accepts the owner's account, and
//      stores device keys hashed
//   3. the secret is a Netlify variable that never reaches ?webconfig=1
//   4. the weekly page renews the same way and no longer loads Google's script at all
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const DAILY = read("daily.html");
const WEEKLY = read("index.html");
const js = DAILY.slice(DAILY.lastIndexOf("<script>") + 8, DAILY.lastIndexOf("</script>"));
const wjs = WEEKLY.slice(WEEKLY.lastIndexOf("<script>") + 8, WEEKLY.lastIndexOf("</script>"));
const fnSrc = read("netlify/functions/google-auth.js");
const store = read("netlify/functions/kpi-store.js");
const fn = (src, name) => {
  const i = src.indexOf("function " + name + "(");
  assert.ok(i >= 0, "function " + name + " exists");
  return src.slice(i, src.indexOf("\n}\n", i) + 3);
};

/* ================= 0. the stamp ================= */
const text = "build v165 · numbers-in-the-rail";
for (const f of ["monthly.html", "index.html", "finances.html", "daily.html", "social.html"]) {
  assert.ok(read(f).includes(text), f + " carries the stamp");
}

/* ============ 1. THE DAILY PAGE: a window only on a click ============ */
assert.ok(!/initTokenClient|requestAccessToken/.test(js),
  "the token client is gone — its renewal was a pop-up the browser blocks on page load");
assert.ok(/initCodeClient\(\{/.test(js) && /ux_mode: "popup"/.test(js), "the code client takes its place, in a pop-up");
// requestCode() — the one thing that opens a Google window — lives in gcalAuth and only
// on the non-silent path, which only a click reaches.
assert.strictEqual((js.match(/\.requestCode\(\)/g) || []).length, 1, "exactly one place opens a Google window");
const auth = fn(js, "gcalAuth");
assert.ok(/\.requestCode\(\)/.test(auth), "…and it is gcalAuth");
assert.ok(/if \(silent\) \{[\s\S]*?gauthPost\(\{ op: "token", deviceKey: gcalDevice \}\)/.test(auth),
  "the silent path asks google-auth with the device key and touches no window");
assert.ok(/if \(!gcalDevice\) return Promise\.reject/.test(auth), "…and a browser with no device key is told to connect, not quietly popped");
// the renewal on load is the silent path, and nothing else
const renew = fn(js, "gcalTryRenew");
assert.ok(/gcalAuth\(true\)/.test(renew) && !/gcalAuth\(false\)/.test(renew), "the load-time renewal is silent only");
assert.ok(!/gcalWaitForGoogle/.test(renew), "…and does not wait for Google's script, which it no longer needs");
assert.ok(/if \(gcalClientId && !gcalReady\(\)\) await gcalTryRenew\(\);/.test(js),
  "…and runs before anything on the page decides nobody is signed in");
assert.ok(/gcalDevice = gcalLoadDevice\(\);/.test(js), "the device key is read on load, next to the token");
// the two clicks that connect are the only callers of the non-silent path
assert.strictEqual((js.match(/gcalAuth\(false\)/g) || []).length, 2, "two Connect buttons, and nothing else, open the consent screen");
// a device key comes back from connect and is kept; a 'reconnect' answer throws it away
assert.ok(/gauthPost\(\{ op: "connect", code: resp\.code \}\)/.test(auth), "the code goes to google-auth");
assert.ok(/gcalSaveDevice\(r\.deviceKey\)/.test(auth), "…and the device key it answers with is kept");
const post = fn(js, "gauthPost");
assert.ok(/body\.error === "unknown-device" \|\| body\.error === "reconnect"\)\) gcalDisconnect\(\)/.test(post),
  "a browser the function does not recognise forgets its key and shows Connect once more");
assert.ok(/const GAUTH = "\/\.netlify\/functions\/google-auth";/.test(js), "the function's address is fixed");
assert.ok(!/refreshToken|refresh_token/.test(js), "the page has no notion of a refresh token — it never sees one");

/* ============ 2. THE FUNCTION: what it keeps, and from whom ============ */
assert.ok(/redirect_uri: "postmessage"/.test(fnSrc), "the code is exchanged the way Google's pop-up client requires");
assert.ok(/grant_type: "authorization_code"/.test(fnSrc) && /grant_type: "refresh_token"/.test(fnSrc),
  "…once for the grant, then for every renewal");
// the refresh token is never in a reply
const replies = [...fnSrc.matchAll(/(?:json|Response\.json)\(\{([\s\S]*?)\}\s*[,)]/g)].map((m) => m[1]);
assert.ok(replies.length >= 3, "the function answers with objects");
for (const r of replies) assert.ok(!/refresh/i.test(r), "no reply carries the refresh token: " + r.trim());
// only the owner's account may connect, checked BEFORE anything is stored
const connect = fn(fnSrc, "connect");
const check = connect.indexOf("email !== allowedAccount()");
const firstStore = connect.indexOf("store.set(");
assert.ok(check > 0 && firstStore > check, "the account is checked before the first store.set");
assert.ok(/return fail\(403, "wrong-account"/.test(connect), "…and a different account is refused");
// device keys: random, and stored hashed
assert.ok(/randomBytes\(32\)\.toString\("hex"\)/.test(connect), "a device key is 32 random bytes");
assert.ok(/devices\[hash\(deviceKey\)\] = /.test(connect), "…stored by its hash");
const token = fn(fnSrc, "token");
assert.ok(/if \(!devices\[hash\(deviceKey\)\]\) return fail\(401, "unknown-device"/.test(token), "…and looked up by its hash");
assert.ok(/\/\^\[0-9a-f\]\{64\}\$\//.test(token), "…after a shape check, so garbage never reaches the store");
assert.ok(/e\.code === "invalid_grant"/.test(token) && /"reconnect"/.test(token),
  "a dead refresh token is named as such, so the page asks for one more consent rather than looping");
// three keys, so a token request cannot clobber a device being added
for (const k of ['"google-auth"', '"google-auth-access"', '"google-auth-devices"']) {
  assert.ok(fnSrc.includes(k), "blob key " + k);
}
assert.ok(/if \(req\.method !== "POST"\) return fail\(405/.test(fnSrc), "GET gets nothing");

/* ============ 3. THE SECRET stays a secret ============ */
assert.ok(/process\.env\.GOOGLE_CLIENT_SECRET/.test(fnSrc), "the function reads the secret from Netlify");
const webconfig = store.slice(store.indexOf('searchParams.get("webconfig")'), store.indexOf("weeklyagenda"));
assert.ok(/googleConnectReady: !!\(process\.env\.GOOGLE_CLIENT_ID && process\.env\.GOOGLE_CLIENT_SECRET\)/.test(webconfig),
  "webconfig says WHETHER the secret is set");
assert.ok(!/googleClientSecret|GOOGLE_CLIENT_SECRET \|\|/.test(webconfig), "…and never what it is");
assert.ok(/gcalServerReady = !!config\.value\.googleConnectReady;/.test(js), "the page reads that yes/no");
assert.ok(/GOOGLE_CLIENT_SECRET<\/code> is not set in Netlify/.test(js), "…and says so on the card before anyone clicks");

/* ============ 4. THE WEEKLY PAGE: same renewal, no Google script ============ */
assert.ok(!/accounts\.google\.com\/gsi\/client/.test(WEEKLY), "the weekly page no longer loads Google's sign-in script");
assert.ok(/accounts\.google\.com\/gsi\/client/.test(DAILY), "…the daily page still does, for the one Connect click");
const wauth = fn(wjs, "wpCalAuthSilent");
assert.ok(/fetch\(WPCAL_AUTH, \{\s*\n\s*method: "POST"/.test(wauth) && /op: "token", deviceKey: device/.test(wauth),
  "the weekly page renews with the device key");
assert.ok(/const WPCAL_DEVICE_KEY = "bodysculpt:gdevice";/.test(wjs) && /const GCAL_DEVICE_KEY = "bodysculpt:gdevice";/.test(js),
  "…read from the same place the daily page keeps it");
assert.ok(/localStorage\.removeItem\(WPCAL_DEVICE_KEY\)/.test(wauth), "…and forgotten when the function says reconnect");
assert.ok(!/initCodeClient|initTokenClient|requestCode|requestAccessToken/.test(wjs),
  "the weekly page has no way to open a Google window");

/* ============ 5. THE SETUP DOC says what to do ============ */
const doc = read("CALENDAR-SETUP.md");
assert.ok(/GOOGLE_CLIENT_SECRET/.test(doc), "the doc names the new variable");
assert.ok(/Internal/.test(doc) && /Testing/.test(doc), "…and explains Testing's seven-day limit and the Internal way round it");

/* ============ 6. THE FUNCTION, RUN: a fake store, a fake Google ============
   Shape checks say what the code looks like. This says what it does. */
const os = require("os");
function fakeStore() {
  const m = new Map();
  return {
    _m: m,
    async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, v); },
  };
}
(async () => {
  const src = fnSrc.replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => globalThis.__fakeStore;");
  const tmp = path.join(os.tmpdir(), "google-auth-v161-" + process.pid + ".mjs");
  fs.writeFileSync(tmp, src);
  const handler = (await import("file://" + tmp)).default;
  fs.unlinkSync(tmp);
  const savedFetch = globalThis.fetch, savedEnv = { ...process.env };
  process.env.GOOGLE_CLIENT_ID = "id-123";
  process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-secret";
  process.env.GOOGLE_ACCOUNT = "owner@example.com";
  const store = fakeStore();
  globalThis.__fakeStore = store;

  // Google, faked: which account the code belongs to, and whether refreshes still work
  let google = { email: "owner@example.com", refreshDead: false, calls: [] };
  globalThis.fetch = async (u, o) => {
    google.calls.push(String(u));
    if (String(u) === "https://oauth2.googleapis.com/token") {
      const p = new URLSearchParams(o.body);
      assert.strictEqual(p.get("client_secret"), "GOCSPX-secret", "the secret goes to Google and nowhere else");
      if (p.get("grant_type") === "authorization_code") {
        assert.strictEqual(p.get("redirect_uri"), "postmessage");
        return { ok: true, json: async () => ({ access_token: "AT-" + p.get("code"), refresh_token: "RT-" + p.get("code"), expires_in: 3599, scope: "s" }) };
      }
      if (google.refreshDead) return { ok: false, status: 400, json: async () => ({ error: "invalid_grant", error_description: "Token has been expired or revoked." }) };
      return { ok: true, json: async () => ({ access_token: "AT-fresh", expires_in: 3599, scope: "s" }) };
    }
    if (String(u).endsWith("/profile")) return { ok: true, json: async () => ({ emailAddress: google.email }) };
    throw new Error("unexpected fetch " + u);
  };
  const call = (body, method) => handler(new Request("https://x/.netlify/functions/google-auth",
    { method: method || "POST", headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (iPhone)" }, body: JSON.stringify(body) }));

  try {
    // GET is not a thing
    assert.strictEqual((await handler(new Request("https://x/f", { method: "GET" }))).status, 405, "GET is refused");
    // the wrong account is refused and NOTHING is stored
    google.email = "stranger@example.com";
    let r = await call({ op: "connect", code: "c1" });
    assert.strictEqual(r.status, 403, "a stranger's Google account is refused");
    assert.strictEqual(store._m.size, 0, "…and nothing at all is stored");
    // the owner connects: a device key comes back, the refresh token does not
    google.email = "owner@example.com";
    r = await call({ op: "connect", code: "c1" });
    assert.strictEqual(r.status, 200, "the owner connects");
    const c = await r.json();
    assert.ok(/^[0-9a-f]{64}$/.test(c.deviceKey), "…and gets a 64-hex device key");
    assert.strictEqual(c.accessToken, "AT-c1", "…and the first hour's token");
    assert.ok(!JSON.stringify(c).includes("RT-"), "…and never the refresh token");
    assert.strictEqual(JSON.parse(store._m.get("google-auth")).refreshToken, "RT-c1", "the refresh token is kept server-side");
    const devices = JSON.parse(store._m.get("google-auth-devices"));
    assert.ok(!(c.deviceKey in devices), "the device key is not stored in the clear");
    assert.strictEqual(Object.values(devices)[0].name, "iPhone", "…just a hash, a name and a date");
    // a wrong key gets nothing; the right key gets the cached hour, with no call to Google
    r = await call({ op: "token", deviceKey: "f".repeat(64) });
    assert.strictEqual(r.status, 401, "an unknown device key is refused");
    assert.strictEqual((await r.json()).error, "unknown-device");
    r = await call({ op: "token", deviceKey: "not-even-hex" });
    assert.strictEqual(r.status, 401, "…and so is garbage");
    const before = google.calls.length;
    r = await call({ op: "token", deviceKey: c.deviceKey });
    assert.strictEqual((await r.json()).accessToken, "AT-c1", "a known device gets the current token");
    assert.strictEqual(google.calls.length, before, "…from the cache, without troubling Google");
    // the hour is up: a refresh, from the stored refresh token
    const acc = JSON.parse(store._m.get("google-auth-access")); acc.expires = Date.now() - 1; store._m.set("google-auth-access", JSON.stringify(acc));
    r = await call({ op: "token", deviceKey: c.deviceKey });
    assert.strictEqual((await r.json()).accessToken, "AT-fresh", "an expired token is renewed");
    assert.ok(google.calls[google.calls.length - 1] === "https://oauth2.googleapis.com/token", "…via Google's token endpoint");
    // and when Google says the refresh token is dead: 'reconnect', and it is forgotten
    google.refreshDead = true;
    const acc2 = JSON.parse(store._m.get("google-auth-access")); acc2.expires = Date.now() - 1; store._m.set("google-auth-access", JSON.stringify(acc2));
    r = await call({ op: "token", deviceKey: c.deviceKey });
    assert.strictEqual(r.status, 401, "a dead refresh token means reconnect");
    assert.strictEqual((await r.json()).error, "reconnect");
    assert.strictEqual(JSON.parse(store._m.get("google-auth")).refreshToken, "", "…and the dead one is dropped");
    // …and connecting again on a second device, when Google issues no new refresh token,
    // keeps working off the one on file if there is one — and says so clearly if there is not
    google.refreshDead = false;
    globalThis.fetch = (function (inner) { return async (u, o) => {
      if (String(u) === "https://oauth2.googleapis.com/token" && new URLSearchParams(o.body).get("grant_type") === "authorization_code") {
        return { ok: true, json: async () => ({ access_token: "AT-c2", expires_in: 3599, scope: "s" }) };   // no refresh_token
      }
      return inner(u, o);
    }; })(globalThis.fetch);
    r = await call({ op: "connect", code: "c2" });
    assert.strictEqual(r.status, 400, "no refresh token on file and none issued: a clear refusal");
    assert.strictEqual((await r.json()).error, "no-refresh-token");
    store._m.set("google-auth", JSON.stringify({ refreshToken: "RT-old", email: "owner@example.com" }));
    r = await call({ op: "connect", code: "c2" });
    assert.strictEqual(r.status, 200, "…but with one on file, a second device connects fine");
    assert.strictEqual(JSON.parse(store._m.get("google-auth")).refreshToken, "RT-old", "…and keeps it");
    assert.strictEqual(Object.keys(JSON.parse(store._m.get("google-auth-devices"))).length, 2, "two devices now");
    // no secret: a sentence, not a stack trace
    delete process.env.GOOGLE_CLIENT_SECRET;
    r = await call({ op: "connect", code: "c3" });
    assert.strictEqual(r.status, 500);
    assert.ok(/GOOGLE_CLIENT_SECRET is not set/.test((await r.json()).message), "a missing secret is named in plain words");
  } finally {
    globalThis.fetch = savedFetch;
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    Object.assign(process.env, savedEnv);
    delete globalThis.__fakeStore;
  }
  console.log("v161-connect-once.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
