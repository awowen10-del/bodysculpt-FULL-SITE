// Netlify Function: takings-background  (v225)
//
// Last month's takings, pulled and kept so they are waiting on the Monthly KPIs page for
// Ash to review. Asked for by takings-scheduled on the 4th — late enough that direct debits
// taken at the end of the month have cleared or bounced. Background (15-min wall) because
// GoCardless's fees mean one call per payout.
import { pullMonth, savePull, lastMonthOf } from "../lib/takings.js";

export default async (req) => {
  const log = (e) => console.log("[takings-background] " + JSON.stringify(e));
  let ym = lastMonthOf(new Date());
  try { const b = await req.json(); if (b && /^\d{4}-\d{2}$/.test(b.month || "")) ym = b.month; } catch (e) {}
  const pull = await pullMonth(ym, process.env);
  if (pull.ok) await savePull(pull);
  log({ month: ym, ok: pull.ok, fields: pull.fields, warnings: pull.warnings, error: pull.error });
};
