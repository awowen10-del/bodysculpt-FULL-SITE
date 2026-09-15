// v162 — the side nav.
//
// Ash: "I no longer want the navigation accessible from the top. I now want a side
// navigation, please take inspiration from this image" — a quiet left rail: brand at the
// top, small grey captions over groups of icon + label rows, generous air, nothing
// competing with the page.
//
// What moved and what did not. The app bar (v121–v127) is gone from every page. The
// navigation it carried is unchanged in substance: four groups (Today, Planning, Social,
// Finances) in the same order, six links in the same order, one active per page,
// Finances in the brand colour and still not a fourth period. The section tabs
// (.viewtoggle/#tabBar) stay in the page, because they steer the page's CONTENT.
//
// How the page makes room: on a wide screen the rail is fixed to the left edge and the
// ROOT is padded by its width, so every page's centred 1500px shell centres itself in what
// is left — no page had to learn about the rail. Under 900px the rail becomes a drawer: a
// slim bar with a Menu button sits where the app bar was, and the rail slides over the
// page with a scrim behind it.
//
// Rail markup and rail CSS are one block each, byte-identical across all six pages except
// which link is active — pinned below, so the six cannot drift apart.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const FILES = ["index.html", "monthly.html", "quarterly.html", "finances.html", "daily.html", "social.html", "ads.html", "schedule.html"];   // v170: eight
const SRC = {};
FILES.forEach((f) => { SRC[f] = read(f); });
const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));
const scriptOf = (src) => src.slice(src.lastIndexOf("<script>") + 8, src.lastIndexOf("</script>"));
const ruleOf = (style, sel) => {
  const m = new RegExp("\\n  " + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{[^}]*\\}").exec(style);
  return m ? m[0] : null;
};

