// netlify/lib/takings.js  (v225)
//
// The month's takings, read from where the money actually came in, so the Monthly KPIs page
// can fill four boxes instead of Ash copying them from three dashboards:
//
//   Recurring Revenue  = GoCardless (memberships only)  +  Stripe payments NOT named as trials
//   Trial Revenue      = Stripe payments whose name says "6 week", "6-week" or "referral"
//   Other Revenue      = SumUp (meal prep, nothing else goes through it)
//   Processing Fees    = what Stripe, GoCardless and SumUp kept
//
// Charged and Banked are not here: the page already works them out from those four.
//
// Rules Ash set (2026-10-21):
//   - GoCardless only ever takes recurring payments.
//   - Stripe takes recurring AND trial; the payment's NAME tells them apart.
//   - SumUp only takes extra income (meal prep).
//   - A refund comes off the month it was REFUNDED in, not the month of the payment.
//
// Read-only. Every call below is a GET. Nothing here writes to Stripe, GoCardless or SumUp,
// and nothing here touches the KPI store — the page saves the month the way it always has,
// after Ash has looked at the numbers. This file's only store is its own (bodysculpt-takings),
// which keeps the last pull of each month so the page can show it without asking again.
//
// Each provider can fail on its own (key not set, permission missing, provider down). A box
// is only filled when EVERY source it depends on answered — a Recurring figure missing
// GoCardless would look plausible and be wrong by most of the month.
import { getStore } from "@netlify/blobs";

const STORE = "bodysculpt-takings";
const store = () => getStore({ name: STORE, consistency: "strong" });

/* ---------- the month, in UK time ---------- */
// "2026-09" -> the instants the month starts and ends in Europe/London, plus its first and
// last calendar day. The 1st at midnight is never inside a clock change (those are at 01:00
// and 02:00), so one offset lookup per boundary is exact.
function londonOffsetMs(utcMs) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const wall = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return wall - utcMs;
}
function londonMidnight(y, m0) {          // m0 is 0-based and may be 12 (rolls into next year)
  const guess = Date.UTC(y, m0, 1, 0, 0, 0);
  return guess - londonOffsetMs(guess);
}
export function monthBounds(ym) {
  const mt = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
  if (!mt) return null;
  const y = Number(mt[1]), m = Number(mt[2]);
  if (m < 1 || m > 12) return null;
  const startMs = londonMidnight(y, m - 1);
  const endMs = londonMidnight(y, m);             // exclusive
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    ym, startMs, endMs,
    startUnix: Math.floor(startMs / 1000), endUnix: Math.floor(endMs / 1000),
    firstDay: `${y}-${pad(m)}-01`, lastDay: `${y}-${pad(m)}-${pad(lastDay)}`,
  };
}
// The month before the one `now` falls in, as "YYYY-MM" (UK calendar).
export function lastMonthOf(now) {
  const ms = (now instanceof Date ? now : new Date()).getTime();
  const wall = new Date(ms + londonOffsetMs(ms));
  let y = wall.getUTCFullYear(), m = wall.getUTCMonth();   // m is 0-based = last month 1-based
  if (m === 0) { y -= 1; m = 12; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

const pence = (n) => Math.round(Number(n) || 0);
const pounds = (p) => Math.round(p) / 100;
const clip = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

/* ---------- which Stripe payments are trials ---------- */
// Ash: "Trial sales will always have 6 week, 6-week, or referral in the name." Spaces,
// hyphens and case vary across Ontraport, payment links and (soon) GoHighLevel, so the match
// allows any run of spaces/hyphens between the 6 and the word, and "weeks" — but not a 6
// that is the end of a bigger number ("16 week plan" is not the challenge).
const TRIAL_RE = /(?<!\d)6[\s\-]*weeks?|referral/i;
export function isTrialName(name) { return TRIAL_RE.test(String(name || "")); }

// Everything Stripe calls a payment, as one line of text to match against. Ontraport and
// payment links put the product in the description; subscriptions put it on the invoice
// line ("1 × 6 Week Challenge (at £99.00 / month)"); some tools leave it in metadata.
export function stripeName(charge) {
  if (!charge || typeof charge !== "object") return "";
  const bits = [];
  if (charge.description) bits.push(charge.description);
  const inv = charge.invoice && typeof charge.invoice === "object" ? charge.invoice : null;
  if (inv) {
    const lines = (inv.lines && Array.isArray(inv.lines.data)) ? inv.lines.data : [];
    for (const l of lines) {
      if (l && l.description) bits.push(l.description);
      if (l && l.price && l.price.nickname) bits.push(l.price.nickname);
      if (l && l.plan && l.plan.nickname) bits.push(l.plan.nickname);
    }
    if (inv.description) bits.push(inv.description);
  }
  if (charge.metadata && typeof charge.metadata === "object") {
    for (const v of Object.values(charge.metadata)) if (typeof v === "string" && v) bits.push(v);
  }
  if (!bits.length && charge.calculated_statement_descriptor) bits.push(charge.calculated_statement_descriptor);
  return [...new Set(bits.map((b) => String(b).trim()).filter(Boolean))].join(" · ");
}
// The short label the review lists the payment under: the invoice line if there is one
// (it names the product), else the description, with "1 × " and "(at £x / month)" taken off.
function stripeLabel(charge) {
  const inv = charge && charge.invoice && typeof charge.invoice === "object" ? charge.invoice : null;
  const line = inv && inv.lines && Array.isArray(inv.lines.data) && inv.lines.data[0] ? inv.lines.data[0].description : "";
  let s = String(line || charge.description || "").trim();
  s = s.replace(/^\d+\s*[×x]\s*/i, "").replace(/\s*\(at [^)]*\)\s*$/i, "").trim();
  return s ? clip(s, 60) : "(no name on the payment)";
}

/* ---------- Stripe ---------- */
const STRIPE_API = "https://api.stripe.com/v1";
async function stripeList(fx, key, path, params, maxPages) {
  const out = [];
  let after = null;
  for (let page = 0; page < (maxPages || 40); page++) {
    const q = [...params, ["limit", "100"]];
    if (after) q.push(["starting_after", after]);
    const url = STRIPE_API + path + "?" + q.map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
    const res = await fx(url, { headers: { Authorization: "Bearer " + key, "Stripe-Version": "2024-06-20" } });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (body && body.error && body.error.message) || ("Stripe returned " + res.status);
      throw new Error(msg);
    }
    const data = (body && Array.isArray(body.data)) ? body.data : [];
    out.push(...data);
    if (!body.has_more || !data.length) return out;
    after = data[data.length - 1].id;
  }
  throw new Error("Stripe: more than " + (maxPages || 40) * 100 + " records in one month — stopped rather than guess");
}

