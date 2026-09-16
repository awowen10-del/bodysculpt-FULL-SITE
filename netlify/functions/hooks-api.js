// Netlify Function: hooks-api  (v177)
//
// Everything the Hooks tab does except the slow mining, which is hooks-mine-background.
//
//   GET  /api/hooks                     the library, the scripts, and what is waiting to be mined
//   POST { action: "options", topic }   eight hook options for a topic, from the library
//   POST { action: "write", topic, option, format }   the full script
//   POST { action: "save", script }     keep a script (or change its status)
//   POST { action: "status", id, status }  filmed / posted / binned
//   POST { action: "forget", id }       drop a hook from the library
//   POST { action: "retry" }            put the given-up-on reels back in the queue
//
// v178: the GET also reports the spoken-voice profile — when it was built, from how many
// reels, and what it says. Building it is voice-build-background's job, not this one's.
//
// Writing is a long call to Claude — the timeout is raised to 26s in netlify.toml, the same
// as mentor-ai, and the options call is deliberately eight hooks rather than ten so it lands
// inside it. Mining is not here: a video takes minutes, which is a background function's job.
import { readLib, writeLib, candidates, hookOptions, writeScript, config, clip, nowIso, json,
         normFormat, leadOf, parseBeats } from "../lib/hooks.js";
import { readVoice } from "../lib/schedule.js";

const STATUSES = ["draft", "filmed", "posted", "binned"];

export default async (req) => {
  const cfg = config();

  if (req.method === "GET") {
    const lib = await readLib();
    let waiting = 0;
    try { waiting = (await candidates(lib)).length; } catch { /* the count is a nicety, not the page */ }
    const v = await readVoice();
    return json({
      ok: true,
      configured: cfg.gemini && cfg.anthropic,
      config: cfg,
      hooks: lib.hooks,
      scripts: lib.scripts,
      waiting,
      skipped: lib.skipped.length,
      lastMineAt: lib.lastMineAt,
      lastMineNote: lib.lastMineNote,
      // the profile itself, not just a flag: the page shows it, because a voice profile Ash
      // cannot read is one he cannot tell is wrong
      voice: v ? { builtAt: v.builtAt || "", reels: (v.reels || []).length, words: v.words || 0,
                   profile: v.profile || "", banned: v.banned || [], note: v.note || "",
                   kind: v.kind || "spoken", spokenReels: v.spokenReels || 0,
                   // v181: WHEN the note was recorded, so an old failure cannot read as a
                   // current one, and a run in progress is visibly a run in progress
                   triedAt: v.triedAt || "", startedAt: v.startedAt || "" } : null,
    });
  }

  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body; try { body = await req.json(); } catch { return json({ ok: false, error: "Bad JSON" }, 400); }
  const action = clip(body && body.action, 20);

  try {
    if (action === "options") {
      const topic = clip(body.topic, 400).trim();
      if (!topic) return json({ ok: false, error: "Say what the reel is about first." }, 400);
      // v182: the format shapes the OPTIONS as well as the script — a silent reel's hook is
      // the card on screen, and asking for a spoken line first would bury it.
      return json({ ok: true, options: await hookOptions(topic, clip(body.format, 20)) });
    }

    if (action === "write") {
      const topic = clip(body.topic, 400).trim();
      const option = body.option;
      // v182: a silent reel's option has no spoken line at all, so the check is on whichever
      // line opens the reel rather than on `spoken`.
      if (!topic || !option || !leadOf(option, body.format)) return json({ ok: false, error: "Pick a hook first." }, 400);
      return json({ ok: true, script: await writeScript(topic, option, clip(body.format, 20)) });
    }

    if (action === "save") {
      const s = body.script;
      if (!s || !s.id || !s.body) return json({ ok: false, error: "Nothing to save." }, 400);
      // Rebuilt field by field rather than stored as sent. The script came from this site a
      // moment ago, but the request is just a request — anything the browser hands back is
      // taken on the same terms as anything else arriving over the wire, and the blob has a
      // size to keep.
      const kept = {
        id: clip(s.id, 40),
        createdAt: clip(s.createdAt, 40) || nowIso(),
        updatedAt: nowIso(),
        topic: clip(s.topic, 400),
        format: normFormat(s.format),
        hookId: clip(s.hookId, 40),
        type: clip(s.type, 40),
        spoken: clip(s.spoken, 200),
        onScreen: clip(s.onScreen, 120),
        lead: clip(s.lead, 200) || leadOf(s, s.format),
        // rebuilt through the same parser the writer used, so a hand-edited beat list is held
        // to the same shape as a generated one
        beats: Array.isArray(s.beats)
          ? s.beats.slice(0, 6).map((b) => ({ text: clip(b && b.text, 120), shot: clip(b && b.shot, 160) })).filter((b) => b.text)
          : parseBeats(s.beats),
        body: clip(s.body, 3000),
        cta: clip(s.cta, 300),
        caption: clip(s.caption, 1500),
        visual: clip(s.visual, 300),
        status: STATUSES.includes(s.status) ? s.status : "draft",
      };
      const lib = await readLib();
      lib.scripts = [kept, ...lib.scripts.filter((x) => x.id !== kept.id)];
      await writeLib(lib);
      return json({ ok: true, scripts: lib.scripts });
    }

    if (action === "status") {
      const id = clip(body.id, 40), status = clip(body.status, 20);
      if (!STATUSES.includes(status)) return json({ ok: false, error: "Unknown status." }, 400);
      const lib = await readLib();
      const it = lib.scripts.find((x) => x.id === id);
      if (!it) return json({ ok: false, error: "That script is not here any more." }, 404);
      it.status = status;
      it.updatedAt = nowIso();
      await writeLib(lib);
      return json({ ok: true, scripts: lib.scripts });
    }

    // v183: the skip list built up under the old rule holds reels that failed for reasons
    // that have since passed — a busy model, a dropped connection. This empties it so the
    // next run considers them again. Hooks already in the library are untouched, so nothing
    // is read or paid for twice.
    if (action === "retry") {
      const lib = await readLib();
      const forgotten = lib.skipped.length;
      lib.skipped = [];
      lib.lastMineNote = "";
      await writeLib(lib);
      let waiting = 0;
      try { waiting = (await candidates(lib)).length; } catch { /* the count is a nicety */ }
      return json({ ok: true, cleared: forgotten, waiting });
    }

    if (action === "forget") {
      const id = clip(body.id, 40);
      const lib = await readLib();
      lib.hooks = lib.hooks.filter((h) => h.id !== id);
      // remembered as skipped, or the next nightly run would mine it straight back in
      if (!lib.skipped.includes(id)) lib.skipped = lib.skipped.concat([id]);
      await writeLib(lib);
      return json({ ok: true, hooks: lib.hooks });
    }

    return json({ ok: false, error: "Unknown action." }, 400);
  } catch (e) {
    return json({ ok: false, error: clip((e && e.message) || "Something went wrong.", 300) }, 500);
  }
};
