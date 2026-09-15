// v170 — Scheduling.
//
// Ash: "I want you to do the exact same for 'schedule'. The ability to be able to pull
// videos in from Google Drive and schedule it is incredible, I want that in my system. It
// can sit under 'Social' with Content / Facebook Ad Performance / Scheduling."
//
// The content-dashboard template's publishing queue, rebuilt on this site's own store and
// functions: a Drive folder is the inbox; each video becomes a card; Gemini transcribes
// it; Claude writes the caption in Ash's voice; Zernio posts it. The slow work runs in two
// BACKGROUND functions so a long video cannot time out a request. The queue is one blob
// key, patched one item at a time against a fresh read.
//
// What is run here: the queue function against a fake store, a fake Drive and a fake
// Zernio (scan adds each file once; update/skip/restore/remove/cancel; the quarter-hour
// "posted" rule; the transcript only on request). What is pinned: the page talks to three
// fixed addresses; typed text is saved on blur; the rail; the setup doc.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const SCHED = read("schedule.html");
const scriptOf = (src) => src.slice(src.lastIndexOf("<script>") + 8, src.lastIndexOf("</script>"));
const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));
const FILES = ["index.html", "monthly.html", "quarterly.html", "finances.html", "daily.html", "social.html", "ads.html", "schedule.html"];