export async function pullStripe(fx, key, b) {
  if (!key) return { ok: false, missing: true, error: "STRIPE_SECRET_KEY is not set in Netlify" };
  const win = [["created[gte]", String(b.startUnix)], ["created[lt]", String(b.endUnix)]];
  try {
    // 1. Payments taken this month. A charge that succeeded counts in full here, even if it
    //    is refunded later — the refund is its own line, in the month it happened (step 2).
    const charges = await stripeList(fx, key, "/charges",
      [...win, ["expand[]", "data.invoice"], ["expand[]", "data.balance_transaction"]]);
    // 2. Refunds made this month, whenever the payment was.
    const refunds = await stripeList(fx, key, "/refunds",
      [...win, ["expand[]", "data.charge"], ["expand[]", "data.charge.invoice"], ["expand[]", "data.balance_transaction"]]);
    // 3. Chargebacks opened this month that were lost — the money went back just like a refund.
    const disputes = await stripeList(fx, key, "/disputes", [...win, ["expand[]", "data.charge"], ["expand[]", "data.charge.invoice"]]);
    // 4. Stripe's own bills (Billing, Radar …) taken straight out of the balance.
    const feeLines = await stripeList(fx, key, "/balance_transactions", [...win, ["type", "stripe_fee"]]);

    const groups = new Map();      // label -> {name, kind, amount, count}
    const note = (label, kind, p, c) => {
      const k = kind + "|" + label;
      const g = groups.get(k) || { name: label, kind, amount: 0, count: 0 };
      g.amount += p; g.count += c; groups.set(k, g);
    };
    let recurring = 0, trial = 0, fees = 0, trialCount = 0, otherCurrency = 0;
    const refunded = { recurring: 0, trial: 0 };
    for (const ch of charges) {
      if (!ch || ch.status !== "succeeded" || !ch.paid) continue;
      if (ch.currency && ch.currency !== "gbp") { otherCurrency++; continue; }
      const amt = pence(ch.amount);
      const kind = isTrialName(stripeName(ch)) ? "trial" : "recurring";
      if (kind === "trial") { trial += amt; trialCount++; } else recurring += amt;
      note(stripeLabel(ch), kind, amt, 1);
      const bt = ch.balance_transaction && typeof ch.balance_transaction === "object" ? ch.balance_transaction : null;
      if (bt) fees += pence(bt.fee);
    }
    for (const r of refunds) {
      if (!r || r.status === "failed" || r.status === "canceled") continue;
      if (r.currency && r.currency !== "gbp") { otherCurrency++; continue; }
      const ch = r.charge && typeof r.charge === "object" ? r.charge : null;
      const kind = isTrialName(stripeName(ch)) ? "trial" : "recurring";
      refunded[kind] += pence(r.amount);
      const bt = r.balance_transaction && typeof r.balance_transaction === "object" ? r.balance_transaction : null;
      if (bt) fees += pence(bt.fee);          // a fee Stripe handed back is negative here
    }
    let lost = 0;
    for (const d of disputes) {
      if (!d) continue;
      // Stripe's £20 dispute fee is charged when the dispute opens, whatever happens after —
      // it sits on the dispute's own balance lines, not on the charge.
      for (const bt of (Array.isArray(d.balance_transactions) ? d.balance_transactions : [])) fees += pence(bt && bt.fee);
      if (d.status !== "lost") continue;
      const ch = d.charge && typeof d.charge === "object" ? d.charge : null;
      const kind = isTrialName(stripeName(ch)) ? "trial" : "recurring";
      refunded[kind] += pence(d.amount);
      lost++;
    }
    for (const t of feeLines) fees += -pence(t.amount);   // stripe_fee lines are money out

    const names = [...groups.values()].sort((a, b2) => b2.amount - a.amount)
      .map((g) => ({ name: g.name, kind: g.kind, amount: pounds(g.amount), count: g.count }));
    const notes = [];
    if (lost) notes.push(lost + " chargeback" + (lost === 1 ? "" : "s") + " lost this month, taken off like a refund");
    if (otherCurrency) notes.push(otherCurrency + " payment" + (otherCurrency === 1 ? "" : "s") + " not in pounds left out");
    return {
      ok: true,
      recurring: pounds(recurring - refunded.recurring),
      trial: pounds(trial - refunded.trial),
      gross: { recurring: pounds(recurring), trial: pounds(trial) },
      refunds: { recurring: pounds(refunded.recurring), trial: pounds(refunded.trial) },
      fees: pounds(fees),
      trialCount,
      names, notes,
    };
  } catch (e) {
    const msg = String((e && e.message) || "Could not reach Stripe");
    // The Daily Dashboard's key was made for disputes and failed payments. Fees and refunds
    // need two more read permissions — say exactly which, rather than "permission denied".
    const perm = /permission|restricted|rak_/i.test(msg)
      ? " — the Stripe key needs read access to Balance, Invoices and Refunds as well as Charges and Disputes"
      : "";
    return { ok: false, error: clip(msg, 220) + perm };
  }
}

