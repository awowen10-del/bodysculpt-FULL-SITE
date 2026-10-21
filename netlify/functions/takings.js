// Netlify Function: takings  (v225)
//
// The Monthly KPIs page's "Pull from Stripe, GoCardless & SumUp" button. All the counting
// lives in netlify/lib/takings.js; this only answers the page.
//
//   GET ?month=2026-09   read the three providers now, keep a copy, return it
//   GET ?stored=2026-09  the copy kept from the last pull of that month (or null)
//   GET ?ready=1         last month's copy, if the 4th-of-the-month run has made one —
//                        the page offers it for review when that month's boxes are empty
//
// Read-only towards the providers, and it never writes the KPI store: the page saves the
// month itself, after Ash has looked. Failure is a 200 with a sentence, like stripe-feed.
import { pullMonth, savePull, readPull, lastMonthOf } from "../lib/takings.js";

export default async (req) => {
  const url = new URL(req.url);
  const json = (body) => Response.json(body, { headers: { "Cache-Control": "no-store" } });
  try {
    if (url.searchParams.get("ready")) {
      const ym = lastMonthOf(new Date());
      return json({ ok: true, month: ym, pull: await readPull(ym) });
    }
    const stored = url.searchParams.get("stored");
    if (stored) return json({ ok: true, month: stored, pull: await readPull(stored) });
    const ym = url.searchParams.get("month");
    const pull = await pullMonth(ym, process.env);
    if (pull.ok) { try { await savePull(pull); } catch (e) { /* the numbers still go back to the page */ } }
    return json(pull);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || "Could not pull the takings").slice(0, 300) });
  }
};
