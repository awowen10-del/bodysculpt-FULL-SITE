// Netlify Function: ig-scrape-background  (v172)
//
// Competitors' VIEWS. The official Instagram API hands out likes, comments and follower
// count for another account and nothing more — but the play count on a public reel is
// printed on the reel itself, for anyone. Apify's Instagram Scraper reads the public page
// the way a browser does and returns that count. This function runs it for the accounts
// on the watch list and keeps what comes back, so the Content page can show a
// competitor's views and flag the reels that took off against THEIR normal — the
// content-dashboard template's setup, which Ash asked for by name.
//
//   POST { username }            scrape one watched account (the page's Refresh)
//   POST { all: true }           scrape every watched account (the nightly run)
//
// A BACKGROUND function (202 at once, up to fifteen minutes): one Apify run takes about
// twenty seconds per account, and the template's note is right — one account per run
// returns complete numbers, several at once drops the play counts.
//
// Guards, because a scrape costs money and this site has no login:
//   · only a username on the watch list (kpi-store's ig-competitors) is ever scraped;
//   · one account is not scraped twice inside an hour (the nightly run ignores this);
//   · { all } needs the SYNC_TRIGGER_SECRET header, which only the scheduled trigger holds.
//
// Keys it writes: `ig-scrape-<username>` — { fetchedAt, username, posts[] }. It also
// DELETES `ig-cache-u-<username>`, the feed's half-hour cache of that account, so the next
// read of the Content page merges the fresh views straight away. Nothing else.
import { getStore } from "@netlify/blobs";

const APIFY = "https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items";
const POSTS_PER_ACCOUNT = 15;
const MIN_GAP_MS = 60 * 60 * 1000;
const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const store = () => getStore({ name: "bodysculpt-kpi", consistency: "strong" });
const cleanUser = (u) => clip(String(u || ""), 40).replace(/^.*instagram\.com\//i, "").replace(/^@/, "").replace(/[^A-Za-z0-9._]/g, "").toLowerCase();

// what the page needs of a scraped post; the short code is what matches it to the
// official API's copy of the same post (its permalink ends in it)
function shapePost(p) {
  return {
    shortCode: clip(p.shortCode || p.id || "", 40),
    url: clip(p.url || "", 300),
    type: clip(p.type || "", 24),
    timestamp: clip(p.timestamp || "", 40),
    // v177: the caption and the video file, for the hook miner. Neither is shown on the
    // Competitors tab — the miner needs the caption for context and the file to hear what
    // was actually said. The URL is a signed CDN link that goes stale within the day,
    // which is why mining runs straight after the scrape rather than on demand later.
    caption: clip(p.caption || "", 600),
    videoUrl: clip(p.videoUrl || "", 1000),
    likes: num(p.likesCount) || 0,
    comments: num(p.commentsCount) || 0,
    shares: num(p.sharesCount),
    // videoPlayCount is what Instagram now shows as "views" on a reel (it counts replays);
    // videoViewCount is the older number. An image has neither.
    views: num(p.videoPlayCount) != null ? num(p.videoPlayCount) : num(p.videoViewCount),
  };
}

export async function scrapeOne(token, username, log) {
  const res = await fetch(APIFY + "?token=" + encodeURIComponent(token), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ directUrls: ["https://www.instagram.com/" + username + "/"], resultsType: "posts", resultsLimit: POSTS_PER_ACCOUNT }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body)) {
    const msg = (body && body.error && body.error.message) || ("Apify returned " + res.status);
    log({ stage: "apify_failed", username, status: res.status });
    throw new Error(clip(msg, 200));
  }
  const posts = body.filter((p) => !p.ownerUsername || String(p.ownerUsername).toLowerCase() === username).map(shapePost).filter((p) => p.shortCode);
  const rec = { username, fetchedAt: new Date().toISOString(), posts };
  await store().set("ig-scrape-" + username, JSON.stringify(rec));
  try { await store().delete("ig-cache-u-" + username); } catch { /* no cache to clear is fine */ }
  log({ stage: "scraped", username, posts: posts.length, withViews: posts.filter((p) => p.views != null).length });
  return rec;
}

export default async (req) => {
  const log = (e) => console.log("[ig-scrape] " + JSON.stringify(e));
  if (req.method !== "POST") return;
  const token = (process.env.APIFY_API_TOKEN || "").trim();
  if (!token) { log({ stage: "not_configured" }); return; }
  let body; try { body = await req.json(); } catch { body = {}; }
  const watched = ((await store().get("ig-competitors", { type: "json" })) || []).map((c) => cleanUser(c.username)).filter(Boolean);

  let targets = [], nightly = false;
  if (body && body.all) {
    const expected = (process.env.SYNC_TRIGGER_SECRET || "").trim();
    if (!expected || req.headers.get("x-scrape-trigger") !== expected) { log({ stage: "unauthorized" }); return; }
    targets = watched; nightly = true;
  } else {
    const u = cleanUser(body && body.username);
    if (!u || !watched.includes(u)) { log({ stage: "not_watched", username: u }); return; }
    targets = [u];
  }
  for (const username of targets) {
    try {
      if (!nightly) {
        const prev = await store().get("ig-scrape-" + username, { type: "json" });
        if (prev && prev.fetchedAt && Date.now() - Date.parse(prev.fetchedAt) < MIN_GAP_MS) { log({ stage: "too_soon", username }); continue; }
      }
      await scrapeOne(token, username, log);
    } catch (e) {
      log({ stage: "error", username, message: clip((e && e.message) || "", 200) });
    }
  }
};
