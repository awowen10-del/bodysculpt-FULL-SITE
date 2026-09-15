// v160 — the mail card, from a design point of view.
//
// Ash, with a screenshot: "Finally let's do the same with this now."
//
// What the screenshot showed: "won&#39;t" printed as code in a snippet (Gmail hands the
// snippet already HTML-encoded and the page encoded it again); every row carrying an empty
// band across its bottom (the hover tools reserved a line while invisible); "Open in Gmail →"
// repeated under all four headings; the two piles each spending two lines on one control
// ("FYI 18" and then "Show 18 for information"); and a drafted row saying "Send the reply"
// in a pill directly above a block saying "Review and send".
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const html = read("daily.html");
const js = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
const fn = (name) => {
  const i = js.indexOf("function " + name + "(");
  assert.ok(i >= 0, "function " + name + " exists");
  return js.slice(i, js.indexOf("\n}\n", i) + 3);
};

/* ================= 0. the stamp ================= */
const text = "build v163 · fold-the-rail";
for (const f of ["monthly.html", "index.html", "finances.html", "daily.html", "social.html"]) {
  assert.ok(read(f).includes(text), f + " carries the stamp");
}

/* ============ 1. the snippet is decoded once, then escaped once ============ */
const ctx = vm.createContext({});
vm.runInContext(fn("gmUnentity") + "\nthis.f = gmUnentity;", ctx);
const un = ctx.f;
assert.strictEqual(un("won&#39;t"), "won't", "a numeric entity becomes its character");
assert.strictEqual(un("Ashley&#x27;s &amp; co &lt;3 &quot;hi&quot;&nbsp;there"), "Ashley's & co <3 \"hi\" there", "hex and the named five too");
assert.strictEqual(un("<b>x</b>"), "<b>x</b>", "…and nothing else is touched — it decodes, it does not parse");
const item = fn("gmThreadToItem");
assert.ok(/it\.why = gmUnentity\(it\.why\);/.test(item) && /it\.draftPreview = gmUnentity\(it\.draftPreview\);/.test(item),
  "both snippets on a row go through it");
assert.ok(/'<div class="mail-why">' \+ esc\(it\.why\)/.test(fn("mailItemHtml")), "…and the page still escapes on the way out");

/* ============ 2. the row is as tall as its words ============ */
const row = fn("mailItemHtml");
assert.ok(!/mail-foot/.test(js) && !/\.mail-foot/.test(css), "the footer that held the tools is gone, rule and all");
assert.ok(/\.mail-tools\{position:absolute;top:6px;right:7px;[^}]*opacity:0;/.test(css), "the tools float over the corner, invisible until hovered");
assert.ok(/\.mail:hover \.mail-tools,\.mail-tools:focus-within\{opacity:1;\}/.test(css), "…and appear on hover or keyboard focus");
assert.ok(/@media\(hover:none\)\{\s*\.mail-tools\{position:static;opacity:1;/.test(css), "on a touch screen they are a plain line instead");
assert.ok(/<a class="mail-tool" href="' \+ esc\(href\) \+ '" target="_blank" rel="noopener"/.test(row) && /Open in Gmail<\/a>/.test(row),
  "Open in Gmail is still a real link among them");
assert.ok(/#ic-external/.test(row) && /<symbol id="ic-external"/.test(html), "…with an outward-arrow glyph");
assert.ok(/\.mail-why\{[^}]*-webkit-line-clamp:2;/.test(css), "the opening line stops at two lines");
assert.ok(/it\.action && !hasDraft \? '<span class="mail-act">'/.test(row), "a drafted row shows Review and send once, not a pill above it as well");
assert.ok(!/mail-act\.ready/.test(css), "…so the pill's 'ready' colour has no job left, and is gone");

/* ============ 3. the headings ============ */
const tier = fn("tierHtml");
assert.ok(/"Gmail<svg class=\\"ic\\"><use href=\\"#ic-external\\"\/><\/svg><\/a>"/.test(tier), "the label's link is one word and a glyph");
assert.ok(/title="Open ' \+ esc\(tier\.label \|\| "the inbox"\) \+ ' in Gmail"/.test(tier), "…which says where it goes when you hover it");
assert.ok(/'<span class="tier-r">' \+[\s\S]*?tier-clear[\s\S]*?open \+ "<\/span>"/.test(tier), "Clear all and Gmail sit together on the right");
assert.ok(/<button type="button" class="tier-fold" id="' \+ \(isFyi \? "fyiToggle" : "otherToggle"\)/.test(tier),
  "a pile's heading is the toggle");
assert.ok(/label \+ '<svg class="ic chev"><use href="#ic-chevron"\/><\/svg><\/button>'/.test(tier), "…dot, name, count and a chevron inside it");
assert.ok(/'<span class="tier-blurb">' \+ blurb \+ "<\/span>"/.test(tier), "…with 'for information' / 'you can probably ignore' beside it");
assert.ok(!/fyi-toggle/.test(js) && !/\.fyi-toggle/.test(css), "the second-line toggle is gone, rule and all");
assert.ok(/\.tier-fold\[aria-expanded="true"\] \.chev\{transform:rotate\(180deg\);\}/.test(css), "the chevron turns when the pile is open");
assert.ok(/\.tier\{margin-top:var\(--sp-4\);padding-top:var\(--sp-3\);border-top:1px solid var\(--line\);\}/.test(css) &&
  /\.tier:first-of-type\{margin-top:0;padding-top:0;border-top:0;\}/.test(css), "tiers are separated by a hairline, not by air");

console.log("v160 the-mail-card: ok");