/* ---------- GoCardless ---------- */
const GC_API = "https://api.gocardless.com";
async function gcList(fx, token, path, params, key) {
  const out = [];
  let after = null;
  for (let page = 0; page < 40; page++) {
    const q = [...params, ["limit", "500"]];
    if (after) q.push(["after", after]);
    const url = GC_API + path + "?" + q.map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
    const res = await fx(url, { headers: { Authorization: "Bearer " + token, "GoCardless-Version": "2015-07-06", Accept: "application/json" } });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (body && body.error && body.error.message) || ("GoCardless returned " + res.status);
      throw new Error(msg);
    }
    const data = (body && Array.isArray(body[key])) ? body[key] : [];
    out.push(...data);
    after = body && body.meta && body.meta.cursors ? body.meta.cursors.after : null;
    if (!after || !data.length) return out;
  }
  throw new Error("GoCardless: more than 20,000 records — stopped rather than guess");
}
// Payments that went out of members' accounts. "submitted" has been sent to the bank and
// almost always confirms within a few working days — it counts, and the review says how many
// were still waiting so a pull made too early is visible.
const GC_TAKEN = new Set(["submitted", "confirmed", "paid_out"]);

export async function pullGoCardless(fx, token, b, nowMs) {
  if (!token) return { ok: false, missing: true, error: "GOCARDLESS_ACCESS_TOKEN is not set in Netlify" };
  try {
    const payments = await gcList(fx, token, "/payments",
      [["charge_date[gte]", b.firstDay], ["charge_date[lte]", b.lastDay]], "payments");
    let gross = 0, count = 0, waiting = 0, failed = 0, chargedBack = 0;
    const mine = new Set();
    for (const p of payments) {
      if (!p) continue;
      if (p.currency && p.currency !== "GBP") continue;
      if (GC_TAKEN.has(p.status)) {
        gross += pence(p.amount); count++; mine.add(p.id);
        if (p.status === "submitted") waiting++;
      } else if (p.status === "failed") failed++;
      else if (p.status === "charged_back") chargedBack++;
    }
    const createdWin = [["created_at[gte]", new Date(b.startMs).toISOString()], ["created_at[lt]", new Date(b.endMs).toISOString()]];
    const refunds = await gcList(fx, token, "/refunds", createdWin, "refunds");
    let refunded = 0;
    for (const r of refunds) {
      if (!r || r.status === "failed" || r.status === "cancelled") continue;
      refunded += pence(r.amount);
    }
    // Fees. GoCardless takes them when it pays out, so they live on the payouts — which land
    // a few days after the payment. Read every payout from the 1st to a fortnight after the
    // month and keep only the fee lines that belong to THIS month's payments.
    const lateMs = Math.min(b.endMs + 14 * 86400000, nowMs || Date.now());
    const payouts = await gcList(fx, token, "/payouts",
      [["created_at[gte]", new Date(b.startMs).toISOString()], ["created_at[lte]", new Date(lateMs).toISOString()]], "payouts");
    let fees = 0, feesApprox = false;
    const paidOut = new Set();
    try {
      for (let i = 0; i < payouts.length; i += 5) {
        const batch = payouts.slice(i, i + 5);
        const items = await Promise.all(batch.map((po) => gcList(fx, token, "/payout_items", [["payout", po.id]], "payout_items")));
        for (const list of items) for (const it of list) {
          const pid = it && it.links && it.links.payment;
          if (!pid || !mine.has(pid)) continue;
          if (it.type === "payment_paid_out") paidOut.add(pid);
          if (/fee/.test(String(it.type || ""))) fees += -Number(it.amount || 0);   // pence, negative = taken
        }
      }
    } catch (e) {
      // GoCardless archives the per-payment fee lines after six months. The money taken is
      // still exact; only the fee falls back to each payout's own total, for payouts made in
      // the month — close, not to the penny. Anything else is a real failure.
      if (!/archived/i.test(String((e && e.message) || ""))) throw e;
      feesApprox = true; fees = 0;
      for (const po of payouts) {
        const at = Date.parse(po && po.created_at);
        if (at >= b.startMs && at < b.endMs) fees += pence(po.deducted_fees);
      }
    }
    const notPaidOut = feesApprox ? 0 : [...mine].filter((id) => !paidOut.has(id)).length;
    const notes = [];
    if (waiting) notes.push(waiting + " payment" + (waiting === 1 ? " was" : "s were") + " still on its way from the bank");
    if (feesApprox) notes.push("GoCardless has archived the fee detail for this month, so its fees are the payouts' totals — close, not exact");
    if (notPaidOut) notes.push(notPaidOut + " not paid out to you yet, so their fees aren't in the fee figure");
    if (failed) notes.push(failed + " failed (not counted)");
    if (chargedBack) notes.push(chargedBack + " charged back by the member's bank (not counted)");
    return {
      ok: true,
      recurring: pounds(gross - refunded),
      gross: pounds(gross), refunds: pounds(refunded), count,
      fees: pounds(Math.round(fees)), feesApprox, notPaidOut, waiting, failed, chargedBack, notes,
    };
  } catch (e) {
    return { ok: false, error: clip(String((e && e.message) || "Could not reach GoCardless"), 260) };
  }
}

