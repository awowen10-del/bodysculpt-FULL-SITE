// netlify/lib/schedule.js  (v170)
//
// The Scheduling page's back end, shared by three functions:
//   schedule-queue.js                the queue: list, scan Drive, edit, skip, cancel
//   schedule-caption-background.js   transcribe one video and write its caption (slow)
//   schedule-publish-background.js   upload one video to Zernio and schedule it (slow)
//
// The idea, taken from the content-dashboard template: a Google Drive folder is the inbox.
// Every video dropped in it becomes a card. The video is transcribed (Gemini — the one
// model here that can watch a video), Claude writes a caption in Ash's own voice from his
// recent Instagram captions, Ash picks platforms and a time, and Zernio does the posting.
//
// One blob key, `sched-queue`: an array of items
//   { id, driveId, name, mime, size, createdTime, addedAt, status, transcript, caption,
//     ytTitle, platforms[], scheduledFor, zernioPostId, error, updatedAt }
// status: new → captioning → ready → scheduling → scheduled → published
//         (skipped and failed are side exits; failed keeps its error)
//
// Environment (all optional — the page says which are missing):
//   GOOGLE_DRIVE_API_KEY, GOOGLE_DRIVE_FOLDER_ID, GOOGLE_DRIVE_CUTOFF_DATE  the inbox
//   GEMINI_API_KEY                                                            transcription
//   ANTHROPIC_API_KEY                                                         the caption (already on the site)
//   ZERNIO_API_KEY, ZERNIO_ACCOUNT_INSTAGRAM/_FACEBOOK/_TIKTOK/_YOUTUBE       posting
import { getStore } from "@netlify/blobs";
import Anthropic from "@anthropic-ai/sdk";

