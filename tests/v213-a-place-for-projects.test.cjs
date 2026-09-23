// v213 — a place for projects.
//
// Ash: "I'm not very good when it comes to projects, but I want to be… create me a PROJECT
// page under planning which will act like a Trello board… know what that project is i.e.
// Migrate from Ontraport to GoHighLevel and know what each step of that project is… I will
// eventually want to start using Excalidraw to come up with visualising systems."
//
// Four things are pinned here, in the order they can hurt:
//
//  1. THE STORE CANNOT REACH ANYTHING ELSE. This is the ninth page and the sixth thing
//     writing to the same blob store. Weekly plans, monthly plans, the quarterly reviews and
//     the KPI history have no backup, so the page got its OWN function, and that function is
//     driven here against a store seeded with one of every other kind of record. Every one of
//     them comes back byte-identical, and every key the function touched begins proj-.
//
//  2. NOTHING IS EVER DELETED. A step is flagged, a project is archived, and the record
//     stays. The toast that reports either one carries the way back (v209's rule).
//
//  3. THE CLEANER KNOWS EVERY FIELD THE PAGE WRITES. The finance page shipped a whitelist
//     that silently ate new fields off a record (v208). The same shape exists here, so this
//     test builds a step the way the page builds one and demands the cleaner keeps all of it.
//
//  4. EVERY CONTROL COMMITS. The single most expensive bug this suite has shipped, twice:
//     a control that changes something on screen and never writes it down.
//
// Then the page's own claims — four tabs, the rail, one theme, and Excalidraw fetched only
// when a board is actually opened, with somewhere to land if it will not load at all.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = (f) => path.join(__dirname, "..", f);
const read = (f) => fs.readFileSync(root(f), "utf8");
const PAGE = read("projects.html");
const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));
const scriptOf = (src) => src.slice(src.lastIndexOf("<script>") + 8, src.lastIndexOf("</script>"));
const STYLE = styleOf(PAGE);
const JS = scriptOf(PAGE);
// the body of a named top-level function, so "does this handler commit?" is answerable
function bodyOf(js, name) {
  const re = new RegExp("\\n(?:async )?function " + name + "\\s*\\(", "g");
  const m = re.exec(js);
  assert.ok(m, "the page defines " + name + "()");
  let i = js.indexOf("{", m.index + m[0].length - 1), depth = 0, j = i;
  for (; j < js.length; j++) {
    if (js[j] === "{") depth++;
    else if (js[j] === "}") { depth--; if (!depth) break; }
  }
  return js.slice(i, j + 1);
}

/* the blob store, faked — the same surface netlify/lib/projects.js actually uses */
function fakeStore(seed) {
  const m = new Map(Object.entries(seed || {}));
  const wrote = [];
  return {
    _m: m, _wrote: wrote,
    async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
    async getWithMetadata(k) { const v = m.get(k); if (v === undefined) return null; return { data: v, metadata: m.get(k + "::meta") || {} }; },
    async set(k, v, opts) { wrote.push(k); m.set(k, v); if (opts && opts.metadata) m.set(k + "::meta", opts.metadata); },
    async list(o) { const p = (o && o.prefix) || "";
      return { blobs: [...m.keys()].filter((k) => k.startsWith(p) && !k.endsWith("::meta")).map((key) => ({ key })), directories: [] }; },
  };
}

// one of every record the rest of the suite owns — none of it may move
const SEED = {
  "weeks": JSON.stringify([{ weekEnding: "2026-08-31", leads: 41, trialSales: 9, recurring: 312 }]),
  "settings": JSON.stringify({ leadTarget: 50 }),
  "months": JSON.stringify([{ ym: "2026-08", revenue: 41000 }]),
  "planning-2026-Q2": JSON.stringify({ year: 2026, quarter: "Q2", goals: [{ id: "g1", title: "The Q2 review nobody may touch" }] }),
  "weekly-plan-2026-08-31": JSON.stringify({ weekEnding: "2026-08-31", tasks: [{ id: "t1", title: "Call the landlord" }] }),
  "weekly-recurring-defaults": JSON.stringify([{ id: "r1", title: "Team huddle" }]),
  "monthly-plan-2026-08": JSON.stringify({ ym: "2026-08", focus: [{ id: "f1", title: "Fix churn" }] }),
  "fin-txns-2026-08": JSON.stringify({ ym: "2026-08", rows: [{ date: "2026-08-04", amt: 143.1 }] }),
  "sched-queue": JSON.stringify([{ id: "q1", name: "reel.mp4" }]),
  "ig-competitors": JSON.stringify(["someone"]),
};

