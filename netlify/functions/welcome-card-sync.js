// Netlify Function: welcome-card-sync  (v312)
//
// Every 5 minutes: a card for anyone newly tagged `member start`, then: a welcome card ticked on the dashboard gets completed in GHL, and one
// completed in GHL gets ticked on the dashboard. Also (v313) posts each new monthly catch-up booking in #coaches. See syncCards in netlify/lib/welcome-card.js.
import { syncCards, cardsForNewStarters } from "../lib/welcome-card.js";
import { postNewBookings } from "../lib/catchup-slack.js";
import { cardsForAnniversaries, syncCards as syncAnniversaries } from "../lib/anniversary-card.js";
export default async () => {
  try {
    const starters = await cardsForNewStarters().catch((e) => ({ error: e.message }));
    const out = await syncCards();
    const catchups = await postNewBookings().catch((e) => ({ error: e.message }));
    // v314: 1-year anniversary cards (a GHL task + the tracker card), and their ticks both ways
    const anniversaries = await cardsForAnniversaries().catch((e) => ({ error: e.message }));
    const anniversaryTicks = await syncAnniversaries().catch((e) => ({ error: e.message }));
    if (anniversaries.error || (anniversaries.made && anniversaries.made.length) || (anniversaries.errors && anniversaries.errors.length) || anniversaryTicks.error || (anniversaryTicks.closed && anniversaryTicks.closed.length)) console.log("[anniversary] " + JSON.stringify({ anniversaries, anniversaryTicks }));
    if (catchups.error || (catchups.posted && catchups.posted.length) || (catchups.failed && catchups.failed.length)) console.log("[catchup-slack] " + JSON.stringify(catchups));
    out.catchups = catchups;
    out.anniversaries = anniversaries; out.anniversaryTicks = anniversaryTicks;
    if (out.open || (starters.made && starters.made.length) || starters.error || starters.seeded) console.log("[welcome-card-sync] " + JSON.stringify({ starters, ...out }));
    out.starters = starters;
    return Response.json(out);
  } catch (e) {
    console.log("[welcome-card-sync] failed " + String((e && e.message) || e));
    return Response.json({ ok: false }, { status: 500 });
  }
};
