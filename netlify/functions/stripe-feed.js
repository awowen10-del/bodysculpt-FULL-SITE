// Netlify Function: stripe-feed  (v135, revised v137)
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
//   3. FAILED CHARGES— failures in the last 14 days THAT ARE STILL OUTSTANDING. A failed
//                      charge is not the same thing as money you are owed: cards bounce on
//                      the Tuesday and go through on the Thursday all the time, and the
//                      Tuesday failure stays in the API forever. v137 checks every failure
//                      against what happened afterwards and only shows the ones nobody has
//                      paid. See settledReason(). The count it cleared is reported back, so
//                      the page can say what it took off rather than going quietly silent.
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
/* v244: 60 days, not 14. The chase ladder (day 8 / day 15 / day 22 — Ash's policy, see
   netlify/lib/chase.js) needs a debt to stay on screen past its second week, and a failure
   that fell out of a 14-day window simply vanished while still owed. What did NOT move is
   SETTLE_WINDOW_DAYS below: widening the window must not widen what counts as "paid it". */
const FAILED_WINDOW_DAYS = 60;   // how far back a failed charge is still news
const SETTLE_WINDOW_DAYS = 14;   // how soon after a failure a payment reads as settling it
const PAGE_LIMIT = 50;           // per Stripe list call; a gym will never approach this
const CHARGE_PAGES = 10;         // up to 1,000 charges in the window — see listCharges()

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
    customerId: clip(typeof s.customer === "string" ? s.customer : (c && c.id) || "", 60),
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

/* v247: the email Ontraport writes into every charge's METADATA. A checkout that failed before
   Stripe made a customer record carries no email anywhere else — Elaine Brook's declined
   £195 on 28 Sep had none on the charge and no customer, but metadata.email was there all
   along. Used for recognising the person AND as the row's email. */
function metaEmail(ch) {
  const m = (ch && ch.metadata) || {};
  const v = String(m.email || m.Email || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : "";
}

function shapeCharge(ch) {
  const bd = ch.billing_details || {};
  // v244: the customer record as well — a subscription charge's billing email is usually
  // empty, and the chase needs somewhere to write to.
  const c = ch.customer && typeof ch.customer === "object" ? ch.customer : null;
  return {
    id: clip(ch.id, 60),
    kind: "charge",
    customerId: clip(typeof ch.customer === "string" ? ch.customer : (c && c.id) || "", 60),
    name: clip(bd.name || (c && c.name) || ch.receipt_email || "", 120),
    email: clip(bd.email || ch.receipt_email || (c && c.email) || metaEmail(ch) || "", 160),
    amount: pence(ch.amount),
    currency: clip(ch.currency, 8) || "gbp",
    // failure_message is the sentence a human can act on ("Your card has expired");
    // failure_code is the machine one. Prefer the sentence, fall back to the code.
    reason: clip(ch.failure_message || ch.failure_code || "Payment failed", 200),
    createdAt: iso(ch.created),
    url: "https://dashboard.stripe.com/payments/" + clip(ch.id, 60),
  };
}


/* The whole window of charges, all of it (a fortnight until v244, sixty days now). v138: this used to be a single page of 100. A gym
   billing a few hundred memberships puts more than that through a fortnight, and the
   cross-check below can only clear a failure it can see the payment for — so a short list
   does not merely lose rows, it leaves failures on screen that were in fact paid. Newest
   first, so the pages walk backwards through the window. */
async function listCharges(key, since) {
  const out = [];
  let after = "";
  for (let page = 0; page < CHARGE_PAGES; page++) {
    // The CUSTOMER is expanded as well as the invoice. Stripe's own payments list shows the
    // customer's email in its Customer column, but `billing_details.email` on a
    // subscription charge is usually empty — the address lives on the customer record. Not
    // expanding it meant the one identity that would have tied nine of Jennifer Lawton's
    // rows together was never loaded.
    const params = [["limit", 100], ["created[gte]", since],
                    ["expand[]", "data.invoice"], ["expand[]", "data.customer"]];
    if (after) params.push(["starting_after", after]);
    const r = await stripeGet(key, "/charges", params);
    const rows = r.data || [];
    out.push(...rows);
    if (!r.has_more || !rows.length) break;
    after = rows[rows.length - 1].id;
  }
  return { data: out };
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
      disputes: [], pastDue: [], failed: [], resolved: { count: 0, attempts: 0, amount: 0, reasons: [] },
    });
  }

  try {
    return new Response(JSON.stringify(await readMoney(key)), {
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
      disputes: [], pastDue: [], failed: [], resolved: { count: 0, attempts: 0, amount: 0, reasons: [] },
    });
  }
};

