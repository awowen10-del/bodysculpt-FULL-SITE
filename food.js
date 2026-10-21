/* =====================================================================
   food.js — THE FOOD HUB  (v236)

   The family's evening meals at the press of a button: Ash and Chloe, and Polly and Artie
   (two young, VERY fussy eaters). Most weeks a meat box from the butcher. Minimal waste,
   healthier, cheaper, simple. Some nights Ash is in Warrington and Chloe cooks alone; busy or
   puppy weeks want slow-cooker dump bags. Tesco online.

   It lives on its own page, Health & Fitness (health.html) — not in the weekly dashboard,
   which it made far too long. Top to bottom:
     1 meat · 2 cupboard & fridge · 3 this week's situation · 4 Create weekly menu ·
     5 the menu (each meal shown as it is written) · 6 change something · 7 prep session ·
     8 to-buy list · 9 cooked + ratings (on each card) · 10 settings
   The weekly page's food notes ("Intentions Around Food") are untouched and separate.

   Its own file, needing nothing from any other page. It only DEFINES things at load; the
   page calls fhMount(hostId, week). Ash's Warrington days are READ (never written) from the
   weekly plan's locations, so a Warrington evening starts as Chloe solo.

   Data (kpi-store.js; additive keys): food-inventory (not per week), food-plan-<week>,
   food-settings, food-products, food-taste. The page writes only what Ash types, ticks and
   taps; the menu is written by the food functions after Claude's answer has passed every
   check. The AI key never reaches the browser.
   ===================================================================== */
const FH_STORE = "/.netlify/functions/kpi-store";
const FH_FN = "/.netlify/functions/food";
const FH_BG = "/.netlify/functions/food-background";
const FH_POLL_MS = 2000;
const FH_POLL_GIVE_UP_MS = 15 * 60 * 1000;
const FH_PHOTO_MAX = 1600;
const FH_HEIC_LIB = "https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js";
const FH_DAYS = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];
const FH_NIGHT = [["family", "Family"], ["solo", "Chloe solo"], ["busy", "Busy / puppy"], ["none", "No cooking"]];
const FH_CATS = [["fresh", "Fresh"], ["cupboard", "Cupboard"], ["sauces", "Sauces & condiments"], ["spices", "Spices & seasonings"], ["staples", "Staples"]];
const FH_RATERS = [["polly", "Polly"], ["artie", "Artie"], ["adults", "Us"]];

let fhState = { week: "", locations: {}, loading: false, plan: null, inventory: null, settings: null, taste: null, products: {}, defaults: null,
  book: { recipes: [] }, bookOpen: {}, bookFor: "",
  job: null, busy: "", error: "", note: "", open: {}, productFor: "", photoItems: null, pantryItems: null, photoStep: "", showPaste: false, confirmCreate: false, saveTimer: null };

const fhE = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fhMoney = (n) => "£" + (Number(n) || 0).toFixed(2);
const fhUid = () => "j" + Math.random().toString(36).slice(2, 10);
const fhToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const fhShortDate = (ymd) => { if (!ymd) return ""; const d = new Date(ymd + "T12:00:00"); return d.getDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]; };
const fhDateOf = (week, day) => { const d = new Date(week + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + FH_DAYS.findIndex((x) => x[0] === day)); return d.toISOString().slice(0, 10); };
const fhAmount = (i) => (i.unit === "count" ? (i.qty || 0) + "" : (i.qty || 0) + i.unit);
async function fhGet(url) { const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }
async function fhPost(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { j = null; }
  if (!r.ok && !(j && j.error)) throw new Error("HTTP " + r.status);
  return j || {};
}
function fhEmptyPlan(week) {
  return { weekEnding: week, schedule: {}, situation: "", people: 4, meals: [], prepSession: { bags: [], steps: [] }, toBuy: [], endLeftovers: [] };
}
// where Ash is on a day of this week — the weekly plan's one-week override first, else his usual pattern
function fhLocationOf(day) {
  const l = fhState.locations || {}, ov = l.week || {};
  return Object.prototype.hasOwnProperty.call(ov, day) ? (ov[day] || "") : ((l.usual || {})[day] || "");
}
// a fresh week: Ash's Warrington days are Chloe's solo nights, everything else a family night
function fhDefaultSchedule() {
  const s = {};
  for (const [d] of FH_DAYS) s[d] = fhLocationOf(d) === "warrington" ? "solo" : "family";
  return s;
}
async function fhCopyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const t = document.createElement("textarea"); t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
    t.remove(); return ok;
  }
}

/* ---------- loading the week ---------- */
function fhEnsure(week) {
  if (!week || fhState.week === week || fhState.loading === week) return;
  fhState = { ...fhState, week, locations: {}, loading: week, plan: null, job: null, busy: "", error: "", note: "", open: {}, productFor: "",
    photoItems: null, pantryItems: null, photoStep: "", showPaste: false, confirmCreate: false };
  Promise.all([
    fhGet(FH_STORE + "?foodplan=" + encodeURIComponent(week)).catch(() => ({ plan: null })),
    fhGet(FH_STORE + "?foodinventory=1").catch(() => ({ inventory: { items: [] } })),
    fhGet(FH_STORE + "?foodsettings=1").catch(() => ({ settings: null })),
    fhGet(FH_STORE + "?foodtaste=1").catch(() => ({ taste: null })),
    fhGet(FH_STORE + "?foodproducts=1").catch(() => ({ products: {} })),
    fhGet(FH_FN + "?job=" + encodeURIComponent(week)).catch(() => ({ job: null })),
    fhState.defaults ? Promise.resolve(fhState.defaults) : fhGet(FH_FN + "?defaults=1").catch(() => null),
    fhGet(FH_STORE + "?weeklyplan=" + encodeURIComponent(week)).catch(() => null),
    fhGet(FH_STORE + "?locationdefaults=1").catch(() => null),
    fhGet(FH_STORE + "?foodrecipes=1").catch(() => null),
  ]).then(([p, inv, s, t, pr, j, defs, wk, usual, rb]) => {
    if (fhState.week !== week) return;
    fhState.loading = false;
    fhState.locations = { week: (wk && wk.plan && wk.plan.locations) || {}, usual: (usual && usual.locations) || {} };
    fhState.settings = (s && s.settings) || { kidsNotes: "", people: 4, rules: "" };
    fhState.plan = (p && p.plan) || fhEmptyPlan(week);
    if (!fhState.plan.schedule || !Object.keys(fhState.plan.schedule).length) fhState.plan.schedule = fhDefaultSchedule();
    if (!(p && p.plan)) fhState.plan.people = fhState.settings.people || 4;
    fhState.inventory = (inv && inv.inventory) || { items: [] };
    fhState.taste = (t && t.taste) || null;
    fhState.products = (pr && pr.products) || {};
    fhState.book = (rb && rb.book) || { recipes: [] };
    fhState.job = (j && j.job) || null;
    fhState.defaults = defs || fhState.defaults;
    const jb = fhState.job;
    if (jb && jb.status === "running" && Date.now() - Date.parse(jb.startedAt || 0) < FH_POLL_GIVE_UP_MS) {
      fhState.busy = jb.action || "createMenu";
      fhPoll(week, jb.id, Date.now());
    }
    fhRender();
  });
}
function fhRender() { const host = document.getElementById("fhHub"); if (host) host.innerHTML = fhInnerHtml(); }
// the page's one call: draw the hub for a week (a Monday, YYYY-MM-DD) into the element with this id
function fhMount(hostId, week) {
  const host = document.getElementById(hostId);
  if (!host) return;
  host.classList.add("fh"); host.id = "fhHub";
  fhEnsure(week);
  fhRender();
}

/* ---------- the hub ----------
   v237 design pass — Ash: "a lot of text and I'm not excited to be on here". So the page leads
   with what matters tonight, the week at a glance, four numbers, and then ONE tab at a time:
     hero (tonight, or what's next) · four numbers · the week strip ·
     tabs: Menu · Shopping · Kitchen · Plan the week · Recipe book
   Every tab is drawn (hidden when not chosen), so nothing typed is lost switching tabs. */
const FH_TABS = [["menu", "Menu", "ic-utensils"], ["shop", "Shopping", "ic-cart"], ["kitchen", "Kitchen", "ic-fridge"],
  ["plan", "Plan the week", "ic-calendar"], ["book", "Recipe book", "ic-book"]];
