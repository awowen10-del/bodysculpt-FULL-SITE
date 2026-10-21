// v236 — the Food hub.
//
// The family's evening meals at the press of a button: meat and cupboard in, this week's
// situation set, "Create weekly menu" — then cooked, rated, and the taste profile learns.
//
// No real API calls. The planning logic (netlify/lib/food.js) runs with a fake Claude client that
// records what it was asked and streams canned answers; the store is the real kpi-store.js handler
// on a fake blob store; the weekly page is the real index.html + food.js in the test sandbox; and
// Chloe's page is food.html's own script run against a stubbed store.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { boot } = require("./lib/env.cjs");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const WEEK = "2026-10-19", NEXT = "2026-10-26";

function fakeStore() {
  const m = new Map(); const writes = [];
  return { _m: m, writes,
    async get(k, o) { const v = m.get(k); if (v === undefined) return null; return (o && o.type === "json") ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, v); writes.push([k, v]); }, async delete(k) { m.delete(k); },
    async list(o) { const p = (o && o.prefix) || ""; return { blobs: [...m.keys()].filter((k) => k.startsWith(p)).map((key) => ({ key })), directories: [] }; } };
}
async function kpiStore() {
  const src = read("netlify/functions/kpi-store.js");
  const tmp = path.join(os.tmpdir(), "kpi-store-v236-" + process.pid + "-" + Date.now() + ".mjs");
  fs.writeFileSync(tmp, src.replace(/^import \{ getStore \} from "@netlify\/blobs";$/m, "const getStore = () => globalThis.__fakeStore;"));
  const h = (await import("file://" + tmp)).default;
  fs.unlinkSync(tmp);
  return {
    POST: async (body) => (await h(new Request("https://x/.netlify/functions/kpi-store", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))).json(),
    GET: async (qs) => (await h(new Request("https://x/.netlify/functions/kpi-store?" + qs))).json(),
  };
}
// a fake Claude: records each request, streams each answer in small chunks, as the real one does
function fakeClient(answers) {
  const calls = [];
  return { calls, beta: { messages: { stream: (params) => {
    calls.push(params);
    const handlers = [];
    return {
      on(ev, fn) { if (ev === "text") handlers.push(fn); return this; },
      async finalMessage() {
        const a = answers.shift();
        if (a instanceof Error) throw a;
        if (a && a.stop_reason) return a;
        const text = typeof a === "string" ? a : JSON.stringify(a);
        for (let i = 0; i < text.length; i += 40) for (const h of handlers) h(text.slice(i, i + 40));
        return { stop_reason: "end_turn", content: [{ type: "text", text }] };
      },
    };
  } } } };
}
// the model's own protein figure is 45 — deliberately wrong: the server works it out from the
// ingredients (93 + 12 = 105g for the meal ÷ 3 adult servings = 35g)
const MACRO = { kcal: 600, protein: 45, carbs: 50, fat: 20 };
const ING = (protein) => [{ name: "steak mince", qty: "454g", have: true, protein: protein == null ? 93 : protein, topUp: false },
  { name: "potatoes", qty: "600g", have: false, protein: 12, topUp: false }];
function meal(night, name, extra) {
  return Object.assign({ night, name, summary: "Easy and mild", meat: { inventoryId: "", name: "steak mince", amount: "227g" }, minutes: 30,
    dumpBag: false, perAdult: MACRO, usesUp: [], ingredients: ING(),
    method: ["Cook it", "Serve it"], slowCooker: { low: "7-8 hours", high: "4 hours" }, proteinTopUps: [], recipeId: "",
    kidTip: "Sauce on the side", consumes: [], leftovers: [] }, extra || {});
}

