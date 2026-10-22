// Netlify Function: mail-ai  (v244)
//
// The "Needs a reply" card's own function. See netlify/lib/mail-drafts.js for the whole picture.
//
//   GET                                   how the morning run sorted each thread, and whether
//                                         a run is going — { triage: { [threadId]: … }, run }
//   POST { op: "write", threadId, current?, brief? }
//                                         Claude (Opus, from Ash's skill) writes the reply to
//                                         that thread. The thread is read HERE, from Gmail,
//                                         whole; the text comes back to fill the editor and
//                                         goes nowhere else
//   POST { op: "run" }                    start the morning run now (the card's "Draft replies")
//
// Every call needs the browser's device key (X-Device-Key) — the one google-auth.js gave it
// when Ash connected Gmail. This reads his mail, so a stranger with the URL gets nothing.
import { deviceOk, gmailGet, threadDetail } from "../lib/gmail.js";
import { writeReply, triageForPage, readJSON, RUN_KEY, env, clip } from "../lib/mail-drafts.js";

const json = (body, status) => new Response(JSON.stringify(body), {
  status: status || 200,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export default async (req) => {
  if (!(await deviceOk(req))) return json({ ok: false, error: "This browser is not connected to Gmail yet." }, 401);

  if (req.method === "GET") {
    const [triage, run] = await Promise.all([triageForPage(), readJSON(RUN_KEY, {})]);
    return json({ ok: true, triage, run: { running: !!run.running, startedAt: run.startedAt || 0, finishedAt: run.finishedAt || 0, counts: run.counts || null, error: run.error || "" } });
  }
  if (req.method !== "POST") return json({ ok: false, error: "GET or POST only." }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Could not read the request." }, 400); }
  const op = String((body && body.op) || "");

  try {
    if (op === "write") {
      if (!env("ANTHROPIC_API_KEY")) return json({ ok: false, error: "ANTHROPIC_API_KEY is not set." }, 400);
      const id = clip(body.threadId, 40);
      if (!/^[0-9a-f]+$/i.test(id)) return json({ ok: false, error: "No thread named." }, 400);
      const detail = threadDetail(await gmailGet("threads/" + encodeURIComponent(id) + "?format=full"));
      if (!detail.messages.length) return json({ ok: false, error: "That thread is empty." }, 404);
      const text = await writeReply(detail, { mode: "button", current: clip(body.current, 6000), brief: clip(body.brief, 500) });
      return json({ ok: true, text });
    }

    if (op === "run") {
      const secret = env("SYNC_TRIGGER_SECRET");
      if (!secret) return json({ ok: false, error: "SYNC_TRIGGER_SECRET is not set in Netlify." }, 400);
      const run = await readJSON(RUN_KEY, {});
      if (run.running && Date.now() - (run.startedAt || 0) < 14 * 60 * 1000) return json({ ok: true, started: false, running: true });
      const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || new URL(req.url).origin;
      const res = await fetch(base + "/.netlify/functions/mail-drafts-background", {
        method: "POST", headers: { "Content-Type": "application/json", "x-mail-trigger": secret }, body: JSON.stringify({ trigger: "page" }),
      });
      return json({ ok: res.status < 300, started: res.status < 300, running: res.status < 300 });
    }

    return json({ ok: false, error: "Unknown operation." }, 400);
  } catch (e) {
    return json({ ok: false, error: clip((e && e.message) || "Something went wrong.", 400) }, 502);
  }
};
