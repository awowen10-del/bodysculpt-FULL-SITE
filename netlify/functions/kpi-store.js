// Netlify Function: kpi-store
// Stage 2 storage layer using Netlify Blobs.
// GET  -> returns { weeks: [...] } sorted oldest->newest
// POST -> body { week: {weekEnding, adSpend, leads, trialSales, signups, cancellations, recurring} }
//         upserts that week (keyed by weekEnding) and returns the full set.
//
// In Stages 3-4 the scheduled pull functions call POST here after fetching
// from Ontraport / Meta. The dashboard calls GET.

import { getStore } from "@netlify/blobs";

const KEY = "weeks";
const SETTINGS_KEY = "settings";
const MONTHS_KEY = "months"; // monthly report records, keyed by "YYYY-MM"

// Quarterly Review + Planning (Phase 1 storage foundation).
// Each quarter is stored under its OWN blob key: "planning-2026-Q1", etc.
// Per-quarter keys mean two people editing different quarters can't overwrite
// each other (Netlify Blobs is last-write-wins only within a single key).
const PLANNING_PREFIX = "planning-"; // + "YYYY-QN"
function planningKeyOf(tag) { return PLANNING_PREFIX + tag; }
// Accept only "YYYY-Q1".."YYYY-Q4"
function validPlanningTag(tag) {
  return typeof tag === "string" && /^\d{4}-Q[1-4]$/.test(tag);
}
// A fully-formed empty object so the front end never has to null-check fields.
function defaultPlanning(year, quarter) {
  return {
    year, quarter,
    goals: [],
    reviewNotes: { wentWell: "", slipped: "", numbersShowed: "", needsAttention: "" },
    issues: [],
    opportunities: [],
    nextQuarterGoals: [],
    priorities: [],
    decisionSummary: {
      quarterTruth: "", biggestConstraint: "", biggestOpportunity: "",
      committedRocks: "", owners: "", firstActions: ""
    },
    aiReview: "",
    lastUpdated: ""
  };
}

// Weekly Plan (Phase 1). Each week's plan is stored under its OWN blob key
// "weekly-plan-YYYY-MM-DD" (keyed by week-ending date). Recurring defaults live in
// their own key so a new week can pre-fill recurring tasks without retyping.
const WEEKLY_PLAN_PREFIX = "weekly-plan-"; // + "YYYY-MM-DD"
const RECURRING_DEFAULTS_KEY = "weekly-recurring-defaults";
// v71: personal Training list — its OWN key, fully separate from the business
// recurring defaults. Same per-item shape (id/title/days/time/link), no seed list.
const TRAINING_DEFAULTS_KEY = "weekly-training-defaults";
// v80: daily check-in history — a single blob holding a map { "YYYY-MM-DD": entry }, so every
// day's answers accumulate and are trivially retrievable as a list for a future AI advisor.
const DAILY_CHECKINS_KEY = "daily-checkins";
// v88: the daily non-negotiables ride the same per-date entry (`habits`). Ids must match
// WP_HABITS in index.html — anything else, and any non-boolean value, is stripped.
const VALID_HABITS = ["read", "mobility", "house"];
function cleanHabits(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const id of VALID_HABITS) if (typeof raw[id] === "boolean") out[id] = raw[id];
  return out;
}
// Whitelist + coerce one check-in entry to the clean, consistent shape. Free-text fields hold
// client-sanitised rich-text HTML (re-sanitised again on render), capped here defensively.
function cleanCheckin(raw) {
  const str = (v) => (typeof v === "string" ? v.slice(0, 20000) : "");
  return {
    date: str(raw.date).slice(0, 10),
    mind: str(raw.mind),
    gratitude: str(raw.gratitude),
    oneThing: str(raw.oneThing),
    oneThingDone: (raw.oneThingDone === true || raw.oneThingDone === false) ? raw.oneThingDone : null,
    doneNote: str(raw.doneNote),
    dismissed: !!raw.dismissed,
    habits: cleanHabits(raw.habits),        // v88: { habitId: boolean }, known ids only
    habitsAsked: !!raw.habitsAsked,         // v88: yesterday's catch-up already answered today
    updatedAt: new Date().toISOString(),
  };
}
// v84: daily location. WHERE you are on each day of the week — a default weekly pattern in
// its own key, plus optional per-week overrides carried on the week's plan (field
// "locations"). Purely informational: it never touches tasks, placements or done-state.
const LOCATION_DEFAULTS_KEY = "weekly-location-defaults";
// The fixed list of places. TO ADD A LOCATION: add its key here AND to WP_LOCATIONS in
// index.html (and give it a `.wp-loc-<key>` colour there). Anything else is stripped.
const VALID_LOCATIONS = ["warrington", "home"];
const VALID_DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
// Coerce a { day: location } map to the clean shape: valid day keys only, values limited to
// the fixed list. `allowClear` (per-week overrides) additionally permits "" — an explicit
// "nowhere this week", which is different from having no override at all.
function sanitiseLocationMap(raw, allowClear) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const day of VALID_DAY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, day)) continue;
    const v = raw[day];
    if (typeof v !== "string") continue;
    if (VALID_LOCATIONS.includes(v)) out[day] = v;
    else if (allowClear && v === "") out[day] = "";
  }
  return out;
}
function weeklyPlanKeyOf(date) { return WEEKLY_PLAN_PREFIX + date; }
function validWeekDate(d) { return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d); }
function defaultRecurringDefaults() {
  return [
    { title: "Weekly Scorecard", owner: "Ash" },
    { title: "Finance block", owner: "Ash" },
    { title: "Failed payment review", owner: "Ash" },
    { title: "Trialist review", owner: "Ash" },
    { title: "Marketing review", owner: "Ash" },
    { title: "Staff feedback", owner: "Ash" },
    { title: "Session observation", owner: "Dan" },
    { title: "Member email", owner: "Ash" },
    { title: "Review cancellations", owner: "Ash" },
    { title: "Review new starters", owner: "Ash" },
    { title: "Check lead follow-up", owner: "Ash" }
  ];
}
function defaultWeeklyPlan(weekEnding) {
  const blankRow = { mon:"", tue:"", wed:"", thu:"", fri:"", sat:"", sun:"" };
  return {
    weekEnding,
    mustWin: [], projects: [], recurring: [], buffer: [], notes: "",
    timeBlocks: {
      "6-9": { ...blankRow }, "10-12": { ...blankRow }, "1-3": { ...blankRow },
      "5-8": { ...blankRow }, "notes": { ...blankRow }
    },
    review: { wins:"", notDone:"", carryForward:"", blockers:"" },
    lastUpdated: ""
  };
}

