// Test sandbox for the index.html inline script.
// Boots the whole dashboard script in a vm context against a stub DOM and a
// canned fetch, then exposes the weekly-plan internals via __wpState so tests
// can drive placement / done-state / rollover logic exactly as the app does.
const vm = require("vm");
const { extract } = require("./extract.cjs");

function fakeElement(id) {
  return {
    id,
    dataset: {},
    style: {},
    value: "",
    textContent: "",
    hidden: false,
    disabled: false,
    innerHTML: "",
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
    if (u.includes("recurringdefaults=1")) return reply({ defaults });
    if (u.includes("weeklyplan=")) {
      const date = decodeURIComponent(u.split("weeklyplan=")[1]);
      return reply({ plan: Object.prototype.hasOwnProperty.call(plans, date) ? plans[date] : null });
    }
    if (u.includes("monthfocus=")) return reply({ focus: [] });
    if (u.includes("monthlyplan=")) return reply({ plan: { priorities: [] } });
    if (u.includes("settings=1")) return reply({ settings: null });
    if (u.includes("reset=YES")) return reply({ ok: true });
    if (u.endsWith("kpi-store")) return reply({ weeks: [] }); // invalid → app falls back to SEED
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
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
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
    " get weekEnding(){ return wpWeekEnding; }," +
    " get navWeeks(){ return NAV_WEEKS; }," +
    " get timer(){ return wpTimer; }, set timer(v){ wpTimer = v; }" +
    " };";
  vm.runInContext(code, sandbox, { filename: "index-inline-script.js" });

  const settle = async () => { await sleep(30); await sleep(30); };
  await settle(); // let the boot IIFE finish (it lands on the Weekly Plan tab)

  return { ctx: sandbox, posts, settle };
}

module.exports = { boot, sleep };
