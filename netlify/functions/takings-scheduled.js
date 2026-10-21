// Netlify Function: takings-scheduled  (v225)
//
// On the 4th of each month, ask takings-background to pull last month. The same shape as
// the Slack read: a tiny scheduled function (30s wall) asks the background one to do the
// work. See netlify.toml.
export default async () => {
  const log = (e) => console.log("[takings-scheduled] " + JSON.stringify(e));
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  if (!base) { log({ stage: "skipped" }); return Response.json({ ok: true, skipped: true }); }
  try {
    const res = await fetch(base + "/.netlify/functions/takings-background", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trigger: "schedule" }),
    });
    log({ stage: "triggered", status: res.status });
  } catch (e) { log({ stage: "trigger_failed", message: String((e && e.message) || "") }); }
  return Response.json({ ok: true });
};