// Monthly Plan — the middle layer of the cascade (Quarterly → Monthly → Weekly).
// Stored per calendar month under "monthly-plan-YYYY-MM". Pulls this quarter's Rocks
// (from the quarterly planning blob) as its anchor; each monthly focus item can link
// to the Rock it supports.
const MONTHLY_PLAN_PREFIX = "monthly-plan-"; // + "YYYY-MM"
function monthlyPlanKeyOf(ym) { return MONTHLY_PLAN_PREFIX + ym; }

// Quarterly Thinking Time — raw reflection answers, stored per quarter under
// "qtt-YYYY-QN", kept SEPARATE from the polished planning record ("planning-YYYY-QN")
// so Thinking Time answers are never overwritten by the final Quarterly Review.
const QTT_PREFIX = "qtt-"; // + "YYYY-QN"
function qttKeyOf(tag) { return QTT_PREFIX + tag; }

// Phase D: AI Quarter Analysis — versioned draft analyses for a REVIEW quarter, stored
// under "qtt-analysis-YYYY-QN". Kept SEPARATE from qtt- answers, planning-, and aiOutputs
// so a failed or new analysis can never touch Thinking Time or official planning records.
const QTT_ANALYSIS_PREFIX = "qtt-analysis-"; // + "YYYY-QN"
function qttAnalysisKeyOf(tag) { return QTT_ANALYSIS_PREFIX + tag; }

// Phase E: approval/routing state for a specific analysis version of a review quarter.
// Stored under "qtt-approvals-YYYY-QN-vN". Kept SEPARATE from analysis versions (which are
// never mutated) and from official planning records. Holds per-item working copies,
// approval status and routing receipts so routing is idempotent.
const QTT_APPROVAL_PREFIX = "qtt-approvals-"; // + "YYYY-QN-vN"
function qttApprovalKeyOf(tag, version) { return QTT_APPROVAL_PREFIX + tag + "-v" + version; }

// Phase F: finalisation/lock record for a review quarter, stored under "qtt-final-YYYY-QN".
// Holds the finalisation status, readiness snapshot, routed references, carry-forward
// decisions and history. The store consults it to reject edits to a finalised review
// quarter (authoritative lock — client locks alone are not trusted).
const QTT_FINAL_PREFIX = "qtt-final-"; // + "YYYY-QN"
function qttFinalKeyOf(tag) { return QTT_FINAL_PREFIX + tag; }
// Planning sections OWNED by the review quarter — these are locked once it is finalised.
// (Destination-owned writes go to a different tag and are never blocked by this.)
const REVIEW_OWNED_SECTIONS = ["issues","opportunities","decisionSummary","reviewNotes","goals","nextQuarterGoals","aiOutputs","aiReview"];
async function qttIsFinalised(store, tag) {
  const rec = await store.get(qttFinalKeyOf(tag), { type: "json" });
  return !!(rec && rec.status === "finalised");
}
function validYm(ym) { return typeof ym === "string" && /^\d{4}-\d{2}$/.test(ym); }
function quarterTagOfYm(ym) {
  const [y, m] = ym.split("-").map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  return y + "-Q" + q;
}
// v90: whitelist for a monthly focus item. TWO apps write these, so the list must cover
// both or a save from one would strip the other's data:
//   monthly.html  — {id,title,rockRef,notes,done} + v90 {pushedFrom,pushedFromId}
//   quarterly.html— cascade/carry-forward milestones, which add {linkId,sourceType,
//                   monthlyOutcome,milestone,successMeasure,priorityRef,sourceQuarter,
//                   owner,status}. linkId is the cascade's idempotency key — losing it
//                   would let the quarterly view create duplicate milestones.
// rockRef/priorityRef stay as-sent (string index from the monthly select, a source id from
// the quarterly cascade, or null) so links are never rewritten. pushedFrom/pushedFromId are
// the push-forward provenance: the month a copy came from and the item it was copied from.
// v93: `notes` is now a rich-notes field, exactly like the weekly plan's notes — one string
// that is either legacy plain text or the "<!--wp:rich-->" marker + sanitised HTML. Same
// discipline as the weekly notes: the client sanitises on BOTH save and render against a
// strict tag allowlist, and the store keeps the string verbatim (no server-side rewriting,
// which would fight the client sanitiser and could corrupt a note). Only the size cap
// changes — rich HTML is far longer than the old one-line field. A cap can never leave
// broken markup behind either: sanitise-on-render rebalances any truncated tags.
const MONTHLY_FOCUS_STRINGS = {
  title: 400, notes: 20000, linkId: 160, sourceType: 40, monthlyOutcome: 400,
  milestone: 400, successMeasure: 400, sourceQuarter: 20, owner: 60, status: 40,
};
function cleanMonthlyFocus(list) {
  const ref = (v) => (v === null || typeof v === "number" ? v : typeof v === "string" ? v.slice(0, 60) : "");
  return list
    .filter((f) => f && typeof f === "object")
    .slice(0, 60)
    .map((f) => {
      const d = {
        id: typeof f.id === "string" ? f.id.slice(0, 40) : "",
        title: typeof f.title === "string" ? f.title.slice(0, 400) : "",
        rockRef: ref(f.rockRef),
        notes: typeof f.notes === "string" ? f.notes.slice(0, MONTHLY_FOCUS_STRINGS.notes) : "",
        done: !!f.done,
      };
      for (const k of Object.keys(MONTHLY_FOCUS_STRINGS)) {
        if (k === "title" || k === "notes") continue; // already set above
        if (typeof f[k] === "string" && f[k]) d[k] = f[k].slice(0, MONTHLY_FOCUS_STRINGS[k]);
      }
      if (f.priorityRef !== undefined) d.priorityRef = ref(f.priorityRef);
      if (typeof f.pushedFrom === "string" && validYm(f.pushedFrom)) {
        d.pushedFrom = f.pushedFrom;
        d.pushedFromId = typeof f.pushedFromId === "string" ? f.pushedFromId.slice(0, 40) : "";
      }
      return d;
    });
}
// v97: whitelist for a PERSONAL priority/project item. monthly.html is the only writer of
// this list (index.html reads id/title/owner for the weekly cascade); the fields are exactly
// what the section's inputs produce. `rockRef` is deliberately NOT here — the section is the
// personal counterpart to focus now, so a Rock link stored before the repurpose is dropped
// on the next save. Everything else on the item survives untouched.
const MONTHLY_PRIORITY_STRINGS = { title: 400, owner: 60, status: 40, notes: 2000 };
function cleanMonthlyPriorities(list) {
  return list
    .filter((p) => p && typeof p === "object")
    .slice(0, 60)
    .map((p) => {
      const d = { id: typeof p.id === "string" ? p.id.slice(0, 40) : "" };
      for (const k of Object.keys(MONTHLY_PRIORITY_STRINGS)) {
        d[k] = typeof p[k] === "string" ? p[k].slice(0, MONTHLY_PRIORITY_STRINGS[k]) : "";
      }
      return d;
    });
}
function defaultMonthlyPlan(ym) {
  return {
    ym,
    focus: [],        // [{id, title, rockRef, notes, done, pushedFrom?, pushedFromId?}]
    priorities: [],   // v97: PERSONAL priorities/projects — [{id, title, owner, status, notes}]
    notes: "",
    review: { wins:"", notDone:"", carryForward:"", blockers:"" },
    lastUpdated: ""
  };
}

