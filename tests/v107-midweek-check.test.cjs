// v107: "Mid-week check" — a TEMPORARY, display-only override of the Facebook campaign-to-date
// figures on the Weekly Dashboard.
//
// Why it exists: KPI weeks run Sunday–Saturday, so a sale that lands on a Sunday isn't in the
// saved figures until the next week is entered. A mid-week look therefore understates the
// campaign — the planted data here reproduces the exact case: £660 spend against 2 recorded
// sales reads as a £330 CPA, when 4 sales have really landed and the true CPA is £165. Getting
// that wrong kills a campaign that's working.
//
// Because the whole point is to type numbers that are NOT the truth, the safety property is the
// feature. These assertions are ordered accordingly — the "nothing was written" checks are not
// an afterthought here, they are the main event:
//   1. the panel pre-fills from the saved record
//   2. editing recalculates through fbCalc() — the SAME function the real view uses
//   3. no write path exists, and the saved data is byte-for-byte identical afterwards
//   4. every exit (close / reset / switch campaign / collapse / leave tab) discards it
//   5. entering the real weekly figures later is completely unaffected
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/env.cjs");

const WEEKLY = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const MONTHLY = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");

const CAMP = "6-Week Challenge — Aug";
const OTHER = "Retargeting";

// A base week with every KPI field derive() expects, so the app's own boot path builds
// WEEKS/DERIVED for real rather than the test hand-assembling them.
const wk = (weekEnding, extra) => Object.assign({
  weekEnding, adSpend: 0, leads: 0, trialSales: 0, signups: 0, cancellations: 0,
  recurring: 150, recurringSource: "recorded", paused: 0, trialists: 18, totalActive: 170, attendance: 66,
}, extra || {});

// Three weeks of one campaign. Decimal spends that sum exactly (219.5 + 240.5 + 200 = 660),
// so the assertions test decimal handling without inviting float noise.
const SAVED_WEEKS = [
  wk("2026-07-04"),
  wk("2026-07-11"),
  wk("2026-07-18", {
    adSpend: 219.5, leads: 20,
    fbCampaigns: [{ campaign: CAMP, adSpend: 219.5, impressions: 12000, linkClicks: 300, leads: 20, sales: 1 }],
  }),
  wk("2026-07-25", {
    adSpend: 240.5, leads: 25,
    fbCampaigns: [{ campaign: CAMP, adSpend: 240.5, impressions: 14000, linkClicks: 350, leads: 25, sales: 1 }],
  }),
  wk("2026-08-01", {
    adSpend: 260, leads: 20,
    fbCampaigns: [
      { campaign: CAMP, adSpend: 200, impressions: 10000, linkClicks: 250, leads: 15, sales: 0 },
      { campaign: OTHER, adSpend: 60, impressions: 4000, linkClicks: 90, leads: 5, sales: 1 },
    ],
  }),
];
// The saved campaign-to-date truth, computed here by hand so the app can't mark its own homework.
const ACTUAL = { adSpend: 660, impressions: 36000, linkClicks: 900, leads: 60, sales: 2, weeks: 3 };
const PROGRAM_PRICE = 195;

const el = (env, id) => env.ctx.document.getElementById(id);
// The panel as the user sees it. In the browser #mwcDerived and #mwcFoot are children of
// #mwcPanel, but the stub DOM has no tree — getElementById hands back detached elements — so
// the three pieces the app paints separately are composed back together here. (They are
// painted separately on purpose: re-rendering the whole panel on every keystroke would take
// the caret out of the field being typed in.)
const panelHtml = (env) =>
  el(env, "mwcPanel").innerHTML + el(env, "mwcDerived").innerHTML + el(env, "mwcFoot").textContent;
const cardHtml = (env) => el(env, "campaignView").innerHTML;
const snapshot = (env) => JSON.stringify(Array.from(env.ctx.__fbState.weeks));
// The campaign records inside a snapshot. Compared instead of the raw served array where the
// app's own load has legitimately stamped its KPI-chain field (recurringCalc) on every week —
// that happens at boot, long before any override exists, and is not what's under test here.
const campaignsIn = (json) => JSON.parse(json).map((w) => w.fbCampaigns || null);

