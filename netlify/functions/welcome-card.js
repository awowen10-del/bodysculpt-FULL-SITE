// Netlify Function: welcome-card  (v312)
//
// GHL's Member journey (tag `member start`) calls this with the contact. It makes the GHL task
// and the dashboard job for the welcome card. See netlify/lib/welcome-card.js.
//   POST ?key=WELCOME_CARD_SECRET  body { contact_id } (GHL custom webhook)  -> makes the card
//   add "dry_run": true (or ?dry=1) to see the card and make nothing
// The password gate lets this one address through (gate.js), so it checks its own key and
// answers 404 to anyone without it.
import { makeCard } from "../lib/welcome-card.js";

const json = (o, s = 200) => Response.json(o, { status: s });
export default async (req) => {
  const url = new URL(req.url);
  const secret = String(process.env.WELCOME_CARD_SECRET || "").trim();
  const key = url.searchParams.get("key") || req.headers.get("x-welcome-card-key") || "";
  if (!secret || key !== secret) return new Response("Not found", { status: 404 });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const contactId = String(body.contact_id || body.contactId || (body.contact && body.contact.id) || "").trim();
  if (!/^[A-Za-z0-9]{10,40}$/.test(contactId)) return json({ error: "Need contact_id", keys: Object.keys(body) }, 400);
  const dryRun = body.dry_run === true || body.dry_run === "true" || url.searchParams.get("dry") === "1";
  try {
    const out = await makeCard(contactId, { dryRun });
    console.log("[welcome-card] " + JSON.stringify({ contactId, ...out, body: undefined }));
    return json(out);
  } catch (e) {
    console.log("[welcome-card] failed " + contactId + " " + e.message);
    return json({ ok: false, error: e.message }, 502);
  }
};