export const KEY = "sched-queue";
export const PLATFORMS = ["instagram", "facebook", "tiktok", "youtube"];
const DRIVE = "https://www.googleapis.com/drive/v3";
const GEMINI = "https://generativelanguage.googleapis.com";
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-flash-latest"];
// v175: Google's "high demand" / 429 / 503 answers are temporary. Each model is tried up to
// three times with a growing pause before the next model is tried — a busy minute at
// Google must not cost Ash the caption.
const GEMINI_RETRY_WAITS_MS = [4000, 12000, 30000];
const isTransient = (status, msg) => status === 429 || status === 503 || /high demand|overloaded|try again later|resource exhausted|unavailable/i.test(msg || "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ZERNIO = "https://zernio.com/api/v1";
const MAX_ITEMS = 300;

const env = (k) => (process.env[k] || "").trim();
export const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");
export const nowIso = () => new Date().toISOString();

/* ---------- what is configured ---------- */
export function config() {
  const accounts = {};
  for (const p of PLATFORMS) { const v = env("ZERNIO_ACCOUNT_" + p.toUpperCase()); if (v) accounts[p] = v; }
  return {
    drive: !!(env("GOOGLE_DRIVE_API_KEY") && env("GOOGLE_DRIVE_FOLDER_ID")),
    gemini: !!env("GEMINI_API_KEY"),
    anthropic: !!env("ANTHROPIC_API_KEY"),
    zernio: !!(env("ZERNIO_API_KEY") && Object.keys(accounts).length),
    platforms: Object.keys(accounts),
    folderId: env("GOOGLE_DRIVE_FOLDER_ID"),
  };
}
export function zernioAccounts() {
  const accounts = {};
  for (const p of PLATFORMS) { const v = env("ZERNIO_ACCOUNT_" + p.toUpperCase()); if (v) accounts[p] = v; }
  return accounts;
}

/* ---------- the queue in the store ---------- */
const store = () => getStore({ name: "bodysculpt-kpi", consistency: "strong" });
export async function readQueue() {
  try { const q = await store().get(KEY, { type: "json" }); return Array.isArray(q) ? q : []; } catch { return []; }
}
export async function writeQueue(items) {
  await store().set(KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
}
// patch ONE item by id against a fresh read, so two writers cannot clobber each other's items
export async function patchItem(id, patch) {
  const items = await readQueue();
  const i = items.findIndex((it) => it.id === id);
  if (i < 0) return null;
  items[i] = { ...items[i], ...patch, updatedAt: nowIso() };
  await writeQueue(items);
  return items[i];
}

/* ---------- Google Drive, API-key mode: a folder shared "anyone with the link" ---------- */
async function driveGet(path, params) {
  const key = env("GOOGLE_DRIVE_API_KEY");
  if (!key) return null;
  const qs = new URLSearchParams({ ...(params || {}), key, supportsAllDrives: "true" });
  return fetch(DRIVE + path + "?" + qs.toString());
}
export async function listDriveMedia() {
  const folder = env("GOOGLE_DRIVE_FOLDER_ID"), cutoff = env("GOOGLE_DRIVE_CUTOFF_DATE");
  if (!folder) return { files: [], error: "GOOGLE_DRIVE_FOLDER_ID is not set." };
  const q = "'" + folder + "' in parents and trashed=false and (mimeType contains 'video/' or mimeType contains 'image/')" +
    (cutoff ? " and createdTime > '" + cutoff + "'" : "");
  const res = await driveGet("/files", { q, fields: "files(id,name,mimeType,size,createdTime)", orderBy: "createdTime desc", pageSize: "50", includeItemsFromAllDrives: "true" });
  if (!res) return { files: [], error: "GOOGLE_DRIVE_API_KEY is not set." };
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { files: [], error: clip((body.error && body.error.message) || ("Drive returned " + res.status), 300) };
  return { files: body.files || [] };
}
export async function downloadDriveFile(fileId) {
  const res = await driveGet("/files/" + encodeURIComponent(fileId), { alt: "media" });
  if (!res || !res.ok) throw new Error("Could not download the video from Google Drive" + (res ? " (" + res.status + ")" : "") + ".");
  return { buffer: await res.arrayBuffer(), mime: res.headers.get("content-type") || "video/mp4" };
}
export const driveThumb = (id) => "https://drive.google.com/thumbnail?id=" + encodeURIComponent(id) + "&sz=w640";

// merge the folder's files into the queue as new items; returns how many were added
export async function scanDrive() {
  const { files, error } = await listDriveMedia();
  if (error) return { added: 0, error };
  const items = await readQueue();
  const known = new Set(items.map((it) => it.driveId));
  let added = 0;
  for (const f of files) {
    if (known.has(f.id)) continue;
    items.unshift({
      id: "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      driveId: f.id, name: clip(f.name, 200), mime: clip(f.mimeType, 80), size: Number(f.size) || 0,
      createdTime: f.createdTime || null, addedAt: nowIso(), status: "new",
      transcript: "", caption: "", ytTitle: "", platforms: [], scheduledFor: null, zernioPostId: null, error: "", updatedAt: nowIso(),
    });
    added++;
  }
  if (added) await writeQueue(items);
  return { added };
}

/* ---------- Gemini: asking a question of a video ----------
   v177: this was the body of transcribe(), which is now a one-line caller. The Hooks page
   asks a DIFFERENT question of a competitor's reel — what is said in the first three
   seconds, and what is written on the screen — and everything around the question is the
   same: the resumable upload, the wait for Google to finish processing, the walk down the
   model list, the retry on a busy minute, the delete afterwards. Splitting it here means
   the hook miner inherits all of that hardening rather than owning a second copy of it. */
export async function geminiAsk(buffer, mime, name, prompt, limit) {
  const key = env("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not set, so the video cannot be read.");
  // resumable upload: start, then upload+finalize
  const start = await fetch(GEMINI + "/upload/v1beta/files?key=" + key, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(buffer.byteLength), "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: name } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!start.ok || !uploadUrl) throw new Error("Gemini would not accept the video (" + start.status + ").");
  const up = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "X-Goog-Upload-Command": "upload, finalize", "X-Goog-Upload-Offset": "0", "Content-Length": String(buffer.byteLength) },
    body: buffer,
  });
  const upBody = await up.json().catch(() => ({}));
  const file = upBody.file || {};
  if (!up.ok || !file.uri) throw new Error("Gemini upload failed (" + up.status + ").");
  // wait for Gemini to process the file
  let state = file.state || "PROCESSING";
  for (let i = 0; i < 40 && state === "PROCESSING"; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const chk = await fetch(GEMINI + "/v1beta/" + file.name + "?key=" + key);
    const b = await chk.json().catch(() => ({}));
    state = b.state || "PROCESSING";
  }
  if (state !== "ACTIVE") throw new Error("Gemini did not finish processing the video (" + state + ").");
  let lastErr = "";
  try {
    for (const model of GEMINI_MODELS) {
      for (let attempt = 0; attempt < GEMINI_RETRY_WAITS_MS.length; attempt++) {
        const res = await fetch(GEMINI + "/v1beta/models/" + model + ":generateContent?key=" + key, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ file_data: { mime_type: mime, file_uri: file.uri } }, { text: prompt }] }] }),
        });
        const b = await res.json().catch(() => ({}));
        if (res.ok) {
          const text = (((b.candidates || [])[0] || {}).content || {}).parts;
          const out = Array.isArray(text) ? text.map((p) => p.text || "").join("").trim() : "";
          if (out) return clip(out, limit || 6000);
        }
        // v183: keep the STATUS alongside Google's wording. "This model is currently
        // experiencing high demand" is what Google says for a genuinely busy model (503) and
        // for an exhausted quota (429) alike, and the two need completely different
        // responses — wait ten minutes, or wait until the quota resets. Without the number
        // there is no way to tell them apart from the outside.
        const detail = (b.error && b.error.message) || "";
        const status = res.status + (b.error && b.error.status ? "/" + b.error.status : "");
        lastErr = clip(detail ? detail + " [" + model + ", HTTP " + status + "]" : ("Gemini returned " + status + " [" + model + "]"), 240);
        if (!isTransient(res.status, lastErr)) break;          // a real refusal: next model, now
        await sleep(GEMINI_RETRY_WAITS_MS[attempt]);           // busy: wait, then the same model again
      }
    }
  } finally {
    fetch(GEMINI + "/v1beta/" + file.name + "?key=" + key, { method: "DELETE" }).catch(() => {});
  }
  throw new Error("Gemini could not read the video: " + lastErr);
}

