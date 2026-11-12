// Netlify Function: store-backup-background  (v299)
//
// Does the nightly copy (netlify/lib/backup.js). One copy a day: a second call the same day
// finds the day's manifest and does nothing, so calling this address repeatedly costs nothing
// and changes nothing. It only reads the working stores.
import { runBackup } from "../lib/backup.js";
export default async () => {
  try {
    const r = await runBackup();
    console.log("[store-backup] " + JSON.stringify({ ok: r.ok, day: r.day, already: !!r.already, stores: r.stores, files: r.files, failed: (r.failed || []).length, pruned: r.pruned }));
  } catch (e) { console.log("[store-backup] failed " + String((e && e.message) || e)); }
};
