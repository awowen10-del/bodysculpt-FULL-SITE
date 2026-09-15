// Netlify Function: schedule-publish-background  (v170)
//
// One video: download it from Drive, upload it to Zernio, schedule the post. Background,
// for the same reason as the caption one — a video takes longer than a request may.
// status scheduling → scheduled (with Zernio's post id), or failed with the reason.
//   POST { id }
import { readQueue, patchItem, downloadDriveFile, zernioUpload, zernioSchedule, config, clip } from "../lib/schedule.js";

export default async (req) => {
  if (req.method !== "POST") return;
  let body; try { body = await req.json(); } catch { return; }
  const id = clip(body && body.id, 40);
  const items = await readQueue();
  const it = items.find((x) => x.id === id);
  if (!it) return;
  const cfg = config();
  const problem = !cfg.zernio ? "Zernio is not connected yet."
    : !it.caption ? "Write the caption first."
    : !(it.platforms || []).length ? "Pick at least one platform."
    : !it.scheduledFor ? "Pick a date and time." : "";
  if (problem) { await patchItem(id, { status: "ready", error: problem }); return; }
  await patchItem(id, { status: "scheduling", error: "" });
  try {
    const file = await downloadDriveFile(it.driveId);
    const mediaUrl = await zernioUpload(it.name, file.mime, file.buffer);
    const postId = await zernioSchedule({
      caption: it.caption, mediaUrl, isVideo: /^video\//.test(file.mime), platforms: it.platforms, scheduledFor: it.scheduledFor, ytTitle: it.ytTitle,
    });
    await patchItem(id, { status: "scheduled", zernioPostId: String(postId), error: "" });
  } catch (e) {
    await patchItem(id, { status: "ready", error: clip((e && e.message) || "Could not schedule it.", 300) });
  }
};
