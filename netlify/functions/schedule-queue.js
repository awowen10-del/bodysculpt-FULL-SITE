// Netlify Function: schedule-queue  (v170)
//
// The Scheduling page's queue. See netlify/lib/schedule.js for the whole picture.
//   GET  ?scan=1      look in the Drive folder for new videos, then return the queue
//   GET               just the queue (the page polls this while something is working)
//   POST { op, id, … }
//        update   caption, ytTitle, platforms, scheduledFor — Ash's edits
//        skip     put it aside      restore   bring it back to ready/new
//        remove   drop it from the queue (the file in Drive is untouched)
//        cancel   ask Zernio to cancel a scheduled post, then back to ready
// The slow work — transcribing, captioning, uploading, scheduling — is NOT here; it is
// in the two background functions, which the page calls directly.
import { config, readQueue, writeQueue, patchItem, scanDrive, zernioCancel, driveThumb, json, clip, PLATFORMS } from "../lib/schedule.js";

const PUBLISHED_AFTER_MS = 15 * 60 * 1000;   // a scheduled post whose time is a quarter-hour gone is treated as out

function decorate(items) {
  return items.map((it) => ({ ...it, thumb: driveThumb(it.driveId), transcript: undefined, hasTranscript: !!it.transcript }));
}

export default async (req) => {
  const url = new URL(req.url);
  const cfg = config();
  if (req.method === "GET") {
    // the transcript is long and only wanted when asked for
    const tid = clip(url.searchParams.get("transcript") || "", 40);
    if (tid) { const it = (await readQueue()).find((x) => x.id === tid); return json({ ok: true, transcript: it ? it.transcript || "" : "" }); }
    let scan = null;
    if (url.searchParams.get("scan") === "1" && cfg.drive) scan = await scanDrive();
    let items = await readQueue();
    // the template's rule: past its time by a quarter-hour and still "scheduled" = it went out
    const cutoff = Date.now() - PUBLISHED_AFTER_MS;
    let changed = false;
    items = items.map((it) => {
      if (it.status === "scheduled" && it.scheduledFor && Date.parse(it.scheduledFor) < cutoff) { changed = true; return { ...it, status: "published", updatedAt: new Date().toISOString() }; }
      return it;
    });
    if (changed) await writeQueue(items);
    return json({ ok: true, configured: cfg, scan, queue: decorate(items), fetchedAt: new Date().toISOString() });
  }
  if (req.method !== "POST") return json({ ok: false, error: "POST or GET only." }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Could not read the request." }, 400); }
  const op = body && body.op, id = clip(body && body.id, 40);
  if (!id) return json({ ok: false, error: "No item named." }, 400);
  const items = await readQueue();
  const it = items.find((x) => x.id === id);
  if (!it) return json({ ok: false, error: "That item is no longer in the queue." }, 404);

  if (op === "update") {
    const patch = {};
    if (typeof body.caption === "string") patch.caption = clip(body.caption, 2200);
    if (typeof body.ytTitle === "string") patch.ytTitle = clip(body.ytTitle, 100);
    if (Array.isArray(body.platforms)) patch.platforms = body.platforms.filter((p) => PLATFORMS.includes(p));
    if (body.scheduledFor === null) patch.scheduledFor = null;
    else if (typeof body.scheduledFor === "string" && !isNaN(Date.parse(body.scheduledFor))) patch.scheduledFor = new Date(body.scheduledFor).toISOString();
    if (it.status === "new" && patch.caption) patch.status = "ready";
    return json({ ok: true, item: await patchItem(id, patch) });
  }
  if (op === "skip") return json({ ok: true, item: await patchItem(id, { status: "skipped" }) });
  if (op === "restore") return json({ ok: true, item: await patchItem(id, { status: it.caption ? "ready" : "new", error: "" }) });
  if (op === "remove") { await writeQueue(items.filter((x) => x.id !== id)); return json({ ok: true, removed: id }); }
  if (op === "cancel") {
    if (it.status !== "scheduled") return json({ ok: false, error: "Only a scheduled post can be cancelled." }, 400);
    let cancelled = false;
    try { cancelled = await zernioCancel(it.zernioPostId); } catch { cancelled = false; }
    return json({ ok: true, cancelled, item: await patchItem(id, { status: "ready", zernioPostId: null,
      error: cancelled ? "" : "Zernio did not confirm the cancel — check it there too." }) });
  }
  return json({ ok: false, error: "Not something this function does." }, 400);
};
