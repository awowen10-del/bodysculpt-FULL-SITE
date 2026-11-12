// v299: the nightly copy. The audit of 12 Nov 2026 found that every record existed exactly
// once. This proves the copy (a) takes every record of every working store, (b) never writes
// to or deletes from a working store, (c) copies uploaded files once, (d) keeps 30 days and
// prunes only its own dated folders, and (e) is a no-op the second time in a day.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function fakeStore(seed) {
  const m = new Map(Object.entries(seed || {}));
  const log = { set: [], del: [] };
  const buf = (v) => (typeof v === "string" ? new TextEncoder().encode(v).buffer : v);
  const txt = (v) => (typeof v === "string" ? v : new TextDecoder().decode(v));
  return {
    _m: m, _log: log,
    async get(k, o) { const v = m.get(k); if (v === undefined) return null; const t = txt(v); return (o && o.type === "json") ? JSON.parse(t) : t; },
    async getWithMetadata(k) { const v = m.get(k); if (v === undefined) return null; return { data: buf(v), metadata: { ct: "x" } }; },
    async set(k, v) { log.set.push(k); m.set(k, v); },
    async delete(k) { log.del.push(k); m.delete(k); },
    async list(o) { const p = (o && o.prefix) || ""; return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })) }; },
  };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v299-"));
  fs.writeFileSync(path.join(dir, "backup.mjs"), read("netlify/lib/backup.js").replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = (o) => globalThis.__stores[o.name];"));
  const kpi = fakeStore({
    "weeks": JSON.stringify([{ weekEnding: "2026-11-07", leads: 12 }]),
    "planning-2026-Q2": JSON.stringify({ goals: [{ title: "the review" }] }),
    "weekly-plan-2026-11-09": JSON.stringify({ projectItems: [{ id: "a" }] }),
    "fin-txns-2026-10": JSON.stringify({ rows: [{ amt: 1 }] }),
    "proj-one": JSON.stringify({ id: "one" }),
    "projfile-f1": "file bytes",
    "ig-cache-mine": "a cache, not worth copying",
  });
  const cal = fakeStore({ plan: JSON.stringify({ items: [] }) });
  const mail = fakeStore({ "chase-state": "{}" });
  const tak = fakeStore({});
  const bak = fakeStore({});
  globalThis.__stores = { "bodysculpt-kpi": kpi, "bodysculpt-mktcal": cal, "bodysculpt-mail": mail, "bodysculpt-takings": tak, "bodysculpt-backup": bak };
  const lib = await import("file://" + path.join(dir, "backup.mjs"));
  const before = JSON.stringify([...kpi._m.entries()]);

  const NOW = Date.parse("2026-11-13T02:45:00.000Z");
  const r = await lib.runBackup(NOW);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.day, "2026-11-13");
  assert.strictEqual(r.stores["bodysculpt-kpi"], 5, "five records, not the file and not the cache");
  assert.strictEqual(r.files, 1);
  assert.strictEqual(r.skipped, 1);
  const got = async (k) => bak.get(k);
  assert.strictEqual(await got("d/2026-11-13/bodysculpt-kpi/planning-2026-Q2"), kpi._m.get("planning-2026-Q2"), "the quarterly review is copied byte for byte");
  assert.strictEqual(await got("d/2026-11-13/bodysculpt-kpi/weeks"), kpi._m.get("weeks"));
  assert.strictEqual(await got("d/2026-11-13/bodysculpt-mktcal/plan"), cal._m.get("plan"));
  assert.strictEqual(await got("files/bodysculpt-kpi/projfile-f1"), "file bytes");
  assert.ok(!bak._m.has("d/2026-11-13/bodysculpt-kpi/ig-cache-mine"));

  // the working stores are never written to or deleted from
  for (const s of [kpi, cal, mail, tak]) { assert.deepStrictEqual(s._log.set, [], "no write to a working store"); assert.deepStrictEqual(s._log.del, [], "no delete from a working store"); }
  assert.strictEqual(JSON.stringify([...kpi._m.entries()]), before);

  // a second run the same day does nothing
  const sets = bak._log.set.length;
  const again = await lib.runBackup(NOW + 3600000);
  assert.strictEqual(again.already, true);
  assert.strictEqual(bak._log.set.length, sets, "no second copy in one day");

  // the next night: the file is not copied again; a changed record is
  kpi._m.set("weeks", JSON.stringify([{ weekEnding: "2026-11-07", leads: 12 }, { weekEnding: "2026-11-14", leads: 9 }]));
  const r2 = await lib.runBackup(NOW + 86400000);
  assert.strictEqual(r2.files, 0, "a file is copied once");
  assert.notStrictEqual(await got("d/2026-11-14/bodysculpt-kpi/weeks"), await got("d/2026-11-13/bodysculpt-kpi/weeks"));

  // 31 days on, the first night is pruned; the files and anything else are not
  const r3 = await lib.runBackup(NOW + 31 * 86400000);
  assert.ok(r3.pruned > 0);
  assert.ok(!bak._m.has("d/2026-11-13/bodysculpt-kpi/weeks"), "older than 30 days goes");
  assert.ok(bak._m.has("d/2026-11-14/bodysculpt-kpi/weeks"), "30 days old is kept");
  assert.ok(bak._m.has("files/bodysculpt-kpi/projfile-f1"));
  assert.ok(bak._log.del.every((k) => /^d\/\d{4}-\d{2}-\d{2}\//.test(k)), "the only deletes are dated backup folders");

  // keepPrevious: the copy before an overwrite, capped
  for (let i = 0; i < lib.KEEP_PREVIOUS + 3; i++) await lib.keepPrevious("bodysculpt-kpi", "planning-2026-Q3", JSON.stringify({ v: i }), NOW + i * 1000);
  const prev = [...bak._m.keys()].filter((k) => k.startsWith("prev/bodysculpt-kpi/planning-2026-Q3/")).sort();
  assert.strictEqual(prev.length, lib.KEEP_PREVIOUS);
  assert.strictEqual(JSON.parse(await got(prev[prev.length - 1])).v, lib.KEEP_PREVIOUS + 2, "the newest is kept");
  assert.strictEqual(await lib.keepPrevious("bodysculpt-kpi", "x", null), false, "nothing to keep when there was nothing there");

  // reading back
  const days = await lib.listBackups();
  assert.ok(days.length >= 2 && days[0].day > days[1].day, "newest first");
  assert.strictEqual(await lib.readBackup("2026-11-14", "bodysculpt-kpi", "planning-2026-Q2"), kpi._m.get("planning-2026-Q2"));
  assert.strictEqual(await lib.readBackup("2026-11-14", "some-other-store", "x"), null);
  assert.strictEqual(await lib.readBackup("2026-11-14", "bodysculpt-kpi", "../x"), null);
  assert.ok((await lib.listDay("2026-11-14", "bodysculpt-kpi")).includes("weeks"));

  // wiring
  assert.ok(/\[functions\."store-backup-scheduled"\]\s*\n\s*schedule = "45 2 \* \* \*"/.test(read("netlify.toml")), "scheduled before the 03:30 clear-out");
  const viewer = read("netlify/functions/store-backup.js");
  assert.ok(!/\.set\(|\.delete\(/.test(viewer) && /req\.method !== "GET"/.test(viewer), "the viewer is read only");
  console.log("v299-nightly-backup.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