export async function transcribe(buffer, mime, name) {
  return await geminiAsk(buffer, mime, name,
    "Transcribe everything that is said in this video, word for word, as plain text. If nothing is said, describe in two sentences what is shown on screen and any on-screen text.");
}

/* ---------- Claude: the caption, in Ash's voice ---------- */
// his recent captions, from the Instagram feed's cache if it is warm — the voice reference
export async function voiceReference() {
  try {
    const mine = await store().get("ig-cache-mine", { type: "json" });
    const caps = ((mine && mine.posts) || []).map((p) => p.caption).filter((c) => c && c.length > 20).slice(0, 10);
    return caps.map((c, i) => (i + 1) + '. "' + c.slice(0, 300) + '"').join("\n");
  } catch { return ""; }
}

/* ---------- v178: the spoken voice ----------
   Captions were the only voice reference this site had, and they are the weaker half: how
   Ash WRITES a caption is not how he TALKS to camera. lib/voice.js transcribes his own best
   reels and writes a profile from what he actually says; this is the read side of it, kept
   here rather than there so schedule.js imports nothing from voice.js and the one import
   runs in a single direction (voice.js -> schedule.js, for geminiAsk).

   Both callers embed the block VERBATIM and add no heading of their own, because the two
   sources need different framing — a profile is an instruction, a list of captions is
   evidence — and only this function knows which one came back. */
export const VOICE_KEY = "ig-voice";

export async function readVoice() {
  try { const v = await store().get(VOICE_KEY, { type: "json" }); return v && typeof v === "object" ? v : null; }
  catch { return null; }
}