export default async (req) => {
  // Strong consistency: a read is guaranteed to return the most recent write.
  // Without this, Netlify Blobs is eventually consistent, so a refresh right after
  // saving can return the PREVIOUS value — which showed up as tasks flickering
  // in/out on alternate refreshes. Strong consistency removes that lag.
  const store = getStore({ name: "bodysculpt-kpi", consistency: "strong" });
  const url = new URL(req.url);

  // One-time reset: GET /.netlify/functions/kpi-store?reset=YES wipes all stored weeks.
  if (req.method === "GET" && url.searchParams.get("reset") === "YES") {
    await store.set(KEY, JSON.stringify([]));
    return Response.json({ ok:true, reset:true, message:"Store cleared. Reload the dashboard to re-seed real history." });
  }

  // Settings (targets): GET ?settings=1 returns saved targets; POST {settings:{...}} saves them.
  if (req.method === "GET" && url.searchParams.get("settings") === "1") {
    const settings = (await store.get(SETTINGS_KEY, { type: "json" })) || null;
    return Response.json({ settings });
  }

  // Monthly report: GET ?monthly=1 returns saved monthly records (with overrides).
  if (req.method === "GET" && url.searchParams.get("monthly") === "1") {
    const months = (await store.get(MONTHS_KEY, { type: "json" })) || [];
    months.sort((a, b) => (a.ym < b.ym ? -1 : 1));
    return Response.json({ months });
  }

  // Quarterly planning: GET ?planning=YYYY-QN returns that quarter's planning object
  // (or a safe, fully-formed empty default if none has been saved yet).
  if (req.method === "GET" && url.searchParams.get("planning")) {
    const tag = url.searchParams.get("planning");
    if (!validPlanningTag(tag)) {
      return new Response("Bad planning tag (expected YYYY-Q1..Q4)", { status: 400 });
    }
    const [yStr, qStr] = tag.split("-");
    const saved = (await store.get(planningKeyOf(tag), { type: "json" })) || null;
    const planning = saved || defaultPlanning(Number(yStr), qStr);
    return Response.json({ planning });
  }

  // Weekly Plan: GET ?weeklyplan=YYYY-MM-DD returns that week's plan (or empty default).
  if (req.method === "GET" && url.searchParams.get("weeklyplan")) {
    const date = url.searchParams.get("weeklyplan");
    if (!validWeekDate(date)) {
      return new Response("Bad week date (expected YYYY-MM-DD)", { status: 400 });
    }
    const saved = (await store.get(weeklyPlanKeyOf(date), { type: "json" })) || null;
    const plan = saved || defaultWeeklyPlan(date);
    return Response.json({ plan });
  }

  // Recurring defaults: GET ?recurringdefaults=1 returns the editable default list.
  if (req.method === "GET" && url.searchParams.get("recurringdefaults") === "1") {
    const defaults = (await store.get(RECURRING_DEFAULTS_KEY, { type: "json" })) || defaultRecurringDefaults();
    return Response.json({ defaults });
  }

  // v71 Training list: GET ?trainingdefaults=1 returns the personal training items
  // (empty when never saved — no seed list, unlike recurring).
  if (req.method === "GET" && url.searchParams.get("trainingdefaults") === "1") {
    const defaults = (await store.get(TRAINING_DEFAULTS_KEY, { type: "json" })) || [];
    return Response.json({ defaults });
  }

  // v80 Daily check-ins: GET ?checkins=1 returns the whole date-keyed map (empty when none).
  // The client reads today's entry from it and keeps past days for the future AI advisor.
  if (req.method === "GET" && url.searchParams.get("checkins") === "1") {
    const checkins = (await store.get(DAILY_CHECKINS_KEY, { type: "json" })) || {};
    return Response.json({ checkins });
  }

  // v84 Location defaults: GET ?locationdefaults=1 returns the default weekly pattern
  // ({ mon:"warrington", … }) — empty when never set, so every day starts unset.
  if (req.method === "GET" && url.searchParams.get("locationdefaults") === "1") {
    const locations = sanitiseLocationMap((await store.get(LOCATION_DEFAULTS_KEY, { type: "json" })) || {}, false);
    return Response.json({ locations });
  }

  // Monthly Plan: GET ?monthlyplan=YYYY-MM → { plan, quarterTag, rocks }
  if (req.method === "GET" && url.searchParams.get("monthlyplan")) {
    const ym = url.searchParams.get("monthlyplan");
    if (!validYm(ym)) return new Response("Bad month (expected YYYY-MM)", { status: 400 });
    const saved = (await store.get(monthlyPlanKeyOf(ym), { type: "json" })) || null;
    const plan = saved || defaultMonthlyPlan(ym);
    const quarterTag = quarterTagOfYm(ym);
    const qPlanning = (await store.get(planningKeyOf(quarterTag), { type: "json" })) || null;
    const rocks = (qPlanning && Array.isArray(qPlanning.goals)) ? qPlanning.goals : [];
    return Response.json({ plan, quarterTag, rocks });
  }

  // Cascade helper: GET ?monthfocus=YYYY-MM → { focus } (used by the Weekly Plan anchor).
  if (req.method === "GET" && url.searchParams.get("monthfocus")) {
    const ym = url.searchParams.get("monthfocus");
    if (!validYm(ym)) return new Response("Bad month", { status: 400 });
    const saved = (await store.get(monthlyPlanKeyOf(ym), { type: "json" })) || null;
    const focus = (saved && Array.isArray(saved.focus)) ? saved.focus : [];
    return Response.json({ focus });
  }

  // Quarterly Thinking Time: GET ?qtt=YYYY-QN → { record } (or null if never saved).
  // Returns null when no record exists — the front end renders an in-memory blank so we
  // never persist an empty record just because a quarter was viewed.
  if (req.method === "GET" && url.searchParams.get("qtt")) {
    const tag = url.searchParams.get("qtt");
    if (!validPlanningTag(tag)) return new Response("Bad qtt tag (expected YYYY-QN)", { status: 400 });
    const record = (await store.get(qttKeyOf(tag), { type: "json" })) || null;
    return Response.json({ record });
  }

  // Phase D: GET ?qttanalysis=YYYY-QN → { analysis } (or null if never generated).
  // Returns null when no analysis exists — viewing a quarter never creates a record.
  if (req.method === "GET" && url.searchParams.get("qttanalysis")) {
    const tag = url.searchParams.get("qttanalysis");
    if (!validPlanningTag(tag)) return new Response("Bad qttanalysis tag (expected YYYY-QN)", { status: 400 });
    const analysis = (await store.get(qttAnalysisKeyOf(tag), { type: "json" })) || null;
    return Response.json({ analysis });
  }

  // Phase E: GET ?qttapprovals=YYYY-QN&version=N → { approvals } (or null if none).
  if (req.method === "GET" && url.searchParams.get("qttapprovals")) {
    const tag = url.searchParams.get("qttapprovals");
    const version = Number(url.searchParams.get("version"));
    if (!validPlanningTag(tag)) return new Response("Bad qttapprovals tag", { status: 400 });
    if (!Number.isInteger(version) || version < 1) return new Response("Bad version", { status: 400 });
    const approvals = (await store.get(qttApprovalKeyOf(tag, version), { type: "json" })) || null;
    return Response.json({ approvals });
  }

  // Phase F: GET ?qttfinal=YYYY-QN → { final } (or null if never finalised/opened).
  if (req.method === "GET" && url.searchParams.get("qttfinal")) {
    const tag = url.searchParams.get("qttfinal");
    if (!validPlanningTag(tag)) return new Response("Bad qttfinal tag", { status: 400 });
    const final = (await store.get(qttFinalKeyOf(tag), { type: "json" })) || null;
    return Response.json({ final });
  }

  if (req.method === "GET") {
    const weeks = (await store.get(KEY, { type: "json" })) || [];
    weeks.sort((a, b) => (a.weekEnding < b.weekEnding ? -1 : 1));
    return Response.json({ weeks });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); }
    catch { return new Response("Bad JSON", { status: 400 }); }

    // Save settings (targets).
    if (body.settings) {
      await store.set(SETTINGS_KEY, JSON.stringify(body.settings));
      return Response.json({ ok:true, settings:body.settings });
    }

    // Save one quarter's planning object under its own key "planning-YYYY-QN".
    // Merges over any existing object (so a partial save — e.g. just reviewNotes —
    // does not wipe the other sections). Server stamps lastUpdated.
    if (body.planning && body.planning.year && body.planning.quarter) {
      const tag = body.planning.year + "-" + body.planning.quarter;
      if (!validPlanningTag(tag)) {
        return new Response("Bad planning year/quarter", { status: 400 });
      }
      // Phase F: if this tag is a finalised review quarter, reject writes that touch its
      // review-owned sections. Writes to any OTHER tag (e.g. the destination quarter) pass
      // freely — finalising Q2 never locks Q3. Non-review fields are also unaffected.
      if (await qttIsFinalised(store, tag)) {
        const touched = Object.keys(body.planning).filter(k => REVIEW_OWNED_SECTIONS.includes(k));
        if (touched.length) {
          return Response.json({ error: "Planning section(s) [" + touched.join(", ") + "] for " + tag + " are finalised and locked. Reopen the quarter to edit." }, { status: 423 });
        }
      }
      const key = planningKeyOf(tag);
      const existing = (await store.get(key, { type: "json" }))
        || defaultPlanning(body.planning.year, body.planning.quarter);
      const merged = { ...existing, ...body.planning,
        lastUpdated: new Date().toISOString() };
      await store.set(key, JSON.stringify(merged));
      return Response.json({ ok:true, planning: merged });
    }

    // Save one week's plan under its own key "weekly-plan-YYYY-MM-DD".
    // The whole plan is written as a unit (front end sends the complete object).
    // Server stamps lastUpdated. Isolated from KPI/monthly/quarterly/AI keys.
    if (body.weeklyPlan && body.weeklyPlan.weekEnding) {
      const date = body.weeklyPlan.weekEnding;
      if (!validWeekDate(date)) {
        return new Response("Bad weeklyPlan.weekEnding", { status: 400 });
      }
      const key = weeklyPlanKeyOf(date);
      const existing = (await store.get(key, { type: "json" })) || defaultWeeklyPlan(date);
      const incoming = { ...body.weeklyPlan };
      // v78: whitelist the review checklist — a small { id: true } map of ticked ritual
      // steps. Keep only string keys with a truthy value, cap the size, and store as plain
      // booleans, so nothing unexpected can ride in on this additive field.
      if ("reviewChecklist" in incoming) {
        const raw = incoming.reviewChecklist;
        const clean = {};
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          for (const k of Object.keys(raw).slice(0, 24)) {
            if (typeof k === "string" && k.length <= 40 && raw[k]) clean[k] = true;
          }
        }
        incoming.reviewChecklist = clean;
      }
      // v82: whitelist the per-week exception overlay — a small map of
      //   "<recurring|training>:<id>" -> { type:"move", from, to } | { type:"skip", from? }
      // where from/to are "<slot>:<day>" grid cells. Same discipline as reviewChecklist:
      // shape-checked, size-capped, unknown fields dropped, anything malformed skipped.
      // This field is per-week only; it is never copied between weeks.
      if ("exceptions" in incoming) {
        const VALID_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
        const REF_RE = /^(recurring|training):[A-Za-z0-9_-]{1,40}$/;
        const cell = (s) => {
          if (typeof s !== "string") return null;
          const parts = s.split(":");
          if (parts.length !== 2) return null;
          if (!/^[A-Za-z0-9._-]{1,12}$/.test(parts[0])) return null;
          return VALID_DAYS.includes(parts[1]) ? s : null;
        };
        const raw = incoming.exceptions;
        const clean = {};
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          for (const k of Object.keys(raw).slice(0, 60)) {
            if (!REF_RE.test(k)) continue;
            const v = raw[k];
            if (!v || typeof v !== "object" || Array.isArray(v)) continue;
            const from = cell(v.from);
            if (v.type === "skip") {
              const o = { type: "skip" };
              if (from) o.from = from;
              clean[k] = o;
            } else if (v.type === "move") {
              const to = cell(v.to);
              if (!to) continue;                 // a move with nowhere to go is dropped
              const o = { type: "move", to };
              if (from) o.from = from;
              clean[k] = o;
            }
          }
        }
        incoming.exceptions = clean;
      }
      // v84: per-week location overrides — { day: location | "" }, same discipline: valid day
      // keys only, values from the fixed list, "" allowed as an explicit "nowhere this week".
      // Per-week only; nothing here is ever copied into another week.
      if ("locations" in incoming) incoming.locations = sanitiseLocationMap(incoming.locations, true);
      // v89: within-cell ordering hints — { "<slot>:<day>": [ref, …] }. Same discipline:
      // valid cell keys, ref-shaped strings from the four known sources, de-duped, capped,
      // everything else dropped. Ordering only ever sorts what a cell already holds, and
      // like exceptions it is per-week — never copied into another week.
      if ("cellOrder" in incoming) {
        const REF_RE = /^(project|buffer|recurring|training):[A-Za-z0-9_-]{1,40}$/;
        const raw = incoming.cellOrder;
        const clean = {};
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          for (const key of Object.keys(raw).slice(0, 60)) {
            const parts = String(key).split(":");
            if (parts.length !== 2) continue;
            if (!/^[A-Za-z0-9._-]{1,12}$/.test(parts[0]) || !VALID_DAY_KEYS.includes(parts[1])) continue;
            if (!Array.isArray(raw[key])) continue;
            const refs = [];
            for (const ref of raw[key]) {
              if (typeof ref === "string" && REF_RE.test(ref) && !refs.includes(ref) && refs.length < 24) refs.push(ref);
            }
            if (refs.length) clean[key] = refs;
          }
        }
        incoming.cellOrder = clean;
      }
      const merged = { ...existing, ...incoming, lastUpdated: new Date().toISOString() };
      await store.set(key, JSON.stringify(merged));
      return Response.json({ ok:true, plan: merged });
    }

    // Save the editable recurring defaults list.
    // v63/v64: whitelist the additive per-task fields (id/days/time/link, plus the legacy
    // v63 repeat flag) so they persist. id makes "recurring:<id>" placement refs stable
    // across reloads; days = the recurrence day set (any combination mon..sun) and time =
    // its preset slot row; link is the optional task URL. Unknown fields still dropped.
    if (Array.isArray(body.recurringDefaults)) {
      const VALID_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
      const clean = body.recurringDefaults
        .filter((t) => t && typeof t.title === "string")
        .map((t) => {
          const d = { title: t.title, owner: t.owner || "" };
          if (typeof t.id === "string" && t.id) d.id = t.id;
          if (Array.isArray(t.days)) {
            const days = t.days.filter((x) => VALID_DAYS.includes(x));
            if (days.length) d.days = days;
          }
          if (t.repeat === "weekdays" || t.repeat === "weekly") d.repeat = t.repeat; // legacy v63
          if (typeof t.time === "string" && t.time) d.time = t.time;
          if (typeof t.link === "string" && /^https?:\/\//i.test(t.link)) d.link = t.link;
          return d;
        });
      await store.set(RECURRING_DEFAULTS_KEY, JSON.stringify(clean));
      return Response.json({ ok:true, defaults: clean });
    }

    // v71: save the personal Training list — its own key, the same whitelist discipline
    // as recurringDefaults (id/title/days/time/link; unknown fields dropped). Writes here
    // can never touch the recurring defaults key, and vice versa.
    if (Array.isArray(body.trainingDefaults)) {
      const VALID_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
      // v76: the training emoji is auto-detected client-side (the manual override was
      // removed), so no `emoji` field is persisted anymore — any legacy value just drops.
      const clean = body.trainingDefaults
        .filter((t) => t && typeof t.title === "string")
        .map((t) => {
          const d = { title: t.title };
          if (typeof t.id === "string" && t.id) d.id = t.id;
          if (Array.isArray(t.days)) {
            const days = t.days.filter((x) => VALID_DAYS.includes(x));
            if (days.length) d.days = days;
          }
          if (typeof t.time === "string" && t.time) d.time = t.time;
          if (typeof t.link === "string" && /^https?:\/\//i.test(t.link)) d.link = t.link;
          return d;
        });
      await store.set(TRAINING_DEFAULTS_KEY, JSON.stringify(clean));
      return Response.json({ ok:true, defaults: clean });
    }

    // v84: save the DEFAULT weekly location pattern (its own key, whole map written as a
    // unit). No "" values here — an unset day is simply absent from the pattern.
    if (body.locationDefaults && typeof body.locationDefaults === "object" && !Array.isArray(body.locationDefaults)) {
      const clean = sanitiseLocationMap(body.locationDefaults, false);
      await store.set(LOCATION_DEFAULTS_KEY, JSON.stringify(clean));
      return Response.json({ ok:true, locations: clean });
    }

    // v80: save one day's check-in. Merges into the date-keyed map (never rewrites other
    // days), stamps updatedAt, and returns the stored entry. Additive — isolated from the
    // weekly plan and every other key.
    if (body.checkin && body.checkin.date) {
      const date = body.checkin.date;
      if (!validWeekDate(date)) return new Response("Bad checkin.date (expected YYYY-MM-DD)", { status: 400 });
      const map = (await store.get(DAILY_CHECKINS_KEY, { type: "json" })) || {};
      const entry = cleanCheckin(body.checkin);
      map[date] = entry;
      await store.set(DAILY_CHECKINS_KEY, JSON.stringify(map));
      return Response.json({ ok:true, checkin: entry });
    }

    // Save one quarter's Thinking Time record under "qtt-YYYY-QN". Merges over existing
    // so partial saves are safe. Isolated from planning-* and every other key.
    if (body.qtt && body.qtt.tag) {
      const tag = body.qtt.tag;
      if (!validPlanningTag(tag)) return new Response("Bad qtt.tag", { status: 400 });
      // Phase F: a finalised review quarter's Thinking Time is locked. Reject unless reopened.
      if (await qttIsFinalised(store, tag)) {
        return Response.json({ error: "Thinking Time for " + tag + " is finalised and locked. Reopen the quarter to edit it." }, { status: 423 });
      }
      const key = qttKeyOf(tag);
      const existing = (await store.get(key, { type: "json" })) || {};
      const incoming = { ...body.qtt };
      delete incoming.tag; // tag is the key, not stored data
      // deep-merge the answers map so a partial answer save never drops other answers
      const mergedAnswers = { ...(existing.answers || {}), ...(incoming.answers || {}) };
      const merged = { ...existing, ...incoming, answers: mergedAnswers, lastUpdated: new Date().toISOString() };
      await store.set(key, JSON.stringify(merged));
      return Response.json({ ok:true, record: merged });
    }

    // Phase D: APPEND one AI analysis version for a review quarter under
    // "qtt-analysis-YYYY-QN". Never overwrites earlier versions — reads the existing
    // { reviewTag, versions:[] } container, pushes the new version, writes it back.
    // Server assigns the version number and stamps the container so a client can't
    // clobber history. Fully isolated from qtt-, planning-, aiOutputs.
    if (body.qttAnalysis && body.qttAnalysis.reviewTag && body.qttAnalysis.version) {
      const tag = body.qttAnalysis.reviewTag;
      if (!validPlanningTag(tag)) return new Response("Bad qttAnalysis.reviewTag", { status: 400 });
      const v = body.qttAnalysis.version;
      // basic shape guard: a version must carry outputs + status; the front end validates
      // the full schema before it ever reaches here, this is a defensive backstop.
      if (!v || typeof v !== "object" || !v.outputs || !v.status) {
        return new Response("Bad qttAnalysis.version shape", { status: 400 });
      }
      const key = qttAnalysisKeyOf(tag);
      const existing = (await store.get(key, { type: "json" })) || { reviewTag: tag, versions: [] };
      if (!Array.isArray(existing.versions)) existing.versions = [];
      const nextNum = existing.versions.reduce((m, x) => Math.max(m, x.version || 0), 0) + 1;
      const stored = { ...v, version: nextNum, storedAt: new Date().toISOString() };
      existing.versions.push(stored);
      existing.reviewTag = tag;
      existing.lastUpdated = new Date().toISOString();
      await store.set(key, JSON.stringify(existing));
      return Response.json({ ok:true, analysis: existing, version: stored });
    }

    // Phase E: SAVE the approval/routing record for one analysis version. The whole record
    // is written as a unit (front end sends the complete object after each change). Keyed by
    // review tag + version, fully isolated from analysis versions and planning records.
    if (body.qttApprovals && body.qttApprovals.reviewTag && body.qttApprovals.analysisVersion) {
      const tag = body.qttApprovals.reviewTag;
      const version = body.qttApprovals.analysisVersion;
      if (!validPlanningTag(tag)) return new Response("Bad qttApprovals.reviewTag", { status: 400 });
      if (!Number.isInteger(version) || version < 1) return new Response("Bad qttApprovals.analysisVersion", { status: 400 });
      // Phase F: approval working copies/statuses are locked once the review quarter is finalised.
      if (await qttIsFinalised(store, tag)) {
        return Response.json({ error: "Approvals for " + tag + " are finalised and locked. Reopen the quarter to edit." }, { status: 423 });
      }
      const rec = { ...body.qttApprovals, lastUpdated: new Date().toISOString() };
      await store.set(qttApprovalKeyOf(tag, version), JSON.stringify(rec));
      return Response.json({ ok:true, approvals: rec });
    }

    // Phase F: FINALISATION handler. Manages the review-quarter lock lifecycle
    // (finalise / reopen / re-finalise) and stores carry-forward decisions. This is the
    // ONLY writer of qtt-final-*, and it is never blocked by the lock (it IS the lock).
    // Actions:
    //   action:"finalise" — set status finalised, append a finalised/re-finalised event
    //   action:"reopen"   — set status reopened (requires reason), append a reopened event
    //   action:"carryforward" — persist the carry-forward candidates/decisions only
    if (body.qttFinal && body.qttFinal.reviewTag && body.qttFinal.action) {
      const tag = body.qttFinal.reviewTag;
      if (!validPlanningTag(tag)) return new Response("Bad qttFinal.reviewTag", { status: 400 });
      const action = body.qttFinal.action;
      const key = qttFinalKeyOf(tag);
      const existing = (await store.get(key, { type: "json" })) || {
        reviewTag: tag, destinationTag: body.qttFinal.destinationTag || null,
        status: "open", finalisedAt: null, finalisedBy: null, finalisedAnalysisVersion: null,
        readinessSnapshot: null, routedReferences: [], carryForward: { candidates: {}, lastUpdated: null },
        reopenedAt: null, reopenedReason: null, history: []
      };
      if (!Array.isArray(existing.history)) existing.history = [];
      const now = new Date().toISOString();

      if (action === "finalise") {
        // Idempotent: if already finalised and the incoming payload carries the same
        // analysis version, do not append a duplicate event — just return current state.
        const sameVersion = existing.status === "finalised"
          && existing.finalisedAnalysisVersion === body.qttFinal.finalisedAnalysisVersion;
        if (sameVersion) {
          return Response.json({ ok:true, final: existing, idempotent:true });
        }
        const isRefinalise = existing.status === "reopened" || (existing.finalisedAt && existing.status !== "finalised");
        if (!existing.finalisedAt) existing.finalisedAt = now; // preserve the FIRST finalisation time
        existing.status = "finalised";
        existing.finalisedBy = "owner";
        existing.finalisedAnalysisVersion = body.qttFinal.finalisedAnalysisVersion ?? existing.finalisedAnalysisVersion;
        existing.destinationTag = body.qttFinal.destinationTag || existing.destinationTag;
        if (body.qttFinal.readinessSnapshot) existing.readinessSnapshot = body.qttFinal.readinessSnapshot;
        if (Array.isArray(body.qttFinal.routedReferences)) existing.routedReferences = body.qttFinal.routedReferences;
        existing.reopenedAt = null; existing.reopenedReason = null;
        existing.history.push({
          action: isRefinalise ? "re-finalised" : "finalised", at: now, reason: body.qttFinal.reason || "",
          analysisVersion: existing.finalisedAnalysisVersion,
          approvalSnapshot: (body.qttFinal.readinessSnapshot && body.qttFinal.readinessSnapshot.approvals) || null,
          routingSnapshot: Array.isArray(body.qttFinal.routedReferences) ? body.qttFinal.routedReferences.length : 0
        });
        existing.lastUpdated = now;
        await store.set(key, JSON.stringify(existing));
        return Response.json({ ok:true, final: existing });
      }

      if (action === "reopen") {
        if (!body.qttFinal.reason) return Response.json({ error: "Reopen requires a reason." }, { status: 400 });
        if (existing.status !== "finalised") {
          return Response.json({ ok:true, final: existing, idempotent:true }); // not finalised → nothing to reopen
        }
        existing.status = "reopened";
        existing.reopenedAt = now;
        existing.reopenedReason = body.qttFinal.reason;
        // finalisedAt is PRESERVED (first finalisation time is never overwritten)
        existing.history.push({ action:"reopened", at: now, reason: body.qttFinal.reason,
          analysisVersion: existing.finalisedAnalysisVersion, approvalSnapshot:null, routingSnapshot:0 });
        existing.lastUpdated = now;
        await store.set(key, JSON.stringify(existing));
        return Response.json({ ok:true, final: existing });
      }

      if (action === "carryforward") {
        // Persist carry-forward candidates/decisions only. Allowed while open OR finalised
        // (recording a decision is not a review-section edit); routing writes themselves go
        // through the normal planning handler and respect the destination quarter's own lock.
        existing.carryForward = { candidates: (body.qttFinal.candidates || {}), lastUpdated: now };
        if (body.qttFinal.carryForwardReviewId) existing.carryForwardReviewId = body.qttFinal.carryForwardReviewId;
        existing.lastUpdated = now;
        await store.set(key, JSON.stringify(existing));
        return Response.json({ ok:true, final: existing });
      }

      return Response.json({ error: "Unknown qttFinal.action" }, { status: 400 });
    }


    // record handled by body.month below). Merges over existing so section saves are safe.
    if (body.monthlyPlan && body.monthlyPlan.ym) {
      const ym = body.monthlyPlan.ym;
      if (!validYm(ym)) return new Response("Bad monthlyPlan.ym", { status: 400 });
      const key = monthlyPlanKeyOf(ym);
      const existing = (await store.get(key, { type: "json" })) || defaultMonthlyPlan(ym);
      const incoming = { ...body.monthlyPlan };
      // v90: focus items get the same field-whitelist discipline as the weekly defaults —
      // {id,title,rockRef,notes,done} plus the push-forward provenance {pushedFrom,pushedFromId}.
      // Anything else is dropped server-side. Only touched when focus is actually part of
      // this write, so priorities/notes/review section saves are unaffected.
      if (Array.isArray(incoming.focus)) incoming.focus = cleanMonthlyFocus(incoming.focus);
      // v97: the priorities list is now the PERSONAL counterpart to focus, so it gets the
      // same whitelist treatment — and a business rockRef is no longer one of its fields,
      // so a stale one from before the repurpose is dropped here too.
      if (Array.isArray(incoming.priorities)) incoming.priorities = cleanMonthlyPriorities(incoming.priorities);
      const merged = { ...existing, ...incoming, lastUpdated: new Date().toISOString() };
      await store.set(key, JSON.stringify(merged));
      return Response.json({ ok:true, plan: merged });
    }

    // Save one monthly record (manual entries + overrides), keyed by ym "YYYY-MM".
    // Additive: does not touch the weekly "weeks" store. Upsert, never duplicate.
    if (body.month && body.month.ym) {
      const months = (await store.get(MONTHS_KEY, { type: "json" })) || [];
      const i = months.findIndex((m) => m.ym === body.month.ym);
      if (i >= 0) months[i] = { ...months[i], ...body.month };
      else months.push(body.month);
      months.sort((a, b) => (a.ym < b.ym ? -1 : 1));
      await store.set(MONTHS_KEY, JSON.stringify(months));
      return Response.json({ ok:true, month: body.month, months });
    }

    // Bulk monthly seed: merge many month records in ONE atomic write.
    // Existing months are kept unless overwrite=true; seeded months are upserted by ym.
    if (Array.isArray(body.monthsBulk)) {
      const months = (await store.get(MONTHS_KEY, { type: "json" })) || [];
      let written = 0;
      for (const rec of body.monthsBulk) {
        if (!rec || !rec.ym) continue;
        const i = months.findIndex((m) => m.ym === rec.ym);
        if (i >= 0) {
          if (body.overwrite) { months[i] = { ...months[i], ...rec }; written++; }
        } else {
          months.push(rec); written++;
        }
      }
      months.sort((a, b) => (a.ym < b.ym ? -1 : 1));
      await store.set(MONTHS_KEY, JSON.stringify(months));
      return Response.json({ ok:true, written, months });
    }

    // Bulk seed: write many weeks at once, ONLY if the store is currently empty.
    if (body.seedAll && Array.isArray(body.weeks)) {
      const existing = (await store.get(KEY, { type: "json" })) || [];
      if (existing.length === 0) {
        const seeded = body.weeks.slice().sort((a,b)=>(a.weekEnding<b.weekEnding?-1:1));
        await store.set(KEY, JSON.stringify(seeded));
        return Response.json({ ok:true, seeded:seeded.length, weeks:seeded });
      }
      return Response.json({ ok:true, seeded:0, note:"store not empty, seed skipped", weeks:existing });
    }

    const w = body.week;
    if (!w || !w.weekEnding) {
      return new Response("Missing week.weekEnding", { status: 400 });
    }

    const weeks = (await store.get(KEY, { type: "json" })) || [];
    weeks.sort((a, b) => (a.weekEnding < b.weekEnding ? -1 : 1));

    // upsert by weekEnding (re-pulling a week overwrites its fields, never duplicates)
    const i = weeks.findIndex((x) => x.weekEnding === w.weekEnding);
    const incoming = { ...w };

    // ---- Calculated recurring ----
    // recurring = previous week's recurring + signups - cancellations.
    // IMPORTANT: only compute/touch recurring when this save actually carries KPI data
    // (signups/cancellations present). An FB-only save must NOT recalculate recurring,
    // or it would clobber the real value with base+0-0.
    const carriesKpi = ('signups' in incoming) || ('cancellations' in incoming) || ('recurringSeed' in incoming);
    if ((body.calcRecurring || incoming.recurring == null) && carriesKpi) {
      // find the most recent week BEFORE this one that has a recurring value
      const prior = [...weeks]
        .filter((x) => x.weekEnding < w.weekEnding && typeof x.recurring === "number")
        .pop();
      const base = prior ? prior.recurring : (incoming.recurringSeed ?? null);
      if (base != null) {
        const s = incoming.signups ?? 0;
        const c = incoming.cancellations ?? 0;
        incoming.recurring = base + s - c;
        incoming.recurringCalc = true; // mark as calculated, not pulled
      }
    }

    // ---- Monthly true-up ----
    // If a live active-member count is supplied, record the drift and reset to truth.
    if (typeof body.trueUpRecurring === "number") {
      incoming.recurringDrift = body.trueUpRecurring - (incoming.recurring ?? body.trueUpRecurring);
      incoming.recurring = body.trueUpRecurring; // reset baseline to reality
      incoming.recurringCalc = false;
      incoming.recurringTrueUp = true;
    }

    if (i >= 0) weeks[i] = { ...weeks[i], ...incoming };
    else weeks.push(incoming);

    weeks.sort((a, b) => (a.weekEnding < b.weekEnding ? -1 : 1));
    await store.set(KEY, JSON.stringify(weeks));
    return Response.json({ ok: true, count: weeks.length, week: incoming, weeks });
  }

  return new Response("Method not allowed", { status: 405 });
};
