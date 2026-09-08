// v121 — the design pass. Replaces tests/v106-light-theme-system and
// tests/v108-neutral-light-theme, both of which existed to guard a TWO-theme system that
// no longer exists.
//
// Three changes are pinned here:
//
//  1. DARK MODE IS GONE. Not disabled — removed. No boot script, no data-theme attribute,
//     no toggle, no bsTheme/bsSetTheme/bsToggleTheme/bsSyncThemeBtn, no "bodysculpt:theme"
//     key. One :root palette per page, and the three pages carry it byte-identically.
//
//  2. THE PALETTE. Everything v106/v108 asserted about the light theme that is still true
//     of a single-theme system is kept: no literal colour outside the token block, no
//     dangling var(), the meaning-carrying accents stay distinct from each other AND from
//     the brand, every accent is readable on every surface, and the surface/ink ramps run
//     the right way. The brand itself moved from a slate-blue to terracotta, so the "is it
//     blue" assertions became "is it a warm ramp".
//
//  3. THE ICON SET. One sprite per page; emoji and typographic glyphs are no longer used
//     as icons anywhere. Every #ic-* a page references resolves to a symbol it defines.
//     Prose typography is untouched — the → in "Thinking Time → AI Analysis", the ·
//     separators and the • bullets are text, not icons, and stay.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const FILES = ["index.html", "monthly.html", "quarterly.html"];
const SRC = {};
FILES.forEach((f) => { SRC[f] = fs.readFileSync(path.join(__dirname, "..", f), "utf8"); });
const WEEKLY = SRC["index.html"], MONTHLY = SRC["monthly.html"];