/* load the real function, with only the store swapped — the routing and the guards under
   test are exactly what ships */
async function loadHandler(store) {
  const libSrc = read("netlify/lib/projects.js");
  assert.ok(/^import \{ getStore \} from "@netlify\/blobs";$/m.test(libSrc),
    "the store import is the single line this test swaps");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bodysculpt-projects-"));
  fs.mkdirSync(path.join(dir, "lib")); fs.mkdirSync(path.join(dir, "functions"));
  fs.writeFileSync(path.join(dir, "lib", "projects.js"),
    libSrc.replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => globalThis.__fakeStore;"));
  fs.writeFileSync(path.join(dir, "functions", "projects.js"), read("netlify/functions/projects.js"));
  globalThis.__fakeStore = store;
  const mod = await import("file://" + path.join(dir, "functions", "projects.js") + "?t=" + Date.now());
  return mod.default;
}
const GET = (h, qs) => h(new Request("https://x/.netlify/functions/projects?" + qs));
const POST = (h, body) => h(new Request("https://x/.netlify/functions/projects",
  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const UPLOAD = (h, qs, bytes) => h(new Request("https://x/.netlify/functions/projects?upload=1&" + qs,
  { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes }));

// a project with every field the page can write on it
function fullProject() {
  return {
    id: "p_test1", name: "Migrate from Ontraport to GoHighLevel",
    summary: "Everything running in GHL and Ontraport closed.",
    status: "active", accent: "teal", startDate: "2026-09-17", targetDate: "2026-11-30",
    columns: [{ id: "todo", name: "To do", done: false }, { id: "done", name: "Done", done: true }],
    steps: [fullStep()],
    canvas: [{ id: "v_1", name: "The funnel", kind: "board", fileId: "f_scene", thumbId: "f_png",
      mime: "application/json", size: 900, note: "how leads arrive", stepId: "s_1",
      addedAt: "2026-09-20T09:00:00.000Z", updatedAt: "2026-09-20T09:00:00.000Z" }],
    archived: false, createdAt: "2026-09-20T09:00:00.000Z", lastUpdated: "2026-09-20T09:00:00.000Z",
  };
}
function fullStep() {
  return {
    id: "s_1", title: "Export every contact, with their tags", notes: "Counts must match.",
    col: "todo", urgency: "critical", due: "2026-10-01", tags: ["ghl", "data"],
    checklist: [{ id: "c_1", text: "Download the CSV", done: true }],
    files: [{ id: "f_1", name: "contacts.pdf", mime: "application/pdf", size: 1200, addedAt: "2026-09-20T09:00:00.000Z" }],
    done: false, del: false, order: 3,
    createdAt: "2026-09-20T09:00:00.000Z", updatedAt: "2026-09-20T09:00:00.000Z",
  };
}

(async () => {
  /* =====================================================================
     1. THE STORE CANNOT REACH ANYTHING ELSE
     ===================================================================== */
  {
    const store = fakeStore(SEED);
    const h = await loadHandler(store);

    // every route, driven for real
    let r = await POST(h, { project: fullProject() });
    assert.strictEqual(r.status, 200, "a project saves");
    const saved = (await r.json()).project;
    assert.strictEqual(saved.name, "Migrate from Ontraport to GoHighLevel", "…and comes back");

    r = await GET(h, "list=1");
    const list = (await r.json()).projects;
    assert.strictEqual(list.length, 1, "the list finds it, and finds nothing else");
    assert.strictEqual(list[0].id, "p_test1", "…and it is the one that was saved");

    r = await GET(h, "project=p_test1");
    assert.strictEqual((await r.json()).project.id, "p_test1", "one project reads back by id");

    r = await UPLOAD(h, "name=drawing.png&mime=image%2Fpng", new Uint8Array([1, 2, 3, 4]));
    assert.strictEqual(r.status, 200, "a picture uploads");
    const file = (await r.json()).file;
    assert.ok(/^f_/.test(file.id) && file.size === 4, "…and reports its id and size");

    r = await GET(h, "file=" + file.id);
    assert.strictEqual(r.status, 200, "the bytes read back");
    assert.strictEqual(r.headers.get("Content-Type"), "image/png", "…as the kind of file they are");
    assert.ok(/^inline/.test(r.headers.get("Content-Disposition")), "…to be shown, not downloaded");

    // the routes that must say no
    assert.strictEqual((await GET(h, "project=nope")).status, 404, "an unknown project is a 404, not an empty one");
    assert.strictEqual((await POST(h, { project: { id: "x", name: "" } })).status, 400, "a project with no name is refused");
    assert.strictEqual((await UPLOAD(h, "name=x.docx&mime=application%2Fmsword", new Uint8Array([1]))).status, 415,
      "a kind of file that cannot be drawn or read is refused by type");
    assert.strictEqual((await UPLOAD(h, "name=big.png&mime=image%2Fpng", new Uint8Array(5 * 1024 * 1024))).status, 413,
      "five megabytes is refused — the function's own body limit is six");
    assert.strictEqual((await GET(h, "file=" + "z".repeat(50))).status, 404, "a key that is not ours cannot be read through");

    // …and now: nothing else moved
    for (const k of Object.keys(SEED)) {
      assert.strictEqual(store._m.get(k), SEED[k], k + " is byte-identical after every projects route ran");
    }
    for (const k of store._wrote) {
      assert.ok(/^(proj-|projfile-)/.test(k), "the only keys written are the page's own — saw " + k);
    }
    assert.ok(store._wrote.length >= 2, "…and it did write (" + store._wrote.length + " keys)");
    // the function has no route that removes anything
    const fn = read("netlify/functions/projects.js");
    assert.ok(!/\bstore\(\)\.delete\b|\.delete\(/.test(fn + read("netlify/lib/projects.js")),
      "there is no delete anywhere in the store — archiving and flagging are ordinary saves");
  }

  /* =====================================================================
     2. THE CLEANER KNOWS EVERY FIELD THE PAGE WRITES
     ===================================================================== */
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bodysculpt-projlib-"));
    fs.writeFileSync(path.join(dir, "projects.js"),
      read("netlify/lib/projects.js").replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => null;"));
    const lib = await import("file://" + path.join(dir, "projects.js") + "?t=" + Date.now());

    const step = lib.cleanStep(fullStep(), ["todo", "done"]);
    assert.deepStrictEqual(Object.keys(step).sort(), Object.keys(fullStep()).sort(),
      "cleanStep keeps EVERY field the page puts on a step — a field missing here is a field the page loses on save");
    assert.deepStrictEqual(step.tags, ["ghl", "data"], "tags survive");
    assert.deepStrictEqual(step.checklist, fullStep().checklist, "the checklist survives, ticks and all");
    assert.deepStrictEqual(step.files, fullStep().files, "attached files survive");
    assert.strictEqual(step.urgency, "critical", "urgency survives");
    assert.strictEqual(step.due, "2026-10-01", "the date survives");

    const project = lib.cleanProject(fullProject());
    const expected = Object.keys(fullProject()).sort();
    assert.deepStrictEqual(Object.keys(project).sort(), expected, "cleanProject keeps every field of a project");
    assert.deepStrictEqual(Object.keys(project.canvas[0]).sort(), Object.keys(fullProject().canvas[0]).sort(),
      "…including every field of a canvas item");

    // the page's own literals must be exactly what the cleaner knows about
    const stepLiteral = /p\.steps\.push\(\{([\s\S]*?)\n  \}\);/.exec(JS);
    assert.ok(stepLiteral, "the page builds a step from one literal (addStep)");
    const pageFields = [...stepLiteral[1].matchAll(/(?:^|[\s,{])([a-zA-Z]+)\s*:/g)].map((m) => m[1]);
    for (const f of pageFields) {
      assert.ok(Object.prototype.hasOwnProperty.call(step, f),
        "the page writes step." + f + " and the cleaner keeps it (add it to cleanStep, or it is eaten on save)");
    }

    // the refusals that keep a bad save from making a board unusable
    assert.strictEqual(lib.cleanStep({ title: "  " }, ["todo"]), null, "a step with no title is not a step");
    assert.strictEqual(lib.cleanProject({ id: "p_1" }), null, "a project with no name is not a project");
    assert.strictEqual(lib.cleanProject({ id: "p_1", name: "x", columns: [] }).columns.length, 4,
      "a project saved with no stages gets the four back — a board with no columns is not a board");
    assert.strictEqual(lib.cleanStep(Object.assign(fullStep(), { col: "gone" }), ["todo"]).col, "todo",
      "a step pointing at a stage that no longer exists lands in the first one, never nowhere");
    assert.strictEqual(lib.cleanStep(Object.assign(fullStep(), { urgency: "screaming" }), ["todo"]).urgency, "normal",
      "an urgency the page does not draw becomes normal");
    assert.ok(!lib.keyOk("weeks") && !lib.keyOk("planning-2026-Q2") && !lib.keyOk("../weeks"),
      "keyOk refuses every key that is not this page's");
    assert.ok(lib.keyOk("proj-p_1") && lib.keyOk("projfile-f_1"), "…and admits the two that are");

    /* 2b. DELETE IS A FLAG, ARCHIVE IS A FLAG */
    const deleted = lib.cleanStep(Object.assign(fullStep(), { del: true }), ["todo"]);
    assert.strictEqual(deleted.del, true, "a deleted step keeps its del flag — and therefore its notes");
    assert.strictEqual(deleted.title, fullStep().title, "…and everything else about it");
    const archived = lib.cleanProject(Object.assign(fullProject(), { archived: true }));
    assert.strictEqual(archived.archived, true, "an archived project is archived, not gone");
    assert.strictEqual(archived.steps.length, 1, "…with its steps still on it");
  }

  /* =====================================================================
     3. EVERY CONTROL COMMITS
     ===================================================================== */
  {
    // every handler that changes a record, and the fact that each one writes it down
    const MUTATORS = ["addStep", "moveStep", "addColumn", "removeColumn", "deleteStep",
      "toggleStepDone", "takeFiles", "removeCanvasItem", "archiveProject", "saveProjectSheet"];
    for (const fn of MUTATORS) {
      assert.ok(/pCommit\(/.test(bodyOf(JS, fn)), fn + "() commits what it changed");
    }
    // the wiring that lives inside renderers, where a missed commit is easiest to write
    for (const fn of ["wireStep", "wireBoard", "renderCanvas"]) {
      assert.ok(/pCommit\(/.test(bodyOf(JS, fn)), fn + "() commits every edit it wires up");
    }
    // the commit itself: queued by id, so changing which project is on screen cannot strand
    // a save that was already waiting
    const commit = bodyOf(JS, "pCommit");
    assert.ok(/pending\.add\(p\.id\)/.test(commit), "a waiting save is queued by project id, not by what is on screen");
    const flush = bodyOf(JS, "flush");
    assert.ok(/ids\.forEach\(\(id\) => pending\.add\(id\)\)/.test(flush), "a failed save goes back in the queue rather than vanishing");
    // leaving the page flushes, by the one mechanism that survives the page going away
    assert.ok(/window\.addEventListener\("pagehide", beaconFlush\)/.test(JS), "leaving the page writes what is waiting");
    assert.ok(/navigator\.sendBeacon\(API, blob\)/.test(JS), "…with sendBeacon, because fetch does not survive it");
    assert.ok(/visibilityState === "hidden"\) beaconFlush\(\)/.test(JS), "…and so does putting the phone down");
    // nothing takes the server's answer back over the local record (it would strand every
    // reference this page is holding)
    assert.ok(!/replaceProject/.test(JS), "the page does not swap its own records for the ones that came back");

    /* 3b. the way back is on the confirmation, not somewhere else (v209) */
    assert.ok(/function toastUndo\(msg, label, fn\)/.test(JS), "the page has the undo-carrying toast");
    for (const fn of ["deleteStep", "removeColumn", "removeCanvasItem"]) {
      assert.ok(/toastUndo\(/.test(bodyOf(JS, fn)), fn + "() offers the way back where the mistake happened");
    }
    assert.ok(/toastUndo\(/.test(bodyOf(JS, "archiveProject")), "archiving offers it too");
    assert.ok(/s\.del = true;/.test(bodyOf(JS, "deleteStep")) && !/splice/.test(bodyOf(JS, "deleteStep")),
      "deleting a step flags it — the row is never taken out of the project");
  }

  /* =====================================================================
     4. THE PAGE
     ===================================================================== */
  {
    /* 4a. four tabs, and one address each */
    const tabs = [...PAGE.matchAll(/<button class="vt(?: active)?" data-view="([a-z]+)">([^<]+)<\/button>/g)];
    assert.deepStrictEqual(tabs.map((m) => m[1]), ["projects", "board", "canvas", "deadlines"], "four tabs, in order");
    assert.deepStrictEqual(tabs.map((m) => m[2]), ["Projects", "Board", "Canvas", "Deadlines"], "…named for what they hold");
    const hashTable = /const P_TAB_HASH = \{([^}]*)\}/.exec(JS);
    assert.ok(hashTable, "the tabs have a hash table, as the weekly and monthly pages do");
    for (const t of tabs.map((m) => m[1])) {
      assert.ok(new RegExp(t + ': "#' + t + '"').test(hashTable[1]), "#" + t + " opens the " + t + " tab");
    }
    assert.ok(/history\.replaceState\(null, "", P_TAB_HASH\[v\]\)/.test(JS), "switching tabs puts the address in the bar");
    assert.ok(/window\.addEventListener\("hashchange"/.test(JS), "…and an address typed in the bar switches the tab");
    /* A hash is a fragment link BEFORE it is a tab name. The column strip was id="board", so
       opening #board made the browser scroll to it and focus it, and the board wore a focus
       ring from the moment it loaded. No id may be a tab name. */
    // comments out first — this suite keeps catching itself on the note explaining the rule
    const noComments = PAGE.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const t of tabs.map((m) => m[1])) {
      assert.ok(!new RegExp('id="' + t + '"').test(noComments),
        'nothing is id="' + t + '" — the browser would jump to it and focus it when the tab is opened');
    }

    /* 4b. the four things Ash asked a step to carry */
    for (const [what, re] of [
      ["a deadline", /<input id="stDue" type="date"/],
      ["notes", /<textarea id="stNotes"/],
      ["tags", /id="stTagIn"/],
      ["an urgency", /id="stUrg"/],
    ]) assert.ok(re.test(JS), "a step carries " + what);
    assert.ok(/const URGENCIES = \[\["critical", "Critical"\], \["high", "High"\], \["normal", "Normal"\], \["low", "Low"\]\]/.test(JS),
      "urgency is four words, not a number");
    assert.ok(/id="stCk"/.test(JS) && /id="stCkNew"/.test(JS), "…and a checklist inside it");
    assert.ok(/id="stAddFile"/.test(JS), "…and files");

    /* 4c. the board is usable without dragging, because the phone is where he works */
    assert.ok(/draggable="true"/.test(JS), "cards drag on a pointer device");
    assert.ok(/id="stCols"[\s\S]{0,400}?data-c="/.test(JS), "…and every card can be moved from inside the drawer, which is the path a phone has");
    assert.ok(/scroll-snap-type:x mandatory/.test(STYLE), "on a phone the columns are a swipe, one at a time");

    /* 4d. Deadlines reads EVERY project, which is the reason the page exists */
    const dl = bodyOf(JS, "renderDeadlines");
    assert.ok(/S\.projects\.filter\(\(p\) => !p\.archived && p\.status !== "done"\)/.test(dl),
      "it reads every live project, not the one on screen");
    for (const cap of ["Overdue", "Today", "This week", "Later"]) {
      assert.ok(dl.includes('"' + cap + '"'), "…grouped by " + cap);
    }

    /* 4e. the theme: one palette, no colour of its own */
    // comments come out FIRST. This suite has been caught three times by an assertion that
    // found the forbidden thing inside the comment promising not to do it.
    const bare = STYLE.replace(/\/\*[\s\S]*?\*\//g, "");
    const paletteEnd = STYLE.indexOf("\n  }\n", STYLE.indexOf("  :root{", STYLE.indexOf("  :root{") + 1));
    const below = STYLE.slice(paletteEnd).replace(/\/\*[\s\S]*?\*\//g, "");
    const literals = below.match(/#[0-9a-fA-F]{3,8}\b|\brgb\(\s*\d|\bhsl\(/g) || [];
    assert.deepStrictEqual(literals, [], "not one literal colour below the palette block — every colour is a token");
    assert.ok(/--pa:var\(--orange\)/.test(STYLE), "a project's accent resolves to a palette token, always");
    for (const a of ["orange", "teal", "blue", "green", "amber", "red"]) {
      assert.ok(new RegExp("\\.p-" + a + "\\{--pa:var\\(--" + a + "\\)").test(STYLE), "the " + a + " accent is the palette's " + a);
    }
    // every var() the stylesheet asks for is defined somewhere in it
    const defined = new Set([...bare.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    for (const m of bare.matchAll(/var\((--[a-z0-9-]+)/g)) {
      assert.ok(defined.has(m[1]), "var(" + m[1] + ") resolves — no dangling token");
    }
    // v123: hidden must actually hide, and half this page ships hidden
    assert.ok(/\[hidden\]\{display:none!important;\}/.test(STYLE),
      "`hidden` beats any class that sets display — this page is mostly overlays");
    // v121: icons come off the sprite, and every one it asks for is on it
    const sprite = /<svg width="0" height="0"[\s\S]*?<\/defs><\/svg>/.exec(PAGE);
    assert.ok(sprite, "the page carries the icon sprite");
    const symbols = new Set([...sprite[0].matchAll(/<symbol id="(ic-[a-z-]+)"/g)].map((m) => m[1]));
    for (const m of PAGE.slice(sprite.index + sprite[0].length).matchAll(/href="#(ic-[a-z-]+)"/g)) {
      assert.ok(symbols.has(m[1]), "#" + m[1] + " is used and defined");
    }
    assert.ok(symbols.has("ic-kanban"), "the rail's own icon is on this page's sprite too");

    /* 4f. the rail: it is the ninth page, under Planning, and it marks itself */
    assert.ok(/<a href="\/projects.html" class="sn-link active" title="Projects"><svg class="ic"><use href="#ic-kanban"\/><\/svg><span class="sn-lbl">Projects<\/span><\/a>/.test(PAGE),
      "projects.html marks its own rail link");
    const planning = /<span class="sn-cap">Planning<\/span>([\s\S]*?)<\/div>/.exec(PAGE)[1];
    assert.deepStrictEqual([...planning.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]),
      ["/index.html", "/monthly.html", "/quarterly.html", "/projects.html"],
      "Projects sits after the three periods — it is what the periods are for, not a fourth one");
    assert.ok(/<title>Bodysculpt Projects<\/title>/.test(PAGE), "the page is titled Projects");
    // the rail's drawer script still leads the app script (v162's rule)
    assert.ok(JS.trimStart().startsWith("/* v162: the side nav's drawer"), "the drawer script leads the app script");
  }

  /* =====================================================================
     5. EXCALIDRAW
     ===================================================================== */
  {
    // it is a megabyte of somebody else's JavaScript. Nobody pays for it to look at cards.
    assert.ok(!/<script src="https?:/.test(PAGE), "nothing off the page is loaded up front");
    assert.ok(/async function loadExcalidraw\(\)/.test(JS), "the drawing tools are fetched by a function");
    const open = bodyOf(JS, "openBoardEditor");
    assert.ok(/await loadExcalidraw\(\)/.test(open), "…called when a board is opened, and nowhere else");
    assert.strictEqual((JS.match(/loadExcalidraw\(\)/g) || []).length, 2,
      "loadExcalidraw is defined once and called from one place — not scattered");
    assert.ok(/window\.EXCALIDRAW_ASSET_PATH = EX_BASE/.test(JS), "it is told where its fonts live");

    // what is stored is the SCENE, so a drawing stays editable — and a picture of it, so
    // the grid and the phone never have to load the editor at all
    const save = bodyOf(JS, "saveBoard");
    assert.ok(/type: "excalidraw"/.test(save), "a board is saved as a real Excalidraw scene");
    assert.ok(/exApi\.getSceneElements\(\)/.test(save) && /exApi\.getFiles/.test(save),
      "…with its elements and its embedded images");
    assert.ok(/exportToBlob/.test(save) && /mimeType: "image\/png"/.test(save), "…and a picture of it is written alongside");
    assert.ok(/catch \(e\) \{ \/\* the preview is a nicety, never the record \*\/ \}/.test(save),
      "a failed preview never costs you the drawing");
    assert.ok(/canvasItemHtml/.test(JS) && /it\.thumbId[\s\S]{0,120}?<img src=/.test(JS),
      "the canvas grid shows the picture, not the editor");

    // a .excalidraw file dropped in becomes a board you can keep editing, not a dead picture
    const take = bodyOf(JS, "takeFiles");
    assert.ok(/mime === "application\/json"/.test(take) && /kind: "board"/.test(take),
      "an exported .excalidraw file arrives as an editable board");
    assert.ok(/Array\.isArray\(scene\.elements\)/.test(take), "…after being checked that it is one");
    assert.ok(/\.excalidraw\$\/i/.test(JS), "the extension is what names it — these files carry no type");

    // and if it will not load at all, there is somewhere to go
    assert.ok(/The drawing tools would not load/.test(JS), "a blocked load says so in words");
    assert.ok(/excalidraw\.com/.test(JS), "…and points at the place the drawing can still be made");
    assert.ok(/Everything you have already drawn is safe/.test(JS), "…and says nothing was lost");
  }

  console.log("v213-a-place-for-projects: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
