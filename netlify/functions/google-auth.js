// Netlify Function: google-auth  (v161)
//
// Why this exists: "I am being asked to log into my Gmail account every time I open this
// dashboard."
//
// Google hands a web page an access token that lasts about an hour. The page used to ask
// Google's sign-in library for a fresh one when it expired — but that library can only do
// so by opening a pop-up window, and browsers block pop-ups nobody clicked for. So every
// return visit after an hour looked like being signed out, and the Connect button was
// wired to force the full consent screen. Hence: a login, every time.
//
// The fix is the one Google recommends for exactly this: the AUTHORIZATION CODE flow. The
// browser asks Google for a one-time code (one consent screen, once), sends it here, and
// this function swaps it for a REFRESH TOKEN — a long-lived credential that only a server
// should ever hold. From then on the page just asks this function for a fresh access token
// whenever it needs one. No pop-up, no consent screen, no Google script involved.
//
// What is kept, in the same blob store as everything else:
//   google-auth          { refreshToken, email, scope, grantedAt }   the long-lived credential
//   google-auth-access   { token, expires, scope }                    the current hour's pass
//   google-auth-devices  { [sha256(deviceKey)]: { name, addedAt } }  which browsers may ask
// Three keys, not one, so a page asking for a token cannot clobber a device being added.
//
// Who may ask. The refresh token never leaves this function. A page gets an access token
// only by presenting a DEVICE KEY, and a device key is minted only by completing a Google
// sign-in AS THE ALLOWED ACCOUNT (env GOOGLE_ACCOUNT, default the owner's address). So the
// worst a stranger with the site's URL can do is look at a Connect button — the same as
// today — and the worst a stranger with Ash's Google password can do is nothing this
// function makes worse. Device keys are stored hashed: the blob store cannot be read for
// a working key.
//
// Netlify environment variables it needs:
//   GOOGLE_CLIENT_ID      already set for the calendar (public)
//   GOOGLE_CLIENT_SECRET  NEW — from the same OAuth client in the Google Cloud console.
//                         SECRET. Never goes to the browser, never into ?webconfig=1.
//   GOOGLE_ACCOUNT        optional — the one Google account allowed to connect.
//
// Errors are JSON with a plain sentence in `message`, because the card shows it to Ash.

import { getStore } from "@netlify/blobs";
import { createHash, randomBytes } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const KEY_GRANT = "google-auth";
const KEY_ACCESS = "google-auth-access";
const KEY_DEVICES = "google-auth-devices";
const DEFAULT_ACCOUNT = "ash@bodysculptwarrington.com";
const ACCESS_SLACK_MS = 2 * 60 * 1000;   // a cached pass with under two minutes left is not handed out
const MAX_DEVICES = 20;

const json = (body, status) => Response.json(body, { status: status || 200 });
const fail = (status, error, message) => json({ error, message }, status);
const hash = (s) => createHash("sha256").update(String(s)).digest("hex");
const allowedAccount = () => String(process.env.GOOGLE_ACCOUNT || DEFAULT_ACCOUNT).trim().toLowerCase();

// "iPhone", "Mac", … — enough to tell devices apart in a list, and nothing more personal.
function deviceName(ua) {
  const s = String(ua || "");
  if (/iPhone/.test(s)) return "iPhone";
  if (/iPad/.test(s)) return "iPad";
  if (/Android/.test(s)) return "Android";
  if (/Macintosh/.test(s)) return "Mac";
  if (/Windows/.test(s)) return "Windows PC";
  return "Device";
}

/* ---------- talking to Google's token endpoint ---------- */
async function googleToken(params) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error_description || body.error || ("Google returned " + res.status));
    err.code = body.error || "google_error";
    throw err;
  }
  return body;
}

async function whoIsThis(accessToken) {
  const res = await fetch(PROFILE_URL, { headers: { Authorization: "Bearer " + accessToken } });
  const body = await res.json().catch(() => ({}));
  return String((body && body.emailAddress) || "").trim().toLowerCase();
}

/* ---------- the two things the page can ask ---------- */