/* v244: the read itself, on its own, so the chase ladder (money-chase.js and the morning
   job) works from EXACTLY the rows this card shows — one definition of "owed", not two.
   Throws on a Stripe failure; the handler above turns that into the card's sentence. */
export async function readMoney(key) {
  const since = Math.floor(Date.now() / 1000) - FAILED_WINDOW_DAYS * 86400;
  {
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
      // The INVOICE is expanded with them, because for anything on a membership the invoice
      // — not the charge — is the thing that says whether the money ever arrived. See
      // settledReason() below.
      listCharges(key, since),
    ]);

    // Only disputes that are still yours to answer. Won/lost/warning_closed are history,
    // and putting history on a "needs you today" page is how a page stops being read.
    const OPEN_DISPUTE = ["warning_needs_response", "needs_response", "under_review", "warning_under_review"];
    const disputeRows = (disputes.data || [])
      .filter((d) => OPEN_DISPUTE.includes(d.status))
      .map(shapeDispute)
      .sort((a, b) => (a.dueBy || "9999") < (b.dueBy || "9999") ? -1 : 1);

    const subRaw = [...(pastDue.data || []), ...(unpaid.data || [])];

    /* ---------- which failures still need him? ----------
       v137 built this. v138 rebuilt it, because Ash found it wrong: "Jen Lawton's payment
       is showing as insufficient funds, that was last pulled through on the 6th, but full
       payment was then made on the 8th."

       Three faults, and the first was the bad one:

       · THE INVOICE TEST SHORT-CIRCUITED. If a failure had an invoice and that invoice was
         still open, the function returned there and never ran the other three tests. An
         open invoice is EVIDENCE that money is owed, not proof — pay the same money any
         other way (a fresh card payment, a link, in person) and the original invoice can
         sit open for good while the debt is long settled. Evidence must narrow the search,
         never end it. Now every test runs and the first one to clear it wins.
       · IDENTITY WAS THE CUSTOMER ID ALONE. A payment taken through a link, a fresh
         checkout or the card machine may carry no customer, or a different one. Now a
         person is matched on customer id, then email, then the card's own fingerprint —
         the same card is the same person whatever record Stripe filed it under.
       · THE AMOUNT HAD TO MATCH EXACTLY. I chose that deliberately and argued for it, and
         it is too strict for how people actually pay: they settle a bounced payment along
         with something else, or with a catch-up that covers more. A LATER payment of AT
         LEAST the failed amount, from the same person, now clears it — with a different
         reason recorded, so an over-eager clearance is visible rather than silent.

       Every test runs on data already fetched. Each surviving failure carries `why` — what
       is keeping it on screen — so the next time this is wrong it says so itself instead of
       waiting to be noticed. */
    const all = charges.data || [];
    const succeeded = all.filter((c) => c.status === "succeeded");
    /* v139: the window in which a payment reads as settling a failure is THE WHOLE WINDOW
       being looked at. It used to be a separate, shorter constant — 7 days, then 10 — and
       Jennifer Lawton's £143.10 failed on 29 August and was paid at 11:27 on 8 September,
       which is ten days and two hours. A cutoff that has to be guessed at is a cutoff that
       will be wrong; there is no reason for one inside a fortnight, because two payments
       from the same person at the same amount inside a fortnight are not a billing cycle,
       they are somebody sorting something out. */
    /* v244: …and then the window grew to sixty days for the chase ladder, and this had to
       come apart from it. Over sixty days, the same person paying the same amount again is
       exactly a billing cycle: September's failure would be "settled" by October's
       membership payment. So settling keeps its fortnight. Any payment at all after the
       failure is still reported (paidSince, below) — Ash's rule is that it stops the chase —
       it just does not take the debt off the card. */
    const RETRY_WINDOW = SETTLE_WINDOW_DAYS * 86400;


    /* v247: ONE PERSON, ACROSS RECORDS. Elaine Brook, 28 Sep: a declined £195 at 12:03 with
       NO customer record (card ••2608), another at 17:52 on customer record A (same card,
       her email), and £195 PAID at 19:01 on customer record B (a different card, ••9684,
       "E brook" on it, the same email). Each check compared two charges at a time and none
       linked 12:03 to 19:01 directly — so she showed as owing £195 she had paid that night.

       Now every charge in the window is joined into people first: two charges that share a
       customer record, an email (on the payment, its customer, or Ontraport's metadata) or a
       card are the same person, and so is anything joined to either — 12:03 → 17:52 by the
       card, 17:52 → 19:01 by the email. Every question below ("paid it again?", "paid
       anything since?", "one debt or two?") is then asked of the PERSON.

       A NAME NEVER JOINS RECORDS ON ITS OWN (Ash, v247: "names never join alone"). A gym has
       two Sarah Joneses; one's payment must never quietly stop a chase on the other's real
       debt — the same reason v139 stopped trusting an amount. Until v247 a full name alone
       did join records; it no longer does. */
    function strongKeys(ch) {
      const keys = [];
      const cObj = ch.customer && typeof ch.customer === "object" ? ch.customer : null;
      const cust = typeof ch.customer === "string" ? ch.customer : (cObj && cObj.id);
      if (cust) keys.push("c:" + cust);
      const bd = ch.billing_details || {};
      for (const e of [bd.email, ch.receipt_email, cObj && cObj.email, metaEmail(ch)]) {
        const v = String(e || "").trim().toLowerCase();
        if (v && !keys.includes("e:" + v)) keys.push("e:" + v);
      }
      const card = ch.payment_method_details && ch.payment_method_details.card;
      if (card && card.fingerprint) keys.push("f:" + card.fingerprint);
      return keys;
    }
    const subKeys = (sub) => {
      const c = sub.customer;
      const keys = [];
      const id = typeof c === "string" ? c : (c && c.id);
      if (id) keys.push("c:" + id);
      const email = String((c && typeof c === "object" && c.email) || "").trim().toLowerCase();
      if (email) keys.push("e:" + email);
      return keys;
    };
    // Join every record that shares a key (a small union-find: each key points at a
    // representative; one representative per person).
    const parent = new Map();
    const find = (k) => {
      let r = k;
      while (parent.get(r) !== r) r = parent.get(r);
      while (parent.get(k) !== r) { const n = parent.get(k); parent.set(k, r); k = n; }
      return r;
    };
    const join = (keys) => {
      for (const k of keys) if (!parent.has(k)) parent.set(k, k);
      for (let i = 1; i < keys.length; i++) {
        const a = find(keys[0]), b = find(keys[i]);
        if (a !== b) parent.set(b, a);
      }
    };
    for (const ch of all) join(strongKeys(ch));
    for (const sub of subRaw) join(subKeys(sub));
    const personOf = (keys) => (keys.length ? [find(keys[0])] : []);

    // Who a charge belongs to: [the person], or [] when it carries nothing to know them by.
    // Kept as a list so every caller below reads exactly as it did.
    const whoIs = (ch) => personOf(strongKeys(ch));

    // A PaymentIntent can hold several attempts. If any attempt on it succeeded, it is paid.
    const paidIntents = new Set(succeeded.map((c) => c.payment_intent).filter(Boolean));
    // Successful payments indexed under every identity they can be reached by.
    const paidBy = new Map();
    for (const c of succeeded) {
      for (const k of whoIs(c)) {
        if (!paidBy.has(k)) paidBy.set(k, []);
        paidBy.get(k).push(c);
      }
    }
    // A membership already listed as "stopped paying" says everything this row would.
    const pastDueKeys = new Set();
    for (const sub of subRaw) for (const k of personOf(subKeys(sub))) pastDueKeys.add(k);

    const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const dayLabel = (unix) => {
      const d = new Date(unix * 1000);
      return d.getUTCDate() + " " + MONTHS_SHORT[d.getUTCMonth()];
    };
    // Everything this person successfully paid AFTER this failure, inside the window.
    function paymentsAfter(ch) {
      const seen = new Set(), out = [];
      for (const k of whoIs(ch)) {
        for (const p of paidBy.get(k) || []) {
          if (seen.has(p.id)) continue;
          if (p.created <= ch.created || p.created - ch.created > RETRY_WINDOW) continue;
          seen.add(p.id);
          out.push(p);
        }
      }
      return out;
    }

    /* v244: the newest payment this person made after `afterUnix`, anywhere in the window,
       of any amount — or null. Ash: "as soon as they pay anything … stop suggesting chases".
       Deliberately looser than settling: it never clears a row, it only stops a chase. */
    function paidAnySince(keys, afterUnix) {
      let best = null;
      for (const k of keys) {
        for (const p of paidBy.get(k) || []) {
          if (p.created <= afterUnix) continue;
          if (!best || p.created > best.created) best = p;
        }
      }
      return best ? { at: iso(best.created), amount: pence(best.amount) } : null;
    }

    // Returns a short reason when the failure has been dealt with, or "" when it still needs him.
    function settledReason(ch) {
      // 1. THE INVOICE, when there is one and it has an answer. Paid means paid, however
      //    many attempts it took; void means it was cancelled, so there is nothing to chase.
      //    Anything else falls THROUGH to the tests below — it is not the last word.
      const inv = ch.invoice && typeof ch.invoice === "object" ? ch.invoice : null;
      if (inv) {
        if (inv.status === "paid" || inv.amount_remaining === 0) return "the invoice was paid";
        if (inv.status === "void") return "the invoice was cancelled";
      }
      // 2. Same PaymentIntent, later attempt succeeded.
      if (ch.payment_intent && paidIntents.has(ch.payment_intent)) return "it went through on a retry";
      // 3. They paid afterwards. Exact first, because it is the confident one and worth
      //    saying differently; then at least as much, which covers a catch-up or a payment
      //    that settled this along with something else.
      const after = paymentsAfter(ch);
      if (after.some((p) => p.amount === ch.amount)) return "they paid it again";
      if (after.some((p) => p.amount >= ch.amount)) return "they paid at least that much afterwards";
      // (v139 had a fourth rule here that cleared a failure when the SAME AMOUNT was paid
      //  afterwards by anybody, as long as that amount looked rare. Ash: "There are others
      //  who pay £143.10 though. You can't blindly assume from the amount they're all the
      //  same people." He is right, and rarity in a fortnight's data is far too thin a
      //  thread to hang a false all-clear on. It is gone. Identity AND amount, or nothing.)

      // 4. Already on the "stopped paying" list above. Still owed, but saying it twice
      //    turns one problem into two.
      if (whoIs(ch).some((k) => pastDueKeys.has(k))) return "shown under Stopped paying";
      return "";
    }

    // Why a failure is STILL on screen. Said out loud on the row, so a wrong call announces
    // itself rather than waiting to be spotted.
    function whyStillHere(ch) {
      const inv = ch.invoice && typeof ch.invoice === "object" ? ch.invoice : null;
      const after = paymentsAfter(ch);
      if (after.length) {
        return "They have paid since, but less than this — nothing covering it in full.";
      }
      if (inv && (inv.status === "open" || inv.status === "draft")) {
        return "The invoice behind this is still open in Stripe.";
      }
      if (inv && inv.status === "uncollectible") {
        return "Stripe has given up collecting this one.";
      }
      // v244: a payment beyond the settling fortnight is news, not a settlement — say so
      // rather than "nothing has come in", which would be untrue.
      if (paidAnySince(whoIs(ch), ch.created)) {
        return "They have paid something since, but nothing that settles this one.";
      }
      return "Nothing has come in from them since.";
    }

    /* ---------- one debt, not eight rows ----------
       v140. Ash sent his own Stripe list: nine rows for Jennifer Lawton, all £143.10, all
       the same email and the same card, Stripe retrying at 11:25 every other day from 23
       August until it went through on 8 September. Eight failures and one success — for
       ONE thing she owed. Listing eight rows is not eight problems, it is one problem
       shouted eight times, and it buries everything else on the card.

       So failures are grouped by (person, amount): the same person being charged the same
       figure is Stripe attempting the same collection. The group is judged on its newest
       attempt, and if that is settled the whole run disappears. What survives is one row
       that can say "tried 8 times since 23 Aug", which is worth more than any single
       attempt was. */
    const failedAll = all.filter((ch) => ch.status === "failed");
    // whoIs is ordered strongest-identity-first, so its head is the right thing to group on.
    const groupKey = (ch) => (whoIs(ch)[0] || ("x:" + ch.id)) + "|" + ch.amount;
    const groups = new Map();
    for (const ch of failedAll) {
      const k = groupKey(ch);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(ch);
    }

    const stillOwed = [], settled = [];
    for (const rows of groups.values()) {
      rows.sort((a, b) => b.created - a.created);   // newest attempt first
      const rep = rows[0];
      const reason = settledReason(rep);
      if (reason) settled.push({ rows, reason });
      else stillOwed.push(rows);
    }

    const failedRows = stillOwed
      .map((rows) => {
        const rep = rows[0];                       // the newest attempt speaks for the run
        const first = rows[rows.length - 1];
        return {
          ...shapeCharge(rep),
          why: whyStillHere(rep),
          attempts: rows.length,
          firstFailedAt: iso(first.created),
          // v244: for the chase ladder — when this debt started, and anything paid since
          overdueFrom: iso(first.created),
          paidSince: paidAnySince(whoIs(first), first.created),
        };
      })
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));

    // v244: past-due memberships, now that paidBy exists to ask "have they paid anything
    // since?". The period start stands for when it went overdue — it is when the invoice
    // that failed was raised.
    const subRows = subRaw
      .map((s) => {
        const row = shapeSubscription(s);
        return { ...row, overdueFrom: row.since, paidSince: paidAnySince(personOf(subKeys(s)), s.current_period_start || 0) };
      })
      .sort((a, b) => (a.since < b.since ? -1 : 1));

    const sum = (rows) => rows.reduce((t, r) => t + r.amount, 0);

    return {
      ok: true,
      configured: true,
      liveMode: !key.startsWith("sk_test") && !key.startsWith("rk_test"),
      fetchedAt: new Date().toISOString(),
      windowDays: FAILED_WINDOW_DAYS,
      disputes: disputeRows,
      pastDue: subRows,
      failed: failedRows,
      // What was checked and cleared. A page that silently drops rows is a page you stop
      // trusting, so it says how many it took off and why.
      // Counted as DEBTS, not attempts: "1 payment failed and has since been paid" is true
      // of Jennifer Lawton's run, and "8 payments" would not be.
      resolved: {
        count: settled.length,
        attempts: settled.reduce((t, g) => t + g.rows.length, 0),
        amount: settled.reduce((t, g) => t + (g.rows[0].amount || 0), 0),
        reasons: [...new Set(settled.map((g) => g.reason))].filter(Boolean),
      },
      totals: {
        count: disputeRows.length + subRows.length + failedRows.length,
        disputed: sum(disputeRows),
        pastDue: sum(subRows),
        failed: sum(failedRows),
      },
    };
  }
}
