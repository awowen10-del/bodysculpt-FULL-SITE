// Netlify Function: hooks-mine-background  (v177)
//
// Read the reels that took off and turn their openings into templates. A BACKGROUND
// function (202 at once, up to fifteen minutes): each reel is a download, a Gemini upload,
// a wait while Google processes it and a call to Claude — thirty to ninety seconds, and a
// good night has half a dozen of them.
//
//   POST {}                      mine the waiting reels (the page's "Find hooks")
//   POST { all: true }           the same, from the nightly trigger, which holds the secret
//
// It writes each hook as it lands rather than all of them at the end, so a run that dies
// two reels from home still leaves the first four in the library.
import { mine } from "../lib/hooks.js";

export default async (req) => {
  const log = (e) => console.log("[hooks-mine] " + JSON.stringify(e));
  if (req.method !== "POST") return;
  let body; try { body = await req.json(); } catch { body = {}; }

  // The nightly run must prove itself the same way the ads sync and the competitor scrape
  // do; the page's own button needs no secret, because pressing it costs only the reels
  // that are already waiting and it cannot be made to mine anything else.
  if (body && body.all) {
    const expected = (process.env.SYNC_TRIGGER_SECRET || "").trim();
    if (!expected || req.headers.get("x-mine-trigger") !== expected) { log({ stage: "unauthorized" }); return; }
  }

  try {
    const r = await mine(0, log);
    log({ stage: "done", ...r });
  } catch (e) {
    log({ stage: "error", message: String((e && e.message) || e).slice(0, 200) });
  }
};
