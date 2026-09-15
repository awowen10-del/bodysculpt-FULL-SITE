// v163 — fold the rail.
//
// Ash: "Can you add an option, maybe two little arrows, to collapse the nav bar and have
// just icons instead of the full text? Just in case I wanted more space on my main screen."
//
// A double chevron at the foot of the rail. Pressed, the rail folds to 72px: the mark
// stays, the wordmark and every label go, each icon keeps its name as a tooltip, the
// captions become hairlines, and the root's padding shrinks with it so the page takes the
// space. The choice is one class on <html>, remembered per browser (bodysculpt:nav) and
// re-applied by a boot snippet that is the FIRST thing in <body> — so a folded rail does
// not flash open on every load, and nothing reads storage ahead of the stylesheet (the
// v121 rule that keeps a theme boot from coming back). Under 900px the rail is a drawer,
// always full width, and the button is hidden.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const FILES = ["index.html", "monthly.html", "quarterly.html", "finances.html", "daily.html", "social.html"];
const SRC = {};
FILES.forEach((f) => { SRC[f] = read(f); });
const styleOf = (src) => src.slice(src.indexOf("<style>") + 7, src.indexOf("</style>"));
const scriptOf = (src) => src.slice(src.lastIndexOf("<script>") + 8, src.lastIndexOf("</script>"));

