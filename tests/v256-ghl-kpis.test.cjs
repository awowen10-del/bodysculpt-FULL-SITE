// v256 — 6WC leads and sales read from GoHighLevel for the Weekly KPIs form.
//
// Ash: "make the Weekly KPIs page pull leads and 6WC sales from GHL automatically."
// Mid-move from Ontraport: leads and trial sales now land in GHL; members, cancellations,
// paused and trialists stay on Ontraport.
//
// Pinned here:
//   1. THE WEEK is Sunday to Saturday, UK time — BST and GMT both.
//   2. LEADS = `6wc opt-in` OR source "Facebook Lead", once each, test contacts left out.
//   3. SALES = first 6WC payment per subscription; pay-in-two's second £99 is not a new sale.
//   4. THE PAGE fills, never saves, and derive() prefers GHL's leads.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

(async () => {
  const L = await import(path.join(ROOT, "netlify/lib/ghl-kpis.js"));

  // 1. THE WEEK
  const bst = L.weekBounds("2026-10-24");          // Sun 18 Oct BST .. Sun 25 Oct (clocks go back that day)
  assert.strictEqual(new Date(bst.startMs).toISOString(), "2026-10-17T23:00:00.000Z");
  assert.strictEqual(new Date(bst.endMs).toISOString(), "2026-10-24T23:00:00.000Z");
  const gmt = L.weekBounds("2026-10-31");
  // midnight starting Sun 25 Oct is still BST — the clocks only go back at 2am
  assert.strictEqual(new Date(gmt.startMs).toISOString(), "2026-10-24T23:00:00.000Z");
  assert.strictEqual(new Date(gmt.endMs).toISOString(), "2026-11-01T00:00:00.000Z");
  assert.strictEqual(L.weekBounds("2026-10-25"), null, "a Sunday is not a week ending");
  assert.strictEqual(L.weekBounds("nope"), null);

  // a fake GHL
  const contacts = {
    tag: [
      { id: "a", firstName: "Kim", lastName: "P", dateAdded: "2026-10-26T10:00:00Z", tags: ["6wc opt-in"] },
      { id: "pNBWl8D7hJcgLUSMBlrs", firstName: "Ashley", dateAdded: "2026-10-26T10:00:00Z", tags: ["6wc opt-in"] },
      { id: "t", firstName: "Tester", dateAdded: "2026-10-26T10:00:00Z", tags: ["6wc opt-in", "ai test"] },
    ],
    fb: [
      { id: "a", firstName: "Kim", lastName: "P", dateAdded: "2026-10-26T10:00:00Z", tags: ["6wc opt-in"] },
      // signed up, so the Exit workflow took `6wc opt-in` off — still a lead
      { id: "b", firstName: "Sam", dateAdded: "2026-10-27T10:00:00Z", tags: ["6wc signed up"] },
      { id: "old", firstName: "Old", dateAdded: "2026-10-20T10:00:00Z", tags: [] },   // outside the week
    ],
  };
  const tx = [
    { status: "succeeded", entitySourceId: "6ada3d73ef1f4f0eb024e550", contactName: "Full Payer", amount: 195, createdAt: "2026-10-26T09:00:00Z" },
    // pay in two: first £99 in September, second in this week — not a new sale
    { status: "succeeded", entitySourceName: "New Link", chargeSnapshot: { description: "6 Week Challenge (pay in two)" }, subscriptionId: "sub_1", contactName: "Old Split", amount: 99, createdAt: "2026-09-27T09:00:00Z" },
    { status: "succeeded", entitySourceName: "New Link", chargeSnapshot: { description: "6 Week Challenge (pay in two)" }, subscriptionId: "sub_1", contactName: "Old Split", amount: 99, createdAt: "2026-10-27T09:00:00Z" },
    // pay in two starting this week — a sale
    { status: "succeeded", entitySourceId: "6ada3dd4caf20c1f8ff2b49e", subscriptionId: "sub_2", contactName: "New Split", amount: 99, createdAt: "2026-10-28T09:00:00Z" },
    { status: "failed", entitySourceId: "6ada3d73ef1f4f0eb024e550", contactName: "Declined", amount: 195, createdAt: "2026-10-28T09:00:00Z" },
    { status: "succeeded", entitySourceId: "6ada3d73ef1f4f0eb024e550", contactName: "Refunded", amount: 195, amountRefunded: 195, createdAt: "2026-10-28T09:00:00Z" },
    { status: "succeeded", entitySourceName: "Christmas Shred", contactName: "Not 6WC", amount: 50, createdAt: "2026-10-28T09:00:00Z" },
  ];
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url: String(url), method: opts.method, headers: opts.headers });
    let body;
    if (String(url).includes("/contacts/search")) {
      const f = JSON.parse(opts.body).filters;
      body = { contacts: f.some((x) => x.field === "tags") ? contacts.tag : contacts.fb };
    } else body = { data: tx };
    return { ok: true, json: async () => body };
  };
  const env = { GHL_API_KEY: "k", GHL_LOCATION_ID: "loc" };
  const r = await L.pullWeek("2026-10-31", env, fakeFetch);
  assert.ok(r.ok, r.error);

  // 2. LEADS
  assert.deepStrictEqual(r.leads.people.map((p) => p.id), ["a", "b"]);
  assert.strictEqual(r.leads.count, 2);

  // 3. SALES
  assert.deepStrictEqual(r.sales.people.map((p) => p.name), ["Full Payer", "New Split"]);
  assert.strictEqual(r.sales.people[1].plan, "pay in two");
  assert.ok(calls.every((c) => c.method === "GET" || c.url.includes("/contacts/search")), "read-only");
  assert.ok(calls.every((c) => /Mozilla/.test(c.headers["User-Agent"])), "Cloudflare needs a user agent");
  assert.ok(calls.some((c) => c.url.includes("startAt=2026-09-09")), "looks back far enough for pay-in-two");

  // not connected / bad week -> a sentence, not a throw
  assert.strictEqual((await L.pullWeek("2026-10-31", {}, fakeFetch)).ok, false);
  assert.strictEqual((await L.pullWeek("2026-10-30", env, fakeFetch)).ok, false);

  // 4. THE PAGE
  const html = read("index.html");
  assert.ok(html.includes('id="ghlBox"') && html.includes('id="e_ghlLeads"'));
  assert.ok(/loadGhlForEntry\(document\.getElementById\('e_weekEnding'\)\.value\)/.test(html), "reads GHL when the form opens");
  assert.ok(html.includes("loadGhlForEntry(iso)"), "reads GHL again when the week changes");
  assert.ok(html.includes("ghlLeads:num('e_ghlLeads')"), "GHL leads save with the week");
  assert.ok(/week\.ghlLeads==='number'[\s\S]{0,140}\? week\.ghlLeads\+\(Number\(week\.ontraportLeads\)\|\|0\)/.test(html), "derive prefers GHL leads");
  const fn = html.slice(html.indexOf("async function loadGhlForEntry"), html.indexOf("function lastRecurring()"));
  assert.ok(!/Store\.save|kpi-store/.test(fn), "the GHL read never saves");
  assert.ok(/if\(ts\.value===''\)\{ ts\.value=sales; \}/.test(fn), "only fills an empty Trial Sales box");
  assert.ok(read("netlify/functions/ghl-kpis.js").includes("pullWeek"));

  console.log("v256 GHL KPIs: ok");
})().catch((e) => { console.error(e); process.exit(1); });
