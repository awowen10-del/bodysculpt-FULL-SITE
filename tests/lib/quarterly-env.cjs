// tests/lib/quarterly-env.cjs  (v299)
// Boots quarterly.html's inline script in a vm with a stub DOM and an in-memory emulation of
// the kpi-store handlers the page talks to (semantics copied from netlify/functions/
// kpi-store.js, including the v299 `base` check on a planning save). Written during the
// audit of 12 Nov 2026; quarterly.html had no harness before it. Nothing touches the network.
//   boot({ blobs, months, now, confirm }) -> { ev(code), blobs, posts, gets, failGet, delayGet, onGet, els, sleep }
//   failGet.push({ re: /\?planning=/, times: 1 })   makes the next matching read fail
const vm = require("vm");
const fs = require("fs");
const REPO = require("path").join(__dirname, "..", "..");

function extract() {
  const html = fs.readFileSync(REPO + "/quarterly.html", "utf8");
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return blocks.reduce((a, b) => (b.length > a.length ? b : a));
}
function fakeElement(id) {
  const attrs = {};
  return {
    id, dataset: {}, style: {}, value: "", textContent: "", hidden: false, disabled: false, innerHTML: "",
    className: "", firstChild: null,
    getAttribute(k) { return k in attrs ? attrs[k] : null; }, setAttribute(k, v) { attrs[k] = String(v); },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, insertBefore() {}, remove() {},
    focus() {}, select() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const defaultPlanning = (year, quarter) => ({ year, quarter, goals: [], reviewNotes: { wentWell: "", slipped: "", numbersShowed: "", needsAttention: "" },
  issues: [], opportunities: [], nextQuarterGoals: [], priorities: [],
  decisionSummary: { quarterTruth: "", biggestConstraint: "", biggestOpportunity: "", committedRocks: "", owners: "", firstActions: "" }, aiReview: "", lastUpdated: "" });
const REVIEW_OWNED = ["issues","opportunities","decisionSummary","reviewNotes","goals","nextQuarterGoals","aiOutputs","aiReview"];

async function boot(opts = {}) {
  const blobs = Object.assign({}, opts.blobs || {});       // key -> object (the "store")
  const months = opts.months || [];
  const posts = [], gets = [];
  const failGet = [];      // [{re, times}]  -> matching GETs reject (network error)
  const delayGet = [];     // [{re, ms}]
  const onGet = [];        // [{re, fn}] called synchronously when a matching GET is issued
  const els = new Map();
  const doc = {
    getElementById(id) { if (!els.has(id)) els.set(id, fakeElement(id)); return els.get(id); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement(t) { return fakeElement("el:" + t); }, addEventListener() {}, body: fakeElement("body"),
    documentElement: fakeElement("html"),
  };
  const ls = {}; const localStorage = { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; } };
  const reply = (obj, status = 200) => ({ ok: status < 400, status, headers: { get: () => "application/json" }, json: async () => obj, text: async () => JSON.stringify(obj) });
  const finalised = (tag) => { const r = blobs["qtt-final-" + tag]; return !!(r && r.status === "finalised"); };
  async function fetchStub(url, o) {
    const u = String(url);
    if (o && o.method === "POST") {
      const body = JSON.parse(o.body); posts.push({ url: u, body: JSON.parse(o.body) });
      if (body.planning && body.planning.year && body.planning.quarter) {
        const tag = body.planning.year + "-" + body.planning.quarter;
        if (finalised(tag)) { const t = Object.keys(body.planning).filter((k) => REVIEW_OWNED.includes(k)); if (t.length) return reply({ error: "locked" }, 423); }
        const key = "planning-" + tag;
        if (typeof body.base === "string" && ((blobs[key] && blobs[key].lastUpdated) || "") !== body.base) return reply({ ok: false, conflict: true, lastUpdated: (blobs[key] && blobs[key].lastUpdated) || "" }, 409);
        const merged = { ...(blobs[key] || defaultPlanning(body.planning.year, body.planning.quarter)), ...body.planning, lastUpdated: new Date().toISOString() };
        blobs[key] = JSON.parse(JSON.stringify(merged)); return reply({ ok: true, planning: merged });
      }
      if (body.qtt && body.qtt.tag) {
        const tag = body.qtt.tag; if (finalised(tag)) return reply({ error: "locked" }, 423);
        const existing = blobs["qtt-" + tag] || {}; const incoming = { ...body.qtt }; delete incoming.tag;
        const merged = { ...existing, ...incoming, answers: { ...(existing.answers || {}), ...(incoming.answers || {}) }, lastUpdated: new Date().toISOString() };
        blobs["qtt-" + tag] = JSON.parse(JSON.stringify(merged)); return reply({ ok: true, record: merged });
      }
      if (body.qttAnalysis) {
        const tag = body.qttAnalysis.reviewTag; const ex = blobs["qtt-analysis-" + tag] || { reviewTag: tag, versions: [] };
        const n = ex.versions.reduce((m, x) => Math.max(m, x.version || 0), 0) + 1; const stored = { ...body.qttAnalysis.version, version: n };
        ex.versions.push(stored); blobs["qtt-analysis-" + tag] = ex; return reply({ ok: true, analysis: ex, version: stored });
      }
      if (body.qttApprovals) {
        const tag = body.qttApprovals.reviewTag; if (finalised(tag)) return reply({ error: "locked" }, 423);
        const rec = { ...body.qttApprovals, lastUpdated: new Date().toISOString() };
        blobs["qtt-approvals-" + tag + "-v" + body.qttApprovals.analysisVersion] = JSON.parse(JSON.stringify(rec)); return reply({ ok: true, approvals: rec });
      }
      if (body.qttFinal) {
        const tag = body.qttFinal.reviewTag; const key = "qtt-final-" + tag;
        const ex = blobs[key] || { reviewTag: tag, destinationTag: body.qttFinal.destinationTag || null, status: "open", history: [], carryForward: { candidates: {} } };
        if (body.qttFinal.action === "finalise") { ex.status = "finalised"; ex.finalisedAt = ex.finalisedAt || new Date().toISOString(); ex.finalisedAnalysisVersion = body.qttFinal.finalisedAnalysisVersion; ex.readinessSnapshot = body.qttFinal.readinessSnapshot; ex.routedReferences = body.qttFinal.routedReferences; }
        else if (body.qttFinal.action === "reopen") { ex.status = "reopened"; }
        else if (body.qttFinal.action === "carryforward") { ex.carryForward = { candidates: body.qttFinal.candidates || {} }; }
        blobs[key] = JSON.parse(JSON.stringify(ex)); return reply({ ok: true, final: ex });
      }
      return reply({ ok: true });
    }
    gets.push(u);
    for (const h of onGet) if (h.re.test(u)) h.fn(u);
    for (const f of failGet) if (f.re.test(u) && f.times > 0) { f.times--; throw new TypeError("Failed to fetch (simulated)"); }
    const res = getNow(u);                                  // the server reads at request time...
    for (const d of delayGet) if (d.re.test(u)) await sleep(d.ms);   // ...and the reply arrives later
    return res;
  }
  function getNow(u) {
    let m;
    if (/\?monthly=1/.test(u)) return reply({ months });
    if ((m = /\?planning=([^&]+)/.exec(u))) { const tag = decodeURIComponent(m[1]); const [y, q] = tag.split("-"); return reply({ planning: JSON.parse(JSON.stringify(blobs["planning-" + tag] || defaultPlanning(Number(y), q))) }); }
    if ((m = /\?qtt=([^&]+)/.exec(u))) return reply({ record: JSON.parse(JSON.stringify(blobs["qtt-" + decodeURIComponent(m[1])] || null)) });
    if ((m = /\?qttanalysis=([^&]+)/.exec(u))) return reply({ analysis: JSON.parse(JSON.stringify(blobs["qtt-analysis-" + decodeURIComponent(m[1])] || null)) });
    if ((m = /\?qttapprovals=([^&]+)&version=(\d+)/.exec(u))) return reply({ approvals: JSON.parse(JSON.stringify(blobs["qtt-approvals-" + decodeURIComponent(m[1]) + "-v" + m[2]] || null)) });
    if ((m = /\?qttfinal=([^&]+)/.exec(u))) return reply({ final: JSON.parse(JSON.stringify(blobs["qtt-final-" + decodeURIComponent(m[1])] || null)) });
    if ((m = /\?monthlyplan=([^&]+)/.exec(u))) return reply({ plan: { ym: decodeURIComponent(m[1]), focus: [] }, rocks: [] });
    return reply({});
  }
  const RealDate = Date; const start = RealDate.now(); const fixed = new RealDate(opts.now || "2026-11-12T10:00:00Z").getTime();
  class FDate extends RealDate { constructor(...a) { if (a.length === 0) super(fixed + (RealDate.now() - start)); else super(...a); } static now() { return fixed + (RealDate.now() - start); } }
  const win = { addEventListener() {}, confirm: () => (opts.confirm !== undefined ? opts.confirm : true), prompt: () => null, alert() {}, location: { href: "" } };
  const ctx = vm.createContext({ document: doc, window: win, localStorage, navigator: {}, fetch: fetchStub, Date: FDate, console, setTimeout, clearTimeout, TextDecoder, Promise, JSON, Math, Object, Array, String, Number, RegExp, Error, TypeError });
  vm.runInContext(extract(), ctx, { filename: "quarterly-inline.js" });
  await sleep(opts.settle || 80);
  const ev = (code) => vm.runInContext(code, ctx);
  return { ctx, ev, blobs, posts, gets, failGet, delayGet, onGet, els, doc, ls, sleep };
}
module.exports = { boot, sleep, defaultPlanning };
