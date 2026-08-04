// v106: a warm paper LIGHT theme for all three pages, alongside the original dark navy.
//
// The whole change is a theming layer: every colour in every stylesheet was pulled into one
// token block per page, and the two themes are nothing but two sets of values for the same
// token names. This test pins the properties that make that claim true and keep it true:
//   * no literal colour survives outside the token blocks (so a page can't drift half-themed)
//   * the two themes define exactly the same tokens — no missing token, no dangling var()
//   * the light values are a real RE-MAP: distinct from dark, and the meaning-carrying
//     accents stay distinct FROM EACH OTHER and readable on the light surfaces
//   * the toggle switches, remembers, defaults to light — and changes nothing else
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { boot } = require("./lib/env.cjs");
const { boot: bootMonthly } = require("./lib/monthly-env.cjs");
const { extract } = require("./lib/extract.cjs");

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
// WCAG relative luminance + contrast, for the "is it actually readable" assertions
const rgbOf = (h) => { h = h.replace("#", ""); if (h.length === 3) h = h.split("").map((c) => c + c).join(""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const l1 = lum(rgbOf(a)), l2 = lum(rgbOf(b)); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
// the accents that CARRY MEANING — none of these may collapse into another
const MEANING = ["--orange", "--teal", "--green", "--amber", "--red", "--blue", "--info", "--loc-warrington"];

(async () => {
  /* ================= 0. the build stamp ================= */
  assert.ok(/<!-- build v106 · warm-light-theme -->/.test(MONTHLY), "monthly.html stamped v106 · warm-light-theme");
  assert.ok(/build v106 · warm-light-theme/.test(WEEKLY), "index.html carries the same stamp");

  /* ================= 1. one palette, in one place, per page ================= */
  for (const f of FILES) {
    const style = styleOf(SRC[f]);
    const dark = tokensOf(blockOf(style, DARK_SEL));
    const light = tokensOf(blockOf(style, LIGHT_SEL));
    const label = f + ": ";

    assert.ok(Object.keys(dark).length >= 45, label + "the dark theme defines the whole palette");

    // --- no missing tokens: the two themes define exactly the same names ---
    const dk = Object.keys(dark).sort(), lk = Object.keys(light).sort();
    assert.deepStrictEqual(lk, dk, label + "light defines exactly the same tokens as dark — none missing, none extra");

    // --- no dangling var(): everything the stylesheet references is defined ---
    const defined = new Set([...Object.keys(dark), ...Object.keys(tokensOf(blockOf(style, ":root")))]);
    const used = new Set([...style.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]));
    [...used].forEach((v) => assert.ok(defined.has(v), label + v + " is used and defined"));
    assert.ok(used.size >= 25, label + "the stylesheet really is driven by the tokens");

    // --- the audit: no literal colour survives outside the token blocks ---
    const rest = style.replace(blockOf(style, DARK_SEL), "").replace(blockOf(style, LIGHT_SEL), "");
    const literals = rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g);
    assert.strictEqual(literals, null, label + "no hardcoded colour outside the token blocks: " + (literals || []).join(" "));

    // --- both themes declare their colour-scheme, so native controls follow ---
    assert.ok(/color-scheme:dark/.test(blockOf(style, DARK_SEL)), label + "dark declares color-scheme:dark");
    assert.ok(/color-scheme:light/.test(blockOf(style, LIGHT_SEL)), label + "light declares color-scheme:light");

    /* ---- the light theme is a real re-map, not the dark one reused ---- */
    const hexes = (t) => Object.keys(t).filter((k) => /^#/.test(t[k]));
    const shared = hexes(dark).filter((k) => dark[k] === light[k]);
    assert.deepStrictEqual(shared, ["--on-accent"],
      label + "every colour is re-mapped for light except --on-accent (white ON a solid accent fill, by design)");

    /* ---- warm paper: light surfaces are light, ink is dark (and dark is the reverse) ---- */
    assert.ok(lum(rgbOf(light["--navy"])) > 0.8, label + "the light page background is a soft off-white");
    assert.ok(light["--navy"].toLowerCase() !== "#ffffff" && light["--navy"].toLowerCase() !== "#fff",
      label + "…not stark white — it's paper");
    const [pr, pg, pb] = rgbOf(light["--navy"]);
    assert.ok(pr > pb + 4, label + "…and warm: more red than blue in the page background");
    assert.ok(lum(rgbOf(light["--card"])) > lum(rgbOf(light["--navy"])), label + "cards sit above the page");
    assert.ok(lum(rgbOf(light["--ink"])) < 0.1, label + "light ink is dark…");
    assert.ok(rgbOf(light["--ink"]).some((c) => c > 20), label + "…but soft, not pure black");
    assert.ok(lum(rgbOf(dark["--navy"])) < 0.1 && lum(rgbOf(dark["--ink"])) > 0.7, label + "dark is still dark-on-navy");

    /* ---- meanings stay distinct, in BOTH themes ---- */
    for (const theme of [["dark", dark], ["light", light]]) {
      const t = theme[1];
      const seen = new Map();
      MEANING.forEach((k) => {
        assert.ok(t[k], label + theme[0] + " defines " + k);
        assert.ok(!seen.has(t[k]), label + theme[0] + ": " + k + " and " + seen.get(t[k]) + " must not share a colour");
        seen.set(t[k], k);
      });
    }
    // …and not merely different strings: visibly apart. The bar is an absolute one (60 of
    // summed RGB distance), except where the DARK theme already ran them closer together —
    // there light only has to be at least as separated, so the light theme can never
    // collapse a distinction the app already made.
    const dist = (a, b) => rgbOf(a).reduce((s, c, i) => s + Math.abs(c - rgbOf(b)[i]), 0);
    for (let i = 0; i < MEANING.length; i++) {
      for (let j = i + 1; j < MEANING.length; j++) {
        const a = MEANING[i], b = MEANING[j];
        const dd = dist(dark[a], dark[b]), ld = dist(light[a], light[b]);
        assert.ok(dd > 20, label + "dark keeps " + a + " and " + b + " apart at all (" + dd + ")");
        assert.ok(ld >= Math.min(60, dd),
          label + a + " vs " + b + ": light must stay distinct (light " + ld + " vs dark " + dd + ")");
      }
    }

    /* ---- readable: nothing in light is worse than the dark theme's own floor ---- */
    const FLOOR = 3.3;   // the dark theme's weakest text token (--ink-faint on card) is 3.43
    ["--ink", "--ink-dim", "--ink-faint", "--ink-strong", ...MEANING, "--tint-red", "--tint-amber", "--tint-green", "--tint-blue", "--tint-orange"]
      .forEach((k) => {
        ["--card", "--navy", "--navy-2"].forEach((bg) => {
          assert.ok(contrast(light[k], light[bg]) >= FLOOR,
            label + "light " + k + " on " + bg + " is readable (" + contrast(light[k], light[bg]).toFixed(2) + ")");
        });
      });
    assert.ok(contrast(light["--ink"], light["--card"]) >= 7, label + "body text has plenty of contrast on light");
    // white ON the solid accent fills (buttons, active tabs) — better in light than dark
    ["--orange", "--green", "--red", "--amber", "--teal"].forEach((k) => {
      assert.ok(contrast(light["--on-accent"], light[k]) >= contrast(dark["--on-accent"], dark[k]),
        label + "white on the " + k + " fill is at least as readable in light as in dark");
    });

    /* ---- the toggle exists on this page, in the top nav ---- */
    assert.ok(/<nav class="topnav">[\s\S]*?id="themeToggle"[\s\S]*?<\/nav>/.test(SRC[f]), label + "the toggle sits in the top nav");
    assert.ok(/id="themeToggle"[^>]*onclick="bsToggleTheme\(\)"/.test(SRC[f]), label + "…and is wired to the toggle");

    /* ---- the boot snippet runs before the stylesheet, and defaults to light ---- */
    const headScript = SRC[f].slice(SRC[f].indexOf("<head>"), SRC[f].indexOf("<style>"));
    assert.ok(/localStorage\.getItem\("bodysculpt:theme"\)/.test(headScript), label + "the boot snippet reads the remembered theme");
    assert.ok(/var t = "light";/.test(headScript), label + "…defaulting to light");
    assert.ok(/setAttribute\("data-theme", t\)/.test(headScript), label + "…and applies it to <html> before the CSS is parsed");

    /* ---- the theme handlers are on every page, identically ---- */
    ["function bsTheme(", "function bsSetTheme(", "function bsToggleTheme(", "function bsSyncThemeBtn("]
      .forEach((fn) => assert.ok(SRC[f].includes(fn), label + "carries " + fn + ")"));
  }

  /* ================= 2. the boot snippet itself: default + remembered ================= */
  {
    const bootSrc = /<head>\s*<script>([\s\S]*?)<\/script>/.exec(WEEKLY)[1];

    let env = await boot();
    env.ctx.document.documentElement.removeAttribute("data-theme");
    vm.runInContext(bootSrc, env.ctx);
    assert.strictEqual(env.ctx.document.documentElement.getAttribute("data-theme"), "light",
      "with nothing remembered, the page boots into the light theme");

    env = await boot({ storage: { "bodysculpt:theme": "dark" } });
    env.ctx.document.documentElement.removeAttribute("data-theme");
    vm.runInContext(bootSrc, env.ctx);
    assert.strictEqual(env.ctx.document.documentElement.getAttribute("data-theme"), "dark",
      "a remembered dark choice is restored on the next load");

    env = await boot({ storage: { "bodysculpt:theme": "nonsense" } });
    env.ctx.document.documentElement.removeAttribute("data-theme");
    vm.runInContext(bootSrc, env.ctx);
    assert.strictEqual(env.ctx.document.documentElement.getAttribute("data-theme"), "light",
      "a junk stored value falls back to the default rather than breaking the page");
  }

  /* ================= 3. the toggle switches, remembers, and changes nothing else ============ */
  {
    const env = await boot({ plans: { "2026-08-10": { weekEnding: "2026-08-10" } } });
    await env.ctx.loadWeeklyPlan("2026-08-10");
    await env.settle();
    const root = env.ctx.document.documentElement;
    const btn = env.ctx.document.getElementById("themeToggle");

    // the shipped default, and a button that offers the OTHER theme
    assert.strictEqual(env.ctx.bsTheme(), "light", "the page starts in the light theme");
    assert.strictEqual(btn.textContent, "☾ Dark", "the button offers the theme you'd switch to");
    assert.strictEqual(btn.getAttribute("aria-pressed"), "false", "…and reports the dark theme as off");

    // what must NOT change when the theme does
    const before = { html: env.ctx.document.getElementById("wpBody").innerHTML, posts: env.posts.length, plan: JSON.stringify(env.ctx.__wpState.plan) };

    assert.strictEqual(env.ctx.bsToggleTheme(), "dark", "toggling switches to dark");
    assert.strictEqual(root.getAttribute("data-theme"), "dark", "…on the <html> element, which is all the CSS keys off");
    assert.strictEqual(env.ctx.localStorage.getItem("bodysculpt:theme"), "dark", "…and the choice is remembered");
    assert.strictEqual(btn.textContent, "☀ Light", "the button now offers light");
    assert.strictEqual(btn.getAttribute("aria-pressed"), "true", "…and reports dark as on");

    assert.strictEqual(env.ctx.bsToggleTheme(), "light", "toggling again switches back");
    assert.strictEqual(root.getAttribute("data-theme"), "light", "…so dark is always one click away");
    assert.strictEqual(env.ctx.localStorage.getItem("bodysculpt:theme"), "light", "…remembered too");

    // explicit set, including a junk value
    assert.strictEqual(env.ctx.bsSetTheme("dark"), "dark", "the theme can be set outright");
    assert.strictEqual(env.ctx.bsSetTheme("banana"), "light", "…and anything unrecognised resolves to light");

    /* ---- nothing but colour changed ---- */
    assert.strictEqual(env.ctx.document.getElementById("wpBody").innerHTML, before.html,
      "the rendered week is byte-identical after theme switching — the theme touches no markup");
    assert.strictEqual(env.posts.length, before.posts, "…and writes nothing");
    assert.strictEqual(JSON.stringify(env.ctx.__wpState.plan), before.plan, "…and the week's data is untouched");
    assert.ok(!/data-theme|bsTheme\(\)/.test(before.html), "no rendered markup depends on the theme");

    // the week still works after a switch
    await env.ctx.loadWeeklyPlan("2026-08-10");
    await env.settle();
    assert.strictEqual(env.ctx.__wpState.plan.weekEnding, "2026-08-10", "the app carries on exactly as before");
  }

  /* ================= 4. same toggle, same behaviour, on the Monthly page ================= */
  {
    const env = await bootMonthly({});
    const root = env.ctx.document.documentElement;
    assert.strictEqual(env.ctx.bsTheme(), "light", "monthly.html starts light too");
    assert.strictEqual(env.ctx.bsToggleTheme(), "dark", "…toggles");
    assert.strictEqual(root.getAttribute("data-theme"), "dark", "…on <html>");
    assert.strictEqual(env.ctx.localStorage.getItem("bodysculpt:theme"), "dark", "…and remembers, under the SAME key as weekly");
    env.ctx.bsToggleTheme();
    assert.strictEqual(env.ctx.bsTheme(), "light", "…and back");

    // the charts are the one place colours are chosen in JS — they read the tokens now
    assert.ok(/const CHART_TOKENS = \{[\s\S]*?--chart-grid/.test(MONTHLY), "the SVG charts name theme tokens");
    assert.ok(/function cssToken\(name, fallback\)/.test(MONTHLY), "…read through one helper");
    assert.ok(/getComputedStyle\(document\.documentElement\)/.test(MONTHLY), "…off the live document, so a switch is picked up");
    assert.ok(/function bsThemeRepaint\(\)/.test(MONTHLY), "…and already-drawn charts repaint on a theme switch");
    assert.ok(!/const C = \{ ink:"#/.test(MONTHLY), "…and the old hardcoded chart palette is gone");
  }

  /* ================= 5. the harness still boots the app, not the boot snippet ============== */
  {
    assert.strictEqual((WEEKLY.match(/<script>/g) || []).length, 2, "index.html has exactly the app script + the theme boot snippet");
    assert.ok(extract(path.join(__dirname, "..", "index.html")).includes("function renderWeeklyPlan"),
      "the test harness extracts the APP script, not the boot snippet");
    assert.ok(extract(path.join(__dirname, "..", "monthly.html")).includes("function drawMonthlyPlan"), "…same for monthly.html");
  }

  console.log("v106-warm-light-theme.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
