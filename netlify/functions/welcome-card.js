// Netlify Function: welcome-card  (v312)
//
// Makes one welcome card by hand (the 5-minute welcome-card-sync makes them for new members).
// The GHL task, and the card on the onboarding tracker's Welcome card job. See netlify/lib/welcome-card.js.
//   POST ?key=WELCOME_CARD_SECRET  body { contact_id } (GHL custom webhook)  -> makes the card
//   add "dry_run": true (or ?dry=1) to see the card and make nothing
//   GET ?key=…&status=1 -> every card and whether it's ticked
// The password gate lets this one address through (gate.js), so it checks its own key and
// answers 404 to anyone without it.
import { makeCard, readCards } from "../lib/welcome-card.js";

const json = (o, s = 200) => Response.json(o, { status: s });
export default async (req) => {
  const url = new URL(req.url);
  const secret = String(process.env.WELCOME_CARD_SECRET || "").trim();
  const key = url.searchParams.get("key") || req.headers.get("x-welcome-card-key") || "";
  if (!secret || key !== secret) return new Response("Not found", { status: 404 });
  // GET ?status=1: every card, and where it stands (for checking, not for GHL)
  if (req.method === "GET" && url.searchParams.get("status") === "1") {
    const v = await readCards();
    return json({ ok: true, cards: Object.values(v.cards).map((c) => ({ name: c.name, contactId: c.contactId, sent: c.sent,
      ghlDone: c.ghlDone, closed: c.closed, createdAt: c.createdAt })) });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const contactId = String(body.contact_id || body.contactId || (body.contact && body.contact.id) || "").trim();
  if (!/^[A-Za-z0-9]{10,40}$/.test(contactId)) return json({ error: "Need contact_id", keys: Object.keys(body) }, 400);
  const dryRun = body.dry_run === true || body.dry_run === "true" || url.searchParams.get("dry") === "1";
  try {
    const out = await makeCard(contactId, { dryRun, force: body.force === true });
    console.log("[welcome-card] " + JSON.stringify({ contactId, ...out, body: undefined }));
    return json(out);
  } catch (e) {
    console.log("[welcome-card] failed " + contactId + " " + e.message);
    return json({ ok: false, error: e.message }, 502);
  }
};
