// Netlify Function: food  (v236)
//
// The Food hub's quick door:
//   POST { action: "readPhoto", jpegBase64 }  → { ok, items:[{name, qty, unit}], note } | { ok:false, error }
//        Claude Haiku 5.5 reads the butcher's sign. The page has already turned the photo
//        into a JPEG of at most 1600px, so this fits well inside an ordinary function's time.
//   GET  ?job=<week>                          → { job } — how the background menu is getting on,
//                                                with each meal as it is written (job.partial)
//   GET  ?defaults=1                          → { rules, spices, staples, nightTypes } — what the
//                                                settings drawer pre-fills, from the same text
//                                                the server plans with
//
// createMenu, swapMeal and changeMenu run in food-background.js (they take minutes, not seconds). The model
// strings live in FOOD_MODELS in netlify/lib/food.js. ANTHROPIC_API_KEY is read here, on the
// server, and is never sent to the browser.
import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import { readPhoto, errorWords, foodJobKeyOf, validWeek, DEFAULT_RULES, DEFAULT_SPICES, DEFAULT_STAPLES, NIGHT_TYPES } from "../lib/food.js";

const json = (o, status) => Response.json(o, { status: status || 200 });

export default async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("defaults") === "1") {
    return json({ rules: DEFAULT_RULES, spices: DEFAULT_SPICES, staples: DEFAULT_STAPLES, nightTypes: NIGHT_TYPES });
  }
  if (req.method === "GET") {
    const week = url.searchParams.get("job") || "";
    if (!validWeek(week)) return json({ error: "Ask for ?job=YYYY-MM-DD" }, 400);
    const store = getStore({ name: "bodysculpt-kpi", consistency: "strong" });
    return json({ job: (await store.get(foodJobKeyOf(week), { type: "json" })) || null });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body;
  try { body = await req.json(); } catch (e) { return json({ ok: false, error: "Bad request." }, 400); }
  if (body && body.action === "readPhoto") {
    if (!process.env.ANTHROPIC_API_KEY) return json({ ok: false, error: "ANTHROPIC_API_KEY is not set in Netlify." }, 500);
    // inside the 26-second limit: one attempt, no retry
    const client = new Anthropic({ timeout: 22000, maxRetries: 0 });
    try {
      const r = await readPhoto(client, { jpegBase64: String(body.jpegBase64 || "") });
      return json(r, r.ok ? 200 : 422);
    } catch (e) {
      return json({ ok: false, error: errorWords(e) }, 502);
    }
  }
  return json({ ok: false, error: "Send { action: \"readPhoto\" } here; planning runs in food-background." }, 400);
};
