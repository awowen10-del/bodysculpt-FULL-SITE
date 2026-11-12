// v299: a Projects tab left open used to save its old copy of a whole project over steps
// ticked, added or re-dated from Weekly, Daily, the calendar or Grok. The page now sends the
// version it loaded and the function refuses a save based on an older one.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function fakeStore() {
  const m = new Map();
  return { _m: m,
    async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
    async getWithMetadata() { return null; },
    async set(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
    async list(o) { const p = (o && o.prefix) || ""; return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })) }; } };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v299p-"));
  fs.mkdirSync(path.join(dir, "lib")); fs.mkdirSync(path.join(dir, "functions"));
  fs.writeFileSync(path.join(dir, "lib", "projects.js"), read("netlify/lib/projects.js").replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => globalThis.__ps;"));
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, "functions", "projects.js"), read("netlify/functions/projects.js"));
  globalThis.__ps = fakeStore();
  const handler = (await import("file://" + path.join(dir, "functions", "projects.js"))).default;
  const POST = async (body) => { const r = await handler(new Request("https://x/.netlify/functions/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() }; };
  const step = (id, title) => ({ id, title, col: "todo", done: false });
  const P = { id: "p_one", name: "Launch", columns: [{ id: "todo", name: "To do" }, { id: "done", name: "Done", done: true }], steps: [step("a", "A"), step("b", "B")], canvas: [] };

  // create: nothing stored, base ""
  let r = await POST({ project: P, base: "" });
  assert.strictEqual(r.status, 200);
  const v1 = r.j.project.lastUpdated;
  await sleep(5);
  // Weekly ticks step A through the narrow door (no base)
  r = await POST({ stepLink: { projectId: "p_one", stepId: "a", done: true } });
  assert.strictEqual(r.status, 200);
  await sleep(5);
  // the stale Projects tab saves its old whole copy: refused, and the tick survives
  r = await POST({ project: Object.assign({}, P, { steps: [step("a", "A"), step("b", "B renamed")] }), base: v1 });
  assert.strictEqual(r.status, 409, "a whole-project save based on an older copy is refused");
  assert.strictEqual(r.j.conflict, true);
  const stored = JSON.parse(globalThis.__ps._m.get("proj-p_one"));
  assert.strictEqual(stored.steps.find((s) => s.id === "a").done, true, "the tick made on Weekly is still there");
  assert.strictEqual(stored.steps.find((s) => s.id === "b").title, "B");
  // with the current version it saves
  r = await POST({ project: Object.assign({}, stored, { name: "Launch 2" }), base: stored.lastUpdated });
  assert.strictEqual(r.status, 200);
  // a caller that sends no base (Monthly, the calendar's "new project") behaves as before
  r = await POST({ project: Object.assign({}, stored, { name: "Launch 3" }) });
  assert.strictEqual(r.status, 200);
  // a back-dated archive date is ignored: the server stamps it
  r = await POST({ project: Object.assign({}, stored, { archived: true, archivedAt: "2020-01-01T00:00:00.000Z" }) });
  assert.ok(Date.now() - Date.parse(r.j.project.archivedAt) < 60000, "the archive date is now, not the one sent");

  // the page
  const PAGE = read("projects.html");
  assert.ok(/await post\(\{ project: p, base: BASE\[p\.id\] \|\| "" \}\)/.test(PAGE), "every whole-project save carries its base");
  assert.ok(/JSON\.stringify\(\{ project: p, base: BASE\[p\.id\] \|\| "" \}\)/.test(PAGE), "including the one sent as the page closes");
  assert.ok(/S\.projects\.forEach\(noteBase\)/.test(PAGE), "the version is noted when the list loads");
  assert.ok(/if \(e && e\.conflict\) \{ setSaveState\("bad", "changed somewhere else"\); staleReload\(\); return; \}/.test(PAGE), "a refused save loads the latest instead of retrying for ever");
  assert.ok(/else refreshIfStale\(\)/.test(PAGE), "coming back to the tab checks for changes made elsewhere");
  console.log("v299-projects-stale.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
