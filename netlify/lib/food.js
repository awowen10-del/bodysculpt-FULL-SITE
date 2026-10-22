// netlify/lib/food.js — the Food hub's server side (v236)
//
// Ash's family: him and Chloe, and Polly and Artie, two young and VERY fussy eaters. Most
// weeks a meat box from the butcher. Goals: minimal waste, healthier, cheaper, simple. Some
// nights Ash is in Warrington and Chloe cooks alone; busy or puppy weeks want slow-cooker
// dump bags. They shop at Tesco online.
//
// Everything the two food functions share lives here:
//   • FOOD_MODELS / FOOD_EFFORT — the ONE place the models and how hard they think are set.
//   • the default planning rules (Ash edits his copy in settings) and the fixed instructions.
//   • the Zod schemas every answer must pass, and the checks no schema can make: every cooking
//     night gets exactly one meal, dump-bag nights come with a prep session, every deduction
//     points at a real inventory item.
//   • the request context: inventory, schedule, situation, kids, rules, taste, products and
//     the last six weeks — sent with EVERY request.
//   • turning a checked answer into the stored week; staples removed from the to-buy list
//     here, by code, not left to the model.
//   • PROTEIN, checked by code: every ingredient carries its protein for the quantity used; the
//     server adds them up and divides by the adult-equivalent servings — the model's own total
//     is never used. A meal outside the target goes back ONCE with its shortfall; if it is
//     still outside, it is saved and flagged on its card, never hidden.
//   • the RECIPE BOOK: a favourite the planner brings back is replaced here, by code, with the
//     saved recipe exactly (scaled if needed) — the dish the kids loved comes back the same way.
//   • the job runner. createMenu streams; each finished meal is copied into the job record as
//     it is written so the page can show it, but the saved menu is replaced only when the
//     whole answer has arrived and passed every check. A failure never touches it.
//
// kpi-store.js keeps its own small whitelists for what the page writes (it is run from a temp
// copy in tests, so it imports nothing). The shared key strings and default lists are
// asserted equal by tests/v236-food-hub.test.cjs.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

/* ---------- the models, and how hard each thinks: change them here and only here ---------- */
export const FOOD_MODELS = {
  readPhoto: "claude-haiku-5-5",    // reading a butcher's sign is a simple job
  readCupboard: "claude-sonnet-5-5", // recognising every jar and packet on a shelf is not — and must answer inside 22 seconds
  createMenu: "claude-opus-5-5",
  swapMeal: "claude-opus-5-5",
  changeMenu: "claude-opus-5-5",
  useRecipe: "claude-opus-5-5",     // a saved recipe onto one night of the week
};
/* Opus 5.5 always thinks and takes no thinking budget (the API rejects budget_tokens on it);
   depth is set by effort. The leftover sequencing has to be worked through properly, so the
   three menu jobs think hard. "xhigh" is the next step up. */
export const FOOD_EFFORT = {
  readPhoto: "low",
  readCupboard: "low",
  createMenu: "high",
  swapMeal: "high",
  changeMenu: "high",
  useRecipe: "high",
};

/* ---------- keys (the same strings as kpi-store.js) ---------- */
export const FOOD_PLAN_PREFIX = "food-plan-";      // + week (its Monday, as the weekly plan)
export const FOOD_JOB_PREFIX = "food-job-";        // + week
export const FOOD_SETTINGS_KEY = "food-settings";
export const FOOD_PRODUCTS_KEY = "food-products";
export const FOOD_TASTE_KEY = "food-taste";
export const FOOD_INVENTORY_KEY = "food-inventory";
export const FOOD_RECIPES_KEY = "food-recipes";    // the recipe book: { recipes: [...] }
export const foodPlanKeyOf = (w) => FOOD_PLAN_PREFIX + w;
export const foodJobKeyOf = (w) => FOOD_JOB_PREFIX + w;
export const validWeek = (w) => typeof w === "string" && /^\d{4}-\d{2}-\d{2}$/.test(w);

/* ---------- the family, the week, the cupboard ---------- */
export const FOOD_RATERS = [["polly", "Polly"], ["artie", "Artie"], ["adults", "the adults"]];
export const RATING_WORDS = { up: "thumbs up", so: "so-so", down: "thumbs down" };
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DAY_NAMES = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
export const NIGHT_TYPES = {
  family: "Family night — a normal cook, up to about 40 minutes",
  solo: "Chloe solo — Ash is away in Warrington: a slow-cooker DUMP BAG",
  busy: "Busy / puppy night — a dump bag OR a 15-minute meal",
  none: "No cooking",
};
export const CATEGORIES = ["meat", "fresh", "cupboard", "sauces", "spices", "staples"];
export const UNITS = ["g", "ml", "count"];
export const DEFAULT_SPICES = ["Italian seasoning", "bay leaves", "thyme", "toasted sesame seeds", "Colman's mustard powder",
  "Korean seasoning (Rub Me Seoul Food)", "everything bagel seasoning", "lemon pepper", "hot honey seasoning", "mild curry powder",
  "whole cloves", "Nando's Peri-Salt", "Knorr Aromat"];
export const DEFAULT_STAPLES = ["olive oil", "salt", "black pepper", "stock cubes", "plain flour"];

/* The planning rules, pre-filled in settings and editable there. Sent with every request. */
export const DEFAULT_RULES = `- Use the meat we have, most perishable first. Use fridge items that need using soon first.
- Simple and easy above everything. Dump bag meals must be genuinely "bag it, freeze it, tip it in".
- MINIMAL WASTE IS A HARD RULE: we buy whole standard Tesco packs. Any opened perishable is used again within 1-3 days until finished (e.g. 600g of a 1.2kg bag of potatoes means another recipe uses the rest within 2 days). Hardy items (onions, rice, pasta, tins) can spread across the week. Plan around a linked product's real pack size.
- As few new ingredients as possible, each used in several meals, nothing niche for one recipe. Prefer the cupboard. Staples never on the to-buy list.
- Healthy and high protein. Kid-friendly formats (wraps, pasta, burgers, rice bowls, traybakes, stews, fakeaways), mild by default, sauce and heat on the side for adults.
- Bring back proven favourites (1-2 a week), never repeat never-again meals, no repeats from the last 2 weeks, use the rating notes to steer formats and ingredients.
- Respect the situation box and each night's type.`;

/* Protein: the defaults for settings. 2 adults + 2 young kids at half portions = 3 adult servings. */
export const PROTEIN_DEFAULTS = { proteinMin: 30, proteinMax: 40, servings: 3 };