(async () => {
  const lib = await import("file://" + path.join(ROOT, "netlify/lib/food.js"));
  const store = fakeStore();
  globalThis.__fakeStore = store;
  const K = await kpiStore();

  /* =====================================================================
     1. ONE PLACE FOR THE MODELS AND HOW HARD THEY THINK; THE KEYS AGREE
     ===================================================================== */
  {
    assert.deepStrictEqual({ ...lib.FOOD_MODELS }, { readPhoto: "claude-haiku-5-5", createMenu: "claude-opus-5-5", swapMeal: "claude-opus-5-5", changeMenu: "claude-opus-5-5",
      useRecipe: "claude-opus-5-5", readCupboard: "claude-sonnet-5-5" }, "the model strings live in FOOD_MODELS");
    assert.deepStrictEqual({ ...lib.FOOD_EFFORT }, { readPhoto: "low", createMenu: "high", swapMeal: "high", changeMenu: "high", useRecipe: "high", readCupboard: "low" },
      "…and how hard each job thinks in FOOD_EFFORT");
    assert.strictEqual((read("netlify/lib/food.js").match(/"claude-[a-z0-9-]+"/g) || []).length, 6, "…named nowhere else in the food lib");
    for (const f of ["netlify/functions/food.js", "netlify/functions/food-background.js", "food.js", "food.html"]) {
      assert.ok(!/"claude-[a-z0-9-]+"/.test(read(f)), f + " names no model of its own");
    }
    const kpi = read("netlify/functions/kpi-store.js");
    for (const [name, val] of [["FOOD_PLAN_PREFIX", lib.FOOD_PLAN_PREFIX], ["FOOD_SETTINGS_KEY", lib.FOOD_SETTINGS_KEY], ["FOOD_PRODUCTS_KEY", lib.FOOD_PRODUCTS_KEY],
      ["FOOD_TASTE_KEY", lib.FOOD_TASTE_KEY], ["FOOD_INVENTORY_KEY", lib.FOOD_INVENTORY_KEY], ["FOOD_RECIPES_KEY", lib.FOOD_RECIPES_KEY]]) {
      assert.ok(kpi.includes("const " + name + " = " + JSON.stringify(val) + ";"), "kpi-store's " + name + " matches the food lib");
    }
    const listOf = (name) => new Function("return " + new RegExp("const " + name + " = (\\[[\\s\\S]*?\\]);").exec(kpi)[1])();
    assert.deepStrictEqual(listOf("FOOD_DEFAULT_SPICES"), lib.DEFAULT_SPICES, "…the pre-filled spices are the same list");
    assert.deepStrictEqual(listOf("FOOD_DEFAULT_STAPLES"), lib.DEFAULT_STAPLES, "…and the staples");
    assert.ok(lib.DEFAULT_SPICES.includes("Korean seasoning (Rub Me Seoul Food)") && lib.DEFAULT_STAPLES.includes("black pepper"), "the lists are Ash's");
    assert.deepStrictEqual(new Function("return " + /const FOOD_PROTEIN_DEFAULTS = (\{[^}]*\});/.exec(kpi)[1])(), { ...lib.PROTEIN_DEFAULTS }, "…and the protein defaults");
    assert.deepStrictEqual({ ...lib.PROTEIN_DEFAULTS }, { proteinMin: 30, proteinMax: 40, servings: 3 }, "30-40g per adult serving, 3 adult servings, by default");
  }

  /* =====================================================================
     2. INVENTORY, SETTINGS, PRODUCTS, TASTE: STORED ONCE, THE SAME IN EVERY WEEK
     ===================================================================== */
  let inv;
  {
    inv = (await K.GET("foodinventory=1")).inventory;
    assert.ok(inv.items.some((i) => i.name === "Knorr Aromat" && i.category === "spices") && inv.items.some((i) => i.name === "stock cubes" && i.category === "staples"),
      "the inventory starts with the cupboard spices and staples");
    const r = await K.POST({ foodInventory: { op: "add", items: [
      { name: "steak mince", qty: 454, unit: "g", category: "meat", storage: "fridge" },
      { name: "chicken fillets", qty: 8, unit: "count", category: "meat", storage: "freezer" },
      { name: "half a cucumber", qty: 1, unit: "count", category: "fresh", storage: "fridge", opened: "2026-10-18" },
      { name: "odd thing", qty: -5, unit: "barrels", category: "weapons", storage: "moon" } ] } });
    inv = r.inventory;
    const odd = inv.items.find((i) => i.name === "odd thing");
    assert.ok(odd && odd.qty === 0 && odd.unit === "count" && odd.category === "fresh" && odd.storage === "fridge", "inventory items are cleaned: unknown units, categories and places fall back safely");
    await K.POST({ foodInventory: { op: "remove", id: odd.id } });
    await K.POST({ foodSettings: { kidsNotes: "Polly won't eat anything green. Artie loves wraps.", people: 4, rules: "- Always mild.\n- Wraps on Fridays." } });
    await K.POST({ foodProduct: { name: "Potatoes", productName: "Tesco White Potatoes", packSize: "2.5kg", productUrl: "https://www.tesco.com/groceries/en-GB/products/1", lastPrice: 1.45, confirmed: true } });
    assert.ok((await K.GET("foodinventory=1")).inventory.items.some((i) => i.name === "steak mince"), "the inventory persists");
    assert.strictEqual((await K.GET("foodsettings=1")).settings.kidsNotes, "Polly won't eat anything green. Artie loves wraps.", "settings persist");
    assert.strictEqual((await K.GET("foodproducts=1")).products.potatoes.packSize, "2.5kg", "product memory persists, by ingredient");
    assert.ok([...store._m.keys()].every((k) => !/^food-(inventory|settings|products|taste)-/.test(k)), "none of them is keyed by week — the same in every week");
    inv = (await K.GET("foodinventory=1")).inventory;
  }
  const mince = inv.items.find((i) => i.name === "steak mince"), chicken = inv.items.find((i) => i.name === "chicken fillets");
  const aromat = inv.items.find((i) => i.name === "Knorr Aromat");

  /* =====================================================================
     3. THE SITUATION AND THE NIGHT TYPES REACH THE REQUEST — WITH EVERYTHING ELSE
     ===================================================================== */
  const schedule = { mon: "family", tue: "solo", wed: "busy", thu: "none", fri: "family", sat: "none", sun: "none" };
  const goodMenu = () => ({
    meals: [
      meal("mon", "Cheesy beef pasta bake", { meat: { inventoryId: mince.id, name: "steak mince", amount: "454g" },
        consumes: [{ inventoryId: mince.id, qty: 454 }, { inventoryId: aromat.id, qty: 1 }],
        leftovers: [{ name: "potatoes", qty: 600, unit: "g", category: "fresh", storage: "fridge" }] }),
      meal("tue", "Slow cooker chicken curry", { dumpBag: true, minutes: 360, meat: { inventoryId: chicken.id, name: "chicken fillets", amount: "4" },
        consumes: [{ inventoryId: chicken.id, qty: 4 }], usesUp: ["half a cucumber"] }),
      meal("wed", "15-minute chicken wraps", { minutes: 15, meat: { inventoryId: chicken.id, name: "chicken fillets", amount: "4" }, consumes: [{ inventoryId: chicken.id, qty: 4 }] }),
      meal("fri", "Potato hash", { usesUp: ["potatoes"] }),
    ],
    prepSession: { bags: [{ night: "tue", name: "Chicken curry", contents: ["4 chicken fillets, diced", "1 tin chopped tomatoes"], label: "TUE — curry — 6h low",
      storage: "freezer", morningOf: "Tip into the slow cooker frozen, 6 hours on low." }], steps: ["Lay out 1 bag", "Fill, label, freeze"] },
    toBuy: [
      { name: "Potatoes", qty: "2.5kg bag", aisle: "Fruit & veg", nights: ["mon", "fri"], leftover: "about 1.3kg", estPrice: 1.5, proteinTopUp: false },
      { name: "Red peppers", qty: "pack of 3", aisle: "Fruit & veg", nights: ["wed"], leftover: "none", estPrice: 1.2, proteinTopUp: false },
      { name: "Olive oil", qty: "1 bottle", aisle: "Oils", nights: ["mon"], leftover: "", estPrice: 4, proteinTopUp: false },
      { name: "Salt", qty: "1", aisle: "Cupboard", nights: [], leftover: "", estPrice: 0.5, proteinTopUp: false },
      { name: "Plain flour (1kg)", qty: "1", aisle: "Baking", nights: [], leftover: "", estPrice: 0.9, proteinTopUp: false },
      { name: "Black pepper", qty: "1", aisle: "Cupboard", nights: [], leftover: "", estPrice: 1, proteinTopUp: false },
      { name: "Salted butter", qty: "250g", aisle: "Dairy", nights: ["fri"], leftover: "150g", estPrice: 1.9, proteinTopUp: false } ],
    endLeftovers: ["about 1.3kg potatoes"],
  });
  {
    const c = fakeClient([goodMenu()]);
    const out = await lib.runJob(store, c, { id: "c1", action: "createMenu", weekEnding: WEEK,
      inputs: { schedule, situation: "Chloe's mum is over Saturday, 5 eating. Neli's not sleeping, keep it easy.", people: 4 } });
    assert.ok(out.ok, "the menu is made");
    const p = c.calls[0], ask = p.messages[0].content;
    assert.ok(/tue \(Tuesday 2026-10-20\): solo — Chloe solo/.test(ask) && /wed \(Wednesday 2026-10-21\): busy/.test(ask) && /thu \(Thursday 2026-10-22\): none — No cooking/.test(ask),
      "each night's type reaches the request, with its date");
    assert.ok(ask.includes("Chloe's mum is over Saturday, 5 eating. Neli's not sleeping, keep it easy."), "the situation text reaches the request");
    assert.ok(ask.includes("[" + mince.id + "] steak mince — 454g — fridge") && ask.includes("[" + chicken.id + "] chicken fillets — 8 (count) — freezer"),
      "the meat goes with its inventory ids, amounts and where it is");
    assert.ok(/half a cucumber[^\n]*opened 2026-10-18/.test(ask), "…the fridge, with when things were opened");
    assert.ok(/STAPLES \(always in the house — NEVER on the to-buy list\):\n[\s\S]*black pepper/.test(ask), "…the staples, marked never to buy");
    assert.ok(ask.includes("Polly won't eat anything green. Artie loves wraps."), "…the kids' notes");
    assert.ok(/potatoes: Tesco White Potatoes — pack size 2\.5kg — last price £1\.45/.test(ask), "…the linked products with their pack sizes");
    assert.ok(/FAVOURITES/.test(ask) && /NEVER AGAIN/.test(ask) && /DO NOT REPEAT/.test(ask), "…and the taste profile and recent weeks");
    assert.ok(p.system.includes("- Always mild.\n- Wraps on Fridays."), "Ash's own planning rules are sent, from settings");
    assert.ok(p.system.includes("solo: Ash is away in Warrington and Chloe cooks alone. ALWAYS a slow-cooker dump bag"), "…with what each night type means");
    assert.ok(/RECIPE QUALITY/.test(p.system) && /real, recognisable dish/.test(p.system) && /Never an invented combination/.test(p.system), "…the recipe quality rules");
    assert.ok(/slow cooker times for LOW and HIGH/.test(p.system) && /never cook from frozen/.test(p.system), "…dump bags: LOW and HIGH times, defrosted, never from frozen");
    assert.ok(/review each recipe as an experienced family cook would/.test(p.system), "…the quality check before returning");
    assert.ok(/PROTEIN \(top priority/.test(p.system) && /lean bacon medallions/.test(p.system) && /protein in grams for the quantity used/.test(p.system),
      "…the protein rules, the top-up order and protein per ingredient");
    assert.ok(/PROTEIN TARGET: 30-40g protein per ADULT serving, every meal\. Adult-equivalent servings: 3/.test(ask), "the protein target reaches the request");
    assert.ok(/RECIPE BOOK: empty so far/.test(ask), "…and the recipe book");
    assert.strictEqual(p.model, "claude-opus-5-5", "the menu uses Opus 5.5");
    assert.strictEqual(p.output_config.effort, "high", "…thinking hard");
    assert.ok(!("thinking" in p) && !/budget_tokens/.test(JSON.stringify(p)), "…with no thinking budget, which Opus 5.5 rejects");
    assert.strictEqual(p.output_config.format.type, "json_schema", "…and a JSON schema for every answer");
    assert.strictEqual(p.fallbacks, "default", "…and the refusal fallback on");
  }

  /* =====================================================================
     4. MEALS APPEAR AS THEY ARE WRITTEN — WITHOUT EVER TOUCHING THE SAVED MENU
     ===================================================================== */
  {
    await new Promise((r) => setTimeout(r, 10));   // the partial writes are fire-and-forget
    const partials = store.writes.filter(([k]) => k === "food-job-" + WEEK).map(([, v]) => (JSON.parse(v).partial || []).length);
    for (const n of [1, 2, 3, 4]) assert.ok(partials.includes(n), "the job record gains meal " + n + " as it is written (" + partials.join(",") + ")");
    const firstPlanWrite = store.writes.findIndex(([k]) => k === "food-plan-" + WEEK);
    const firstPartial = store.writes.findIndex(([k, v]) => k === "food-job-" + WEEK && (JSON.parse(v).partial || []).length === 1);
    assert.ok(firstPartial >= 0 && firstPlanWrite > firstPartial, "the menu itself is saved only after the meals have streamed");
    const half = '{"meals":[{"night":"mon","name":"A {not a brace} \\"quoted\\""},{"night":"tue","na';
    assert.deepStrictEqual(lib.mealsSoFar(half).map((m) => m.night), ["mon"], "a half-written meal is never shown");
    assert.ok(/\.on\("text"/.test(read("netlify/lib/food.js")) && /FH_POLL_MS = 2000/.test(read("food.js")), "the server streams; the page looks every 2 seconds");
  }

  /* =====================================================================
     5. THE STORED WEEK: dates, dump bags and their prep session, staples never bought
     ===================================================================== */
  let plan;
  {
    plan = (await K.GET("foodplan=" + WEEK)).plan;
    assert.deepStrictEqual(plan.meals.map((m) => [m.night, m.date, m.type]),
      [["mon", "2026-10-19", "family"], ["tue", "2026-10-20", "solo"], ["wed", "2026-10-21", "busy"], ["fri", "2026-10-23", "family"]],
      "meals are stored against their real dates and night types — and none on a no-cooking night");
    assert.ok(plan.meals.every((m) => m.method.length && m.kidTip && m.status === "planned"), "every meal keeps its detail");
    assert.ok(plan.meals.every((m) => m.perAdult.protein === 35 && m.perAdult.kcal === 600 && m.proteinFlag === ""),
      "protein per adult serving is worked out on the server from the ingredients (105g ÷ 3 = 35g) — not the model's 45");
    assert.deepStrictEqual(plan.proteinTarget, { min: 30, max: 40, servings: 3 }, "the week records the target it was planned against");
    assert.deepStrictEqual(plan.meals.find((m) => m.night === "tue").slowCooker, { low: "7-8 hours", high: "4 hours" }, "a dump bag keeps its LOW and HIGH times");
    assert.deepStrictEqual(plan.meals.find((m) => m.night === "mon").slowCooker, { low: "", high: "" }, "…a pan meal has none");
    assert.strictEqual(plan.prepSession.bags[0].nightBefore, lib.DEFROST_NIGHT_BEFORE, "a freezer bag always carries the defrost-overnight instruction — set by code");
    assert.ok(/fridge/.test(lib.DEFROST_NIGHT_BEFORE) && /Never slow cook from frozen/.test(lib.DEFROST_NIGHT_BEFORE), "…which says fridge overnight, never from frozen");
    assert.strictEqual(plan.situation, "Chloe's mum is over Saturday, 5 eating. Neli's not sleeping, keep it easy.", "the situation is kept with the week");
    assert.deepStrictEqual(plan.prepSession.bags.map((b) => b.night), ["tue"], "a dump bag night produces a prep session");
    assert.ok(plan.prepSession.bags[0].morningOf && plan.prepSession.bags[0].label && plan.prepSession.bags[0].contents.length, "…with what goes in, the label and the morning-of instruction");
    const names = plan.toBuy.map((b) => b.name);
    for (const staple of ["Olive oil", "Salt", "Plain flour (1kg)", "Black pepper"]) assert.ok(!names.includes(staple), staple + " never reaches the to-buy list");
    assert.ok(names.includes("Red peppers") && names.includes("Salted butter"), "…while things that merely sound like staples stay on it");
    const pot = plan.toBuy.find((b) => b.key === "potatoes");
    assert.ok(pot.confirmed && pot.productName === "Tesco White Potatoes" && pot.packSize === "2.5kg" && pot.productUrl, "a to-buy item carries its linked Tesco product");
  }

  /* =====================================================================
     6. CHANGE SOMETHING: ONLY WHAT WAS ASKED
     ===================================================================== */
  {
    const before = JSON.parse(store._m.get("food-plan-" + WEEK));
    const c = fakeClient([{ changedNights: ["wed"], meals: [meal("wed", "Turkey burgers, 15 minutes", { minutes: 15 })],
      prepSession: before.prepSession, toBuy: [{ name: "Burger buns", qty: "pack of 6", aisle: "Bakery", nights: ["wed"], leftover: "2 buns", estPrice: 0.8, proteinTopUp: false }],
      endLeftovers: ["2 buns"], summary: "Wednesday is turkey burgers now." }]);
    const out = await lib.runJob(store, c, { id: "ch", action: "changeMenu", weekEnding: WEEK, request: "Artie won't eat wraps this week, change Wednesday" });
    assert.ok(out.ok, "the change is made");
    const ask = c.calls[0].messages[0].content;
    assert.ok(ask.includes("Ash asks: \"Artie won't eat wraps this week, change Wednesday\"") && ask.includes("Apply ONLY that change") && ask.includes("Neli's not sleeping"),
      "the request says what to change — with the same full context as every other request");
    const after = JSON.parse(store._m.get("food-plan-" + WEEK));
    for (const n of ["mon", "tue", "fri"]) {
      assert.strictEqual(JSON.stringify(after.meals.find((m) => m.night === n)), JSON.stringify(before.meals.find((m) => m.night === n)), n + " is exactly as it was");
    }
    assert.strictEqual(after.meals.find((m) => m.night === "wed").name, "Turkey burgers, 15 minutes", "only Wednesday changed");
    assert.ok(after.toBuy.some((b) => b.name === "Burger buns"), "…and the to-buy list was refreshed");
    const saved = store._m.get("food-plan-" + WEEK);
    let bad = await lib.runJob(store, fakeClient([{ changedNights: ["thu"], meals: [meal("thu", "Sneaky")], prepSession: before.prepSession, toBuy: [], endLeftovers: [], summary: "" }]),
      { id: "x1", action: "changeMenu", weekEnding: WEEK, request: "anything" });
    assert.ok(!bad.ok && store._m.get("food-plan-" + WEEK) === saved, "a change to a night with no meal is refused, and nothing is saved");
    bad = await lib.runJob(store, fakeClient([{ changedNights: ["mon", "fri"], meals: [meal("mon", "A"), meal("fri", "B")], prepSession: before.prepSession, toBuy: [], endLeftovers: [], summary: "" }]),
      { id: "x2", action: "swapMeal", weekEnding: WEEK, night: "mon" });
    assert.ok(!bad.ok && store._m.get("food-plan-" + WEEK) === saved, "a swap that changes more than its own night is refused");
    plan = after;
  }

  /* =====================================================================
     7. INVALID ANSWERS ARE REJECTED, AND THE SAVED MENU IS NEVER OVERWRITTEN
     ===================================================================== */
  {
    const saved = store._m.get("food-plan-" + WEEK);
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const g = goodMenu;
    const cases = [
      ["the wrong shape", { meals: "lots" }],
      ["a missing cooking night", { ...g(), meals: g().meals.slice(0, 3) }],
      ["a meal on a no-cooking night", { ...g(), meals: [...g().meals, meal("thu", "Extra")] }],
      ["a Chloe-solo night without a dump bag", { ...g(), meals: g().meals.map((m) => (m.night === "tue" ? { ...m, dumpBag: false } : m)) }],
      ["a dump bag with no prep session", { ...g(), prepSession: { bags: [], steps: [] } }],
      ["using something not in the inventory", { ...g(), meals: g().meals.map((m) => (m.night === "mon" ? { ...m, consumes: [{ inventoryId: "i_ghost", qty: 1 }] } : m)) }],
      ["unreadable text", "not json at all"],
      ["a refusal", { stop_reason: "refusal", content: [] }],
      ["running out of room", { stop_reason: "max_tokens", content: [{ type: "text", text: "{\"meals\":[" }] }],
      ["a rate limit", Object.create(Anthropic.RateLimitError.prototype)],
    ];
    for (const [what, answer] of cases) {
      const out = await lib.runJob(store, fakeClient([answer]), { id: "bad", action: "createMenu", weekEnding: WEEK, inputs: { schedule, situation: "", people: 4 } });
      assert.strictEqual(out.ok, false, what + " is rejected");
      assert.strictEqual(store._m.get("food-plan-" + WEEK), saved, "…and the saved menu is untouched (" + what + ")");
      const job = JSON.parse(store._m.get("food-job-" + WEEK));
      assert.ok(job.status === "error" && job.id === "bad" && job.error, "…and the job says why, in words (" + what + ")");
    }
    assert.ok(/busy/i.test(JSON.parse(store._m.get("food-job-" + WEEK)).error), "a rate limit says Claude is busy");
  }

  /* =====================================================================
     8. COOKED: THE INVENTORY GOES DOWN, THE OPENED PACK GOES INTO THE FRIDGE — ONCE
     ===================================================================== */
  {
    const mon = plan.meals.find((m) => m.night === "mon");
    const r = await K.POST({ foodCooked: { weekEnding: WEEK, mealId: mon.id } });
    assert.ok(r.ok && r.plan.meals.find((m) => m.id === mon.id).status === "cooked", "Cooked marks the meal cooked");
    const items = r.inventory.items;
    assert.ok(!items.some((i) => i.id === mince.id), "the 454g of mince it used is gone from the inventory");
    assert.ok(items.some((i) => i.id === aromat.id), "…a spice it used is still there — spices and staples are not counted down");
    const pot = items.find((i) => i.name === "potatoes");
    assert.ok(pot && pot.qty === 600 && pot.unit === "g" && pot.storage === "fridge" && pot.opened === new Date().toISOString().slice(0, 10),
      "the 600g left of the bag goes into the fridge, opened today");
    const again = await K.POST({ foodCooked: { weekEnding: WEEK, mealId: mon.id } });
    assert.ok(again.already && (await K.GET("foodinventory=1")).inventory.items.filter((i) => i.name === "potatoes").length === 1, "cooking it twice changes nothing twice");
    const tue = plan.meals.find((m) => m.night === "tue");
    const sk = await K.POST({ foodSkipped: { weekEnding: WEEK, mealId: tue.id } });
    assert.ok(sk.plan.meals.find((m) => m.id === tue.id).status === "skipped" && sk.inventory.items.find((i) => i.id === chicken.id).qty === 8, "Skipped deducts nothing");
  }

  /* =====================================================================
     9. RATINGS BUILD THE TASTE PROFILE — AND THE NEXT MENU READS IT
     ===================================================================== */
  {
    const mon = plan.meals.find((m) => m.night === "mon"), fri = plan.meals.find((m) => m.night === "fri");
    let r = await K.POST({ foodRating: { weekEnding: WEEK, mealId: mon.id, polly: "up", artie: "up", adults: "up" } });
    assert.ok(r.ok && r.ratings.polly === "up", "a rating saves on its meal");
    await K.POST({ foodRating: { weekEnding: WEEK, mealId: fri.id, polly: "down", artie: "down", note: "neither touched it" } });
    r = await K.POST({ foodRating: { weekEnding: WEEK, mealId: fri.id, adults: "amazing" } });
    assert.strictEqual(r.ratings.adults, "", "a value that is not up / so / down is dropped");
    const taste = (await K.GET("foodtaste=1")).taste;
    assert.deepStrictEqual(taste.favourites, ["Cheesy beef pasta bake"], "both kids thumbs up = a favourite");
    assert.deepStrictEqual(taste.neverAgain, ["Potato hash"], "both kids thumbs down = never again");
    assert.ok(taste.notes.some((n) => n.meal === "Potato hash" && n.note === "neither touched it"), "every note is kept");
    const c = fakeClient(["{}"]);
    await lib.runJob(store, c, { id: "n1", action: "createMenu", weekEnding: NEXT, inputs: { schedule, situation: "", people: 4 } });
    const ask = c.calls[0].messages[0].content;
    assert.ok(/FAVOURITES[^\n]*Cheesy beef pasta bake/.test(ask) && /NEVER AGAIN[^\n]*Potato hash/.test(ask) && /Potato hash: neither touched it/.test(ask),
      "the next menu reads the favourites, never-again meals and notes");
    assert.ok(/DO NOT REPEAT[^\n]*Cheesy beef pasta bake/.test(ask) && /week of 2026-10-19: Cheesy beef pasta bake — Polly thumbs up, Artie thumbs up, the adults thumbs up/.test(ask),
      "…and the last weeks' meals with how they went");
  }

  /* =====================================================================
     10. COPY FOR CLAUDE — linked products named, the rest left to "best value"
     ===================================================================== */
  {
    await K.POST({ foodPlan: { weekEnding: WEEK, addBuy: { name: "Bananas", qty: "6" } } });
    const products = (await K.GET("foodproducts=1")).products;
    const toBuy = [{ key: "potatoes", name: "Potatoes", qty: "2.5kg bag", ticked: false }, { key: "bananas", name: "Bananas", qty: "6", ticked: false },
      { key: "milk", name: "Milk", qty: "4 pints", ticked: true }];
    const text = lib.copyForClaude(toBuy, products);
    assert.ok(text.startsWith("Please fill my Tesco basket with:\n"), "it reads as a message to Claude");
    assert.ok(text.includes("- Potatoes — Tesco White Potatoes — https://www.tesco.com/groceries/en-GB/products/1 — 2.5kg bag"), "a linked item carries its product name and link");
    assert.ok(text.includes("- Bananas — choose the best-value standard pack — 6"), "an unlinked item asks for the best-value standard pack");
    assert.ok(!text.includes("Milk"), "anything already ticked is left off");
    const fj = read("food.js");
    const fn = new Function(fj.slice(fj.indexOf("function fhClaudeText"), fj.indexOf("async function fhCopyForClaude")) + "; return fhClaudeText;")();
    assert.strictEqual(fn(toBuy, products), text, "the Copy for Claude button copies exactly that");
    const added = (await K.GET("foodplan=" + WEEK)).plan.toBuy.find((b) => b.key === "bananas");
    assert.ok(added && added.manual, "items can be added to the list by hand");
  }

  /* =====================================================================
     11. ITS OWN PAGE — Health & Fitness, in the side rail. Warrington nights pre-filled, the
         prep session shown. And the weekly dashboard is exactly what it was.
     ===================================================================== */
  {
    const weekPlan = JSON.parse(store._m.get("food-plan-" + WEEK));
    const H = read("health.html");
    // a small DOM: enough for the rail script, the week picker and the hub
    function page(onFetch, now) {
      const els = {}, fetched = [], posts = [];
      const cls = () => { const set = new Set(); return { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c), toggle: (c, on) => (on === undefined ? (set.has(c) ? set.delete(c) : set.add(c)) : on ? set.add(c) : set.delete(c)) }; };
      const el = (id) => (els[id] = els[id] || { id, innerHTML: "", textContent: "", hidden: false, value: "", classList: cls(), handlers: {},
        addEventListener(ev, fn) { this.handlers[ev] = fn; }, setAttribute() {}, getAttribute: () => "", focus() {} });
      const ctx = { console, Date: now, Math, JSON, Promise, String, Number, Object, Array, Set, Map, RegExp, Error, encodeURIComponent, setTimeout, clearTimeout,
        localStorage: { getItem: () => null, setItem() {} }, navigator: {}, window: {},
        document: { getElementById: el, querySelector: () => null, addEventListener() {}, documentElement: { classList: cls() }, body: { classList: cls(), appendChild() {} }, createElement: () => el("tmp") },
        fetch: async (u, o) => {
          fetched.push(u);
          const body = o && o.body ? JSON.parse(o.body) : null;
          if (body) posts.push(body);
          return { ok: true, status: 200, json: async () => onFetch(u, body) || {} };
        } };
      ctx.window = ctx;
      vm.createContext(ctx);
      vm.runInContext(read("food.js"), ctx);
      const scripts = [...H.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      for (const js of scripts) vm.runInContext(js, ctx);
      return { ctx, els, fetched, posts };
    }
    const answers = (u) => {
      if (/foodplan=/.test(u)) return { plan: /foodplan=2026-10-19/.test(u) ? weekPlan : null };
      if (/foodinventory=/.test(u)) return { inventory: { items: [] } };
      if (/foodsettings=/.test(u)) return { settings: { kidsNotes: "", people: 4, rules: "" } };
      if (/foodtaste=/.test(u)) return { taste: null };
      if (/foodproducts=/.test(u)) return { products: {} };
      if (/functions\/food\?job=/.test(u)) return { job: null };
      if (/functions\/food\?defaults=/.test(u)) return { rules: lib.DEFAULT_RULES };
      if (/weeklyplan=/.test(u)) return { plan: { weekEnding: "x", locations: { fri: "warrington" } } };
      if (/locationdefaults=/.test(u)) return { locations: { tue: "warrington", thu: "warrington", fri: "" } };
      return null;
    };
    // the page's clock, pinned to Wednesday 21 October 2026, so the test means the same thing every week
    const at = (iso) => { const t = new Date(iso).getTime(); return class extends Date { constructor(...a) { if (a.length) super(...a); else super(t); } static now() { return t; } }; };

    // this week: the menu that is already planned
    const pg = page(answers, at("2026-10-21T18:00:00"));
    await new Promise((r) => setTimeout(r, 30));
    let html = pg.els.fhHub.innerHTML;
    assert.strictEqual(pg.els.hfRange.textContent, "19 Oct – 25 Oct", "the page opens on this week, Monday to Sunday");
    assert.ok(pg.els.hfToday.hidden, "…with no 'This week' button while on this week");
    for (const part of ["Meat", "Cupboard &amp; fridge", "This week’s situation", "Create a new weekly menu", "This week’s menu", "Change something",
      "Prep session", "To buy", "Copy for Claude", "Settings — the kids, people, planning rules"]) {
      assert.ok(html.includes(part), "the hub shows: " + part);
    }
    assert.ok(/<b>Tuesday: Chicken curry<\/b>/.test(html) && /Tip into the slow cooker frozen/.test(html), "the prep session card lists the bags and the morning-of step");
    assert.ok(/<details class="fh-sec fh-settings">/.test(html), "settings are folded away by default");
    // v237: tonight first, the week as tiles, four numbers, then one tab at a time
    assert.ok(html.indexOf('class="fh-hero') >= 0 && html.indexOf('class="fh-hero') < html.indexOf('class="fh-tabs"'), "the page leads with a hero card, above the tabs");
    assert.strictEqual((html.match(/class="fh-tile /g) || []).length, 7, "the week is seven tiles");
    assert.strictEqual((html.match(/<button type="button" class="fh-stat[ "]/g) || []).length, 4, "four headline numbers");
    assert.deepStrictEqual([...html.matchAll(/role="tab" id="fht-([a-z]+)"/g)].map((m) => m[1]), ["menu", "shop", "kitchen", "plan", "book"], "five tabs");
    assert.ok(/id="fhp-menu" aria-labelledby="fht-menu">/.test(html) && /id="fhp-plan" aria-labelledby="fht-plan" hidden>/.test(html),
      "with a menu, the Menu tab shows and the others wait (drawn, hidden — nothing typed is lost)");
    assert.ok(/fhRing\(/.test(read("food.js")) && /role="img" aria-label="' \+ p \+ "g protein per adult serving/.test(read("food.js")), "protein shows as a ring, with words for a screen reader");
    assert.ok(pg.posts.every((p) => !p.weeklyPlan && !p.locationDefaults), "it never writes to the weekly plan");

    // next week: a fresh week — Warrington evenings (usual pattern, plus this week's override) start as Chloe solo
    pg.els.hfNext.handlers.click();
    await new Promise((r) => setTimeout(r, 30));
    html = pg.els.fhHub.innerHTML;
    assert.strictEqual(pg.els.hfRange.textContent, "26 Oct – 1 Nov", "the arrows move a week at a time");
    assert.ok(!pg.els.hfToday.hidden, "…and 'This week' comes back to take you home");
    const row = (d) => html.slice(html.indexOf('aria-label="' + d + '"'), html.indexOf("</span>", html.indexOf('aria-label="' + d + '"')));
    assert.ok(/aria-checked="true" class="on solo"/.test(row("Tue")) && /aria-checked="true" class="on solo"/.test(row("Thu")), "Ash's usual Warrington days start as Chloe solo");
    assert.ok(/aria-checked="true" class="on solo"/.test(row("Fri")), "…and so does a one-week Warrington override from the weekly plan");
    assert.ok(/aria-checked="true" class="on family"/.test(row("Mon")), "…and the rest as family nights");
    assert.ok(/Warrington on Tue, Thu, Fri — set to Chloe solo/.test(html), "…and it says so");
    assert.ok(pg.fetched.some((u) => /kpi-store\?weeklyplan=2026-10-26/.test(u)), "it reads the week it is showing");

    // the page itself: in the rail, the dashboard's dress, a link to Chloe's page, no business
    assert.ok(/<a href="\/health.html" class="sn-link active" title="Health &amp; Fitness">/.test(H), "Health & Fitness is its own page in the side rail");
    assert.ok(/<script src="\/food\.js"><\/script>/.test(H) && /<script src="\/focus-timer\.js"><\/script>/.test(H), "it loads the hub and the shared focus timer");
    assert.ok(/<a class="hf-link" href="\/food\.html"/.test(H), "it links to Chloe's page");
    const palette = (s) => s.slice(s.indexOf("  :root{\n    color-scheme:light;"), s.indexOf("\n  }\n", s.indexOf("  :root{\n    color-scheme:light;")));
    assert.strictEqual(palette(H), palette(read("index.html")), "it wears the dashboard's palette");
    assert.strictEqual((H.match(/<style>/g) || []).length, 1, "one stylesheet, opened once");
    for (const icon of new Set([...read("food.js").matchAll(/#(ic-[a-z-]+)/g)].map((m) => m[1]))) {
      assert.ok(H.includes('<symbol id="' + icon + '"'), "food.js's #" + icon + " is in the page's sprite");
    }
    assert.ok(!/\bwp[A-Z]\w*|copyText\(|renderWeeklyPlan/.test(read("food.js")), "food.js needs nothing from the weekly page");

    // the weekly dashboard: exactly what it was
    const W = read("index.html");
    assert.ok(!/food\.js|fhHub|fhHubHtml|Weekly food review|\.fh-/.test(W), "the weekly dashboard has nothing of the Food hub");
    assert.ok(/foodNotes: \{ edId:"wpWeekFoodEd",  label:"Intentions Around Food",/.test(W), "its food notes tab is back to Intentions Around Food");
    assert.ok(/notes:\s+\{ edId:"wpWeekNotesEd", label:"Notes \/ Brain Dump",/.test(W), "the Notes / Brain Dump tab is defined exactly as before");
    const b = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {}, notes: "brain dump", foodNotes: "ate too late on Tuesday" } } });
    await b.ctx.loadWeeklyPlan(WEEK);
    b.ctx.renderWeeklyPlan();
    b.posts.length = 0;
    b.ctx.__wpState.plan.foodNotes = "<!--wp:rich-->ate earlier this week";
    await b.ctx.wpSaveSection("foodNotes");
    const wk = b.posts.filter((p) => p.body && p.body.weeklyPlan).pop().body.weeklyPlan;
    assert.deepStrictEqual(Object.keys(wk).sort(), ["foodNotes", "weekEnding"], "the food notes still save on their own — nothing else rides with them");

    const fj = read("food.js");
    const parse = new Function(fj.slice(fj.indexOf("function fhParseLine"), fj.indexOf("async function fhInvSend")) + "; return fhParseLine;")();
    assert.deepStrictEqual(parse("454g steak mince"), { name: "steak mince", qty: 454, unit: "g" }, "the paste reads 454g steak mince");
    assert.deepStrictEqual(parse("8 x 228g chicken fillets"), { name: "8 chicken fillets", qty: 1824, unit: "g" }, "…8 x 228g chicken fillets");
    assert.deepStrictEqual(parse("1.2kg potatoes"), { name: "potatoes", qty: 1200, unit: "g" }, "…1.2kg potatoes");
    assert.deepStrictEqual(parse("4 turkey burgers"), { name: "turkey burgers", qty: 4, unit: "count" }, "…4 turkey burgers");
  }

  /* =====================================================================
     12. CHLOE'S PAGE: tonight, the list, the freezer — and nothing of the business
     ===================================================================== */
  {
    const F = read("food.html");
    const js = F.slice(F.lastIndexOf("<script>") + 8, F.lastIndexOf("</script>"));
    for (const bad of [/sidenav|sn-link|class="mobilebar"/, /href="\/(index|daily|monthly|quarterly|finances|ads|social|schedule|projects)\.html/,
      /weeklyplan|dailybriefs|stripe|slack|mentor|takings|monthlyplan|checkins|finance/i, /Revenue|KPI|Leads|CPA/]) {
      assert.ok(!bad.test(F), "Chloe's page has nothing of the business (" + bad + ")");
    }
    const gets = [...new Set([...js.matchAll(/STORE \+ "\?([a-z]+)=/g)].map((m) => m[1]))].sort();
    assert.deepStrictEqual(gets, ["foodinventory", "foodplan"], "it reads only the food plan (this week's, and next week's on a Sunday for tomorrow's bag) and the food inventory");
    assert.ok(/JSON\.stringify\(\{ foodPlan: \{ weekEnding: monday, ticks:/.test(js) && (js.match(/method: "POST"/g) || []).length === 1, "…and writes only a tick");
    const idx = read("index.html");
    const palette = (s) => s.slice(s.indexOf("  :root{\n    color-scheme:light;"), s.indexOf("\n  }\n", s.indexOf("  :root{\n    color-scheme:light;")));
    assert.strictEqual(palette(F), palette(idx), "it wears the dashboard's palette");
    const pad = (n) => String(n).padStart(2, "0"), d = new Date(), today = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    const els = {};
    const el = (id) => (els[id] = els[id] || { id, innerHTML: "", textContent: "", hidden: false, className: "", querySelectorAll: () => [] });
    const fetched = [];
    const fakePlan = { meals: [{ night: "tue", date: today, type: "solo", dumpBag: true, name: "Slow cooker chicken curry", summary: "Mild", minutes: 360,
      perAdult: MACRO, ingredients: [{ name: "chicken fillets", qty: "4", have: true }], method: ["Tip the bag in", "6 hours on low"], kidTip: "Rice on the side" }],
      prepSession: { bags: [{ night: "tue", morningOf: "Tip into the slow cooker frozen." }] },
      toBuy: [{ key: "potatoes", name: "Potatoes", qty: "2.5kg", aisle: "Fruit & veg", productName: "Tesco White Potatoes", packSize: "2.5kg" }] };
    const ctx = { document: { getElementById: el }, console, Date, Math, JSON, Promise, String, Number,
      fetch: async (u) => { fetched.push(u); return { ok: true, json: async () => (/foodplan/.test(u) ? { plan: fakePlan }
        : { inventory: { items: [{ name: "beef mince", qty: 500, unit: "g", storage: "freezer" }, { name: "milk", qty: 1, unit: "count", storage: "fridge" }] } }) }; } };
    vm.createContext(ctx);
    vm.runInContext(js, ctx);
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(/Slow cooker chicken curry/.test(els.tonight.innerHTML) && /6 hours on low/.test(els.tonight.innerHTML), "it shows tonight's meal and its method");
    assert.ok(/This morning:<\/b> Tip into the slow cooker frozen\./.test(els.tonight.innerHTML), "…with the morning-of step on a dump bag night");
    assert.ok(/Potatoes/.test(els.buy.innerHTML) && /type="checkbox"/.test(els.buy.innerHTML), "it shows the to-buy list with ticks");
    assert.ok(/beef mince/.test(els.freezer.innerHTML) && !/milk/.test(els.freezer.innerHTML), "it shows what is in the freezer, and only the freezer");
    assert.ok(/Chloe/.test(els.hello.textContent), "it is Chloe's");
    assert.ok(fetched.every((u) => /kpi-store\?(foodplan|foodinventory)=/.test(u)), "it fetched only the food plan and the inventory");
  }

  /* =====================================================================
     13. THE KEY STAYS ON THE SERVER; DAILY IS UNTOUCHED; THE BUILD SAYS SO
     ===================================================================== */
  {
    for (const f of ["index.html", "food.js", "food.html", "health.html", "daily.html", "focus-timer.js"]) {
      assert.ok(!/sk-ant-|x-api-key|api\.anthropic\.com|process\.env/.test(read(f)), f + " never holds, sends or calls with the API key");
    }
    for (const f of ["food.js", "food.html", "health.html", "index.html"]) assert.ok(!/ANTHROPIC_API_KEY/.test(read(f)), f + " does not even name it");
    for (const f of ["netlify/functions/food.js", "netlify/functions/food-background.js"]) assert.ok(/process\.env\.ANTHROPIC_API_KEY/.test(read(f)), f + " reads the key on the server");
    assert.ok(!/food\.js|fhHub|food-plan|FOOD_/.test(read("daily.html")), "the Daily page (where the Today view lives now) has nothing of the Food hub");
    assert.ok(/\[functions\."food"\]\s+timeout = 26/.test(read("netlify.toml")), "the photo reader gets the full 26 seconds");
    for (const f of ["index.html", "daily.html", "health.html"]) assert.ok(read(f).includes("build v240 · the-week-at-a-glance"), f + " is stamped health-and-fitness");
  }

  /* =====================================================================
     14. PROTEIN: worked out on the server, sent back ONCE, then flagged — and top-ups bought
     ===================================================================== */
  const W2 = "2026-11-02", W3 = "2026-11-09", W4 = "2026-11-16";
  const sched2 = { mon: "family", tue: "solo", wed: "none", thu: "none", fri: "none", sat: "none", sun: "none" };
  const menu2 = (tueProtein, extra) => ({
    meals: [meal("mon", "Spaghetti bolognese"), meal("tue", "Slow cooker beef chilli", { dumpBag: true, ingredients: ING(tueProtein) })],
    prepSession: { bags: [{ night: "tue", name: "Chilli", contents: ["mince", "beans"], label: "TUE chilli", storage: "freezer", morningOf: "Tip it in." }], steps: ["Bag it"] },
    toBuy: [], endLeftovers: [], ...(extra || {}) });
  {
    // Tuesday comes back at 60 + 12 = 72g ÷ 3 = 24g; sent back; comes back at 24g again → saved, and flagged
    const c = fakeClient([menu2(60), menu2(60)]);
    const out = await lib.runJob(store, c, { id: "p1", action: "createMenu", weekEnding: W2, inputs: { schedule: sched2, situation: "", people: 4 } });
    assert.ok(out.ok, "a menu still short after one send-back is saved, not thrown away");
    assert.strictEqual(c.calls.length, 2, "a meal below the target is sent back exactly once");
    const second = c.calls[1].messages;
    assert.strictEqual(second.length, 3, "…in the same conversation: the request, the first answer, the shortfall");
    assert.strictEqual(second[1].role, "assistant", "…the first answer passed back as Claude's own turn");
    assert.deepStrictEqual(second[1].content, [{ type: "text", text: JSON.stringify(menu2(60)) }], "…unchanged");
    assert.ok(/Tuesday is 24g per adult serving — top it up to at least 30g/.test(second[2].content), "…naming the meal and the shortfall in words");
    assert.ok(!/Monday is/.test(second[2].content), "…and only the meals that missed");
    const job = JSON.parse(store._m.get("food-job-" + W2));
    assert.ok(/Tuesday back for more protein/.test(job.stageNote), "the page is told what is happening while it goes back");
    const p = JSON.parse(store._m.get("food-plan-" + W2));
    const tue = p.meals.find((m) => m.night === "tue"), mon = p.meals.find((m) => m.night === "mon");
    assert.strictEqual(tue.perAdult.protein, 24, "Tuesday is saved at its real 24g");
    assert.strictEqual(tue.proteinFlag, "below", "…and flagged Below protein target");
    assert.strictEqual(mon.proteinFlag, "", "…while a meal on target is not flagged");

    // sent back and fixed → no flag, the fixed answer is the one saved
    const c2 = fakeClient([menu2(60), menu2(99)]);
    await lib.runJob(store, c2, { id: "p2", action: "createMenu", weekEnding: W2, inputs: { schedule: sched2, situation: "", people: 4 } });
    const p2 = JSON.parse(store._m.get("food-plan-" + W2));
    assert.ok(c2.calls.length === 2 && p2.meals.find((m) => m.night === "tue").perAdult.protein === 37 && p2.meals.every((m) => !m.proteinFlag),
      "a send-back that fixes it is saved, unflagged");

    // the send-back answers in the wrong shape → the first answer, flagged
    const c3 = fakeClient([menu2(60), { meals: "nope" }]);
    await lib.runJob(store, c3, { id: "p3", action: "createMenu", weekEnding: W2, inputs: { schedule: sched2, situation: "", people: 4 } });
    const p3 = JSON.parse(store._m.get("food-plan-" + W2));
    assert.strictEqual(p3.meals.find((m) => m.night === "tue").proteinFlag, "below", "a broken send-back keeps the first answer, flagged");

    // on target first time → no second call
    const c4 = fakeClient([menu2(93)]);
    await lib.runJob(store, c4, { id: "p4", action: "createMenu", weekEnding: W2, inputs: { schedule: sched2, situation: "", people: 4 } });
    assert.strictEqual(c4.calls.length, 1, "a menu on target is never sent back");

    // above the target counts too
    assert.deepStrictEqual(lib.proteinIssues([{ night: "mon", ingredients: [{ protein: 150 }] }], { min: 30, max: 40, servings: 3 }), [{ night: "mon", perAdult: 50 }],
      "a meal over the top of the range is outside the target too");
    assert.strictEqual(lib.proteinPerAdult([{ protein: 50 }, { protein: -20 }, { protein: "x" }, { protein: 10 }], 3), 20, "nonsense protein values count as nothing");
    assert.strictEqual(lib.proteinTarget({ proteinMin: 30, proteinMax: 40, servings: 3 }, 5).servings, 4, "a fifth person at the table counts as one more adult serving");

    // the settings reach the request
    await K.POST({ foodSettings: { kidsNotes: "Polly won't eat anything green. Artie loves wraps.", people: 4, rules: "- Always mild.\n- Wraps on Fridays.", proteinMin: 32, proteinMax: 45, servings: 3.5 } });
    const st = (await K.GET("foodsettings=1")).settings;
    assert.deepStrictEqual([st.proteinMin, st.proteinMax, st.servings], [32, 45, 3.5], "the protein settings are saved");
    const c5 = fakeClient(["{}"]);
    await lib.runJob(store, c5, { id: "p5", action: "createMenu", weekEnding: W3, inputs: { schedule: sched2, situation: "", people: 4 } });
    assert.ok(/PROTEIN TARGET: 32-45g protein per ADULT serving, every meal\. Adult-equivalent servings: 3\.5/.test(c5.calls[0].messages[0].content), "…and planned against");
    await K.POST({ foodSettings: { kidsNotes: "Polly won't eat anything green. Artie loves wraps.", people: 4, rules: "- Always mild.\n- Wraps on Fridays.", proteinMin: 30, proteinMax: 40, servings: 3 } });
  }
  {
    // top-ups: one the model listed without the flag, one it forgot to list at all
    const bacon = { name: "bacon medallions", qty: "4 rashers", have: false, protein: 30, topUp: true };
    const yog = { name: "Greek yoghurt", qty: "150g", have: false, protein: 15, topUp: true };
    const ans = menu2(93, { toBuy: [{ name: "Greek yoghurt (500g)", qty: "1 pot", aisle: "Dairy", nights: ["mon"], leftover: "350g", estPrice: 1.5, proteinTopUp: false }] });
    ans.meals[0] = meal("mon", "Spaghetti bolognese", { ingredients: [...ING(45), bacon, yog], proteinTopUps: ["bacon medallions", "Greek yoghurt"] });
    await lib.runJob(store, fakeClient([ans]), { id: "t1", action: "createMenu", weekEnding: W2, inputs: { schedule: sched2, situation: "", people: 4 } });
    const p = JSON.parse(store._m.get("food-plan-" + W2));
    const b = p.toBuy.find((x) => x.key === "bacon medallions"), y = p.toBuy.find((x) => /greek yoghurt/.test(x.key));
    assert.ok(b && b.proteinTopUp && b.aisle === "Protein top-ups" && b.nights.includes("mon"), "a protein top-up not in stock is put on the to-buy list, flagged as a top-up");
    assert.ok(y && y.proteinTopUp && y.aisle === "Dairy", "…and one already on the list is flagged as a top-up");
    assert.deepStrictEqual(p.meals[0].proteinTopUps, ["bacon medallions", "Greek yoghurt"], "the meal card names its top-ups");
    assert.strictEqual(p.meals[0].perAdult.protein, 34, "…and the top-ups count towards its protein (45 + 12 + 30 + 15 = 102 ÷ 3)");
    assert.ok(!p.toBuy.some((x) => x.key === "steak mince"), "an ingredient we have is never bought");
  }
  {
    // a dump bag without its slow cooker times is rejected
    const bad = menu2(93);
    bad.meals[1].slowCooker = { low: "", high: "" };
    const out = await lib.runJob(store, fakeClient([bad]), { id: "s1", action: "createMenu", weekEnding: W4, inputs: { schedule: sched2, situation: "", people: 4 } });
    assert.ok(!out.ok && /slow cooker times/.test(out.error), "a dump bag without LOW and HIGH times is rejected");
  }

  /* =====================================================================
     15. THE RECIPE BOOK: both kids' thumbs up (or Keep) saves it in full; it comes back exactly
     ===================================================================== */
  {
    let book = (await K.GET("foodrecipes=1")).book;
    const fav = book.recipes.find((r) => r.name === "Cheesy beef pasta bake");
    assert.ok(fav && fav.kidsLoved, "both kids' thumbs up put the meal in the recipe book");
    assert.deepStrictEqual(fav.method, ["Cook it", "Serve it"], "…saved in full: the method");
    assert.ok(fav.ingredients.some((i) => i.name === "steak mince" && i.protein === 93) && fav.perAdult && fav.ratings.polly === "up", "…ingredients with their protein, macros, ratings");
    assert.ok(!book.recipes.some((r) => r.name === "Potato hash"), "a meal the kids did not both love is not");

    // the planner brings it back: the book's recipe, exactly — whatever the model wrote
    const c = fakeClient([menu2(93, { meals: [meal("mon", "My own pasta bake", { recipeId: fav.id, method: ["Something new"], ingredients: ING(90) }),
      meal("tue", "Slow cooker beef chilli", { dumpBag: true })] })]);
    await lib.runJob(store, c, { id: "b1", action: "createMenu", weekEnding: W3, inputs: { schedule: sched2, situation: "", people: 4 } });
    assert.ok(c.calls[0].messages[0].content.includes("[" + fav.id + "] Cheesy beef pasta bake"), "the recipe book is in every request, by id");
    let p = JSON.parse(store._m.get("food-plan-" + W3));
    let mon = p.meals.find((m) => m.night === "mon");
    assert.strictEqual(mon.name, "Cheesy beef pasta bake", "a favourite comes back under its own name");
    assert.deepStrictEqual(mon.method, fav.method, "…with the saved method, exactly");
    assert.deepStrictEqual(mon.ingredients.map((i) => [i.name, i.qty]), fav.ingredients.map((i) => [i.name, i.qty]), "…and the saved ingredients");
    assert.strictEqual(mon.recipeId, fav.id, "…marked as from the book");
    assert.strictEqual(lib.scaleQty("454g", 1.5), "681g", "scaled when more are eating");

    // a so-so the next time it is cooked does not throw a favourite out
    await K.POST({ foodRating: { weekEnding: W3, mealId: mon.id, polly: "so", artie: "up" } });
    book = (await K.GET("foodrecipes=1")).book;
    const again = book.recipes.find((r) => r.id === fav.id);
    assert.ok(again && again.kidsLoved && again.ratings.polly === "so", "a favourite stays in the book when a later night goes less well — with how it went");
    assert.deepStrictEqual(again.method, fav.method, "…its saved method untouched");

    // ⭐ Keep — in the book whatever the kids said; un-starred, out again
    const tue = p.meals.find((m) => m.night === "tue");
    let r = await K.POST({ foodKeep: { weekEnding: W3, mealId: tue.id, keep: true } });
    assert.ok(r.book.recipes.some((x) => x.name === "Slow cooker beef chilli" && x.keep && x.dumpBag && x.slowCooker.low === "7-8 hours"), "Keep saves a meal to the book, in full");
    r = await K.POST({ foodKeep: { weekEnding: W3, mealId: tue.id, keep: false } });
    assert.ok(!r.book.recipes.some((x) => x.name === "Slow cooker beef chilli"), "…and un-keeping takes it out");

    // "Add to this week": a book recipe onto one night — that night only, exactly as saved
    const u = fakeClient([{ changedNights: ["tue"], meals: [meal("tue", "Whatever it says", { dumpBag: true, recipeId: "", method: ["nope"] })],
      prepSession: { bags: [{ night: "tue", name: "Bake", contents: ["x"], label: "TUE", storage: "freezer", morningOf: "Tip it in." }], steps: [] },
      toBuy: [], endLeftovers: [], summary: "Tuesday is the pasta bake." }]);
    const before = JSON.parse(store._m.get("food-plan-" + W3));
    const out = await lib.runJob(store, u, { id: "u1", action: "useRecipe", weekEnding: W3, night: "tue", recipeId: fav.id });
    assert.ok(out.ok, "a saved recipe is put into the week");
    assert.ok(u.calls[0].messages[0].content.includes("Put our saved recipe [" + fav.id + "] Cheesy beef pasta bake on tue"), "the request names the recipe and the night");
    p = JSON.parse(store._m.get("food-plan-" + W3));
    const t2 = p.meals.find((m) => m.night === "tue");
    assert.ok(t2.recipeId === fav.id && t2.name === "Cheesy beef pasta bake" && JSON.stringify(t2.method) === JSON.stringify(fav.method), "…exactly as saved, whatever came back");
    assert.strictEqual(JSON.stringify(p.meals.find((m) => m.night === "mon")), JSON.stringify(before.meals.find((m) => m.night === "mon")), "…and the other night untouched");
    const gone = await lib.runJob(store, fakeClient([]), { id: "u2", action: "useRecipe", weekEnding: W3, night: "tue", recipeId: "r_gone" });
    assert.ok(!gone.ok && /not in the book/.test(gone.error), "a recipe no longer in the book is refused");

    r = await K.POST({ foodRecipeRemove: { id: fav.id } });
    assert.ok(!r.book.recipes.some((x) => x.id === fav.id), "a recipe can be taken out of the book");

    // the page: protein first, the flag, the top-up line, Keep, the book
    const fj = read("food.js");
    assert.ok(/fhMacrosHtml\(pa, flag\) \{\s*return '<div class="fh-macros"><span class="fh-pro/.test(fj), "protein leads the macros on every card");
    assert.ok(/Below protein target/.test(fj) && /" for protein<\/div>"/.test(fj), "a card shows its flag and its '+ … for protein' line");
    assert.ok(/onclick="fhKeep\(/.test(fj) && /#ic-star/.test(fj) && /function fhBookHtml/.test(fj) && />Add to this week</.test(fj), "Keep on each card, and a recipe book with Add to this week");
    assert.ok(/proteinMin: Number\(v\("fhPMin"\)\), proteinMax: Number\(v\("fhPMax"\)\), servings: Number\(v\("fhServ"\)\)/.test(fj), "the protein settings can be changed");
  }

  /* =====================================================================
     16. CHLOE'S PAGE: the night before a frozen dump bag, move it to the fridge
     ===================================================================== */
  {
    const F = read("food.html");
    const js = F.slice(F.lastIndexOf("<script>") + 8, F.lastIndexOf("</script>"));
    const run = async (iso, plans) => {
      const els = {}, fetched = [];
      const el = (id) => (els[id] = els[id] || { id, innerHTML: "", textContent: "", hidden: false, className: "", querySelectorAll: () => [] });
      const t = new Date(iso).getTime();
      const D = class extends Date { constructor(...a) { if (a.length) super(...a); else super(t); } static now() { return t; } };
      const ctx = { document: { getElementById: el }, console, Date: D, Math, JSON, Promise, String, Number,
        fetch: async (u) => { fetched.push(u); const w = (/foodplan=([\d-]+)/.exec(u) || [])[1];
          return { ok: true, json: async () => (w ? { plan: plans[w] || null } : { inventory: { items: [] } }) }; } };
      vm.createContext(ctx);
      vm.runInContext(js, ctx);
      await new Promise((r) => setTimeout(r, 20));
      return { els, fetched };
    };
    const bagWeek = (date, night) => ({ meals: [{ night, date, type: "solo", dumpBag: true, name: "Beef chilli", perAdult: MACRO, ingredients: [], method: ["Tip in"],
      slowCooker: { low: "8 hours", high: "4 hours" } }], prepSession: { bags: [{ night, name: "Beef chilli", storage: "freezer", morningOf: "Tip it in." }] }, toBuy: [] });
    let r = await run("2026-10-20T19:00:00", { "2026-10-19": bagWeek("2026-10-21", "wed") });
    assert.ok(!r.els.tomorrow.hidden && /Before bed:<\/b> move tomorrow’s <b>Beef chilli<\/b> bag from the freezer to the fridge/.test(r.els.tomorrow.innerHTML) &&
      /Never slow cook it from frozen/.test(r.els.tomorrow.innerHTML), "the evening before a frozen dump bag, Chloe is told to move it to the fridge");
    r = await run("2026-10-25T19:00:00", { "2026-10-19": { meals: [], toBuy: [] }, "2026-10-26": bagWeek("2026-10-26", "mon") });
    assert.ok(r.fetched.some((u) => /foodplan=2026-10-26/.test(u)) && !r.els.tomorrow.hidden, "…on a Sunday too, from next week's plan");
    r = await run("2026-10-21T08:00:00", { "2026-10-19": bagWeek("2026-10-21", "wed") });
    assert.ok(/Slow cooker:<\/b> 8 hours on LOW, or 4 hours on HIGH/.test(r.els.tonight.innerHTML), "on the day, the slow cooker times");
    assert.ok(r.els.tomorrow.hidden, "…and no reminder when tomorrow has no frozen bag");
  }

  /* =====================================================================
     17. CUPBOARD PHOTOS (v238): snap the cupboard, check the list, add it
     ===================================================================== */
  {
    const c = fakeClient([{ items: [
      { name: "Smoked paprika", category: "spices", qty: 1, unit: "count", storage: "cupboard" },
      { name: "Tinned chopped tomatoes", category: "cupboard", qty: 4, unit: "count", storage: "cupboard" },
      { name: "smoked paprika", category: "spices", qty: 1, unit: "count", storage: "cupboard" },
      { name: "Soy sauce", category: "sauces", qty: 0, unit: "count", storage: "cupboard" },
      { name: "", category: "fresh", qty: 1, unit: "count", storage: "fridge" }], note: "" }]);
    const r = await lib.readCupboard(c, { jpegBase64: "AAAA" });
    assert.ok(r.ok, "a cupboard photo is read");
    assert.strictEqual(c.calls[0].model, "claude-sonnet-5-5", "…by Sonnet 5.5 — recognising every jar on a shelf needs more than reading a sign");
    assert.ok(c.calls[0].output_config.effort === "low" && c.calls[0].output_config.format.type === "json_schema", "…quickly, against a schema");
    assert.ok(/spices \(dried herbs, spices, seasoning blends\), staples \(only: oil, salt, black pepper, stock cubes, plain flour\)/.test(c.calls[0].system),
      "…told what each category means, staples kept to the never-buy list");
    assert.deepStrictEqual(r.items.map((i) => [i.name, i.category]), [["Smoked paprika", "spices"], ["Tinned chopped tomatoes", "cupboard"], ["Soy sauce", "sauces"]],
      "every item sorted into its category — the same thing twice, or a blank, only once or not at all");
    assert.strictEqual(r.items[2].qty, 1, "an uncounted jar counts as one");
    const bad = await lib.readCupboard(fakeClient([{ items: "lots" }]), { jpegBase64: "AAAA" });
    assert.ok(!bad.ok, "an answer in the wrong shape is refused");
    assert.ok(!(await lib.readCupboard(fakeClient([]), { jpegBase64: "" })).ok, "no photo, no call");

    const fn = read("netlify/functions/food.js");
    assert.ok(/body\.action === "readPhoto" \|\| body\.action === "readCupboard"/.test(fn), "the quick food function reads cupboard photos too, inside its 26 seconds");

    // the store takes a big cupboard in one go
    const many = Array.from({ length: 60 }, (_, i) => ({ name: "jar " + i, qty: 1, unit: "count", category: "cupboard", storage: "cupboard" }));
    const inv2 = (await K.POST({ foodInventory: { op: "add", items: many } })).inventory;
    assert.strictEqual(inv2.items.filter((i) => /^jar \d+$/.test(i.name)).length, 60, "sixty things from a few photos are all added");
    for (const it of inv2.items.filter((i) => /^jar \d+$/.test(i.name))) await K.POST({ foodInventory: { op: "remove", id: it.id } });

    // the page: several photos, read one by one, anything already in the kitchen left out, checked before adding
    const fj = read("food.js");
    assert.ok(/id="fhPantryPhoto" accept="image\/\*,\.heic,\.heif" multiple/.test(fj), "Read from photos takes several photos at once, iPhone HEIC included");
    assert.ok(/action: "readCupboard", jpegBase64: await fhToJpeg\(files\[n\]\)/.test(fj), "…each made a small JPEG and read in turn");
    assert.ok(/if \(have\.has\(k\)\) \{ skipped\+\+; continue; \}/.test(fj), "…leaving out what is already in the kitchen");
    assert.ok(/onclick="fhPantryAdd\(\)"/.test(fj) && /onchange="fhPantryEdit\(' \+ i \+ ',\\'category\\'/.test(fj), "…and nothing is added until checked, each category changeable");
    const key = new Function(fj.slice(fj.indexOf("function fhKey"), fj.indexOf("function fhPantryEdit")) + "; return fhKey;")();
    assert.strictEqual(key("Colman's Mustard Powder (100g)"), lib.productKey("Colman's Mustard Powder (100g)"), "the page matches names the way the server does");
  }

  console.log("v236-food-hub: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
