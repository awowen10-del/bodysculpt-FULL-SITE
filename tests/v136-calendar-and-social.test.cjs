// v136 — the week across the top, and a Social page.
//
// Ash: "connect my Google Calendar with today's schedule at a glance with a horizontal week
// view … create events and invite people without leaving the dashboard … see my last 25
// instagram posts with reach, views, shares, saves and engagement rate … track my
// competition, monitor up to 10 instagram accounts … toggle between my posts and any
// competitors."
//
// THE THING THIS FILE EXISTS TO PIN, first and hardest:
//
//   Every request daily.html makes to the BODYSCULPT STORE goes through jget(url) and
//   carries no options. The only requests that carry a method go through gcalFetch, whose
//   URL is a fixed Google base with a path appended — so no caller can point a write at
//   anything else, least of all the blob store holding the KPI history and the quarterly
//   reviews.
//
// v135 said "no POST anywhere on the page", which was a cruder proxy for the same claim.
// Creating a calendar event breaks the proxy and cannot touch the thing being protected,
// so the claim is now stated in the terms that actually matter and tested in those terms.
//
// The second thing worth stating plainly, because it shapes the whole Social page: reach,
// views, saves and shares are PRIVATE. Instagram gives them for accounts you own and for
// nobody else, so the two sides of the toggle compute engagement differently and the page
// says so on screen. The comparison that survives the difference is a post against its own
// account's median — which is what an outlier means here, and it is checked below.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const DAILY = read("daily.html");
const SOCIAL = read("social.html");
const STORE_SRC = path.join(__dirname, "..", "netlify", "functions", "kpi-store.js");
const IG_PATH = path.join(__dirname, "..", "netlify", "functions", "instagram-feed.js");
const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));
const scriptOf = (src) => src.slice(src.lastIndexOf("<script>") + 8, src.lastIndexOf("</script>"));

const PAGES = ["index.html", "monthly.html", "quarterly.html", "finances.html", "daily.html", "social.html"];

