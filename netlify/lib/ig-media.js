// netlify/lib/ig-media.js  (v180)
//
// Getting the actual VIDEO FILE for one of Ash's own posts, and saying clearly why not when
// that fails.
//
// v178 read the video link out of `ig-cache-mine` — the Content page's cached copy of the
// feed. That was wrong, and it made "Learn how I talk" fail on every reel with a message
// blaming stale links without having checked. It WAS stale links, but the fix is not to ask
// Ash to press Refresh first: Instagram's `media_url` is a SIGNED url that expires within
// hours, the cached blob can be days old, and nothing about pressing a button on a web page
// should be load-bearing for a nightly job.
//
// The server holds IG_ACCESS_TOKEN. So it asks Instagram for a current link at the moment it
// needs one, and keeps the cached link only as a fallback for a post the fresh list does not
// mention. A cache is for saving a round trip, never for holding a credential that rots.
const GRAPH = "https://graph.facebook.com/v21.0";
const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");

// Instagram's CDN is picky about who it hands a video to. A bare server fetch sends
// `User-Agent: node`, which it may refuse outright — the browser gets these files because it
// looks like a browser. This is the same request the page's own <video> makes.
const CDN_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  "Accept": "video/mp4,video/*;q=0.9,*/*;q=0.8",
  "Referer": "https://www.instagram.com/",
};

export const igConfigured = () =>
  !!(process.env.IG_ACCESS_TOKEN || "").trim() && !!(process.env.IG_USER_ID || "").trim();

// id -> media_url, straight from Instagram, valid right now. Returns an empty Map rather
// than throwing: a failed lookup should fall back to the cached links and report what each
// one then did, not lose the whole run.
export async function freshOwnVideoUrls(limit) {
  const token = (process.env.IG_ACCESS_TOKEN || "").trim();
  const igUserId = (process.env.IG_USER_ID || "").replace(/[^0-9]/g, "");
  const out = new Map();
  if (!token || !igUserId) return out;
  try {
    const qs = new URLSearchParams({
      fields: "id,media_type,media_url,thumbnail_url",
      limit: String(limit || 25),
      access_token: token,
    });
    const res = await fetch(GRAPH + "/" + igUserId + "/media?" + qs.toString());
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(body.data)) return out;
    for (const m of body.data) {
      // thumbnail_url is only present on video media, which is what makes it the tell that
      // media_url is a video file rather than a photo
      if (m && m.id && m.thumbnail_url && typeof m.media_url === "string") out.set(String(m.id), m.media_url);
    }
  } catch { /* an empty map, and the caller falls back */ }
  return out;
}

// One video, as bytes. Every failure carries the reason, because the whole point of v180 is
// that "it didn't work" is not a diagnosis.
export async function fetchVideo(url, maxBytes) {
  if (!url) throw new Error("no video link for this post");
  let res;
  try { res = await fetch(url, { headers: CDN_HEADERS, redirect: "follow" }); }
  catch (e) { throw new Error("could not reach Instagram's CDN (" + clip((e && e.message) || "network error", 80) + ")"); }
  if (!res.ok) {
    // 403 is what an expired signature looks like from the outside, and it is the one worth
    // naming: it means the link was fine when it was stored and is not any more.
    const why = res.status === 403 ? "the link had expired (403)"
      : res.status === 404 ? "the post is gone (404)"
      : "Instagram returned " + res.status;
    throw new Error(why);
  }
  const cap = maxBytes || 60 * 1024 * 1024;
  const len = Number(res.headers.get("content-length") || 0);
  if (len > cap) throw new Error("the video is " + Math.round(len / 1048576) + "MB, over the " + Math.round(cap / 1048576) + "MB limit");
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.byteLength) throw new Error("the download was empty");
  if (buffer.byteLength > cap) throw new Error("the video is over the " + Math.round(cap / 1048576) + "MB limit");
  return { buffer, mime: clip(res.headers.get("content-type") || "video/mp4", 60).split(";")[0] };
}

// The distinct reasons, counted — so a page can say "3 links had expired, 2 were too large"
// instead of listing the same sentence five times.
export function summariseFailures(reasons) {
  const counts = new Map();
  for (const r of reasons) counts.set(r, (counts.get(r) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => (n > 1 ? n + " × " : "") + reason)
    .join("; ");
}