/* How the answer must be built — fixed, not editable: the shape the code relies on. */
export const FIXED_INSTRUCTIONS = `You plan the evening meals for one UK family for one week: 2 adults (Ash and Chloe) and 2 young children (Polly and Artie) who are VERY fussy eaters. They shop online at Tesco.

Each night has a type:
- family: a normal cook, up to about 40 minutes.
- solo: Ash is away in Warrington and Chloe cooks alone. ALWAYS a slow-cooker dump bag (dumpBag true).
- busy: a busy or puppy night. A dump bag (dumpBag true) or a meal of 15 minutes or less.
- none: no cooking. Write NO meal for that night.
Write exactly one meal for every night that is not "none", using that night's day key.

RECIPE QUALITY (as important as the waste rules):
- Every meal must be a real, recognisable dish a family would actually be excited to eat: proven British family favourites, popular fakeaways and well-known classics (chilli con carne, beef stew and dumplings, chicken fajitas, sausage casserole, cottage pie, chicken katsu, sticky honey garlic chicken, Korean beef rice bowls, spaghetti bolognese, burger night). Never an invented combination made up just to use ingredients. If the stock doesn't fit a good dish, buy one or two cheap extras rather than compromise the recipe.
- Write recipes like a good cookbook, not a list of instructions: exact quantities (spices too, in tsp/tbsp), the pan and the heat, timings, and doneness cues ("until golden and sticky", "until the chicken reaches 75°C / the juices run clear").
- Build flavour properly: season at each stage, brown meat before simmering when the method allows, balance with something sharp (lemon, vinegar) or fresh (herbs, spring onion) where the dish needs it, and give a finishing touch.
- Cooking times and portions must be realistic for 2 adults and 2 young kids.
- Dump bags: only dishes known to work well in a slow cooker (stews, chillies, casseroles, curries, pulled meats, honey garlic chicken). Give slow cooker times for LOW and HIGH in slowCooker. Food safety: a frozen bag must be fully defrosted in the fridge overnight before slow cooking — never cook from frozen. Say so in the morning-of instruction.
- Before returning, review each recipe as an experienced family cook would: is this a dish people genuinely make and love? Will it taste good? Is the method complete enough to follow first time? Fix or replace anything that fails, then return the menu.

PROTEIN (top priority, alongside waste and recipe quality):
- Every meal must give the protein per ADULT serving set out in the request (PROTEIN TARGET), counting the adult-equivalent servings given there.
- Give EVERY ingredient its protein in grams for the quantity used in the meal (0 for things with none). The total is worked out from these, so be accurate.
- If the meat allocated to a meal falls short, top it up in this order: 1) more of the same meat from stock, if that doesn't leave another meal short; 2) a protein that fits the dish naturally — lean bacon medallions, eggs, Greek yoghurt or skyr (in sauces, marinades, dips), grated or light cheese, cottage cheese, extra chicken breast, beans or lentils (in chillies, stews, curries); 3) never a top-up that clashes with the dish or makes it worse — recipe quality still applies.
- Mark each top-up ingredient topUp=true and list it in proteinTopUps. Any top-up not in stock goes on the to-buy list with proteinTopUp=true. Waste rules still apply: prefer top-ups used across several meals (one pack of bacon medallions over two nights, Greek yoghurt in three).

RECIPE BOOK: when you bring back a recipe from the book, set recipeId to its id and cook it exactly as saved (scale only if the number eating differs); otherwise recipeId is "".

For every meal:
- meat: the inventory id of the meat used, its name, and exactly how much.
- perAdult: kcal, protein, carbs and fat (grams) for ONE ADULT serving.
- ingredients: each with its quantity, its protein in grams for that quantity, topUp (true for a protein top-up), and have=true if it is in the inventory or bought for an earlier night, otherwise have=false.
- method: full numbered steps, written like a good cookbook.
- slowCooker: for a dump bag, the time on LOW and on HIGH (e.g. "7-8 hours", "4 hours"); empty strings otherwise.
- usesUp: leftovers from earlier nights (or already in the fridge) that this meal finishes.
- consumes: every inventory item the meal uses up, by its inventory id, with the quantity in that item's unit. Only ids from the inventory list.
- leftovers: what is left of any pack this meal opens (e.g. 600g of a 1.2kg bag of potatoes), as it should be put back in the fridge, freezer or cupboard.
- kidTip: one practical tip for getting fussy children to eat it.
Dump bag meals need NO browning on the day: everything raw into a bag, frozen or fridged, tipped into the slow cooker in the morning (a frozen bag having defrosted in the fridge overnight).

prepSession: when there are dump bag nights, one session making all of the week's bags: for each bag what goes in, how to label it, freeze or fridge, and the morning-of instruction. Empty bags list when there are none.

toBuy: every ingredient with have=false, merged into whole standard Tesco packs, grouped by aisle (e.g. "Fruit & veg", "Meat & fish", "Dairy & eggs", "Bakery", "Tins & jars", "Pasta, rice & grains", "Frozen", "World foods"): the quantity to buy, which nights use it, what is left of the pack after the week, an estimated price in pounds, and proteinTopUp=true for a protein top-up. Never include a staple.

endLeftovers: what will realistically be left over at the end of the week.`;

