// Netlify Function: store-backup-scheduled  (v299)
//
// Every night, ask store-backup-background to copy the working stores into bodysculpt-backup.
// The same shape as the takings pull: a tiny scheduled function (30s wall) asks the background
// one (15-min wall) to do the work. See netlify.toml and netlify/lib/backup.js.
import { internalHeaders } from "../lib/internal.js";
export default async () => {
  const log = (e) => console.log("[store-backup-scheduled] " + JSON.stringify(e));
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  if (!base) { log({ stage: "skipped" }); return Response.json({ ok: true, skipped: true }); }
  try {
    const res = await fetch(base + "/.netlify/functions/store-backup-background", {
      method: "POST", headers: { ...internalHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ trigger: "schedule" }),
    });
    log({ stage: res.ok ? "triggered" : "trigger_refused", status: res.status });
  } catch (e) { log({ stage: "trigger_failed", message: String((e && e.message) || "") }); }
  return Response.json({ ok: true });
};
