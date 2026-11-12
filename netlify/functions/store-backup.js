// Netlify Function: store-backup  (v299)   READ ONLY
//
// What the nightly copy holds, for putting something back by hand:
//   GET                              the days held and how many records each store had
//   GET ?day=YYYY-MM-DD&store=NAME   the record names held for that day
//   GET ?day=…&store=…&key=…         one record exactly as it was that night
// There is deliberately no "restore" here: putting a record back is a decision, made per
// record, and goes through the normal save path of the page that owns it.
import { listBackups, listDay, readBackup } from "../lib/backup.js";
export default async (req) => {
  if (req.method !== "GET") return Response.json({ error: "Read only" }, { status: 405 });
  const q = new URL(req.url).searchParams;
  const day = q.get("day"), store = q.get("store"), key = q.get("key");
  try {
    if (day && store && key) {
      const text = await readBackup(day, store, key);
      if (text == null) return Response.json({ error: "Nothing held under that name" }, { status: 404 });
      return new Response(text, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
    if (day && store) return Response.json({ day, store, keys: await listDay(day, store) }, { headers: { "Cache-Control": "no-store" } });
    return Response.json({ days: await listBackups() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return Response.json({ error: "Could not read the backup" }, { status: 500 }); }
};
