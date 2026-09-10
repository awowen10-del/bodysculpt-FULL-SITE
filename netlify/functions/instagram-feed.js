// Netlify Function: instagram-feed  (v136)
//
// Read-only against Instagram. Two questions, one function:
//   ?mode=mine                    -> my last 25 posts WITH their private insights
//                                    (reach, views, saves, shares, interactions)
//   ?mode=competitor&username=X   -> a public account's recent posts via business_discovery
//
// WHAT CANNOT BE DONE, so nobody wastes an afternoon trying: reach, views, saves and
// shares are private insights. Instagram returns them for accounts you own and for nobody
// else. There is no paid tier, no partner endpoint and no scraping trick that changes
// that. For other accounts the API gives likes, comments, follower count and the media —
// which is why the two sides of the toggle compute engagement differently and the page
// says so out loud.
//
// The access token is a secret and lives in the Netlify environment. It never reaches the
// browser — that is the whole reason this function exists.
//   IG_ACCESS_TOKEN  a long-lived or (better) System User token
//   IG_USER_ID       the Instagram Business account id
//
// CACHING. The Graph API allows roughly 200 calls an hour. One full page load is ~26 calls
// for my own posts plus one per tracked competitor, so an afternoon of idle refreshing
// would burn the budget. Results are cached in the shared blob store for 30 minutes under
// keys beginning `ig-` and nothing else is ever written. `&refresh=1` forces a re-read.
//
// Failure is always a 200 with a message in the body, never a 500: a card that explains
// itself is useful; a broken red box is not.

import { getStore } from "@netlify/blobs";

const GRAPH = "https://graph.facebook.com/v21.0";
const POST_LIMIT = 25;          // "my last 25 posts", and the same for a competitor
const CACHE_MINUTES = 30;
const CACHE_PREFIX = "ig-cache-";   // the ONLY key prefix this function may write

// The insights worth having, most useful first. Instagram rejects the whole call if one
// metric is invalid for that media type, so this degrades in steps rather than giving up.
const METRIC_SETS = [
  "reach,saved,shares,views,total_interactions",
  "reach,saved,shares,total_interactions",
  "reach,saved,shares",
  "reach",
];

const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

/* ---------- talking to the Graph API ---------- */
async function graph(token, path, params) {
  const qs = new URLSearchParams({ ...(params || {}), access_token: token });
  const res = await fetch(GRAPH + path + "?" + qs.toString());
  const body = await res.json().catch(() => null);
  if (!res.ok || (body && body.error)) {
    const err = new Error((body && body.error && body.error.message) || ("Instagram returned " + res.status));
    err.igCode = body && body.error && body.error.code;
    throw err;
  }
  return body || {};
}

/* ---------- shaping ---------- */
// A caption is a headline here, not an essay: enough to recognise the post by.
function headline(caption) {
  const s = clip(caption, 400).replace(/\s+/g, " ").trim();
  return s.length > 120 ? s.slice(0, 117) + "…" : s;
}

function shapeMedia(m) {
  return {
    id: clip(m.id, 40),
    caption: headline(m.caption),
    type: clip(m.media_type, 24),
    // A video's media_url is the video file, which is useless as a card image — the
    // thumbnail is the frame Instagram itself shows in the grid.
    image: clip(m.thumbnail_url || m.media_url, 1000),
    permalink: clip(m.permalink, 300),
    timestamp: clip(m.timestamp, 40),
    likes: num(m.like_count) || 0,
    comments: num(m.comments_count) || 0,
    // filled in for my own posts only; null everywhere else, and the page shows a dash
    reach: null, views: null, saves: null, shares: null, interactions: null,
  };
}