/* ---------- small cleaners ---------- */
const str = (v, n) => (typeof v === "string" ? v.slice(0, n).trim() : "");
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0; };
const strList = (v, n, each) => (Array.isArray(v) ? v : []).map((x) => str(x, each)).filter(Boolean).slice(0, n);
const uid = (p) => p + Math.random().toString(36).slice(2, 9);
export function productKey(name) {
  return String(name || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}
export function addDays(ymd, n) {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const dateOfDay = (week, day) => addDays(week, Math.max(0, DAYS.indexOf(day)));
export function defaultFoodSettings() { return { kidsNotes: "", people: 4, rules: "", ...PROTEIN_DEFAULTS }; }
// the protein target as it stands: the settings, else the defaults
export function proteinTarget(settings, people) {
  const s = settings || {};
  const lo = num(s.proteinMin, 0, 200) || PROTEIN_DEFAULTS.proteinMin;
  const hi = Math.max(lo, num(s.proteinMax, 0, 300) || PROTEIN_DEFAULTS.proteinMax);
  // more than the usual four at the table (Chloe's mum over) — each extra counts as an adult
  const servings = (num(s.servings, 0.5, 20) || PROTEIN_DEFAULTS.servings) + Math.max(0, (Number(people) || 4) - 4);
  return { min: lo, max: hi, servings };
}
// protein per adult serving, from the ingredients — never the model's own total
export function proteinPerAdult(ingredients, servings) {
  const total = (ingredients || []).reduce((t, i) => t + (Number.isFinite(Number(i && i.protein)) ? Math.max(0, Number(i.protein)) : 0), 0);
  return Math.round((total / (servings || PROTEIN_DEFAULTS.servings)) * 10) / 10;
}
export function proteinIssues(meals, target) {
  return (meals || []).map((m) => ({ night: m.night, perAdult: proteinPerAdult(m.ingredients, target.servings) }))
    .filter((p) => p.perAdult < target.min || p.perAdult > target.max);
}
const proteinWords = (issues, target) => issues.map((p) => DAY_NAMES[p.night] + " is " + p.perAdult + "g per adult serving — " +
  (p.perAdult < target.min ? "top it up to at least " + target.min + "g" : "bring it down to " + target.max + "g or less")).join("\n");
// "454g" × 1.5 → "681g"; a quantity with no leading number is left as it is
export function scaleQty(q, f) {
  if (!f || f === 1) return q;
  return String(q || "").replace(/^(\d+(?:\.\d+)?)/, (n) => String(Math.round(Number(n) * f * 10) / 10));
}
export function defaultInventory(today) {
  const t = today || new Date().toISOString().slice(0, 10);
  const mk = (name, category) => ({ id: uid("i_"), name, qty: 1, unit: "count", category, storage: "cupboard", added: t, opened: "" });
  return { items: [...DEFAULT_SPICES.map((n) => mk(n, "spices")), ...DEFAULT_STAPLES.map((n) => mk(n, "staples"))] };
}

/* ---------- what the AI must return ---------- */
const Day = z.enum(DAYS);
const Macro = z.object({ kcal: z.number(), protein: z.number(), carbs: z.number(), fat: z.number() });
const Meal = z.object({
  night: Day,
  name: z.string(),
  summary: z.string(),
  meat: z.object({ inventoryId: z.string(), name: z.string(), amount: z.string() }),
  minutes: z.number(),
  dumpBag: z.boolean(),
  perAdult: Macro,
  usesUp: z.array(z.string()),
  ingredients: z.array(z.object({ name: z.string(), qty: z.string(), have: z.boolean(), protein: z.number(), topUp: z.boolean() })),
  method: z.array(z.string()),
  slowCooker: z.object({ low: z.string(), high: z.string() }),
  proteinTopUps: z.array(z.string()),
  recipeId: z.string(),
  kidTip: z.string(),
  consumes: z.array(z.object({ inventoryId: z.string(), qty: z.number() })),
  leftovers: z.array(z.object({ name: z.string(), qty: z.number(), unit: z.enum(UNITS),
    category: z.enum(["meat", "fresh", "cupboard", "sauces"]), storage: z.enum(["fridge", "freezer", "cupboard"]) })),
});
const Prep = z.object({
  bags: z.array(z.object({ night: Day, name: z.string(), contents: z.array(z.string()), label: z.string(),
    storage: z.enum(["freezer", "fridge"]), morningOf: z.string() })),
  steps: z.array(z.string()),
});
const Buy = z.object({ name: z.string(), qty: z.string(), aisle: z.string(), nights: z.array(Day), leftover: z.string(), estPrice: z.number(), proteinTopUp: z.boolean() });
// meals FIRST, so they stream first and can be shown as each one is written
export const MenuOut = z.object({ meals: z.array(Meal), prepSession: Prep, toBuy: z.array(Buy), endLeftovers: z.array(z.string()) });
export const ChangeOut = z.object({ changedNights: z.array(Day), meals: z.array(Meal), prepSession: Prep, toBuy: z.array(Buy),
  endLeftovers: z.array(z.string()), summary: z.string() });
export const CupboardOut = z.object({ items: z.array(z.object({ name: z.string(), category: z.enum(["fresh", "cupboard", "sauces", "spices", "staples"]),
  qty: z.number(), unit: z.enum(UNITS), storage: z.enum(["fridge", "freezer", "cupboard"]) })), note: z.string() });
export const PhotoOut = z.object({ items: z.array(z.object({ name: z.string(), qty: z.number(), unit: z.enum(UNITS) })), note: z.string() });

/* ---------- the request: everything, every time ---------- */
function ratingLine(r) {
  if (!r) return "not rated";
  const bits = FOOD_RATERS.map(([k, label]) => (r[k] ? label + " " + RATING_WORDS[r[k]] : "")).filter(Boolean);
  return (bits.length ? bits.join(", ") : "not rated") + (r.note ? ' — "' + r.note + '"' : "");
}
export function tasteText(taste, history) {
  const t = taste || {};
  const lines = [
    "FAVOURITES (both kids gave thumbs up — bring back 1-2 at most): " + ((t.favourites || []).join("; ") || "none yet"),
    "NEVER AGAIN (do not plan these): " + ((t.neverAgain || []).join("; ") || "none yet"),
  ];
  const notes = (t.notes || []).slice(0, 40);
  if (notes.length) { lines.push("RATING NOTES:"); for (const n of notes) lines.push("- " + n.meal + ": " + n.note); }
  const h = (history || []).slice(0, 6);
  const recent = h.slice(0, 2).flatMap((w) => (w.meals || []).map((m) => m.name)).filter(Boolean);
  lines.push("DO NOT REPEAT (eaten in the last 2 weeks): " + (recent.length ? recent.join("; ") : "nothing yet"));
  if (h.some((w) => (w.meals || []).length)) {
    lines.push("THE LAST 6 WEEKS (meal — how it went):");
    for (const w of h) for (const m of w.meals || []) lines.push("- week of " + w.week + ": " + m.name + " — " + ratingLine(m.ratings));
  }
  return lines.join("\n");
}
export function recipeBookText(book) {
  const rs = ((book && book.recipes) || []).slice(0, 60);
  if (!rs.length) return "RECIPE BOOK: empty so far.";
  return "RECIPE BOOK (favourites saved in full — reuse exactly by setting recipeId):\n" + rs.map((r) =>
    "- [" + r.id + "] " + r.name + (r.dumpBag ? " (dump bag)" : "") + " — ingredients: " +
    (r.ingredients || []).map((i) => i.qty + " " + i.name).join(", ") + " — " + ratingLine(r.ratings)).join("\n");
}
export function contextText(ctx) {
  const inv = (ctx.inventory && ctx.inventory.items) || [];
  const t = proteinTarget(ctx.settings, ctx.people);
  const byCat = (c) => inv.filter((i) => i.category === c)
    .map((i) => "- [" + i.id + "] " + i.name + " — " + i.qty + (i.unit === "count" ? "" : i.unit) + (i.unit === "count" ? " (count)" : "") +
      " — " + i.storage + (i.opened ? " — opened " + i.opened : i.added ? " — added " + i.added : "")).join("\n") || "(none)";
  const sched = DAYS.map((d) => "- " + d + " (" + DAY_NAMES[d] + " " + dateOfDay(ctx.week, d) + "): " + ((ctx.schedule || {})[d] || "family") +
    " — " + NIGHT_TYPES[(ctx.schedule || {})[d] || "family"]).join("\n");
  const confirmed = Object.entries(ctx.products || {}).filter(([, p]) => p && (p.confirmed || p.productName));
  const prods = confirmed.length ? confirmed.map(([k, p]) => "- " + k + ": " + (p.productName || k) + (p.packSize ? " — pack size " + p.packSize : "") +
    (p.lastPrice ? " — last price £" + Number(p.lastPrice).toFixed(2) : "")).join("\n") : "(none linked yet)";
  return [
    "PEOPLE EATING: " + (ctx.people || 4),
    "PROTEIN TARGET: " + t.min + "-" + t.max + "g protein per ADULT serving, every meal. Adult-equivalent servings: " + t.servings +
      " (2 adults + 2 young kids at half portions" + (t.servings > (num((ctx.settings || {}).servings, 0.5, 20) || PROTEIN_DEFAULTS.servings) ? ", plus the extra people eating" : "") +
      "). Per adult serving = total protein of the meal ÷ " + t.servings + ".",
    "THIS WEEK'S NIGHTS:\n" + sched,
    "ANYTHING ELSE THIS WEEK: " + (str(ctx.situation, 2000) || "nothing"),
    "MEAT (inventory id in brackets):\n" + byCat("meat"),
    "FRESH (use soonest first):\n" + byCat("fresh"),
    "CUPBOARD:\n" + byCat("cupboard"),
    "SAUCES & CONDIMENTS:\n" + byCat("sauces"),
    "SPICES & SEASONINGS (use these first):\n" + byCat("spices"),
    "STAPLES (always in the house — NEVER on the to-buy list):\n" + byCat("staples"),
    "WHAT THE KIDS WILL AND WON'T EAT: " + (str((ctx.settings || {}).kidsNotes, 2000) || "nothing noted yet"),
    "LINKED TESCO PRODUCTS (plan around these real pack sizes):\n" + prods,
    tasteText(ctx.taste, ctx.history),
    recipeBookText(ctx.recipes),
  ].join("\n\n");
}
export function systemText(settings) {
  const rules = str((settings || {}).rules, 6000) || DEFAULT_RULES;
  return FIXED_INSTRUCTIONS + "\n\nTHE FAMILY'S PLANNING RULES:\n" + rules;
}
export const cookingNights = (schedule) => DAYS.filter((d) => ((schedule || {})[d] || "family") !== "none");

/* ---------- checks no schema can make ---------- */
function checkMeals(meals, nights, schedule, inventory) {
  const ids = new Set(((inventory && inventory.items) || []).map((i) => i.id));
  const got = meals.map((m) => m.night).sort();
  if (got.join() !== nights.slice().sort().join()) return "The menu did not have exactly one meal for each cooking night.";
  for (const m of meals) {
    if (!m.name.trim() || !m.method.length) return "A meal came back without a name or a method.";
    if ((schedule || {})[m.night] === "solo" && !m.dumpBag) return "A Chloe-solo night came back without a dump bag.";
    if (m.dumpBag && (!m.slowCooker.low.trim() || !m.slowCooker.high.trim())) return "A dump bag came back without its slow cooker times.";
    if (m.consumes.some((c) => !ids.has(c.inventoryId))) return "A meal used something that is not in the inventory.";
  }
  return "";
}
function checkPrep(meals, prep) {
  const bagNights = meals.filter((m) => m.dumpBag).map((m) => m.night);
  const bagged = new Set((prep.bags || []).map((b) => b.night));
  if (bagNights.some((n) => !bagged.has(n))) return "Dump bag nights came back without a prep session for them.";
  return "";
}
export function checkMenu(parsed, ctx) {
  const r = MenuOut.safeParse(parsed);
  if (!r.success) return { ok: false, error: "The menu came back in the wrong shape." };
  const e = checkMeals(r.data.meals, cookingNights(ctx.schedule), ctx.schedule, ctx.inventory) || checkPrep(r.data.meals, r.data.prepSession);
  return e ? { ok: false, error: e } : { ok: true, data: r.data };
}
export function checkChange(parsed, plan, ctx) {
  const r = ChangeOut.safeParse(parsed);
  if (!r.success) return { ok: false, error: "The change came back in the wrong shape." };
  const d = r.data;
  const planned = new Set((plan.meals || []).map((m) => m.night));
  if (!d.changedNights.length) return { ok: false, error: "Nothing was changed." };
  if (d.changedNights.some((n) => !planned.has(n))) return { ok: false, error: "The change touched a night that has no meal." };
  if (ctx.onlyNight && (d.changedNights.length !== 1 || d.changedNights[0] !== ctx.onlyNight)) return { ok: false, error: "The swap changed more than that one night." };
  const e = checkMeals(d.meals, d.changedNights, plan.schedule, ctx.inventory);
  if (e) return { ok: false, error: e };
  // the prep session is judged on the menu as it will stand
  const merged = (plan.meals || []).filter((m) => !d.changedNights.includes(m.night)).concat(d.meals);
  const p = checkPrep(merged, d.prepSession);
  return p ? { ok: false, error: p } : { ok: true, data: d };
}

/* ---------- a checked answer → the stored week ---------- */
// a favourite brought back: the book's recipe, exactly (scaled if needed); the night's own
// planning — its meat from stock, what it consumes and leaves — stays the model's
function fromBook(m, book, people) {
  const r = m.recipeId && ((book && book.recipes) || []).find((x) => x.id === m.recipeId);
  if (!r) return { ...m, recipeId: "" };
  const f = (Number(people) || 4) / (r.people || 4);
  return { ...m, name: r.name, summary: r.summary || m.summary, kidTip: r.kidTip || m.kidTip, method: (r.method || []).slice(),
    slowCooker: r.slowCooker || m.slowCooker, dumpBag: m.dumpBag,
    ingredients: (r.ingredients || []).map((i) => ({ ...i, qty: scaleQty(i.qty, f), protein: Math.round((Number(i.protein) || 0) * f * 10) / 10,
      have: (m.ingredients || []).some((x) => productKey(x.name) === productKey(i.name) && x.have) })),
    proteinTopUps: r.proteinTopUps || [], recipeId: r.id };
}
function cleanMeal(m, week, schedule, target, flagged) {
  const ingredients = (m.ingredients || []).slice(0, 30).map((i) => ({ name: str(i.name, 80), qty: str(i.qty, 40), have: i.have === true,
    protein: num(i.protein, 0, 500), topUp: i.topUp === true })).filter((i) => i.name);
  const protein = proteinPerAdult(ingredients, target.servings);
  return {
    id: uid("m_"), night: m.night, date: dateOfDay(week, m.night), type: (schedule || {})[m.night] || "family",
    name: str(m.name, 120), summary: str(m.summary, 240),
    meat: { inventoryId: str(m.meat.inventoryId, 40), name: str(m.meat.name, 80), amount: str(m.meat.amount, 40) },
    minutes: num(m.minutes, 0, 600), dumpBag: m.dumpBag === true,
    // protein is OURS, from the ingredients; the other macros are the model's
    perAdult: { kcal: num(m.perAdult.kcal, 0, 5000), protein, carbs: num(m.perAdult.carbs, 0, 1000), fat: num(m.perAdult.fat, 0, 500) },
    proteinFlag: !flagged ? "" : protein < target.min ? "below" : protein > target.max ? "above" : "",
    proteinTopUps: strList(m.proteinTopUps, 6, 60).length ? strList(m.proteinTopUps, 6, 60) : ingredients.filter((i) => i.topUp).map((i) => i.name).slice(0, 6),
    recipeId: str(m.recipeId, 40),
    usesUp: strList(m.usesUp, 12, 80),
    ingredients,
    method: strList(m.method, 30, 600), kidTip: str(m.kidTip, 300),
    slowCooker: m.dumpBag ? { low: str((m.slowCooker || {}).low, 40), high: str((m.slowCooker || {}).high, 40) } : { low: "", high: "" },
    consumes: (m.consumes || []).slice(0, 30).map((c) => ({ inventoryId: str(c.inventoryId, 40), qty: num(c.qty, 0, 100000) })),
    leftovers: (m.leftovers || []).slice(0, 12).map((l) => ({ name: str(l.name, 80), qty: num(l.qty, 0, 100000), unit: l.unit, category: l.category, storage: l.storage }))
      .filter((l) => l.name && l.qty > 0),
    status: "planned", cookedAt: "", ratings: null,
  };
}
// Food safety is code, not trust: every freezer bag carries the defrost instruction, whatever was written.
export const DEFROST_NIGHT_BEFORE = "The night before: move this bag from the freezer to the fridge so it defrosts fully. Never slow cook from frozen.";
function cleanPrep(p, meals) {
  return {
    bags: (p.bags || []).slice(0, 7).map((b) => {
      const m = (meals || []).find((x) => x.night === b.night);
      const storage = b.storage === "fridge" ? "fridge" : "freezer";
      return { night: b.night, name: str(b.name, 120), contents: strList(b.contents, 20, 120),
        label: str(b.label, 160), storage, morningOf: str(b.morningOf, 400),
        nightBefore: storage === "freezer" ? DEFROST_NIGHT_BEFORE : "",
        slowCooker: m ? m.slowCooker : { low: "", high: "" } };
    }),
    steps: strList(p.steps, 20, 300),
  };
}
// staples are never bought — removed here, whatever the model wrote
function isStaple(name, staples) {
  const k = " " + productKey(name) + " ";
  return staples.some((s) => s && k.includes(" " + s + " "));
}
export function buildToBuy(raw, ctx, prevToBuy, meals) {
  const staples = ((ctx.inventory && ctx.inventory.items) || []).filter((i) => i.category === "staples").map((i) => productKey(i.name))
    .concat(DEFAULT_STAPLES.map(productKey));
  const prevTicks = {};
  for (const b of prevToBuy || []) if (b.ticked) prevTicks[b.key] = true;
  const fromModel = (raw || []).slice(0, 80).filter((b) => b && !isStaple(b.name, staples)).map((b) => {
    const key = productKey(b.name);
    return withProduct({ id: uid("b_"), key, name: str(b.name, 80), qty: str(b.qty, 40), aisle: str(b.aisle, 40) || "Other",
      nights: (b.nights || []).filter((n) => DAYS.includes(n)), leftover: str(b.leftover, 120), estPrice: num(b.estPrice, 0, 500),
      proteinTopUp: b.proteinTopUp === true, ticked: !!prevTicks[key], manual: false }, ctx.products);
  });
  // protein top-ups not in stock are ON the list and flagged — checked here, not trusted
  const needs = {};
  for (const m of meals || []) for (const i of m.ingredients || []) {
    if (!i.topUp || i.have || isStaple(i.name, staples)) continue;
    const k = productKey(i.name);
    (needs[k] = needs[k] || { name: i.name, qty: i.qty, nights: [] }).nights.push(m.night);
  }
  for (const [k, n] of Object.entries(needs)) {
    const hit = fromModel.find((b) => b.key === k || b.key.includes(k) || k.includes(b.key));
    if (hit) hit.proteinTopUp = true;
    else fromModel.push(withProduct({ id: uid("b_"), key: k, name: str(n.name, 80), qty: str(n.qty, 40), aisle: "Protein top-ups", nights: n.nights,
      leftover: "", estPrice: 0, proteinTopUp: true, ticked: !!prevTicks[k], manual: false }, ctx.products));
  }
  // anything Ash added by hand stays
  const manual = (prevToBuy || []).filter((b) => b && b.manual && !fromModel.some((x) => x.key === b.key));
  return fromModel.concat(manual);
}
export function withProduct(item, products) {
  const p = (products || {})[item.key] || null;
  return { ...item, productName: p ? str(p.productName, 160) : "", packSize: p ? str(p.packSize, 40) : "",
    productUrl: p && /^https?:\/\//i.test(p.productUrl || "") ? str(p.productUrl, 500) : "",
    lastPrice: p ? num(p.lastPrice, 0, 500) : 0, confirmed: !!(p && p.confirmed) };
}
// `flagged`: the answer has already been sent back once, so a meal still off target is flagged
export function assembleMenu(prev, data, ctx, model, flagged) {
  const target = proteinTarget(ctx.settings, ctx.people);
  const meals = data.meals.map((m) => cleanMeal(m, ctx.week, ctx.schedule, target, flagged)).sort((a, b) => DAYS.indexOf(a.night) - DAYS.indexOf(b.night));
  return {
    weekEnding: ctx.week, schedule: { ...ctx.schedule }, situation: str(ctx.situation, 2000), people: num(ctx.people, 1, 12) || 4,
    proteinTarget: target,
    meals, prepSession: cleanPrep(data.prepSession, meals), toBuy: buildToBuy(data.toBuy, ctx, prev && prev.toBuy, meals),
    endLeftovers: strList(data.endLeftovers, 30, 120), generatedAt: new Date().toISOString(), model,
  };
}
// only the nights that changed are replaced; every other meal is kept exactly as it was
export function applyChange(prev, data, ctx, model, flagged) {
  const target = proteinTarget(ctx.settings, ctx.people);
  const fresh = {};
  for (const m of data.meals) fresh[m.night] = cleanMeal(m, ctx.week, prev.schedule, target, flagged);
  const meals = (prev.meals || []).map((m) => (data.changedNights.includes(m.night) && fresh[m.night] ? fresh[m.night] : m));
  return {
    ...prev,
    meals,
    prepSession: cleanPrep(data.prepSession, meals),
    toBuy: buildToBuy(data.toBuy, ctx, prev.toBuy, meals),
    endLeftovers: strList(data.endLeftovers, 30, 120),
    lastChange: str(data.summary, 300), generatedAt: new Date().toISOString(), model,
  };
}

/* ---------- "Copy for Claude": the to-buy list as a message for the Tesco basket ---------- */
export function copyForClaude(toBuy, products) {
  const lines = (toBuy || []).filter((b) => b && !b.ticked).map((b) => {
    const p = (products || {})[b.key] || {};
    const name = p.productName || b.productName, url = p.productUrl || b.productUrl;
    const linked = name || url;
    return "- " + b.name + " — " + (linked ? [name, url].filter(Boolean).join(" — ") : "choose the best-value standard pack") + " — " + b.qty;
  });
  return "Please fill my Tesco basket with:\n" + lines.join("\n");
}

/* ---------- talking to Claude ---------- */
export function errorWords(e) {
  if (e instanceof Anthropic.RateLimitError) return "Claude is busy right now — try again in a minute.";
  if (e instanceof Anthropic.AuthenticationError) return "The Anthropic key is missing or wrong in Netlify.";
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "That took too long — try again.";
  if (e instanceof Anthropic.InternalServerError) return "Claude had a problem on its side — try again shortly.";
  // the API's own reason, so a rejected request says WHY (it was a bare "400" before v249)
  if (e instanceof Anthropic.APIError) {
    const why = String((e.error && e.error.error && e.error.error.message) || "").trim();
    return "Claude refused the request (" + (e.status || "error") + ")" + (why ? ": " + why.slice(0, 240).replace(/\.+$/, "") : "") + ".";
  }
  return (e && e.message) ? String(e.message).slice(0, 200) : "Something went wrong.";
}
/* The meals array, read as it streams: every complete meal object so far. A plain scanner over
   the JSON text — strings and escapes respected — so a half-written meal is never shown. */
export function mealsSoFar(text) {
  const i = text.indexOf('"meals"');
  if (i < 0) return [];
  let j = text.indexOf("[", i);
  if (j < 0) return [];
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let k = j + 1; k < text.length; k++) {
    const c = text[k];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = k; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && start >= 0) { try { out.push(JSON.parse(text.slice(start, k + 1))); } catch (e) {} start = -1; } }
    else if (c === "]" && depth === 0) break;
  }
  return out;
}
// One structured call, streamed; the text is checked against the schema here, not trusted.
// `history`: earlier turns of the same conversation (the sending-back), passed back unchanged.
// `byHand` (v250): the menu schemas are too big for the API's enforced-JSON grammar ("The compiled
// grammar is too large"), so for those the shape goes in the instructions instead, the answer is
// checked here against the same Zod schema, and a wrong shape goes back ONCE, in the same
// conversation, with what was wrong. `turns` is the whole conversation so far, for a later send-back.
export async function askClaude(client, { model, system, content, schema, effort, maxTokens, fallback, onText, history, byHand }) {
  const messages = [...(history || []), { role: "user", content }];
  const params = { model, max_tokens: maxTokens, system: byHand ? system + shapeText(schema) : system, messages,
    output_config: byHand ? { effort } : { format: betaZodOutputFormat(schema), effort } };
  if (fallback) { params.betas = ["server-side-fallback-2026-07-01"]; params.fallbacks = "default"; }
  const msg = await streamOne(client, params, onText);
  if (msg.stop_reason === "refusal") return { ok: false, error: "Claude declined to answer that one." };
  if (msg.stop_reason === "max_tokens") return { ok: false, error: "The answer ran out of room before it finished." };
  const turns = [...messages, { role: "assistant", content: msg.content }];
  const read = readAnswer(msg, byHand ? schema : null);
  if (read.ok) return { ok: true, data: read.data, content: msg.content, turns };
  if (!byHand || byHand === "again") return { ok: false, error: "The answer was not readable." };
  return askClaude(client, { model, system, schema, effort, maxTokens, fallback, onText, history: turns, byHand: "again",
    content: "That answer was not in the required shape: " + read.error + "\nReturn the whole answer again as ONE JSON object in exactly the required shape — nothing before or after it." });
}
function streamOne(client, params, onText) {
  const stream = client.beta.messages.stream(params);
  if (onText && typeof stream.on === "function") {
    let acc = "";
    stream.on("text", (delta) => { acc += delta; onText(acc); });
  }
  return stream.finalMessage();
}
// the JSON object in the text — fences or a stray line around it tolerated — and, by hand, its shape
function readAnswer(msg, schema) {
  const text = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const i = text.indexOf("{"), j = text.lastIndexOf("}");
  let data;
  try { data = JSON.parse(i >= 0 && j > i ? text.slice(i, j + 1) : text); }
  catch (e) { return { ok: false, error: "it was not valid JSON." }; }
  if (schema) {
    const r = schema.safeParse(data);
    if (!r.success) return { ok: false, error: r.error.issues.slice(0, 8).map((x) => (x.path.join(".") || "the answer") + ": " + x.message).join("; ") };
  }
  return { ok: true, data };
}
const shapeText = (schema) => "\n\nANSWER FORMAT: reply with ONE JSON object and nothing else — no words before or after it, no code fences. " +
  "Every field is required, in this order. It must match this JSON Schema exactly:\n" + JSON.stringify(z.toJSONSchema(schema));

