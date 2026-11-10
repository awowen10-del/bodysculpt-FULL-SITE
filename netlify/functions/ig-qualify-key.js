// Netlify Function: ig-qualify-key  (v294)
//
// The key ManyChat sends to ig-qualify. Behind the password gate like every other address, so
// only Ash's signed-in browser can read it — it's pasted once into ManyChat's request header.
import { qualifyKey, qualifySecret } from "./ig-qualify.js";
export default async () => Response.json({
  key: qualifyKey(qualifySecret()) || null,
  // which settings this function can see (names only, never values)
  has: { sync: !!(process.env.SYNC_TRIGGER_SECRET || "").trim(), dash: !!process.env.DASHBOARD_PASSWORD, apify: !!process.env.APIFY_API_TOKEN, claude: !!process.env.ANTHROPIC_API_KEY },
}, { headers: { "Cache-Control": "no-store" } });
