// Netlify Function: ig-qualify-key  (v294)
//
// The key ManyChat sends to ig-qualify. Behind the password gate like every other address, so
// only Ash's signed-in browser can read it — it's pasted once into ManyChat's request header.
import { qualifyKey } from "./ig-qualify.js";
export default async () => Response.json({ key: qualifyKey(process.env.DASHBOARD_PASSWORD || "") || null }, { headers: { "Cache-Control": "no-store" } });