const FH_TYPE_ICON = { family: "ic-users", solo: "ic-pot", busy: "ic-bolt", none: "ic-moon" };
function fhTabNow() {
  if (fhState.busy === "createMenu") return "menu";
  return fhState.tab || ((fhState.plan.meals || []).length ? "menu" : "plan");
}
function fhSetTab(t) { fhState.tab = t; fhRender(); }
// open a meal on the Menu tab and bring it into view
function fhGoMeal(id) {
  fhState.tab = "menu"; fhState.open[id] = true; fhRender();
  setTimeout(() => { const el = document.getElementById("fhm-" + id); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 30);
}
function fhInnerHtml() {
  if (fhState.loading || !fhState.plan) return '<div class="fh-loading">Loading this week’s food…</div>';
  const jobNote = fhState.busy && fhState.job && fhState.job.status === "running" && fhState.job.stageNote;
  const working = jobNote || { createMenu: "Writing this week’s menu — meals appear below as each one is written…", swapMeal: "Swapping that meal…",
    changeMenu: "Making that change…", useRecipe: "Putting that recipe into the week…", photo: "Reading the sign…", pantry: fhState.photoStep || "Reading the photo…" }[fhState.busy] || "";
  const tab = fhTabNow();
  const panel = (key, html) => '<div class="fh-panel" role="tabpanel" id="fhp-' + key + '" aria-labelledby="fht-' + key + '"' + (tab === key ? "" : " hidden") + ">" + html + "</div>";
  return (fhState.error ? '<div class="fh-msg bad" role="alert">' + fhE(fhState.error) + "</div>" : "") +
    (working ? '<div class="fh-msg busy" role="status"><span class="fh-spin"></span>' + fhE(working) + "</div>" : "") +
    (fhState.note ? '<div class="fh-msg ok" role="status">' + fhE(fhState.note) + "</div>" : "") +
    '<div class="fh-top">' + fhHeroHtml() + fhStatsHtml() + "</div>" +
    fhStripHtml() +
    fhTabsHtml(tab) +
    panel("menu", fhMenuHtml() + fhPrepHtml()) +
    panel("shop", fhBuyHtml() || fhEmptyHtml("ic-cart", "Nothing to buy yet", "The shopping list writes itself with the menu — whole Tesco packs, by aisle.")) +
    panel("kitchen", fhMeatHtml() + fhPantryHtml()) +
    panel("plan", fhSituationHtml() +
      '<button type="button" class="fh-create" onclick="fhCreateClick()"' + (fhState.busy ? " disabled" : "") + ">" +
      '<svg class="ic"><use href="#ic-sparkle"/></svg>' +
      (fhState.confirmCreate ? "Replace this week’s menu?" : (fhState.plan.meals || []).length ? "Create a new weekly menu" : "Create weekly menu") + "</button>" +
      fhSettingsHtml()) +
    panel("book", fhBookHtml());
}
function fhEmptyHtml(icon, title, words, btn) {
  return '<div class="fh-empty"><span class="fh-empty-ic"><svg class="ic"><use href="#' + icon + '"/></svg></span><b>' + title + "</b><p>" + words + "</p>" + (btn || "") + "</div>";
}
// a ring that fills to the protein target: green inside the range, amber outside it
function fhRing(protein, t, flag, size) {
  const p = Math.round(Number(protein) || 0), sz = size || 76, r = sz / 2 - 6, c = 2 * Math.PI * r;
  const fill = Math.max(0, Math.min(1, p / (t.min || 30)));
  const off = flag || p < t.min || p > t.max;
  return '<span class="fh-ring' + (off ? " off" : "") + '" style="width:' + sz + "px;height:" + sz + 'px" role="img" aria-label="' + p + "g protein per adult serving, target " + t.min + " to " + t.max + 'g">' +
    '<svg viewBox="0 0 ' + sz + " " + sz + '" aria-hidden="true"><circle class="trk" cx="' + sz / 2 + '" cy="' + sz / 2 + '" r="' + r + '"/>' +
    '<circle class="val" cx="' + sz / 2 + '" cy="' + sz / 2 + '" r="' + r + '" stroke-dasharray="' + (c * fill).toFixed(1) + " " + c.toFixed(1) + '" transform="rotate(-90 ' + sz / 2 + " " + sz / 2 + ')"/></svg>' +
    "<span><b>" + p + "g</b><small>protein</small></span></span>";
}
/* the hero: tonight's meal — or what's next, or the way in when there is no menu yet */
function fhHeroHtml() {
  const p = fhState.plan, meals = p.meals || [], today = fhToday(), t = p.proteinTarget || fhTarget();
  if (fhState.busy === "createMenu") {
    return '<section class="fh-hero"><div class="fh-hero-main"><div class="fh-eyebrow">This week</div><div class="fh-hero-name">Writing your menu…</div>' +
      '<p class="fh-hero-sum">Each evening appears in the Menu tab the moment it’s written.</p></div><span class="fh-hero-art"><svg class="ic"><use href="#ic-utensils"/></svg></span></section>';
  }
  if (!meals.length) {
    return '<section class="fh-hero"><div class="fh-hero-main"><div class="fh-eyebrow">This week</div><div class="fh-hero-name">No menu yet</div>' +
      '<p class="fh-hero-sum">Set the week’s evenings, then one tap writes every meal — and the shopping list.</p>' +
      '<div class="fh-hero-acts"><button type="button" class="fh-b go" onclick="fhSetTab(\'plan\')">Plan this week</button></div></div>' +
      '<span class="fh-hero-art"><svg class="ic"><use href="#ic-utensils"/></svg></span></section>';
  }
  const tonight = meals.find((m) => m.date === today);
  const show = tonight || meals.filter((m) => m.date > today && m.status !== "skipped")[0];
  if (!show) {
    return '<section class="fh-hero"><div class="fh-hero-main"><div class="fh-eyebrow">This week</div><div class="fh-hero-name">That’s the week done</div>' +
      '<p class="fh-hero-sum">Rate anything you haven’t yet — it shapes next week’s menu.</p></div><span class="fh-hero-art"><svg class="ic"><use href="#ic-check"/></svg></span></section>';
  }
  const bag = ((p.prepSession || {}).bags || []).find((b) => b.night === show.night);
  // tomorrow's frozen dump bag goes in the fridge tonight
  const tmr = (() => { const d = new Date(today + "T12:00:00"); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
  const tm = meals.find((m) => m.date === tmr && m.dumpBag);
  const tbag = tm && ((p.prepSession || {}).bags || []).find((b) => b.night === tm.night && b.storage !== "fridge");
  return '<section class="fh-hero t-' + fhE(show.type) + '"><div class="fh-hero-main">' +
      '<div class="fh-eyebrow">' + (tonight ? "Tonight" : "Next up · " + fhDayLabel(show.night)) + "</div>" +
      '<div class="fh-hero-name">' + fhE(show.name) + "</div>" +
      '<p class="fh-hero-sum">' + fhE(show.summary) + "</p>" +
      '<div class="fh-chips">' + fhTypeChip(show.type) + (show.dumpBag ? '<span class="fh-chip bag"><svg class="ic"><use href="#ic-pot"/></svg>Dump bag</span>' : "") +
        (show.minutes ? '<span class="fh-chip"><svg class="ic"><use href="#ic-clock"/></svg>' + fhMins(show.minutes) + "</span>" : "") +
        (show.status === "cooked" ? '<span class="fh-chip done"><svg class="ic"><use href="#ic-check"/></svg>Cooked</span>' : "") + "</div>" +
      (tonight && bag && bag.morningOf ? '<div class="fh-hero-note"><b>This morning:</b> ' + fhE(bag.morningOf) + "</div>" : "") +
      (tbag ? '<div class="fh-hero-note warn"><b>Before bed:</b> move tomorrow’s ' + fhE(tbag.name || tm.name) + " bag from the freezer to the fridge.</div>" : "") +
      '<div class="fh-hero-acts"><button type="button" class="fh-b go" onclick="fhGoMeal(\'' + show.id + '\')">See the recipe</button>' +
        (tonight && (!show.status || show.status === "planned") ? '<button type="button" class="fh-b" onclick="fhCooked(\'' + show.id + '\')"><svg class="ic"><use href="#ic-check"/></svg>Cooked it</button>' : "") +
      "</div></div>" + fhRing((show.perAdult || {}).protein, t, show.proteinFlag, 96) + "</section>";
}
function fhMins(n) { return n >= 120 ? Math.round(n / 60) + " hrs" : n + " min"; }
function fhTypeChip(type) {
  return '<span class="fh-chip t-' + fhE(type || "family") + '"><svg class="ic"><use href="#' + (FH_TYPE_ICON[type] || "ic-users") + '"/></svg>' + fhE(fhTypeLabel(type)) + "</span>";
}
/* four numbers: protein, cooked, shopping, meat — each one a door to its tab */
function fhStatsHtml() {
  const p = fhState.plan, meals = p.meals || [], t = p.proteinTarget || fhTarget();
  const onT = meals.filter((m) => { const v = (m.perAdult || {}).protein || 0; return v >= t.min && v <= t.max; }).length;
  const cooked = meals.filter((m) => m.status === "cooked").length;
  const buy = (p.toBuy || []).filter((b) => !b.ticked);
  let est = 0;
  for (const b of buy) { const pr = fhState.products[b.key]; est += pr && pr.lastPrice ? pr.lastPrice : (Number(b.estPrice) || 0); }
  const meat = fhItems("meat").length;
  const tile = (tab, icon, big, small, tone) => '<button type="button" class="fh-stat' + (tone ? " " + tone : "") + '" onclick="fhSetTab(\'' + tab + '\')">' +
    '<span class="fh-stat-ic"><svg class="ic"><use href="#' + icon + '"/></svg></span><b>' + big + "</b><small>" + small + "</small></button>";
  return '<div class="fh-stats">' +
    tile("menu", "ic-target", meals.length ? onT + "/" + meals.length : "–", "meals on protein target", meals.length && onT < meals.length ? "warn" : "good") +
    tile("menu", "ic-check", meals.length ? cooked + "/" + meals.length : "–", "cooked this week", "") +
    tile("shop", "ic-cart", buy.length ? String(buy.length) : "0", buy.length ? "to buy · about " + fhMoney(est) : "nothing to buy", "") +
    tile("kitchen", "ic-fridge", String(meat), meat === 1 ? "meat in stock" : "meats in stock", "") + "</div>";
}
/* the week at a glance: seven tiles, today ringed; tap one to open its meal */
function fhStripHtml() {
  const p = fhState.plan, meals = p.meals || [], today = fhToday(), s = p.schedule || {}, t = p.proteinTarget || fhTarget();
  const drafts = fhState.busy === "createMenu" && fhState.job && Array.isArray(fhState.job.partial) ? fhState.job.partial : [];
  return '<div class="fh-strip" role="list" aria-label="The week">' + FH_DAYS.map(([d, l]) => {
    const date = fhDateOf(fhState.week, d), type = s[d] || "family";
    const m = fhState.busy === "createMenu" ? drafts.find((x) => x.night === d) : meals.find((x) => x.night === d);
    const pr = m && m.perAdult ? Math.round(m.perAdult.protein || 0) : 0;
    const off = m && m.perAdult && (m.proteinFlag || pr < t.min || pr > t.max);
    const inner = '<span class="fh-tile-d"><b>' + l + "</b> " + fhShortDate(date).split(" ")[0] + "</span>" +
      '<span class="fh-tile-ic"><svg class="ic"><use href="#' + (m && m.dumpBag ? "ic-pot" : FH_TYPE_ICON[type] || "ic-users") + '"/></svg></span>' +
      '<span class="fh-tile-n">' + (m ? fhE(m.name) : type === "none" ? "No cooking" : fhState.busy === "createMenu" ? "Writing…" : "Not planned") + "</span>" +
      (m && m.perAdult ? '<span class="fh-tile-p' + (off ? " off" : "") + '">' + pr + "g</span>" : "") +
      (m && m.status === "cooked" ? '<span class="fh-tile-done" aria-label="Cooked"><svg class="ic"><use href="#ic-check"/></svg></span>' : "");
    const cls = "fh-tile t-" + type + (date === today ? " today" : "") + (m ? "" : " empty") + (m && m.status === "skipped" ? " skipped" : "");
    return m && m.id ? '<button type="button" role="listitem" class="' + cls + '" onclick="fhGoMeal(\'' + m.id + '\')"' + (date === today ? ' aria-current="date"' : "") + ">" + inner + "</button>"
      : '<div role="listitem" class="' + cls + '"' + (date === today ? ' aria-current="date"' : "") + ">" + inner + "</div>";
  }).join("") + "</div>";
}
function fhTabsHtml(tab) {
  const p = fhState.plan;
  const counts = { menu: (p.meals || []).length, shop: (p.toBuy || []).filter((b) => !b.ticked).length, kitchen: fhItems("meat").length,
    book: ((fhState.book && fhState.book.recipes) || []).length };
  return '<div class="fh-tabs" role="tablist" aria-label="Food">' + FH_TABS.map(([k, label, icon]) =>
    '<button type="button" role="tab" id="fht-' + k + '" aria-controls="fhp-' + k + '" aria-selected="' + (tab === k) + '" class="' + (tab === k ? "on" : "") + '" onclick="fhSetTab(\'' + k + '\')">' +
    '<svg class="ic"><use href="#' + icon + '"/></svg><span>' + label + "</span>" + (counts[k] ? "<small>" + counts[k] + "</small>" : "") + "</button>").join("") + "</div>";
}

/* 1. MEAT */
function fhItems(cat) { return ((fhState.inventory && fhState.inventory.items) || []).filter((i) => i.category === cat); }
function fhMeatHtml() {
  const meat = fhItems("meat");
  const photo = fhState.photoItems;
  return '<section class="fh-sec"><div class="fh-h"><span>Meat</span><small>' + meat.length + " in</small>" +
    '<span class="fh-h-acts"><button type="button" class="fh-b ghost sm" onclick="fhTogglePaste()">Paste a list</button>' +
    '<button type="button" class="fh-b sm" onclick="fhPhotoPick()"' + (fhState.busy ? " disabled" : "") + ">Read from photo</button></span>" +
    '<input type="file" id="fhPhoto" accept="image/*,.heic,.heif" hidden onchange="fhPhotoChosen(this)"></div>' +
    (photo ? '<div class="fh-check"><div class="fh-small">Check what was read, then add it.</div>' +
      photo.map((p, i) => '<div class="fh-check-row"><input value="' + fhE(p.name) + '" onchange="fhPhotoEdit(' + i + ',\'name\',this.value)" aria-label="Item">' +
        '<input type="number" min="0" value="' + (p.qty || 0) + '" onchange="fhPhotoEdit(' + i + ',\'qty\',this.value)" aria-label="Amount">' +
        '<select onchange="fhPhotoEdit(' + i + ',\'unit\',this.value)" aria-label="Unit">' + ["g", "count", "ml"].map((u) => '<option' + (p.unit === u ? " selected" : "") + ">" + u + "</option>").join("") + "</select>" +
        '<button type="button" class="fh-x" aria-label="Leave out ' + fhE(p.name) + '" onclick="fhPhotoDrop(' + i + ')">×</button></div>').join("") +
      '<div class="fh-row"><button type="button" class="fh-b go sm" onclick="fhPhotoAdd()">Add these to the meat</button>' +
      '<button type="button" class="fh-b ghost sm" onclick="fhPhotoCancel()">Cancel</button></div></div>' : "") +
    (fhState.showPaste ? '<div class="fh-check"><textarea class="fh-ta" id="fhPaste" rows="5" placeholder="Paste the butcher’s list, one item per line — e.g. 454g steak mince, 8 x 228g chicken fillets, 4 turkey burgers"></textarea>' +
      '<div class="fh-row"><button type="button" class="fh-b go sm" onclick="fhPasteAdd()">Add these</button></div></div>' : "") +
    (meat.length ? '<div class="fh-list">' + meat.map((i) => '<div class="fh-li"><span class="fh-li-t"><b>' + fhE(i.name) + "</b> " + fhE(fhAmount(i)) +
        '<small>added ' + fhShortDate(i.added) + "</small></span>" +
        '<button type="button" class="fh-tag ' + i.storage + '" onclick="fhInvUpdate(\'' + i.id + '\',{storage:\'' + (i.storage === "freezer" ? "fridge" : "freezer") + '\'})" title="Move to the ' +
          (i.storage === "freezer" ? "fridge" : "freezer") + '">' + (i.storage === "freezer" ? "Freezer" : "Fridge") + "</button>" +
        '<button type="button" class="fh-x" aria-label="Remove ' + fhE(i.name) + '" onclick="fhInvOp(\'remove\',\'' + i.id + '\')">×</button></div>').join("") + "</div>"
      : '<div class="fh-small">No meat in yet — add the butcher’s box.</div>') +
    '<div class="fh-add"><input id="fhMeatName" placeholder="Add one — e.g. diced chuck" aria-label="Meat">' +
      '<input id="fhMeatQty" type="number" min="0" placeholder="Amount" aria-label="Amount">' +
      '<select id="fhMeatUnit" aria-label="Unit"><option>g</option><option>count</option></select>' +
      '<select id="fhMeatWhere" aria-label="Where"><option value="fridge">Fridge</option><option value="freezer">Freezer</option></select>' +
      '<button type="button" class="fh-b sm" onclick="fhMeatAdd()">Add</button></div></section>';
}
/* 2. CUPBOARD & FRIDGE */
function fhPantryHtml() {
  return '<section class="fh-sec"><div class="fh-h"><span>Cupboard &amp; fridge</span>' +
    '<span class="fh-h-acts"><button type="button" class="fh-b sm" onclick="fhPantryPick()"' + (fhState.busy ? " disabled" : "") + '><svg class="ic"><use href="#ic-camera"/></svg>Read from photos</button></span>' +
    '<input type="file" id="fhPantryPhoto" accept="image/*,.heic,.heif" multiple hidden onchange="fhPantryChosen(this)"></div>' +
    (fhState.pantryItems ? fhPantryCheckHtml() : '<div class="fh-small">Snap the cupboard, the fridge or the spice rack — as many photos as you like — and check the list before it’s added.</div>') +
    FH_CATS.map(([cat, label]) => {
      const items = fhItems(cat);
      const body = '<div class="fh-chips">' + items.map((i) => '<span class="fh-chip">' + fhE(i.name) +
          (cat === "fresh" ? " <em>" + fhE(fhAmount(i)) + " · " + (i.opened ? "opened " + fhShortDate(i.opened) : "bought " + fhShortDate(i.added)) + "</em>" : "") +
          (cat !== "staples" && cat !== "spices" ? '<button type="button" class="fh-used" title="Used up" aria-label="' + fhE(i.name) + ' used up" onclick="fhInvOp(\'usedUp\',\'' + i.id + '\')">used up</button>' : "") +
          '<button type="button" class="fh-x" aria-label="Remove ' + fhE(i.name) + '" onclick="fhInvOp(\'remove\',\'' + i.id + '\')">×</button></span>').join("") +
        (items.length ? "" : '<span class="fh-small">Nothing here.</span>') + "</div>" +
        '<div class="fh-quick"><input id="fhAdd_' + cat + '" placeholder="Quick add…" aria-label="Add to ' + label + '" onkeydown="if(event.key===\'Enter\'){event.preventDefault();fhQuickAdd(\'' + cat + '\');}">' +
        '<button type="button" class="fh-b ghost sm" onclick="fhQuickAdd(\'' + cat + '\')">Add</button></div>' +
        (cat === "staples" ? '<div class="fh-small">Always in the house — never on the to-buy list.</div>' : "");
      const fold = cat === "spices" || cat === "staples";
      return fold ? '<details class="fh-cat"><summary>' + label + " <small>" + items.length + "</small></summary>" + body + "</details>"
        : '<div class="fh-cat"><div class="fh-cat-h">' + label + "</div>" + body + "</div>";
    }).join("") + "</section>";
}
// what the photos found, sorted, each one editable — nothing is added until "Add these"
function fhPantryCheckHtml() {
  const items = fhState.pantryItems;
  const cats = FH_CATS;
  return '<div class="fh-check"><div class="fh-small"><b>' + items.length + " found.</b> Check the names and where each one goes, then add them." +
      (fhState.pantrySkipped ? " " + fhState.pantrySkipped + " you already have " + (fhState.pantrySkipped === 1 ? "was" : "were") + " left out." : "") + "</div>" +
    items.map((p, i) => '<div class="fh-check-row"><input value="' + fhE(p.name) + '" onchange="fhPantryEdit(' + i + ',\'name\',this.value)" aria-label="Item">' +
      '<select onchange="fhPantryEdit(' + i + ',\'category\',this.value)" aria-label="Where it goes">' + cats.map(([k, l]) => '<option value="' + k + '"' + (p.category === k ? " selected" : "") + ">" + l + "</option>").join("") + "</select>" +
      '<button type="button" class="fh-x" aria-label="Leave out ' + fhE(p.name) + '" onclick="fhPantryDrop(' + i + ')">×</button></div>').join("") +
    '<div class="fh-row"><button type="button" class="fh-b go sm" onclick="fhPantryAdd()"' + (items.length ? "" : " disabled") + ">Add these " + items.length + "</button>" +
    '<button type="button" class="fh-b ghost sm" onclick="fhPantryPick()">Add another photo</button>' +
    '<button type="button" class="fh-b ghost sm" onclick="fhPantryCancel()">Cancel</button></div></div>';
}
/* 3. THIS WEEK'S SITUATION */
function fhSituationHtml() {
  const p = fhState.plan, s = p.schedule || {};
  const warr = FH_DAYS.filter(([d]) => fhLocationOf(d) === "warrington").map(([, l]) => l);
  return '<section class="fh-sec"><div class="fh-h"><span>This week’s situation</span>' +
    '<span class="fh-h-acts"><button type="button" class="fh-b ghost sm" onclick="fhSetAll(\'solo\')">Away all week</button>' +
    '<button type="button" class="fh-b ghost sm" onclick="fhSetAll(\'busy\')">Busy week</button></span></div>' +
    (warr.length ? '<div class="fh-small">Warrington on ' + warr.join(", ") + " — set to Chloe solo.</div>" : "") +
    '<div class="fh-nights">' + FH_DAYS.map(([d, l]) => '<div class="fh-night-row"><span class="fh-night-d">' + l + " <small>" + fhShortDate(fhDateOf(fhState.week, d)) + "</small></span>" +
      '<span class="fh-seg" role="radiogroup" aria-label="' + l + '">' + FH_NIGHT.map(([k, label]) =>
        '<button type="button" role="radio" aria-checked="' + ((s[d] || "family") === k) + '" class="' + ((s[d] || "family") === k ? "on " + k : "") +
        '" onclick="fhSetNight(\'' + d + '\',\'' + k + '\')">' + label + "</button>").join("") + "</span></div>").join("") + "</div>" +
    '<label class="fh-lab">Anything else this week?<textarea class="fh-ta" rows="2" placeholder="e.g. Neli’s not sleeping, keep it easy · Chloe’s mum is over Saturday, 5 eating" ' +
      'oninput="fhField(\'situation\', this.value)" onblur="fhSaveNow()">' + fhE(p.situation || "") + "</textarea></label>" +
    '<label class="fh-lab fh-inline">People eating <input type="number" min="1" max="12" value="' + (p.people || 4) + '" onchange="fhField(\'people\', Number(this.value)); fhSaveNow()"></label></section>';
}
/* 5. THE MENU */
function fhTypeLabel(t) { return (FH_NIGHT.find((x) => x[0] === t) || ["", "Family"])[1]; }
function fhDayLabel(d) { return { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" }[d] || d; }
function fhMenuHtml() {
  const p = fhState.plan;
  const partial = fhState.busy === "createMenu" && fhState.job && Array.isArray(fhState.job.partial) ? fhState.job.partial : [];
  if (fhState.busy === "createMenu") {
    return '<section class="fh-sec"><div class="fh-h"><span>This week’s menu</span><small>being written</small></div>' +
      (partial.length ? '<div class="fh-meals">' + partial.map((m) => '<article class="fh-meal draft"><div class="fh-meal-top"><span class="fh-day">' + fhE(fhDayLabel(m.night)) + "</span>" +
        (m.dumpBag ? '<span class="fh-type bag">Dump bag</span>' : "") + '</div><b class="fh-meal-name">' + fhE(m.name) + '</b><span class="fh-meal-sum">' + fhE(m.summary) + "</span>" +
        (m.perAdult ? fhMacrosHtml(m.perAdult) : "") + "</article>").join("") + "</div>" : '<div class="fh-small">The first meal will appear here as soon as it is written.</div>') + "</section>";
  }
  if (!(p.meals || []).length) return fhEmptyHtml("ic-utensils", "No menu yet", "Set the week’s evenings in Plan the week, then Create weekly menu.",
    '<button type="button" class="fh-b go sm" onclick="fhSetTab(\'plan\')">Plan this week</button>');
  const today = fhToday();
  const t = p.proteinTarget || fhTarget();
  return '<section class="fh-sec"><div class="fh-h"><span>This week’s menu</span><small>' + (p.people || 4) + " eating · per adult serving · protein target " + t.min + "–" + t.max + "g</small></div>" +
    '<div class="fh-meals">' + p.meals.map((m) => fhMealHtml(m, today)).join("") + "</div>" +
    '<div class="fh-change"><label class="fh-lab">Change something<textarea class="fh-ta" id="fhChange" rows="2" placeholder="e.g. Artie won’t eat curry, swap Saturday · make Tuesday quicker"></textarea></label>' +
    '<button type="button" class="fh-b sm" onclick="fhChangeClick()"' + (fhState.busy ? " disabled" : "") + ">Apply the change</button>" +
    '<div class="fh-small">Only what you ask changes — every other meal stays as it is.</div></div></section>';
}
// the protein target as the settings have it (the server stamps the one it used on each menu)
function fhTarget() {
  const s = fhState.settings || {};
  return { min: Number(s.proteinMin) || 30, max: Number(s.proteinMax) || 40, servings: Number(s.servings) || 3 };
}
// protein first and biggest — it is the number the menu is built around
function fhMacrosHtml(pa, flag) {
  return '<div class="fh-macros"><span class="fh-pro' + (flag ? " off" : "") + '"><b>' + Math.round(pa.protein || 0) + "g</b> protein</span>" +
    "<span><b>" + Math.round(pa.kcal || 0) + "</b> kcal</span><span><b>" + Math.round(pa.carbs || 0) + "g</b> carbs</span><span><b>" + Math.round(pa.fat || 0) + "g</b> fat</span></div>";
}
const fhFlagWords = { below: "Below protein target", above: "Above protein target" };
function fhMealHtml(m, today) {
  const open = m.id in fhState.open ? fhState.open[m.id] : m.date === today;
  return '<article class="fh-meal t-' + fhE(m.type || "family") + (m.status === "cooked" ? " cooked" : m.status === "skipped" ? " skipped" : "") + (m.date === today ? " tonight" : "") + '" id="fhm-' + m.id + '">' +
    '<div class="fh-meal-top"><span class="fh-day">' + fhE(fhDayLabel(m.night)) + " <small>" + fhShortDate(m.date) + "</small></span>" +
      fhTypeChip(m.type) + (m.dumpBag ? '<span class="fh-chip bag"><svg class="ic"><use href="#ic-pot"/></svg>Dump bag</span>' : "") +
      (m.recipeId ? '<span class="fh-type book">Recipe book</span>' : "") +
      (m.status === "cooked" ? '<span class="fh-status">Cooked</span>' : m.status === "skipped" ? '<span class="fh-status off">Skipped</span>' : "") +
      '<span class="fh-mins">' + (m.minutes ? m.minutes + " min" : "") + "</span></div>" +
    '<div class="fh-meal-title"><b class="fh-meal-name">' + fhE(m.name) + "</b>" +
      '<button type="button" class="fh-keep' + (m.keep ? " on" : "") + '" aria-pressed="' + !!m.keep + '" title="' + (m.keep ? "In the recipe book — tap to take it out" : "Keep this recipe in the recipe book") +
      '" onclick="fhKeep(\'' + m.id + '\',' + !m.keep + ')"><svg class="ic"><use href="#ic-star"/></svg>' + (m.keep ? "Kept" : "Keep") + "</button></div>" +
    '<span class="fh-meal-sum">' + fhE(m.summary) + "</span>" +
    (m.proteinFlag ? '<div class="fh-flag" role="note">' + fhFlagWords[m.proteinFlag] + "</div>" : "") +
    fhMacrosHtml(m.perAdult || {}, m.proteinFlag) +
    ((m.proteinTopUps || []).length ? '<div class="fh-topup">+ ' + m.proteinTopUps.map(fhE).join(", ") + " for protein</div>" : "") +
    (m.dumpBag && m.slowCooker && (m.slowCooker.low || m.slowCooker.high) ? '<div class="fh-small">Slow cooker: <b>' + fhE(m.slowCooker.low) + "</b> on LOW · <b>" + fhE(m.slowCooker.high) + "</b> on HIGH</div>" : "") +
    '<div class="fh-meat">Meat: <b>' + fhE((m.meat || {}).amount) + " " + fhE((m.meat || {}).name) + "</b></div>" +
    ((m.usesUp || []).length ? '<div class="fh-uses">Uses up: ' + m.usesUp.map(fhE).join(", ") + "</div>" : "") +
    '<button type="button" class="fh-b ghost sm fh-open" aria-expanded="' + open + '" onclick="fhToggleOpen(\'' + m.id + '\',' + !open + ')">' + (open ? "Hide the recipe" : "Ingredients &amp; method") + "</button>" +
    (open ? fhRecipeHtml(m, true) : "") +
    (m.status === "planned" || !m.status ? '<div class="fh-meal-acts"><button type="button" class="fh-b go sm" onclick="fhCooked(\'' + m.id + '\')">Cooked</button>' +
      '<button type="button" class="fh-b ghost sm" onclick="fhSkipped(\'' + m.id + '\')">Skipped</button>' +
      '<button type="button" class="fh-b ghost sm" onclick="fhSwap(\'' + m.night + '\')"' + (fhState.busy ? " disabled" : "") + ">Swap this meal</button></div>" : "") +
    (m.status === "cooked" ? fhRatingHtml(m) : "") + "</article>";
}
// ingredients (with what we have and what to buy), the method, the tip — on a card or in the book
function fhRecipeHtml(m, haveBuy) {
  return '<div class="fh-recipe"><ul class="fh-ing">' + (m.ingredients || []).map((i) => '<li class="' + (!haveBuy ? "" : i.have ? "have" : "buy") + '"><span>' + fhE(i.qty) + " " + fhE(i.name) +
      (i.protein ? '<small class="fh-ip">' + Math.round(i.protein) + "g protein</small>" : "") +
      (i.topUp ? ' <small class="fh-tu">protein top-up</small>' : "") + "</span>" + (haveBuy ? "<em>" + (i.have ? "have" : "buy") + "</em>" : "") + "</li>").join("") +
    '</ul><ol class="fh-steps">' + (m.method || []).map((s) => "<li>" + fhE(s) + "</li>").join("") + "</ol>" +
    (m.kidTip ? '<div class="fh-kid"><b>For the kids:</b> ' + fhE(m.kidTip) + "</div>" : "") + "</div>";
}
function fhRatingHtml(m) {
  const r = m.ratings || {};
  const btn = (who, val, label, inner) => '<button type="button" class="fh-rb' + (r[who] === val ? " on " + val : "") + '" aria-pressed="' + (r[who] === val) +
    '" aria-label="' + label + '" title="' + label + '" onclick="fhRate(\'' + m.id + '\',\'' + who + '\',\'' + val + '\')">' + inner + "</button>";
  return '<div class="fh-rate"><div class="fh-rate-h">How did it go?</div><div class="fh-rate-rows">' +
    FH_RATERS.map(([who, name]) => '<div class="fh-rate-row"><span class="fh-rate-who">' + name + "</span>" +
      btn(who, "up", name + ": thumbs up", '<svg class="ic"><use href="#ic-thumb-up"/></svg>') + btn(who, "so", name + ": so-so", "so-so") +
      btn(who, "down", name + ": thumbs down", '<svg class="ic"><use href="#ic-thumb-down"/></svg>') + "</div>").join("") +
    '</div><input class="fh-rate-note" maxlength="140" placeholder="A note, if any — e.g. ate the chicken, left the peppers" value="' + fhE(r.note || "") +
    '" onchange="fhRateNote(\'' + m.id + '\', this.value)" aria-label="Note on ' + fhE(m.name) + '"></div>';
}
/* 7. PREP SESSION */
function fhPrepHtml() {
  const prep = fhState.plan.prepSession || {};
  if (fhState.busy === "createMenu" || !(prep.bags || []).length) return "";
  return '<section class="fh-sec fh-prep"><div class="fh-h"><span>Prep session</span><small>make all ' + prep.bags.length + " dump bag" + (prep.bags.length === 1 ? "" : "s") + " in one go</small></div>" +
    ((prep.steps || []).length ? '<ol class="fh-steps">' + prep.steps.map((s) => "<li>" + fhE(s) + "</li>").join("") + "</ol>" : "") +
    prep.bags.map((b) => '<div class="fh-bag"><div class="fh-bag-h"><b>' + fhE(fhDayLabel(b.night)) + ": " + fhE(b.name) + '</b><span class="fh-tag ' + (b.storage === "fridge" ? "fridge" : "freezer") + '">' +
      (b.storage === "fridge" ? "Fridge" : "Freeze") + "</span></div>" +
      '<ul class="fh-bag-in">' + (b.contents || []).map((c) => "<li>" + fhE(c) + "</li>").join("") + "</ul>" +
      (b.label ? '<div class="fh-small"><b>Label:</b> ' + fhE(b.label) + "</div>" : "") +
      (b.slowCooker && (b.slowCooker.low || b.slowCooker.high) ? '<div class="fh-small"><b>Slow cooker:</b> ' + fhE(b.slowCooker.low) + " on LOW · " + fhE(b.slowCooker.high) + " on HIGH</div>" : "") +
      (b.nightBefore ? '<div class="fh-small fh-safe"><b>' + fhE(b.nightBefore) + "</b></div>" : "") +
      (b.morningOf ? '<div class="fh-small"><b>On the morning:</b> ' + fhE(b.morningOf) + "</div>" : "") + "</div>").join("") +
    '<div class="fh-small">No browning on the day — tip it in and go.</div></section>';
}
/* 8. TO-BUY LIST */
function fhProductOf(item) { return fhState.products[item.key] || null; }
function fhBuyHtml() {
  const list = fhState.plan.toBuy || [];
  if (fhState.busy === "createMenu" || (!list.length && !(fhState.plan.meals || []).length)) return "";
  const groups = {};
  for (const b of list) (groups[b.aisle || "Other"] = groups[b.aisle || "Other"] || []).push(b);
  let est = 0;
  for (const b of list) { const pr = fhProductOf(b); est += pr && pr.lastPrice ? pr.lastPrice : (Number(b.estPrice) || 0); }
  return '<section class="fh-sec"><div class="fh-h"><span>To buy</span><small>' + list.filter((b) => !b.ticked).length + " to get · about " + fhMoney(est) + "</small>" +
    '<span class="fh-h-acts"><button type="button" class="fh-b sm" onclick="fhCopyForClaude()">Copy for Claude</button></span></div>' +
    Object.keys(groups).map((aisle) => '<div class="fh-aisle">' + fhE(aisle) + "</div>" + groups[aisle].map((b) => {
      const pr = fhProductOf(b);
      const linked = pr && (pr.productName || pr.productUrl);
      return '<div class="fh-item' + (b.ticked ? " done" : "") + '"><label><input type="checkbox"' + (b.ticked ? " checked" : "") + ' onchange="fhTick(\'' + fhE(b.key) + '\', this.checked)">' +
          '<span class="fh-item-t"><span><b>' + fhE(b.name) + "</b> " + fhE(b.qty) + (b.proteinTopUp ? ' <small class="fh-tu">protein top-up</small>' : "") + "</span>" +
          (linked ? '<span class="fh-prod">' + fhE(pr.productName || "Linked product") + (pr.packSize ? " · " + fhE(pr.packSize) : "") + "</span>" : "") +
          "<small>" + ((b.nights || []).length ? b.nights.map(fhDayLabel).map((x) => x.slice(0, 3)).join(", ") : "added by hand") + (b.leftover ? " · left after: " + fhE(b.leftover) : "") + "</small></span></label>" +
          '<span class="fh-price">' + fhMoney(pr && pr.lastPrice ? pr.lastPrice : b.estPrice) + "</span>" +
          '<button type="button" class="fh-b ghost sm" onclick="fhProductOpen(\'' + fhE(b.key) + '\')">' + (linked ? "Product" : "Set product") + "</button>" +
          (b.manual ? '<button type="button" class="fh-x" aria-label="Remove ' + fhE(b.name) + '" onclick="fhBuyRemove(\'' + fhE(b.key) + '\')">×</button>' : "") + "</div>" +
        (fhState.productFor === b.key ? fhProductFormHtml(b, pr) : "");
    }).join("")).join("") +
    '<div class="fh-add"><input id="fhBuyName" placeholder="Add something by hand" aria-label="Item"><input id="fhBuyQty" placeholder="How many" aria-label="Quantity">' +
    '<button type="button" class="fh-b sm" onclick="fhBuyAdd()">Add</button></div></section>';
}
function fhProductFormHtml(b, pr) {
  const v = pr || {};
  return '<div class="fh-prodform">' +
    '<input id="fhPName" placeholder="Tesco product name" value="' + fhE(v.productName || "") + '">' +
    '<input id="fhPPack" placeholder="Pack size, e.g. 1kg" value="' + fhE(v.packSize || "") + '">' +
    '<input id="fhPUrl" placeholder="Tesco link" value="' + fhE(v.productUrl || "") + '">' +
    '<input id="fhPPrice" type="number" step="0.01" min="0" placeholder="Last price £" value="' + (v.lastPrice || "") + '">' +
    '<label class="fh-conf"><input id="fhPConf" type="checkbox"' + (v.confirmed !== false ? " checked" : "") + "> Use this every week</label>" +
    '<div class="fh-row"><button type="button" class="fh-b go sm" onclick="fhProductSave(\'' + fhE(b.key) + '\')">Save</button>' +
    '<button type="button" class="fh-b ghost sm" onclick="fhProductOpen(\'\')">Cancel</button></div></div>';
}
/* RECIPE BOOK — the kids' favourites and anything starred Keep, saved in full */
function fhBookHtml() {
  const rs = (fhState.book && fhState.book.recipes) || [];
  if (fhState.busy === "createMenu") return "";
  const nights = (fhState.plan.meals || []).filter((m) => m.status !== "cooked");
  return '<section class="fh-sec fh-book"><div class="fh-h"><span>Recipe book</span><small>' + rs.length + " saved</small></div>" +
    (!rs.length ? '<div class="fh-small">Meals both kids give a thumbs up — or any you star Keep — are saved here in full, and come back exactly the same way.</div>' :
    rs.map((r) => {
      const open = !!fhState.bookOpen[r.id];
      const rt = r.ratings || {};
      return '<div class="fh-bk"><div class="fh-bk-top"><button type="button" class="fh-bk-name" aria-expanded="' + open + '" onclick="fhBookToggle(\'' + r.id + '\')"><b>' + fhE(r.name) + "</b></button>" +
          (r.perAdult ? '<span class="fh-pro sm"><b>' + Math.round(r.perAdult.protein || 0) + "g</b> protein</span>" : "") + "</div>" +
        '<div class="fh-small">' + (r.kidsLoved ? "Both kids loved it" : "Kept") + (r.dumpBag ? " · dump bag" : "") +
          (rt.adults ? " · us: " + ({ up: "thumbs up", so: "so-so", down: "thumbs down" }[rt.adults] || "") : "") +
          ((r.notes || []).length ? " · “" + fhE(r.notes[0].note) + "”" : "") + "</div>" +
        (open ? fhRecipeHtml(r, false) : "") +
        '<div class="fh-row">' + (fhState.bookFor === r.id
          ? (nights.length ? '<select id="fhBookNight" aria-label="Which night">' + nights.map((m) => '<option value="' + m.night + '">' + fhDayLabel(m.night) + " — instead of " + fhE(m.name) + "</option>").join("") + "</select>" +
              '<button type="button" class="fh-b go sm" onclick="fhBookUse(\'' + r.id + '\')">Put it in</button>' : "") +
            '<button type="button" class="fh-b ghost sm" onclick="fhBookFor(\'\')">Cancel</button>'
          : '<button type="button" class="fh-b sm" onclick="fhBookFor(\'' + r.id + '\')"' + (fhState.busy ? " disabled" : "") + ">Add to this week</button>" +
            '<button type="button" class="fh-b ghost sm" onclick="fhBookRemove(\'' + r.id + '\')">Remove from the book</button>') + "</div></div>";
    }).join("")) + "</section>";
}

/* 10. SETTINGS */
function fhSettingsHtml() {
  const s = fhState.settings || {}, t = fhState.taste || {};
  const rules = s.rules || (fhState.defaults && fhState.defaults.rules) || "";
  const list = (a) => (a && a.length ? a.map(fhE).join(" · ") : "none yet");
  return '<details class="fh-sec fh-settings"><summary>Settings — the kids, people, planning rules</summary>' +
    '<label class="fh-lab">What the kids will and won’t eat<textarea class="fh-ta" id="fhKids" rows="3">' + fhE(s.kidsNotes || "") + "</textarea></label>" +
    '<label class="fh-lab fh-inline">People eating, usually <input id="fhPeople" type="number" min="1" max="12" value="' + (s.people || 4) + '"></label>' +
    '<div class="fh-lab">Protein per adult serving <small>every meal is planned and checked against this</small></div>' +
    '<div class="fh-row"><label class="fh-lab fh-inline">From <input id="fhPMin" type="number" min="0" max="200" value="' + fhTarget().min + '">g</label>' +
      '<label class="fh-lab fh-inline">to <input id="fhPMax" type="number" min="0" max="300" value="' + fhTarget().max + '">g</label>' +
      '<label class="fh-lab fh-inline">Adult servings <input id="fhServ" type="number" min="0.5" max="20" step="0.5" value="' + fhTarget().servings + '"></label></div>' +
    '<div class="fh-small">Adult servings: 2 adults + 2 kids at half portions = 3.</div>' +
    '<label class="fh-lab">Planning rules <small>sent with every request</small><textarea class="fh-ta" id="fhRules" rows="9">' + fhE(rules) + "</textarea></label>" +
    '<div class="fh-row"><button type="button" class="fh-b sm" onclick="fhSettingsSave()">Save settings</button>' +
    '<button type="button" class="fh-b ghost sm" onclick="fhRulesReset()">Put the rules back to the default</button></div>' +
    '<div class="fh-taste"><div class="fh-taste-h">What the family likes so far</div><div><b>Favourites</b> (both kids loved): ' + list(t.favourites) + "</div>" +
    "<div><b>Never again:</b> " + list(t.neverAgain) + "</div>" +
    ((t.notes || []).length ? '<div class="fh-small">' + t.notes.length + " rating note" + (t.notes.length === 1 ? "" : "s") + " — every menu reads them.</div>" : "") + "</div></details>";
}

/* ---------- inventory ---------- */
// "454g steak mince" · "8 x 228g chicken fillets" · "1.2kg potatoes" · "4 turkey burgers" · "500ml milk"
function fhParseLine(line) {
  const t = String(line || "").trim().replace(/^[-•*]\s*/, "");
  if (!t) return null;
  let m = /^(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g)\b\s*(.*)$/i.exec(t);
  if (m) { const each = Number(m[2]) * (m[3].toLowerCase() === "kg" ? 1000 : 1); return { name: (m[1] + " " + m[4]).trim(), qty: Math.round(Number(m[1]) * each), unit: "g" }; }
  m = /^(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b\s*(.*)$/i.exec(t);
  if (m) { const u = m[2].toLowerCase(); const k = u === "kg" || u === "l" ? 1000 : 1; return { name: m[3].trim() || t, qty: Math.round(Number(m[1]) * k), unit: u === "ml" || u === "l" ? "ml" : "g" }; }
  m = /^(\d+)\s+(.*)$/.exec(t);
  if (m) return { name: m[2].trim(), qty: Number(m[1]), unit: "count" };
  return { name: t, qty: 1, unit: "count" };
}
async function fhInvSend(payload, okNote) {
  try {
    const r = await fhPost(FH_STORE, { foodInventory: payload });
    if (r && r.inventory) fhState.inventory = r.inventory;
    if (okNote) fhState.note = okNote;
  } catch (e) { fhState.error = "Couldn’t save that — check your connection."; }
  fhRender();
}
function fhAddItems(items, okNote) { if (items.length) return fhInvSend({ op: "add", items }, okNote); }
function fhInvOp(op, id) { return fhInvSend({ op, id }); }
function fhInvUpdate(id, fields) { return fhInvSend({ op: "update", id, fields }); }
function fhMeatAdd() {
  const v = (id) => String((document.getElementById(id) || {}).value || "").trim();
  const name = v("fhMeatName");
  if (!name) return;
  fhAddItems([{ name, qty: Number(v("fhMeatQty")) || 1, unit: v("fhMeatUnit") || "g", category: "meat", storage: v("fhMeatWhere") || "fridge", added: fhToday() }]);
}
function fhTogglePaste() { fhState.showPaste = !fhState.showPaste; fhRender(); }
function fhPasteAdd() {
  const lines = String((document.getElementById("fhPaste") || {}).value || "").split("\n").map(fhParseLine).filter(Boolean);
  fhState.showPaste = false;
  fhAddItems(lines.map((l) => ({ ...l, category: "meat", storage: "fridge", added: fhToday() })), "Added " + lines.length + " to the meat.");
}
function fhQuickAdd(cat) {
  const el = document.getElementById("fhAdd_" + cat);
  const raw = String((el && el.value) || "").trim();
  if (!raw) return;
  const p = fhParseLine(raw);
  fhAddItems([{ ...p, category: cat, storage: cat === "fresh" ? "fridge" : "cupboard", added: fhToday(), opened: "" }]);
}

/* ---------- the photo: a JPEG, at most 1600px, read, then checked before anything is added ---------- */
function fhPhotoPick() { const el = document.getElementById("fhPhoto"); if (el) el.click(); }
function fhLoadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
function fhDecode(blob) { return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = URL.createObjectURL(blob); }); }
async function fhToJpeg(file) {
  let img;
  try { img = await fhDecode(file); }
  catch (e) {
    // an iPhone HEIC opened somewhere that cannot read it: convert, then try again
    if (!window.heic2any) await fhLoadScript(FH_HEIC_LIB);
    const out = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    img = await fhDecode(Array.isArray(out) ? out[0] : out);
  }
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const k = Math.min(1, FH_PHOTO_MAX / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85).split(",")[1];
}
async function fhPhotoChosen(input) {
  const file = input && input.files && input.files[0];
  if (input) input.value = "";
  if (!file) return;
  fhState.busy = "photo"; fhState.error = ""; fhState.note = ""; fhRender();
  try {
    const r = await fhPost(FH_FN, { action: "readPhoto", jpegBase64: await fhToJpeg(file) });
    if (!r.ok) throw new Error(r.error || "Couldn’t read that photo.");
    fhState.photoItems = r.items || [];
    if (r.note) fhState.note = r.note;
  } catch (e) {
    fhState.error = (e && e.message && !/^HTTP/.test(e.message)) ? e.message : "Couldn’t read that photo — try a clearer one, or paste the list.";
  }
  fhState.busy = ""; fhRender();
}
function fhPhotoEdit(i, f, v) { const p = fhState.photoItems && fhState.photoItems[i]; if (p) p[f] = f === "qty" ? Number(v) || 0 : v; }
function fhPhotoDrop(i) { fhState.photoItems.splice(i, 1); fhRender(); }
function fhPhotoCancel() { fhState.photoItems = null; fhRender(); }
/* cupboard photos: several at once, read one after another, merged — anything already in the kitchen left out */
function fhPantryPick() { const el = document.getElementById("fhPantryPhoto"); if (el) el.click(); }
async function fhPantryChosen(input) {
  const files = Array.from((input && input.files) || []);
  if (input) input.value = "";
  if (!files.length) return;
  fhState.busy = "pantry"; fhState.error = ""; fhState.note = "";
  const have = new Set(((fhState.inventory && fhState.inventory.items) || []).map((i) => fhKey(i.name)));
  const found = (fhState.pantryItems || []).slice();
  const seen = new Set(found.map((p) => fhKey(p.name)));
  let skipped = fhState.pantrySkipped || 0, failed = 0, lastErr = "";
  for (let n = 0; n < files.length; n++) {
    fhState.photoStep = files.length > 1 ? "Reading photo " + (n + 1) + " of " + files.length + "…" : "Reading the photo…";
    fhRender();
    try {
      const r = await fhPost(FH_FN, { action: "readCupboard", jpegBase64: await fhToJpeg(files[n]) });
      if (!r.ok) throw new Error(r.error || "Couldn’t read that photo.");
      for (const it of r.items || []) {
        const k = fhKey(it.name);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        if (have.has(k)) { skipped++; continue; }
        found.push(it);
      }
      if (r.note && !(r.items || []).length) lastErr = r.note;
    } catch (e) { failed++; lastErr = (e && e.message && !/^HTTP/.test(e.message)) ? e.message : "Couldn’t read that photo."; }
  }
  fhState.pantryItems = found; fhState.pantrySkipped = skipped; fhState.photoStep = ""; fhState.busy = "";
  if (failed || (!found.length && lastErr)) fhState.error = (failed > 1 ? failed + " photos couldn’t be read. " : "") + (lastErr || "") + (found.length ? "" : " Try a closer, brighter photo.");
  fhRender();
}
// the same name key the server uses for products and staples
function fhKey(name) { return String(name || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }
function fhPantryEdit(i, f, v) { const p = fhState.pantryItems && fhState.pantryItems[i]; if (p) p[f] = v; }
function fhPantryDrop(i) { fhState.pantryItems.splice(i, 1); fhRender(); }
function fhPantryCancel() { fhState.pantryItems = null; fhState.pantrySkipped = 0; fhRender(); }
function fhPantryAdd() {
  const items = (fhState.pantryItems || []).filter((p) => p.name).map((p) => ({ name: p.name, qty: p.qty || 1, unit: p.unit || "count",
    category: p.category, storage: p.storage || (p.category === "fresh" ? "fridge" : "cupboard"), added: fhToday() }));
  fhState.pantryItems = null; fhState.pantrySkipped = 0;
  fhAddItems(items, "Added " + items.length + " to the kitchen.");
}
function fhPhotoAdd() {
  const items = (fhState.photoItems || []).filter((p) => p.name).map((p) => ({ name: p.name, qty: p.qty, unit: p.unit, category: "meat", storage: "fridge", added: fhToday() }));
  fhState.photoItems = null;
  fhAddItems(items, "Added " + items.length + " to the meat.");
}

/* ---------- the week's situation ---------- */
function fhField(f, v) {
  if (!fhState.plan) return;
  fhState.plan[f] = v;
  fhState.confirmCreate = false;
  clearTimeout(fhState.saveTimer);
  fhState.saveTimer = setTimeout(fhSaveNow, 1200);
}
async function fhSaveNow() {
  clearTimeout(fhState.saveTimer);
  const p = fhState.plan;
  if (!p || !fhState.week) return;
  try { await fhPost(FH_STORE, { foodPlan: { weekEnding: fhState.week, schedule: p.schedule, situation: p.situation || "", people: p.people } }); }
  catch (e) { fhState.error = "Couldn’t save — check your connection."; fhRender(); }
}
function fhSetNight(d, k) { fhState.plan.schedule = { ...fhState.plan.schedule, [d]: k }; fhRender(); fhSaveNow(); }
function fhSetAll(k) { const s = {}; for (const [d] of FH_DAYS) s[d] = k; fhState.plan.schedule = s; fhRender(); fhSaveNow(); }

/* ---------- create, swap, change: started here, run in the background, watched every 2 seconds ---------- */
async function fhStart(job) {
  fhState.error = ""; fhState.note = "";
  const id = fhUid();
  try {
    const r = await fetch(FH_BG, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, weekEnding: fhState.week, ...job }) });
    if (!r.ok && r.status !== 202) throw new Error("HTTP " + r.status);
  } catch (e) { fhState.busy = ""; fhState.error = "Couldn’t start — check your connection."; fhRender(); return; }
  fhState.job = { id, status: "running", partial: [] };
  fhPoll(fhState.week, id, Date.now());
}
function fhPoll(week, id, startedAt) {
  setTimeout(async () => {
    if (fhState.week !== week) return;
    let job = null;
    try { job = (await fhGet(FH_FN + "?job=" + encodeURIComponent(week))).job; } catch (e) { job = null; }
    if (job && job.id === id) {
      fhState.job = job;
      if (job.status === "done") {
        try { const p = await fhGet(FH_STORE + "?foodplan=" + encodeURIComponent(week)); if (p && p.plan) fhState.plan = p.plan; } catch (e) {}
        fhState.note = job.summary ? "Done — " + job.summary : "Done — this week’s menu is ready.";
        fhState.busy = ""; fhState.open = {}; fhRender(); return;
      }
      if (job.status === "error") { fhState.busy = ""; fhState.error = (job.error || "That didn’t work.") + " Your saved menu is untouched."; fhRender(); return; }
      fhRender();   // new meals as they are written
    }
    if (Date.now() - startedAt > FH_POLL_GIVE_UP_MS) { fhState.busy = ""; fhState.error = "That took too long — try again. Your saved menu is untouched."; fhRender(); return; }
    fhPoll(week, id, startedAt);
  }, FH_POLL_MS);
}
async function fhCreateClick() {
  const p = fhState.plan;
  if ((p.meals || []).length && !fhState.confirmCreate) { fhState.confirmCreate = true; fhRender(); return; }
  fhState.confirmCreate = false;
  await fhSaveNow();
  fhState.busy = "createMenu"; fhState.tab = "menu"; fhRender();
  fhStart({ action: "createMenu", inputs: { schedule: p.schedule, situation: p.situation || "", people: p.people } });
}
function fhSwap(night) { fhState.busy = "swapMeal"; fhRender(); fhStart({ action: "swapMeal", night }); }
function fhChangeClick() {
  const req = String((document.getElementById("fhChange") || {}).value || "").trim();
  if (!req) { fhState.error = "Say what to change first."; fhRender(); return; }
  fhState.busy = "changeMenu"; fhRender();
  fhStart({ action: "changeMenu", request: req });
}
function fhToggleOpen(id, v) { fhState.open[id] = v; fhRender(); }

/* ---------- cooked, skipped, how it went ---------- */
async function fhCooked(mealId) {
  try {
    const r = await fhPost(FH_STORE, { foodCooked: { weekEnding: fhState.week, mealId } });
    if (r.plan) fhState.plan = r.plan;
    if (r.inventory) fhState.inventory = r.inventory;
    fhState.note = "Cooked — taken off the inventory, and the leftovers are in the fridge.";
  } catch (e) { fhState.error = "Couldn’t save that."; }
  fhRender();
}
async function fhSkipped(mealId) {
  try { const r = await fhPost(FH_STORE, { foodSkipped: { weekEnding: fhState.week, mealId } }); if (r.plan) fhState.plan = r.plan; }
  catch (e) { fhState.error = "Couldn’t save that."; }
  fhRender();
}
async function fhRate(mealId, who, val) {
  const m = (fhState.plan.meals || []).find((x) => x.id === mealId);
  if (!m) return;
  const was = { ...(m.ratings || {}) };
  const next = (m.ratings || {})[who] === val ? "" : val;
  m.ratings = { ...(m.ratings || {}), [who]: next };
  fhRender();
  try {
    const r = await fhPost(FH_STORE, { foodRating: { weekEnding: fhState.week, mealId, [who]: next } });
    if (r && r.taste) fhState.taste = r.taste;
    if (r && r.book) {
      const had = (fhState.book.recipes || []).length;
      fhState.book = r.book;
      if (r.book.recipes.length > had) fhState.note = "Both kids loved it — saved to the recipe book.";
      fhRender();
    }
  }
  catch (e) { m.ratings = was; fhState.error = "Couldn’t save that rating."; fhRender(); }
}
async function fhKeep(mealId, keep) {
  try {
    const r = await fhPost(FH_STORE, { foodKeep: { weekEnding: fhState.week, mealId, keep } });
    if (r.plan) fhState.plan = r.plan;
    if (r.book) fhState.book = r.book;
    fhState.note = keep ? "Saved to the recipe book." : "Taken out of the recipe book.";
  } catch (e) { fhState.error = "Couldn’t save that."; }
  fhRender();
}
function fhBookToggle(id) { fhState.bookOpen[id] = !fhState.bookOpen[id]; fhRender(); }
function fhBookFor(id) {
  const r = ((fhState.book && fhState.book.recipes) || []).find((x) => x.id === id);
  // no menu yet: the recipe goes into "Anything else this week?" for Create to pick up
  if (id && r && !(fhState.plan.meals || []).length) {
    const line = "Include our saved recipe: " + r.name + ".";
    if (!String(fhState.plan.situation || "").includes(line)) fhField("situation", ((fhState.plan.situation || "").trim() + "\n" + line).trim());
    fhSaveNow();
    fhState.note = "Added to this week’s notes — Create weekly menu will put it in.";
    fhRender(); return;
  }
  fhState.bookFor = id; fhRender();
}
function fhBookUse(id) {
  const night = String((document.getElementById("fhBookNight") || {}).value || "");
  if (!night) return;
  fhState.bookFor = ""; fhState.busy = "useRecipe"; fhRender();
  fhStart({ action: "useRecipe", night, recipeId: id });
}
async function fhBookRemove(id) {
  try { const r = await fhPost(FH_STORE, { foodRecipeRemove: { id } }); if (r.book) fhState.book = r.book; fhState.note = "Taken out of the recipe book."; }
  catch (e) { fhState.error = "Couldn’t remove that."; }
  fhRender();
}
async function fhRateNote(mealId, note) {
  const m = (fhState.plan.meals || []).find((x) => x.id === mealId);
  if (!m) return;
  m.ratings = { ...(m.ratings || {}), note: String(note || "").slice(0, 140) };
  try { const r = await fhPost(FH_STORE, { foodRating: { weekEnding: fhState.week, mealId, note: m.ratings.note } }); if (r && r.taste) fhState.taste = r.taste; }
  catch (e) { fhState.error = "Couldn’t save that note."; fhRender(); }
}

/* ---------- the to-buy list ---------- */
async function fhTick(key, on) {
  const item = (fhState.plan.toBuy || []).find((b) => b.key === key);
  if (item) item.ticked = !!on;
  fhRender();
  try { await fhPost(FH_STORE, { foodPlan: { weekEnding: fhState.week, ticks: { [key]: !!on } } }); }
  catch (e) { if (item) item.ticked = !on; fhState.error = "Couldn’t save that tick."; fhRender(); }
}
async function fhBuyAdd() {
  const v = (id) => String((document.getElementById(id) || {}).value || "").trim();
  if (!v("fhBuyName")) return;
  try { const r = await fhPost(FH_STORE, { foodPlan: { weekEnding: fhState.week, addBuy: { name: v("fhBuyName"), qty: v("fhBuyQty") } } }); if (r.plan) fhState.plan = r.plan; }
  catch (e) { fhState.error = "Couldn’t add that."; }
  fhRender();
}
async function fhBuyRemove(key) {
  try { const r = await fhPost(FH_STORE, { foodPlan: { weekEnding: fhState.week, removeBuy: key } }); if (r.plan) fhState.plan = r.plan; }
  catch (e) { fhState.error = "Couldn’t remove that."; }
  fhRender();
}
function fhProductOpen(key) { fhState.productFor = key; fhRender(); }
async function fhProductSave(key) {
  // the key travels through the click handler; the name is looked up (a name like "Colman's" would break a quoted handler)
  const item = (fhState.plan.toBuy || []).find((x) => x.key === key);
  const v = (id) => String((document.getElementById(id) || {}).value || "");
  const conf = document.getElementById("fhPConf");
  try {
    const r = await fhPost(FH_STORE, { foodProduct: { name: item ? item.name : key, productName: v("fhPName"), packSize: v("fhPPack"),
      productUrl: v("fhPUrl"), lastPrice: Number(v("fhPPrice")) || 0, confirmed: !!(conf && conf.checked) } });
    if (r && r.products) fhState.products = r.products;
    fhState.productFor = ""; fhState.note = "Saved — every menu from now on plans around that product.";
  } catch (e) { fhState.error = "Couldn’t save that product."; }
  fhRender();
}
// "Please fill my Tesco basket with: …" — the same wording as copyForClaude in netlify/lib/food.js
function fhClaudeText(toBuy, products) {
  const lines = (toBuy || []).filter((b) => b && !b.ticked).map((b) => {
    const p = (products || {})[b.key] || {};
    const name = p.productName || b.productName, url = p.productUrl || b.productUrl;
    return "- " + b.name + " — " + (name || url ? [name, url].filter(Boolean).join(" — ") : "choose the best-value standard pack") + " — " + b.qty;
  });
  return "Please fill my Tesco basket with:\n" + lines.join("\n");
}
async function fhCopyForClaude() {
  const ok = await fhCopyText(fhClaudeText(fhState.plan.toBuy, fhState.products));
  fhState.note = ok ? "Copied — paste it to Claude to fill the Tesco basket." : "Copy failed."; fhRender();
}

/* ---------- settings ---------- */
async function fhSettingsSave() {
  const v = (id) => String((document.getElementById(id) || {}).value || "");
  let rules = v("fhRules").trim();
  // saving the default text unchanged keeps "use the default", so a later improvement to it still arrives
  if (fhState.defaults && rules === String(fhState.defaults.rules || "").trim()) rules = "";
  try {
    const r = await fhPost(FH_STORE, { foodSettings: { kidsNotes: v("fhKids"), people: Number(v("fhPeople")) || 4, rules,
      proteinMin: Number(v("fhPMin")), proteinMax: Number(v("fhPMax")), servings: Number(v("fhServ")) } });
    if (r && r.settings) fhState.settings = r.settings;
    fhState.note = "Settings saved for every week.";
  } catch (e) { fhState.error = "Couldn’t save the settings."; }
  fhRender();
}
function fhRulesReset() {
  const el = document.getElementById("fhRules");
  if (el && fhState.defaults) el.value = fhState.defaults.rules || "";
}