(async () => {
  /* ================= 0. the stamp ================= */
  const text = "build v171 · the-reel-that-ate-the-page";
  for (const f of ["monthly.html", "index.html", "finances.html", "daily.html", "social.html"]) {
    assert.ok(read(f).includes(text), f + " carries the stamp");
  }

  /* ================= 1. the rail, on every page, identical ================= */
  const rails = {}, blocks = {};
  for (const f of FILES) {
    const src = SRC[f], label = f + ": ";
    const rail = /<aside class="sidenav" id="sideNav" aria-label="Pages">([\s\S]*?)<\/aside>\n<div class="sn-scrim" id="snScrim"><\/div>/.exec(src);
    assert.ok(rail, label + "has the rail, followed by its scrim");
    // it comes BEFORE the page's header, so it is first in the tab order, as it is on screen
    assert.ok(src.indexOf('<aside class="sidenav"') < src.indexOf("<header>"), label + "the rail precedes the header");
    // …and the old bar is gone
    assert.ok(!/class="appbar"|class="topnav"/.test(src), label + "no app bar, no top nav");
    // the brand at the top is a link home, with the mark and both lines
    assert.ok(/<a class="sn-brand" href="\/daily.html">\s*<div class="mark"><img src="data:image\/png;base64,[^"]+" alt="Bodysculpt"/.test(rail[1]),
      label + "the brand leads, and is a link to Today");
    assert.ok(/<h1>Bodysculpt<\/h1><div class="sub">Warrington<\/div>/.test(rail[1]), label + "…with both lines of the wordmark");
    // the mark is the same picture on every page — the file is not the place it lives, the rail is
    rails[f] = rail[1].replace(/ class="sn-link active"/g, ' class="sn-link"');
    blocks[f] = rail[1];
  }
  for (const f of FILES) assert.strictEqual(rails[f], rails["daily.html"], f + ": the rail is byte-identical to daily.html's, bar the active link");

  /* ================= 2. its structure: four groups, six links, one active ================= */
  for (const f of FILES) {
    const inner = blocks[f], label = f + ": ";
    const groups = [...inner.matchAll(/<div class="sn-group( sn-money)?">\s*<span class="sn-cap">([^<]+)<\/span>([\s\S]*?)<\/div>/g)];
    // v165: Numbers joined between Planning and Social
    assert.deepStrictEqual(groups.map((m) => [m[2], !!m[1]]),
      [["Today", false], ["Planning", false], ["Numbers", false], ["Social", false], ["Finances", true]],
      label + "five captions in order, and only Finances carries the money class");
    // v163 wrapped the label in a span (so the fold can hide it) and gave every link a
    // tooltip that repeats its label (so a folded icon still has a name)
    const linksOf = (block) => [...block.matchAll(/<a href="([^"]+)" class="sn-link( active)?" title="([^"]+)"><svg class="ic"><use href="#(ic-[a-z-]+)"\/><\/svg><span class="sn-lbl">([^<]+)<\/span><\/a>/g)]
      .map((m) => ({ href: m[1], active: !!m[2], title: m[3], icon: m[4], label: m[5] }));
    assert.deepStrictEqual(linksOf(groups[0][3]).map((l) => l.href), ["/daily.html"], label + "Today holds the daily dashboard alone");
    assert.deepStrictEqual(linksOf(groups[1][3]).map((l) => l.href), ["/index.html", "/monthly.html", "/quarterly.html"],
      label + "the three periods stay together under Planning");
    assert.deepStrictEqual(linksOf(groups[2][3]).map((l) => l.href), ["/index.html#kpi", "/monthly.html#kpi"], label + "Numbers is the two KPI doors");
    assert.deepStrictEqual(linksOf(groups[3][3]).map((l) => l.href), ["/social.html", "/ads.html", "/schedule.html"], label + "Social is Content, Facebook Ads and Scheduling (v170)");
    assert.deepStrictEqual(linksOf(groups[4][3]).map((l) => l.href), ["/finances.html"], label + "Finances is alone — not a fourth period");
    const all = linksOf(inner);
    assert.deepStrictEqual(all.map((l) => l.label),
      ["Daily Dashboard", "Weekly", "Monthly", "Quarterly", "Weekly KPIs", "Monthly KPIs", "Content", "Facebook Ads", "Scheduling", "Income &amp; Expenses"], label + "the same ten labels (v170: Scheduling)");
    assert.deepStrictEqual(all.map((l) => l.icon),
      ["ic-sun", "ic-calendar", "ic-grid", "ic-target", "ic-trend-up", "ic-trend-up", "ic-camera", "ic-megaphone", "ic-clock", "ic-wallet"], label + "each row leads with its icon");
    assert.deepStrictEqual(all.filter((l) => l.active).map((l) => l.href), ["/" + f], label + "marks its own link active, once");
    // every icon the rail asks for resolves in this page's sprite
    const sprite = /<svg width="0" height="0"[\s\S]*?<\/defs><\/svg>/.exec(SRC[f]);
    const defined = new Set([...sprite[0].matchAll(/<symbol id="(ic-[a-z-]+)"/g)].map((m) => m[1]));
    for (const l of all) assert.ok(defined.has(l.icon), label + "#" + l.icon + " resolves");
    assert.ok(defined.has("ic-menu"), label + "#ic-menu resolves, for the narrow-screen bar");
    // a caption is a heading, never a link
    assert.ok(!/<a[^>]*class="sn-cap"/.test(inner), label + "captions are not links");
  }

  /* ================= 3. its dress ================= */
  const cssBlocks = {};
  for (const f of FILES) {
    const style = styleOf(SRC[f]), label = f + ": ";
    const a = style.indexOf("  /* ===================== v162: THE SIDE NAV");
    const b = style.indexOf("  @media(max-width:900px){", a);
    assert.ok(a > 0 && b > a, label + "the rail's stylesheet block is there");
    cssBlocks[f] = style.slice(a, b);
    // fixed to the edge, full height, its own scroll, a hairline on its right
    const rail = ruleOf(style, ".sidenav");
    assert.ok(/position:fixed/.test(rail) && /top:0;bottom:0/.test(rail) && /width:236px/.test(rail), label + "the rail is fixed, full-height, 236px");
    assert.ok(/overflow-y:auto/.test(rail), label + "…and scrolls on its own if it must");
    assert.ok(/border-right:1px solid var\(--line\)/.test(rail) && /background:var\(--card\)/.test(rail), label + "…a card with a hairline on its right");
    // the page makes room by padding the ROOT on wide screens — the shells stay centred in what is left
    assert.ok(/@media\(min-width:901px\)\{ html\{padding-left:236px;\} \}/.test(style), label + "the root is padded by the rail's width on a wide screen");
    // captions: small, grey, spaced, uppercase — headings, not buttons
    const cap = ruleOf(style, ".sn-cap");
    assert.ok(/text-transform:uppercase/.test(cap) && /letter-spacing:\.14em/.test(cap) && /color:var\(--ink-faint\)/.test(cap), label + "captions are small grey uppercase");
    // rows: icon + word, plain at rest, a soft chip when current — the v127 rule, kept
    const link = ruleOf(style, ".sn-link");
    assert.ok(/display:flex/.test(link) && /gap:12px/.test(link) && /color:var\(--ink-dim\)/.test(link) && !/background:/.test(link),
      label + "a row is an icon and a word, plain at rest");
    assert.ok(/\.sn-link\.active\{[^}]*background:var\(--navy-2\)/.test(style), label + "the current one takes a soft chip");
    assert.ok(/\.sn-link \.ic\{[^}]*width:19px/.test(style), label + "the icon is 19px on the 24 grid");
    // Finances: the brand as colour, never as a fill
    assert.ok(/\.sn-money \.sn-cap\{color:var\(--orange\);\}/.test(style), label + "the Finances caption carries the brand");
    assert.ok(/\.sn-money \.sn-link\{[^}]*color:var\(--orange\)/.test(style), label + "…and so does its row");
    assert.ok(/\.sn-money \.sn-link\.active\{[^}]*background:rgba\(var\(--orange-rgb\),\.12\)/.test(style), label + "…tinted when current, never a solid fill");
    assert.ok(!/\.sn-[a-z-]+[^{]*\{[^}]*background:var\(--orange\)/.test(style), label + "no rail element is a solid brand fill");
    // the section tabs are their own block now
    const vt = ruleOf(style, ".viewtoggle");
    assert.ok(/border:1px solid var\(--line\)/.test(vt) && /border-radius:var\(--r-lg\)/.test(vt) && !/border-top:0/.test(vt),
      label + "the section tabs close their own top edge, with nothing to hang off");
  }
  for (const f of FILES) assert.strictEqual(cssBlocks[f], cssBlocks["daily.html"], f + ": the rail's CSS is byte-identical to daily.html's");

  /* ================= 4. the narrow screen: a bar and a drawer ================= */
  for (const f of FILES) {
    const src = SRC[f], style = styleOf(src), js = scriptOf(src), label = f + ": ";
    // the bar sits where the app bar was — inside the header, ahead of everything else
    const bar = /<div class="mobilebar">\s*<button type="button" class="mbar-menu" id="mbarMenu" aria-controls="sideNav" aria-expanded="false"><svg class="ic"><use href="#ic-menu"\/><\/svg>Menu<\/button>\s*<span class="mbar-name">Bodysculpt<\/span>\s*<\/div>/.exec(src);
    assert.ok(bar, label + "a narrow-screen bar with a Menu button that names the rail it controls");
    assert.ok(src.indexOf("<header>") < bar.index, label + "…inside the header");
    // absent on a wide screen; on a narrow one the rail is off-screen until asked for
    assert.ok(/\n  \.mobilebar\{display:none;\}/.test(style) && /\n  \.sn-scrim\{display:none;\}/.test(style), label + "bar and scrim are absent on a wide screen");
    const mq = style.slice(style.indexOf("  @media(max-width:900px){"));
    assert.ok(/\.sidenav\{transform:translateX\(-100%\)/.test(mq), label + "under 900px the rail is off-screen");
    assert.ok(/body\.nav-open \.sidenav\{transform:none/.test(mq), label + "…until the body says open");
    assert.ok(/body\.nav-open \.sn-scrim\{display:block;position:fixed;inset:0/.test(mq), label + "…with a scrim over the page");
    assert.ok(/\.mobilebar\{display:flex[^}]*position:sticky;top:0/.test(mq), label + "the bar is pinned to the top of a narrow screen");
    // the scrim's colour comes from a token — the v121 audit forbids a literal
    assert.ok(/background:rgba\(var\(--ink-dim-rgb\),\.45\)/.test(mq), label + "the scrim is drawn from a token");
    // the drawer script: menu toggles, scrim closes, Escape closes, aria kept honest
    assert.ok(/document\.body\.classList\.toggle\("nav-open", open\)/.test(js), label + "open/closed is one class on the body");
    assert.ok(/btn\.setAttribute\("aria-expanded", String\(open\)\)/.test(js), label + "…and the button says which");
    assert.ok(/scrim\.addEventListener\("click", function \(\) \{ setOpen\(false\); \}\)/.test(js), label + "the scrim closes it");
    assert.ok(/if \(e\.key === "Escape"\) setOpen\(false\)/.test(js), label + "Escape closes it");
    // it is at the TOP of the app script, so the pages whose scripts end in init() keep
    // ending in init() — tests/v122 strips that line to load the finance functions unbooted
    assert.ok(js.trimStart().startsWith("/* v162: the side nav's drawer"), label + "the drawer script leads the app script");
  }
  // the finance page pins its header; the timer bar on the daily page sits under the narrow bar
  assert.ok(/\.ftbar\{position:sticky;top:0;/.test(styleOf(SRC["daily.html"])), "daily: the timer bar pins to the top on a wide screen");
  assert.ok(/\.ftbar\{top:58px;\}/.test(styleOf(SRC["daily.html"]).slice(styleOf(SRC["daily.html"]).indexOf("  @media(max-width:900px){"))),
    "daily: …and under the pinned bar on a narrow one");
  assert.ok(!/\.appbar\{position:static;\}/.test(styleOf(SRC["finances.html"])), "finances: the stale app-bar override is gone");

  console.log("v162-side-nav.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
