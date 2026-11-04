// Netlify Function: ask-claude  (v270)
//
// The dashboard's door to Ash's cloud Claude agent, which holds his skills.
//
//   GET  ?status=1          { configured } — the page shows nothing until the keys are set
//   GET  ?job=<id>          { status, proposal?, error? } — the token is never returned
//   POST { ask:{ text, month } }   start a job
//
// v271: this address sits behind the password. The run itself uses ask-claude-agent.
//
// IT HAS ITS OWN STORE, "bodysculpt-ask", so nothing here can reach the KPI data. It stores
// jobs and nothing else. Each job gets a one-use token that travels in the fired text, so
// only the run that was started can answer it, and only once.
//
// Fire token: CLAUDE_ROUTINE_TOKEN. Routine id: CLAUDE_ROUTINE_ID. Neither reaches the browser.
import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";
import { JOB_PREFIX, MAX_TEXT, MAX_PER_HOUR, JOB_MINUTES, fireText } from "../lib/ask-claude.js";

const json = (o, status = 200) => Response.json(o, { status });
const store = () => getStore({ name: "bodysculpt-ask", consistency: "strong" });
const env = (k) => (globalThis.Netlify && Netlify.env ? Netlify.env.get(k) : process.env[k]) || "";
const configured = () => !!(env("CLAUDE_ROUTINE_TOKEN") && /^trig_[A-Za-z0-9]+$/.test(env("CLAUDE_ROUTINE_ID")));
const validJob = (id) => typeof id === "string" && /^[a-f0-9]{24}$/.test(id);

function publicJob(job) {
  const expired = job.status === "running" && Date.now() - Date.parse(job.startedAt) > JOB_MINUTES * 60000;
  return { ok: true, status: expired ? "failed" : job.status, proposal: job.proposal || null,
    error: expired ? "Claude didn't answer in time." : (job.error || "") };
}

export default async (req) => {
  const url = new URL(req.url);
  const s = store();

  if (req.method === "GET") {
    if (url.searchParams.get("status")) return json({ ok: true, configured: configured() });
    const id = url.searchParams.get("job");
    if (!validJob(id)) return json({ error: "Bad job" }, 400);
    const job = await s.get(JOB_PREFIX + id, { type: "json" });
    return job ? json(publicJob(job)) : json({ error: "No such job" }, 404);
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }

  if (body && body.ask) {
    if (!configured()) return json({ error: "Claude isn't connected yet." }, 503);
    const text = typeof body.ask.text === "string" ? body.ask.text.trim().slice(0, MAX_TEXT) : "";
    const month = typeof body.ask.month === "string" && /^\d{4}-\d{2}$/.test(body.ask.month) ? body.ask.month : "";
    if (!text || !month) return json({ error: "Say something first." }, 400);

    const hour = new Date().toISOString().slice(0, 13);
    const rateKey = "rate-" + hour;
    const used = (await s.get(rateKey, { type: "json" })) || 0;
    if (used >= MAX_PER_HOUR) return json({ error: "That's a lot of plans this hour. Try again shortly." }, 429);
    await s.setJSON(rateKey, used + 1);

    const job = { id: randomBytes(12).toString("hex"), token: randomBytes(24).toString("hex"), month, text,
      status: "running", startedAt: new Date().toISOString() };
    await s.setJSON(JOB_PREFIX + job.id, job);
    const r = await fetch("https://api.anthropic.com/v1/claude_code/routines/" + env("CLAUDE_ROUTINE_ID") + "/fire", {
      method: "POST",
      headers: { Authorization: "Bearer " + env("CLAUDE_ROUTINE_TOKEN"), "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ text: fireText(job, new Date().toISOString().slice(0, 10)) }),
    }).catch(() => null);
    if (!r || !r.ok) {
      await s.setJSON(JOB_PREFIX + job.id, { ...job, status: "failed", error: "Claude couldn't be reached." });
      return json({ error: "Claude couldn't be reached. Please try again." }, 502);
    }
    return json({ ok: true, job: job.id });
  }
  return json({ error: "Send { ask }" }, 400);
};
