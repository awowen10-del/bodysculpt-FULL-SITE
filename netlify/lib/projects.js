// netlify/lib/projects.js  (v213)
//
// The Projects page's back end — the shape of a project, and the cleaners that decide what
// is allowed to be stored. Only netlify/functions/projects.js imports this; the page talks
// to that one function and to nothing else.
//
// WHY THIS IS ITS OWN FUNCTION AND NOT A ROUTE ON kpi-store.
// kpi-store holds the weekly plans, the monthly plans, the quarterly reviews and the KPI
// history. That is live data with no backup anywhere. The safest way to add a ninth page is
// to add code that CANNOT REACH ANY OF IT — so this function reads and writes exactly two
// key prefixes and refuses everything else (see keyOk below), and its test proves a seeded
// store of every other kind of record comes back byte-identical after every route has run.
//
// TWO KEY PREFIXES, AND NOTHING ELSE:
//   proj-<id>       one project, as JSON
//   projfile-<id>   one file's BYTES — an upload, a drawn board's scene, or a board's preview
//
// DELETE IS NEVER A DELETE. A step gets del:true and is hidden; a project gets
// archived:true and stays in the store. The way back is offered on the confirmation itself,
// not as a chip somewhere else on the page, because the page is used on a phone and nobody
// goes hunting for an undo they have to find.
//
// THE WHITELIST TRAP, WRITTEN DOWN BECAUSE IT HAS BITTEN THIS SUITE BEFORE:
// cleanProject / cleanStep / cleanCanvasItem are WHITELISTS. A field the page starts sending
// that is not listed here is silently dropped on the next save, and the page will look like
// it forgot what you typed. Adding a field to a step means adding it in THREE places: the
// page's step shape, cleanStep below, and the test that lists the fields.
import { getStore } from "@netlify/blobs";

export const PROJ_PREFIX = "proj-";
export const FILE_PREFIX = "projfile-";

// caps — generous enough that a real project never meets them, small enough that one bad
// paste cannot fill the store
export const CAP = {
  projects: 80,
  steps: 400,
  columns: 12,
  canvas: 80,
  tags: 8,
  checklist: 40,
  files: 12,
  fileBytes: 4 * 1024 * 1024,   // 4 MB — a Netlify function's request body tops out at 6
};

export const STATUSES = ["planned", "active", "paused", "done"];
export const URGENCIES = ["critical", "high", "normal", "low"];
// the accents a project may wear. These are TOKEN NAMES from the one palette, never colours
// — the page turns them into var(--x). Keeping the list here means the store can refuse a
// value the stylesheet has no colour for.
export const ACCENTS = ["orange", "teal", "blue", "green", "amber", "red"];
export const KINDS = ["board", "file"];
// what may be uploaded. Anything else is refused by name, so the answer is never a broken
// picture — a .docx has no business being a diagram.
export const MIMES = [
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
  "application/pdf",
  "application/json",          // an .excalidraw scene — the page turns these into real boards
];

const store = () => getStore({ name: "bodysculpt-kpi", consistency: "strong" });

/* Every key this function will ever touch has to pass through here. It is the whole
   isolation guarantee, in one function, so there is one place to read to be sure. */
export function keyOk(key) {
  return typeof key === "string"
    && (key.startsWith(PROJ_PREFIX) || key.startsWith(FILE_PREFIX))
    && /^[a-z]+-[A-Za-z0-9_-]{1,40}$/.test(key);
}

export const nowIso = () => new Date().toISOString();
export const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");
const str = (v, n) => clip(typeof v === "string" ? v : "", n);
const ymd = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
// an id is ours or it is not used. Ids come from the page (so a card can be addressed the
// moment it is drawn, before any round trip) but they are re-checked here.
const id = (v, n = 40) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v.slice(0, n) : "");
export function newId(prefix) {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

/* ---------- a step: one thing that has to happen ---------- */
export function cleanStep(raw, columnIds) {
  if (!raw || typeof raw !== "object") return null;
  const title = str(raw.title, 240).trim();
  if (!title) return null;
  const sid = id(raw.id) || newId("s_");
  const col = columnIds.includes(raw.col) ? raw.col : columnIds[0];
  return {
    id: sid,
    title,
    notes: str(raw.notes, 8000),
    col,
    urgency: pick(raw.urgency, URGENCIES, "normal"),
    due: ymd(raw.due),
    tags: (Array.isArray(raw.tags) ? raw.tags : [])
      .map((t) => str(t, 28).trim()).filter(Boolean).slice(0, CAP.tags),
    checklist: (Array.isArray(raw.checklist) ? raw.checklist : [])
      .map((c) => {
        if (!c || typeof c !== "object") return null;
        const text = str(c.text, 200).trim();
        if (!text) return null;
        return { id: id(c.id) || newId("c_"), text, done: c.done === true };
      })
      .filter(Boolean).slice(0, CAP.checklist),
    files: (Array.isArray(raw.files) ? raw.files : [])
      .map(cleanFileRef).filter(Boolean).slice(0, CAP.files),
    done: raw.done === true,
    // v213: a deleted step is KEPT and flagged. Its notes are often the only record of why
    // something was going to be done; removing the row would throw that away for good.
    del: raw.del === true,
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : 0,
    createdAt: str(raw.createdAt, 30) || nowIso(),
    updatedAt: str(raw.updatedAt, 30) || nowIso(),
  };
}

/* ---------- a file, as the project records it (the bytes live under their own key) ---------- */
export function cleanFileRef(raw) {
  if (!raw || typeof raw !== "object") return null;
  const fid = id(raw.id);
  if (!fid) return null;
  return {
    id: fid,
    name: str(raw.name, 160) || "file",
    mime: MIMES.includes(raw.mime) ? raw.mime : "application/octet-stream",
    size: Math.max(0, Math.min(CAP.fileBytes, Number(raw.size) || 0)),
    addedAt: str(raw.addedAt, 30) || nowIso(),
  };
}

/* ---------- a canvas item: a drawn board, or a picture of one ---------- */
export function cleanCanvasItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const cid = id(raw.id) || newId("v_");
  const kind = pick(raw.kind, KINDS, "file");
  const fileId = id(raw.fileId);
  if (!fileId) return null;              // an item with no bytes behind it is not an item
  return {
    id: cid,
    name: str(raw.name, 160) || (kind === "board" ? "Untitled board" : "Untitled"),
    kind,
    fileId,
    // a board also carries a picture of itself, so the grid and the phone never have to
    // load the editor to see what was drawn
    thumbId: id(raw.thumbId),
    mime: MIMES.includes(raw.mime) ? raw.mime : "application/octet-stream",
    size: Math.max(0, Math.min(CAP.fileBytes, Number(raw.size) || 0)),
    note: str(raw.note, 600),
    stepId: id(raw.stepId),              // optional: the step this drawing is about
    addedAt: str(raw.addedAt, 30) || nowIso(),
    updatedAt: str(raw.updatedAt, 30) || nowIso(),
  };
}

