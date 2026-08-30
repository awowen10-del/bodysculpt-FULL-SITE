// Test sandbox for the index.html inline script.
// Boots the whole dashboard script in a vm context against a stub DOM and a
// canned fetch, then exposes the weekly-plan internals via __wpState so tests
// can drive placement / done-state / rollover logic exactly as the app does.
const vm = require("vm");
const { extract } = require("./extract.cjs");

function fakeElement(id) {
  // v106: real attribute storage — the theme lives on <html>'s data-theme attribute, so
  // get/setAttribute have to round-trip for the toggle to be drivable from a test.
  const attrs = {};
  return {
    id,
    dataset: {},
    style: {},
    value: "",
    textContent: "",
    hidden: false,
    disabled: false,
    innerHTML: "",
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    setAttribute(k, v) { attrs[k] = String(v); },
    hasAttribute(k) { return k in attrs; },
    removeAttribute(k) { delete attrs[k]; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    remove() {},
    focus() {},
    blur() {},
    select() {},
    click() {},
    scrollIntoView() {},
    getBoundingClientRect() {
      return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// opts:
//   defaults — array served for GET ?recurringdefaults=1
//   plans    — { "YYYY-MM-DD": planObject|null } served for GET ?weeklyplan=<date>
// Returns { ctx, posts, settle } — ctx is the script's global scope (all function
// declarations + __wpState accessor for the let-bound state).
async function boot(opts = {}) {
  const plans = opts.plans || {};
  const defaults = opts.defaults || [];
  const training = opts.training || []; // v71: personal training list (separate collection)
  const checkins = Object.assign({}, opts.checkins || {}); // v80: daily check-in map (mutable, so save→reload round-trips)
  let locations = Object.assign({}, opts.locations || {}); // v84: default weekly location pattern (mutable, same reason)
  // v112: the monthly-plan record, per ym, MUTABLE — the weekly app now writes a linked
  // item's done-state back to it, so a test has to be able to read the write back out.
  // Items are copied at boot so a shared fixture constant can't be mutated across boots.
  const cloneList = (l) => (Array.isArray(l) ? l.map((x) => Object.assign({}, x)) : []);
  const monthly = {};
  const monthRec = (ym) => (monthly[ym] = monthly[ym] || { ym, focus: [], priorities: [] });
  Object.keys(opts.monthFocus || {}).forEach((ym) => { monthRec(ym).focus = cloneList(opts.monthFocus[ym]); });
  Object.keys(opts.monthPriorities || {}).forEach((ym) => { monthRec(ym).priorities = cloneList(opts.monthPriorities[ym]); });
  const posts = [];
  const els = new Map();

  // v71: the two weekly notes editors are addressed by wpSyncFromDom via
  // body.querySelector('[data-field="notes"|"foodNotes"]'). The stub DOM has no real
  // tree, so map those selectors to the editor elements the test has explicitly created
  // (via getElementById). Anything not created → null, exactly as before, so no test
  // that never touches these editors is affected.
  const FIELD_TO_ID = { notes: "wpWeekNotesEd", foodNotes: "wpWeekFoodEd" };
  function resolveSelector(sel) {
    const m = /\[data-field="([^"]+)"\]/.exec(String(sel || ""));
    if (m) {
      const id = FIELD_TO_ID[m[1]];
      if (id && els.has(id)) return els.get(id);
    }
    return null;
  }

  const doc = {
    getElementById(id) {
      if (!els.has(id)) {
        const el = fakeElement(id);
        if (id === "wpBody") el.querySelector = resolveSelector;
        els.set(id, el);
      }
      return els.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) { return fakeElement("el:" + tag); },
    addEventListener() {},
    removeEventListener() {},
    body: fakeElement("body"),
    // v106: the theme is an attribute on <html>. The page's boot snippet (a separate tiny
    // <script>, not part of the extracted app script) normally seeds it, so the sandbox
    // starts it at the shipped default: light.
    documentElement: (() => { const el = fakeElement("html"); el.setAttribute("data-theme", "light"); return el; })(),
  };

  const reply = (obj) =>
    Promise.resolve({ ok: true, status: 200, json: async () => obj });

  const fetchStub = (url, o) => {
    const u = String(url);
    if (o && o.method === "POST") {
      let body = {};
      try { body = JSON.parse(o.body); } catch (e) {}
      posts.push({ url: u, body });
      if (body.weeklyPlan) {
        // echo the merged plan like kpi-store does
        return reply({ ok: true, plan: { ...body.weeklyPlan, lastUpdated: "2026-01-01T00:00:00.000Z" } });
      }
      if (Array.isArray(body.recurringDefaults)) {
        return reply({ ok: true, defaults: body.recurringDefaults });
      }
      if (Array.isArray(body.trainingDefaults)) {
        return reply({ ok: true, defaults: body.trainingDefaults });
      }
      if (body.locationDefaults) {
        // mirror kpi-store: the whole default pattern is written as a unit
        locations = { ...body.locationDefaults };
        return reply({ ok: true, locations });
      }
      // v112: the weekly app's one write into the monthly record — a section save carrying
      // only the list that changed. Mirrors kpi-store: merge the incoming sections over the
      // stored record, leave every other section alone, echo the merged plan back.
      if (body.monthlyPlan && body.monthlyPlan.ym) {
        const rec = monthRec(body.monthlyPlan.ym);
        if (Array.isArray(body.monthlyPlan.focus)) rec.focus = cloneList(body.monthlyPlan.focus);
        if (Array.isArray(body.monthlyPlan.priorities)) rec.priorities = cloneList(body.monthlyPlan.priorities);
        return reply({ ok: true, plan: { ...rec, lastUpdated: "2026-01-01T00:00:00.000Z" } });
      }
      if (body.checkin && body.checkin.date) {
        // mirror kpi-store: merge into the date-keyed map, stamp updatedAt, echo the entry
        const entry = { ...body.checkin, updatedAt: "2026-01-01T00:00:00.000Z" };
        checkins[body.checkin.date] = entry;
        return reply({ ok: true, checkin: entry });
      }
      return reply({ ok: true });
    }
    if (u.includes("trainingdefaults=1")) return reply({ defaults: training });
    if (u.includes("checkins=1")) return reply({ checkins });
    if (u.includes("locationdefaults=1")) return reply({ locations });
    if (u.includes("recurringdefaults=1")) return reply({ defaults });
    if (u.includes("weeklyplan=")) {
      const date = decodeURIComponent(u.split("weeklyplan=")[1]);
      return reply({ plan: Object.prototype.hasOwnProperty.call(plans, date) ? plans[date] : null });
    }
    // v98: the cascade anchor reads the month's focus items (title + done) from the
    // monthly-plan record. opts.monthFocus maps "YYYY-MM" -> [focus items]; unknown months
    // return [] exactly as before, so tests that never set it are unaffected.
    if (u.includes("monthfocus=")) {
      const ym = decodeURIComponent(u.split("monthfocus=")[1]);
      return reply({ focus: cloneList(monthly[ym] && monthly[ym].focus) });
    }
    // v102: the weekly anchor's PERSONAL column comes from the same monthly-plan record's
    // priorities list. opts.monthPriorities maps "YYYY-MM" -> [items]; unknown months return
    // [] exactly as before.
    // v112: the whole record, both lists — the weekly write-back re-reads it here so it can
    // change one item's done-state and post the list back without touching anything else.
    if (u.includes("monthlyplan=")) {
      const ym = decodeURIComponent(u.split("monthlyplan=")[1]);
      const rec = monthly[ym];
      return reply({ plan: { ym, focus: cloneList(rec && rec.focus), priorities: cloneList(rec && rec.priorities) } });
    }
    if (u.includes("settings=1")) return reply({ settings: null });
    if (u.includes("reset=YES")) return reply({ ok: true });
    // v107: opts.weeks lets a test plant real KPI history (>=5 dated weeks, or Store.all
    // treats it as invalid and falls back to SEED) so WEEKS/DERIVED are built by the app's
    // own boot path. The array is served BY REFERENCE, so a test can push a newly-entered
    // week onto it and drive the app's real reloadAndRender(). Defaults to [] — exactly the
    // old always-fall-back-to-SEED behaviour, so no existing test is affected.
    if (u.endsWith("kpi-store")) return reply({ weeks: opts.weeks || [] });
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  };

  const sandbox = {
    document: doc,
    window: {
      scrollTo() {}, scrollY: 0, scrollX: 0, innerWidth: 1200, innerHeight: 800,
      // v69 dial-in: real listener tracking + a writable location, so the
      // app-URI-then-web-fallback logic can be driven from tests
      _handlers: {},
      addEventListener(t, f) { (this._handlers[t] = this._handlers[t] || []).push(f); },
      removeEventListener(t, f) { const l = this._handlers[t]; if (l) { const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); } },
      location: { href: "" },
    },
    // v106: a real (per-boot, in-memory) store so a remembered choice can be asserted.
    // Empty at boot, exactly as the old always-null stub was, so nothing else changes.
    localStorage: (() => {
      const m = new Map(Object.entries(opts.storage || {}));
      return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem(k, v) { m.set(k, String(v)); },
        removeItem(k) { m.delete(k); },
      };
    })(),
    navigator: {},
    fetch: fetchStub,
    prompt: () => null,
    alert() {},
    confirm: () => true,
    setTimeout,
    clearTimeout,
    // v68 focus timer: unref'd so a still-armed interval never holds a test process open
    setInterval: (fn, ms) => { const h = setInterval(fn, ms); if (h && h.unref) h.unref(); return h; },
    clearInterval,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    URL,
    console,
  };
  vm.createContext(sandbox);

  // The appended accessor runs in the same script scope, so it can reach the
  // top-level let bindings (wpPlan, wpDefaults, …) that never land on globalThis.
  const code =
    extract() +
    "\n;globalThis.__wpState = {" +
    " get plan(){ return wpPlan; }, set plan(v){ wpPlan = v; }," +
    " get defaults(){ return wpDefaults; }, set defaults(v){ wpDefaults = v; }," +
    " get training(){ return wpTraining; }, set training(v){ wpTraining = v; }," +
    " get checkins(){ return wpCheckins; }, set checkins(v){ wpCheckins = v; }," +
    " get locDefaults(){ return wpLocDefaults; }, set locDefaults(v){ wpLocDefaults = v; }," +
    " get dayCount(){ return wpDayCount; }, get dayStart(){ return wpDayStart; }," +   // v87 view state
    " get recurCollapsed(){ return wpRecurCollapsed; }, get recurTab(){ return wpRecurTabSel; }," +  // v102 session UI state
    // v104: the monthly anchor's source record + the read-only notes viewer's open state
    " get monthFocus(){ return wpMonthFocus; }, set monthFocus(v){ wpMonthFocus = v; }," +
    " get monthProjects(){ return wpMonthProjects; }, set monthProjects(v){ wpMonthProjects = v; }," +
    " get anchorNotesOpen(){ return wpAnchorNotesOpen; }," +
    // v117: which recurring task's notes editor is open ("" = closed)
    " get recurNotesId(){ return wpRecurNotesId; }, set recurNotesId(v){ wpRecurNotesId = v; }," +
    // v119: the guided End-of-Week Review's session state. READ-ONLY — a test drives the
    // flow through its own functions (wpEowOpen/wpEowNext/…), never by poking the step.
    " get eowOpen(){ return wpEowIsOpen; }, get eowStep(){ return wpEowStep; }," +
    " get weekEnding(){ return wpWeekEnding; }," +
    " get navWeeks(){ return NAV_WEEKS; }," +
    " get timer(){ return wpTimer; }, set timer(v){ wpTimer = v; }" +
    " };" +
    // v107: the KPI/Facebook side of the app is let-bound the same way. All READ-ONLY on
    // purpose — a test plants data by serving it (opts.weeks) and drives the app's own load,
    // rather than poking WEEKS from outside, and the mid-week check's temporary state must
    // only ever be reachable through the app's own functions.
    "\n;globalThis.__fbState = {" +
    " get weeks(){ return WEEKS; }," +
    " get derived(){ return DERIVED; }," +
    " get override(){ return mwcOverride; }" +
    " };";
  vm.runInContext(code, sandbox, { filename: "index-inline-script.js" });

  const settle = async () => { await sleep(30); await sleep(30); };
  await settle(); // let the boot IIFE finish (it lands on the Weekly Plan tab)

  // `monthly` is the served monthly-plan record, keyed by ym — the same object the fetch stub
  // reads and the weekly write-back writes. A test asserts against it to prove a tick landed.
  return { ctx: sandbox, posts, settle, monthly };
}

// v114: the recurring card starts COLLAPSED, so a test that asserts on what is inside it
// (tabs, task rows, the add control) has to open it first — exactly as you would. This is a
// no-op if it is already open, so it is safe to call anywhere. Tests that own the collapse
// behaviour itself drive wpToggleRecurCollapsed directly instead.
function expandRecurring(ctx) {
  if (ctx.__wpState.recurCollapsed) ctx.wpToggleRecurCollapsed();
}

module.exports = { boot, sleep, expandRecurring };
