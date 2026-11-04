// netlify/lib/grok-connector.js  (v272)
//
// What the Grok app may see. Pure, so it can be tested without a store: it speaks the small
// part of MCP a connector needs and turns projects into something that reads well aloud.
// Step notes, files and checklists stay out of it, because only the names and days are needed.
export const TOOLS = [{
  name: "get_my_projects",
  description: "Lists Ash's live Bodysculpt projects with how far through each one is, what is late and the next step. Read-only.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, title: "Get my projects" },
}];

const dayOf = (s) => {
  if (s.due) return s.due;
  if (!s.week || !s.day) return "";
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const d = new Date(s.week + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Math.max(0, days.indexOf(s.day)));
  return d.toISOString().slice(0, 10);
};

export function projectsText(projects, today) {
  const words = { planned: "Not started", active: "Running", paused: "Parked", done: "Finished" };
  const live = (projects || []).filter((p) => p && !p.archived && p.status !== "done");
  if (!live.length) return "There are no live projects.";
  return live.map((p) => {
    const steps = (p.steps || []).filter((s) => s && !s.del);
    const open = steps.filter((s) => !s.done);
    const dated = open.map((s) => ({ s, on: dayOf(s) })).filter((x) => x.on).sort((a, b) => (a.on > b.on ? 1 : -1));
    const late = dated.filter((x) => x.on < today).length;
    const next = dated[0] || (open[0] ? { s: open[0], on: "" } : null);
    return [
      p.name + " (" + (words[p.status] || p.status) + ")",
      (steps.length - open.length) + " of " + steps.length + " steps done",
      late ? late + " late" : "",
      next ? "next: " + next.s.title + (next.on ? " on " + next.on : ", no day yet") : "",
    ].filter(Boolean).join(". ");
  }).join("\n");
}

// One JSON-RPC message in, one reply out, or null for a notification.
export function handleRpc(msg, projects, today) {
  const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "Invalid request");
  if (msg.id === undefined) return null;
  switch (msg.method) {
    case "initialize":
      return reply({ protocolVersion: (msg.params && msg.params.protocolVersion) || "2025-06-18",
        capabilities: { tools: {} }, serverInfo: { name: "bodysculpt-dashboard", version: "1.0.0" },
        instructions: "Ash's Bodysculpt dashboard. Use get_my_projects when he asks about his projects." });
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS });
    case "tools/call":
      if (!msg.params || msg.params.name !== "get_my_projects") return fail(-32602, "Unknown tool");
      if (projects === null) return reply({ isError: true, content: [{ type: "text", text: "The projects couldn't be read just now." }] });
      return reply({ content: [{ type: "text", text: projectsText(projects, today) }] });
    default: return fail(-32601, "Method not found");
  }
}
