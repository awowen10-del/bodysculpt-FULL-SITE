// v272: the read-only test connector for the Grok app.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const FN = fs.readFileSync(path.join(root, "netlify/functions/grok-connector.js"), "utf8");

(async () => {
  const { handleRpc, projectsText, TOOLS } = await import(path.join(root, "netlify/lib/grok-connector.js"));
  const projects = [
    { name: "Shred", status: "active", steps: [
      { title: "Done one", done: true }, { title: "Later job", due: "2026-11-09" }, { title: "Huddle", due: "2026-11-06" },
      { title: "Gone", due: "2026-11-01", del: true }] },
    { name: "Late one", status: "paused", steps: [{ title: "Old job", due: "2026-10-30", notes: "PRIVATE NOTE" }] },
    { name: "No days", status: "planned", steps: [{ title: "First job" }] },
    { name: "Empty", status: "active", steps: [] },
    { name: "Archived", status: "active", archived: true, steps: [] },
    { name: "Finished", status: "done", steps: [] },
  ];
  const text = projectsText(projects, "2026-11-04");
  assert.ok(text.includes("Shred (Running). 1 of 3 steps done. next: Huddle on 2026-11-06"), text);
  assert.ok(text.includes("Late one (Parked). 0 of 1 steps done. 1 late. next: Old job on 2026-10-30"), text);
  assert.ok(text.includes("next: First job, no day yet"), text);
  assert.ok(!text.includes("Archived") && !text.includes("Finished"), "only live projects");
  assert.ok(!text.includes("PRIVATE NOTE"), "notes stay out");

  const rpc = (method, params, id = 1) => handleRpc({ jsonrpc: "2.0", id, method, params }, projects, "2026-11-04");
  assert.strictEqual(rpc("initialize", { protocolVersion: "2025-03-26" }).result.protocolVersion, "2025-03-26");
  assert.deepStrictEqual(rpc("initialize", {}).result.capabilities, { tools: {} });
  assert.strictEqual(rpc("tools/list").result.tools.length, 1, "one tool");
  assert.ok(TOOLS.every((t) => t.annotations.readOnlyHint), "and it only reads");
  assert.ok(rpc("tools/call", { name: "get_my_projects" }).result.content[0].text.includes("Shred"));
  assert.strictEqual(rpc("tools/call", { name: "delete_everything" }).error.code, -32602, "nothing else can be called");
  assert.strictEqual(rpc("nope").error.code, -32601);
  assert.strictEqual(handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, [], ""), null, "a notification gets no reply");
  assert.strictEqual(handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_my_projects" } }, null, "").result.isError, true, "a failed read says so");

  assert.ok(/want\.length >= 32/.test(FN), "with no real key it stays off");
  assert.ok(/timingSafeEqual/.test(FN));
  assert.ok(!/\.setJSON|\.set\(|writeProject/.test(FN), "this function writes nothing");
  console.log("v272-grok-connector.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