// One media's insights, degrading through METRIC_SETS. Returns {} rather than throwing:
// a post that will not report is a post with fewer numbers, not a broken page.
async function insightsFor(token, mediaId) {
  for (const metric of METRIC_SETS) {
    try {
      const r = await graph(token, "/" + mediaId + "/insights", { metric });
      const out = {};
      for (const row of r.data || []) {
        const v = row.values && row.values[0] ? row.values[0].value : null;
        if (typeof v === "number") out[row.name] = v;
      }
      return out;
    } catch (e) {
      // an invalid-metric error is worth retrying with fewer; anything else is not
      if (e.igCode && e.igCode !== 100) return {};
    }
  }
  return {};
}

/* ---------- the two numbers, and why they differ ----------
   MINE: interactions ÷ reach — of the people who saw it, how many did something. The
   honest measure, and only possible on an account you own.
   THEIRS: (likes + comments) ÷ followers — the public proxy, because reach is private.
   They are not comparable to each other, which is why the page labels them separately;
   they ARE comparable to the same account's own median, which is what an outlier means. */
function withEngagement(post, followers) {
  const p = { ...post };
  p.interactions = p.interactions != null ? p.interactions : p.likes + p.comments;
  if (p.reach) {
    p.er = p.interactions / p.reach;
    p.erBasis = "reach";
  } else if (followers) {
    p.er = (p.likes + p.comments) / followers;
    p.erBasis = "followers";
  } else {
    p.er = null;
    p.erBasis = "";
  }
  return p;
}

// An outlier is measured against its OWN account's median, never across accounts. Median
// rather than mean, because one viral post would drag a mean up and then hide behind it.
function markOutliers(posts) {
  const rates = posts.map((p) => p.er).filter((v) => typeof v === "number" && isFinite(v)).sort((a, b) => a - b);
  if (rates.length < 4) return { posts: posts.map((p) => ({ ...p, outlier: false, vsMedian: null })), median: null };
  const mid = Math.floor(rates.length / 2);
  const median = rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
  return {
    median,
    posts: posts.map((p) => {
      const vs = (median && typeof p.er === "number") ? p.er / median : null;
      return { ...p, vsMedian: vs, outlier: vs != null && vs >= 2 };
    }),
  };
}

/* ---------- the cache ---------- */
function cacheStore() {
  return getStore({ name: "bodysculpt-kpi", consistency: "strong" });
}
async function cacheGet(key, force) {
  if (force) return null;
  try {
    const rec = await cacheStore().get(CACHE_PREFIX + key, { type: "json" });
    if (!rec || !rec.fetchedAt) return null;
    if (Date.now() - Date.parse(rec.fetchedAt) > CACHE_MINUTES * 60000) return null;
    return { ...rec, cached: true };
  } catch { return null; }
}
async function cacheSet(key, payload) {
  // Belt and braces: this function may only ever write its own prefix, so the key is
  // rebuilt here rather than taken on trust from the caller.
  const safe = CACHE_PREFIX + String(key).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 60);
  try { await cacheStore().set(safe, JSON.stringify(payload)); } catch { /* a cold cache is not an error */ }
  return payload;
}

/* ---------- my own account ---------- */
async function loadMine(token, igUserId) {
  const me = await graph(token, "/" + igUserId, {
    fields: "id,username,name,profile_picture_url,followers_count,media_count",
  });
  const media = await graph(token, "/" + igUserId + "/media", {
    fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
    limit: POST_LIMIT,
  });
  const base = (media.data || []).slice(0, POST_LIMIT).map(shapeMedia);

  // All 25 insight calls in flight at once, and SETTLED: one post that will not report its
  // numbers costs that post its numbers and nothing else.
  const results = await Promise.allSettled(base.map((p) => insightsFor(token, p.id)));
  const posts = base.map((p, i) => {
    const ins = results[i].status === "fulfilled" ? results[i].value : {};
    return withEngagement({
      ...p,
      reach: num(ins.reach),
      views: num(ins.views),
      saves: num(ins.saved),
      shares: num(ins.shares),
      interactions: num(ins.total_interactions),
    }, me.followers_count);
  });

  const marked = markOutliers(posts);
  return {
    ok: true, configured: true, mode: "mine",
    account: {
      username: clip(me.username, 60),
      name: clip(me.name, 120),
      avatar: clip(me.profile_picture_url, 1000),
      followers: num(me.followers_count) || 0,
      mediaCount: num(me.media_count) || 0,
      erBasis: "reach",
    },
    posts: marked.posts,
    median: marked.median,
    fetchedAt: new Date().toISOString(),
  };
}