/* ---------- the jobs ---------- */
export async function readPhoto(client, { jpegBase64 }) {
  if (!jpegBase64 || jpegBase64.length > 6_000_000) return { ok: false, error: "That photo is missing or too large." };
  const r = await askClaude(client, {
    model: FOOD_MODELS.readPhoto, maxTokens: 4000, effort: FOOD_EFFORT.readPhoto, schema: PhotoOut,
    system: "You read a UK butcher's meat-box sign from a photo. List every meat item exactly as written, with its amount: grams (g) where a weight is given (for '8 x 228g' give the total in g and say the count in the name, e.g. '8 chicken fillets'), otherwise a count. Do not invent anything that is not visible.",
    content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } }, { type: "text", text: "List the items in this meat box." }],
  });
  if (!r.ok) return r;
  const c = PhotoOut.safeParse(r.data);
  if (!c.success) return { ok: false, error: "Could not read that sign." };
  return { ok: true, items: c.data.items.slice(0, 40).map((i) => ({ name: str(i.name, 80), qty: num(i.qty, 0, 100000), unit: i.unit })).filter((i) => i.name),
    note: str(c.data.note, 300) };
}
// a photo of a cupboard, the fridge, the spice rack: every food item, sorted into the hub's categories
export async function readCupboard(client, { jpegBase64 }) {
  if (!jpegBase64 || jpegBase64.length > 6_000_000) return { ok: false, error: "That photo is missing or too large." };
  const r = await askClaude(client, {
    model: FOOD_MODELS.readCupboard, maxTokens: 6000, effort: FOOD_EFFORT.readCupboard, schema: CupboardOut,
    system: "You list the food in a photo of a UK family's kitchen cupboard, fridge, freezer or spice rack, so it can be added to their kitchen inventory. " +
      "List every food or cooking item you can identify, by its plain everyday name (\"smoked paprika\", \"tinned chopped tomatoes\", \"soy sauce\", \"basmati rice\"), with the brand only when it IS the product (\"Knorr Aromat\", \"Nando's Peri-Salt\", \"Colman's mustard powder\"). " +
      "category: fresh (fridge food that goes off: veg, fruit, dairy, eggs, opened jars that need the fridge), cupboard (tins, pasta, rice, grains, jars, baking, snacks), sauces (sauces and condiments: ketchup, soy, mayo, pesto, stock pots), " +
      "spices (dried herbs, spices, seasoning blends), staples (only: oil, salt, black pepper, stock cubes, plain flour). " +
      "qty and unit: a count of packs, tins or jars (unit \"count\") unless a weight or volume is clear for something loose or fresh. storage: where the photo shows it. " +
      "Do not guess at things you cannot make out, and do not list non-food items. If the photo is not of food, return no items and say so in note.",
    content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } }, { type: "text", text: "List the food in this photo." }],
  });
  if (!r.ok) return r;
  const c = CupboardOut.safeParse(r.data);
  if (!c.success) return { ok: false, error: "Could not read that photo." };
  const seen = new Set();
  const items = c.data.items.slice(0, 80).map((i) => ({ name: str(i.name, 80), category: i.category, qty: num(i.qty, 0, 100000) || 1, unit: i.unit, storage: i.storage }))
    .filter((i) => i.name && !seen.has(productKey(i.name)) && seen.add(productKey(i.name)));
  return { ok: true, items, note: str(c.data.note, 300) };
}
async function getJSON(store, key) { return (await store.get(key, { type: "json" })) || null; }
async function setJob(store, week, patch) {
  const prev = (await getJSON(store, foodJobKeyOf(week))) || {};
  await store.set(foodJobKeyOf(week), JSON.stringify({ ...prev, ...patch }));
}
export async function recentWeeks(store, week) {
  const out = [];
  for (let i = 1; i <= 6; i++) {
    const w = addDays(week, -7 * i);
    const doc = await getJSON(store, foodPlanKeyOf(w));
    out.push({ week: w, meals: ((doc && doc.meals) || []).map((m) => ({ name: m.name, ratings: m.ratings || null })) });
  }
  return out;
}
export async function loadContext(store, week, inputs, prev) {
  const settings = (await getJSON(store, FOOD_SETTINGS_KEY)) || defaultFoodSettings();
  const inventory = (await getJSON(store, FOOD_INVENTORY_KEY)) || defaultInventory();
  return {
    week, settings, inventory,
    products: (await getJSON(store, FOOD_PRODUCTS_KEY)) || {},
    taste: (await getJSON(store, FOOD_TASTE_KEY)) || { favourites: [], neverAgain: [], notes: [] },
    recipes: (await getJSON(store, FOOD_RECIPES_KEY)) || { recipes: [] },
    history: await recentWeeks(store, week),
    schedule: (inputs && inputs.schedule) || (prev && prev.schedule) || {},
    situation: (inputs && typeof inputs.situation === "string") ? inputs.situation : ((prev && prev.situation) || ""),
    people: (inputs && inputs.people) || (prev && prev.people) || settings.people || 4,
  };
}
/* A checked answer, made final: favourites swapped for the book's recipe, then the protein
   counted from the ingredients. Off target → sent back ONCE in the same conversation (the first
   answer passed back unchanged) with each shortfall in words. Whatever comes back must pass the
   same checks; if it does not, or is still off target, the meals are saved and flagged. */
