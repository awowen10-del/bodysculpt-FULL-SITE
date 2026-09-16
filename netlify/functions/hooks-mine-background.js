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
import { mine, readLib } from "../lib/hooks.js";
import { generate as generateIdeas, gather } from "../lib/ideas.js";

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
    // v192: and then what to film. Ideas are drawn partly from the hooks just mined, so this
    // is the moment they are most worth regenerating — and it means the page has five of them
    // waiting by breakfast rather than making Ash wait while they are written.
    try {
      const ideas = await generateIdeas(await gather(await readLib()));
      log({ stage: "ideas", n: ideas.ideas.length });
    } catch (e2) {
      log({ stage: "ideas_failed", message: String((e2 && e2.message) || e2).slice(0, 200) });
    }
  } catch (e) {
    log({ stage: "error", message: String((e && e.message) || e).slice(0, 200) });
  }
};
