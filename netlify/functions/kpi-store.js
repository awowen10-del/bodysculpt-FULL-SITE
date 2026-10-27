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
// v253: the last thing deleted from the Daily Dashboard, kept whole so Undo can put it back
const LAST_DELETE_KEY = "weekly-last-delete";
// v80: daily check-in history — a single blob holding a map { "YYYY-MM-DD": entry }, so every
// day's answers accumulate and are trivially retrievable as a list for a future AI advisor.
const DAILY_CHECKINS_KEY = "daily-checkins";
// v135: the Daily Dashboard's morning brief. Ash's scheduled email triage already labels
// the inbox (Triage/Urgent, Triage/Today, Triage/This week, Triage/FYI); after it has done
// that it POSTs a digest here, and daily.html renders it. One blob holding a map keyed
// "YYYY-MM-DD", exactly like daily-checkins — so the history accumulates, one GET returns
// the lot, and a bad push can only ever spoil the day it was pushed for.
const DAILY_BRIEFS_KEY = "daily-briefs";
// v136: the Instagram accounts Ash watches. Just the list — the posts themselves are never
// stored here, they come live (and cached for half an hour) from netlify/functions/
// instagram-feed.js under its own `ig-cache-*` keys. Ten is the cap because eleven accounts
// is not monitoring, it is a hobby.
// v149: the weekly plan's grid, resolved to titles, so the Daily Dashboard can show what
// Ash has planned for today beside what is already in his calendar.
//
// THIS IS A DERIVED CACHE, NOT DATA. Everything in it comes from `weekly-plan-<date>` plus
// the recurring/training defaults, run through the placement engine that lives in
// index.html — schedules, this week's move/skip exceptions, cadence, within-cell order. That
// engine is NOT duplicated here or in daily.html; the weekly page writes what it has already
// worked out, and the daily page reads it. Losing this key costs nothing: open the weekly
// plan once and it is rewritten.
const WEEKLY_AGENDA_PREFIX = "weekly-agenda-";   // + "YYYY-MM-DD" (the week ending)
const AGENDA_CELL_CAP = 60;      // cells; the grid has 7 days x 5 rows
const AGENDA_ITEM_CAP = 12;      // per cell — more than that and nobody is reading it anyway
const AGENDA_KINDS = ["project", "buffer", "recurring", "training"];
function agendaKeyOf(d) { return WEEKLY_AGENDA_PREFIX + d; }
/* v150: where a task's tick is kept. Two shapes, and nothing else is ever accepted:
     { l: "projectItems" | "bufferItems", k: "<item id>" }     -> item.done
     { m: "recurringDone" | "trainingDone", k: "<id>" | "<id>:<day>" } -> map[key]
   The RULE for which shape applies, and whether the key carries a day, lives in index.html
   where the grid engine is. This end only writes to the address it is given — but it checks
   that address hard, because it is the one thing on the daily page that can reach a plan. */
const TICK_LISTS = ["projectItems", "bufferItems"];
const TICK_MAPS = ["recurringDone", "trainingDone"];
function cleanTickTarget(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const k = typeof raw.k === "string" ? raw.k : "";
  if (!/^[A-Za-z0-9_-]{1,60}(:[a-z]{3})?$/.test(k)) return null;
  if (TICK_LISTS.includes(raw.l)) return { l: raw.l, k };
  if (TICK_MAPS.includes(raw.m)) return { m: raw.m, k };
  return null;
}
/* v227: a project step on the agenda is not in the plan at all — the weekly page reads it
   live from the projects store and the agenda row says WHICH step it is. Its tick goes to
   that step (the projects function's stepLink route), never to a plan, so this shape is
   accepted on an agenda row and refused by weeklyTick, which only takes cleanTickTarget. */
function cleanStepTarget(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const ok = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v);
  return ok(raw.p) && ok(raw.s) ? { p: raw.p, s: raw.s } : null;
}
function cleanAgenda(raw) {
  if (!raw || typeof raw !== "object") return null;
  const weekEnding = typeof raw.weekEnding === "string" ? raw.weekEnding : "";
  if (!validWeekDate(weekEnding)) return null;
  const cells = {};
  const src = (raw.cells && typeof raw.cells === "object" && !Array.isArray(raw.cells)) ? raw.cells : {};
  let n = 0;
  for (const key of Object.keys(src)) {
    if (n >= AGENDA_CELL_CAP) break;
    // a cell key is "<slot>:<day>" and nothing else
    if (!/^[a-z0-9-]{1,12}:[a-z]{3}$/.test(key)) continue;
    const rows = (Array.isArray(src[key]) ? src[key] : [])
      .map((it) => {
        if (!it || typeof it !== "object") return null;
        const title = typeof it.title === "string" ? it.title.slice(0, 200).trim() : "";
        if (!title) return null;
        return {
          title,
          kind: AGENDA_KINDS.includes(it.kind) ? it.kind : "project",
          done: it.done === true,
          tgt: cleanTickTarget(it.tgt) || cleanStepTarget(it.tgt),     // may be null; a row without one simply cannot be ticked
        };
      })
      .filter(Boolean)
      .slice(0, AGENDA_ITEM_CAP);
    if (!rows.length) continue;
    cells[key] = rows;
    n++;
  }
  return { weekEnding, cells, updatedAt: new Date().toISOString() };
}

