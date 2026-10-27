// v262 → v264: Banked Revenue and the bank.
//
// v262 laid what landed in the bank over `banked`. v264 takes that back — Ash: "charged
// revenue is what we made, and then banked revenue is what we made minus what we paid fees".
// The real fault was stale revenue boxes; once refilled from the takings pull, Charged
// agreed with the accountant. So `banked` stays the stored Charged - Fees, and the server
// adds `bankIn` (the Finances page's Money in) beside it as a check, never stored.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SRC = path.join(__dirname, "..", "netlify", "functions", "kpi-store.js");
function fakeStore(seed) {
  const m = new Map(Object.entries(seed || {}));
  return { _m: m,
    async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, v); },
    async list(o) { const p = (o && o.prefix) || ""; return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })), directories: [] }; } };
}
async function loadHandler() {
  const src = fs.readFileSync(SRC, "utf8").replace(/^import \{ getStore \} from "@netlify\/blobs";$/m,
    "const getStore = () => globalThis.__fakeStore;");
  const tmp = path.join(os.tmpdir(), "kpi-store-v262-" + process.pid + ".mjs");
  fs.writeFileSync(tmp, src);
  const mod = await import("file://" + tmp); fs.unlinkSync(tmp);
  return mod.default;
}
const GET = (h, qs) => h(new Request("https://x/.netlify/functions/kpi-store?" + qs));
const POST = (h, body) => h(new Request("https://x/.netlify/functions/kpi-store",
  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

const AUG_ROWS = [
  { id: "a", date: "2026-08-06", dir: "in", amount: 17000, desc: "STRIPE", cat: "" },
  { id: "b", date: "2026-08-09", dir: "in", amount: 150, desc: "TRANSFER FROM OWN", cat: "Transfer" },
  { id: "c", date: "2026-08-10", dir: "in", amount: 1000, desc: "CARD LOAN", cat: "Directors loan" },
  { id: "d", date: "2026-08-11", dir: "in", amount: 999, desc: "DELETED", cat: "", del: true },
  { id: "e", date: "2026-08-26", dir: "in", amount: 1548, desc: "GC C1", cat: "" },
  { id: "f", date: "2026-08-27", dir: "out", amount: 500, desc: "RENT", cat: "Rent" },
];
const SEED = () => ({
  "months": JSON.stringify([
    { ym: "2025-06", charged: 18000, processingFees: 300, banked: 17700 },
    { ym: "2026-08", charged: 20334.96, processingFees: 353, banked: 19981.96, leads: 132 },
  ]),
  "finance-txns-2026-08": JSON.stringify({ ym: "2026-08", rows: AUG_ROWS }),
});

(async () => {
  console.log("v264 banked and the bank:");
  let pass = 0; const ok = async (n, f) => { await f(); pass++; console.log("  ok " + n); };

  await ok("a month with a statement gets bankIn beside an untouched banked", async () => {
    globalThis.__fakeStore = fakeStore(SEED());
    const h = await loadHandler();
    const { months } = await (await GET(h, "monthly=1")).json();
    const aug = months.find((m) => m.ym === "2026-08");
    assert.strictEqual(aug.bankIn, 18548, "Stripe + GC; transfer, loan and deleted left out; money out ignored");
    assert.strictEqual(aug.banked, 19981.96, "banked is Charged - Fees, not overwritten");
    assert.strictEqual(aug.leads, 132, "nothing else on the record moves");
  });

  await ok("a month with no statement keeps its stored figure — the quarterly history is untouched", async () => {
    globalThis.__fakeStore = fakeStore(SEED());
    const h = await loadHandler();
    const { months } = await (await GET(h, "monthly=1")).json();
    const old = months.find((m) => m.ym === "2025-06");
    assert.strictEqual(old.banked, 17700);
    assert.ok(!("bankIn" in old));
  });

  await ok("reading never writes, and a save never stores the worked-out figures", async () => {
    const st = fakeStore(SEED()); globalThis.__fakeStore = st;
    const h = await loadHandler();
    const before = st._m.get("months");
    await GET(h, "monthly=1");
    assert.strictEqual(st._m.get("months"), before, "a GET leaves the record byte-identical");
    const res = await (await POST(h, { month: { ym: "2026-08", leads: 133, bankIn: 1, salesAfterFees: 2 } })).json();
    const stored = JSON.parse(st._m.get("months")).find((m) => m.ym === "2026-08");
    assert.ok(!("bankIn" in stored) && !("salesAfterFees" in stored));
    assert.strictEqual(stored.banked, 19981.96, "the stored sales figure is not overwritten by a save");
    assert.strictEqual(res.months.find((m) => m.ym === "2026-08").bankIn, 18548, "the reply carries the bank figure too");
  });

  console.log(pass + " passed");
})().catch((e) => { console.error(e); process.exit(1); });
