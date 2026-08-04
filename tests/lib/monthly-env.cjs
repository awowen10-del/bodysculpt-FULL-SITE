// Test sandbox for the monthly.html inline script (the Monthly Plan — the middle layer
// of the Quarterly → Monthly → Weekly cascade).
//
// Unlike the weekly harness, the Monthly Plan reads its state back OUT of the DOM
// (mpSyncFromDom walks the rendered rows), so a stub that returns [] for every selector
// would silently "lose" every item and prove nothing. Instead #mpBody parses the HTML that
// drawMonthlyPlan writes into it, exposing real row/field elements. That makes the
// render → sync → save round-trip exercise the same path the browser does.
const vm = require("vm");
const path = require("path");
const { extract } = require("./extract.cjs");

const MONTHLY_HTML = path.join(__dirname, "..", "..", "monthly.html");

function unesc(s) {
  return String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// Attributes of one tag's attribute string. Valueless attributes (checked, selected)
// land as "" — presence is what the app tests for.
function attrsOf(src) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g;
  let m;
  while ((m = re.exec(src))) out[m[1]] = m[2] === undefined ? "" : unesc(m[2]);
  return out;
}

function fakeElement(id) {
  const classes = new Set();
  const ownAttrs = {};
  return {
    id,
    dataset: {},
    style: {},
    value: "",
    checked: false,
    textContent: "",
    hidden: false,
    disabled: false,
    innerHTML: "",
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      toggle(c, on) { if (on === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (on) { classes.add(c); } else { classes.delete(c); } },
      contains(c) { return classes.has(c); },
    },
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    remove() {},
    focus() {},
    blur() {},
    click() {},
    // v106: real attribute storage (the theme lives on <html>'s data-theme). Rows built by
    // the #mpBody parser override getAttribute with their own parsed map, as before.
    getAttribute(k) { return k in ownAttrs ? ownAttrs[k] : null; },
    setAttribute(k, v) { ownAttrs[k] = String(v); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
  };
}

// ---- the #mpBody parser -----------------------------------------------------
// Turns rendered HTML into row elements ([data-focus] / [data-prio]) carrying their
// field inputs ([data-ff="…"] / [data-pf="…"]), plus the standalone textareas the
// notes/review sections use.
const TAG_RE = /<([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|[^>])*)>/g;

function fieldElement(tag, attrs, html, tagEnd) {
  const el = fakeElement("field:" + tag);
  el.getAttribute = (k) => (k in attrs ? attrs[k] : null);
  if (tag === "select") {
    const close = html.indexOf("</select>", tagEnd);
    const inner = html.slice(tagEnd, close < 0 ? html.length : close);
    const ore = /<option([^>]*)>([\s\S]*?)<\/option>/g;
    let m, first = null, picked = null;
    while ((m = ore.exec(inner))) {
      const oa = attrsOf(m[1]);
      const v = "value" in oa ? oa.value : unesc(m[2]);
      if (first === null) first = v;
      if ("selected" in oa && picked === null) picked = v;
    }
    el.value = picked !== null ? picked : first !== null ? first : ""; // browsers select option 0
  } else if (tag === "textarea") {
    const close = html.indexOf("</textarea>", tagEnd);
    el.value = unesc(html.slice(tagEnd, close < 0 ? html.length : close));
  } else {
    el.value = attrs.value || "";
    el.checked = "checked" in attrs;
  }
  return el;
}

function parseMpBody(html) {
  const rows = [];
  const singles = []; // [selector-matching predicate data, element]
  let row = null;
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(html))) {
    const tag = m[1].toLowerCase();
    const attrs = attrsOf(m[2] || "");
    const tagEnd = m.index + m[0].length;

    if ("data-focus" in attrs || "data-prio" in attrs) {
      const self = fakeElement("row"); // own binding per row — closures must not share one
      self.attrs = attrs;
      self.kind = "data-focus" in attrs ? "focus" : "prio";
      self.fields = {};
      self.getAttribute = (k) => (k in attrs ? attrs[k] : null);
      self.querySelector = (sel) => {
        const s = String(sel);
        if (s.includes("[data-notes-prev]")) return self.fields["notes-prev"] || null;
        const f = /\[data-(ff|pf)="([^"]+)"\]/.exec(s);
        return f ? self.fields[f[1] + ":" + f[2]] || null : null;
      };
      row = self;
      rows.push(self);
      continue;
    }
    // v93: the notes preview <span data-notes-prev> is text, not a value-bearing field —
    // mpSaveNotes patches its textContent in place, so it needs to be reachable too.
    if ("data-notes-prev" in attrs && row) {
      const close = html.indexOf("</span>", tagEnd);
      const prev = fakeElement("notes-prev");
      prev.textContent = unesc(html.slice(tagEnd, close < 0 ? html.length : close));
      row.fields["notes-prev"] = prev;
      continue;
    }
    const ff = "data-ff" in attrs ? "ff:" + attrs["data-ff"] : "data-pf" in attrs ? "pf:" + attrs["data-pf"] : null;
    if (ff && row) { row.fields[ff] = fieldElement(tag, attrs, html, tagEnd); continue; }
    if ("data-field" in attrs || "data-mpreview" in attrs || "data-pushym" in attrs) {
      const key = "data-field" in attrs ? `[data-field="${attrs["data-field"]}"]`
        : "data-mpreview" in attrs ? `[data-mpreview="${attrs["data-mpreview"]}"]`
        : "[data-pushym]";
      singles.push([key, fieldElement(tag, attrs, html, tagEnd)]);
    }
  }
  return { rows, singles };
}