function fakeStore(seed) {
  const m = new Map(Object.entries(seed || {}));
  return { _m: m, async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; }, async set(k, v) { m.set(k, v); } };
}
// the lib imports the blob store and the Anthropic SDK; both are swapped for the run
async function loadQueueFunction() {
  const tmpDir = path.join(os.tmpdir(), "sched-v170-" + process.pid);
  fs.mkdirSync(path.join(tmpDir, "lib"), { recursive: true }); fs.mkdirSync(path.join(tmpDir, "functions"), { recursive: true });
  const lib = read("netlify/lib/schedule.js")
    .replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => globalThis.__fakeStore;")
    .replace(/^import Anthropic from "@anthropic-ai\/sdk";$/m, "const Anthropic = globalThis.__FakeAnthropic;");
  fs.writeFileSync(path.join(tmpDir, "lib", "schedule.js"), lib);
  fs.writeFileSync(path.join(tmpDir, "functions", "schedule-queue.js"), read("netlify/functions/schedule-queue.js"));
  const mod = await import("file://" + path.join(tmpDir, "functions", "schedule-queue.js"));
  const libMod = await import("file://" + path.join(tmpDir, "lib", "schedule.js"));
  return { handler: mod.default, lib: libMod, tmpDir };
}
const GET = (h, qs) => h(new Request("https://x/.netlify/functions/schedule-queue" + (qs ? "?" + qs : "")));
const POST = (h, body) => h(new Request("https://x/.netlify/functions/schedule-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

(async () => {
  /* ================= 0. the stamp ================= */
  const text = "build v171 · the-reel-that-ate-the-page";
  for (const f of ["monthly.html", "index.html", "finances.html", "daily.html", "social.html", "ads.html", "schedule.html"]) {
    assert.ok(read(f).includes(text), f + " carries the stamp");
  }

  /* ================= 1. the rail: Social is Content · Facebook Ads · Scheduling ================= */
  for (const f of FILES) {
    const src = read(f);
    assert.ok(/<a href="\/schedule.html" class="sn-link(?: active)?" title="Scheduling"><svg class="ic"><use href="#ic-clock"\/><\/svg><span class="sn-lbl">Scheduling<\/span><\/a>/.test(src), f + ": Scheduling is in the rail");
    const social = /<span class="sn-cap">Social<\/span>([\s\S]*?)<\/div>/.exec(src)[1];
    assert.deepStrictEqual([...social.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]), ["/social.html", "/ads.html", "/schedule.html"], f + ": Social in the asked order");
  }
  assert.ok(/class="sn-link active" title="Scheduling"/.test(SCHED), "schedule.html marks itself");

  /* ================= 2. the page keeps the suite's rules, and talks to three places ================= */
  {
    const style = styleOf(SCHED), js = scriptOf(SCHED), label = "schedule.html: ";
    const paletteOf = (s) => { const i = s.indexOf("  :root{", s.indexOf("  :root{") + 1); return s.slice(i, s.indexOf("\n  }\n", i)); };
    assert.strictEqual(paletteOf(style), paletteOf(styleOf(read("daily.html"))), label + "the palette is byte-identical to daily.html's");
    const rest = style.replace(/\/\*[\s\S]*?\*\//g, "").replace(paletteOf(style).replace(/\/\*[\s\S]*?\*\//g, ""), "");
    assert.strictEqual(rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g), null, label + "no literal colour outside the palette");
    const sprite = /<svg width="0" height="0"[\s\S]*?<\/defs><\/svg>/.exec(SCHED)[0];
    const syms = new Set([...sprite.matchAll(/<symbol id="(ic-[a-z-]+)"/g)].map((m) => m[1]));
    for (const m of SCHED.matchAll(/href="#(ic-[a-z-]+)"/g)) assert.ok(syms.has(m[1]), label + "#" + m[1] + " resolves");
    assert.ok(/const SQ = "\/\.netlify\/functions\/schedule-queue";/.test(js) && /const CAPTION = "\/\.netlify\/functions\/schedule-caption-background";/.test(js) && /const PUBLISH = "\/\.netlify\/functions\/schedule-publish-background";/.test(js),
      label + "three fixed addresses");
    const fetches = [...js.matchAll(/fetch\(([^,)]+)/g)].map((m) => m[1].trim());
    assert.deepStrictEqual([...new Set(fetches)], ["url"], label + "every fetch goes through sget/spost");
    assert.ok(/spost\(CAPTION, \{ id \}\)/.test(js) && /spost\(PUBLISH, \{ id \}\)/.test(js), label + "the background functions are asked with an id and nothing else");
    // typed text survives a re-render: saved on blur, and never re-read from the DOM by the render
    assert.ok(/q\.addEventListener\("focusout"/.test(js), label + "typed text is saved when the box loses focus");
    assert.ok(/if \(res\.status === 202\) return \{ ok: true \};/.test(js), label + "a background function's 202 is a yes");
    assert.ok(/pollTimer = setTimeout\(\(\) => load\(false\), 4000\)/.test(js), label + "while something is working the queue is re-read every four seconds");
    assert.ok(/data-view="queue">Queue<\/button>/.test(SCHED) && /data-view="month">Month<\/button>/.test(SCHED), label + "two views: Queue and Month");
    assert.ok(/const lead = \(first\.getDay\(\) \+ 6\) % 7;/.test(js), label + "the month is Monday-based, like every week in this suite");
    assert.ok(/Zernio is not connected yet/.test(js), label + "Schedule is switched off, and says why, until Zernio is connected");
  }

  /* ================= 3. the queue function, run ================= */
  {
    const { handler, lib } = await loadQueueFunction();
    const savedFetch = globalThis.fetch, savedEnv = { ...process.env };
    const calls = [];
    let driveFiles = [{ id: "d1", name: "one.mp4", mimeType: "video/mp4", size: "100", createdTime: "2026-09-14T09:00:00Z" }, { id: "d2", name: "two.mov", mimeType: "video/quicktime", createdTime: "2026-09-13T09:00:00Z" }];
    let zernioDeleteOk = true;
    globalThis.fetch = async (u, o) => {
      const url = String(u); calls.push(url);
      if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return { ok: true, status: 200, json: async () => ({ files: driveFiles }) };
      if (url.startsWith("https://zernio.com/api/v1/posts/")) return { ok: zernioDeleteOk, status: zernioDeleteOk ? 200 : 500, json: async () => ({}) };
      throw new Error("unexpected fetch " + url);
    };
    try {
      // nothing configured: an honest GET, no Drive call
      for (const k of ["GOOGLE_DRIVE_API_KEY", "GOOGLE_DRIVE_FOLDER_ID", "GEMINI_API_KEY", "ZERNIO_API_KEY", "ZERNIO_ACCOUNT_INSTAGRAM"]) delete process.env[k];
      globalThis.__fakeStore = fakeStore();
      let r = await GET(handler, "scan=1"); let b = await r.json();
      assert.deepStrictEqual(b.configured, { drive: false, gemini: false, anthropic: !!process.env.ANTHROPIC_API_KEY, zernio: false, platforms: [], folderId: "" });
      assert.deepStrictEqual(b.queue, []); assert.strictEqual(b.scan, null); assert.strictEqual(calls.length, 0, "no Drive call without a key");
      // Drive connected: a scan adds each file once, newest first, as 'new'
      process.env.GOOGLE_DRIVE_API_KEY = "k"; process.env.GOOGLE_DRIVE_FOLDER_ID = "folder1"; process.env.ZERNIO_API_KEY = "z"; process.env.ZERNIO_ACCOUNT_INSTAGRAM = "ig1";
      r = await GET(handler, "scan=1"); b = await r.json();
      assert.strictEqual(b.scan.added, 2); assert.strictEqual(b.queue.length, 2);
      assert.ok(/q=.*folder1.*in\+parents|q=.*folder1/.test(calls[0]) && /key=k/.test(calls[0]), "the folder is listed with the key");
      assert.deepStrictEqual(b.queue.map((it) => [it.driveId, it.status]), [["d2", "new"], ["d1", "new"]], "each file once, as new (unshift puts the later-added first)");
      assert.deepStrictEqual(Object.keys(b.queue[0]).filter((k) => k === "transcript"), [], "the transcript is not sent with the list");
      assert.strictEqual(b.queue[0].thumb, "https://drive.google.com/thumbnail?id=d2&sz=w640", "a thumbnail comes from Drive's public thumbnail address");
      assert.deepStrictEqual(b.configured.platforms, ["instagram"], "only platforms with a Zernio id");
      r = await GET(handler, "scan=1"); b = await r.json();
      assert.strictEqual(b.scan.added, 0); assert.strictEqual(b.queue.length, 2, "a second scan adds nothing");
      assert.deepStrictEqual([...globalThis.__fakeStore._m.keys()], ["sched-queue"], "one key");
      const id = b.queue.find((it) => it.driveId === "d1").id;
      // Ash's edits: a caption makes a new item ready; junk platforms are dropped; a date is normalised
      r = await POST(handler, { op: "update", id, caption: "Hello", platforms: ["instagram", "myspace"], scheduledFor: "2026-09-20T18:00" }); b = await r.json();
      assert.strictEqual(b.item.status, "ready"); assert.deepStrictEqual(b.item.platforms, ["instagram"]); assert.ok(/^2026-09-20T/.test(b.item.scheduledFor));
      r = await POST(handler, { op: "skip", id }); b = await r.json(); assert.strictEqual(b.item.status, "skipped");
      r = await POST(handler, { op: "restore", id }); b = await r.json(); assert.strictEqual(b.item.status, "ready", "restored with a caption = ready");
      // cancel: only a scheduled post; Zernio asked; back to ready
      r = await POST(handler, { op: "cancel", id }); b = await r.json(); assert.strictEqual(r.status, 400, "only a scheduled post can be cancelled");
      const q = await lib.readQueue(); q.find((it) => it.id === id).status = "scheduled"; q.find((it) => it.id === id).zernioPostId = "zp1"; await lib.writeQueue(q);
      r = await POST(handler, { op: "cancel", id }); b = await r.json();
      assert.strictEqual(b.cancelled, true); assert.strictEqual(b.item.status, "ready"); assert.strictEqual(b.item.zernioPostId, null);
      assert.ok(calls.some((c) => c === "https://zernio.com/api/v1/posts/zp1"), "Zernio was asked to cancel");
      zernioDeleteOk = false;
      const q2 = await lib.readQueue(); q2.find((it) => it.id === id).status = "scheduled"; q2.find((it) => it.id === id).zernioPostId = "zp2"; await lib.writeQueue(q2);
      r = await POST(handler, { op: "cancel", id }); b = await r.json();
      assert.strictEqual(b.cancelled, false); assert.ok(/check it there too/.test(b.item.error), "…and when Zernio does not confirm, the card says to check there");
      // the quarter-hour rule: a scheduled post whose time is gone reads as posted
      const q3 = await lib.readQueue(); const it3 = q3.find((it) => it.id === id); it3.status = "scheduled"; it3.scheduledFor = new Date(Date.now() - 20 * 60000).toISOString(); await lib.writeQueue(q3);
      r = await GET(handler, ""); b = await r.json();
      assert.strictEqual(b.queue.find((it) => it.id === id).status, "published", "twenty minutes past its time = posted");
      // the transcript, only when asked
      const q4 = await lib.readQueue(); q4.find((it) => it.id === id).transcript = "Hi, I'm Sarah"; await lib.writeQueue(q4);
      r = await GET(handler, "transcript=" + id); b = await r.json(); assert.strictEqual(b.transcript, "Hi, I'm Sarah");
      r = await GET(handler, ""); b = await r.json(); assert.strictEqual(b.queue.find((it) => it.id === id).hasTranscript, true); assert.strictEqual(b.queue.find((it) => it.id === id).transcript, undefined);
      // remove
      r = await POST(handler, { op: "remove", id }); b = await r.json(); assert.strictEqual(b.removed, id);
      r = await GET(handler, ""); b = await r.json(); assert.strictEqual(b.queue.length, 1);
      // the caption prompt: Ash's voice, his handle, the rules that stop invention
      const prompt = lib.captionPrompt("comment PLAN for the plan", "x.mp4", '1. "Old caption"', true);
      assert.ok(/Bodysculpt, a gym in Warrington/.test(prompt) && /Old caption/.test(prompt) && /Follow @bodysculptwarrington/.test(prompt) && /never invent/.test(prompt) && /YouTube Shorts title/.test(prompt));
    } finally {
      globalThis.fetch = savedFetch;
      for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
      Object.assign(process.env, savedEnv);
      delete globalThis.__fakeStore;
    }
  }

  /* ================= 4. the slow work is background, and the writer is Claude ================= */
  {
    for (const f of ["schedule-caption-background", "schedule-publish-background"]) {
      assert.ok(fs.existsSync(path.join(__dirname, "..", "netlify", "functions", f + ".js")), f + ".js exists — the -background suffix is what lets it run for minutes");
      assert.ok(/patchItem\(id, \{ status: "(captioning|scheduling)"/.test(read("netlify/functions/" + f + ".js")), f + " marks the item working first");
    }
    const lib = read("netlify/lib/schedule.js");
    assert.ok(/import Anthropic from "@anthropic-ai\/sdk";/.test(lib) && /model: "claude-opus-5"/.test(lib), "the caption is written by Claude Opus 5 through the SDK");
    assert.ok(/response\.stop_reason === "refusal"/.test(lib), "…and a refusal is handled");
    assert.ok(/ig-cache-mine/.test(lib), "the voice comes from his own recent captions");
    assert.ok(/X-Goog-Upload-Protocol": "resumable"/.test(lib) && /gemini-2\.5-flash/.test(lib), "the transcript comes from Gemini's file upload, newest model first");
    assert.ok(/method: "DELETE" \}\)\.catch/.test(lib), "…and the uploaded file is deleted from Gemini afterwards");
    assert.ok(/const ZERNIO = "https:\/\/zernio\.com\/api\/v1";/.test(lib) && /ZERNIO \+ "\/media\/presign"/.test(lib) && /ZERNIO \+ "\/posts"/.test(lib), "Zernio: presign + upload, then the post");
    const doc = read("SCHEDULE-SETUP.md");
    for (const k of ["GOOGLE_DRIVE_API_KEY", "GOOGLE_DRIVE_FOLDER_ID", "GEMINI_API_KEY", "ZERNIO_API_KEY", "ZERNIO_ACCOUNT_INSTAGRAM"]) assert.ok(doc.includes(k), "the setup doc names " + k);
    assert.ok(/Anyone with the link/.test(doc), "…and says how the folder is shared");
  }

  console.log("v170-scheduling.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
