// Test sandbox for the finances.html inline script.
// Same idea as env.cjs: a stub DOM plus a fake kpi-store, so a test can boot the
// real page and then read what it rendered. The store here is a live in-memory one
// — a POST is visible to the next GET — because the finance flows are round trips
// (import writes a month, then the cockpit reads it back).
const vm = require("vm");
const path = require("path");
const { extract } = require("./extract.cjs");

function fakeElement(id) {
  const attrs = {};
  const el = {
    id, dataset: {}, style: {}, value: "", textContent: "", innerHTML: "",
    hidden: false, disabled: false, checked: false, files: [],
    children: [], options: [], onclick: null, onchange: null, oninput: null,
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    setAttribute(k, v) { attrs[k] = String(v); },
    hasAttribute(k) { return k in attrs; },
    removeAttribute(k) { delete attrs[k]; },
    classList: { _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined) this._s.has(c) ? this._s.delete(c) : this._s.add(c); else on ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); } },
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, remove() {}, focus() {}, select() {}, click() {},
    querySelector(sel) { return /span/.test(String(sel)) ? fakeElement(id + ":span") : null; },
    querySelectorAll() { return []; },
    closest() { return null; },
  };
  return el;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

// opts.txns: { "YYYY-MM": [rows] } seeded into the store before boot.
// opts.settings / opts.rules: seeded likewise.
// opts.now: the date the page should think it is ("YYYY-MM-DD").
async function boot(opts = {}) {
  const DEFAULTS = { potTaxPct: 15, potInvestPct: 4, cashBuffer: 2000, weekStartDow: 4,
    sources: { stripe: "STRIPE", gocardless: "GC C1", sumup: "SUMUP", nutraprep: "NUTRAPREP" },
    allocatable: ["stripe", "gocardless"], transferKeyword: "BODYSCULPT TRANSFORMATION CENTRES",
    categories: ["Wages","Pensions","Rent","Accounting","Software","Marketing","Cleaning","Lease",
      "Bills","Website","Retail","Other","Travel","Mentorship","Charges","Owners Pay","Tax","Transfer"] };
  const store = {
    txns: JSON.parse(JSON.stringify(opts.txns || {})),
    settings: { ...DEFAULTS, ...(opts.settings || {}) },
    rules: opts.rules ? opts.rules.slice() : [],
    weeks: {},
  };
  const posts = [];
  const els = new Map();
  const doc = {
    getElementById(id) { if (!els.has(id)) els.set(id, fakeElement(id)); return els.get(id); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) { return fakeElement("el:" + tag); },
    addEventListener() {}, removeEventListener() {},
    body: fakeElement("body"),
    documentElement: fakeElement("html"),
  };
  const reply = (obj) => Promise.resolve({ ok: true, status: 200, text: async () => "", json: async () => obj });

  const fetchStub = (url, o) => {
    const u = String(url);
    if (o && o.method === "POST") {
      let body = {}; try { body = JSON.parse(o.body); } catch {}
      posts.push(body);
      if (body.finTxns) { store.txns[body.finTxns.ym] = body.finTxns.rows; return reply({ ok: true, ym: body.finTxns.ym, count: body.finTxns.rows.length }); }
      if (body.finSettings) { store.settings = { ...store.settings, ...body.finSettings }; return reply({ ok: true, settings: store.settings }); }
      if (body.finRules) { store.rules = body.finRules; return reply({ ok: true, rules: store.rules }); }
      if (body.finWeek) {
        const d = body.finWeek.weekStart;
        const prev = store.weeks[d] || {};
        store.weeks[d] = { ...prev, ...body.finWeek, checklist: { ...(prev.checklist || {}), ...(body.finWeek.checklist || {}) } };
        return reply({ ok: true, week: store.weeks[d] });
      }
      return reply({ ok: true });
    }
    const q = u.split("?")[1] || "";
    const p = Object.fromEntries(q.split("&").filter(Boolean).map((x) => x.split("=")));
    if (p.fintxns) return reply({ ym: p.fintxns, rows: store.txns[p.fintxns] || [] });
    if (p.finmonths === "1") return reply({ months: Object.keys(store.txns).sort() });
    if (p.finsettings === "1") return reply({ settings: store.settings });
    if (p.finrules === "1") return reply({ rules: store.rules });
    if (p.finweek) return reply({ week: store.weeks[p.finweek] || { weekStart: p.finweek, moved: false, tax: 0, invest: 0, note: "", checklist: {} } });
    return reply({});
  };

  const ctx = {
    console, document: doc, fetch: fetchStub,
    localStorage: { _m: {}, getItem(k) { return k in this._m ? this._m[k] : null; }, setItem(k, v) { this._m[k] = String(v); } },
    setTimeout, clearTimeout, DOMParser: class { parseFromString() { return { querySelectorAll: () => [] }; } },
    Promise, JSON, Math, Date, Number, String, Array, Object, Set, Map, Error, isNaN, parseFloat, parseInt,
  };
  // A fixed "today" so week arithmetic is not a moving target across test runs.
  if (opts.now) {
    const Real = Date;
    const fixed = new Real(opts.now + "T12:00:00Z").getTime();
    class FixedDate extends Real {
      constructor(...a) { super(...(a.length ? a : [fixed])); }
      static now() { return fixed; }
    }
    ctx.Date = FixedDate;
  }
  ctx.window = ctx; ctx.globalThis = ctx;
  // v131: the report's copy path goes through the clipboard, so the sandbox needs one.
  // It records what was written, which is also the only way a test can see it.
  ctx.__clipboard = [];
  ctx.navigator = { clipboard: { writeText: async (t) => { ctx.__clipboard.push(t); } } };
  vm.createContext(ctx);
  // S is a top-level const, so it never lands on globalThis. The accessor is appended
  // to the extracted source — same trick as env.cjs — rather than adding test-only
  // code to the page. It runs in the same script scope, so it can see the binding.
  vm.runInContext(extract(path.join(__dirname, "..", "..", "finances.html"))
    + "\n;globalThis.__S = S; globalThis.__WZ = WZ;", ctx);
  await settle(); await settle(); await settle(); await settle();
  return { ctx, S: ctx.__S, WZ: ctx.__WZ, els, store, posts, settle, clipboard: ctx.__clipboard, el: (id) => els.get(id) };
}

module.exports = { boot };