/* ---------- the project itself ---------- */
export function defaultColumns() {
  return [
    { id: "todo", name: "To do" },
    { id: "doing", name: "Doing" },
    { id: "waiting", name: "Waiting on" },
    { id: "done", name: "Done" },
  ];
}

export function cleanProject(raw) {
  if (!raw || typeof raw !== "object") return null;
  const pid = id(raw.id);
  if (!pid) return null;
  const name = str(raw.name, 160).trim();
  if (!name) return null;
  let columns = (Array.isArray(raw.columns) ? raw.columns : [])
    .map((c) => {
      if (!c || typeof c !== "object") return null;
      const cid = id(c.id);
      const cname = str(c.name, 60).trim();
      if (!cid || !cname) return null;
      return { id: cid, name: cname, done: c.done === true };
    })
    .filter(Boolean).slice(0, CAP.columns);
  // a board with no columns is not a board — never let a bad save leave one
  if (!columns.length) columns = defaultColumns();
  const columnIds = columns.map((c) => c.id);
  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .map((s) => cleanStep(s, columnIds)).filter(Boolean).slice(0, CAP.steps);
  return {
    id: pid,
    name,
    summary: str(raw.summary, 2000),
    status: pick(raw.status, STATUSES, "active"),
    accent: pick(raw.accent, ACCENTS, "orange"),
    startDate: ymd(raw.startDate),
    targetDate: ymd(raw.targetDate),
    columns,
    steps,
    canvas: (Array.isArray(raw.canvas) ? raw.canvas : [])
      .map(cleanCanvasItem).filter(Boolean).slice(0, CAP.canvas),
    // v213: archiving is what this page does instead of deleting. The record stays.
    archived: raw.archived === true,
    createdAt: str(raw.createdAt, 30) || nowIso(),
    lastUpdated: nowIso(),
  };
}

/* ---------- reading and writing ---------- */
export function projKeyOf(pid) { return PROJ_PREFIX + pid; }
export function fileKeyOf(fid) { return FILE_PREFIX + fid; }

export async function readProject(pid) {
  const key = projKeyOf(pid);
  if (!keyOk(key)) return null;
  return (await store().get(key, { type: "json" })) || null;
}

export async function writeProject(project) {
  const key = projKeyOf(project.id);
  if (!keyOk(key)) throw new Error("refused key " + key);
  await store().set(key, JSON.stringify(project));
  return project;
}

export async function listProjects() {
  const s = store();
  const { blobs } = await s.list({ prefix: PROJ_PREFIX });
  const keys = (blobs || []).map((b) => b.key).filter(keyOk).slice(0, CAP.projects);
  const out = [];
  for (const k of keys) {
    const p = await s.get(k, { type: "json" });
    if (p && p.id) out.push(p);
  }
  // newest work first, but a project that is finished drops below one that is not
  out.sort((a, b) => {
    const rank = (p) => (p.archived ? 3 : p.status === "done" ? 2 : 0);
    const d = rank(a) - rank(b);
    if (d) return d;
    return String(b.lastUpdated || "").localeCompare(String(a.lastUpdated || ""));
  });
  return out;
}

export async function readFile(fid) {
  const key = fileKeyOf(fid);
  if (!keyOk(key)) return null;
  return store().getWithMetadata(key, { type: "arrayBuffer" });
}

export async function writeFile(fid, bytes, metadata) {
  const key = fileKeyOf(fid);
  if (!keyOk(key)) throw new Error("refused key " + key);
  await store().set(key, bytes, { metadata });
  return fid;
}

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