function mpBodyElement() {
  const el = fakeElement("mpBody");
  let html = "";
  let parsed = { rows: [], singles: [] };
  Object.defineProperty(el, "innerHTML", {
    get() { return html; },
    set(v) { html = String(v); parsed = parseMpBody(html); },
  });
  el.querySelectorAll = (sel) => {
    const s = String(sel);
    if (s.includes("[data-focus]")) return parsed.rows.filter((r) => r.kind === "focus");
    if (s.includes("[data-prio]")) return parsed.rows.filter((r) => r.kind === "prio");
    return [];
  };
  el.querySelector = (sel) => {
    const s = String(sel);
    const hit = parsed.singles.find(([k]) => k === s);
    return hit ? hit[1] : null;
  };
  // test-side helpers
  el.rows = () => parsed.rows;
  el.focusRows = () => parsed.rows.filter((r) => r.kind === "focus");
  return el;
}

// v93: #mpNotesBody holds the rich-notes editor, which mpOpenNotes writes as HTML and
// mpSaveNotes later reads back via getElementById("mpNotesEd").innerHTML. Wire that up so
// the modal's render → edit → save round-trip is the real one.
function notesBodyElement(els) {
  const el = fakeElement("mpNotesBody");
  let html = "";
  Object.defineProperty(el, "innerHTML", {
    get() { return html; },
    set(v) {
      html = String(v);
      const m = /<div class="mp-notes-editor" id="mpNotesEd"[^>]*>([\s\S]*)<\/div>\s*<div class="mp-note-hint"/.exec(html);
      const ed = els.get("mpNotesEd") || fakeElement("mpNotesEd");
      ed.innerHTML = m ? m[1] : "";
      ed.closest = (sel) => (String(sel) === ".mp-notes-editor" ? ed : null);
      els.set("mpNotesEd", ed);
    },
  });
  return el;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// opts:
//   plans  — { "YYYY-MM": planObject|null } served for GET ?monthlyplan=<ym> (mutated by POSTs,
//            exactly like the store, so a push → reload round-trips)
//   rocks  — [{title,…}] returned alongside the plan
//   months — monthly records for GET ?monthly=1
// Returns { ctx, posts, plans, alerts, settle, body }.
async function boot(opts = {}) {
  const plans = Object.assign({}, opts.plans || {});
  const rocks = opts.rocks || [];
  const quarterTag = opts.quarterTag || "2026-Q3";
  const posts = [];
  const alerts = [];
  const els = new Map();
  els.set("mpBody", mpBodyElement());
  els.set("mpNotesBody", notesBodyElement(els));
  const listeners = {};   // document-level handlers (Escape, the notes checkbox delegate)

  const reply = (obj) => Promise.resolve({ ok: true, status: 200, json: async () => obj });

  const fetchStub = (url, o) => {
    const u = String(url);
    if (o && o.method === "POST") {
      let body = {};
      try { body = JSON.parse(o.body); } catch (e) {}
      posts.push({ url: u, body });
      if (body.monthlyPlan && body.monthlyPlan.ym) {
        // mirror kpi-store: shallow merge over the existing record for that month
        const ym = body.monthlyPlan.ym;
        const merged = Object.assign({ ym }, plans[ym] || {}, body.monthlyPlan,
          { lastUpdated: "2026-08-04T00:00:00.000Z" });
        plans[ym] = merged;
        return reply({ ok: true, plan: merged });
      }
      return reply({ ok: true });
    }
    if (u.includes("monthlyplan=")) {
      const ym = decodeURIComponent(u.split("monthlyplan=")[1]);
      return reply({ plan: plans[ym] || null, rocks, quarterTag });
    }
    if (u.includes("monthfocus=")) {
      const ym = decodeURIComponent(u.split("monthfocus=")[1]);
      return reply({ focus: (plans[ym] && plans[ym].focus) || [] });
    }
    if (u.includes("monthly=1")) return reply({ months: opts.months || [] });
    if (u.includes("seed=YES")) return reply({ ok: true, written: 0, months: [] });
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  };

  const doc = {
    getElementById(id) {
      if (!els.has(id)) els.set(id, fakeElement(id));
      return els.get(id);
    },
    // Id-anchored lookups ("#expTable thead") resolve to a stable stub element, so views
    // that render into static markup (Expenses) can be driven. Attribute selectors still
    // return null — the v90 [data-push] path deliberately falls back to mpPushOpen state.
    querySelector(sel) {
      const s = String(sel || "");
      if (s[0] !== "#") return null;
      if (!els.has("sel:" + s)) els.set("sel:" + s, fakeElement(s));
      return els.get("sel:" + s);
    },
    // The plan's rows live inside #mpBody, so a DOCUMENT-level lookup finds them in a real
    // browser too — mpRemovePrio does exactly that. Everything else (.view/.vt) stays empty.
    querySelectorAll(sel) {
      const s = String(sel || "");
      if (s.includes("[data-prio]") || s.includes("[data-focus]")) return els.get("mpBody").querySelectorAll(s);
      return [];
    },
    createElement(tag) { return fakeElement("el:" + tag); },
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener(t, f) { const l = listeners[t]; if (l) { const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); } },
    execCommand() { return true; },
    activeElement: null,
    body: fakeElement("body"),
    // v106: <html> carries data-theme; seeded to the shipped default (the page's separate
    // boot snippet does this in the browser, and it is not part of the extracted script).
    documentElement: (() => { const el = fakeElement("html"); el.setAttribute("data-theme", "light"); return el; })(),
  };

  const sandbox = {
    document: doc,
    window: {
      scrollTo() {}, innerWidth: 1200, innerHeight: 800,
      addEventListener() {}, removeEventListener() {},
      location: { search: "", href: "" },
      alert: (m) => { alerts.push(String(m)); },
      prompt: () => null,
      confirm: () => true,
    },
    // v106: real per-boot storage + a <html> element to hold data-theme, so the theme
    // toggle can be driven here exactly as it is in the weekly harness.
    localStorage: (() => {
      const m = new Map(Object.entries(opts.storage || {}));
      return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem(k, v) { m.set(k, String(v)); },
        removeItem(k) { m.delete(k); },
      };
    })(),
    location: { search: "", href: "" },
    navigator: {},
    fetch: fetchStub,
    alert: (m) => { alerts.push(String(m)); },
    prompt: () => null,
    confirm: () => true,
    setTimeout, clearTimeout,
    setInterval: (fn, ms) => { const h = setInterval(fn, ms); if (h && h.unref) h.unref(); return h; },
    clearInterval,
    requestAnimationFrame: () => 0,
    URL, URLSearchParams, console,
  };
  vm.createContext(sandbox);

  // The accessor runs in the same script scope, so it reaches the top-level let bindings
  // (curYm, mpPlan, …) that never land on globalThis.
  const code =
    extract(MONTHLY_HTML) +
    "\n;globalThis.__mpState = {" +
    " get curYm(){ return curYm; }, set curYm(v){ curYm = v; }," +
    " get view(){ return curView; }, get defaultView(){ return DEFAULT_VIEW; }," +   // v94: landing tab
    " get yms(){ return YMS; }," +
    " get plan(){ return mpPlan; }, set plan(v){ mpPlan = v; }," +
    " get ym(){ return mpYm; }, set ym(v){ mpYm = v; }," +
    " get rocks(){ return mpRocks; }," +
    " get pushOpen(){ return mpPushOpen; }, set pushOpen(v){ mpPushOpen = v; }," +
    " get pushNote(){ return mpPushNote; }, set pushNote(v){ mpPushNote = v; }," +
    " get notesId(){ return mpNotesId; }" +   // v93: which focus item's notes modal is open
    " };";
  vm.runInContext(code, sandbox, { filename: "monthly-inline-script.js" });

  const settle = async () => { await sleep(30); await sleep(30); };
  await settle(); // let the boot IIFE finish

  // Fire a document-level event at the handlers the script registered (Escape, the notes
  // checkbox delegate) — the same objects the browser would hand them.
  const fire = (type, event) => (listeners[type] || []).forEach((f) => f(event));

  return { ctx: sandbox, posts, plans, alerts, settle, fire, body: els.get("mpBody"), els };
}

// Open the Monthly Plan for a given month and wait for its fetch to land.
async function openPlan(env, ym) {
  env.ctx.__mpState.curYm = ym;
  await env.ctx.renderMonthlyPlan();
  await env.settle();
  return env.ctx.__mpState.plan;
}

module.exports = { boot, openPlan, sleep, parseMpBody };
