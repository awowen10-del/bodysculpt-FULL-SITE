// Netlify Function: grok-connector  (v272)
//
// Ash talks to Grok in its own app, and Grok reaches the dashboard through this one address,
// added as a custom connector at grok.com/connectors. For now it can only read: this is the
// small test that proves the Grok app can use it by voice before anything that can write
// gets built.
//
// The address holds a long secret, GROK_CONNECTOR_KEY. Without that setting it is switched
// off, and a wrong key gets the same 404 as an address that doesn't exist. Changing the
// setting cuts the connector off at once.
import { timingSafeEqual } from "node:crypto";
import { listProjects } from "../lib/projects.js";
import { handleRpc } from "../lib/grok-connector.js";

function keyOk(given) {
  const want = Buffer.from(process.env.GROK_CONNECTOR_KEY || "");
  const got = Buffer.from(String(given || ""));
  return want.length >= 32 && want.length === got.length && timingSafeEqual(want, got);
}
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

export default async (req, context) => {
  if (!keyOk(context && context.params && context.params.key)) return new Response("Not found", { status: 404 });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  let body;
  try { body = await req.json(); } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const list = Array.isArray(body) ? body : [body];
  const wantsProjects = list.some((m) => m && m.method === "tools/call");
  const projects = wantsProjects ? await listProjects().catch(() => null) : [];
  const replies = list.map((m) => handleRpc(m, projects, today())).filter(Boolean);
  if (!replies.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? replies : replies[0]);
};

export const config = { path: "/mcp/:key" };
