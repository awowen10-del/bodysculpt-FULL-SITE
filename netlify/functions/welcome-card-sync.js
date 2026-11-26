// Netlify Function: welcome-card-sync  (v312)
//
// Every 5 minutes: a welcome card ticked on the dashboard gets completed in GHL, and one
// completed in GHL gets ticked on the dashboard. See syncCards in netlify/lib/welcome-card.js.
import { syncCards } from "../lib/welcome-card.js";
export default async () => {
  try {
    const out = await syncCards();
    if (out.open) console.log("[welcome-card-sync] " + JSON.stringify(out));
    return Response.json(out);
  } catch (e) {
    console.log("[welcome-card-sync] failed " + String((e && e.message) || e));
    return Response.json({ ok: false }, { status: 500 });
  }
};