/* ---------- the blob store, faked (the v122 shape) ---------- */
function fakeStore(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    _m: m,
    async get(k, o) { const v = m.get(k); if (v === undefined) return null;
      return (o && o.type === "json") ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, v); },
    async list(o) { const p = (o && o.prefix) || "";
      return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })), directories: [] }; },
  };
}
async function loadPatched(srcPath, tag) {
  const src = fs.readFileSync(srcPath, "utf8");
  assert.ok(/^import \{ getStore \} from "@netlify\/blobs";$/m.test(src),
    tag + ": the store import is the single line this test swaps");
  const patched = src.replace(/^import \{ getStore \} from "@netlify\/blobs";$/m,
    "const getStore = () => globalThis.__fakeStore;");
  const tmp = path.join(os.tmpdir(), tag + "-v136-" + process.pid + "-" + Math.random().toString(36).slice(2) + ".mjs");
  fs.writeFileSync(tmp, patched);
  const mod = await import("file://" + tmp);
  fs.unlinkSync(tmp);
  return mod.default;
}
const GET = (h, qs) => h(new Request("https://x/.netlify/functions/kpi-store?" + qs));
const POST = (h, body) => h(new Request("https://x/.netlify/functions/kpi-store",
  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

/* ---------- a fake Graph API ---------- */
function igMedia(i, likes, comments) {
  return {
    id: "m" + i, caption: "Post " + i, media_type: i % 3 === 0 ? "VIDEO" : "IMAGE",
    media_url: "https://cdn/x" + i + ".jpg", thumbnail_url: i % 3 === 0 ? "https://cdn/t" + i + ".jpg" : null,
    permalink: "https://instagram.com/p/" + i, timestamp: "2026-09-0" + ((i % 9) + 1) + "T10:00:00+0000",
    like_count: likes, comments_count: comments,
  };
}
async function runIg(env, url, responder, seed) {
  const savedEnv = { ...process.env }, savedFetch = globalThis.fetch;
  for (const k of ["IG_ACCESS_TOKEN", "IG_USER_ID"]) delete process.env[k];
  Object.assign(process.env, env || {});
  globalThis.__fakeStore = fakeStore(seed || {});
  const calls = [];
  globalThis.fetch = async (u) => {
    calls.push(String(u));
    const r = responder(String(u));
    return { ok: !(r && r.error), status: r && r.error ? 400 : 200, json: async () => r };
  };
  try {
    const handler = await loadPatched(IG_PATH, "instagram-feed");
    const res = await handler(new Request("https://x/.netlify/functions/instagram-feed" + url));
    return { body: await res.json(), calls, store: globalThis.__fakeStore };
  } finally {
    globalThis.fetch = savedFetch;
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    Object.assign(process.env, savedEnv);
    delete globalThis.__fakeStore;
  }
}

(async () => {
  /* ============ 0. the stamp — this is the newest release, so it is exact ============ */
  // relaxed once v137 shipped: the newest release's test pins the exact stamp, this one
  // only checks the build never goes backwards and that the pages still agree on it.
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(read("monthly.html"));
  assert.ok(stamp && Number(stamp[1]) >= 136, "monthly.html is stamped v136 or later");
  const text = "build v" + stamp[1] + " · " + stamp[2];
  for (const f of ["index.html", "finances.html", "daily.html", "social.html"]) {
    assert.ok(read(f).includes(text), f + " carries the same stamp");
  }

  /* ============ 1. THE CLAIM: THE STORE CANNOT BE WRITTEN FROM daily.html ============ */
  const djs = scriptOf(DAILY);

  // (a) the store is read one way only, and that way takes no options
  assert.ok(/async function jget\(url\) \{\s*const r = await fetch\(url\);\s*\n/.test(djs),
    "jget(url) is the store read, and it passes fetch nothing but the url");
  for (const call of djs.match(/jget\([^)]*\)/g) || []) {
    assert.ok(!/,/.test(call), "no jget call smuggles a second argument: " + call);
  }
  // every store URL named on the page is a read
  const storeUrls = [...djs.matchAll(/API \+ "(\?[^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(storeUrls.sort(), ["?checkins=1", "?dailybriefs=1", "?webconfig=1"],
    "the page names exactly three store reads and no writes");

  // (b) everything that carries a method goes to Google, through one funnel
  const methodSites = [...djs.matchAll(/fetch\(([^,]+),\s*\{[\s\S]{0,160}?method:/g)].map((m) => m[1].trim());
  assert.ok(methodSites.length > 0, "the calendar does write — otherwise this test proves nothing");
  for (const target of methodSites) {
    assert.ok(/^GCAL_BASE \+ path$/.test(target),
      "every request carrying a method is built from GCAL_BASE, not from a caller's url: " + target);
  }
  assert.ok(/const GCAL_BASE = "https:\/\/www\.googleapis\.com\/calendar\/v3\/";/.test(djs),
    "…and GCAL_BASE is a fixed Google address");
  // the funnel appends a PATH to that base, so no caller can escape to another host
  assert.ok(!/GCAL_BASE\s*=\s*[a-zA-Z]/.test(djs.replace(/const GCAL_BASE = "[^"]*";/, "")),
    "nothing reassigns GCAL_BASE");
  assert.ok(!/\bAPI\b[^\n]*method:/.test(djs), "the store constant is never used with a method");

  // (c) the scope asked for is the smallest that does the job
  assert.ok(/GCAL_SCOPE = "https:\/\/www\.googleapis\.com\/auth\/calendar\.events"/.test(djs),
    "the page asks for calendar.events and nothing wider — not the whole account");
  assert.ok(!/client_secret|GOOGLE_CLIENT_SECRET/.test(DAILY), "no client secret anywhere near the page");

  /* ============ 2. the week strip is a week, and it is horizontal ============ */
  assert.ok(/<section class="card cal-card" id="calCard">/.test(DAILY), "the calendar card exists");
  assert.ok(DAILY.indexOf('id="calCard"') < DAILY.indexOf('<div class="day-grid">'),
    "…and it sits above the email and the money, framing them");
  const dstyle = styleOf(DAILY);
  assert.ok(/\.cal-week\{display:grid;grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/.test(dstyle),
    "the week is seven columns across, not a list down");
  assert.ok(/CAL_DNAMES = \["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"\]/.test(djs),
    "Monday-based, like every other week in this suite");
  // today has to be findable at a glance
  assert.ok(/\.cal-day\.today\{[^}]*background:rgba\(var\(--orange-rgb\)/.test(dstyle), "today's column is lit");
  assert.ok(/\.cal-ev\.now\{/.test(dstyle), "…and what is happening right now is marked");
  // the create sheet asks for the things an invitation needs
  for (const id of ["evSummary", "evDate", "evStart", "evLen", "evWhere", "evGuests", "evNotes", "evInvite"]) {
    assert.ok(DAILY.includes('id="' + id + '"'), "the new-event sheet has " + id);
  }
  assert.ok(/sendUpdates=" \+ \(invite \? "all" : "none"\)/.test(djs),
    "ticking the box is what actually emails the guests");
  assert.ok(/attendees = guests\.map|body\.attendees = guests\.map/.test(djs), "guests are attached as attendees");

  /* ============ 3. the four-group nav, on all six pages ============ */
  for (const f of PAGES) {
    const src = read(f), label = f + ": ";
    const nav = /<nav class="topnav">([\s\S]*?)<\/nav>/.exec(src);
    assert.ok(nav, label + "has a nav");
    const caps = [...nav[1].matchAll(/<use href="#(ic-[a-z-]+)"\/><\/svg>([^<]+)<\/span>/g)].map((m) => [m[1], m[2].trim()]);
    assert.deepStrictEqual(caps,
      [["ic-sun", "Today"], ["ic-calendar", "Planning"], ["ic-camera", "Social"], ["ic-wallet", "Finances"]],
      label + "four groups, in order");
    assert.strictEqual((nav[1].match(/<span class="navsep"><\/span>/g) || []).length, 3, label + "three rules");
    // only ONE of them takes the slack, or Planning gets shoved right along with Finances
    const style = styleOf(src);
    assert.ok(/\.topnav>\.navsep:last-of-type\{margin-left:auto;\}/.test(style),
      label + "only the rule before Finances takes the slack");
    assert.ok(!/\.navsep\{[^}]*margin-left:auto/.test(style), label + "…and no rule grabs it just for existing");
    assert.ok(src.includes('<symbol id="ic-camera"'), label + "carries #ic-camera");
  }

  /* ============ 4. social.html belongs to the suite ============ */
  const paletteOf = (src) => {
    const st = styleOf(src);
    const i = st.indexOf(":root{", st.indexOf(":root{") + 1);
    return st.slice(i, st.indexOf("}", i) + 1);
  };
  assert.strictEqual(paletteOf(SOCIAL), paletteOf(read("index.html")),
    "social.html carries the suite palette, byte for byte");
  const sstyle = styleOf(SOCIAL);
  const after = sstyle.slice(sstyle.indexOf(paletteOf(SOCIAL)) + paletteOf(SOCIAL).length);
  const literal = after.replace(/rgba\(var\(--[a-z0-9-]+\)[^)]*\)/g, "").match(/#[0-9a-fA-F]{3,8}\b/g);
  assert.ok(!literal, "no literal colour below the palette — even the text on a photograph comes from a token, found: " + (literal || []).join(","));
  // it is a toggle, exactly as asked
  assert.ok(/<button class="vt active" data-view="mine">My posts<\/button>/.test(SOCIAL), "tab: my posts");
  assert.ok(/<button class="vt" data-view="rivals">Competitors<\/button>/.test(SOCIAL), "tab: competitors");
  const sjs = scriptOf(SOCIAL);
  assert.ok(/const RIVAL_CAP = 10;/.test(sjs), "ten accounts, as asked");
  // the honest-labelling requirement, on the page and not just in a comment
  assert.ok(/These are not the same number as yours/.test(SOCIAL),
    "the competitors tab says out loud that its engagement rate is a different measure");
  assert.ok(/erRival/.test(sjs) && /erBasis === "followers"/.test(sjs),
    "…and the two bases are carried through the rendering, not blurred together");

  /* ============ 5. the competitor list, against the real store handler ============ */
  const SEED = {
    "weeks": JSON.stringify([{ weekEnding: "2026-08-31", leads: 41 }]),
    "planning-2026-Q2": JSON.stringify({ year: 2026, quarter: "Q2", goals: [{ id: "g1", title: "The Q2 review" }] }),
    "daily-checkins": JSON.stringify({ "2026-09-09": { date: "2026-09-09", oneThing: "Call the landlord" } }),
    "daily-briefs": JSON.stringify({ "2026-09-10": { date: "2026-09-10", items: [] } }),
  };
  const store = fakeStore(SEED);
  globalThis.__fakeStore = store;
  const h = await loadPatched(STORE_SRC, "kpi-store");

  let r = await GET(h, "igcompetitors=1");
  assert.deepStrictEqual(await r.json(), { competitors: [] }, "no list yet is an empty list, not a 500");

  r = await POST(h, { igCompetitors: [
    "https://www.instagram.com/pure_gym_warrington/?hl=en",   // a pasted profile URL
    "@TheStrengthYard",                                      // an @handle in the wrong case
    { username: "village_gym", label: "Village" },            // the proper shape
    "village_gym",                                            // a duplicate
    "!!!",                                                    // nothing at all
    ...Array.from({ length: 15 }, (_, i) => "filler" + i),    // more than ten
  ] });
  const saved = (await r.json()).competitors;
  assert.strictEqual(saved.length, 10, "the list is capped at ten");
  assert.deepStrictEqual(saved.slice(0, 3).map((c) => c.username),
    ["pure_gym_warrington", "thestrengthyard", "village_gym"],
    "a URL, an @handle and an object all arrive as plain lowercase usernames");
  assert.strictEqual(saved[2].label, "Village", "a label survives when one is given");
  assert.ok(!saved.some((c) => c.username === "" || /[^a-z0-9._]/.test(c.username)), "nothing junk got in");
  assert.strictEqual(new Set(saved.map((c) => c.username)).size, 10, "…and no duplicates");

  r = await GET(h, "igcompetitors=1");
  assert.strictEqual((await r.json()).competitors.length, 10, "the list reads back");

  // the public config route carries nothing secret
  const savedEnv = { ...process.env };
  process.env.GOOGLE_CLIENT_ID = "123-abc.apps.googleusercontent.com";
  process.env.STRIPE_SECRET_KEY = "rk_live_MUST_NOT_APPEAR";
  process.env.IG_ACCESS_TOKEN = "IGQV_MUST_NOT_APPEAR";
  r = await GET(h, "webconfig=1");
  const cfg = await r.json();
  assert.strictEqual(cfg.googleClientId, "123-abc.apps.googleusercontent.com", "the public client id is served");
  const cfgText = JSON.stringify(cfg);
  assert.ok(!cfgText.includes("MUST_NOT_APPEAR"), "and NOTHING secret rides along with it");
  assert.deepStrictEqual(Object.keys(cfg).sort(), ["googleClientId", "timeZone"], "…the route returns those two keys and no more");
  Object.assign(process.env, savedEnv);
  for (const k of ["GOOGLE_CLIENT_ID", "STRIPE_SECRET_KEY", "IG_ACCESS_TOKEN"]) if (!(k in savedEnv)) delete process.env[k];

  // AND NOTHING ELSE WAS TOUCHED — rule 5, checked rather than assumed
  for (const [k, v] of Object.entries(SEED)) {
    assert.strictEqual(store._m.get(k), v, k + " came back byte-identical after every v136 write");
  }
  delete globalThis.__fakeStore;

  /* ============ 6. the Instagram feed ============ */
  // not configured is a normal state with instructions
  let out = await runIg({}, "?mode=mine", () => ({}));
  assert.strictEqual(out.body.configured, false, "no token means configured:false");
  assert.deepStrictEqual(out.body.posts, [], "…and an empty list, so the page renders the same shape");
  assert.strictEqual(out.calls.length, 0, "…without calling Instagram at all");

  // my own posts: media, then insights per post, then the maths
  const TOKEN = "IGQV_THIS_MUST_NEVER_LEAVE_THE_SERVER";
  const ENV = { IG_ACCESS_TOKEN: TOKEN, IG_USER_ID: "17841400000000000" };
  const reach = {};   // post id -> reach, arranged so exactly one post is a clear outlier
  out = await runIg(ENV, "?mode=mine", (u) => {
    if (/\/insights/.test(u)) {
      const id = /\/(m\d+)\/insights/.exec(u)[1];
      const i = Number(id.slice(1));
      // m1 gets tiny reach against decent likes -> a high rate -> the outlier
      const rch = i === 1 ? 200 : 4000;
      reach[id] = rch;
      return { data: [
        { name: "reach", values: [{ value: rch }] },
        { name: "saved", values: [{ value: 10 + i }] },
        { name: "shares", values: [{ value: i }] },
        { name: "views", values: [{ value: rch * 2 }] },
        { name: "total_interactions", values: [{ value: 200 }] },
      ] };
    }
    if (/\/media\?/.test(u) || /\/media&/.test(u) || /media\b/.test(u) && /limit=25/.test(u)) {
      return { data: Array.from({ length: 25 }, (_, i) => igMedia(i + 1, 150, 50)) };
    }
    return { id: "1784", username: "bodysculptwarrington", name: "Bodysculpt", followers_count: 3200, media_count: 812 };
  });
  assert.strictEqual(out.body.ok, true, "a configured feed answers ok");
  assert.strictEqual(out.body.posts.length, 25, "the last 25 posts, as asked");
  assert.strictEqual(out.body.account.erBasis, "reach", "my own engagement is measured against reach");
  const mine1 = out.body.posts.find((p) => p.id === "m1");
  assert.strictEqual(mine1.reach, 200, "reach came through");
  assert.strictEqual(mine1.views, 400, "views came through");
  assert.strictEqual(mine1.saves, 11, "saves came through");
  assert.strictEqual(mine1.shares, 1, "shares came through");
  assert.ok(Math.abs(mine1.er - 1) < 1e-9, "engagement rate is interactions ÷ reach");
  assert.strictEqual(mine1.outlier, true, "the one post well above the median is flagged");
  assert.strictEqual(out.body.posts.filter((p) => p.outlier).length, 1, "…and it is the only one");
  assert.ok(Math.abs(out.body.median - 0.05) < 1e-9, "the median is the middle post, not the mean");
  // a video's card image is its thumbnail, not the video file
  const vid = out.body.posts.find((p) => p.type === "VIDEO");
  assert.ok(vid.image.startsWith("https://cdn/t"), "a reel's card shows its thumbnail, not the .mp4");
  // the secret stayed put
  assert.ok(!JSON.stringify(out.body).includes(TOKEN), "the access token is nowhere in the response");
  // ...and it was cached under its own prefix and nothing else was written
  const keys = [...out.store._m.keys()];
  assert.deepStrictEqual(keys, ["ig-cache-mine"], "the feed wrote exactly one key, and it is its own");
  assert.ok(keys.every((k) => k.startsWith("ig-")), "…the feed can only ever write ig- keys");

  // one post that refuses to report its insights costs that post its numbers and nothing else
  out = await runIg(ENV, "?mode=mine", (u) => {
    if (/\/m7\/insights/.test(u)) return { error: { message: "Unsupported get request", code: 803 } };
    if (/\/insights/.test(u)) return { data: [{ name: "reach", values: [{ value: 1000 }] }] };
    if (/limit=25/.test(u)) return { data: Array.from({ length: 25 }, (_, i) => igMedia(i + 1, 100, 20)) };
    return { id: "1784", username: "bodysculptwarrington", followers_count: 3200 };
  });
  assert.strictEqual(out.body.posts.length, 25, "all 25 posts still render");
  assert.strictEqual(out.body.posts.find((p) => p.id === "m7").reach, null, "the awkward one shows a dash");
  assert.strictEqual(out.body.posts.find((p) => p.id === "m8").reach, 1000, "…and its neighbours are unaffected");

  // an invalid-metric error retries with fewer metrics rather than giving up
  let asked = [];
  out = await runIg(ENV, "?mode=mine", (u) => {
    const m = /metric=([^&]+)/.exec(u);
    if (m) {
      asked.push(decodeURIComponent(m[1]));
      if (asked[asked.length - 1].includes("views")) return { error: { message: "metric not supported", code: 100 } };
      return { data: [{ name: "reach", values: [{ value: 900 }] }] };
    }
    if (/limit=25/.test(u)) return { data: [igMedia(1, 10, 2)] };
    return { id: "1784", username: "b", followers_count: 100 };
  });
  assert.ok(asked.length >= 2 && asked[0].includes("views") && !asked[1].includes("views"),
    "an unsupported metric drops out and the call is retried, rather than losing the post");
  assert.strictEqual(out.body.posts[0].reach, 900, "…and the numbers that DO exist still arrive");

  // the cache: a second call inside the window does not touch Instagram
  const warm = { "ig-cache-mine": JSON.stringify({ ok: true, configured: true, mode: "mine",
    account: { username: "cached", erBasis: "reach" }, posts: [], fetchedAt: new Date().toISOString() }) };
  out = await runIg(ENV, "?mode=mine", () => ({}), warm);
  assert.strictEqual(out.calls.length, 0, "a warm cache means no call to Instagram at all");
  assert.strictEqual(out.body.cached, true, "…and the page is told it is looking at a cached read");
  out = await runIg(ENV, "?mode=mine&refresh=1", (u) => {
    if (/\/insights/.test(u)) return { data: [] };
    if (/limit=25/.test(u)) return { data: [igMedia(1, 1, 1)] };
    return { id: "1784", username: "fresh", followers_count: 10 };
  }, warm);
  assert.ok(out.calls.length > 0, "refresh=1 goes past the cache");
  assert.strictEqual(out.body.account.username, "fresh", "…and returns the fresh read");
  // a stale cache is ignored
  const stale = { "ig-cache-mine": JSON.stringify({ ok: true, account: { username: "old" }, posts: [],
    fetchedAt: new Date(Date.now() - 60 * 60000).toISOString() }) };
  out = await runIg(ENV, "?mode=mine", (u) => {
    if (/\/insights/.test(u)) return { data: [] };
    if (/limit=25/.test(u)) return { data: [igMedia(1, 1, 1)] };
    return { id: "1784", username: "fresh", followers_count: 10 };
  }, stale);
  assert.strictEqual(out.body.account.username, "fresh", "an hour-old cache is not served");

  /* ============ 7. competitors: the public numbers, and only those ============ */
  out = await runIg(ENV, "?mode=competitor&username=@Rival_Gym/", (u) => {
    assert.ok(/business_discovery\.username\(rival_gym\)/.test(decodeURIComponent(u)),
      "the @ and the slash are stripped before the username reaches Instagram");
    return { business_discovery: {
      username: "rival_gym", name: "Rival", followers_count: 1000, media_count: 300,
      media: { data: [
        igMedia(1, 400, 100),   // the outlier: 50% of followers
        ...Array.from({ length: 9 }, (_, i) => igMedia(i + 2, 50, 10)),
      ] },
    } };
  });
  assert.strictEqual(out.body.ok, true, "a competitor read answers ok");
  assert.strictEqual(out.body.account.erBasis, "followers", "their engagement is measured against followers");
  const rp = out.body.posts;
  assert.strictEqual(rp.length, 10, "their recent posts came back");
  assert.ok(Math.abs(rp[0].er - 0.5) < 1e-9, "(likes + comments) ÷ followers");
  assert.strictEqual(rp[0].outlier, true, "the one that took off is flagged against THEIR median");
  assert.strictEqual(rp.filter((p) => p.outlier).length, 1, "…and only that one");
  // the private metrics are absent rather than guessed at
  for (const p of rp) {
    assert.strictEqual(p.reach, null, "a competitor's reach is null — it is private and cannot be had");
    assert.strictEqual(p.saves, null, "…so are saves");
    assert.strictEqual(p.shares, null, "…and shares");
  }
  assert.deepStrictEqual([...out.store._m.keys()], ["ig-cache-u-rival_gym"], "cached under its own ig- key");

  // a personal or private account gets a sentence that says what to do about it
  out = await runIg(ENV, "?mode=competitor&username=someone", () =>
    ({ error: { message: "Invalid user id for business_discovery", code: 110 } }));
  assert.strictEqual(out.body.ok, false, "a failed lookup is flagged");
  assert.ok(/Business or Creator/.test(out.body.hint), "…and explains that it has to be a Business or Creator account");

  /* ============ 8. every state degrades into words, never a blank ============ */
  assert.ok(/Google Calendar is not connected yet/.test(djs), "the calendar has an unconfigured state");
  assert.ok(/Connect Google Calendar/.test(djs), "…and a connected-but-not-signed-in state");
  assert.ok(/Instagram is not connected yet/.test(sjs), "the social page has an unconfigured state");
  assert.ok(/Nobody is being watched yet/.test(sjs), "…and an empty-competitor-list state");
  for (const doc of ["CALENDAR-SETUP.md", "SOCIAL-SETUP.md"]) {
    const d = read(doc);
    assert.ok(d.length > 500, doc + " is a real document");
  }
  assert.ok(/GOOGLE_CLIENT_ID/.test(read("CALENDAR-SETUP.md")), "the calendar doc names the variable to set");
  for (const v of ["IG_ACCESS_TOKEN", "IG_USER_ID"]) {
    assert.ok(read("SOCIAL-SETUP.md").includes(v), "the social doc names " + v);
  }
  assert.ok(/reach|saves/i.test(read("SOCIAL-SETUP.md")) && /private/i.test(read("SOCIAL-SETUP.md")),
    "…and says plainly that a competitor's reach cannot be had by anyone");

  console.log("v136-calendar-and-social.test: all assertions passed");
})();