const IG_COMPETITORS_KEY = "ig-competitors";
const IG_COMPETITOR_CAP = 10;
// An Instagram username is letters, digits, dots and underscores. Ash will paste a profile
// URL or an @handle at some point, so both are unwrapped rather than rejected.
function cleanCompetitor(raw) {
  const src = typeof raw === "string" ? raw : (raw && typeof raw === "object" ? raw.username : "");
  const username = String(src || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/[/?#].*$/, "")
    .replace(/^@/, "")
    .replace(/[^A-Za-z0-9._]/g, "")
    .toLowerCase()
    .slice(0, 40);
  if (!username) return null;
  const label = (raw && typeof raw === "object" && typeof raw.label === "string")
    ? raw.label.trim().slice(0, 60) : "";
  return { username, label };
}
const BRIEF_TIERS = ["urgent", "today", "week", "fyi"];   // the hierarchy, most-urgent first
const BRIEF_ITEM_CAP = 60;      // a morning's inbox, not an archive
const BRIEF_DAYS_KEPT = 30;     // the map is pruned to the newest 30 dates on every write
// Whitelist + coerce one brief. Everything here arrives from an AI job over an open
// endpoint, so nothing is trusted: unknown fields are dropped, unknown tiers are dropped,
// every string is capped, and the item list is truncated rather than rejected.
function cleanBriefItem(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
  const tier = BRIEF_TIERS.includes(raw.tier) ? raw.tier : "";
  if (!tier) return null;                       // no tier, no place on the page
  const subject = str(raw.subject, 400).trim();
  const from = str(raw.from, 200).trim();
  if (!subject && !from) return null;           // nothing to show
  return {
    tier,
    from,
    subject,
    why: str(raw.why, 400).trim(),
    action: str(raw.action, 80).trim(),
    threadId: str(raw.threadId, 60).replace(/[^A-Za-z0-9_-]/g, ""),
    receivedAt: str(raw.receivedAt, 40),
    // v142: the scheduled job does not only sort the inbox, it WRITES THE REPLY and saves
    // it as a draft. That changes what this card is for — not "these need answering" but
    // "these are answered, go and send them" — so the draft comes across with the item.
    // `draftId` is the draft's message id, used to deep-link Gmail's composer;
    // `draftPreview` is the opening of what it says, so the reply can be judged from here
    // rather than by opening five tabs to find out.
    draftId: str(raw.draftId, 80).replace(/[^A-Za-z0-9_-]/g, ""),
    draftPreview: str(raw.draftPreview, 600).replace(/\s+/g, " ").trim(),
  };
}
function cleanBrief(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
  const date = str(raw.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map(cleanBriefItem).filter(Boolean).slice(0, BRIEF_ITEM_CAP);
  // The counts are DERIVED here rather than taken on trust, so the page's tier headings can
  // never disagree with the rows underneath them.
  const counts = {};
  for (const t of BRIEF_TIERS) counts[t] = items.filter((i) => i.tier === t).length;
  // Derived here, like the tier counts, so the page's headline can never disagree with the
  // rows under it however the job words its payload.
  const drafted = items.filter((i) => i.draftId || i.draftPreview).length;
  return {
    date,
    summary: str(raw.summary, 1200).trim(),
    source: str(raw.source, 40) || "claude-triage",
    items,
    counts,
    drafted,
    generatedAt: new Date().toISOString(),
  };
}
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
// v219: the four bands of the weekly grid, by the keys index.html uses. A band that is not
// one of these names a row of the grid that does not exist.
const CHECKIN_BANDS = ["6-9", "10-12", "1-3", "5-8"];
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
    /* v219: the day, run from the Daily Dashboard's focus mode.
         oneThingWhen  which of the weekly grid's four bands the one thing is for ("" = unsaid).
                       Saying WHEN you will do something is the difference between a list and
                       a plan, so it is stored beside the thing itself.
         parked        keys of today's jobs deliberately put aside. Not "not done" — decided
                       against, for today. The weekly plan has no field for that and should
                       not: it is a fact about a day, and it lives with the day.
         dayNote       the one line written at the end of the day.
         closedAt      when the day was closed off ("" = still open). */
    oneThingWhen: CHECKIN_BANDS.includes(raw.oneThingWhen) ? raw.oneThingWhen : "",
    parked: Array.isArray(raw.parked)
      ? raw.parked.filter((k) => typeof k === "string" && k.length <= 120).slice(0, 60)
      : [],
    dayNote: str(raw.dayNote),
    closedAt: str(raw.closedAt).slice(0, 30),
    habits: cleanHabits(raw.habits),        // v88: { habitId: boolean }, known ids only
    habitsAsked: !!raw.habitsAsked,         // v88: yesterday's catch-up already answered today
    updatedAt: new Date().toISOString(),
  };
}
// v84: daily location. WHERE you are on each day of the week — a default weekly pattern in
// its own key, plus optional per-week overrides carried on the week's plan (field
// "locations"). Purely informational: it never touches tasks, placements or done-state.
const LOCATION_DEFAULTS_KEY = "weekly-location-defaults";

/* v236: THE FOOD HUB. Additive — no existing key, field or route changes.
     food-inventory     the meat, fridge and cupboard — NOT per week; leftovers simply stay
     food-plan-<week>   the week: schedule, situation, meals (against their dates), prep
                        session, to-buy list, end-of-week leftovers — keyed like weekly-plan-<week>
     food-settings      kids' notes, people eating, the planning rules text — once
     food-products      Tesco products linked by ingredient, reused every week
     food-taste         the family's taste profile, built from every rating
   The page writes only what Ash types, ticks and taps. The meals, prep session and to-buy list
   are written by the food functions after Claude's answer has passed every check
   (netlify/lib/food.js); nothing here can set them. "Cooked" is plain arithmetic on the
   inventory — no AI. The key strings and default lists match netlify/lib/food.js; tests/v236
   asserts it. */
const FOOD_PLAN_PREFIX = "food-plan-";
const FOOD_SETTINGS_KEY = "food-settings";
const FOOD_PRODUCTS_KEY = "food-products";
const FOOD_TASTE_KEY = "food-taste";
const FOOD_INVENTORY_KEY = "food-inventory";
const FOOD_RECIPES_KEY = "food-recipes";
function foodPlanKeyOf(w) { return FOOD_PLAN_PREFIX + w; }
const FOOD_PROTEIN_DEFAULTS = { proteinMin: 30, proteinMax: 40, servings: 3 };
const FOOD_DEFAULT_SPICES = ["Italian seasoning", "bay leaves", "thyme", "toasted sesame seeds", "Colman's mustard powder",
  "Korean seasoning (Rub Me Seoul Food)", "everything bagel seasoning", "lemon pepper", "hot honey seasoning", "mild curry powder",
  "whole cloves", "Nando's Peri-Salt", "Knorr Aromat"];
const FOOD_DEFAULT_STAPLES = ["olive oil", "salt", "black pepper", "stock cubes", "plain flour"];
const FOOD_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const FOOD_NIGHT_TYPES = ["family", "solo", "busy", "none"];
const FOOD_CATEGORIES = ["meat", "fresh", "cupboard", "sauces", "spices", "staples"];
const FOOD_UNITS = ["g", "ml", "count"];
const FOOD_STORAGE = ["fridge", "freezer", "cupboard"];
const FOOD_RATERS = ["polly", "artie", "adults"];
const FOOD_RATING_VALUES = ["up", "so", "down"];
const foodStr = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const foodKey = (name) => String(name || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
const foodToday = () => new Date().toISOString().slice(0, 10);
const foodId = (p) => p + Math.random().toString(36).slice(2, 9);
const foodYmd = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
function foodDefaultInventory() {
  const t = foodToday();
  const mk = (name, category) => ({ id: foodId("i_"), name, qty: 1, unit: "count", category, storage: "cupboard", added: t, opened: "" });
  return { items: [...FOOD_DEFAULT_SPICES.map((n) => mk(n, "spices")), ...FOOD_DEFAULT_STAPLES.map((n) => mk(n, "staples"))] };
}
// one inventory item, cleaned — anything unknown falls back to something safe
function foodCleanItem(raw, existing) {
  const it = { ...(existing || {}) };
  if (!existing) it.id = foodId("i_");
  if ("name" in raw) it.name = foodStr(raw.name, 80).trim();
  if ("qty" in raw) { const n = Number(raw.qty); it.qty = Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; }
  if ("unit" in raw || !existing) it.unit = FOOD_UNITS.includes(raw.unit) ? raw.unit : (it.unit || "count");
  if ("category" in raw || !existing) it.category = FOOD_CATEGORIES.includes(raw.category) ? raw.category : (it.category || "fresh");
  if ("storage" in raw || !existing) it.storage = FOOD_STORAGE.includes(raw.storage) ? raw.storage : (it.storage || "fridge");
  if ("added" in raw || !existing) it.added = foodYmd(raw.added) || it.added || foodToday();
  if ("opened" in raw) it.opened = foodYmd(raw.opened);
  if (!("opened" in it)) it.opened = "";
  return it;
}
function emptyFoodPlan(week) {
  return { weekEnding: week, schedule: {}, situation: "", people: 4, meals: [], prepSession: { bags: [], steps: [] },
    toBuy: [], endLeftovers: [], generatedAt: "", model: "" };
}
/* the taste profile — favourites: any meal both kids gave a thumbs up; never again: both kids
   thumbs down, or the adults did; and every note */
function foodTasteDerive(t) {
  const names = Object.values(t.meals || {});
  const any = (m, f) => (m.ratings || []).some(f);
  t.favourites = names.filter((m) => any(m, (r) => r.polly === "up" && r.artie === "up")).map((m) => m.name);
  t.neverAgain = names.filter((m) => any(m, (r) => (r.polly === "down" && r.artie === "down") || r.adults === "down")).map((m) => m.name);
  t.notes = names.flatMap((m) => (m.ratings || []).filter((r) => r.note).map((r) => ({ week: r.week, meal: m.name, note: r.note })))
    .sort((a, b) => (a.week < b.week ? 1 : a.week > b.week ? -1 : 0)).slice(0, 200);
  return t;
}
/* the recipe book — a meal both kids gave a thumbs up, or one Ash starred "Keep", saved in full.
   One entry per dish (by name, or by the book id a meal was cooked from), so a favourite cooked
   again updates its ratings rather than duplicating. The planner reuses these exactly. */
function foodRecipeFrom(meal, plan, week, prev) {
  const r = meal.ratings || {};
  const notes = (prev && Array.isArray(prev.notes) ? prev.notes : []).filter((n) => !(n.week === week && n.mealId === meal.id));
  const same = !!(prev && prev.from && prev.from.week === week && prev.from.mealId === meal.id);
  if (r.note) notes.unshift({ week, mealId: meal.id, note: r.note });
  return {
    id: (prev && prev.id) || foodId("r_"), key: foodKey(meal.name), name: foodStr(meal.name, 120), summary: foodStr(meal.summary, 240),
    dumpBag: meal.dumpBag === true, slowCooker: meal.slowCooker || { low: "", high: "" },
    ingredients: (meal.ingredients || []).slice(0, 30).map((i) => ({ name: foodStr(i.name, 80), qty: foodStr(i.qty, 40),
      protein: Number(i.protein) || 0, topUp: i.topUp === true })),
    method: (meal.method || []).slice(0, 30).map((x) => foodStr(x, 600)), kidTip: foodStr(meal.kidTip, 300),
    perAdult: meal.perAdult || null, proteinTopUps: (meal.proteinTopUps || []).slice(0, 6), people: Number(plan.people) || 4,
    ratings: { polly: r.polly || "", artie: r.artie || "", adults: r.adults || "" }, notes: notes.slice(0, 20),
    // a recipe earned on ANOTHER night stays earned — a so-so the next time does not throw a
    // favourite out; only the meal that put it in the book can take it out again (a mis-tap undone)
    keep: meal.keep === true || !!(prev && prev.keep && (!same || meal.keep !== false)),
    kidsLoved: (r.polly === "up" && r.artie === "up") || !!(prev && !same && prev.kidsLoved),
    from: !prev || same ? { week, mealId: meal.id } : prev.from, savedAt: new Date().toISOString(),
  };
}
async function foodBookUpdate(store, meal, plan, week) {
  const book = (await store.get(FOOD_RECIPES_KEY, { type: "json" })) || { recipes: [] };
  book.recipes = Array.isArray(book.recipes) ? book.recipes : [];
  const i = book.recipes.findIndex((x) => (meal.recipeId && x.id === meal.recipeId) || x.key === foodKey(meal.name));
  const prev = i >= 0 ? book.recipes[i] : null;
  const next = foodRecipeFrom(meal, plan, week, prev);
  // a book recipe cooked again keeps its saved method and ingredients exactly — only how it went is updated
  if (prev && meal.recipeId === prev.id) { next.method = prev.method; next.ingredients = prev.ingredients; next.name = prev.name; next.key = prev.key; }
  const belongs = next.keep || next.kidsLoved;
  if (i >= 0 && belongs) book.recipes[i] = next;
  else if (i >= 0) book.recipes.splice(i, 1);
  else if (belongs) book.recipes.unshift(next);
  book.recipes = book.recipes.slice(0, 200);
  await store.set(FOOD_RECIPES_KEY, JSON.stringify(book));
  return book;
}
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
// v113: whitelist for a recurring task's optional monthly/quarterly cadence. Returns
// { cadence, rule } only when BOTH the cadence and a fully-valid rule are present; anything
// unrecognised returns null and the task stores as the plain weekly task it was. Field by
// field, so an unknown extra key on a rule is dropped rather than persisted:
//   monthly   { type:"dayOfMonth",     day:1..31|"last",                        slot }
//             { type:"ordinalWeekday", ordinal:1..4|"last", weekday:"mon".."sun", slot }
//   quarterly { type:"monthOfQuarter", month:1..3, day:1..31|"last",             slot }
//             { type:"ordinalWeekday", ordinal, weekday, monthOfQuarter:1..3,    slot }
const CADENCE_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
function cleanRecurringCadence(t) {
  const cadence = t && (t.cadence === "monthly" || t.cadence === "quarterly") ? t.cadence : "";
  if (!cadence) return null;
  const raw = cadence === "monthly" ? t.monthlyRule : t.quarterlyRule;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const slot = typeof raw.slot === "string" && raw.slot ? raw.slot.slice(0, 20) : "6-9";
  const dayOf = (v) => {
    if (v === "last") return "last";
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 1 && n <= 31 ? n : null;
  };
  const moqOf = (v) => { const n = Math.floor(Number(v)); return n >= 1 && n <= 3 ? n : null; };
  if (raw.type === "ordinalWeekday") {
    let ordinal = null;
    if (raw.ordinal === "last") ordinal = "last";
    else { const n = Math.floor(Number(raw.ordinal)); if (n >= 1 && n <= 4) ordinal = n; }
    if (ordinal === null || !CADENCE_WEEKDAYS.includes(raw.weekday)) return null;
    const rule = { type: "ordinalWeekday", ordinal, weekday: raw.weekday, slot };
    if (cadence === "quarterly") {
      const m = moqOf(raw.monthOfQuarter);
      if (m === null) return null;
      rule.monthOfQuarter = m;
    }
    return { cadence, rule };
  }
  if (cadence === "monthly" && raw.type === "dayOfMonth") {
    const day = dayOf(raw.day);
    return day === null ? null : { cadence, rule: { type: "dayOfMonth", day, slot } };
  }
  if (cadence === "quarterly" && raw.type === "monthOfQuarter") {
    const day = dayOf(raw.day), m = moqOf(raw.month);
    return day === null || m === null ? null : { cadence, rule: { type: "monthOfQuarter", month: m, day, slot } };
  }
  return null;
}
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
// v103: two additions, mirroring the focus item exactly — `notes` is now a rich-notes field
// (same "<!--wp:rich-->" marker + client-sanitised HTML, so the cap rises from a one-line
// 2000 to 20000), and pushedFrom/pushedFromId carry the push-forward provenance.
const MONTHLY_PRIORITY_STRINGS = { title: 400, owner: 60, status: 40, notes: 20000 };
function cleanMonthlyPriorities(list) {
  return list
    .filter((p) => p && typeof p === "object")
    .slice(0, 60)
    .map((p) => {
      const d = { id: typeof p.id === "string" ? p.id.slice(0, 40) : "" };
      for (const k of Object.keys(MONTHLY_PRIORITY_STRINGS)) {
        d[k] = typeof p[k] === "string" ? p[k].slice(0, MONTHLY_PRIORITY_STRINGS[k]) : "";
      }
      if (typeof p.pushedFrom === "string" && validYm(p.pushedFrom)) {
        d.pushedFrom = p.pushedFrom;
        d.pushedFromId = typeof p.pushedFromId === "string" ? p.pushedFromId.slice(0, 40) : "";
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


// ===================== FINANCES (Income & Expenses) =====================
// v122. The finance module replaces the Google Sheet "Finance Cockpit 2026". It is
// deliberately its OWN set of keys, so nothing here can touch weeks/planning/plans.
//   finance-txns-YYYY-MM  — one month of transactions  { ym, rows:[...], lastUpdated }
//   finance-settings      — pot percentages, income-source keywords, category list
//   finance-rules         — learned "description contains X -> category" rules
//   finance-week-YYYY-MM-DD — one Thu→Wed week's pot move (marked done, amounts, note)
// Per-month and per-week keys for the same reason planning uses per-quarter keys:
// Blobs is last-write-wins within ONE key, so two months must never share one.
const FIN_TXN_PREFIX = "finance-txns-";      // + "YYYY-MM"
const FIN_SETTINGS_KEY = "finance-settings";
const FIN_RULES_KEY = "finance-rules";
// v132: what Ash has already told an AI about his business, kept so next week's prompt can
// say "do not ask me this again". One blob, a list of plain sentences — deliberately not
// structured, because the value is in the wording he used.
const FIN_NOTES_KEY = "finance-notes";
const FIN_WEEK_PREFIX = "finance-week-";     // + "YYYY-MM-DD" (the Thursday it starts)
function finTxnKeyOf(ym) { return FIN_TXN_PREFIX + ym; }

/* v262: Banked Revenue is what actually LANDED IN THE BANK that month. Ash, 27 Oct:
   "Banked revenue and what landed should be the same surely?" — it used to be the month's
   Stripe/GoCardless/SumUp sales minus fees, which goes by the day a customer paid, so
   payouts that crossed a month end showed in the wrong month. Worked out on every read
   from the Finances store with the same rule as the Finances page's Money in (no own-
   account transfers, no directors loans, nothing deleted). Never stored: a later import
   or recategorisation changes it with no second copy to fall out of step. A month with no
   statement keeps the stored sales-based figure, so 2025 and the quarterly reviews built
   on it are untouched. */
function finMoneyIn(rows) {
  return rows.reduce((a, r) => a + (r && r.dir === "in" && !r.del
    && r.cat !== "Transfer" && r.cat !== "Directors loan" ? Number(r.amount) || 0 : 0), 0);
}
async function withBankIn(store, months) {
  return Promise.all(months.map(async (m) => {
    if (!m || !validYm(m.ym)) return m;
    const out = { ...m };
    delete out.bankIn;
    let saved = null;
    try { saved = await store.get(finTxnKeyOf(m.ym), { type: "json" }); } catch { saved = null; }
    const rows = saved && Array.isArray(saved.rows) ? saved.rows : [];
    if (rows.length) {
      out.salesAfterFees = typeof m.charged === "number"
        ? Math.round((m.charged - (Number(m.processingFees) || 0)) * 100) / 100 : m.banked;
      out.bankIn = Math.round(finMoneyIn(rows) * 100) / 100;
      out.banked = out.bankIn;
    }
    return out;
  }));
}
function finWeekKeyOf(d) { return FIN_WEEK_PREFIX + d; }

// The expense categories carried over from the sheet's SUMMARY block, in its order.
const FIN_CATEGORIES = ["Wages","Pensions","Rent","Accounting","Software","Marketing",
  "Cleaning","Lease","Bills","Website","Retail","Other","Travel","Mentorship","Charges",
  // v208: "Directors loan" joins "Transfer" as the second category that counts nowhere.
  // The page appends both to whatever list is saved here, so an older saved list that
  // does not mention them still offers them.
  "Owners Pay","Tax","Transfer","Directors loan"];
const FIN_KEYMAPS = ["Essential","Optional","Can Cut"];

function defaultFinanceSettings() {
  return {
    // Profit First. The sheet ran Tax 15% / Investment 4% of Stripe+GoCardless income.
    potTaxPct: 15,
    potInvestPct: 4,
    // The sheet's cash traffic light was hardcoded: >= £2,000 net "Comfortable",
    // >= 0 "Tight", below 0 "Protect cash". The threshold is a judgement about this
    // business, not a fact, so it is a setting — the default is what the sheet used.
    cashBuffer: 2000,
    // Week runs Thursday → Wednesday. 4 = Thursday (0=Sun). The closing Thursday is
    // excluded on purpose in the sheet — its payments are still landing — so it rolls
    // into the next week. Kept as a setting rather than a constant so it can move.
    weekStartDow: 4,
    // Which descriptions count as which income source. Matched case-insensitively.
    sources: { stripe: "STRIPE", gocardless: "GC C1", sumup: "SUMUP", nutraprep: "NUTRAPREP" },
    // How a move between the user's OWN Santander accounts is recognised. Those rows
    // are categorised "Transfer" and left out of every total — they are the weekly pot
    // move, not spending, and counting them would double-count the same money.
    transferKeyword: "BODYSCULPT TRANSFORMATION CENTRES",
    // Only these sources are allocatable to pots (card takings, not loans or refunds).
    allocatable: ["stripe", "gocardless"],
    categories: FIN_CATEGORIES,
    lastUpdated: ""
  };
}

const FIN_CAP = 4000; // rows per month — far above a real month, but bounds a bad import

// v208: the only two categories a CREDIT may carry. Both mean "this is not income":
// money arriving from one of your own accounts, and borrowed money you owe back. Any
// other value on a credit is dropped, so an expense category can never land on one.
const FIN_IN_CATS = ["Transfer", "Directors loan"];
function finStr(v, n) { return typeof v === "string" ? v.slice(0, n) : ""; }
function finNum(v) { const x = Number(v); return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0; }
// Whitelist + coerce one transaction. `dir` is "in" or "out"; `amount` is always positive.
// `hash` is the client's dedupe key (date|desc|amount|dir) — kept so a re-import of an
// overlapping statement updates rows instead of duplicating them.
function cleanTxn(raw) {
  if (!raw || typeof raw !== "object") return null;
  const date = finStr(raw.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const dir = raw.dir === "in" ? "in" : "out";
  const amount = Math.abs(finNum(raw.amount));
  if (!amount) return null;
  return {
    // v208: was capped at 40. The id IS the dedupe hash (date|DESCRIPTION|amount|dir),
    // which is routinely longer than that, so every id came back truncated — and two
    // payments to the same merchant on the same day truncated to the SAME id, which made
    // editing one of them silently edit the other. 140 clears the 120-char hash plus its
    // "|#2" repeat suffix. Rows already stored keep whatever id they have; nothing is
    // rewritten, so no existing row moves.
    id: finStr(raw.id, 140) || (date + "-" + Math.random().toString(36).slice(2, 10)),
    date, dir, amount,
    desc: finStr(raw.desc, 300),
    // v208: `cat` used to be dropped on every credit — "cat: dir === 'out' ? ... : ''".
    // The page has always let you mark a credit as a Transfer, and the save appeared to
    // work, but the answer was thrown away here and the row came back as income the next
    // time the month was opened. That is why a move from the tax account kept counting as
    // money in. A credit's category is now kept, and it is one of exactly three things.
    cat: dir === "out" ? finStr(raw.cat, 40) : (FIN_IN_CATS.includes(raw.cat) ? raw.cat : ""),
    km: FIN_KEYMAPS.includes(raw.km) ? raw.km : "",
    src: finStr(raw.src, 24),
    note: finStr(raw.note, 500),
    hash: finStr(raw.hash, 120),
    // v208: a deleted row is KEPT, flagged rather than removed. Its hash is what stops the
    // next overlapping statement re-importing it, and keeping it is what makes the delete
    // undoable. The client hides it and leaves it out of every total.
    del: raw.del === true,
    importedAt: finStr(raw.importedAt, 30) || new Date().toISOString(),
  };
}
function cleanRule(raw) {
  if (!raw || typeof raw !== "object") return null;
  const match = finStr(raw.match, 80).trim().toUpperCase();
  if (match.length < 3) return null;
  return { match, cat: finStr(raw.cat, 40), km: FIN_KEYMAPS.includes(raw.km) ? raw.km : "" };
}
function validYmd(d) { return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d); }

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
    return Response.json({ months: await withBankIn(store, months) });
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

  // v236 Food hub: GET ?foodplan=<week> | ?foodinventory=1 | ?foodsettings=1 | ?foodtaste=1 | ?foodproducts=1 | ?foodrecipes=1
  if (req.method === "GET" && url.searchParams.get("foodrecipes") === "1") {
    return Response.json({ book: (await store.get(FOOD_RECIPES_KEY, { type: "json" })) || { recipes: [] } });
  }
  if (req.method === "GET" && url.searchParams.get("foodplan")) {
    const date = url.searchParams.get("foodplan");
    if (!validWeekDate(date)) return new Response("Bad week date (expected YYYY-MM-DD)", { status: 400 });
    return Response.json({ plan: (await store.get(foodPlanKeyOf(date), { type: "json" })) || null });
  }
  if (req.method === "GET" && url.searchParams.get("foodinventory") === "1") {
    return Response.json({ inventory: (await store.get(FOOD_INVENTORY_KEY, { type: "json" })) || foodDefaultInventory() });
  }
  if (req.method === "GET" && url.searchParams.get("foodsettings") === "1") {
    // rules "" means the default rules, which the food function serves (?defaults=1)
    const saved = (await store.get(FOOD_SETTINGS_KEY, { type: "json" })) || { kidsNotes: "", people: 4, rules: "" };
    return Response.json({ settings: { ...FOOD_PROTEIN_DEFAULTS, ...saved } });
  }
  if (req.method === "GET" && url.searchParams.get("foodtaste") === "1") {
    return Response.json({ taste: (await store.get(FOOD_TASTE_KEY, { type: "json" })) || { meals: {}, favourites: [], neverAgain: [], notes: [] } });
  }
  if (req.method === "GET" && url.searchParams.get("foodproducts") === "1") {
    return Response.json({ products: (await store.get(FOOD_PRODUCTS_KEY, { type: "json" })) || {} });
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

  // v135 Daily brief: GET ?dailybriefs=1 returns the whole date-keyed map (empty when none).
  // The Daily Dashboard picks today's, and falls back to the most recent one it finds.
  if (req.method === "GET" && url.searchParams.get("dailybriefs") === "1") {
    const briefs = (await store.get(DAILY_BRIEFS_KEY, { type: "json" })) || {};
    return Response.json({ briefs });
  }

  // v136 Front-end config: GET ?webconfig=1 returns the handful of PUBLIC values the pages
  // need that are set per-deployment rather than written into the HTML. A Google OAuth
  // client id is public by design — it identifies the app, it does not authorise anything,
  // and the consent screen plus the authorised-origins list are what actually guard it.
  // Keeping it here means Ash sets it once in Netlify, next to the Stripe and Instagram
  // values, instead of pasting it into a browser on every device he uses.
  // NOTHING SECRET GOES IN THIS ROUTE. Secrets belong in the functions that use them.
  if (req.method === "GET" && url.searchParams.get("webconfig") === "1") {
    return Response.json({
      googleClientId: process.env.GOOGLE_CLIENT_ID || "",
      // v161: WHETHER the google-auth function has its secret — a yes/no, so the card can
      // say "not set up yet" before anyone clicks. The secret itself stays out of here.
      googleConnectReady: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      timeZone: process.env.TIMEZONE || "Europe/London",
    });
  }

  // v149 Weekly agenda: GET ?weeklyagenda=YYYY-MM-DD returns the resolved grid for that
  // week, or null when the weekly plan has not been opened since it last changed.
  if (req.method === "GET" && url.searchParams.get("weeklyagenda")) {
    const d = url.searchParams.get("weeklyagenda");
    if (!validWeekDate(d)) return new Response("Bad week (expected YYYY-MM-DD)", { status: 400 });
    const agenda = (await store.get(agendaKeyOf(d), { type: "json" })) || null;
    return Response.json({ agenda });
  }

  // v136 Competitors: GET ?igcompetitors=1 returns the watch list (empty when none set).
  if (req.method === "GET" && url.searchParams.get("igcompetitors") === "1") {
    const competitors = (await store.get(IG_COMPETITORS_KEY, { type: "json" })) || [];
    return Response.json({ competitors: Array.isArray(competitors) ? competitors : [] });
  }

  // v84 Location defaults: GET ?locationdefaults=1 returns the default weekly pattern
  // ({ mon:"warrington", … }) — empty when never set, so every day starts unset.
  if (req.method === "GET" && url.searchParams.get("locationdefaults") === "1") {
    const locations = sanitiseLocationMap((await store.get(LOCATION_DEFAULTS_KEY, { type: "json" })) || {}, false);
    return Response.json({ locations });
  }

  // ---------- FINANCES ----------
  // GET ?fintxns=YYYY-MM  → { ym, rows } for that month (empty when never imported).
  if (req.method === "GET" && url.searchParams.get("fintxns")) {
    const ym = url.searchParams.get("fintxns");
    if (!validYm(ym)) return new Response("Bad month (expected YYYY-MM)", { status: 400 });
    const saved = (await store.get(finTxnKeyOf(ym), { type: "json" })) || null;
    return Response.json({ ym, rows: (saved && Array.isArray(saved.rows)) ? saved.rows : [],
      lastUpdated: (saved && saved.lastUpdated) || "" });
  }

  // GET ?finmonths=1 → { months:["2026-06",...] } — every month that has data, oldest
  // first. Listed from the blob keys, so nothing has to maintain a separate index.
  if (req.method === "GET" && url.searchParams.get("finmonths") === "1") {
    let months = [];
    try {
      const { blobs } = await store.list({ prefix: FIN_TXN_PREFIX });
      months = (blobs || []).map((b) => b.key.slice(FIN_TXN_PREFIX.length))
        .filter(validYm).sort();
    } catch { months = []; }
    return Response.json({ months });
  }

  // GET ?finsettings=1 → { settings } (pot %, income-source keywords, categories).
  if (req.method === "GET" && url.searchParams.get("finsettings") === "1") {
    const saved = (await store.get(FIN_SETTINGS_KEY, { type: "json" })) || null;
    return Response.json({ settings: { ...defaultFinanceSettings(), ...(saved || {}) } });
  }

  // GET ?finrules=1 → { rules } — the learned description→category rules.
  if (req.method === "GET" && url.searchParams.get("finrules") === "1") {
    const rules = (await store.get(FIN_RULES_KEY, { type: "json" })) || [];
    return Response.json({ rules: Array.isArray(rules) ? rules : [] });
  }

  // GET ?finnotes=1 → { notes } — the standing brief that travels with every AI prompt.
  if (req.method === "GET" && url.searchParams.get("finnotes") === "1") {
    const saved = (await store.get(FIN_NOTES_KEY, { type: "json" })) || null;
    const facts = saved && Array.isArray(saved.facts) ? saved.facts : [];
    const previous = saved && Array.isArray(saved.previous) ? saved.previous : [];
    return Response.json({ notes: { facts, previous, lastUpdated: (saved && saved.lastUpdated) || null } });
  }

  // GET ?finweek=YYYY-MM-DD → { week } — one Thu→Wed pot move (empty default when new).
  if (req.method === "GET" && url.searchParams.get("finweek")) {
    const d = url.searchParams.get("finweek");
    if (!validYmd(d)) return new Response("Bad week start (expected YYYY-MM-DD)", { status: 400 });
    const saved = (await store.get(finWeekKeyOf(d), { type: "json" })) || null;
    return Response.json({ week: saved || { weekStart: d, moved: false, tax: 0, invest: 0, note: "", checklist: {}, lastUpdated: "" } });
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

    // ---------- FINANCES ----------
    // Save one month of transactions. Body { finTxns: { ym, rows:[...] } }.
    // Rows REPLACE the month wholesale — the client always holds the full month and
    // merges imports locally, so a partial write can never half-erase a month.
    if (body.finTxns && body.finTxns.ym) {
      const ym = body.finTxns.ym;
      if (!validYm(ym)) return new Response("Bad month (expected YYYY-MM)", { status: 400 });
      const rows = (Array.isArray(body.finTxns.rows) ? body.finTxns.rows : [])
        .map(cleanTxn).filter(Boolean).slice(0, FIN_CAP)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const rec = { ym, rows, lastUpdated: new Date().toISOString() };
      await store.set(finTxnKeyOf(ym), JSON.stringify(rec));
      return Response.json({ ok: true, ym, count: rows.length, lastUpdated: rec.lastUpdated });
    }

    // Save finance settings (merged over the defaults, so a partial save is safe).
    if (body.finSettings && typeof body.finSettings === "object") {
      const prev = (await store.get(FIN_SETTINGS_KEY, { type: "json" })) || {};
      const next = { ...defaultFinanceSettings(), ...prev, ...body.finSettings,
        lastUpdated: new Date().toISOString() };
      next.potTaxPct = Math.max(0, Math.min(100, finNum(next.potTaxPct)));
      next.potInvestPct = Math.max(0, Math.min(100, finNum(next.potInvestPct)));
      next.cashBuffer = Math.max(0, finNum(next.cashBuffer));
      await store.set(FIN_SETTINGS_KEY, JSON.stringify(next));
      return Response.json({ ok: true, settings: next });
    }

    // Save the learned rules table wholesale. Body { finRules: [{match,cat,km}] }.
    if (Array.isArray(body.finRules)) {
      const rules = body.finRules.map(cleanRule).filter(Boolean).slice(0, 1000);
      await store.set(FIN_RULES_KEY, JSON.stringify(rules));
      return Response.json({ ok: true, count: rules.length, rules });
    }

    // Save the standing brief. Body { finNotes: { facts: ["…", "…"] } }. Whole-list write:
    // the client owns the order and the wording, and a fact is only ever a sentence.
    if (body.finNotes && Array.isArray(body.finNotes.facts)) {
      const facts = body.finNotes.facts
        .map((f) => finStr(typeof f === "string" ? f.trim() : "", 500))
        .filter(Boolean)
        .slice(0, 300);
      // v133: a consolidation REPLACES the list, so the version before it is kept. One step
      // back is enough — this is a brief, not a document — but losing the lot to a bad tidy
      // would be the kind of data loss that stops the loop being used at all.
      const prev = (await store.get(FIN_NOTES_KEY, { type: "json" })) || {};
      const notes = { facts, previous: Array.isArray(prev.facts) ? prev.facts : [],
        lastUpdated: new Date().toISOString() };
      await store.set(FIN_NOTES_KEY, JSON.stringify(notes));
      return Response.json({ ok: true, notes });
    }

    // Save one week's pot move. Body { finWeek: { weekStart, moved, tax, invest, note, checklist } }.
    if (body.finWeek && body.finWeek.weekStart) {
      const d = body.finWeek.weekStart;
      if (!validYmd(d)) return new Response("Bad week start", { status: 400 });
      const prev = (await store.get(finWeekKeyOf(d), { type: "json" })) || {};
      const cl = {};
      const rawCl = body.finWeek.checklist;
      if (rawCl && typeof rawCl === "object" && !Array.isArray(rawCl)) {
        for (const k of Object.keys(rawCl).slice(0, 40)) {
          if (typeof rawCl[k] === "boolean") cl[finStr(k, 40)] = rawCl[k];
        }
      }
      const week = { ...prev, weekStart: d,
        moved: !!body.finWeek.moved,
        tax: finNum(body.finWeek.tax), invest: finNum(body.finWeek.invest),
        note: finStr(body.finWeek.note, 2000),
        checklist: { ...(prev.checklist || {}), ...cl },
        lastUpdated: new Date().toISOString() };
      await store.set(finWeekKeyOf(d), JSON.stringify(week));
      return Response.json({ ok: true, week });
    }

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
      // v82: whitelist the per-week exception overlay. v228: one entry per OCCURRENCE —
      //   "<recurring|training>:<id>" -> [ { type:"skip", from } | { type:"move", from, to }, … ]
      // where from/to are "<slot>:<day>" grid cells and `from` is required (it is what makes an
      // entry one occurrence). A pre-v228 single object is accepted as a one-element list, and
      // a later entry for the same `from` replaces the earlier. Same discipline as
      // reviewChecklist: shape-checked, size-capped, unknown fields dropped, anything malformed
      // skipped. This field is per-week only; it is never copied between weeks.
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
            const list = Array.isArray(raw[k]) ? raw[k] : [raw[k]];
            const byFrom = new Map();
            for (const v of list.slice(0, 40)) {
              if (!v || typeof v !== "object" || Array.isArray(v)) continue;
              const from = cell(v.from);
              if (!from) continue;               // an entry is one occurrence, or nothing
              if (v.type === "skip") byFrom.set(from, { type: "skip", from });
              else if (v.type === "move") {
                const to = cell(v.to);
                if (to) byFrom.set(from, { type: "move", from, to });   // a move with nowhere to go is dropped
              }
            }
            if (byFrom.size) clean[k] = [...byFrom.values()];
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
          // v117: the task's own notes — one string, the same rich-notes field the monthly
          // focus item carries, capped the same way. The client sanitises on both save and
          // render; this only bounds the length so a runaway paste can't bloat the blob.
          if (typeof t.notes === "string" && t.notes) d.notes = t.notes.slice(0, 20000);
          // v113: the optional monthly/quarterly cadence. Same discipline as days/time — the
          // cadence and a rule that fully validates are whitelisted together or not at all,
          // field by field, so a malformed rule can never be stored half-applied. A cadence
          // task has no day-set, so `days` is dropped when one lands.
          const cadence = cleanRecurringCadence(t);
          if (cadence) {
            d.cadence = cadence.cadence;
            d[cadence.cadence === "monthly" ? "monthlyRule" : "quarterlyRule"] = cadence.rule;
            delete d.days;
          }
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

    // v236 Food hub writes. Only what Ash types, ticks and taps — never the meals or the list.
    // POST { foodPlan: { weekEnding, schedule?, situation?, people?, ticks?:{key:bool}, addBuy?:{name, qty}, removeBuy?:key } }
    if (body.foodPlan && typeof body.foodPlan === "object") {
      const f = body.foodPlan, week = f.weekEnding;
      if (!validWeekDate(week)) return new Response("Bad foodPlan.weekEnding", { status: 400 });
      const key = foodPlanKeyOf(week);
      const plan = (await store.get(key, { type: "json" })) || emptyFoodPlan(week);
      if (f.schedule && typeof f.schedule === "object") {
        plan.schedule = {};
        for (const d of FOOD_DAYS) plan.schedule[d] = FOOD_NIGHT_TYPES.includes(f.schedule[d]) ? f.schedule[d] : "family";
      }
      if ("situation" in f) plan.situation = foodStr(f.situation, 2000);
      if ("people" in f) { const n = Math.round(Number(f.people)); if (n >= 1 && n <= 12) plan.people = n; }
      if (f.ticks && typeof f.ticks === "object" && !Array.isArray(f.ticks)) {
        for (const item of plan.toBuy || []) if (item && item.key in f.ticks) item.ticked = f.ticks[item.key] === true;
      }
      if (f.addBuy && typeof f.addBuy === "object" && foodKey(f.addBuy.name)) {
        const k = foodKey(f.addBuy.name);
        plan.toBuy = plan.toBuy || [];
        if (!plan.toBuy.some((b) => b.key === k)) {
          plan.toBuy.push({ id: foodId("b_"), key: k, name: foodStr(f.addBuy.name, 80).trim(), qty: foodStr(f.addBuy.qty, 40).trim(),
            aisle: "Added by hand", nights: [], leftover: "", estPrice: 0, ticked: false, manual: true,
            productName: "", packSize: "", productUrl: "", lastPrice: 0, confirmed: false });
        }
      }
      if (typeof f.removeBuy === "string") plan.toBuy = (plan.toBuy || []).filter((b) => !(b.manual && b.key === f.removeBuy));
      await store.set(key, JSON.stringify(plan));
      return Response.json({ ok: true, plan });
    }
    // POST { foodSettings: { kidsNotes, people, rules, proteinMin, proteinMax, servings } } — once, for every
    // week. rules "" = the defaults. Protein: grams per ADULT serving; servings = adult equivalents.
    if (body.foodSettings && typeof body.foodSettings === "object") {
      const f = body.foodSettings;
      const people = Math.round(Number(f.people));
      const n = (v, lo, hi, d) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? Math.round(x * 10) / 10 : d; };
      const proteinMin = n(f.proteinMin, 0, 200, FOOD_PROTEIN_DEFAULTS.proteinMin);
      const clean = { kidsNotes: foodStr(f.kidsNotes, 2000), people: people >= 1 && people <= 12 ? people : 4, rules: foodStr(f.rules, 6000),
        proteinMin, proteinMax: Math.max(proteinMin, n(f.proteinMax, 0, 300, FOOD_PROTEIN_DEFAULTS.proteinMax)),
        servings: n(f.servings, 0.5, 20, FOOD_PROTEIN_DEFAULTS.servings) };
      await store.set(FOOD_SETTINGS_KEY, JSON.stringify(clean));
      return Response.json({ ok: true, settings: clean });
    }
    // POST { foodProduct: { name, productName, packSize, productUrl, lastPrice, confirmed } } — a Tesco product,
    // remembered by ingredient. No name and not confirmed = forgotten.
    if (body.foodProduct && typeof body.foodProduct === "object") {
      const f = body.foodProduct, k = foodKey(f.name);
      if (!k) return new Response("Bad foodProduct.name", { status: 400 });
      const products = (await store.get(FOOD_PRODUCTS_KEY, { type: "json" })) || {};
      const entry = {
        productName: foodStr(f.productName, 160).trim(), packSize: foodStr(f.packSize, 40).trim(),
        productUrl: /^https?:\/\//i.test(f.productUrl || "") ? foodStr(f.productUrl, 500) : "",
        lastPrice: Number.isFinite(Number(f.lastPrice)) && Number(f.lastPrice) > 0 ? Math.round(Number(f.lastPrice) * 100) / 100 : 0,
        confirmed: f.confirmed === true, updatedAt: new Date().toISOString(),
      };
      if (!entry.productName && !entry.productUrl && !entry.confirmed) delete products[k]; else products[k] = entry;
      await store.set(FOOD_PRODUCTS_KEY, JSON.stringify(products));
      return Response.json({ ok: true, key: k, products });
    }
    // POST { foodInventory: { op: "add", items:[…] } | { op: "update", id, fields } | { op: "remove" | "usedUp", id } }
    if (body.foodInventory && typeof body.foodInventory === "object") {
      const f = body.foodInventory;
      const inv = (await store.get(FOOD_INVENTORY_KEY, { type: "json" })) || foodDefaultInventory();
      inv.items = Array.isArray(inv.items) ? inv.items : [];
      if (f.op === "add" && Array.isArray(f.items)) {
        // a few cupboard photos can find a lot at once
        for (const raw of f.items.slice(0, 150)) {
          if (!raw || typeof raw !== "object") continue;
          const it = foodCleanItem(raw, null);
          if (it.name && inv.items.length < 400) inv.items.push(it);
        }
      } else if (f.op === "update" && typeof f.id === "string" && f.fields && typeof f.fields === "object") {
        const i = inv.items.findIndex((x) => x.id === f.id);
        if (i < 0) return Response.json({ ok: false, error: "No such item." }, { status: 404 });
        inv.items[i] = foodCleanItem(f.fields, inv.items[i]);
      } else if ((f.op === "remove" || f.op === "usedUp") && typeof f.id === "string") {
        inv.items = inv.items.filter((x) => x.id !== f.id);
      } else return new Response("Bad foodInventory op", { status: 400 });
      await store.set(FOOD_INVENTORY_KEY, JSON.stringify(inv));
      return Response.json({ ok: true, inventory: inv });
    }
    // POST { foodCooked: { weekEnding, mealId } } — deduct what the meal used from the inventory,
    // and put what is left of any pack it opened into the fridge with today's date. Once only.
    // POST { foodSkipped: { weekEnding, mealId } } — nothing deducted.
    if ((body.foodCooked || body.foodSkipped) && typeof (body.foodCooked || body.foodSkipped) === "object") {
      const f = body.foodCooked || body.foodSkipped, cooked = !!body.foodCooked, week = f.weekEnding;
      if (!validWeekDate(week)) return new Response("Bad weekEnding", { status: 400 });
      const plan = await store.get(foodPlanKeyOf(week), { type: "json" });
      const meal = plan && (plan.meals || []).find((m) => m && m.id === f.mealId);
      if (!meal) return Response.json({ ok: false, error: "That meal is not in this week's menu." }, { status: 404 });
      if (meal.status === "cooked") return Response.json({ ok: true, already: true, plan });
      const inv = (await store.get(FOOD_INVENTORY_KEY, { type: "json" })) || foodDefaultInventory();
      if (cooked) {
        const today = foodToday();
        for (const c of meal.consumes || []) {
          const it = inv.items.find((x) => x.id === c.inventoryId);
          if (!it) continue;
          // spices and staples are not counted down — they are always there
          if (it.category === "spices" || it.category === "staples") continue;
          it.qty = Math.round((Number(it.qty) - Number(c.qty || 0)) * 100) / 100;
        }
        inv.items = inv.items.filter((x) => x.category === "spices" || x.category === "staples" || Number(x.qty) > 0);
        for (const l of meal.leftovers || []) {
          inv.items.push(foodCleanItem({ name: l.name, qty: l.qty, unit: l.unit, category: l.category || "fresh",
            storage: l.storage || "fridge", added: today, opened: today }, null));
        }
        meal.status = "cooked";
        meal.cookedAt = new Date().toISOString();
        await store.set(FOOD_INVENTORY_KEY, JSON.stringify(inv));
      } else {
        meal.status = "skipped";
      }
      await store.set(foodPlanKeyOf(week), JSON.stringify(plan));
      return Response.json({ ok: true, plan, inventory: inv });
    }
    // POST { foodRating: { weekEnding, mealId, polly?, artie?, adults?, note? } } — saved on the
    // meal, and folded into the taste profile. "" clears a rating.
    if (body.foodRating && typeof body.foodRating === "object") {
      const f = body.foodRating, week = f.weekEnding;
      if (!validWeekDate(week)) return new Response("Bad foodRating.weekEnding", { status: 400 });
      const plan = await store.get(foodPlanKeyOf(week), { type: "json" });
      const meal = plan && (plan.meals || []).find((m) => m && m.id === f.mealId);
      if (!meal) return Response.json({ ok: false, error: "That meal is not in this week's menu." }, { status: 404 });
      const r = { ...(meal.ratings || {}) };
      for (const k of FOOD_RATERS) if (k in f) r[k] = FOOD_RATING_VALUES.includes(f[k]) ? f[k] : "";
      if ("note" in f) r.note = foodStr(f.note, 140).trim();
      r.ratedAt = new Date().toISOString();
      meal.ratings = r;
      await store.set(foodPlanKeyOf(week), JSON.stringify(plan));
      const taste = (await store.get(FOOD_TASTE_KEY, { type: "json" })) || { meals: {} };
      taste.meals = taste.meals || {};
      const key = foodKey(meal.name);
      const entry = taste.meals[key] || { name: meal.name, ratings: [] };
      entry.name = meal.name;
      entry.ratings = (entry.ratings || []).filter((x) => !(x.week === week && x.mealId === meal.id));
      if (FOOD_RATERS.some((k) => r[k]) || r.note) {
        entry.ratings.push({ week, mealId: meal.id, polly: r.polly || "", artie: r.artie || "", adults: r.adults || "", note: r.note || "" });
      }
      if (entry.ratings.length) taste.meals[key] = entry; else delete taste.meals[key];
      const keys = Object.keys(taste.meals);
      if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete taste.meals[k];
      await store.set(FOOD_TASTE_KEY, JSON.stringify(foodTasteDerive(taste)));
      // both kids thumbs up → into the recipe book (or a book recipe's ratings brought up to date)
      const inBook = ((await store.get(FOOD_RECIPES_KEY, { type: "json" })) || { recipes: [] }).recipes || [];
      const book = (r.polly === "up" && r.artie === "up") || meal.keep || inBook.some((x) => x.id === meal.recipeId || x.key === foodKey(meal.name))
        ? await foodBookUpdate(store, meal, plan, week) : null;
      return Response.json({ ok: true, ratings: r, taste, book });
    }
    // POST { foodKeep: { weekEnding, mealId, keep } } — Ash's ⭐ Keep: into the recipe book whatever the
    // kids said; un-starred, it leaves the book unless both kids loved it.
    if (body.foodKeep && typeof body.foodKeep === "object") {
      const f = body.foodKeep, week = f.weekEnding;
      if (!validWeekDate(week)) return new Response("Bad foodKeep.weekEnding", { status: 400 });
      const plan = await store.get(foodPlanKeyOf(week), { type: "json" });
      const meal = plan && (plan.meals || []).find((m) => m && m.id === f.mealId);
      if (!meal) return Response.json({ ok: false, error: "That meal is not in this week's menu." }, { status: 404 });
      meal.keep = f.keep === true;
      await store.set(foodPlanKeyOf(week), JSON.stringify(plan));
      const book = await foodBookUpdate(store, meal, plan, week);
      return Response.json({ ok: true, plan, book });
    }
    // POST { foodRecipeRemove: { id } } — take a recipe out of the book
    if (body.foodRecipeRemove && typeof body.foodRecipeRemove === "object") {
      const book = (await store.get(FOOD_RECIPES_KEY, { type: "json" })) || { recipes: [] };
      book.recipes = (book.recipes || []).filter((x) => x.id !== body.foodRecipeRemove.id);
      await store.set(FOOD_RECIPES_KEY, JSON.stringify(book));
      return Response.json({ ok: true, book });
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

    // v135 Daily brief: POST { dailyBrief: { date, summary, items:[...] } }. The scheduled
    // email triage calls this once it has finished labelling. One date is replaced whole —
    // the job always sends the complete morning, so a partial write cannot half-erase a day
    // — and the map is then pruned to the newest BRIEF_DAYS_KEPT dates so one blob cannot
    // grow without limit. It touches NOTHING but its own key.
    if (body.dailyBrief && typeof body.dailyBrief === "object") {
      const brief = cleanBrief(body.dailyBrief);
      if (!brief) return new Response("Bad dailyBrief (need a YYYY-MM-DD date)", { status: 400 });
      const map = (await store.get(DAILY_BRIEFS_KEY, { type: "json" })) || {};
      map[brief.date] = brief;
      const keep = Object.keys(map).sort().slice(-BRIEF_DAYS_KEPT);
      const pruned = {};
      for (const d of keep) pruned[d] = map[d];
      await store.set(DAILY_BRIEFS_KEY, JSON.stringify(pruned));
      return Response.json({ ok: true, date: brief.date, counts: brief.counts, drafted: brief.drafted, kept: keep.length });
    }

    // v149 Weekly agenda: POST { weeklyAgenda: { weekEnding, cells } }. Replaces that week's
    // cache wholesale — the weekly page always holds the whole grid, so a partial write
    // cannot half-describe a week. Touches nothing but its own key, and nothing that reads
    // it treats it as a source of truth.
    if (body.weeklyAgenda && typeof body.weeklyAgenda === "object") {
      const agenda = cleanAgenda(body.weeklyAgenda);
      if (!agenda) return new Response("Bad weeklyAgenda (need a YYYY-MM-DD weekEnding)", { status: 400 });
      await store.set(agendaKeyOf(agenda.weekEnding), JSON.stringify(agenda));
      return Response.json({ ok: true, weekEnding: agenda.weekEnding, cells: Object.keys(agenda.cells).length });
    }

    // v150 Ticking a task off from the Daily Dashboard.
    // POST { weeklyTick: { weekEnding, tgt, done } }
    //
    // This is the ONE thing the daily page can write to a weekly plan, and it is deliberately
    // the narrowest write in the codebase: it flips a single boolean at an address the weekly
    // page worked out. It reads the plan, changes that one field, and writes it back — it
    // never replaces a plan, never creates one, and refuses outright if there is no plan
    // there, because a tick is not a reason to bring a week into existence.
    if (body.weeklyTick && typeof body.weeklyTick === "object") {
      const t = body.weeklyTick;
      const weekEnding = typeof t.weekEnding === "string" ? t.weekEnding : "";
      if (!validWeekDate(weekEnding)) return new Response("Bad weekEnding", { status: 400 });
      const tgt = cleanTickTarget(t.tgt);
      if (!tgt) return new Response("Bad tick target", { status: 400 });
      const done = t.done === true;

      const key = weeklyPlanKeyOf(weekEnding);
      const plan = await store.get(key, { type: "json" });
      if (!plan) return Response.json({ ok: false, error: "No plan for that week yet." }, { status: 404 });

      if (tgt.m) {
        plan[tgt.m] = plan[tgt.m] || {};
        plan[tgt.m][tgt.k] = done;
      } else {
        const list = Array.isArray(plan[tgt.l]) ? plan[tgt.l] : null;
        const item = list && list.find((x) => x && x.id === tgt.k);
        if (!item) return Response.json({ ok: false, error: "That task is not in the plan any more." }, { status: 404 });
        item.done = done;
      }
      plan.lastUpdated = new Date().toISOString();
      await store.set(key, JSON.stringify(plan));

      // Keep the display cache honest in the same breath, or the daily page shows the old
      // state until the weekly page is next opened.
      try {
        const ag = await store.get(agendaKeyOf(weekEnding), { type: "json" });
        if (ag && ag.cells) {
          let touched = false;
          for (const cell of Object.values(ag.cells)) {
            for (const row of cell) {
              if (!row.tgt) continue;
              if (row.tgt.k !== tgt.k) continue;
              if ((row.tgt.m || "") !== (tgt.m || "") || (row.tgt.l || "") !== (tgt.l || "")) continue;
              row.done = done; touched = true;
            }
          }
          if (touched) await store.set(agendaKeyOf(weekEnding), JSON.stringify(ag));
        }
      } catch { /* the cache is disposable; the plan is what matters and it is already saved */ }

      return Response.json({ ok: true, weekEnding, done });
    }

    // v251 Taking one job off TODAY from the Daily Dashboard — "not today", or "move it to
    // another day this week". POST { weeklyCancel: { weekEnding, tgt, cell, to? } }
    //
    // Ash: "cancel the jobs here … remove it from the weekly calendar too but NOT the
    // recurring task list. This should just be if I don't manage to get it done that day."
    //
    // So it is ONE OCCURRENCE in ONE WEEK, and it uses the weekly page's own v82/v228
    // machinery rather than inventing a second one:
    //   • a recurring/training job gets an exception entry — { type:"skip", from } or
    //     { type:"move", from, to } — the same entry the planner's ✕ → "Skip this week" and
    //     drag-to-move write. The schedule itself, the recurring list, is never touched, and an
    //     exception never leaves its week, so next week it is back where it always is.
    //   • a one-off planner task (projectItems/bufferItems) is hand-placed, so its placement in
    //     that cell is taken out (or moved). The task itself stays in the week's list.
    //   • a project step is not in the plan at all — the page changes the step through the
    //     projects store, and this route only straightens the display cache.
    // `from` for an exception is the SCHEDULE cell, so a job already moved to today is traced
    // back to where it came from: one entry per occurrence, never two.
    //
    // v252 ("later" says exactly when): `to` may be another TIME the same day, and a project
    // step may go to another week — { toWeek, title }. The step itself is moved by the page
    // through the projects store; here its calendar copy leaves this week and lands in that one.
    if (body.weeklyCancel && typeof body.weeklyCancel === "object") {
      const c = body.weeklyCancel;
      const weekEnding = typeof c.weekEnding === "string" ? c.weekEnding : "";
      if (!validWeekDate(weekEnding)) return new Response("Bad weekEnding", { status: 400 });
      const cellOk = (s) => typeof s === "string" && /^[a-z0-9-]{1,12}:(mon|tue|wed|thu|fri|sat|sun)$/.test(s);
      const tgt = cleanTickTarget(c.tgt) || cleanStepTarget(c.tgt);
      if (!tgt) return new Response("Bad target", { status: 400 });
      // v252: a project step may have no row today (dated today, or late, and never planned),
      // and may move to ANOTHER week (`toWeek`) — its plan lives on the step, so only the
      // display copies move here. A plan job still needs its cell and stays inside its week.
      const toWeek = tgt.p && validWeekDate(c.toWeek) && c.toWeek !== weekEnding ? c.toWeek : "";
      const cell = cellOk(c.cell) ? c.cell : "";
      if (!cell && !(tgt.p && c.cell === "")) return new Response("Bad cell", { status: 400 });
      const to = c.to == null || c.to === "" ? "" : (cellOk(c.to) ? c.to : null);
      if (to === null || (to === cell && !toWeek) || (!cell && !to)) return new Response("Bad destination", { status: 400 });
      const stepTitle = typeof c.title === "string" ? c.title.slice(0, 200).trim() : "";

      if (!tgt.p) {
        const key = weeklyPlanKeyOf(weekEnding);
        const plan = await store.get(key, { type: "json" });
        if (!plan) return Response.json({ ok: false, error: "No plan for that week yet." }, { status: 404 });
        if (tgt.m) {
          const ref = (tgt.m === "trainingDone" ? "training" : "recurring") + ":" + tgt.k.split(":")[0];
          const ex = (plan.exceptions && typeof plan.exceptions === "object" && !Array.isArray(plan.exceptions)) ? plan.exceptions : {};
          const list = (Array.isArray(ex[ref]) ? ex[ref] : ex[ref] ? [ex[ref]] : []).filter((e) => e && typeof e === "object");
          const movedHere = list.find((e) => e.type === "move" && e.to === cell);
          const from = movedHere ? movedHere.from : cell;
          const rest = list.filter((e) => e.from !== from);
          if (!to) rest.push({ type: "skip", from });
          else if (to !== from) rest.push({ type: "move", from, to });   // moved back home = no entry
          if (rest.length) ex[ref] = rest; else delete ex[ref];
          plan.exceptions = ex;
        } else {
          const ref = (tgt.l === "bufferItems" ? "buffer" : "project") + ":" + tgt.k;
          const pl = (plan.placements && typeof plan.placements === "object") ? plan.placements : {};
          if (!(pl[cell] || []).includes(ref)) return Response.json({ ok: false, error: "That job is not on that day any more." }, { status: 404 });
          pl[cell] = pl[cell].filter((r) => r !== ref);
          if (!pl[cell].length) delete pl[cell];
          if (to) { pl[to] = pl[to] || []; if (!pl[to].includes(ref)) pl[to].push(ref); }
          plan.placements = pl;
        }
        plan.lastUpdated = new Date().toISOString();
        await store.set(key, JSON.stringify(plan));
      }

      // The display cache, in the same breath — the row leaves today and (on a move) lands on
      // its new day. A multi-day job's tick is keyed by day, so it takes its new day's key.
      let agenda = null;
      const same = (t) => t && (tgt.p ? t.p === tgt.p && t.s === tgt.s
        : t.k === tgt.k && (t.m || "") === (tgt.m || "") && (t.l || "") === (tgt.l || ""));
      if (tgt.p) {
        // v252: a step sits in ONE place, so its rows come out of every cell of this week, and
        // it lands once — here, or in the week it went to. A week whose copy does not exist yet
        // is left alone: a copy holding one job would claim the week holds one job, and the
        // weekly page writes the whole thing (step included) the first time that week opens.
        const lift = (ag) => {
          let row = null;
          Object.keys(ag.cells).forEach((k) => {
            const keep = ag.cells[k].filter((r) => { if (same(r.tgt)) { row = row || r; return false; } return true; });
            if (keep.length) ag.cells[k] = keep; else delete ag.cells[k];
          });
          return row;
        };
        const fresh = () => ({ title: stepTitle || "Project step", kind: "project", done: false, tgt: { p: tgt.p, s: tgt.s } });
        let row = null;
        try {
          const ag = await store.get(agendaKeyOf(weekEnding), { type: "json" });
          if (ag && ag.cells) {
            row = lift(ag);
            if (to && !toWeek) ag.cells[to] = (ag.cells[to] || []).concat([row || fresh()]);
            await store.set(agendaKeyOf(weekEnding), JSON.stringify(ag));
            agenda = ag;
          }
        } catch { /* the cache is disposable; opening the weekly page rewrites it */ }
        if (toWeek && to) {
          try {
            const ag2 = await store.get(agendaKeyOf(toWeek), { type: "json" });
            if (ag2 && ag2.cells) {
              const was = lift(ag2);
              ag2.cells[to] = (ag2.cells[to] || []).concat([was || row || fresh()]);
              await store.set(agendaKeyOf(toWeek), JSON.stringify(ag2));
            }
          } catch { /* as above */ }
        }
        return Response.json({ ok: true, weekEnding, agenda });
      }
      try {
        const ag = await store.get(agendaKeyOf(weekEnding), { type: "json" });
        if (ag && ag.cells) {
          const rows = ag.cells[cell] || [];
          const i = rows.findIndex((r) => same(r.tgt));
          if (i >= 0) {
            const [row] = rows.splice(i, 1);
            if (!rows.length) delete ag.cells[cell];
            if (to) {
              const toDay = to.split(":")[1];
              const moved = { ...row, tgt: { ...row.tgt } };
              if (moved.tgt.k && moved.tgt.k.includes(":")) moved.tgt.k = moved.tgt.k.split(":")[0] + ":" + toDay;
              ag.cells[to] = (ag.cells[to] || []).concat([moved]);
            }
            await store.set(agendaKeyOf(weekEnding), JSON.stringify(ag));
          }
          agenda = ag;
        }
      } catch { /* the cache is disposable; opening the weekly page rewrites it */ }

      return Response.json({ ok: true, weekEnding, agenda });
    }

    // v253 Deleting a job from the Daily Dashboard — EVERYWHERE, with the way back.
    // POST { weeklyDelete: { weekEnding, tgt } }  → { ok, token, agenda }
    // POST { weeklyDelete: { weekEnding, undo: token } } → puts back exactly what that took
    //
    // Ash: "I need to be able to delete tasks and have the option of deleting it from
    // everywhere, too." ("Just today" is v251's skip; this is the other answer.) Everywhere is:
    //   • a recurring/training job: off its LIST for good — the planner's own "Remove from
    //     all" — and its hand-placed slots and this week's skip/move entries with it;
    //   • a one-off planner task: out of this week's list and every slot it sat in (v220's ✕);
    //   • a project step: the page flags it deleted through the projects store (a step is
    //     never truly removed — del:true); here only the calendar copies are cleaned.
    // And the calendar copies (weekly-agenda-*) of this week and every later week lose its
    // rows — a deleted recurring job must not ride on next week's strip either.
    //
    // NOTHING IS LOST: everything taken is written to LAST_DELETE_KEY first, with a token,
    // and undo puts back only what is missing — never a second copy, never over an edit.
    if (body.weeklyDelete && typeof body.weeklyDelete === "object") {
      const c = body.weeklyDelete;
      const weekEnding = typeof c.weekEnding === "string" ? c.weekEnding : "";
      if (!validWeekDate(weekEnding)) return new Response("Bad weekEnding", { status: 400 });
      const agendaKeysFrom = async (from) => {
        const { blobs } = await store.list({ prefix: "weekly-agenda-" });
        return blobs.map((b) => b.key).filter((k) => validWeekDate(k.slice(14)) && k.slice(14) >= from);
      };

      if (typeof c.undo === "string") {
        const stash = await store.get(LAST_DELETE_KEY, { type: "json" });
        if (!stash || stash.token !== c.undo) return Response.json({ ok: false, error: "That can no longer be undone." }, { status: 404 });
        if (stash.list) {
          const key = stash.list === "training" ? TRAINING_DEFAULTS_KEY : RECURRING_DEFAULTS_KEY;
          const list = (await store.get(key, { type: "json" })) || [];
          if (!list.some((t) => t && t.id === stash.item.id)) list.splice(Math.min(stash.index, list.length), 0, stash.item);
          await store.set(key, JSON.stringify(list));
        }
        if (stash.plan) {
          const pkey = weeklyPlanKeyOf(stash.weekEnding);
          const plan = await store.get(pkey, { type: "json" });
          if (plan) {
            if (stash.plan.field) {
              const arr = Array.isArray(plan[stash.plan.field]) ? plan[stash.plan.field] : [];
              if (!arr.some((x) => x && x.id === stash.plan.item.id)) arr.splice(Math.min(stash.plan.index, arr.length), 0, stash.plan.item);
              plan[stash.plan.field] = arr;
            }
            const pl = (plan.placements && typeof plan.placements === "object") ? plan.placements : {};
            Object.entries(stash.plan.cells || {}).forEach(([k, refs]) => {
              pl[k] = pl[k] || [];
              refs.forEach((r) => { if (!pl[k].includes(r)) pl[k].push(r); });
            });
            plan.placements = pl;
            if (stash.plan.exception) {
              plan.exceptions = (plan.exceptions && typeof plan.exceptions === "object" && !Array.isArray(plan.exceptions)) ? plan.exceptions : {};
              if (!plan.exceptions[stash.plan.ref]) plan.exceptions[stash.plan.ref] = stash.plan.exception;
            }
            plan.lastUpdated = new Date().toISOString();
            await store.set(pkey, JSON.stringify(plan));
          }
        }
        let agenda = null;
        for (const [akey, cells] of Object.entries(stash.agendas || {})) {
          try {
            const ag = await store.get(akey, { type: "json" });
            if (!ag || !ag.cells) continue;
            Object.entries(cells).forEach(([k, rows]) => { ag.cells[k] = (ag.cells[k] || []).concat(rows); });
            await store.set(akey, JSON.stringify(ag));
            if (akey === agendaKeyOf(stash.weekEnding)) agenda = ag;
          } catch { /* a cache; the weekly page rewrites it */ }
        }
        await store.delete(LAST_DELETE_KEY);
        return Response.json({ ok: true, weekEnding: stash.weekEnding, agenda });
      }

      const tgt = cleanTickTarget(c.tgt) || cleanStepTarget(c.tgt);
      if (!tgt) return new Response("Bad target", { status: 400 });
      const stash = { token: crypto.randomUUID(), at: new Date().toISOString(), weekEnding, agendas: {} };
      const id = tgt.k ? tgt.k.split(":")[0] : "";
      let ref = "";

      if (tgt.m) {
        stash.list = tgt.m === "trainingDone" ? "training" : "recurring";
        const key = stash.list === "training" ? TRAINING_DEFAULTS_KEY : RECURRING_DEFAULTS_KEY;
        const list = await store.get(key, { type: "json" });
        const i = Array.isArray(list) ? list.findIndex((t) => t && t.id === id) : -1;
        if (i < 0) return Response.json({ ok: false, error: "That job is not on your list any more." }, { status: 404 });
        stash.item = list[i]; stash.index = i;
        ref = stash.list + ":" + id;
      } else if (tgt.l) {
        ref = (tgt.l === "bufferItems" ? "buffer" : "project") + ":" + tgt.k;
      }

      // this week's plan: the one-off item, and every slot / skip-or-move entry for the ref
      let planOut = null;
      if (ref) {
        const pkey = weeklyPlanKeyOf(weekEnding);
        const plan = await store.get(pkey, { type: "json" });
        if (!plan && tgt.l) return Response.json({ ok: false, error: "No plan for that week yet." }, { status: 404 });
        if (plan) {
          const sp = { ref, cells: {} };
          if (tgt.l) {
            const arr = Array.isArray(plan[tgt.l]) ? plan[tgt.l] : [];
            const i = arr.findIndex((x) => x && x.id === tgt.k);
            if (i < 0) return Response.json({ ok: false, error: "That job is not in this week any more." }, { status: 404 });
            sp.field = tgt.l; sp.item = arr[i]; sp.index = i;
            arr.splice(i, 1);
          }
          const pl = (plan.placements && typeof plan.placements === "object") ? plan.placements : {};
          Object.keys(pl).forEach((k) => {
            if (!Array.isArray(pl[k]) || !pl[k].includes(ref)) return;
            sp.cells[k] = [ref];
            pl[k] = pl[k].filter((r) => r !== ref);
            if (!pl[k].length) delete pl[k];
          });
          if (plan.exceptions && typeof plan.exceptions === "object" && plan.exceptions[ref]) {
            sp.exception = plan.exceptions[ref];
            delete plan.exceptions[ref];
          }
          planOut = { key: pkey, plan };
          stash.plan = sp;
        }
      }

      // the calendar copies: this week's, and (for a list job or a step) every later week's
      const same = (t) => t && (tgt.p ? t.p === tgt.p && t.s === tgt.s
        : tgt.m ? t.m === tgt.m && String(t.k || "").split(":")[0] === id
        : t.l === tgt.l && t.k === tgt.k);
      const ags = [];
      try {
        const keys = tgt.l ? [agendaKeyOf(weekEnding)] : await agendaKeysFrom(weekEnding);
        for (const akey of keys) {
          const ag = await store.get(akey, { type: "json" });
          if (!ag || !ag.cells) continue;
          const took = {};
          Object.keys(ag.cells).forEach((k) => {
            const rows = Array.isArray(ag.cells[k]) ? ag.cells[k] : [];
            const out = rows.filter((r) => same(r.tgt));
            if (!out.length) return;
            took[k] = out;
            const keep = rows.filter((r) => !same(r.tgt));
            if (keep.length) ag.cells[k] = keep; else delete ag.cells[k];
          });
          if (Object.keys(took).length) { stash.agendas[akey] = took; ags.push([akey, ag]); }
          else if (akey === agendaKeyOf(weekEnding)) ags.push([akey, ag]);
        }
      } catch { /* the caches are disposable */ }

      // the way back is saved BEFORE anything is taken
      await store.set(LAST_DELETE_KEY, JSON.stringify(stash));
      if (stash.list) {
        const key = stash.list === "training" ? TRAINING_DEFAULTS_KEY : RECURRING_DEFAULTS_KEY;
        const list = (await store.get(key, { type: "json" })) || [];
        await store.set(key, JSON.stringify(list.filter((t) => !(t && t.id === id))));
      }
      if (planOut) {
        planOut.plan.lastUpdated = new Date().toISOString();
        await store.set(planOut.key, JSON.stringify(planOut.plan));
      }
      let agenda = null;
      for (const [akey, ag] of ags) {
        try { if (stash.agendas[akey]) await store.set(akey, JSON.stringify(ag)); } catch { /* cache */ }
        if (akey === agendaKeyOf(weekEnding)) agenda = ag;
      }
      return Response.json({ ok: true, token: stash.token, weekEnding, agenda });
    }

    // v136 Competitors: POST { igCompetitors: [...] }. A whole-list write — the page holds
    // the order and hands back the full list — de-duplicated and capped at ten. Touches
    // nothing but its own key.
    if (Array.isArray(body.igCompetitors)) {
      const seen = new Set();
      const list = [];
      for (const raw of body.igCompetitors) {
        const c = cleanCompetitor(raw);
        if (!c || seen.has(c.username)) continue;
        seen.add(c.username);
        list.push(c);
        if (list.length >= IG_COMPETITOR_CAP) break;
      }
      await store.set(IG_COMPETITORS_KEY, JSON.stringify(list));
      return Response.json({ ok: true, competitors: list });
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
      // v262: bankIn / salesAfterFees are worked out on read, never stored
      delete body.month.bankIn; delete body.month.salesAfterFees;
      const months = (await store.get(MONTHS_KEY, { type: "json" })) || [];
      const i = months.findIndex((m) => m.ym === body.month.ym);
      if (i >= 0) months[i] = { ...months[i], ...body.month };
      else months.push(body.month);
      months.sort((a, b) => (a.ym < b.ym ? -1 : 1));
      await store.set(MONTHS_KEY, JSON.stringify(months));
      return Response.json({ ok:true, month: body.month, months: await withBankIn(store, months) });
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
