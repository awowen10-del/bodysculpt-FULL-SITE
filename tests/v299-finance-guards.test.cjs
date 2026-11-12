// v299: Finances' share of the audit's data-loss routes.
//  - the rows on screen can only be saved under the month they were loaded for
//  - a month that fails to load is an error, and the old month's rows cannot be saved over it
//  - a save carries the version the page read; a refused (stale) save reloads the month
//  - rules, debts and settings that did not load cannot be saved over the real ones
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/finance-env.cjs");
const HTML = fs.readFileSync(path.join(__dirname, "..", "finances.html"), "utf8");
const row = (id, date, desc) => ({ id, date, desc, amt: 10, dir: "out", cat: "Rent", hash: id });
const OCT = "2026-10", NOV = "2026-11";

function wire(env, served, mode) {
  const posts = [];
  env.ctx.fetch = async (url, o) => {
    const u = String(url);
    const reply = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });
    if (o && o.method === "POST") {
      const body = JSON.parse(o.body); posts.push(body);
      if (body.finTxns) {
        const ym = body.finTxns.ym, cur = served[ym] || { rows: [], lastUpdated: "" };
        if (typeof body.base === "string" && body.base !== (cur.lastUpdated || "")) return reply({ ok: false, conflict: true }, 409);
        served[ym] = { rows: body.finTxns.rows, lastUpdated: "t" + posts.length };
        return reply({ ok: true, ym, count: body.finTxns.rows.length, lastUpdated: served[ym].lastUpdated });
      }
      return reply({ ok: true });
    }
    const m = /fintxns=([0-9-]+)/.exec(u);
    if (m) {
      if (mode.failRead === m[1]) return reply({ error: "x" }, 502);
      if (mode.delay && mode.delay[m[1]]) await new Promise((r) => setTimeout(r, mode.delay[m[1]]));
      const cur = served[m[1]] || { rows: [], lastUpdated: "" };
      return reply({ ym: m[1], rows: JSON.parse(JSON.stringify(cur.rows)), lastUpdated: cur.lastUpdated });
    }
    return reply({});
  };
  return posts;
}

(async () => {
  const env = await boot({ now: "2026-11-12", txns: { [NOV]: [row("n1", "2026-11-02", "November rent")] } });
  const { S, ctx } = env; const toasts = []; ctx.toast = (m) => toasts.push(m);
  const served = { [OCT]: { rows: [row("o1", "2026-10-02", "October rent"), row("o2", "2026-10-09", "October bill")], lastUpdated: "to" },
                   [NOV]: { rows: [row("n1", "2026-11-02", "November rent")], lastUpdated: "tn" } };
  const mode = {}; const posts = wire(env, served, mode);
  S.ym = NOV; await ctx.loadMonth();
  assert.strictEqual(S.allYm, NOV);

  // a save carries the version read, and the store's new stamp is adopted
  await ctx.postTxns(NOV, S.all);
  assert.strictEqual(posts[posts.length - 1].base, "tn");
  const after = served[NOV].lastUpdated;

  // a month that fails to load: the old rows are not left in memory under the new month's name
  mode.failRead = OCT; S.ym = OCT; await ctx.loadMonth();
  assert.strictEqual(S.allYm, "", "no month is loaded");
  assert.strictEqual(S.all.length, 0);
  assert.ok(toasts.some((t) => /didn't load/.test(t)));
  let threw = false; try { await ctx.postTxns(OCT, S.all); } catch (e) { threw = true; }
  assert.ok(threw, "nothing can be saved under a month that did not load");
  assert.strictEqual(served[OCT].rows.length, 2, "October is untouched");
  mode.failRead = "";

  // two quick month taps: the slower, older answer is dropped
  mode.delay = { [OCT]: 80 };
  S.ym = OCT; const p1 = ctx.loadMonth(); S.ym = NOV; const p2 = ctx.loadMonth();
  await Promise.all([p1, p2]);
  assert.strictEqual(S.allYm, NOV);
  assert.strictEqual(S.all[0].desc, "November rent", "November's rows are under November's name");
  mode.delay = null;

  // a stale page: another device changed the month; this page's save is refused and it reloads
  served[NOV] = { rows: [row("n1", "2026-11-02", "November rent"), row("n2", "2026-11-10", "Imported on the laptop")], lastUpdated: "t-elsewhere" };
  threw = false; try { await ctx.postTxns(NOV, S.all); } catch (e) { threw = true; }
  assert.ok(threw);
  assert.strictEqual(served[NOV].rows.length, 2, "the newer month is not overwritten");
  assert.strictEqual(S.all.length, 2, "and the page now holds the newer copy");
  assert.notStrictEqual(after, "t-elsewhere");

  // rules that did not load cannot be saved
  ctx.eval ? 0 : 0;
  assert.ok(/FIN_NOT_LOADED\.finRules = FIN_NOT_LOADED\.finDebts = FIN_NOT_LOADED\.finSettings = FIN_NOT_LOADED\.finNotes = true;/.test(HTML), "a failed start-up marks all four as not loaded");
  assert.ok(/api\("findebts=1"\)\.catch\(\(\) => \{ FIN_NOT_LOADED\.finDebts = true;/.test(HTML), "a failed debts read alone is marked too");
  assert.ok(/if \(body && body\[k\] && FIN_NOT_LOADED\[k\]\) \{[\s\S]{0,260}throw new Error/.test(HTML), "post() refuses anything that did not load");
  assert.ok(!/post\(\{ finTxns/.test(HTML), "every month save goes through postTxns");
  // the import re-reads before it writes
  const imp = HTML.slice(HTML.indexOf("async function commitImport()"), HTML.indexOf("const byMonth = {};", HTML.indexOf("async function commitImport()")));
  assert.ok(/for \(const ym of yms\) now\[ym\] = \(await api\("fintxns=" \+ ym\)\)\.rows \|\| \[\];/.test(imp) && /nothing was imported and nothing was changed/.test(imp));
  console.log("v299-finance-guards.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