async function settle(client, store, week, ctx, first, ask) {
  const target = proteinTarget(ctx.settings, ctx.people);
  const finish = (d) => ({ ...d, meals: d.meals.map((m) => fromBook(m, ctx.recipes, ctx.people)) });
  const data = finish(first.data);
  const issues = proteinIssues(data.meals, target);
  if (!issues.length) return { data, flagged: false };
  await setJob(store, week, { stage: "protein", stageNote: "Sending " + issues.map((p) => DAY_NAMES[p.night]).join(", ") + " back for more protein…" });
  // the second pass is a polish, never a gate: if it fails outright, the first menu is kept, flagged
  let r2;
  try {
    r2 = await askClaude(client, { ...ask.params, history: first.turns,
    content: "PROTEIN CHECK (worked out from your ingredient protein values ÷ " + target.servings + " adult servings):\n" + proteinWords(issues, target) +
      "\nFix only those meals, in the order of the protein rules. Keep everything else exactly as it is. Return the whole answer again in the same shape." });
  } catch (e) {
    console.error("[food] protein re-check failed, keeping the first menu: " + errorWords(e));
    return { data, flagged: true };
  }
  const c2 = r2.ok ? ask.check(r2.data) : r2;
  if (!c2.ok) return { data, flagged: true };
  return { data: finish(c2.data), flagged: true };
}
function cleanSchedule(s) {
  const out = {};
  for (const d of DAYS) out[d] = ["family", "solo", "busy", "none"].includes((s || {})[d]) ? s[d] : "family";
  return out;
}
export async function runJob(store, client, job) {
  const week = job.weekEnding;
  if (!validWeek(week)) return { ok: false, error: "Bad week." };
  // the page names its job, so it can never mistake an older finished one for the one it started
  await setJob(store, week, { id: String(job.id || "").slice(0, 40), action: job.action, status: "running",
    startedAt: new Date().toISOString(), finishedAt: "", error: "", partial: [], stage: "", stageNote: "" });
  let out;
  try {
    const prev = await getJSON(store, foodPlanKeyOf(week));
    if (job.action === "createMenu") {
      const inputs = { ...(job.inputs || {}), schedule: cleanSchedule((job.inputs || {}).schedule) };
      const ctx = await loadContext(store, week, inputs, prev);
      if (!cookingNights(ctx.schedule).length) out = { ok: false, error: "Every night is set to No cooking." };
      else {
        let shown = 0;
        const params = { model: FOOD_MODELS.createMenu, maxTokens: 64000, effort: FOOD_EFFORT.createMenu, fallback: true, byHand: true, schema: MenuOut, system: systemText(ctx.settings) };
        const content = contextText(ctx) + "\n\nWrite this week's menu.";
        const r = await askClaude(client, {
          ...params, content,
          // each finished meal into the job record as it is written, for the page to show
          onText: (acc) => {
            const meals = mealsSoFar(acc);
            if (meals.length > shown) {
              shown = meals.length;
              setJob(store, week, { partial: meals.map((m) => ({ night: m.night, name: m.name, summary: m.summary, minutes: m.minutes,
                dumpBag: m.dumpBag, perAdult: m.perAdult })) }).catch(() => {});
            }
          },
        });
        const check = (d) => checkMenu(d, ctx);
        const c = r.ok ? check(r.data) : r;
        if (!c.ok) out = c;
        else {
          const done = await settle(client, store, week, ctx, { data: c.data, turns: r.turns }, { params, content, check });
          await store.set(foodPlanKeyOf(week), JSON.stringify(assembleMenu(prev, done.data, ctx, FOOD_MODELS.createMenu, done.flagged)));
          out = { ok: true };
        }
      }
    } else if (job.action === "swapMeal" || job.action === "changeMenu" || job.action === "useRecipe") {
      if (!prev || !(prev.meals || []).length) out = { ok: false, error: "There is no menu to change yet." };
      else {
        const ctx = await loadContext(store, week, null, prev);
        const night = job.action !== "changeMenu" ? String(job.night || "") : "";
        const recipe = job.action === "useRecipe" ? (ctx.recipes.recipes || []).find((x) => x.id === job.recipeId) : null;
        if (job.action !== "changeMenu" && !prev.meals.some((m) => m.night === night)) out = { ok: false, error: "There is no meal on that night to swap." };
        else if (job.action === "useRecipe" && !recipe) out = { ok: false, error: "That recipe is not in the book any more." };
        else {
          const current = prev.meals.map((m) => "- " + m.night + " [" + m.type + "]: " + m.name + " — " + m.meat.amount + " " + m.meat.name +
            "; uses up " + (m.usesUp.join(", ") || "nothing") + "; leaves " + (m.leftovers.map((l) => l.qty + l.unit + " " + l.name).join(", ") || "nothing")).join("\n");
          const ask = job.action === "swapMeal"
            ? "Swap the meal on " + night + " for a DIFFERENT meal of the same night type. Keep its meat and its leftover obligations so the rest of the week still works."
            : job.action === "useRecipe"
              ? "Put our saved recipe [" + recipe.id + "] " + recipe.name + " on " + night + " in place of what is there, exactly as saved (recipeId \"" + recipe.id + "\"), " +
                "using meat from stock where it can. Change nothing else unless the leftover chain needs it."
              : "Ash asks: \"" + str(job.request, 600) + "\"\nApply ONLY that change.";
          const params = { model: FOOD_MODELS[job.action], maxTokens: 48000, effort: FOOD_EFFORT[job.action], fallback: true, byHand: true, schema: ChangeOut, system: systemText(ctx.settings) };
          const content = contextText(ctx) + "\n\nTHE CURRENT MENU:\n" + current + "\n\n" + ask +
            "\nKeep every other meal exactly as it is and keep the leftover chain intact. Return in changedNights only the nights you changed, " +
            "in meals only those meals, plus the prep session, to-buy list and end leftovers for the whole week as it now stands.";
          // a saved recipe is THE recipe on that night, whatever id came back
          const pin = (d) => (recipe ? { ...d, meals: d.meals.map((m) => (m.night === night ? { ...m, recipeId: recipe.id } : m)) } : d);
          const check = (d) => { const c = checkChange(d, prev, { ...ctx, onlyNight: night || "" }); return c.ok ? { ok: true, data: pin(c.data) } : c; };
          const r = await askClaude(client, { ...params, content });
          const c = r.ok ? check(r.data) : r;
          if (!c.ok) out = c;
          else {
            const done = await settle(client, store, week, ctx, { data: c.data, turns: r.turns }, { params, content, check });
            await store.set(foodPlanKeyOf(week), JSON.stringify(applyChange(prev, done.data, ctx, FOOD_MODELS[job.action], done.flagged)));
            out = { ok: true, summary: c.data.summary };
          }
        }
      }
    } else out = { ok: false, error: "Unknown action." };
  } catch (e) {
    console.error("[food] " + job.action + " failed: " + ((e && e.message) || e));
    out = { ok: false, error: errorWords(e) };
  }
  await setJob(store, week, { status: out.ok ? "done" : "error", finishedAt: new Date().toISOString(),
    error: out.ok ? "" : out.error, summary: (out.ok && out.summary) || "" });
  return out;
}
