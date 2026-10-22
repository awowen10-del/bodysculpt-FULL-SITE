// Netlify Function: money-chase  (v244)
//
// The "Money needing attention" card WITH the chase ladder. See netlify/lib/chase.js.
//
//   GET                              the same rows stripe-feed returns (one read, one
//                                    definition of owed), plus `chase`: per person, the
//                                    stage and what to do next, checked against Gmail
//   POST { op: "write", key }        write that person's due nudge NOW and save it as a
//                                    Gmail draft (also: write again after Ash deleted one)
//   POST { op: "finalSent", key, undo? }   Ash has sent the Slack message to Gaz (or not)
//
// NOTHING SENDS. Device key required (it reads Ash's mail) — without one the page uses
// stripe-feed and simply shows no ladder.
import { deviceOk } from "../lib/gmail.js";
import { readMoney } from "./stripe-feed.js";
import { buildChase, personKey, debtsFromMoney, readState, writeState, recordFor, gmailFacts, ladder, draftNudge, testEmail, CARD_UPDATE_URL, STAGES } from "../lib/chase.js";
import { env, clip } from "../lib/mail-drafts.js";

const json = (body, status) => new Response(JSON.stringify(body), {
  status: status || 200,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export default async (req) => {
  if (!(await deviceOk(req))) return json({ ok: false, error: "This browser is not connected to Gmail yet." }, 401);
  const key = env("STRIPE_SECRET_KEY") || env("STRIPE_API_KEY");
  if (!key) return json({ ok: true, configured: false, disputes: [], pastDue: [], failed: [], resolved: { count: 0 } });

  if (req.method === "GET") {
    try {
      const money = await readMoney(key);
      let chase = {}, chaseError = "";
      try { chase = (await buildChase(money, { write: false })).views; }
      catch (e) { chaseError = clip((e && e.message) || "The chase ladder could not be worked out.", 300); }
      // each row says whose chase it belongs to, so the page never works that out itself
      const tag = (rows) => (rows || []).map((r) => ({ ...r, chaseKey: personKey(r) }));
      return json({ ...money, pastDue: tag(money.pastDue), failed: tag(money.failed),
        chase, chaseError, chaseTest: testEmail(), cardUrl: CARD_UPDATE_URL, stages: STAGES });
    } catch (e) {
      return json({ ok: false, configured: true, error: clip((e && e.message) || "Could not reach Stripe", 300),
        disputes: [], pastDue: [], failed: [], resolved: { count: 0, attempts: 0, amount: 0, reasons: [] } });
    }
  }
  if (req.method !== "POST") return json({ ok: false, error: "GET or POST only." }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Could not read the request." }, 400); }
  const op = String((body && body.op) || "");
  const who = clip(body && body.key, 120);

  try {
    // The person is looked up in what Stripe says NOW — never taken on trust from the request.
    const debt = debtsFromMoney(await readMoney(key)).find((d) => d.key === who);
    if (!debt) return json({ ok: false, error: "They are no longer on the card — refresh." }, 404);
    const state = await readState();
    let rec = recordFor(state, debt);
    const now = Date.now();

    if (op === "write") {
      const facts = await gmailFacts(debt, rec);
      const view = ladder(debt, rec, facts, now);
      if (!(view.action === "write" || view.action === "draft-gone") || !(view.stage === "nudge1" || view.stage === "nudge2")) {
        return json({ ok: false, error: "There is nothing to draft for them right now.", chase: view }, 409);
      }
      rec = { ...rec, [view.stage]: await draftNudge(debt, rec, view.stage, facts) };
      state.debts[debt.key] = rec;
      await writeState(state);
      return json({ ok: true, chase: ladder(debt, rec, { ...facts, [view.stage]: { sent: false, sentAt: "", draftExists: true } }, now) });
    }

    if (op === "finalSent") {
      const facts = await gmailFacts(debt, rec);
      const view = ladder(debt, rec, facts, now);
      if (view.stage !== "final") return json({ ok: false, error: "They are not at the final stage." }, 409);
      const final = { ...(rec.final || {}), text: (rec.final && rec.final.text) || view.slack || "", draftedAt: (rec.final && rec.final.draftedAt) || new Date(now).toISOString() };
      if (body.undo) delete final.sentAt; else final.sentAt = now;
      rec = { ...rec, final };
      state.debts[debt.key] = rec;
      await writeState(state);
      return json({ ok: true, chase: ladder(debt, rec, facts, now) });
    }

    return json({ ok: false, error: "Unknown operation." }, 400);
  } catch (e) {
    return json({ ok: false, error: clip((e && e.message) || "Something went wrong.", 400) }, 502);
  }
};
