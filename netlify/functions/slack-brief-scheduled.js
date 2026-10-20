// Netlify Function: slack-brief-scheduled  (v223)
//
// The team Slack card is ready before Ash opens the dashboard: a read at 06:00 UTC (the
// evening shift's checklists are in) and 14:00 UTC (the morning shift's are). The same
// shape as the ads sync — a tiny scheduled function (30s wall) asks the background one
// (15-min wall) to do the work. See netlify.toml.
export default async () => {
  const log = (e) => console.log("[slack-brief-scheduled] " + JSON.stringify(e));
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  const has = (k) => !!String(process.env[k] || "").trim();
  if (!base || !has("SLACK_USER_TOKEN") || !has("ANTHROPIC_API_KEY")) {
    log({ stage: "skipped", hasBase: !!base, hasSlack: has("SLACK_USER_TOKEN"), hasClaude: has("ANTHROPIC_API_KEY") });
    return Response.json({ ok: true, skipped: true });
  }
  try {
    const res = await fetch(base + "/.netlify/functions/slack-brief-background", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trigger: "schedule" }),
    });
    log({ stage: "triggered", status: res.status });
  } catch (e) { log({ stage: "trigger_failed", message: String((e && e.message) || "") }); }
  return Response.json({ ok: true });
};
