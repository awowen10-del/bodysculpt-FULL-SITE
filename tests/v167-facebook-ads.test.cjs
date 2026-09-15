// v167 — Facebook Ads: the ad-intelligence tool, moved into the dashboard.
//
// Ash: "copy the project we've already created called 'bodysculpt-ad-intelligence' … and
// move it to the dashboard. I want everything in one place. The move must also match the
// theme." Then: "Let's rebuild it. Drop the login, it's fine. Content — park it for now."
//
// What moved and how:
//   · the SERVER — data, scoring, database, nightly Meta sync, Daily Ad Check — came across
//     as-is into netlify/ads/src, driven by seven `ads-*` functions and reached at
//     /api/ads/…; the login was removed at its one seam (openAuth.ts), nowhere else;
//   · the FRONT END was rebuilt as ads.html in this suite's idiom: one file, plain
//     JavaScript, the shared rail and tokens — held here to every rule the other pages
//     keep (one palette, no literal colour, sprite icons, no retired glyphs);
//   · the page adds no arithmetic and no judgement of its own: every label, number and
//     sentence arrives finished from the API. The grouping and ordering rules it DOES
//     carry (campaign tiers, lifecycle, delivery pill) are the old CampaignView's, and
//     are run below against fixtures so they cannot drift.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const ADS = read("ads.html"), DAILY = read("daily.html");
const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));
const scriptOf = (src) => src.slice(src.lastIndexOf("<script>") + 8, src.lastIndexOf("</script>"));
function paletteOf(style) { const i = style.indexOf("  :root{", style.indexOf("  :root{") + 1); return style.slice(i, style.indexOf("\n  }\n", i)); }
function metricsOf(style) { const i = style.indexOf("  :root{"); return style.slice(i, style.indexOf("\n  }\n", i)); }
const tokensOf = (block) => Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+):([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const RETIRED_GLYPHS = ["✕", "▸", "▾", "▲", "▼", "◐", "▶", "×", "\u{1F4C5}", "\u{1F4CD}", "\u{1F525}", "⚠", "↻", "\u{1F517}"];

(async () => {
  /* ================= 0. the stamp ================= */
  const text = "build v170 · scheduling";
  for (const f of ["monthly.html", "index.html", "finances.html", "daily.html", "social.html", "ads.html"]) {
    assert.ok(read(f).includes(text), f + " carries the stamp");
  }

  /* ================= 1. the page keeps the suite's rules ================= */
  {
    const style = styleOf(ADS), label = "ads.html: ";
    assert.strictEqual((style.match(/\n  :root\{/g) || []).length, 2, label + "two :root blocks — metrics and palette");
    assert.strictEqual(paletteOf(style), paletteOf(styleOf(DAILY)), label + "the palette is byte-identical to daily.html's");
    assert.strictEqual(metricsOf(style), metricsOf(styleOf(DAILY)), label + "…and so are the metric scales");
    const bare = style.replace(/\/\*[\s\S]*?\*\//g, "");
    const defined = new Set([...Object.keys(tokensOf(paletteOf(style))), ...Object.keys(tokensOf(metricsOf(style)))]);
    for (const m of bare.matchAll(/var\((--[a-z0-9-]+)[,)]/g)) assert.ok(defined.has(m[1]), label + m[1] + " is used and defined");
    const rest = bare.replace(paletteOf(style).replace(/\/\*[\s\S]*?\*\//g, ""), "");
    assert.strictEqual(rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g), null, label + "no literal colour outside the palette");
    // the v162 rail block and the v121 base are the shared ones, byte for byte
    const railOf = (s) => s.slice(s.indexOf("  /* ===================== v162: THE SIDE NAV"), s.indexOf("  @media(max-width:900px){"));
    assert.strictEqual(railOf(style), railOf(styleOf(DAILY)), label + "the rail's CSS is the shared block");
    // icons: every one used resolves; none is an emoji or a typographic stand-in
    const sprite = /<svg width="0" height="0"[\s\S]*?<\/defs><\/svg>/.exec(ADS);
    const syms = new Set([...sprite[0].matchAll(/<symbol id="(ic-[a-z-]+)"/g)].map((m) => m[1]));
    for (const m of ADS.matchAll(/href="#(ic-[a-z-]+)"/g)) assert.ok(syms.has(m[1]), label + "#" + m[1] + " resolves");
    for (const m of sprite[0].matchAll(/<symbol id="(ic-[a-z-]+)"[^>]*>/g)) {
      assert.ok(/currentColor/.test(m[0]) && /viewBox="0 0 24 24"/.test(m[0]), label + m[1] + " is a currentColor icon on the 24 grid");
    }
    const body = stripComments(ADS);
    for (const g of RETIRED_GLYPHS) assert.ok(!body.includes(g), label + "no " + JSON.stringify(g) + " standing in for an icon");
    assert.ok(syms.has("ic-play") && syms.has("ic-megaphone"), label + "the play and megaphone icons are on the sprite");
    // no import of anything — one file, like the others
    assert.ok(!/<script src=|<link rel="stylesheet" href="(?!https:\/\/fonts)/.test(ADS), label + "one file, no bundles");
  }

  /* ================= 2. the page talks to one place, and judges nothing ================= */
  {
    const js = scriptOf(ADS), label = "ads.html: ";
    assert.ok(/const ADS = "\/api\/ads";/.test(js), label + "the API base is fixed");
    const fetches = [...js.matchAll(/fetch\(([^,)]+)/g)].map((m) => m[1].trim());
    assert.ok(fetches.length >= 2, label + "the page fetches");
    for (const f of fetches) assert.strictEqual(f, "ADS + path", label + "every fetch is ADS + path: " + f);
    assert.strictEqual((js.match(/method: "POST"/g) || []).length, 1, label + "one POST funnel (apost), for Sync now and Generate");
    // no arithmetic on metric values: the page never turns a display string into a number
    // except to ORDER campaigns by spend, which is the old view's own rule
    const numberCalls = [...js.matchAll(/Number\(([^)]*)\)/g)].map((m) => m[1]);
    assert.deepStrictEqual(numberCalls, ["m[3]", "m[2]", "s.value"], label + "the only Number() calls are a date's day and month, and the spend sort");
    assert.ok(!/toFixed|Math\.round|\* 100|\/ 100/.test(js), label + "no rounding, no percentages, no maths of its own");
    // identity, delivery, liveness, pausing: the server's predicates, in the same words
    assert.ok(/return \/\[1-9\]\/\.test\(String\(m\.value\)\);/.test(js), label + "isPositive scans for a non-zero digit, as the server does");
    assert.ok(/statusOf\(c\) === "ACTIVE" && !campaignHasEnded\(c\)/.test(js), label + "live = ACTIVE and not past its schedule end");
    assert.ok(/\.toUpperCase\(\)\.includes\("PAUSED"\)/.test(js), label + "paused = PAUSED anywhere in the effective status");
    assert.ok(/row\.context\.adName \|\| row\.creative\.headline \|\| \("Ad …"/.test(js), label + "a title is the ad name, then the headline, then a short id");
  }

  /* ================= 3. the grouping rules, run ================= */
  {
    const js = scriptOf(ADS);
    // the app script wires the page on load; give it a document that swallows that, and
    // pull the pure functions out
    const el = () => ({ addEventListener() {}, innerHTML: "", hidden: false, textContent: "", value: "", disabled: false, className: "", classList: { add() {}, toggle() {} } });
    const ctx = {
      document: { getElementById: el, addEventListener() {}, documentElement: { classList: { contains: () => false, toggle() {} } }, body: { classList: { contains: () => false, toggle() {} } } },
      localStorage: { getItem: () => null, setItem() {} },
      window: { location: { search: "", pathname: "/ads.html" }, addEventListener() {}, history: { pushState() {}, replaceState() {} }, scrollTo() {} },
      fetch: () => new Promise(() => {}), setTimeout, clearTimeout, URLSearchParams, console,
    };
    vm.createContext(ctx);
    vm.runInContext(js + "\n;globalThis.__f = { groupByCampaign, groupByAdSet, filterGroups, orderGroups, tierOf, lifecycle, deliveryNote, isPositive, creativeTitle, adIsPaused, rowMatches, humanStatus, fmtDate };", ctx);
    const F = ctx.__f;
    const m = (v) => ({ available: v !== null, display: String(v), value: v === null ? null : String(v) });
    const row = (rowId, campaignId, adSetId, adSetName, spend, adName, adStatus) => ({
      rowId, creative: { id: "cr" + rowId, headline: "H " + rowId, videoId: null }, latestDeliveryDate: "2026-09-14",
      context: { campaignId, campaignName: "Camp " + campaignId, adSetId, adSetName, adName, adStatus, adSetStatus: "ACTIVE" },
      metrics: { spend: m(spend), impressions: m(spend === 0 ? 0 : 100) },
      evaluation: { eligibility: "eligible", decision: { decision: "winner" } },
    });
    const camp = (id, name, status, latest, spend, scheduleEnd) => ({ id, name, status, effectiveStatus: status, latestDeliveryDate: latest, scheduleEnd: scheduleEnd || null, metrics: { spend: m(spend), impressions: m(spend ? 1 : 0) } });
    const rows = [row("a", "c1", "s1", "Women", 40, "A", "ACTIVE"), row("b", "c1", "s2", "Men", 0, null, "ADSET_PAUSED"), row("c", "c2", "s3", "Broad", 0, "C", "ACTIVE"), row("d", "c3", "s4", "Old", 900, "D", "ACTIVE")];
    const camps = [camp("c1", "Live", "ACTIVE", "2026-09-14", 40), camp("c2", "Quiet", "ACTIVE", null, 0), camp("c3", "Done", "ACTIVE", "2026-04-30", 900, "2026-05-01T00:00:00Z"), camp("c9", "Empty", "PAUSED", null, 0)];

    assert.ok(F.isPositive(m("0.00")) === false && F.isPositive(m("12.50")) === true && F.isPositive(m(null)) === false, "isPositive: a non-zero digit, or nothing");
    assert.strictEqual(F.creativeTitle(rows[1]), "H b", "no ad name → the headline");
    assert.strictEqual(F.creativeTitle({ creative: { id: "1234567890" }, context: {} }), "Ad …567890", "no headline either → a short id");
    assert.ok(F.adIsPaused(rows[1].context) && !F.adIsPaused(rows[0].context), "ADSET_PAUSED counts as paused");

    const groups = F.groupByCampaign(rows, camps);
    assert.deepStrictEqual([...groups.map((g) => g.key)], ["c1", "c2", "c3"], "one group per campaign that has rows — an empty campaign gets none");
    assert.deepStrictEqual([...F.groupByAdSet(groups[0].rows).map((g) => g.name)], ["Men", "Women"], "ad sets sort by name");
    assert.deepStrictEqual([...groups.map(F.tierOf)], [0, 1, 2], "tiers: live+delivering 0 · live, quiet 1 · ended but delivered 2");
    assert.deepStrictEqual([...groups.map((g) => F.lifecycle(g.campaign)[0])], ["Active", "Active", "Completed"], "a campaign past its schedule end reads Completed, never Active");
    assert.deepStrictEqual([...F.lifecycle(camps[3])], ["Paused", "paused"], "PAUSED reads Paused");
    // v168: the delivery clause is a sentence, and a paused campaign is never "delivering"
    assert.strictEqual(F.deliveryNote(groups[2], true), "delivered until 30 Apr 2026", "a finished campaign's delivery is past tense");
    assert.strictEqual(F.deliveryNote(groups[1], false), "no delivery in this window", "…a quiet live one says so");
    assert.strictEqual(F.deliveryNote(groups[0], true), "delivering", "…and only a live, delivering one says delivering");
    assert.strictEqual(F.deliveryNote({ campaign: camps[3], rows: [] }, true), "never delivered", "a paused campaign with no delivery date says never");
    assert.strictEqual(F.deliveryNote({ campaign: { ...camps[3], latestDeliveryDate: "2026-09-05" }, rows: [] }, true), "last delivered 5 Sept 2026", "…and one that did says when — never 'delivering'");
    // statuses in words, dates as dates
    assert.deepStrictEqual(["CAMPAIGN_PAUSED", "ADSET_PAUSED", "PAUSED", "ACTIVE", "IN_PROCESS", null].map(F.humanStatus),
      ["Paused (campaign)", "Paused (ad set)", "Paused", "Active", "In process", "—"], "Meta's enums read as words");
    assert.strictEqual(F.fmtDate("2026-09-05"), "5 Sept 2026", "an ISO date reads as a date");
    assert.strictEqual(F.fmtDate(null), "—", "…and no date is a dash");
    assert.deepStrictEqual([...F.filterGroups(groups, "active").map((g) => g.key)], ["c1", "c2"], "Active only drops the completed one");
    assert.deepStrictEqual([...F.filterGroups(groups, "active-recent").map((g) => g.key)], ["c1", "c2", "c3"], "Active + recent keeps anything that delivered in the window");
    assert.deepStrictEqual([...F.orderGroups(groups.slice().reverse(), "active").map((g) => g.key)], ["c1", "c2", "c3"], "the default order is live-first");
    assert.deepStrictEqual([...F.orderGroups(groups, "spend").map((g) => g.key)], ["c3", "c1", "c2"], "highest spend first");
    assert.deepStrictEqual([...F.orderGroups(groups, "name").map((g) => g.name)], ["Done", "Live", "Quiet"], "by name");
    assert.ok(F.rowMatches(rows[0], "women") && !F.rowMatches(rows[0], "zzz"), "search reads campaign, ad, ad set and headline");
  }

  /* ================= 3b. v168: the card's hierarchy ================= */
  {
    const js = scriptOf(ADS), label = "ads.html: ";
    const card = js.slice(js.indexOf("function cardHtml("), js.indexOf("function renderList("));
    assert.strictEqual((card.match(/evalBadge\(row\)/g) || []).length, 1, label + "a card carries ONE verdict pill");
    assert.ok(!/ctrBadge\(/.test(card), label + "…the Link CTR rating rides with its number, not as a second pill");
    assert.ok(/class="cc-hero-n">' \+ metric\(d\.cpl\)/.test(card), label + "cost per lead is the hero number");
    assert.ok(/target <b>' \+ esc\(d\.settings\.targetCpl\)/.test(card), label + "…set against the target it is judged by");
    assert.ok(!/adSetName/.test(card), label + "the ad set is not repeated on every card under its own heading");
    assert.ok(/humanStatus\(ctx\.adStatus\)/.test(card) && !/esc\(ctx\.adStatus/.test(card), label + "the status is words, never the raw enum");
    assert.ok(/fmtDate\(row\.latestDeliveryDate\)/.test(card), label + "the last-delivery date is a date");
    assert.ok(!/adStatus \|\| "—"/.test(card), label + "no raw status fact");
    const style = styleOf(ADS);
    assert.ok(/\.cc\.paused \.cc-prev\{filter:grayscale\(1\)/.test(style), label + "paused fades the picture, not the words");
    assert.ok(!/\.cc\.paused\{opacity/.test(style), label + "…the whole card is no longer greyed out");
    assert.ok(/\.cc-reason\{[^}]*-webkit-line-clamp:3/.test(style), label + "the reason is clamped to three lines (the full text is a hover and a click away)");
  }

  /* ================= 4. the server move ================= */
  {
    const fn = (f) => read("netlify/functions/" + f);
    for (const f of ["ads-api", "ads-daily-check", "ads-daily-check-background", "ads-sync-background", "ads-sync-scheduled", "ads-sync-status", "ads-sync-trigger"]) {
      assert.ok(fs.existsSync(path.join(__dirname, "..", "netlify", "functions", f + ".ts")), f + ".ts exists");
      assert.ok(!/SESSION_SECRET|DASHBOARD_PASSWORD/.test(fn(f + ".ts").replace(/\/\*[\s\S]*?\*\//g, "")), f + " reads no login secret");
      assert.ok(/from '\.\.\/ads\/src\//.test(fn(f + ".ts")), f + " imports the moved server code");
    }
    assert.ok(!fs.existsSync(path.join(__dirname, "..", "netlify", "ads", "src", "server", "session.ts")), "the cookie session is gone");
    const open = read("netlify/ads/src/server/openAuth.ts");
    assert.ok(/return \{ subject: 'owner' \}/.test(open), "the auth seam answers 'owner' — the dashboard has no login");
    for (const f of ["server/handleEvent.ts", "server/dailyCheck/handleDailyCheck.ts", "server/sync/handleSyncStatus.ts", "server/sync/handleSyncTrigger.ts"]) {
      const s = read("netlify/ads/src/" + f);
      assert.ok(/createOpenAuthenticator/.test(s) && !/session\.ts/.test(s), f + " uses the open seam");
    }
    assert.ok(!/path === '\/api\/log(in|out)'/.test(read("netlify/ads/src/server/handleEvent.ts")), "no login routes");
    // the sync's write path is still locked to its shared secret
    assert.ok(/x-sync-trigger'\] === expected/.test(fn("ads-sync-background.ts")), "sync-background still demands SYNC_TRIGGER_SECRET");
    assert.ok(!/react|import\.meta|vite/i.test([...fs.readdirSync(path.join(__dirname, "..", "netlify", "ads", "src", "server"))].join(" ")), "no front-end code came along");
    // the API's namespace, and the routing to it
    assert.ok(/'\/api\/ads'/.test(read("netlify/ads/src/server/adapter.ts")), "the adapter normalises /api/ads/… to the router's /api/…");
    const toml = read("netlify.toml");
    for (const [from, to] of [["/api/ads/daily-check/generate", "ads-daily-check-background"], ["/api/ads/daily-check", "ads-daily-check"], ["/api/ads/sync-status", "ads-sync-status"], ["/api/ads/sync-trigger", "ads-sync-trigger"], ["/api/ads/*", "ads-api/:splat"]]) {
      assert.ok(new RegExp('from = "' + from.replace(/[*/]/g, (c) => "\\" + c) + '"\\n  to = "/\\.netlify/functions/' + to.replace(/[*/:]/g, (c) => "\\" + c) + '"').test(toml), from + " → " + to);
    }
    assert.ok(toml.indexOf('from = "/api/ads/daily-check/generate"') < toml.indexOf('from = "/api/ads/*"'), "the specific routes come before the catch-all");
    assert.ok(/\[functions\."ads-sync-scheduled"\]\n  schedule = "0 4 \* \* \*"/.test(toml), "the nightly sync is scheduled");
    const pkg = JSON.parse(read("package.json"));
    for (const d of ["drizzle-orm", "postgres", "zod", "@anthropic-ai/sdk"]) assert.ok(pkg.dependencies[d], "dependency " + d);
    assert.ok(pkg.devDependencies.typescript, "typescript is here to check the moved code");
    // the harness type-checks it on every run
    assert.ok(/netlify", "ads", "tsconfig\.json"/.test(read("tests/run-all.cjs")), "run-all runs tsc over netlify/ads");
    assert.ok(/GOOGLE_CLIENT_SECRET|SYNC_TRIGGER_SECRET/.test(read("ADS-SETUP.md")) && /Do \*\*not\*\* copy `SESSION_SECRET`/.test(read("ADS-SETUP.md")), "the setup doc says which secrets move, and which must not");
  }

  console.log("v167-facebook-ads.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
