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
  const posts = [];
  const els = new Map();

  const doc = {
    getElementById(id) {
      if (!els.has(id)) els.set(id, fakeElement(id));
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
      return reply({ ok: true });
    }
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
    window: { scrollTo() {}, scrollY: 0, scrollX: 0, innerWidth: 1200, innerHeight: 800 },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    fetch: fetchStub,
    prompt: () => null,
    alert() {},
    confirm: () => true,
    setTimeout,
    clearTimeout,
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
    " get weekEnding(){ return wpWeekEnding; }," +
    " get navWeeks(){ return NAV_WEEKS; }" +
    " };";
  vm.runInContext(code, sandbox, { filename: "index-inline-script.js" });

  const settle = async () => { await sleep(30); await sleep(30); };
  await settle(); // let the boot IIFE finish (it lands on the Weekly Plan tab)

  return { ctx: sandbox, posts, settle };
}

module.exports = { boot, sleep };
