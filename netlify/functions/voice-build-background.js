// Netlify Function: voice-build-background  (v178)
//
// Transcribe Ash's best reels and write the spoken-voice profile. A BACKGROUND function
// (202 at once, up to fifteen minutes): ten reels transcribed in full is the slowest job on
// the site, most of it spent waiting for Google to finish processing each upload.
//
//   POST {}     build it (the page's "Learn how I talk")
//
// There is no nightly schedule and there should not be: a voice does not drift week to week,
// and rebuilding it nightly would spend real money describing the same person again. Ash
// presses the button when he feels his content has moved on.
//
// The profile it writes is read by lib/schedule.js's voiceBrief(), which means one build
// improves BOTH the captions on the Scheduling page and the scripts on the Hooks tab.
import { buildVoice } from "../lib/voice.js";
import { getStore } from "@netlify/blobs";
import { VOICE_KEY } from "../lib/schedule.js";

export default async (req) => {
  const log = (e) => console.log("[voice-build] " + JSON.stringify(e));
  if (req.method !== "POST") return;
  try {
    const v = await buildVoice(log);
    log({ stage: "done", reels: v.reels.length, words: v.words, banned: v.banned.length });
  } catch (e) {
    const message = String((e && e.message) || e).slice(0, 300);
    log({ stage: "error", message });
    // The failure is written where the page will see it, rather than only into a log Ash
    // would have to go to Netlify to read. A previous good profile is never overwritten by
    // a failed run — only its note is.
    try {
      const store = getStore({ name: "bodysculpt-kpi", consistency: "strong" });
      const prev = (await store.get(VOICE_KEY, { type: "json" })) || {};
      await store.set(VOICE_KEY, JSON.stringify({ ...prev, note: message, triedAt: new Date().toISOString() }));
    } catch { /* if the note cannot be written the log still has it */ }
  }
};
