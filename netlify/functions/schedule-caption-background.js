// Netlify Function: schedule-caption-background  (v170)
//
// One video: download it from Drive, transcribe it with Gemini, have Claude write the
// caption in Ash's voice. A BACKGROUND function (the -background suffix): Netlify answers
// 202 at once and lets this run for up to fifteen minutes, which a video needs. Progress
// is written to the queue item (status captioning → ready, or failed with the reason) and
// the page polls schedule-queue to see it land.
//   POST { id }
import { readQueue, patchItem, downloadDriveFile, transcribe, writeCaption, config, clip } from "../lib/schedule.js";

export default async (req) => {
  if (req.method !== "POST") return;
  let body; try { body = await req.json(); } catch { return; }
  const id = clip(body && body.id, 40);
  const items = await readQueue();
  const it = items.find((x) => x.id === id);
  if (!it) return;
  await patchItem(id, { status: "captioning", error: "" });
  try {
    const cfg = config();
    let transcript = it.transcript || "";
    if (!transcript && cfg.gemini && /^video\//.test(it.mime || "")) {
      const file = await downloadDriveFile(it.driveId);
      transcript = await transcribe(file.buffer, file.mime, it.name);
    }
    const wantYoutube = cfg.platforms.includes("youtube");
    const { caption, ytTitle } = await writeCaption(transcript, it.name, wantYoutube);
    await patchItem(id, { status: "ready", transcript, caption, ytTitle, error: "" });
  } catch (e) {
    await patchItem(id, { status: it.caption ? "ready" : "new", error: clip((e && e.message) || "Could not write the caption.", 300) });
  }
};
