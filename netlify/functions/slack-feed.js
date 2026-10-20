// Netlify Function: slack-feed  (v223)
//
// The Daily Dashboard's team Slack card. See netlify/lib/slack.js for the whole picture.
//
//   GET                         the latest brief, minus what Ash has dealt with, plus whether
//                               Slack and Claude are switched on
//   POST { op: "refresh" }      start a fresh read (in the background function) — at most
//                               once every few minutes from the page
//   POST { op: "send", id, text }       post a reply AS ASH in the thread `id` names
//   POST { op: "react", id }            a :muscle: on that message, as Ash
//   POST { op: "undo", id }             take back what the dashboard just did on `id`
//                                       (deletes the posted message / removes the reaction)
//   POST { op: "done", id }             "dealt with — no reply needed": off the card
//   POST { op: "restore", id }          back on the card
//   POST { op: "draft", id, ask, current }   Claude rewrites the one reply
//
// THE GUARD, because this site has no login: every write names a conversation BY ITS ID IN
// THE CURRENT BRIEF. The function looks the message up there and posts into that channel,
// in that thread — it never takes a channel or a thread from the request. So the most a
// stranger who found this address could do is reply in a thread already on Ash's card, and
// he would see it there. Undo can only delete a message this function itself posted.
import {
  env, clip, slack, readBrief, readState, patchState, linkMentions, slackEscape, redraft, UNDO_SECONDS,
} from "../lib/slack.js";

const json = (body, status) => new Response(JSON.stringify(body), {
  status: status || 200,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const REFRESH_GAP_MS = 3 * 60 * 1000;
const REACTION = "muscle";

function findItem(brief, id) {
  if (!brief || !id) return null;
  return (brief.actions || []).find((a) => a.id === id) || (brief.sessions || []).find((s) => s.id === id) || null;
}

// The page never sees Ash's voice sample or the build bookkeeping.
function forPage(brief, state) {
  if (!brief) return null;
  const handled = state.handled || {};
  const recent = (state.sent || []).filter((s) => Date.now() - s.at < UNDO_SECONDS * 1000 && !s.undone);
  const { voice, ...rest } = brief;
  void voice;
  return {
    ...rest,
    actions: (brief.actions || []).filter((a) => !handled[a.id]),
    sessions: (brief.sessions || []).map((s) => (handled[s.id] ? { ...s, acknowledged: true, handledHow: handled[s.id].how } : s)),
    handledCount: Object.keys(handled).length,
    undoable: recent.map((s) => ({ id: s.id, kind: s.kind, at: s.at })),
  };
}

export default async (req) => {
  const ready = { slack: !!env("SLACK_USER_TOKEN"), claude: !!env("ANTHROPIC_API_KEY") };

  if (req.method === "GET") {
    if (!ready.slack) return json({ ok: true, ready, brief: null });
    const [brief, state] = await Promise.all([readBrief(), readState()]);
    return json({ ok: true, ready, brief: forPage(brief, state) });
  }
  if (req.method !== "POST") return json({ ok: false, error: "GET or POST only." }, 405);
  if (!ready.slack) return json({ ok: false, error: "Slack is not connected yet (SLACK_USER_TOKEN)." }, 400);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Could not read the request." }, 400); }
  const op = String((body && body.op) || "");
  const id = clip(body && body.id, 60);

  try {
    if (op === "refresh") {
      const brief = (await readBrief()) || {};
      const busy = brief.building && Date.now() - (brief.buildingSince || 0) < 6 * 60 * 1000;
      if (busy) return json({ ok: true, started: false, building: true });
      if (brief.builtAt && Date.now() - brief.builtAt < REFRESH_GAP_MS && !body.force) {
        return json({ ok: true, started: false, fresh: true });
      }
      const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || new URL(req.url).origin;
      const res = await fetch(base + "/.netlify/functions/slack-brief-background", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trigger: "page" }),
      });
      return json({ ok: res.status < 300, started: res.status < 300, building: res.status < 300 });
    }

    const brief = await readBrief();
    const item = findItem(brief, id);
    if (!item) return json({ ok: false, error: "That conversation is no longer on the card. Press Refresh." }, 404);
    const m = item.msg;

    if (op === "send") {
      const raw = String((body && body.text) || "").trim();
      if (!raw) return json({ ok: false, error: "There is nothing to send." }, 400);
      if (raw.length > 3500) return json({ ok: false, error: "That is too long for one Slack message." }, 400);
      const text = linkMentions(slackEscape(raw), brief.people);
      // a DM is answered in the DM; anything in a channel is answered in its thread
      const params = { channel: m.channel, text, unfurl_links: false, unfurl_media: false };
      if (!m.dm || (m.replies && m.replies.length)) params.thread_ts = m.ts;
      const out = await slack("chat.postMessage", params, true);
      await patchState((st) => {
        st.handled[id] = { at: Date.now(), how: "sent" };
        st.sent.push({ id, kind: "message", channel: m.channel, ts: out.ts, at: Date.now() });
        return st;
      });
      return json({ ok: true, ts: out.ts });
    }

    if (op === "react") {
      try { await slack("reactions.add", { channel: m.channel, timestamp: m.ts, name: REACTION }, true); }
      catch (e) { if (e.slackError !== "already_reacted") throw e; }
      await patchState((st) => {
        st.handled[id] = { at: Date.now(), how: "reacted" };
        st.sent.push({ id, kind: "reaction", channel: m.channel, ts: m.ts, at: Date.now() });
        return st;
      });
      return json({ ok: true });
    }

    if (op === "undo") {
      const st = await readState();
      const last = st.sent.filter((s) => s.id === id && !s.undone).sort((a, b) => b.at - a.at)[0];
      if (!last) return json({ ok: false, error: "There is nothing to take back on that one." }, 404);
      if (Date.now() - last.at > UNDO_SECONDS * 1000) return json({ ok: false, error: "It is too late to take that back from here — delete it in Slack." }, 400);
      if (last.kind === "message") await slack("chat.delete", { channel: last.channel, ts: last.ts }, true);
      else {
        try { await slack("reactions.remove", { channel: last.channel, timestamp: last.ts, name: REACTION }, true); }
        catch (e) { if (e.slackError !== "no_reaction") throw e; }
      }
      await patchState((s2) => {
        s2.sent.forEach((x) => { if (x.id === id && x.ts === last.ts && x.at === last.at) x.undone = true; });
        delete s2.handled[id];
        return s2;
      });
      return json({ ok: true });
    }

    if (op === "done") {
      await patchState((st) => { st.handled[id] = { at: Date.now(), how: "done" }; return st; });
      return json({ ok: true });
    }
    if (op === "restore") {
      await patchState((st) => { delete st.handled[id]; return st; });
      return json({ ok: true });
    }

    if (op === "draft") {
      if (!ready.claude) return json({ ok: false, error: "ANTHROPIC_API_KEY is not set." }, 400);
      const text = await redraft(item, clip(body.ask, 500), clip(body.current, 3000), brief.voice || "");
      return json({ ok: true, text });
    }

    return json({ ok: false, error: "Unknown operation." }, 400);
  } catch (e) {
    return json({ ok: false, error: clip((e && e.message) || "Something went wrong.", 400) }, 502);
  }
};
