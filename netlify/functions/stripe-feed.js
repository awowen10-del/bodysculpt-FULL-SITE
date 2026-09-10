// Netlify Function: stripe-feed  (v135)
//
// Read-only. Answers one question for the Daily Dashboard: "is there any money that
// needs me today?" — and nothing else. It never creates, refunds, cancels or changes
// anything in Stripe; every call it makes is a GET.
//
// Three kinds of trouble, in the order they cost you money:
//   1. DISPUTES      — a member has charged back. There is a deadline, and missing it
//                      loses the money automatically. Always first.
//   2. PAST DUE      — a membership whose payment failed and is still failing. This is
//                      recurring revenue quietly walking out.
//   3. FAILED CHARGES— one-off failures in the last 14 days, which are usually an
//                      expired card and usually fixable with one message.
//
// The secret key lives in the Netlify environment and NEVER reaches the browser — that
// is the whole reason this function exists rather than the page calling Stripe directly.
// Set it in Netlify: Site configuration -> Environment variables -> STRIPE_SECRET_KEY.
// A restricted key with read-only access to Charges, Disputes, Subscriptions and
// Customers is enough, and is what you should use.
//
// Failure is always a 200 with a message in the body, never a 500: a dashboard tile that
// says "Stripe key not set yet" is useful, and a broken red card is not.

const STRIPE_API = "https://api.stripe.com/v1";
const FAILED_WINDOW_DAYS = 14;   // how far back a failed one-off charge is still news
const PAGE_LIMIT = 50;           // per Stripe list call; a gym will never approach this

/* ---------- talking to Stripe ---------- */
// Stripe's API is form-encoded and takes repeated keys for arrays (expand[]), so the
// query string is built by hand rather than through URLSearchParams' object form.
function qs(params) {
  const parts = [];
  for (const [k, v] of params) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  return parts.length ? "?" + parts.join("&") : "";
}

