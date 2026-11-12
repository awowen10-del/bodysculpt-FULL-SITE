// Netlify Function: projects-purge-scheduled  (v298)
//
// Once a day: a project archived for 30 days goes for good, with the files only it used.
// Ash: "archive it and then if I do nothing with it for 30 days it deletes entirely." The rule
// and every guard live in netlify/lib/projects.js (purgeArchived); this only runs it. A few
// dozen small reads, so it does the work itself rather than handing it to a background function.
import { purgeArchived } from "../lib/projects.js";
export default async () => {
  try {
    const done = await purgeArchived();
    console.log("[projects-purge] " + JSON.stringify(done));
    return Response.json({ ok: true, ...done });
  } catch (e) {
    console.log("[projects-purge] failed " + String((e && e.message) || e));
    return Response.json({ ok: false }, { status: 500 });
  }
};
