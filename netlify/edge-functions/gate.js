// netlify/edge-functions/gate.js  (v271)
//
// The dashboard's one lock. Every page and every data address passes through here first, so a
// new page or function is covered without having to remember it.
//
// DASHBOARD_PASSWORD in Netlify turns it on, and with it unset nothing is locked. The session
// cookie and the key that background jobs carry are both signed with the password, so
// changing the password signs every device out.
//
// Who gets through without signing in:
//   · ask-claude-agent, which checks a one-use job token of its own. That is how the cloud
//     Claude run gets in, and it can reach only the job it was started for.
//   · the login page itself.
//   · jobs inside the site that call each other, carrying the signed x-dashboard-internal key.
const COOKIE = "bs_session";
const YEAR_SECONDS = 365 * 24 * 60 * 60;
const AGENT_PATH = "/.netlify/functions/ask-claude-agent";
const enc = new TextEncoder();

const readEnv = (k) => {
  try { return (globalThis.Netlify && Netlify.env.get(k)) || ""; } catch { return ""; }
};
async function sign(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const out = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(out)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function same(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length || !a.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export const sessionValue = async (secret, expires) => expires + "." + (await sign(secret, "session:" + expires));
async function validSession(req, secret) {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([0-9]+\\.[a-f0-9]{64})"));
  if (!m) return false;
  const expires = Number(m[1].split(".")[0]);
  if (!(expires > Date.now())) return false;
  return same(m[1], await sessionValue(secret, expires));
}
// a path on this site, never an address elsewhere
export const safeNext = (v) => (typeof v === "string" && /^\/(?![\/\\])/.test(v) ? v : "/daily.html");

function loginPage(next, wrong) {
  const n = safeNext(next).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Bodysculpt</title>
<style>
:root{color-scheme:light}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3f5f8;color:#171b22;font:16px/1.45 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:16px;box-sizing:border-box}
form{width:100%;max-width:360px;background:#fff;border:1px solid #e1e5eb;border-radius:14px;padding:24px;box-sizing:border-box;display:flex;flex-direction:column;gap:12px}
h1{margin:0;font-size:24px;font-weight:800;letter-spacing:-.02em}
label{font-size:14px;font-weight:600}
input[type=password]{min-height:48px;padding:0 12px;border:1px solid #cdd3dc;border-radius:10px;font:16px inherit;box-sizing:border-box;width:100%}
button{min-height:48px;border:0;border-radius:10px;background:#b4471b;color:#fff;font:600 16px inherit;cursor:pointer}
input:focus-visible,button:focus-visible{outline:3px solid rgba(180,71,27,.55);outline-offset:2px}
p{margin:0;padding:10px 12px;border-radius:10px;background:#fbe6ea;color:#8f1030;font-size:14px}
</style></head><body>
<form method="post" action="/login"><h1>Bodysculpt</h1>
${wrong ? '<p role="alert">That password didn\'t work. Please try again.</p>' : ""}
<input type="hidden" name="next" value="${n}">
<input type="text" name="username" value="Bodysculpt" autocomplete="username" hidden>
<label for="pw">Password</label>
<input id="pw" type="password" name="password" autocomplete="current-password" required autofocus>
<button type="submit">Sign in</button></form></body></html>`;
}
const page = (html, status) => new Response(html, { status,
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });

export default async (req, context) => {
  const url = new URL(req.url);
  const path = url.pathname;
  if (url.searchParams.get("gateprobe")) return new Response("gate");
  const secret = readEnv("DASHBOARD_PASSWORD");
  if (!secret) return context.next();
  if (path === AGENT_PATH) return context.next();

  if (path === "/login" && req.method === "POST") {
    const form = await req.formData().catch(() => null);
    const given = String((form && form.get("password")) || "");
    const next = safeNext(String((form && form.get("next")) || ""));
    if (!same(await sign(secret, "pw:" + given), await sign(secret, "pw:" + secret))) {
      await new Promise((r) => setTimeout(r, 900));   // a guesser gets one try a second at best
      return page(loginPage(next, true), 401);
    }
    const value = await sessionValue(secret, Date.now() + YEAR_SECONDS * 1000);
    return new Response(null, { status: 303, headers: { location: next, "cache-control": "no-store",
      "set-cookie": `${COOKIE}=${value}; Max-Age=${YEAR_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax` } });
  }
  if (path === "/logout") {
    return new Response(null, { status: 303, headers: { location: "/login", "cache-control": "no-store",
      "set-cookie": `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax` } });
  }
  if (same(req.headers.get("x-dashboard-internal"), await sign(secret, "internal"))) return context.next();
  if (await validSession(req, secret)) return path === "/login" ? Response.redirect(new URL("/daily.html", url), 303) : context.next();

  const isData = path.startsWith("/.netlify/") || path.startsWith("/api/");
  if (isData) return Response.json({ error: "Please sign in." }, { status: 401, headers: { "cache-control": "no-store" } });
  const wantsPage = req.method === "GET" && /text\/html|\*\/\*/.test(req.headers.get("accept") || "") && (path === "/" || path === "/login" || path.endsWith(".html") || !/\.[a-z0-9]+$/i.test(path));
  if (wantsPage) return page(loginPage(path === "/login" ? url.searchParams.get("next") : path + url.search, false), 401);
  return new Response("Please sign in.", { status: 401, headers: { "cache-control": "no-store" } });
};

export const config = { path: "/*" };
