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
//   POST { action: "ideas", force }     five reels he could film this week (cached for the day)
//   POST { action: "about", about }     his own note about the business, which sharpens them
//   POST { action: "keepIdea" / "dropIdea", id }   hold one past its ten days, or bin it now
//   POST { action: "check", draft }     mark a draft against the rules his own voice profile set
//   POST { action: "ban" / "unban" }    phrases he never wants to see again
//   POST { action: "trends", week, notes, accounts }   the Friday trend scout posting its findings
//   POST { action: "dropAccount", username }           a suggested account he does not want
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
import { readIdeas, generate as generateIdeas, gather, isFresh, setAbout, setIdeaFlag, markIdeaUsed } from "../lib/ideas.js";
import { matchPerformance, checkPrompt, parseCheck } from "../lib/learn.js";
import { readTrends, addTrends, dismissAccount, pending } from "../lib/trends.js";
import { getStore } from "@netlify/blobs";
import Anthropic from "@anthropic-ai/sdk";

const STATUSES = ["draft", "filmed", "posted", "binned"];

export default async (req) => {
  const cfg = config();

  if (req.method === "GET") {
    const lib = await readLib();
    let waiting = 0;
    try { waiting = (await candidates(lib)).length; } catch { /* the count is a nicety, not the page */ }
    const v = await readVoice();
    const ideas = await readIdeas();
    const trends = await readTrends();
    let suggested = [];
    try {
      const watched = (await getStore({ name: "bodysculpt-kpi", consistency: "strong" }).get("ig-competitors", { type: "json" })) || [];
      suggested = pending(trends, watched);
    } catch { /* the suggestions are a nicety, not the page */ }
    // v194: tie posted scripts back to the reels they became, so the page and the writer both
    // see what actually happened rather than only what was written
    let scripts = lib.scripts;
    try {
      const mine = await getStore({ name: "bodysculpt-kpi", consistency: "strong" }).get("ig-cache-mine", { type: "json" });
      scripts = matchPerformance(lib.scripts, (mine && mine.posts) || []);
    } catch { /* no cache means no numbers yet, not a broken page */ }
    return json({
      ok: true,
      configured: cfg.gemini && cfg.anthropic,
      config: cfg,
      hooks: lib.hooks,
      scripts,
      waiting,
      skipped: lib.skipped.length,
      // v192: what to film. The page leads with these; the topic box is the fallback for when
      // he already knows, not the front door.
      ideas: ideas.ideas, ideasAt: ideas.generatedAt, ideasFresh: isFresh(ideas), about: ideas.about,
      // v198: what the Friday scout found out in the wider feed, and the gyms it thinks are
      // worth watching. The notes feed the ideas engine; the accounts are his call.
      trends: { week: trends.week, postedAt: trends.postedAt, notes: trends.notes, suggested },
      lastMineAt: lib.lastMineAt,
      lastMineNote: lib.lastMineNote,
      // the profile itself, not just a flag: the page shows it, because a voice profile Ash
      // cannot read is one he cannot tell is wrong
      voice: v ? { builtAt: v.builtAt || "", reels: (v.reels || []).length, words: v.words || 0,
                   profile: v.profile || "", banned: v.banned || [], note: v.note || "",
                   kind: v.kind || "spoken", spokenReels: v.spokenReels || 0, userBanned: v.userBanned || [],
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
        // v194: the seven he did NOT take are the other half of the signal. Which archetypes
        // he is offered and passes over says as much as the one he keeps.
        shown: Array.isArray(s.shown)
          ? s.shown.slice(0, 12).map((o) => ({ lead: clip(o && o.lead, 120), type: clip(o && o.type, 40), hookId: clip(o && o.hookId, 40) }))
          : [],
        checked: Array.isArray(s.checked) ? s.checked.slice(0, 8).map((x) => clip(x, 200)) : [],
      };
      const lib = await readLib();
      lib.scripts = [kept, ...lib.scripts.filter((x) => x.id !== kept.id)];
      await writeLib(lib);
      // v200: the idea it came from is marked rather than removed, so on Friday he can see
      // which of the week's suggestions he actually turned into something
      let ideas = null;
      if (body.ideaId) { try { ideas = (await markIdeaUsed(clip(body.ideaId, 40), kept.id)).ideas; } catch { /* the script is saved either way */ } }
      return json({ ok: true, scripts: lib.scripts, ideas });
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
    if (action === "ideas") {
      const cur = await readIdeas();
      // today's ideas are today's. Regenerating on every page load would spend money to hand
      // him a different five each time he changed tabs, which is its own kind of noise.
      if (!body.force && isFresh(cur) && cur.ideas.length) return json({ ok: true, ideas: cur.ideas, ideasAt: cur.generatedAt, cached: true });
      const lib = await readLib();
      const fresh = await generateIdeas(await gather(lib));
      return json({ ok: true, ideas: fresh.ideas, ideasAt: fresh.generatedAt, cached: false });
    }

    /* v194: the rules his voice profile set, finally marked against. A profile that ends in
       six checkable rules and never checks anything looks thorough and changes nothing. Kept
       as its own request so neither call goes near the 26-second wall. */
    /* v198: the Friday scout, posting on its way out. It drives Ash's own logged-in Chrome,
       which is why it cannot live in here — a Netlify function has no browser and no Instagram
       session. So it stays where it is and hands its findings over instead. */
    if (action === "trends") {
      const t = await addTrends({ week: clip(body.week, 40), notes: body.notes, accounts: body.accounts, clear: !!body.clear });
      return json({ ok: true, notes: t.notes.length, accounts: t.accounts.length });
    }

    if (action === "dropAccount") {
      const t = await dismissAccount(clip(body.username, 40));
      let suggested = [];
      try {
        const watched = (await getStore({ name: "bodysculpt-kpi", consistency: "strong" }).get("ig-competitors", { type: "json" })) || [];
        suggested = pending(t, watched);
      } catch { /* same */ }
      return json({ ok: true, suggested });
    }

    if (action === "check") {
      const draft = clip(body.draft, 4000);
      if (!draft) return json({ ok: false, error: "Nothing to check." }, 400);
      const v = await readVoice();
      if (!v || !v.profile) return json({ ok: true, failed: [], fixed: draft, skipped: "no voice profile yet" });
      const banned = (v.banned || []).concat(v.userBanned || []);
      const client = new Anthropic();
      const r = await client.messages.create({
        model: "claude-opus-5", max_tokens: 3000, output_config: { effort: "low" },
        messages: [{ role: "user", content: checkPrompt(draft, v.profile, banned) }],
      });
      if (r.stop_reason === "refusal") return json({ ok: true, failed: [], fixed: draft });
      const out = parseCheck(r.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
      return json({ ok: true, failed: out.failed, fixed: out.fixed || draft });
    }

    // his own banned phrases, on top of the ones read from his reels. The moment he sees a
    // phrase that is not him, he should be able to kill it rather than mention it to somebody.
    if (action === "ban" || action === "unban") {
      const phrase = clip(body.phrase, 90).trim();
      if (!phrase) return json({ ok: false, error: "Nothing to ban." }, 400);
      const store = getStore({ name: "bodysculpt-kpi", consistency: "strong" });
      const v = (await store.get("ig-voice", { type: "json" })) || {};
      const cur = Array.isArray(v.userBanned) ? v.userBanned : [];
      v.userBanned = action === "ban"
        ? (cur.includes(phrase) ? cur : cur.concat([phrase])).slice(0, 40)
        : cur.filter((x) => x !== phrase);
      await store.set("ig-voice", JSON.stringify(v));
      return json({ ok: true, userBanned: v.userBanned });
    }

    /* v200: the shelf is his to curate. Keeping one holds it past the ten days it would
       otherwise age out after; dropping one takes it off now rather than leaving a dud sitting
       there until Friday. */
    if (action === "keepIdea" || action === "dropIdea") {
      const id = clip(body.id, 40);
      if (!id) return json({ ok: false, error: "Which one?" }, 400);
      const r = await setIdeaFlag(id, action === "dropIdea" ? { drop: true } : { kept: body.kept !== false });
      return json({ ok: true, ideas: r.ideas });
    }

    if (action === "about") {
      const saved = await setAbout(clip(body.about, 40000));
      return json({ ok: true, about: saved.about });
    }

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