// Boot the dashboard with the planted history and select the campaign, exactly as the page
// does. (The stub <select> has no real options, so its value is set the way a user's pick
// would leave it.)
async function open(campaign) {
  // `served` is the stub's store, handed to the app by reference — pushing a week onto it and
  // calling the app's own reloadAndRender() is what "the real weekly numbers get entered"
  // looks like from in here.
  const served = JSON.parse(JSON.stringify(SAVED_WEEKS));
  const env = await boot({ weeks: served });
  env.served = served;
  env.ctx.window.showTab("fb");
  env.ctx.buildCampaignSelector();
  el(env, "campaignSel").value = campaign || CAMP;
  env.ctx.renderCampaign();
  return env;
}

(async () => {
  /* ================= 0. the build stamp ================= */
  // v108 relaxed this from the pinned v107 stamp to "at least v107" — the newest version's
  // test pins the exact stamp, older ones only assert the suite hasn't gone backwards.
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(MONTHLY);
  assert.ok(stamp && Number(stamp[1]) >= 107, "monthly.html stamped v107 or later");
  assert.ok(WEEKLY.includes("build v" + stamp[1] + " · " + stamp[2]), "index.html carries the same stamp");

  /* ================= 1. the panel pre-fills from the SAVED figures ================= */
  {
    const env = await open();
    const { ctx } = env;

    // the actuals the app reads are the saved record, summed — and a fresh object each time,
    // so nothing can hold a reference into a week and mutate it
    const a = ctx.campaignActuals(CAMP);
    Object.keys(ACTUAL).forEach((k) =>
      assert.strictEqual(a[k], ACTUAL[k], `campaignActuals.${k} sums the saved weeks (${ACTUAL[k]})`));
    assert.notStrictEqual(ctx.campaignActuals(CAMP), a, "campaignActuals returns a fresh object every call");

    // before opening: no override, no panel, and the card shows the real (understated) picture
    assert.strictEqual(ctx.__fbState.override, null, "no override before the panel is opened");
    assert.strictEqual(el(env, "mwcPanel").hidden, true, "panel starts hidden");
    assert.ok(/£330\.00/.test(cardHtml(env)), "the real view shows the understated £330 CPA");
    assert.ok(!/camp-override/.test(cardHtml(env)), "no override banner on the real view");

    ctx.mwcOpenPanel();

    assert.strictEqual(el(env, "mwcPanel").hidden, false, "panel is shown");
    const o = ctx.__fbState.override;
    assert.ok(o, "an override object now exists");
    assert.strictEqual(o.campaign, CAMP, "the override is scoped to the selected campaign");
    Object.keys(ACTUAL).forEach((k) =>
      assert.strictEqual(o[k], ACTUAL[k], `override pre-fills ${k} from the saved figures (${ACTUAL[k]})`));

    // …and the pre-fill is visible in the fields, not just in memory
    const h = panelHtml(env);
    [["adSpend", 660], ["impressions", 36000], ["linkClicks", 900], ["leads", 60], ["sales", 2]].forEach(([k, v]) => {
      assert.ok(h.includes(`id="mwcIn_${k}"`), `a field for ${k} is rendered`);
      assert.ok(new RegExp(`id="mwcIn_${k}"[^>]*value="${v}"`).test(h), `${k} field pre-filled with the saved ${v}`);
    });
    // every campaign-to-date figure is represented: the five inputs plus every derived one
    ["Blended CPA", "Blended CPL", "Lead to sale", "Page conversion", "Link CTR", "Revenue", "ROAS"]
      .forEach((lab) => assert.ok(panelHtml(env).includes(lab), `the derived strip shows ${lab}`));

    // opening changes nothing about what's displayed yet — it's still the actuals
    assert.ok(/£330\.00/.test(cardHtml(env)), "a freshly-opened panel shows the actual CPA unchanged");
    assert.ok(panelHtml(env).includes("Showing your actual saved figures"), "and says so");
  }

  /* ================= 2. editing recalculates through the REAL formulas ================= */
  {
    const env = await open();
    const { ctx } = env;
    ctx.mwcOpenPanel();

    // the mid-week correction: 2 more sales have landed than the record knows about
    ctx.mwcEdit("sales", "4");

    // the yardstick — fbCalc() called directly on the overridden figures. Every number shown,
    // in the panel AND on the card, has to equal this exactly.
    const m = ctx.fbCalc({ adSpend: 660, impressions: 36000, linkClicks: 900, leads: 60, sales: 4 });
    assert.strictEqual(Math.round(m.cpa * 100) / 100, 165, "sanity: fbCalc puts the true CPA at £165");
    assert.strictEqual(m.revenue, 4 * PROGRAM_PRICE, "sanity: revenue is sales × programme price");

    const p = panelHtml(env), c = cardHtml(env);
    const shows = (where, label, text) => assert.ok(where.includes(text), `${label} shows ${text}`);
    shows(p, "the panel", "£" + m.cpa.toFixed(2));
    shows(p, "the panel", "£" + m.cpl.toFixed(2));
    shows(p, "the panel", m.leadSale.toFixed(1) + "%");
    shows(p, "the panel", m.pageConv.toFixed(1) + "%");
    shows(p, "the panel", m.ctr.toFixed(2) + "%");
    shows(p, "the panel", m.roas.toFixed(2) + "×");
    shows(c, "the card", "£" + m.cpa.toFixed(2));
    shows(c, "the card", "£" + m.cpl.toFixed(2));
    shows(c, "the card", m.leadSale.toFixed(1) + "%");
    shows(c, "the card", m.roas.toFixed(2) + "×");
    assert.ok(!/£330\.00/.test(c), "the understated CPA is gone from the card");

    // a second, independent edit — spend as well as sales — still tracks fbCalc exactly
    ctx.mwcEdit("adSpend", "742.5");
    const m2 = ctx.fbCalc({ adSpend: 742.5, impressions: 36000, linkClicks: 900, leads: 60, sales: 4 });
    assert.ok(panelHtml(env).includes("£" + m2.cpa.toFixed(2)), "CPA re-derives again from the edited spend");
    assert.ok(cardHtml(env).includes("£" + m2.cpa.toFixed(2)), "and the card follows");
    assert.ok(cardHtml(env).includes("£" + m2.cpl.toFixed(2)), "so does cost-per-lead");

    // a blank field reads as 0 rather than NaN-ing the whole panel
    ctx.mwcEdit("sales", "");
    assert.strictEqual(ctx.__fbState.override.sales, 0, "a cleared field falls back to 0");
    assert.ok(panelHtml(env).includes("—"), "and CPA degrades to a dash, as it does on the real view");

    // the derived figures are never re-implemented: the calc lives in exactly one place
    const mwcBlock = WEEKLY.slice(WEEKLY.indexOf("v107: MID-WEEK CHECK"), WEEKLY.indexOf("function buildCampaignSelector"));
    assert.ok(/fbCalc\(mwcOverride\)/.test(mwcBlock), "the panel's derived strip comes from fbCalc()");
    const render = WEEKLY.slice(WEEKLY.indexOf("function renderCampaign()"), WEEKLY.indexOf("function buildFbReport"));
    assert.ok(/fbCalc\(t\)/.test(render), "the campaign card comes from fbCalc() too");
    assert.ok(!/PROGRAM_PRICE/.test(render), "renderCampaign no longer re-derives revenue by hand");
    assert.ok(!/PROGRAM_PRICE/.test(mwcBlock), "and neither does the override block");
  }

  /* ================= 3. THE POINT: no write path, saved data untouched ================= */
  {
    const env = await open();
    const { ctx } = env;

    // record EVERY outbound call and every storage write for the whole override session
    const before = snapshot(env);
    const postsBefore = env.posts.length;
    const fetches = [], stores = [];
    const realFetch = ctx.fetch;
    ctx.fetch = (u, o) => { fetches.push(String(u) + " " + ((o && o.method) || "GET")); return realFetch(u, o); };
    const realSet = ctx.localStorage.setItem.bind(ctx.localStorage);
    ctx.localStorage.setItem = (k, v) => { stores.push(k); return realSet(k, v); };

    ctx.mwcOpenPanel();
    ctx.mwcEdit("sales", "4");
    ctx.mwcEdit("adSpend", "742.5");
    ctx.mwcEdit("leads", "71");
    ctx.mwcEdit("impressions", "41000");
    ctx.mwcEdit("linkClicks", "1010");
    ctx.mwcReset();
    ctx.mwcEdit("sales", "9");
    ctx.mwcClose();

    // --- the whole reason this feature is allowed to exist ---
    assert.strictEqual(snapshot(env), before, "the saved weeks are byte-for-byte identical after the override");
    assert.strictEqual(env.posts.length, postsBefore, "nothing was POSTed");
    assert.deepStrictEqual(fetches, [], "the override made no network call at all — not even a read");
    assert.deepStrictEqual(stores, [], "the override wrote nothing to localStorage");

    // and the saved record still reads back exactly as it went in
    const a = ctx.campaignActuals(CAMP);
    Object.keys(ACTUAL).forEach((k) =>
      assert.strictEqual(a[k], ACTUAL[k], `saved ${k} still reads ${ACTUAL[k]} after the override`));
    assert.strictEqual(JSON.parse(before).length, SAVED_WEEKS.length, "sanity: the snapshot really held the weeks");
    assert.deepStrictEqual(campaignsIn(before), SAVED_WEEKS.map((w) => w.fbCampaigns || null),
      "sanity: and the campaign records in it are the planted ones");

    ctx.fetch = realFetch;
    ctx.localStorage.setItem = realSet;
  }

  /* --- the same guarantee at source level: there is no write path to find --- */
  {
    // Scan the CODE, not the prose — the block's own banner comment names the very APIs it
    // promises not to call, and a comment must be able neither to trip this check nor to
    // launder a real violation. Strip both comment forms, then look.
    const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\n)\s*\/\/[^\n]*/g, "$1");
    // start at the banner's opening /*, so de-commenting sees a well-formed comment
    const withComments = WEEKLY.slice(WEEKLY.lastIndexOf("/*", WEEKLY.indexOf("v107: MID-WEEK CHECK")),
      WEEKLY.indexOf("function buildCampaignSelector"));
    const block = decomment(withComments);
    assert.ok(block.length > 1000, "sanity: the override block was actually located");
    assert.ok(/function mwcOpenPanel/.test(block) && /function mwcEdit/.test(block) && /function mwcPaint/.test(block),
      "sanity: and it still holds the override's functions after de-commenting");
    [
      [/Store\s*\.\s*save/, "Store.save"],
      [/\bfetch\s*\(/, "fetch("],
      [/localStorage/, "localStorage"],
      [/method\s*:\s*['"]POST/, "a POST"],
      [/JSON\.stringify/, "serialisation"],
      [/\bWEEKS\s*=[^=]/, "an assignment to WEEKS"],
      [/\bDERIVED\s*=[^=]/, "an assignment to DERIVED"],
      [/\bWEEKS\s*\.\s*(push|splice|sort|pop|shift|unshift)/, "a mutation of WEEKS"],
      [/fbCampaigns\s*\.\s*(push|splice|pop|shift|unshift)/, "a mutation of a week's campaigns"],
    ].forEach(([re, what]) =>
      assert.ok(!re.test(block), "the mid-week check block contains no " + what));

    // the override's inputs can never be picked up by the Facebook SAVE form, which reads
    // .fb-* classes from inside #fbCampaignBlocks
    assert.ok(/class="mwc-in"/.test(block), "the override inputs use their own mwc-in class");
    assert.ok(!/fb-adSpend|fb-leads|fb-sales|fb-impressions|fb-linkClicks/.test(block),
      "and never reuse a class the FB save form selects on");
    const wrap = WEEKLY.slice(WEEKLY.indexOf('<div id="campaignWrap"'), WEEKLY.indexOf("</div><!-- /fbView -->"));
    assert.ok(wrap.includes('<div id="mwcPanel"'), "the panel lives in the campaign-to-date section…");
    assert.ok(!wrap.includes("fbCampaignBlocks"), "…nowhere near the FB entry form's blocks");

    // The override state is not merely unused by the outbound paths — it is UNREACHABLE from
    // them: every mention of it in the whole page lies inside the block above. So nothing that
    // leaves the page (the copied FB report, the AI acquisition engine's payload, any save)
    // can be reading it, whatever it does internally.
    const lo = WEEKLY.indexOf(withComments), hi = lo + withComments.length;
    const mentions = [...WEEKLY.matchAll(/mwcOverride/g)].map((m) => m.index);
    assert.ok(mentions.length >= 8, "sanity: the override state is referenced at all");
    mentions.forEach((i) => assert.ok(i >= lo && i < hi,
      "every mwcOverride reference in index.html is inside the mid-week check block (stray one at " + i + ")"));
    assert.ok(!/mwcOverride/.test(WEEKLY.slice(WEEKLY.indexOf("function buildFbReport"))),
      "the copied FB report — which does leave the page — never sees it");
  }

  /* ================= 4. every exit discards it ================= */
  {
    // --- the ✕ / toggle: close and it's gone ---
    const env = await open();
    const { ctx } = env;
    ctx.mwcOpenPanel();
    ctx.mwcEdit("sales", "4");
    assert.ok(/camp-override/.test(cardHtml(env)), "while overridden the card carries the banner");
    assert.ok(cardHtml(env).includes("not your saved record"), "worded so it can't be mistaken for real");
    assert.ok(panelHtml(env).includes("Mid-week check — not saved"), "and the panel is headed the same way");
    assert.ok(panelHtml(env).includes("1 figure overridden"), "the footnote counts what's been changed");

    ctx.mwcClose();
    assert.strictEqual(ctx.__fbState.override, null, "closing discards the override");
    assert.strictEqual(el(env, "mwcPanel").hidden, true, "the panel is hidden");
    // every piece of it is emptied — panel shell, derived strip and footnote alike — so no
    // element is left anywhere still holding a what-if number
    assert.strictEqual(panelHtml(env), "", "and emptied, so nothing stale can be re-shown");
    assert.strictEqual(el(env, "mwcDerived").innerHTML, "", "the derived strip is cleared");
    assert.strictEqual(el(env, "mwcFoot").textContent, "", "the footnote is cleared");
    assert.ok(!/camp-override/.test(cardHtml(env)), "the banner is gone");
    assert.ok(/£330\.00/.test(cardHtml(env)), "the card is back to the real saved CPA");

    // re-opening pre-fills from the record again, not from what was typed
    ctx.mwcOpenPanel();
    assert.strictEqual(ctx.__fbState.override.sales, ACTUAL.sales, "re-opening re-reads the saved sales, not the 4 that were typed");
    assert.ok(new RegExp('id="mwcIn_sales"[^>]*value="2"').test(panelHtml(env)), "the field is pre-filled from the record again");

    // --- Reset to actual ---
    ctx.mwcEdit("sales", "4");
    ctx.mwcEdit("adSpend", "742.5");
    assert.deepStrictEqual(Array.from(ctx.mwcDirtyKeys()).sort(), ["adSpend", "sales"], "both edits are tracked as dirty");
    ctx.mwcReset();
    assert.deepStrictEqual(Array.from(ctx.mwcDirtyKeys()), [], "reset clears every edit");
    Object.keys(ACTUAL).forEach((k) =>
      assert.strictEqual(ctx.__fbState.override[k], ACTUAL[k], `reset restores ${k} from the saved record`));
    assert.strictEqual(el(env, "mwcIn_sales").value, 2, "the visible field is reset too");
    assert.ok(/£330\.00/.test(cardHtml(env)), "and the card shows the actual CPA again");
    assert.ok(panelHtml(env).includes("Showing your actual saved figures"), "the footnote says these are the real numbers");
    // reset keeps the panel open — it's a correction, not a close
    assert.strictEqual(el(env, "mwcPanel").hidden, false, "the panel stays open after a reset");
    // …and DELIBERATELY keeps the banner. It marks "you are in a mid-week check", not "the
    // digits differ right now": the panel is still live and one keystroke from what-if again,
    // so the conservative reading is the safe one. The footnote above carries the finer
    // distinction. Closing the panel is what takes the banner away.
    assert.ok(/camp-override/.test(cardHtml(env)), "the banner stays while the panel is open, even at actuals");
    ctx.mwcClose();
    assert.ok(!/camp-override/.test(cardHtml(env)), "closing is what clears it");
  }
  {
    // --- switching campaign ---
    const env = await open();
    const { ctx } = env;
    ctx.mwcOpenPanel();
    ctx.mwcEdit("sales", "9");
    el(env, "campaignSel").value = OTHER;
    ctx.buildCampaignSelector();   // the same rebuild the page does when the selection/data moves
    assert.strictEqual(ctx.__fbState.override, null, "changing campaign discards the override");
    el(env, "campaignSel").value = CAMP;
    ctx.renderCampaign();
    assert.ok(/£330\.00/.test(cardHtml(env)), "coming back shows the real figures");
    // an override belongs to ONE campaign — it can never bleed onto another
    ctx.mwcOpenPanel();
    ctx.mwcEdit("sales", "9");
    const other = ctx.campaignFigures(OTHER);
    assert.strictEqual(other.overridden, false, "the other campaign is not overridden");
    assert.strictEqual(other.figures.sales, 1, "and shows its own saved sales");
  }
  {
    // --- leaving the Facebook tab, and collapsing the section ---
    // Both routes funnel through mwcAbandon(); the stub DOM can't dispatch the real click, so
    // the wiring is pinned at source level and the behaviour is driven directly.
    assert.ok(/if\(which!=='fb'\) mwcAbandon\(\);/.test(WEEKLY), "leaving the FB tab calls mwcAbandon()");
    assert.ok(/if\(!open && t==='campaignToggle'\) mwcAbandon\(\);/.test(WEEKLY), "collapsing the section calls mwcAbandon()");
    assert.ok(/onclick="mwcClose\(\)"/.test(WEEKLY), "the ✕ closes and discards");
    assert.ok(/onclick="mwcReset\(\)"/.test(WEEKLY), "the reset button is wired to mwcReset()");
    assert.ok(/onclick="mwcToggle\(\)"/.test(WEEKLY), "the Mid-week check button opens the panel");

    const env = await open();
    const { ctx } = env;
    ctx.mwcOpenPanel();
    ctx.mwcEdit("sales", "4");
    ctx.window.showTab("kpi");   // the real tab switcher
    assert.strictEqual(ctx.__fbState.override, null, "leaving the view discards the override");
    assert.strictEqual(el(env, "mwcPanel").hidden, true, "and closes the panel");
    assert.ok(/£330\.00/.test(cardHtml(env)), "the card behind it is back to the saved numbers");

    ctx.window.showTab("fb");
    assert.strictEqual(ctx.__fbState.override, null, "coming back, there is still no override");
    assert.ok(!/camp-override/.test(cardHtml(env)), "and no banner");
  }

  /* ================= 5. entering the real weekly figures is unaffected ================= */
  {
    const env = await open();
    const { ctx } = env;

    // an override is live and heavily edited when the week's real numbers get entered
    ctx.mwcOpenPanel();
    ctx.mwcEdit("sales", "4");
    ctx.mwcEdit("adSpend", "742.5");
    ctx.mwcEdit("leads", "71");

    // the real entry: the week the override was pretending about is now properly recorded —
    // 2 sales and £180 spend — and the app reloads exactly as it does after "Save Facebook
    // numbers". Note the numbers entered are the TRUTH, and bear no relation to what was typed
    // into the override.
    const NEW_WEEK = wk("2026-08-08", {
      adSpend: 180, leads: 12,
      fbCampaigns: [{ campaign: CAMP, adSpend: 180, impressions: 9000, linkClicks: 240, leads: 12, sales: 2 }],
    });
    env.served.push(NEW_WEEK);
    await ctx.reloadAndRender("2026-08-08");
    ctx.buildCampaignSelector();
    el(env, "campaignSel").value = CAMP;
    ctx.renderCampaign();

    // the reload dropped the override…
    assert.strictEqual(ctx.__fbState.override, null, "saving real numbers discards any live override");
    assert.ok(!/camp-override/.test(cardHtml(env)), "and clears the banner");

    // …and the new totals are the pure sum of the SAVED weeks. Nothing typed in the override
    // (742.5 spend, 4 sales, 71 leads) contributed a single unit.
    const a = ctx.campaignActuals(CAMP);
    assert.strictEqual(a.adSpend, ACTUAL.adSpend + 180, "spend = saved weeks only");
    assert.strictEqual(a.sales, ACTUAL.sales + 2, "sales = saved weeks only — the typed 4 left no trace");
    assert.strictEqual(a.leads, ACTUAL.leads + 12, "leads = saved weeks only");
    assert.strictEqual(a.impressions, ACTUAL.impressions + 9000, "impressions = saved weeks only");
    assert.strictEqual(a.linkClicks, ACTUAL.linkClicks + 240, "clicks = saved weeks only");
    assert.strictEqual(a.weeks, ACTUAL.weeks + 1, "and one more week ran");

    // the real CPA now that the sales are properly recorded — £840 / 4 = £210
    const m = ctx.fbCalc(a);
    assert.strictEqual(Math.round(m.cpa * 100) / 100, 210, "the real CPA once the week is entered");
    assert.ok(cardHtml(env).includes("£210.00"), "and that is what the card shows");

    // the underlying record itself is exactly what was saved, override or no override
    assert.deepStrictEqual(campaignsIn(snapshot(env)), env.served.map((w) => w.fbCampaigns || null),
      "the stored campaign figures are exactly what was saved — no override value reached them");
  }

  console.log("v107-midweek-check.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
