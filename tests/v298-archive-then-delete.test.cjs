// v298: an archived project deletes itself after 30 days. Ash: "archive it and then if I do
// nothing with it for 30 days it deletes entirely ... I might need 30 days to change my mind."
// Projects share the store with the KPIs, plans and the quarterly reviews, so the rules that
// matter are: the clear-out removes ONLY proj-/projfile- keys, only projects archived 30 full
// days, never a file another project still uses, and a project archived before v298 (no date)
// gets its 30 days from now rather than going at once. Bringing it back stops the clock.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function fakeStore(seed) {
  const m = new Map(Object.entries(seed || {}));
  const gone = [];
  return {
    _m: m, _gone: gone,
    async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, v); },
    async delete(k) { gone.push(k); m.delete(k); },
    async list(o) { const p = (o && o.prefix) || ""; return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })) }; },
  };
}
const DAY = 86400000, NOW = Date.parse("2026-12-20T03:30:00.000Z");
const ago = (d) => new Date(NOW - d * DAY).toISOString();
const proj = (id, extra) => JSON.stringify(Object.assign({ id, name: id, columns: [], steps: [], canvas: [] }, extra));

const SEED = {
  "weeks": JSON.stringify([{ weekEnding: "2026-08-31", leads: 41 }]),
  "planning-2026-Q2": JSON.stringify({ goals: [{ id: "g1", title: "The Q2 review nobody may touch" }] }),
  "weekly-plan-2026-08-31": JSON.stringify({ tasks: [{ id: "t1" }] }),
  "fin-txns-2026-08": JSON.stringify({ rows: [{ amt: 143.1 }] }),
  "proj-live": proj("live", { steps: [{ id: "s", files: [{ id: "f_shared" }] }] }),
  "proj-old": proj("old", { archived: true, archivedAt: ago(30), steps: [{ id: "s", files: [{ id: "f_mine" }, { id: "f_shared" }] }],
    canvas: [{ id: "v", fileId: "f_scene", thumbId: "f_thumb" }] }),
  "proj-young": proj("young", { archived: true, archivedAt: ago(29.9) }),
  "proj-undated": proj("undated", { archived: true }),
  "proj-back": proj("back", { archived: false, archivedAt: "" }),
  "projfile-f_shared": "bytes", "projfile-f_mine": "bytes", "projfile-f_scene": "bytes", "projfile-f_thumb": "bytes",
  "projfile-f_orphan": "bytes",
};

(async () => {
  const src = read("netlify/lib/projects.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v298-"));
  fs.writeFileSync(path.join(dir, "projects.mjs"), src.replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => globalThis.__fs;"));
  const store = fakeStore(SEED);
  globalThis.__fs = store;
  const lib = await import("file://" + path.join(dir, "projects.mjs"));

  // the cleaner: archiving stamps the date, bringing back clears it, a real date is kept
  const c = (x) => lib.cleanProject(Object.assign({ id: "p_1", name: "x" }, x));
  assert.ok(/^\d{4}-/.test(c({ archived: true }).archivedAt), "archiving without a date starts the clock");
  assert.strictEqual(c({ archived: true, archivedAt: "2026-11-12T13:51:00.000Z" }).archivedAt, "2026-11-12T13:51:00.000Z", "a save keeps the date it was archived");
  assert.strictEqual(c({ archived: false, archivedAt: "2026-11-12T13:51:00.000Z" }).archivedAt, "", "bringing it back stops the clock");
  assert.ok(/^\d{4}-/.test(c({ archived: true, archivedAt: "rubbish" }).archivedAt), "a bad date is replaced, never trusted");

  const done = await lib.purgeArchived(NOW);
  assert.deepStrictEqual(done.removed, ["old"], "only the project archived 30 full days goes");
  assert.ok(!store._m.has("proj-old"));
  assert.ok(store._m.has("proj-young"), "29.9 days is not 30");
  assert.ok(store._m.has("proj-live") && store._m.has("proj-back"), "live and brought-back projects stay");
  assert.deepStrictEqual(done.stamped, ["undated"], "archived before v298: its 30 days start now");
  assert.strictEqual(JSON.parse(store._m.get("proj-undated")).archivedAt, new Date(NOW).toISOString());
  assert.ok(!store._m.has("projfile-f_mine") && !store._m.has("projfile-f_scene") && !store._m.has("projfile-f_thumb"), "its own files go with it");
  assert.ok(store._m.has("projfile-f_shared"), "a file another project still uses stays");
  assert.ok(store._m.has("projfile-f_orphan"), "files it never used are not its business");
  for (const k of ["weeks", "planning-2026-Q2", "weekly-plan-2026-08-31", "fin-txns-2026-08"]) {
    assert.strictEqual(store._m.get(k), SEED[k], k + " is byte-identical after the clear-out");
  }
  assert.ok(store._gone.every((k) => /^(proj-|projfile-)/.test(k)), "nothing outside the projects' own keys was deleted: " + store._gone);

  // running again changes nothing new: the undated one now has 30 days to go
  const again = await lib.purgeArchived(NOW + DAY);
  assert.deepStrictEqual(again.removed, ["young"], "and the next night the 29.9-day one goes");
  assert.ok(store._m.has("proj-undated"), "the newly dated one waits its 30 days");
  const later = await lib.purgeArchived(NOW + 30 * DAY);
  assert.deepStrictEqual(later.removed, ["undated"], "…and then goes");

  // wiring
  assert.ok(/\[functions\."projects-purge-scheduled"\]\s*\n\s*schedule = "30 3 \* \* \*"/.test(read("netlify.toml")), "it runs every night");
  assert.ok(/purgeArchived\(\)/.test(read("netlify/functions/projects-purge-scheduled.js")));
  const page = read("projects.html");
  assert.ok(/id="archProjBtn"/.test(page), "Archive sits on the project itself, not only inside Edit");
  assert.ok(/p\.archivedAt = p\.archived \? new Date\(\)\.toISOString\(\) : ""/.test(page), "the page carries the date, so a later save doesn't restart the clock");
  assert.ok(/deletes for good on ' \+ dLabel\(goneOn\(p\)\) \+ ' unless you bring it back', "Undo"/.test(page), "the confirmation says when, with Undo on it");
  assert.ok(/id="unarchProjBtn">Bring back/.test(page), "an archived project has Bring back on it");
  console.log("v298 archive then delete: OK");
})().catch((e) => { console.error(e); process.exit(1); });
