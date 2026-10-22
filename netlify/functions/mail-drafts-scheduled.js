// Netlify Function: mail-drafts-scheduled  (v244)
//
// The weekday morning run (cron in netlify.toml): a tiny scheduled function (30s wall) asks
// mail-drafts-background (15-min wall) to do the work — the same shape as the Slack brief.
export default async () => {
  const log = (e) => console.log("[mail-drafts-scheduled] " + JSON.stringify(e));
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  const secret = String(process.env.SYNC_TRIGGER_SECRET || "").trim();
  if (!base || !secret || !String(process.env.ANTHROPIC_API_KEY || "").trim()) {
    log({ stage: "skipped", hasBase: !!base, hasSecret: !!secret });
    return Response.json({ ok: true, skipped: true });
  }
  try {
    const res = await fetch(base + "/.netlify/functions/mail-drafts-background", {
      method: "POST", headers: { "Content-Type": "application/json", "x-mail-trigger": secret }, body: JSON.stringify({ trigger: "schedule" }),
    });
    log({ stage: "triggered", status: res.status });
  } catch (e) { log({ stage: "trigger_failed", message: String((e && e.message) || "") }); }
  return Response.json({ ok: true });
};