export async function voiceBrief() {
  const v = await readVoice();
  if (v && v.profile) {
    // v182: the heading names the EVIDENCE. A profile built from on-screen text and captions
    // introduced as "how Ash talks on camera" invites the model to write him a monologue —
    // which is the whole thing v182 exists to stop.
    const head = v.kind === "written"
      ? "HOW ASH WRITES. He rarely speaks to camera; his voice lives in the text on screen and in his captions, " +
        "and this is drawn from his own best-performing reels and captions"
      : v.kind === "mixed"
        ? "HOW ASH COMMUNICATES, drawn from his own best-performing reels — what he says, what he puts on screen, and how he writes his captions"
        : "HOW ASH TALKS ON CAMERA, drawn from transcripts of his own best reels";
    return head + ". Follow it over any instinct about how social copy should sound:\n\n" +
      v.profile +
      (v.banned && v.banned.length
        ? "\n\nNever write these — they are not his words:\n" + v.banned.map((b) => "· " + b).join("\n")
        : "");
  }
  const caps = await voiceReference();
  return caps ? "Ash's recent captions, for his vocabulary (written, not spoken — match the words, not the rhythm):\n" + caps : "";
}
export function captionPrompt(transcript, name, voice, wantYoutube) {
  return "You write the social media captions for Bodysculpt, a gym in Warrington, UK, run by Ash. " +
    "The audience is local people who want to lose weight, get stronger and feel better — busy, ordinary, a bit nervous about gyms. Plain British English, no hype.\n\n" +
    (voice ? voice + "\n\n" : "") +
    (transcript ? 'Transcript of the video:\n"' + transcript.slice(0, 3000) + '"\n\n' : 'There is no transcript. The file is called "' + name + '".\n\n') +
    "Write the caption in this exact shape:\n" +
    "LINE 1 — the hook: one short sentence, specific to what is actually said or shown. Never generic.\n" +
    "LINE 2 — the call to action, by these rules in order: (a) if they tell viewers to comment a specific word, write exactly: Comment \"WORD\" for the [thing offered]; " +
    "(b) if they ask for something else specific (DM, link in bio, save, share), say that in plain words; (c) otherwise write exactly: Follow @bodysculptwarrington for more.\n" +
    "Then a blank line, then 3–5 lowercase hashtags relevant to the video and to Warrington.\n" +
    "Rules: match Ash's tone; no emojis; under 500 characters; never invent an offer or a call to action that is not in the transcript.\n" +
    (wantYoutube ? "\nAlso write a YouTube Shorts title: under 80 characters, no hashtags, makes people click.\n" : "") +
    "\nAnswer in exactly this format:\n---CAPTION---\n(the caption)\n" + (wantYoutube ? "---YOUTUBE_TITLE---\n(the title)\n" : "");
}
export async function writeCaption(transcript, name, wantYoutube) {
  if (!env("ANTHROPIC_API_KEY")) throw new Error("ANTHROPIC_API_KEY is not set.");
  const client = new Anthropic();
  const voice = await voiceBrief();
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: captionPrompt(transcript, name, voice, wantYoutube) }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to write this caption.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const cap = /---CAPTION---\s*([\s\S]*?)(?:---YOUTUBE_TITLE---|$)/.exec(text);
  const yt = /---YOUTUBE_TITLE---\s*([\s\S]*?)$/.exec(text);
  const caption = clip((cap ? cap[1] : text).trim(), 2200);
  if (!caption) throw new Error("Claude returned no caption.");
  return { caption, ytTitle: clip((yt ? yt[1] : "").trim(), 100) };
}

/* ---------- Zernio: the posting ---------- */
const zHeaders = () => ({ Authorization: "Bearer " + env("ZERNIO_API_KEY"), "Content-Type": "application/json" });
export async function zernioUpload(name, mime, buffer) {
  const pre = await fetch(ZERNIO + "/media/presign", { method: "POST", headers: zHeaders(), body: JSON.stringify({ filename: name, contentType: mime }) });
  const b = await pre.json().catch(() => ({}));
  if (!pre.ok || !b.uploadUrl || !b.publicUrl) throw new Error("Zernio would not accept the upload (" + pre.status + ").");
  const put = await fetch(b.uploadUrl, { method: "PUT", headers: { "Content-Type": mime }, body: buffer });
  if (!put.ok) throw new Error("Uploading the video to Zernio failed (" + put.status + ").");
  return b.publicUrl;
}
export async function zernioSchedule({ caption, mediaUrl, isVideo, platforms, scheduledFor, ytTitle }) {
  const accounts = zernioAccounts();
  const entries = platforms.filter((p) => accounts[p]).map((p) => {
    const e = { platform: p, accountId: accounts[p] };
    if (p === "youtube") e.platformSpecificData = { title: ytTitle || caption.slice(0, 100), visibility: "public", madeForKids: false };
    return e;
  });
  if (!entries.length) throw new Error("None of the chosen platforms is connected in Zernio.");
  const body = { content: caption, platforms: entries, scheduledFor: new Date(scheduledFor).toISOString() };
  if (mediaUrl) body.mediaItems = [{ type: isVideo ? "video" : "image", url: mediaUrl }];
  const res = await fetch(ZERNIO + "/posts", { method: "POST", headers: zHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error("Zernio would not schedule it: " + clip(await res.text().catch(() => ""), 300));
  const data = await res.json().catch(() => ({}));
  return (data.post && data.post._id) || data._id || data.id || "scheduled";
}
export async function zernioCancel(postId) {
  if (!postId || postId === "scheduled") return false;
  const res = await fetch(ZERNIO + "/posts/" + encodeURIComponent(postId), { method: "DELETE", headers: zHeaders() });
  return res.ok || res.status === 404;
}

/* ---------- replies ---------- */
export const json = (body, status) => Response.json(body, { status: status || 200 });
