// Netlify Function: grok-connector  (v272, edits from v273, the Weekly page from v288)
//
// Ash talks to Grok in its own app, and Grok reaches the dashboard through this one address,
// added as a custom connector at grok.com/connectors. See netlify/lib/grok-connector.js for
// what it can do. Everything goes through the site's own routes with the internal key, so
// this file holds no business rules and touches one store of its own, for the undo list.
//
// The address holds a long secret, GROK_CONNECTOR_KEY. Without that setting it is switched
// off, and a wrong key gets the same 404 as an address that doesn't exist. Changing the
// setting cuts the connector off at once.
import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { internalHeaders } from "../lib/internal.js";
import { handleRpc } from "../lib/grok-connector.js";

const UNDO_KEY = "grok-undo";
function keyOk(given) {
  const want = Buffer.from(process.env.GROK_CONNECTOR_KEY || "");
  const got = Buffer.from(String(given || ""));
  return want.length >= 32 && want.length === got.length && timingSafeEqual(want, got);
}
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

function makeApi(base) {
  const fn = (p) => base + "/.netlify/functions/" + p;
  const get = async (p) => {
    const r = await fetch(fn(p), { headers: internalHeaders() });
    if (!r.ok) throw new Error("read failed");
    return r.json();
  };
  const post = async (p, body) => {
    const r = await fetch(fn(p), { method: "POST", headers: { ...internalHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.ok === false) throw new Error("write failed");
    return j;
  };
  const undo = () => getStore({ name: "bodysculpt-ask", consistency: "strong" });
  return {
    projects: async () => (await get("projects?list=1")).projects || [],
    plan: async (ym) => (await get("kpi-store?monthlyplan=" + encodeURIComponent(ym))).plan || { ym, focus: [] },
    savePlan: (ym, focus) => post("kpi-store", { monthlyPlan: { ym, focus } }),
    saveReview: (ym, review) => post("kpi-store", { monthlyPlan: { ym, review } }),
    savePart: (ym, part) => post("kpi-store", { monthlyPlan: { ym, ...part } }),
    monthNumbers: async (ym) => ((await get("kpi-store?monthly=1")).months || []).find((m) => m && m.ym === ym) || null,
    stepLink: (link) => post("projects", { stepLink: link }),
    addStep: async (add) => {
      const r = await post("projects", { addStep: add });
      if (!r.step) throw new Error("step not added");
      return r.step;
    },
    createProject: async (name) => {
      const n = new Date().toISOString();
      const p = { id: "p_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4), name, summary: "", status: "active", accent: "orange",
        startDate: "", targetDate: "", steps: [], canvas: [], archived: false, createdAt: n, lastUpdated: n,
        columns: [{ id: "todo", name: "To do", done: false }, { id: "doing", name: "Doing", done: false },
          { id: "waiting", name: "Waiting on", done: false }, { id: "done", name: "Done", done: true }] };
      return (await post("projects", { project: p })).project || p;
    },
    calendar: (weeklyCancel) => post("kpi-store", { weeklyCancel }).catch(() => {}),
    askStart: async (text, month) => (await post("ask-claude", { ask: { text, month } })).job,
    askJob: (job) => get("ask-claude?job=" + encodeURIComponent(job)),
    // v288: the Weekly page. saveWeek sends only the fields given; the store keeps the rest.
    week: async (wk) => (await get("kpi-store?weeklyplan=" + encodeURIComponent(wk))).plan || {},
    saveWeek: (wk, part) => post("kpi-store", { weeklyPlan: { ...part, weekEnding: wk } }),
    agenda: async (wk) => (await get("kpi-store?weeklyagenda=" + encodeURIComponent(wk))).agenda || null,
    saveAgenda: (agenda) => post("kpi-store", { weeklyAgenda: { weekEnding: agenda.weekEnding, cells: agenda.cells } }),
    checkins: async () => (await get("kpi-store?checkins=1")).checkins || {},
    waiting: async () => (await get("kpi-store?waiting=1")).items || [],
    undoLoad: () => undo().get(UNDO_KEY, { type: "json" }),
    undoSave: (stack) => undo().setJSON(UNDO_KEY, stack),
  };
}

export default async (req, context) => {
  if (!keyOk(context && context.params && context.params.key)) return new Response("Not found", { status: 404 });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  let body;
  try { body = await req.json(); } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const list = Array.isArray(body) ? body : [body];
  const api = makeApi(process.env.URL || new URL(req.url).origin);
  const out = [];
  for (const m of list) out.push(await handleRpc(m, api, today()));
  const replies = out.filter(Boolean);
  if (!replies.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? replies : replies[0]);
};

export const config = { path: "/mcp/:key" };
