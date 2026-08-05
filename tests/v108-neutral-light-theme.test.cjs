// v108: the light theme is re-cut — neutral and structured instead of warm and flat.
//
// v106 built the theme SYSTEM (one token block per page, two sets of values, a toggle) and
// tests/v106-light-theme-system.test.cjs still guards it. This file guards the PALETTE that
// v108 pointed it at, i.e. the things a reviewer would actually look at the screen for:
//
//   1. the full variable set — light defines every token dark does, nothing missing, nothing
//      dangling, and all three pages carry the SAME light block (no per-page drift)
//   2. THREE TIERS OF DEPTH — page (soft cool grey) < card (near-white) with a real tone step
//      between them, a hairline --line that is visible but not heavy, and --navy-2 recessed
//      BELOW the card. This is the fix for the "everything is one magnolia tone" complaint,
//      so it is asserted as tone relationships, not as particular hexes.
//   3. the brand accent is a muted SLATE-BLUE, not terracotta — blue-dominant, desaturated,
//      and far enough from every semantic colour that nothing reads as "the brand"
//   4. the semantic colours still mean what they meant, on the new near-white surfaces:
//      green=personal/training/done, teal=recurring, amber=watch, red=problem, and the two
//      location pills stay apart from each other AND from the brand
//   5. text: a soft near-black, a muted grey for secondary, all of it comfortably readable
//   6. the DARK theme is untouched, the toggle still switches and persists, and nothing about
//      the app's markup, data or writes moved — a re-theme changes colour and nothing else
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/env.cjs");
const { boot: bootMonthly } = require("./lib/monthly-env.cjs");

const FILES = ["index.html", "monthly.html", "quarterly.html"];
const SRC = {};
FILES.forEach((f) => { SRC[f] = fs.readFileSync(path.join(__dirname, "..", f), "utf8"); });
const WEEKLY = SRC["index.html"], MONTHLY = SRC["monthly.html"];

const DARK_SEL = ':root,:root[data-theme="dark"]';
const LIGHT_SEL = ':root[data-theme="light"]';

