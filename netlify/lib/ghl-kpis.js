// netlify/lib/ghl-kpis.js  (v256)
//
// The two weekly KPIs that now live in GoHighLevel, read straight from it so the Weekly KPIs
// entry form can fill them instead of Ash counting tags by hand:
//
//   Leads        = new GHL contacts that came in as 6 Week Challenge leads that week:
//                  tagged `6wc opt-in`, OR source "Facebook Lead" (the Exit workflow takes
//                  `6wc opt-in` off when someone signs up, so the source keeps them counted)
//   Trial Sales  = first successful payment for the 6 Week Challenge that week, from GHL's
//                  live transactions. The pay-in-two plan's second £99 is the same sale, so a
//                  subscription only counts in the week of its first payment.
//
// Rules Ash agreed (2026-10-26), mid-move from Ontraport:
//   - Weeks run Sunday to Saturday, UK time.
//   - Members, cancellations, paused and trialists stay on Ontraport until billing moves.
//   - The old Ontraport website form still makes a few leads; those are NOT in here.
//
// Read-only. Every call below is a read (contact search is a POST, but it only searches).
// Nothing here writes to GHL or to the KPI store — the page saves the week after Ash looks.

const BASE = "https://services.leadconnectorhq.com";

// Test contacts that must never count. Ash's own contact re-enters the 6WC funnel whenever he
// tests the lead form.
const EXCLUDE_IDS = new Set(["pNBWl8D7hJcgLUSMBlrs"]);
const EXCLUDE_TAGS = new Set(["ai test"]);

// The two live 6WC payment links (pay in full £195, pay in two 2 × £99). A payment also counts
// if its name says 6 week, in case a new link is made later.
const SIX_WC_LINKS = new Set(["6ada3d73ef1f4f0eb024e550", "6ada3dd4caf20c1f8ff2b49e"]);
const SIX_WC_NAME = /6[\s-]*week/i;

/* ---------- the week, in UK time ---------- */
function londonOffsetMs(utcMs) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const wall = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return wall - utcMs;
}
function londonMidnight(y, m0, d) {
  const guess = Date.UTC(y, m0, d, 0, 0, 0);
  return guess - londonOffsetMs(guess);
}
// "2026-10-24" (a Saturday) -> Sunday 00:00 to the following Sunday 00:00, UK time.
export function weekBounds(weekEnding) {
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(weekEnding || ""));
  if (!mt) return null;
  const y = Number(mt[1]), m0 = Number(mt[2]) - 1, d = Number(mt[3]);
  const sat = new Date(Date.UTC(y, m0, d));
  if (sat.getUTCMonth() !== m0 || sat.getUTCDate() !== d || sat.getUTCDay() !== 6) return null;
  const startMs = londonMidnight(y, m0, d - 6);
  const endMs = londonMidnight(y, m0, d + 1);   // exclusive
  return { weekEnding, startMs, endMs };
}
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const nameOf = (c) => [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || c.email || "Unnamed";

/* ---------- GHL ---------- */
function client(env, fetchImpl) {
  const key = env.GHL_API_KEY, loc = env.GHL_LOCATION_ID;
  if (!key || !loc) return null;
  const headers = {
    Authorization: `Bearer ${key}`,
    Version: env.GHL_API_VERSION || "2021-07-28",
    Accept: "application/json",
    // Cloudflare in front of GHL turns away requests with no browser-like user agent.
    "User-Agent": "Mozilla/5.0 (bodysculpt-dashboard)",
  };
  const call = async (method, path, { query, body } = {}) => {
    const url = new URL(path, BASE);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
    const res = await fetchImpl(url, {
      method, headers: body ? { ...headers, "Content-Type": "application/json" } : headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`GHL ${res.status} on ${path}`);
    return res.json();
  };
  return { loc, call };
}

async function searchAll(ghl, filters) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const r = await ghl.call("POST", "/contacts/search", {
      body: { locationId: ghl.loc, page, pageLimit: 100, filters },
    });
    const batch = r.contacts || [];
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

export async function readLeads(ghl, wk) {
  const range = { field: "dateAdded", operator: "range",
    value: { gte: new Date(wk.startMs).toISOString(), lt: new Date(wk.endMs).toISOString() } };
  const [tagged, fromFb] = await Promise.all([
    searchAll(ghl, [{ field: "tags", operator: "eq", value: "6wc opt-in" }, range]),
    searchAll(ghl, [{ field: "source", operator: "eq", value: "Facebook Lead" }, range]),
  ]);
  const seen = new Map();
  for (const c of [...tagged, ...fromFb]) {
    if (!c || !c.id || seen.has(c.id) || EXCLUDE_IDS.has(c.id)) continue;
    if ((c.tags || []).some((t) => EXCLUDE_TAGS.has(String(t).toLowerCase()))) continue;
    // the search's date filter is trusted, but checked again so a loose API never inflates it
    const added = Date.parse(c.dateAdded);
    if (!(added >= wk.startMs && added < wk.endMs)) continue;
    seen.set(c.id, { id: c.id, name: nameOf(c), added: c.dateAdded });
  }
  const people = [...seen.values()].sort((a, b) => (a.added < b.added ? -1 : 1));
  return { count: people.length, people };
}

export function isSixWeek(t) {
  if (SIX_WC_LINKS.has(t.entitySourceId)) return true;
  const desc = t.chargeSnapshot && t.chargeSnapshot.description;
  return SIX_WC_NAME.test(String(t.entitySourceName || "")) || SIX_WC_NAME.test(String(desc || ""));
}

export async function readSales(ghl, wk) {
  // Look back 45 days before the week so a pay-in-two second payment can see its first one.
  const from = isoDay(wk.startMs - 45 * 864e5), to = isoDay(wk.endMs + 864e5);
  const all = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const r = await ghl.call("GET", "/payments/transactions", { query: {
      altId: ghl.loc, altType: "location", paymentMode: "live", startAt: from, endAt: to, limit: 100, offset,
    } });
    const batch = r.data || [];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  const paid = all
    .filter((t) => t.status === "succeeded" && isSixWeek(t))
    .filter((t) => !(Number(t.amountRefunded) >= Number(t.amount)))
    .filter((t) => !EXCLUDE_IDS.has(t.contactId))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const firstOfSub = new Set();
  const people = [];
  for (const t of paid) {
    if (t.subscriptionId) {
      if (firstOfSub.has(t.subscriptionId)) continue;   // the second £99 of pay-in-two
      firstOfSub.add(t.subscriptionId);
    }
    const at = Date.parse(t.createdAt);
    if (!(at >= wk.startMs && at < wk.endMs)) continue;
    people.push({ id: t.contactId, name: t.contactName || t.contactEmail || "Unnamed",
      amount: Number(t.amount) || 0, plan: t.subscriptionId ? "pay in two" : "pay in full", paid: t.createdAt });
  }
  return { count: people.length, people };
}

// The page's one call. Failure is a sentence, never a throw, like takings and stripe-feed.
export async function pullWeek(weekEnding, env, fetchImpl = fetch) {
  const wk = weekBounds(weekEnding);
  if (!wk) return { ok: false, error: "Week ending must be a real Saturday (YYYY-MM-DD)." };
  const ghl = client(env, fetchImpl);
  if (!ghl) return { ok: false, error: "GHL isn't connected (GHL_API_KEY / GHL_LOCATION_ID not set)." };
  const [leads, sales] = await Promise.all([readLeads(ghl, wk), readSales(ghl, wk)]);
  return { ok: true, weekEnding, leads, sales, pulledAt: new Date().toISOString() };
}
