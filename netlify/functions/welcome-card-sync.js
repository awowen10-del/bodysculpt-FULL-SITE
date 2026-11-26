// Netlify Function: welcome-card-sync  (v312)
//
// Every 5 minutes: a card for anyone newly tagged `member start`, then: a welcome card ticked on the dashboard gets completed in GHL, and one
// completed in GHL gets ticked on the dashboard. Also (v313) posts each new monthly catch-up booking in #coaches. See syncCards in netlify/lib/welcome-card.js.
import { syncCards, cardsForNewStarters } from "../lib/welcome-card.js";
import { postNewBookings } from "../lib/catchup-slack.js";
export default async () => {
  try {
    const starters = await cardsForNewStarters().catch((e) => ({ error: e.message }));
    const out = await syncCards();
    const catchups = await postNewBookings().catch((e) => ({ error: e.message }));
    if (catchups.error || (catchups.posted && catchups.posted.length) || (catchups.failed && catchups.failed.length)) console.log("[catchup-slack] " + JSON.stringify(catchups));
    out.catchups = catchups;
    if (out.open || (starters.made && starters.made.length) || starters.error || starters.seeded) console.log("[welcome-card-sync] " + JSON.stringify({ starters, ...out }));
    out.starters = starters;
    return Response.json(out);
  } catch (e) {
    console.log("[welcome-card-sync] failed " + String((e && e.message) || e));
    return Response.json({ ok: false }, { status: 500 });
  }
};