const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));
// the palette is the SECOND ":root{" in the stylesheet — the first holds the metrics
function paletteOf(style) {
  const i = style.indexOf("  :root{", style.indexOf("  :root{") + 1);
  assert.ok(i > 0, "the page has a palette block");
  return style.slice(i, style.indexOf("\n  }\n", i));
}
function metricsOf(style) {
  const i = style.indexOf("  :root{");
  return style.slice(i, style.indexOf("\n  }\n", i));
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

// the accents that CARRY MEANING — none of these may collapse into another
const MEANING = ["--orange", "--teal", "--green", "--amber", "--red", "--blue", "--info", "--loc-warrington"];

// glyphs that used to stand in for icons. Prose characters (→ · • ⌘ ‹ › ≥) are NOT here:
// they are typography and are meant to stay.
const RETIRED_GLYPHS = ["✕", "▸", "▾", "▲", "▼", "◐",
  "\u{1F4C5}", "\u{1F4CD}", "\u{1F5D2}", "\u{1F525}", "⚠", "\u{1F6A9}", "⏰",
  "\u{1F512}", "↻", "\u{1F3CB}", "\u{1F3C3}", "\u{1F3CA}", "\u{1F6B4}", "\u{1F9D8}",
  "\u{1F6B6}", "\u{1F517}"];

// strip comments, so a note that MENTIONS a retired glyph doesn't read as a use of one
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

(async () => {
  /* ================= 0. the build stamp ================= */
  // Same rule this file applied to v120: once a newer release ships, the older test
  // stops pinning its own stamp and only checks the build never goes backwards and
  // that the pages agree. v122's test pins the exact current stamp.
  const stamp = /<!-- build v(\d+) · ([a-z0-9-]+) -->/.exec(MONTHLY);
  assert.ok(stamp && Number(stamp[1]) >= 121, "monthly.html stamped v121 or later");
  assert.ok(WEEKLY.includes("build v" + stamp[1] + " · " + stamp[2]), "index.html carries the same stamp");

  /* ================= 1. dark mode is gone, not merely off ================= */
  for (const f of FILES) {
    const src = SRC[f], label = f + ": ";
    assert.ok(!/data-theme/.test(src), label + "no data-theme attribute anywhere");
    assert.ok(!/bodysculpt:theme/.test(src), label + "the remembered-theme key is gone");
    assert.ok(!/color-scheme:dark/.test(src), label + "no dark colour-scheme");
    assert.ok(!/id="themeToggle"/.test(src), label + "no theme toggle");
    ["bsTheme", "bsSetTheme", "bsToggleTheme", "bsSyncThemeBtn", "bsThemeRepaint"]
      .forEach((fn) => assert.ok(!src.includes("function " + fn + "("), label + fn + "() is gone"));
    // the boot snippet that used to run before the stylesheet
    const head = src.slice(src.indexOf("<head>"), src.indexOf("<style>"));
    assert.ok(!/localStorage/.test(head), label + "nothing reads storage before the stylesheet now");
    // exactly two :root blocks: metrics, then the palette
    const style = styleOf(src);
    assert.strictEqual((style.match(/\n  :root\{/g) || []).length, 2,
      label + "exactly two :root blocks — metrics and palette");
  }

  /* ================= 2. one palette, carried identically by all three ================= */
  const palettes = {};
  for (const f of FILES) {
    const style = styleOf(SRC[f]), label = f + ": ";
    const block = paletteOf(style);
    palettes[f] = block;
    const P = tokensOf(block);

    assert.ok(Object.keys(P).length >= 45, label + "the palette is the whole thing, not a handful of overrides");
    assert.ok(/color-scheme:light/.test(block), label + "declares color-scheme:light, so native controls follow");

    // no dangling var(): everything the stylesheet references is defined somewhere in :root.
    // Comments are stripped first, so a note that MENTIONS var(--something) isn't read as a use.
    const bare = style.replace(/\/\*[\s\S]*?\*\//g, "");
    const defined = new Set([...Object.keys(P), ...Object.keys(tokensOf(metricsOf(style)))]);
    const used = new Set([...bare.matchAll(/var\((--[a-z0-9-]+)[,)]/g)].map((m) => m[1]));
    [...used].forEach((v) => assert.ok(defined.has(v), label + v + " is used and defined"));
    assert.ok(used.size >= 25, label + "the stylesheet really is driven by the tokens");

    // the audit that keeps the whole system honest: no literal colour outside the block
    const rest = bare.replace(block.replace(/\/\*[\s\S]*?\*\//g, ""), "");
    const literals = rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g);
    assert.strictEqual(literals, null,
      label + "no hardcoded colour outside the palette: " + (literals || []).join(" "));
  }
  assert.strictEqual(palettes["monthly.html"], palettes["index.html"], "monthly.html carries the same palette as index.html");
  assert.strictEqual(palettes["quarterly.html"], palettes["index.html"], "quarterly.html carries the same palette as index.html");

  /* ================= 3. the palette itself ================= */
  {
    const L = tokensOf(palettes["index.html"]);

    /* ---- surfaces: three tiers, and they must stay three ---- */
    const page = rgbOf(L["--navy"]);
    assert.ok(Math.max(...page) - Math.min(...page) <= 14, "the page is near-neutral — a grey with a hint of cool");
    assert.ok(page[2] >= page[0], "…cool (or neutral), never warm: blue >= red");
    assert.ok(lum(page) > 0.8 && lum(page) < 0.95, "…light, but still a tone: the page is not white");
    assert.ok(lum(rgbOf(L["--card"])) - lum(page) >= 0.04, "cards sit visibly above the page — no same-tone flatness");
    assert.ok(dist(L["--card"], L["--navy"]) >= 18, "…a real tone difference, not a rounding error");
    assert.ok(lum(rgbOf(L["--navy-2"])) < lum(page), "--navy-2 (insets, sticky heads) sits BELOW the page tone");
    assert.ok(lum(rgbOf(L["--card-2"])) < lum(rgbOf(L["--card"])), "--card-2 recedes from the card it sits on");
    const edge = contrast(L["--line"], L["--card"]);
    assert.ok(edge >= 1.15 && edge <= 2.2, "the hairline is visible on a card without becoming an outline (" + edge.toFixed(2) + ")");
    assert.ok(lum(rgbOf(L["--line"])) < lum(page), "…and is darker than both surfaces it separates");

    /* ---- ink ramp ---- */
    assert.ok(lum(rgbOf(L["--ink"])) < 0.05, "body text is dark…");
    assert.ok(Math.max(...rgbOf(L["--ink"])) >= 20, "…but a soft near-black, never #000");
    assert.ok(contrast(L["--ink"], L["--card"]) >= 12, "…with plenty of contrast on a card");
    assert.ok(lum(rgbOf(L["--ink-strong"])) < lum(rgbOf(L["--ink"])), "--ink-strong is the emphasis tone: darker still");
    assert.ok(lum(rgbOf(L["--ink-faint"])) > lum(rgbOf(L["--ink-dim"])), "the ramp runs strong → ink → dim → faint");
    assert.ok(contrast(L["--ink-dim"], L["--card"]) >= 4.5, "secondary text clears AA on a card");
    assert.ok(contrast(L["--ink-faint"], L["--navy-2"]) >= 3.3, "the faintest text is legible even on the inset panels");

    /* ---- the brand: terracotta, not the anonymous slate-blue it replaced ---- */
    const [br, bg, bb] = rgbOf(L["--orange"]);
    assert.ok(br > bg && bg > bb, "the brand is a warm ramp (r > g > b) — terracotta, not slate-blue");
    assert.ok(contrast(L["--orange"], L["--card"]) >= 4.5, "…readable as a link/heading on a near-white card");
    assert.ok(contrast(L["--on-accent"], L["--orange"]) >= 4.5, "…and white on a solid brand fill is readable");
    assert.ok(lum(rgbOf(L["--orange-soft"])) < lum(rgbOf(L["--orange"])), "--orange-soft is the pressed/hover tone: darker");

    /* ---- the -rgb triples really are their hex ---- */
    for (const k of ["--orange", "--orange-soft", "--green", "--amber", "--red", "--teal", "--blue", "--info"]) {
      assert.deepStrictEqual(L[k + "-rgb"].split(",").map(Number), rgbOf(L[k]), k + "-rgb matches " + k);
    }

    /* ---- meanings stay distinct, and clear of the brand ---- */
    for (let i = 0; i < MEANING.length; i++) {
      for (let j = i + 1; j < MEANING.length; j++) {
        const a = MEANING[i], b = MEANING[j], d = dist(L[a], L[b]);
        const need = (a === "--orange" || b === "--orange") ? 85 : 60;
        assert.ok(d >= need, a + " vs " + b + " must stay apart (" + d + ", need " + need + ")");
      }
    }
    // …and each still reads as its own hue
    const [gr, gg, gb2] = rgbOf(L["--green"]); assert.ok(gg > gr && gg > gb2, "green (training / done) is still green");
    const [tr, tg, tb] = rgbOf(L["--teal"]); assert.ok(tb > tr && tg > tr, "teal (recurring) is still teal");
    const [ar, ag, ab] = rgbOf(L["--amber"]); assert.ok(ar > ab && ag > ab, "amber (watch) is still warm");
    const [rr, rg, rb] = rgbOf(L["--red"]); assert.ok(rr > rg && rr > rb, "red (problem) is still red");
    assert.ok(dist(L["--blue"], L["--loc-warrington"]) >= 120, "the home and Warrington location pills are unmistakable");

    /* ---- readable: every accent on every surface ---- */
    const TEXT = [...MEANING, "--tint-red", "--tint-amber", "--tint-green", "--tint-blue", "--tint-orange"];
    for (const k of TEXT) {
      for (const bgk of ["--card", "--navy", "--navy-2"]) {
        assert.ok(contrast(L[k], L[bgk]) >= 3.3,
          k + " on " + bgk + " is readable (" + contrast(L[k], L[bgk]).toFixed(2) + ")");
      }
    }
    for (const k of ["--orange", "--green", "--red", "--amber", "--teal", "--blue", "--info", "--loc-warrington"]) {
      assert.ok(contrast(L["--on-accent"], L[k]) >= 4.4,
        "white on a solid " + k + " fill is readable (" + contrast(L["--on-accent"], L[k]).toFixed(2) + ")");
    }
  }

  /* ================= 4. the metric scales ================= */
  for (const f of FILES) {
    const M = tokensOf(metricsOf(styleOf(SRC[f]))), label = f + ": ";
    ["--r-sm", "--r-md", "--r-lg", "--r-pill", "--radius"].forEach((k) => assert.ok(M[k], label + k + " is defined"));
    for (let i = 1; i <= 7; i++) assert.ok(M["--sp-" + i], label + "--sp-" + i + " is defined");
    assert.ok(M["--focus"], label + "--focus (the ring) is defined");
    assert.ok(M["--tap"], label + "--tap (the interaction duration) is defined");
    assert.strictEqual(M["--radius"], "var(--r-lg)", label + "--radius is kept as an alias of the card radius");
    // the two shadow steps live with the colours, since they carry --shadow-rgb
    const P = tokensOf(paletteOf(styleOf(SRC[f])));
    assert.ok(P["--shadow"] && P["--shadow-lift"], label + "both shadow steps are defined");
    assert.notStrictEqual(P["--shadow"], P["--shadow-lift"], label + "…and they are actually different");
    // every interactive thing gets a focus ring
    assert.ok(/button:focus-visible[\s\S]{0,200}box-shadow:var\(--focus\)/.test(styleOf(SRC[f])),
      label + "buttons take the focus ring");
    assert.ok(/prefers-reduced-motion/.test(styleOf(SRC[f])), label + "reduced motion is respected");
  }

  /* ================= 5. the icon set ================= */
  for (const f of FILES) {
    const src = SRC[f], label = f + ": ";
    const sprite = /<svg width="0" height="0"[\s\S]*?<\/defs><\/svg>/.exec(src);
    assert.ok(sprite, label + "carries the icon sprite");

    const defined = new Set([...sprite[0].matchAll(/<symbol id="(ic-[a-z-]+)"/g)].map((m) => m[1]));
    assert.ok(defined.size >= 18, label + "the sprite defines a real set (" + defined.size + " symbols)");

    const used = new Set([...src.matchAll(/href="#(ic-[a-z-]+)"/g)].map((m) => m[1]));
    assert.ok(used.size > 0, label + "the page actually uses icons");
    [...used].forEach((id) => assert.ok(defined.has(id), label + "#" + id + " is used and defined in the sprite"));

    // every symbol draws in currentColor, which is the whole reason the emoji went
    for (const m of sprite[0].matchAll(/<symbol id="(ic-[a-z-]+)"[^>]*>/g)) {
      assert.ok(/currentColor/.test(m[0]), label + m[1] + " is drawn in currentColor");
      assert.ok(/viewBox="0 0 24 24"/.test(m[0]), label + m[1] + " sits on the shared 24px grid");
    }

    // .ic sizes in em, so an icon always matches the text it sits in
    assert.ok(/\.ic\{width:1em;height:1em/.test(styleOf(src)), label + ".ic is sized in em");
  }

  /* ================= 6. no emoji left standing in for an icon ================= */
  for (const f of FILES) {
    const body = stripComments(SRC[f]), label = f + ": ";
    for (const g of RETIRED_GLYPHS) {
      assert.ok(!body.includes(g),
        label + "the glyph " + JSON.stringify(g) + " is no longer used as an icon");
    }
    // …while prose typography is deliberately untouched
    assert.ok(body.includes("·"), label + "the · separator is still prose, not an icon");
  }

  /* ================= 7. the app bar ================= */
  for (const f of FILES) {
    const src = SRC[f], label = f + ": ";
    assert.ok(/<div class="appbar">/.test(src), label + "the header is an app bar");
    // the period nav lives INSIDE it, as a compact segmented control
    const bar = /<div class="appbar">([\s\S]*?)\n  {0,4}<\/div>\n/.exec(src);
    assert.ok(/<nav class="topnav">/.test(src), label + "the period nav is present");
    assert.ok(src.indexOf('class="appbar"') < src.indexOf('<nav class="topnav">'),
      label + "…and sits inside the app bar, not below it");
    const style = styleOf(src);
    assert.ok(/\.appbar\{[^}]*position:sticky/.test(style), label + "the app bar is sticky");
    // v126 moved the pill down one level: .topnav is the two-group row, .navlinks is the
    // segment of links inside each group. The segmented-control claim is unchanged.
    assert.ok(/\.navlinks\{[^}]*border-radius:var\(--r-pill\)/.test(style), label + "the period nav is a pill segment");
    // the base rule sizes to content; the narrow-screen media query below it deliberately
    // does set flex:1, so only the FIRST .topnav a rule is checked here.
    const navLink = /\.topnav a\{[^}]*\}/.exec(style);
    assert.ok(navLink && !/flex:1/.test(navLink[0]),
      label + "…sized to its content, not stretched across the page");
  }
  // the section tabs are an underline, not a second filled pill competing with the nav
  for (const f of ["index.html", "monthly.html"]) {
    const style = styleOf(SRC[f]), label = f + ": ";
    assert.ok(/\.viewtoggle \.vt\.active\{[^}]*border-bottom-color:var\(--orange\)/.test(style),
      label + "the active section tab is an underline");
    assert.ok(!/\.viewtoggle \.vt\.active\{[^}]*background:var\(--orange\)/.test(style),
      label + "…not a filled brand pill");
  }

  console.log("v121-single-theme-and-icons.test: all assertions passed");
})();