const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));
function blockOf(src, sel) {
  const i = src.indexOf(sel + "{");
  assert.ok(i > 0, "block " + sel + " exists");
  return src.slice(i, src.indexOf("\n  }", i));
}
function tokensOf(block) {
  const out = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const rgbOf = (h) => { h = h.replace("#", ""); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const l1 = lum(rgbOf(a)), l2 = lum(rgbOf(b)); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
const dist = (a, b) => rgbOf(a).reduce((s, c, i) => s + Math.abs(c - rgbOf(b)[i]), 0);
// how colourful a token is, 0 (pure grey) .. 1 (fully saturated)
const sat = (h) => { const c = rgbOf(h), mx = Math.max(...c), mn = Math.min(...c); return mx === 0 ? 0 : (mx - mn) / mx; };

// the accents that carry meaning; --orange is the brand (a token NAME — v108 points it at slate-blue)
const SEMANTIC = ["--teal", "--green", "--amber", "--red", "--blue", "--info", "--loc-warrington"];

(async () => {
  /* ================= 0. the build stamp ================= */
  assert.ok(/<!-- build v108 · neutral-light-theme -->/.test(MONTHLY), "monthly.html stamped v108 · neutral-light-theme");
  assert.ok(/build v108 · neutral-light-theme/.test(WEEKLY), "index.html carries the same stamp");

  /* ================= 1. the full variable set, on every page ================= */
  const lightBlocks = {};
  for (const f of FILES) {
    const style = styleOf(SRC[f]);
    const dark = tokensOf(blockOf(style, DARK_SEL));
    const light = tokensOf(blockOf(style, LIGHT_SEL));
    const label = f + ": ";
    lightBlocks[f] = light;

    assert.ok(Object.keys(light).length >= 45, label + "the light theme defines the whole palette, not a handful of overrides");
    assert.deepStrictEqual(Object.keys(light).sort(), Object.keys(dark).sort(),
      label + "light defines exactly the tokens dark does — none missing, none extra");
    Object.keys(light).forEach((k) => assert.ok(light[k] !== "", label + k + " has a value in light"));

    // nothing the stylesheet asks for is undefined, and no literal colour slipped in with the re-theme
    const defined = new Set([...Object.keys(light), ...Object.keys(tokensOf(blockOf(style, ":root")))]);
    [...style.matchAll(/var\((--[a-z0-9-]+)\)/g)].forEach((m) =>
      assert.ok(defined.has(m[1]), label + m[1] + " is used and defined"));
    const rest = style.replace(blockOf(style, DARK_SEL), "").replace(blockOf(style, LIGHT_SEL), "");
    assert.strictEqual(rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g), null,
      label + "the re-theme introduced no hardcoded colour outside the token blocks");
  }
  // one palette, three pages — a colour fixed on one page can't be left stale on another
  assert.deepStrictEqual(lightBlocks["monthly.html"], lightBlocks["index.html"], "monthly.html carries the same light palette as index.html");
  assert.deepStrictEqual(lightBlocks["quarterly.html"], lightBlocks["index.html"], "quarterly.html carries the same light palette as index.html");

  const L = lightBlocks["index.html"];
  const D = tokensOf(blockOf(styleOf(WEEKLY), DARK_SEL));

  /* ================= 2. three tiers of depth ================= */
  {
    // tier 1: the page is a soft, slightly COOL grey — not beige, not stark white
    const [r, g, b] = rgbOf(L["--navy"]);
    assert.ok(b >= r, "the page background is cool (or neutral), never warm: blue >= red");
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 14, "…and near-neutral — a grey with a hint of cool, not a blue wash");
    assert.ok(lum(rgbOf(L["--navy"])) > 0.8 && lum(rgbOf(L["--navy"])) < 0.95, "…light, but still a tone: the page is not white");
    assert.ok(sat(L["--navy"]) < 0.06, "…and unmistakably grey rather than tinted");

    // tier 2: the card is near-white and lifts off it — this is what killed the flat look
    assert.ok(lum(rgbOf(L["--card"])) >= 0.93, "cards are crisp near-white");
    const step = lum(rgbOf(L["--card"])) - lum(rgbOf(L["--navy"]));
    assert.ok(step >= 0.04, "…and visibly lighter than the page (luminance step " + step.toFixed(3) + ") — no same-tone flatness");
    assert.ok(dist(L["--card"], L["--navy"]) >= 18, "…a real tone difference, not a rounding error");

    // tier 3: a fine hairline defines the card's edge — present, but not a heavy rule
    const edge = contrast(L["--line"], L["--card"]);
    assert.ok(edge >= 1.15, "the border is actually visible against the card (" + edge.toFixed(2) + ")");
    assert.ok(edge <= 2.2, "…but stays a hairline — definition comes from tone + border, not a black outline");
    assert.ok(contrast(L["--line"], L["--navy"]) >= 1.05, "…and reads against the page too, so a card edge never disappears");
    assert.ok(lum(rgbOf(L["--line"])) < lum(rgbOf(L["--navy"])), "…the border is darker than both surfaces it separates");

    // the inset surface inside a card must recede, or nested panels flatten back out
    assert.ok(lum(rgbOf(L["--navy-2"])) < lum(rgbOf(L["--navy"])), "--navy-2 (inset panels, sticky heads) sits below the page tone");
    assert.ok(lum(rgbOf(L["--card-2"])) < lum(rgbOf(L["--card"])), "--card-2 recedes from the card it sits on");
    ["--panel-0", "--panel-1", "--panel-2", "--hero-1", "--hero-2", "--hero-3", "--mark-bg", "--chart-grid"].forEach((k) => {
      assert.ok(sat(L[k]) < 0.12, k + " is a neutral surface tone in light, not a tinted one");
      assert.ok(lum(rgbOf(L[k])) > 0.75, k + " stays a light surface");
    });

    // hover/zebra must DARKEN a light surface (in dark it lightens), and the modal scrim must dim
    const liftDark = L["--lift-rgb"].split(",").map(Number);
    assert.ok(Math.max(...liftDark) < 90, "--lift-rgb is dark, so a hover darkens the surface instead of washing it out");
    const scrim = L["--backdrop-rgb"].split(",").map(Number);
    assert.ok(lum(scrim) < 0.1, "the modal scrim genuinely dims the page behind a popup");
  }

  /* ================= 3. the brand accent is a muted slate-blue ================= */
  {
    const [r, g, b] = rgbOf(L["--orange"]);
    assert.ok(b > r && b > g, "the brand accent is blue-dominant — terracotta is retired from the light theme");
    assert.ok(r < g && g < b, "…a true slate ramp (r < g < b), not a purple or a cyan");
    assert.ok(sat(L["--orange"]) <= 0.62, "…muted and desaturated: calm, not vivid (sat " + sat(L["--orange"]).toFixed(2) + ")");
    assert.ok(contrast(L["--orange"], L["--card"]) >= 4.5, "…readable as a link/heading on a near-white card");
    assert.ok(contrast(L["--on-accent"], L["--orange"]) >= 4.5, "…and white on a solid brand fill (buttons, active tabs) is readable");
    assert.ok(lum(rgbOf(L["--orange-soft"])) < lum(rgbOf(L["--orange"])),
      "--orange-soft is the DEEPER brand tone in light, since it lands on pale tints");
    // the -rgb triple drives every rgba() tint of the brand; if it drifts, tints and solids disagree
    assert.deepStrictEqual(L["--orange-rgb"].split(",").map(Number), rgbOf(L["--orange"]),
      "--orange-rgb matches --orange, so every brand tint follows the brand");
    ["--green", "--teal", "--red", "--amber", "--blue", "--info"].forEach((k) => {
      assert.deepStrictEqual(L[k + "-rgb"].split(",").map(Number), rgbOf(L[k]), k + "-rgb matches " + k);
    });
  }

  /* ================= 4. the semantics survive on white ================= */
  {
    // nothing may collide with the brand…
    SEMANTIC.forEach((k) => assert.ok(dist(L["--orange"], L[k]) >= 85,
      k + " must not read as the slate-blue brand (" + dist(L["--orange"], L[k]) + ")"));
    // …nor with each other
    for (let i = 0; i < SEMANTIC.length; i++) for (let j = i + 1; j < SEMANTIC.length; j++) {
      assert.ok(dist(L[SEMANTIC[i]], L[SEMANTIC[j]]) >= 60,
        SEMANTIC[i] + " vs " + SEMANTIC[j] + " must stay distinct (" + dist(L[SEMANTIC[i]], L[SEMANTIC[j]]) + ")");
    }
    // each still points at the hue its meaning depends on
    const [gr, gg, gb] = rgbOf(L["--green"]);
    assert.ok(gg > gr && gg > gb, "green (personal / training / done) is still green");
    const [tr, tg, tb] = rgbOf(L["--teal"]);
    assert.ok(tb > tr && tg > tr, "teal (recurring) is still teal");
    const [ar, ag, ab] = rgbOf(L["--amber"]);
    assert.ok(ar > ab && ag > ab, "amber (watch / at-risk) is still warm");
    const [rr, rg2, rb] = rgbOf(L["--red"]);
    assert.ok(rr > rg2 && rr > rb, "red (problem / missed) is still red");
    // the two location pills sit side by side, so they get the strictest separation
    assert.ok(dist(L["--blue"], L["--loc-warrington"]) >= 120, "the home and Warrington location pills are unmistakable");
    // readable where they are actually drawn: text on the card, and on the inset panels
    [...SEMANTIC, "--orange", "--tint-red", "--tint-amber", "--tint-green", "--tint-blue", "--tint-orange"].forEach((k) => {
      ["--card", "--navy", "--navy-2"].forEach((bg) => {
        assert.ok(contrast(L[k], L[bg]) >= 3.3, k + " on " + bg + " is readable (" + contrast(L[k], L[bg]).toFixed(2) + ")");
      });
    });
    // white on the solid fills — chips, buttons, active states
    ["--orange", "--green", "--red", "--amber", "--teal", "--blue", "--info"].forEach((k) => {
      assert.ok(contrast(L["--on-accent"], L[k]) >= 4.4, "white on a solid " + k + " fill is readable (" + contrast(L["--on-accent"], L[k]).toFixed(2) + ")");
    });
  }

  /* ================= 5. typography reads ================= */
  {
    assert.ok(lum(rgbOf(L["--ink"])) < 0.05, "body text is dark…");
    assert.ok(Math.max(...rgbOf(L["--ink"])) >= 20, "…but a soft near-black, never #000");
    assert.ok(contrast(L["--ink"], L["--card"]) >= 12, "…with plenty of contrast on a card (" + contrast(L["--ink"], L["--card"]).toFixed(1) + ")");
    assert.ok(lum(rgbOf(L["--ink-strong"])) < lum(rgbOf(L["--ink"])), "--ink-strong is the emphasis tone: darker still");
    assert.ok(sat(L["--ink-dim"]) <= 0.35 && sat(L["--ink-faint"]) <= 0.35, "secondary text is muted grey, not a coloured tint");
    assert.ok(contrast(L["--ink-dim"], L["--card"]) >= 4.5, "secondary text clears AA on a card");
    assert.ok(contrast(L["--ink-faint"], L["--card"]) >= 3.3, "the faintest text is still legible on a card");
    assert.ok(contrast(L["--ink-faint"], L["--navy-2"]) >= 3.3, "…and on the inset panels, where it is most at risk");
    assert.ok(lum(rgbOf(L["--ink-faint"])) > lum(rgbOf(L["--ink-dim"])), "the ink ramp goes strong → ink → dim → faint");
    [["--ink-dim-rgb", "--ink-dim"], ["--ink-faint-rgb", "--ink-faint"], ["--line-rgb", "--line"]].forEach(([t, hex]) => {
      const triple = L[t].split(",").map(Number);
      assert.strictEqual(triple.length, 3, t + " is a bare r,g,b triple");
      assert.ok(dist("#" + triple.map((c) => c.toString(16).padStart(2, "0")).join(""), L[hex]) <= 60,
        t + " tracks " + hex + " — tints and solids stay the same colour");
    });
  }

  /* ================= 6. the dark theme did not move ================= */
  {
    // pinned verbatim: a light-theme change that edits a dark value is a bug, not a re-theme
    const PINNED = {
      "--navy": "#0f1b2d", "--navy-2": "#16273f", "--card": "#1b2c45", "--card-2": "#203552",
      "--line": "#2c405e", "--ink": "#eaf0f8", "--ink-dim": "#9fb1c7", "--ink-faint": "#6b7f99",
      "--ink-strong": "#fff", "--on-accent": "#fff", "--orange": "#e8732a", "--green": "#3fbf7f",
      "--amber": "#e8a93a", "--red": "#e25555", "--teal": "#4fa3b8", "--blue": "#7fa3d4",
      "--info": "#6aa3e8", "--loc-warrington": "#d08c52",
      "--lift-rgb": "255,255,255", "--shadow-rgb": "0,0,0", "--backdrop-rgb": "8,14,24",
    };
    Object.keys(PINNED).forEach((k) => assert.strictEqual(D[k], PINNED[k], "the dark theme's " + k + " is untouched"));
    assert.strictEqual(D["--orange"], "#e8732a", "…terracotta is retired from LIGHT only — dark keeps the original brand");
    // and light is still a re-map of it, not a copy
    Object.keys(D).filter((k) => /^#/.test(D[k]) && k !== "--on-accent")
      .forEach((k) => assert.notStrictEqual(L[k], D[k], k + " is genuinely re-mapped for light"));
  }

  /* ================= 7. the toggle still switches, persists, changes nothing else ========= */
  {
    const env = await boot({ plans: { "2026-08-10": { weekEnding: "2026-08-10" } } });
    await env.ctx.loadWeeklyPlan("2026-08-10");
    await env.settle();
    const root = env.ctx.document.documentElement;
    const btn = env.ctx.document.getElementById("themeToggle");

    assert.strictEqual(env.ctx.bsTheme(), "light", "the page still starts in the light theme");
    const before = {
      html: env.ctx.document.getElementById("wpBody").innerHTML,
      posts: env.posts.length,
      plan: JSON.stringify(env.ctx.__wpState.plan),
    };

    assert.strictEqual(env.ctx.bsToggleTheme(), "dark", "the toggle still switches to dark");
    assert.strictEqual(root.getAttribute("data-theme"), "dark", "…on <html>, which is all the CSS keys off");
    assert.strictEqual(env.ctx.localStorage.getItem("bodysculpt:theme"), "dark", "…and the choice persists");
    assert.strictEqual(btn.textContent, "☀ Light", "…the button offers the way back");
    assert.strictEqual(env.ctx.bsToggleTheme(), "light", "…and back to the new light theme");
    assert.strictEqual(env.ctx.localStorage.getItem("bodysculpt:theme"), "light", "…remembered too");

    /* ---- no behaviour or data change ---- */
    assert.strictEqual(env.ctx.document.getElementById("wpBody").innerHTML, before.html,
      "the rendered week is byte-identical across the re-theme and a theme switch");
    assert.strictEqual(env.posts.length, before.posts, "the re-theme writes nothing");
    assert.strictEqual(JSON.stringify(env.ctx.__wpState.plan), before.plan, "…and the week's data is untouched");

    await env.ctx.loadWeeklyPlan("2026-08-10");
    await env.settle();
    assert.strictEqual(env.ctx.__wpState.plan.weekEnding, "2026-08-10", "the app carries on exactly as before");
  }

  /* ================= 8. …and the same on the Monthly page ================= */
  {
    const env = await bootMonthly({});
    assert.strictEqual(env.ctx.bsTheme(), "light", "monthly.html starts light too");
    assert.strictEqual(env.ctx.bsToggleTheme(), "dark", "…toggles");
    assert.strictEqual(env.ctx.localStorage.getItem("bodysculpt:theme"), "dark", "…and persists under the shared key");
    env.ctx.bsToggleTheme();
    assert.strictEqual(env.ctx.document.documentElement.getAttribute("data-theme"), "light", "…and back");
    // the charts pick their colours from the tokens, so they follow the new palette for free
    assert.ok(/const CHART_TOKENS = \{[\s\S]*?--chart-grid/.test(MONTHLY), "the SVG charts still read theme tokens");
    assert.ok(/function bsThemeRepaint\(\)/.test(MONTHLY), "…and repaint on a switch");
  }

  console.log("v108-neutral-light-theme.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