async function stripeGet(key, path, params) {
  const res = await fetch(STRIPE_API + path + qs(params || []), {
    headers: {
      Authorization: "Bearer " + key,
      "Stripe-Version": "2024-06-20",
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (body && body.error && body.error.message) || ("Stripe returned " + res.status);
    const err = new Error(msg);
    err.stripeStatus = res.status;
    throw err;
  }
  return body || { data: [] };
}

/* ---------- shaping ---------- */
const pence = (n) => (typeof n === "number" && isFinite(n) ? n : 0);
const iso = (unix) => (typeof unix === "number" && unix > 0 ? new Date(unix * 1000).toISOString() : "");
const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");

// A dispute's customer is not on the object, so the charge is expanded to reach the name.
function shapeDispute(d) {
  const ch = d && typeof d.charge === "object" ? d.charge : null;
  const bd = (ch && ch.billing_details) || {};
  return {
    id: clip(d.id, 60),
    kind: "dispute",
    name: clip(bd.name || (ch && ch.receipt_email) || "", 120),
    email: clip(bd.email || (ch && ch.receipt_email) || "", 160),
    amount: pence(d.amount),
    currency: clip(d.currency, 8) || "gbp",
    reason: clip(d.reason, 60),
    status: clip(d.status, 40),
    createdAt: iso(d.created),
    dueBy: iso(d.evidence_details && d.evidence_details.due_by),
    url: "https://dashboard.stripe.com/disputes/" + clip(d.id, 60),
  };
}

// A past-due membership. `customer` is expanded so the row can say who, not just an id.
function shapeSubscription(s) {
  const c = s && typeof s.customer === "object" ? s.customer : null;
  const item = s && s.items && Array.isArray(s.items.data) ? s.items.data[0] : null;
  const price = item && item.price ? item.price : null;
  return {
    id: clip(s.id, 60),
    kind: "subscription",
    name: clip((c && (c.name || c.email)) || "", 120),
    email: clip((c && c.email) || "", 160),
    amount: pence(price && price.unit_amount) * (item && item.quantity ? item.quantity : 1),
    currency: clip((price && price.currency) || s.currency, 8) || "gbp",
    status: clip(s.status, 40),
    // When the current period should have been paid for — i.e. how long this has been failing.
    since: iso(s.current_period_start),
    url: "https://dashboard.stripe.com/subscriptions/" + clip(s.id, 60),
  };
}

function shapeCharge(ch) {
  const bd = ch.billing_details || {};
  return {
    id: clip(ch.id, 60),
    kind: "charge",
    name: clip(bd.name || ch.receipt_email || "", 120),
    email: clip(bd.email || ch.receipt_email || "", 160),
    amount: pence(ch.amount),
    currency: clip(ch.currency, 8) || "gbp",
    // failure_message is the sentence a human can act on ("Your card has expired");
    // failure_code is the machine one. Prefer the sentence, fall back to the code.
    reason: clip(ch.failure_message || ch.failure_code || "Payment failed", 200),
    createdAt: iso(ch.created),
    url: "https://dashboard.stripe.com/payments/" + clip(ch.id, 60),
  };
}

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const key = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || "";
  // Not configured is a normal state, not an error: the dashboard renders a setup card.
  if (!key) {
    return Response.json({
      ok: true,
      configured: false,
      message: "No Stripe key set. Add STRIPE_SECRET_KEY in Netlify → Site configuration → Environment variables, then redeploy.",
      fetchedAt: new Date().toISOString(),
      disputes: [], pastDue: [], failed: [],
    });
  }

  const since = Math.floor(Date.now() / 1000) - FAILED_WINDOW_DAYS * 86400;

  try {
    // Four independent reads, in parallel — the function's whole latency is one round trip.
    const [disputes, pastDue, unpaid, charges] = await Promise.all([
      // The charge is expanded so a dispute row can name the member.
      stripeGet(key, "/disputes", [
        ["limit", PAGE_LIMIT],
        ["expand[]", "data.charge"],
      ]),
      stripeGet(key, "/subscriptions", [
        ["status", "past_due"],
        ["limit", PAGE_LIMIT],
        ["expand[]", "data.customer"],
      ]),
      stripeGet(key, "/subscriptions", [
        ["status", "unpaid"],
        ["limit", PAGE_LIMIT],
        ["expand[]", "data.customer"],
      ]),
      // Stripe cannot filter charges by status, so the window is filtered here instead.
      stripeGet(key, "/charges", [
        ["limit", 100],
        ["created[gte]", since],
      ]),
    ]);

    // Only disputes that are still yours to answer. Won/lost/warning_closed are history,
    // and putting history on a "needs you today" page is how a page stops being read.
    const OPEN_DISPUTE = ["warning_needs_response", "needs_response", "under_review", "warning_under_review"];
    const disputeRows = (disputes.data || [])
      .filter((d) => OPEN_DISPUTE.includes(d.status))
      .map(shapeDispute)
      .sort((a, b) => (a.dueBy || "9999") < (b.dueBy || "9999") ? -1 : 1);

    const subRows = [...(pastDue.data || []), ...(unpaid.data || [])]
      .map(shapeSubscription)
      .sort((a, b) => (a.since < b.since ? -1 : 1));

    const failedRows = (charges.data || [])
      .filter((ch) => ch.status === "failed")
      .map(shapeCharge)
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));

    const sum = (rows) => rows.reduce((t, r) => t + r.amount, 0);

    return new Response(JSON.stringify({
      ok: true,
      configured: true,
      liveMode: !key.startsWith("sk_test") && !key.startsWith("rk_test"),
      fetchedAt: new Date().toISOString(),
      windowDays: FAILED_WINDOW_DAYS,
      disputes: disputeRows,
      pastDue: subRows,
      failed: failedRows,
      totals: {
        count: disputeRows.length + subRows.length + failedRows.length,
        disputed: sum(disputeRows),
        pastDue: sum(subRows),
        failed: sum(failedRows),
      },
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // A dashboard opened three times in a morning should not be three trips to Stripe,
        // but "needs you today" must not be stale by an hour either.
        "Cache-Control": "public, max-age=0, s-maxage=120",
      },
    });
  } catch (e) {
    // 200 on purpose. The page shows the sentence; it does not show a broken card.
    return Response.json({
      ok: false,
      configured: true,
      error: clip(e && e.message ? e.message : "Could not reach Stripe", 300),
      fetchedAt: new Date().toISOString(),
      disputes: [], pastDue: [], failed: [],
    });
  }
};
