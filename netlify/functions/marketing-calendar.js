// Netlify Function: marketing-calendar  (v277)
//
// The Content Calendar's one address. See netlify/lib/marketing-calendar.js.
//
//   GET  ?plan=1            the plan
//   GET  ?pulse=1[&fresh=1] what really went out, from GoHighLevel, Instagram and Meta
//   POST { op, ... }        one small change to the plan (saveItem, delItem, tick, target)
//
// Each feed fails on its own: a bad feed comes back as a sentence beside the two good ones.
import { readPlan, readPulse, applyOp, json } from "../lib/marketing-calendar.js";
import { readQueue } from "../lib/schedule.js";

export default async (req) => {
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      if (url.searchParams.get("plan") === "1") return json({ ok: true, plan: await readPlan() });
      if (url.searchParams.get("pulse") === "1") {
        return json(await readPulse(process.env, { readQueue }, { fresh: url.searchParams.get("fresh") === "1" }));
      }
      return json({ error: "Ask for ?plan=1 or ?pulse=1" }, 400);
    }
    if (req.method === "POST") {
      const r = await applyOp(await req.json());
      return json(r, r.error ? 400 : 200);
    }
    return json({ error: "GET or POST only" }, 405);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || "Something went wrong").slice(0, 200) }, 500);
  }
};