(async () => {
  /* ================= 0. the stamp ================= */
  const text = "build v165 · numbers-in-the-rail";
  for (const f of ["monthly.html", "index.html", "finances.html", "daily.html", "social.html"]) {
    assert.ok(read(f).includes(text), f + " carries the stamp");
  }

  for (const f of FILES) {
    const src = SRC[f], style = styleOf(src), js = scriptOf(src), label = f + ": ";

    /* ============ 1. the button: two little arrows, at the top beside the brand ============
       (v163.1 — it began at the foot of the rail; Ash: "Move it to the top, please.") */
    const btn = /<div class="sn-top">\s*<a class="sn-brand"[\s\S]*?<\/a>\s*<button type="button" class="sn-fold" id="snFold" aria-label="Fold the menu to icons" title="Fold the menu"><svg class="ic"><use href="#ic-chevrons"\/><\/svg><\/button>\s*<\/div>\s*<nav class="sn-nav">/.exec(src);
    assert.ok(btn, label + "the fold button shares the top row with the brand, ahead of the nav, and says what it does");
    const sym = /<symbol id="ic-chevrons"[^>]*>([\s\S]*?)<\/symbol>/.exec(src);
    assert.ok(sym && (sym[1].match(/l-6 6 6 6/g) || []).length === 2, label + "#ic-chevrons is two chevrons, on the sprite");
    assert.ok(/\.sn-top\{display:flex;align-items:center;justify-content:space-between/.test(style), label + "brand left, arrows right, on one row");
    assert.ok(/html\.nav-collapsed \.sn-top\{flex-direction:column/.test(style), label + "…stacked when folded, since 72px fits one of them across");
    assert.ok(/\.sn-fold\{[^}]*background:transparent/.test(style) && /\.sn-fold\{[^}]*color:var\(--ink-faint\)/.test(style),
      label + "…quiet until hovered");

    /* ============ 2. folded: icons only, and the page takes the space ============ */
    const wide = style.slice(style.indexOf("  @media(min-width:901px){\n    html.nav-collapsed"));
    assert.ok(wide.length > 0, label + "the folded rules live inside the wide-screen query");
    assert.ok(/html\.nav-collapsed\{padding-left:72px;\}/.test(wide), label + "the root's padding shrinks to 72px");
    assert.ok(/html\.nav-collapsed \.sidenav\{width:72px/.test(wide), label + "…and so does the rail");
    assert.ok(/html\.nav-collapsed \.sn-lbl\{display:none;\}/.test(wide), label + "the labels go");
    assert.ok(/html\.nav-collapsed \.sn-brand>div:not\(\.mark\)\{display:none;\}/.test(wide), label + "the wordmark goes; the mark stays");
    assert.ok(/html\.nav-collapsed \.sn-cap\{font-size:0;height:1px;background:var\(--line\)/.test(wide), label + "captions become hairlines");
    assert.ok(/html\.nav-collapsed \.sn-link\{justify-content:center/.test(wide), label + "icons centre in the narrow rail");
    assert.ok(/html\.nav-collapsed \.sn-fold \.ic\{transform:rotate\(180deg\);\}/.test(wide), label + "the arrows turn round to say 'unfold'");
    // every link carries its name as a tooltip, so a folded icon is never nameless
    const links = [...src.matchAll(/<a href="[^"]+" class="sn-link(?: active)?" title="([^"]+)"><svg[^]*?<span class="sn-lbl">([^<]+)<\/span><\/a>/g)];
    assert.strictEqual(links.length, 8, label + "eight links (v165: six, plus the two KPI doors)");
    for (const m of links) assert.strictEqual(m[1], m[2], label + "the tooltip is the label: " + m[1]);
    // the drawer never folds
    const mq = style.slice(style.indexOf("  @media(max-width:900px){"));
    assert.ok(/\.sn-fold\{display:none;\}/.test(mq), label + "under 900px the button is hidden — the drawer is always full width");

    /* ============ 3. remembered, and applied before anything is on screen ============ */
    const boot = /<body[^>]*>\n<script>\n([\s\S]*?)<\/script>/.exec(src);
    assert.ok(boot, label + "a boot snippet is the first thing in <body>");
    assert.ok(/localStorage\.getItem\("bodysculpt:nav"\) === "collapsed"/.test(boot[1]) && /documentElement\.classList\.add\("nav-collapsed"\)/.test(boot[1]),
      label + "…it re-applies the fold from storage");
    assert.ok(/^try \{[\s\S]*\} catch \(e\) \{\}/m.test(boot[1]), label + "…and a browser that refuses storage is not an error");
    const head = src.slice(src.indexOf("<head>"), src.indexOf("<style>"));
    assert.ok(!/localStorage/.test(head), label + "nothing reads storage before the stylesheet (the v121 rule holds)");
    // the boot is tiny, so the harness's extract() still picks the app script
    assert.ok(boot[1].length < 800, label + "the boot is a few lines, not a script");
    // the click: toggles the class, keeps the button's words honest, remembers
    assert.ok(/document\.documentElement\.classList\.toggle\("nav-collapsed", on\)/.test(js), label + "the fold is one class on <html>");
    assert.ok(/localStorage\.setItem\("bodysculpt:nav", on \? "collapsed" : "open"\)/.test(js), label + "…remembered per browser");
    assert.ok(/fold\.setAttribute\("aria-label", on \? "Unfold the menu" : "Fold the menu to icons"\)/.test(js), label + "…and the button says which way it will go");
    assert.ok(/if \(document\.documentElement\.classList\.contains\("nav-collapsed"\)\) setFolded\(true\);/.test(js),
      label + "on load the button's words match the state the boot applied");
  }

  /* ============ 4. the snippet, run: fold, unfold, remember ============ */
  const js = scriptOf(SRC["daily.html"]);
  const snippet = js.slice(js.indexOf("(function () {"), js.indexOf("})();") + 5);
  const store = {};
  const mk = () => { const c = new Set(); return { classList: { toggle: (k, on) => { on ? c.add(k) : c.delete(k); }, contains: (k) => c.has(k), add: (k) => c.add(k) }, _c: c }; };
  const html = mk(), body = mk();
  const handlers = {};
  const fold = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, h) { handlers["fold:" + t] = h; } };
  const ctx = {
    document: { documentElement: html, body, getElementById: (id) => (id === "snFold" ? fold : null), addEventListener() {} },
    localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } },
  };
  ctx.window = ctx;   // v165: the snippet publishes snMarkActive on window
  vm.createContext(ctx);
  vm.runInContext(snippet, ctx);
  assert.ok(!html._c.has("nav-collapsed"), "starts open");
  handlers["fold:click"]();
  assert.ok(html._c.has("nav-collapsed"), "one click folds it");
  assert.strictEqual(store["bodysculpt:nav"], "collapsed", "…and remembers");
  assert.strictEqual(fold.attrs["aria-label"], "Unfold the menu", "…and the button now offers to unfold");
  handlers["fold:click"]();
  assert.ok(!html._c.has("nav-collapsed"), "a second click unfolds it");
  assert.strictEqual(store["bodysculpt:nav"], "open", "…and remembers that too");
  assert.strictEqual(fold.attrs["aria-label"], "Fold the menu to icons");

  console.log("v163-fold-the-rail.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
