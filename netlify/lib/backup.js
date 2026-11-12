// netlify/lib/backup.js  (v299)
//
// The nightly copy. Until now every plan, review, KPI week and transaction existed exactly
// once, and the audit of 12 Nov 2026 found several ways one bad save could destroy a record
// for good. This copies every record of the working stores into a SEPARATE store,
// "bodysculpt-backup", under the day's date, and keeps the last 30 days.
//
// What it never does: it never writes to, or deletes from, a working store. Its only writes
// and deletes are inside bodysculpt-backup, and a delete is only ever of a dated folder older
// than KEEP_DAYS (or an over-the-cap "before" copy; see keepPrevious).
//
// Layout in bodysculpt-backup:
//   d/<YYYY-MM-DD>/<store>/<key>      the record as it was that night
//   d/<YYYY-MM-DD>/_manifest          { at, stores: { <store>: <count> }, files, skipped }
//   files/<store>/<key>               uploaded files (projfile-*): copied once, they never change
//   prev/<store>/<key>/<ISO time>     the copy taken just before a risky overwrite (keepPrevious)
import { getStore } from "@netlify/blobs";

export const BACKUP_STORE = "bodysculpt-backup";
export const SOURCE_STORES = ["bodysculpt-kpi", "bodysculpt-mktcal", "bodysculpt-mail", "bodysculpt-takings"];
export const KEEP_DAYS = 30;
export const KEEP_PREVIOUS = 20;
const FILE_PREFIX = "projfile-";
// things that are rebuilt from outside and are not worth a copy
const SKIP = (key) => /^(ig-cache-|google-auth-access$|rate-|job-)/.test(key);
const DAY_MS = 86400000;
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const open = (name) => getStore({ name, consistency: "strong" });
export const dayOf = (now) => new Date(now).toISOString().slice(0, 10);

async function copyOne(from, to, key, toKey) {
  const got = await from.getWithMetadata(key, { type: "arrayBuffer" });
  if (!got || got.data == null) return false;
  await to.set(toKey, got.data, { metadata: got.metadata || {} });
  return true;
}

export async function runBackup(now = Date.now(), opts = {}) {
  const day = dayOf(now);
  const bak = open(BACKUP_STORE);
  const manifestKey = "d/" + day + "/_manifest";
  if (!opts.force) {
    const have = await bak.get(manifestKey, { type: "json" });
    if (have && have.complete) return { ok: true, day, already: true };
  }
  const out = { at: new Date(now).toISOString(), stores: {}, files: 0, skipped: 0, failed: [], complete: false };
  const haveFiles = new Set(((await bak.list({ prefix: "files/" })).blobs || []).map((b) => b.key));
  for (const name of SOURCE_STORES) {
    const src = open(name);
    let keys = [];
    try { keys = ((await src.list()).blobs || []).map((b) => b.key); }
    catch (e) { out.failed.push(name + ": could not list"); continue; }
    let n = 0;
    for (const key of keys) {
      if (SKIP(key)) { out.skipped++; continue; }
      try {
        if (key.startsWith(FILE_PREFIX)) {
          const fk = "files/" + name + "/" + key;
          if (!haveFiles.has(fk) && (await copyOne(src, bak, key, fk))) out.files++;
        } else if (await copyOne(src, bak, key, "d/" + day + "/" + name + "/" + key)) n++;
      } catch (e) { out.failed.push(name + "/" + key); }
    }
    out.stores[name] = n;
  }
  out.complete = out.failed.length === 0;
  await bak.set(manifestKey, JSON.stringify(out));
  const pruned = await pruneOld(now);
  return { ok: out.complete, day, ...out, pruned };
}

// dated folders older than KEEP_DAYS go. Only ever keys under "d/<date>/" in the backup store.
export async function pruneOld(now = Date.now()) {
  const bak = open(BACKUP_STORE);
  const cutoff = dayOf(now - KEEP_DAYS * DAY_MS);
  const keys = ((await bak.list({ prefix: "d/" })).blobs || []).map((b) => b.key);
  let gone = 0;
  for (const k of keys) {
    const m = /^d\/(\d{4}-\d{2}-\d{2})\//.exec(k);
    if (!m || !isDay(m[1]) || m[1] >= cutoff) continue;
    await bak.delete(k); gone++;
  }
  return gone;
}

/* Called by a save path just before it replaces a record wholesale: keeps the copy that is
   about to be overwritten, and the last KEEP_PREVIOUS of them. A failure here must never stop
   the save itself, so it swallows its own errors and says so in the log. */
export async function keepPrevious(storeName, key, currentText, now = Date.now()) {
  if (currentText == null || currentText === "") return false;
  try {
    const bak = open(BACKUP_STORE);
    const prefix = "prev/" + storeName + "/" + key + "/";
    await bak.set(prefix + new Date(now).toISOString(), typeof currentText === "string" ? currentText : JSON.stringify(currentText));
    const keys = ((await bak.list({ prefix })).blobs || []).map((b) => b.key).filter((k) => k.startsWith(prefix)).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_PREVIOUS))) await bak.delete(k);
    return true;
  } catch (e) { console.log("[backup] keepPrevious failed for " + key + ": " + String((e && e.message) || e)); return false; }
}

// what there is to restore from: the days held, and one day's manifest
export async function listBackups() {
  const bak = open(BACKUP_STORE);
  const keys = ((await bak.list({ prefix: "d/" })).blobs || []).map((b) => b.key).filter((k) => k.endsWith("/_manifest"));
  const days = [];
  for (const k of keys.sort().reverse()) { const m = await bak.get(k, { type: "json" }); days.push({ day: k.split("/")[1], at: m && m.at, complete: !!(m && m.complete), stores: (m && m.stores) || {} }); }
  return days;
}
export async function readBackup(day, storeName, key) {
  if (!isDay(day) || !SOURCE_STORES.includes(storeName) || typeof key !== "string" || !key || key.includes("/")) return null;
  return open(BACKUP_STORE).get("d/" + day + "/" + storeName + "/" + key, { type: "text" });
}
export async function listDay(day, storeName) {
  if (!isDay(day) || !SOURCE_STORES.includes(storeName)) return [];
  const prefix = "d/" + day + "/" + storeName + "/";
  return ((await open(BACKUP_STORE).list({ prefix })).blobs || []).map((b) => b.key.slice(prefix.length));
}