/* ---------- SumUp ---------- */
const SUMUP_API = "https://api.sumup.com";
async function sumupGet(fx, key, pathAndQuery) {
  const res = await fx(SUMUP_API + pathAndQuery, { headers: { Authorization: "Bearer " + key, Accept: "application/json" } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (body && (body.message || body.error_message || (body.error && body.error.message))) || ("SumUp returned " + res.status);
    throw new Error(msg);
  }
  return body;
}
const SUMUP_TAKEN = new Set(["SUCCESSFUL", "PAID_OUT", "REFUNDED", "CHARGE_BACK"]);

export async function pullSumUp(fx, key, b, nowMs) {
  if (!key) return { ok: false, missing: true, error: "SUMUP_API_KEY is not set in Netlify" };
  try {
    const base = "/v0.1/me/transactions/history";
    let q = "?" + [["oldest_time", new Date(b.startMs).toISOString()], ["newest_time", new Date(b.endMs - 1).toISOString()],
      ["limit", "100"], ["order", "ascending"]].map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
    const rows = [];
    for (let page = 0; page < 60 && q; page++) {
      const body = await sumupGet(fx, key, base + q);
      const items = (body && Array.isArray(body.items)) ? body.items : [];
      rows.push(...items);
      const next = (body && Array.isArray(body.links) ? body.links : []).find((l) => l && l.rel === "next");
      q = next && next.href && items.length ? (String(next.href).startsWith("?") ? next.href : "?" + next.href) : null;
    }
    let gross = 0, refunded = 0, count = 0;
    const codes = new Set();
    for (const t of rows) {
      if (!t) continue;
      if (t.currency && t.currency !== "GBP") continue;
      const amt = Math.round(Number(t.amount || 0) * 100);      // SumUp sends pounds, not pence
      const type = String(t.type || "PAYMENT").toUpperCase();
      const status = String(t.status || "").toUpperCase();
      if (type === "REFUND") { if (status !== "FAILED" && status !== "CANCELLED") refunded += Math.abs(amt); continue; }
      if (type !== "PAYMENT" || !SUMUP_TAKEN.has(status)) continue;
      gross += amt; count++;
      if (t.transaction_code) codes.add(t.transaction_code);
    }
    // Fees. SumUp keeps them in more than one place depending on the account, so try each in
    // turn and stop at the first that gives fees for THIS month's sales (matched by code).
    // What each place said is kept in feeTried — field names and counts only, never values —
    // so a gap can be diagnosed from the review instead of guessed at. If none of them say,
    // the fee box says so rather than quietly leaving SumUp out.
    let fees = 0, feesKnown = !count;         // nothing sold, nothing charged
    const feeTried = [];
    const feeOf = (f) => {
      if (!f || typeof f !== "object") return null;
      for (const k of ["fee_amount", "fee", "fees", "transaction_fee"]) if (f[k] != null && isFinite(Number(f[k]))) return Math.abs(Number(f[k]));
      return null;
    };
    const lateMs = Math.min(b.endMs + 14 * 86400000, nowMs || Date.now());
    const day = (ms) => new Date(ms).toISOString().slice(0, 10);
    const span = "start_date=" + b.firstDay + "&end_date=" + day(lateMs) + "&format=json&limit=1000";
    for (const path of ["/v0.1/me/financials/transactions?" + span, "/v0.1/me/financials/payouts?" + span]) {
      if (feesKnown) break;
      const label = path.split("?")[0].split("/").pop();
      try {
        const fin = await sumupGet(fx, key, path);
        const list = Array.isArray(fin) ? fin : (fin && Array.isArray(fin.items) ? fin.items : []);
        let matched = 0, sum = 0;
        for (const f of list) {
          if (!f || !f.transaction_code || !codes.has(f.transaction_code)) continue;
          const v = feeOf(f);
          if (v == null) continue;
          sum += Math.round(v * 100); matched++;
        }
        feeTried.push(label + ": " + list.length + " rows, " + matched + " matched" + (list[0] ? " [" + Object.keys(list[0]).slice(0, 12).join(",") + "]" : ""));
        if (matched) { fees = sum; feesKnown = true; }
      } catch (e) { feeTried.push(label + ": " + clip(String((e && e.message) || "failed"), 80)); }
    }
    // Last resort: each sale's own record, which carries its fee on the payout event.
    if (!feesKnown) {
      const list = [...codes];
      let matched = 0, sum = 0, failedCalls = 0, firstKeys = "";
      for (let i = 0; i < list.length; i += 10) {
        const got = await Promise.all(list.slice(i, i + 10).map((c) =>
          sumupGet(fx, key, "/v0.1/me/transactions?transaction_code=" + encodeURIComponent(c)).catch(() => { failedCalls++; return null; })));
        for (const t of got) {
          if (!t) continue;
          if (!firstKeys) firstKeys = Object.keys(t).slice(0, 15).join(",");
          let v = feeOf(t);
          if (v == null && Array.isArray(t.events)) {
            const ev = t.events.map(feeOf).filter((x) => x != null);
            if (ev.length) v = ev.reduce((a, x) => a + x, 0);
          }
          if (v == null) continue;
          sum += Math.round(v * 100); matched++;
        }
      }
      feeTried.push("each sale: " + matched + " of " + list.length + " had a fee" + (failedCalls ? ", " + failedCalls + " calls failed" : "") + (firstKeys ? " [" + firstKeys + "]" : ""));
      if (matched) { fees = sum; feesKnown = true; }
    }
    const notes = [];
    if (!feesKnown) notes.push("SumUp didn't give its fees for these sales — the fee figure is Stripe and GoCardless only");
    return {
      ok: true,
      other: pounds(gross - refunded),
      gross: pounds(gross), refunds: pounds(refunded), count,
      fees: feesKnown ? pounds(fees) : null, feesKnown, feeTried, notes,
    };
  } catch (e) {
    return { ok: false, error: clip(String((e && e.message) || "Could not reach SumUp"), 260) };
  }
}

/* ---------- the four boxes ---------- */
export function combine(st, gc, su) {
  const fields = { recurringRev: null, trialRev: null, otherRev: null, processingFees: null };
  const r2 = (n) => Math.round(n * 100) / 100;
  if (st.ok && gc.ok) fields.recurringRev = r2(st.recurring + gc.recurring);
  if (st.ok) fields.trialRev = r2(st.trial);
  if (su.ok) fields.otherRev = r2(su.other);
  // Fees are filled when Stripe and GoCardless answered; SumUp's are added when it gave them.
  // When it didn't, the warning says so on the page beside the box.
  if (st.ok && gc.ok) fields.processingFees = r2(st.fees + gc.fees + (su.ok && su.feesKnown ? su.fees : 0));
  const warnings = [];
  for (const [label, s] of [["Stripe", st], ["GoCardless", gc], ["SumUp", su]]) {
    if (!s.ok) warnings.push(label + ": " + s.error);
  }
  if (fields.processingFees != null && !(su.ok && su.feesKnown)) warnings.push("Processing Fees doesn't include SumUp's fees");
  return { fields, warnings };
}

export async function pullMonth(ym, env, fx, nowMs) {
  const b = monthBounds(ym);
  if (!b) return { ok: false, error: "Month should look like 2026-09" };
  const now = nowMs || Date.now();
  if (b.startMs > now) return { ok: false, error: "That month hasn't started yet" };
  const f = fx || fetch;
  const [st, gc, su] = await Promise.all([
    pullStripe(f, env.STRIPE_SECRET_KEY || env.STRIPE_API_KEY || "", b),
    pullGoCardless(f, env.GOCARDLESS_ACCESS_TOKEN || "", b, now),
    pullSumUp(f, env.SUMUP_API_KEY || "", b, now),
  ]);
  const { fields, warnings } = combine(st, gc, su);
  return {
    ok: true, month: ym, pulledAt: new Date(now).toISOString(),
    partial: b.endMs > now,                    // the month isn't over: these are "so far"
    fields, warnings, sources: { stripe: st, gocardless: gc, sumup: su },
  };
}

/* ---------- the kept copy ---------- */
export async function savePull(pull, s) {
  if (!pull || !pull.ok || !pull.month) return;
  await (s || store()).setJSON("pull-" + pull.month, pull);
}
export async function readPull(ym, s) {
  if (!monthBounds(ym)) return null;
  return (await (s || store()).get("pull-" + ym, { type: "json" })) || null;
}