/* ---------- somebody else's account ---------- */
async function loadCompetitor(token, igUserId, username) {
  const fields =
    "business_discovery.username(" + username + "){username,name,profile_picture_url," +
    "followers_count,media_count,media.limit(" + POST_LIMIT + "){id,caption,media_type," +
    "media_url,thumbnail_url,permalink,timestamp,like_count,comments_count}}";
  const r = await graph(token, "/" + igUserId, { fields });
  const bd = r.business_discovery;
  if (!bd) throw new Error("Instagram returned nothing for @" + username + ".");

  const posts = ((bd.media && bd.media.data) || [])
    .slice(0, POST_LIMIT)
    .map(shapeMedia)
    .map((p) => withEngagement(p, bd.followers_count));
  const marked = markOutliers(posts);

  return {
    ok: true, configured: true, mode: "competitor",
    account: {
      username: clip(bd.username, 60),
      name: clip(bd.name, 120),
      avatar: clip(bd.profile_picture_url, 1000),
      followers: num(bd.followers_count) || 0,
      mediaCount: num(bd.media_count) || 0,
      erBasis: "followers",
    },
    posts: marked.posts,
    median: marked.median,
    fetchedAt: new Date().toISOString(),
  };
}

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "competitor" ? "competitor" : "mine";
  const force = url.searchParams.get("refresh") === "1";
  // Instagram usernames are letters, digits, dots and underscores. Anything else is either
  // a mistake or an attempt at something, and either way it is not a username.
  const username = clip(url.searchParams.get("username") || "", 40)
    .replace(/^.*instagram\.com\//i, "").replace(/[^A-Za-z0-9._]/g, "").toLowerCase();

  const token = process.env.IG_ACCESS_TOKEN || "";
  const igUserId = (process.env.IG_USER_ID || "").replace(/[^0-9]/g, "");

  if (!token || !igUserId) {
    return Response.json({
      ok: true, configured: false, mode,
      message: "Instagram is not connected yet. Add IG_ACCESS_TOKEN and IG_USER_ID in Netlify → Site configuration → Environment variables, then redeploy.",
      posts: [], account: null, fetchedAt: new Date().toISOString(),
    });
  }
  if (mode === "competitor" && !username) {
    return Response.json({ ok: false, configured: true, mode, error: "No username given.", posts: [], account: null });
  }

  const key = mode === "mine" ? "mine" : "u-" + username;
  const hit = await cacheGet(key, force);
  if (hit) return Response.json(hit);

  try {
    const payload = mode === "mine"
      ? await loadMine(token, igUserId)
      : await loadCompetitor(token, igUserId, username);
    await cacheSet(key, payload);
    return Response.json({ ...payload, cached: false });
  } catch (e) {
    const msg = clip(e && e.message ? e.message : "Could not reach Instagram", 400);
    // The two failures worth naming, because the fix for each is completely different.
    const hint = /business_discovery|does not exist|Invalid user/i.test(msg)
      ? "That account has to be a Business or Creator account, and public, for Instagram to share its posts. Personal and private accounts return nothing to anyone."
      : /token|OAuth|session/i.test(msg)
      ? "The access token has expired or been revoked. SOCIAL-SETUP.md has the steps to make a new one."
      : "";
    return Response.json({
      ok: false, configured: true, mode, username,
      error: msg, hint, posts: [], account: null,
      fetchedAt: new Date().toISOString(),
    });
  }
};
