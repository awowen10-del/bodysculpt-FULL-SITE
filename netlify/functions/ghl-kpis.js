// Netlify Function: ghl-kpis  (v256)
//
// The Weekly KPIs entry form's GoHighLevel read. All the counting lives in
// netlify/lib/ghl-kpis.js; this only answers the page.
//
//   GET ?weekEnding=2026-10-24   6WC leads and 6WC sales for that Sun–Sat week, with names
//
// Read-only towards GHL, and it never writes the KPI store: the page saves the week itself,
// after Ash has looked. Failure is a 200 with a sentence, like takings and stripe-feed.
import { pullWeek } from "../lib/ghl-kpis.js";

export default async (req) => {
  const url = new URL(req.url);
  const json = (body) => Response.json(body, { headers: { "Cache-Control": "no-store" } });
  try {
    return json(await pullWeek(url.searchParams.get("weekEnding"), process.env));
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || "Could not read GHL").slice(0, 300) });
  }
};
