// Netlify Function: welcome-card-sync  (v312)
//
// Every 5 minutes: a card for anyone newly tagged `member start`, then: a welcome card ticked on the dashboard gets completed in GHL, and one
// completed in GHL gets ticked on the dashboard. See syncCards in netlify/lib/welcome-card.js.
import { syncCards, cardsForNewStarters } from "../lib/welcome-card.js";
export default async () => {
  try {
    const starters = await cardsForNewStarters().catch((e) => ({ error: e.message }));
    const out = await syncCards();
    if (out.open || (starters.made && starters.made.length) || starters.error || starters.seeded) console.log("[welcome-card-sync] " + JSON.stringify({ starters, ...out }));
    out.starters = starters;
    return Response.json(out);
  } catch (e) {
    console.log("[welcome-card-sync] failed " + String((e && e.message) || e));
    return Response.json({ ok: false }, { status: 500 });
  }
};
