// Netlify Function: ask-claude-agent  (v271)
//
// The one address the cloud Claude run uses. The password gate lets it through without a
// session, so it does its own checking: every request needs the one-use token of a job that is
// still running. It can read the snapshot that job needs and hand in that job's answer. A job
// that has been answered, or that has timed out, gets nothing.
//
//   GET  ?job=<id>&token=<token>                    { projects, plan, rocks, quarterTag }
//   POST { result:{ jobId, token, proposal|error } }
import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";
import { JOB_PREFIX, JOB_MINUTES, cleanProposal } from "../lib/ask-claude.js";
import { internalHeaders } from "../lib/internal.js";

const json = (o, status = 200) => Response.json(o, { status });
const store = () => getStore({ name: "bodysculpt-ask", consistency: "strong" });
const validJob = (id) => typeof id === "string" && /^[a-f0-9]{24}$/.test(id);

function sameToken(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
async function openJob(id, token) {
  if (!validJob(id)) return null;
  const job = await store().get(JOB_PREFIX + id, { type: "json" });
  if (!job || !sameToken(job.token, token) || job.status !== "running") return null;
  if (Date.now() - Date.parse(job.startedAt) > JOB_MINUTES * 60000) return null;
  return job;
}

export default async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const job = await openJob(url.searchParams.get("job"), url.searchParams.get("token"));
    if (!job) return json({ error: "Not allowed" }, 403);
    const base = process.env.URL || url.origin;
    const read = (path) => fetch(base + "/.netlify/functions/" + path, { headers: internalHeaders() })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [p, m] = await Promise.all([read("projects?list=1"), read("kpi-store?monthlyplan=" + encodeURIComponent(job.month))]);
    if (!p || !m) return json({ error: "The dashboard couldn't be read" }, 502);
    return json({ projects: p.projects || [], plan: m.plan || null, rocks: m.rocks || [], quarterTag: m.quarterTag || "" });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const r = body && body.result;
  if (!r) return json({ error: "Send { result }" }, 400);
  const job = await openJob(r.jobId, r.token);
  if (!job) return json({ error: "Not allowed" }, 403);
  const clean = cleanProposal(r.proposal);
  await store().setJSON(JOB_PREFIX + job.id, clean
    ? { ...job, status: "done", proposal: clean, finishedAt: new Date().toISOString() }
    : { ...job, status: "failed", error: typeof r.error === "string" && r.error ? r.error.slice(0, 300) : "Claude couldn't build a plan from that." });
  return json({ ok: true });
};
