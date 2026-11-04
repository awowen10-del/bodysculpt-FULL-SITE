// netlify/lib/internal.js  (v271)
//
// The key a job inside the site carries when it calls another function through the site's own
// address, so the password gate lets it through. Signed with DASHBOARD_PASSWORD, the same way
// netlify/edge-functions/gate.js checks it. With no password set there is nothing to carry.
import { createHmac } from "node:crypto";

export function internalHeaders() {
  const secret = process.env.DASHBOARD_PASSWORD;
  return secret ? { "x-dashboard-internal": createHmac("sha256", secret).update("internal").digest("hex") } : {};
}