// connect: a one-time code from the consent screen becomes a refresh token (kept here) and a
// device key (returned, kept by that browser). Returns the first hour's access token too.
async function connect(store, code, ua) {
  const clientId = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !secret) {
    return fail(500, "not-configured",
      "GOOGLE_CLIENT_SECRET is not set in Netlify yet. Site configuration → Environment variables — CALENDAR-SETUP.md has the steps.");
  }
  if (typeof code !== "string" || !code || code.length > 2048) return fail(400, "bad-code", "No sign-in code arrived.");

  let grant;
  try {
    grant = await googleToken({
      code, client_id: clientId, client_secret: secret,
      grant_type: "authorization_code",
      redirect_uri: "postmessage",   // what Google's pop-up code client uses; not a real URL
    });
  } catch (e) {
    return fail(400, "exchange-failed", "Google would not accept the sign-in: " + e.message);
  }

  // Only the owner's account may be the one this dashboard reads. Anyone else completing
  // the consent screen is told so, and nothing is stored.
  const email = await whoIsThis(grant.access_token);
  if (!email || email !== allowedAccount()) {
    return fail(403, "wrong-account",
      "That is " + (email || "a different Google account") + ". This dashboard connects to " + allowedAccount() + " only — pick that one on Google's screen.");
  }

  const existing = (await store.get(KEY_GRANT, { type: "json" })) || null;
  // Google issues a refresh token on consent. If it did not (a second device, consent
  // already on file), the one already kept still works — as long as there is one.
  const refreshToken = grant.refresh_token || (existing && existing.email === email && existing.refreshToken) || "";
  if (!refreshToken) {
    return fail(400, "no-refresh-token",
      "Google did not issue a long-lived credential. In your Google account, under Security → Third-party access, remove Bodysculpt Dashboard, then connect again.");
  }
  await store.set(KEY_GRANT, JSON.stringify({
    refreshToken, email, scope: grant.scope || "", grantedAt: new Date().toISOString(),
  }));
  await store.set(KEY_ACCESS, JSON.stringify({
    token: grant.access_token, expires: Date.now() + (Number(grant.expires_in) || 3600) * 1000, scope: grant.scope || "",
  }));

  const deviceKey = randomBytes(32).toString("hex");
  const devices = (await store.get(KEY_DEVICES, { type: "json" })) || {};
  // the oldest goes when the list is full — a key nobody has used in twenty devices' time
  const ids = Object.keys(devices).sort((a, b) => String(devices[a].addedAt).localeCompare(String(devices[b].addedAt)));
  while (ids.length >= MAX_DEVICES) delete devices[ids.shift()];
  devices[hash(deviceKey)] = { name: deviceName(ua), addedAt: new Date().toISOString() };
  await store.set(KEY_DEVICES, JSON.stringify(devices));

  return json({
    deviceKey, email,
    accessToken: grant.access_token, expiresIn: Number(grant.expires_in) || 3600, scope: grant.scope || "",
  });
}

// token: a known device asks for the current hour's pass. Cached while it has life left,
// otherwise renewed with the refresh token. The refresh token itself is never in the reply.
async function token(store, deviceKey) {
  if (typeof deviceKey !== "string" || !/^[0-9a-f]{64}$/.test(deviceKey)) return fail(401, "unknown-device", "This browser is not connected yet.");
  const devices = (await store.get(KEY_DEVICES, { type: "json" })) || {};
  if (!devices[hash(deviceKey)]) return fail(401, "unknown-device", "This browser is not connected yet.");

  const cached = (await store.get(KEY_ACCESS, { type: "json" })) || null;
  if (cached && cached.token && cached.expires - ACCESS_SLACK_MS > Date.now()) {
    return json({ accessToken: cached.token, expiresIn: Math.floor((cached.expires - Date.now()) / 1000), scope: cached.scope || "" });
  }

  const grant = (await store.get(KEY_GRANT, { type: "json" })) || null;
  if (!grant || !grant.refreshToken) return fail(401, "reconnect", "Google needs connecting again.");
  const clientId = process.env.GOOGLE_CLIENT_ID, secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !secret) return fail(500, "not-configured", "GOOGLE_CLIENT_SECRET is not set in Netlify.");

  let fresh;
  try {
    fresh = await googleToken({
      refresh_token: grant.refreshToken, client_id: clientId, client_secret: secret, grant_type: "refresh_token",
    });
  } catch (e) {
    // invalid_grant = the consent was withdrawn, or the app is still in "Testing" at Google,
    // where a refresh token is deliberately killed after seven days. Either way: once more
    // through the consent screen, and say why.
    if (e.code === "invalid_grant") {
      await store.set(KEY_GRANT, JSON.stringify({ ...grant, refreshToken: "", diedAt: new Date().toISOString() }));
      return fail(401, "reconnect",
        "Google has ended the connection (it does this weekly while the app is in 'Testing' at Google — CALENDAR-SETUP.md says how to stop that). Connect once more.");
    }
    return fail(502, "google-error", "Google would not renew the sign-in: " + e.message);
  }
  const expires = Date.now() + (Number(fresh.expires_in) || 3600) * 1000;
  await store.set(KEY_ACCESS, JSON.stringify({ token: fresh.access_token, expires, scope: fresh.scope || grant.scope || "" }));
  return json({ accessToken: fresh.access_token, expiresIn: Number(fresh.expires_in) || 3600, scope: fresh.scope || grant.scope || "" });
}

export default async (req) => {
  if (req.method !== "POST") return fail(405, "method", "POST only.");
  let body;
  try { body = await req.json(); } catch { return fail(400, "bad-json", "Could not read the request."); }
  const store = getStore({ name: "bodysculpt-kpi", consistency: "strong" });
  const op = body && body.op;
  if (op === "connect") return connect(store, body.code, req.headers.get("user-agent"));
  if (op === "token") return token(store, body.deviceKey);
  return fail(400, "bad-op", "Not something this function does.");
};
