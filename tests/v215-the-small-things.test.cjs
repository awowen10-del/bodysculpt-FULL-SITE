// v215 — the small things that decide whether a board is usable.
//
// Three reports from Ash, an hour into using the Projects page for real:
//
//  1. "Can I have a + sign at the top, to create a new task - saves me scrolling all the
//     way to the bottom." Eleven cards in To do, and the only way to add one was at the
//     foot of the column.
//
//  2. "If the column is quite long… if I'm trying to move a job from the bottom to the top,
//     or to any other column where the column isn't obviously there, it doesn't scroll with
//     the screen it just stays stuck and I can't move it." A browser's drag-and-drop
//     scrolls nothing for you, so everything off-screen was simply unreachable.
//     Inside that bug was a second one: scroll-snap on the board ate the auto-scroll,
//     snapping every nudge straight back to the column it started in.
//
//  3. "Can you also do it, so that we can upload .md files and have it attached to the
//     jobs? Reason is, one of the jobs is 'Write down everything Ontraport currently does'
//     and you do that for me in another chat… would be nice to link to that in the file you
//     have access to." So a written note hangs off the step it is about, is READ on the
//     page rather than dumped as raw text, and has an address that can be handed back.
//
// The markdown reader is RUN here, not read: it takes a document from somewhere else and
// turns it into HTML for this page, so "it escapes everything before it adds any markup" is
// the assertion that matters and the only honest way to make it is to try.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const PAGE = read("projects.html");
const STYLE = PAGE.slice(PAGE.indexOf("<style>") + 7, PAGE.indexOf("</style>"));
const JS = PAGE.slice(PAGE.lastIndexOf("<script>") + 8, PAGE.lastIndexOf("</script>"));
function bodyOf(js, name) {
  const re = new RegExp("\\n(?:async )?function " + name + "\\s*\\(", "g");
  const m = re.exec(js);
  assert.ok(m, "the page defines " + name + "()");
  let i = js.indexOf("{", m.index + m[0].length - 1), depth = 0, j = i;
  for (; j < js.length; j++) {
    if (js[j] === "{") depth++;
    else if (js[j] === "}") { depth--; if (!depth) break; }
  }
  return js.slice(i, j + 1);
}

(async () => {
  {
    /* =====================================================================
       1. A STEP CAN BE ADDED AT EITHER END OF A COLUMN
       Ash, with eleven cards in To do: "Can I have a + sign at the top, to create a new
       task - saves me scrolling all the way to the bottom." */
    assert.ok(/data-addtop="/.test(JS), "the column head carries a + that adds at the top");
    assert.ok(/data-addstep="/.test(JS), "…and the button at the foot still adds at the bottom");
    const add = bodyOf(JS, "startAddStep");
    assert.ok(/function startAddStep\(colId, atTop\)/.test(JS), "one add path, told which end");
    assert.ok(/if \(atTop\) col\.insertBefore\(inp, zone\);/.test(add),
      "the top box sits ABOVE the cards, not inside them — typing a second step redraws that list");
    assert.ok(/let at = atTop \? 0 : null;/.test(add) && /if \(at != null\) at\+\+;/.test(add),
      "…and several typed in a row keep the order they were typed in");
    assert.ok(/const open = document\.querySelector\("\.pb-newin"\);/.test(add),
      "only one typing box is ever open at a time");
    // both ends renumber through the same function, so a column's order cannot drift
    const addStepBody = bodyOf(JS, "addStep");
    assert.ok(/reorder\(p, colId, st\.id, index\)/.test(addStepBody),
      "both ends go through reorder(), so the column is renumbered 0..n either way");
    assert.ok(!/order: liveSteps/.test(addStepBody), "…and nothing guesses an order number of its own");


  }

  {
    /* =====================================================================
       2. A CARD IN THE AIR CAN REACH THE WHOLE BOARD
       Ash: "if I'm trying to move a job from the bottom to the top, or to any other column
       where the column isn't obviously there, it doesn't scroll with the screen it just
       stays stuck and I can't move it." A browser's drag-and-drop scrolls nothing for you,
       so everything off-screen was unreachable. Verified in a real browser over CDP — the
       page moved 0→651 and the board 2→653 while held at the bottom-right edge — because
       requestAnimationFrame does not run under this suite's headless harness. */
    assert.ok(/function dragScrollStart\(\)/.test(JS) && /function dragScrollStop\(\)/.test(JS),
      "there is a loop that scrolls while a card is being dragged");
    const startLoop = bodyOf(JS, "dragScrollStart");
    assert.ok(/window\.scrollBy\(0, dy\)/.test(startLoop), "…the PAGE scrolls up and down (the columns are as tall as they need to be)");
    assert.ok(/board\.scrollLeft \+= dx/.test(startLoop), "…and the BOARD scrolls left and right (it is its own scroller)");
    assert.ok(/requestAnimationFrame\(tick\)/.test(startLoop), "…a frame at a time, not once per mouse move");
    // THE BUG INSIDE THE BUG: scroll-snap silently ate the auto-scroll, snapping every
    // nudge straight back to the column it came from.
    assert.ok(/\.pb-board\.nosnap\{scroll-snap-type:none;\}/.test(STYLE), "a dragging board does not snap");
    assert.ok(/b\.classList\.add\("nosnap"\)/.test(startLoop), "…switched off when the drag starts");
    assert.ok(/b\.classList\.remove\("nosnap"\)/.test(bodyOf(JS, "dragScrollStop")), "…and back on when it ends");
    // and it stops: on release, and on drop
    const cards = bodyOf(JS, "wireCards");
    assert.ok(/dragScrollStart\(\)/.test(cards), "picking a card up starts it");
    assert.ok(/dragScrollStop\(\)/.test(cards), "letting go stops it");
    assert.ok(/dragScrollStop\(\);/.test(bodyOf(JS, "wireBoard")), "…and so does dropping onto a column");
    assert.ok(/document\.addEventListener\("dragover", dragTrack, true\)/.test(startLoop),
      "the pointer is tracked in capture, so it is heard over parts of the page that are not drop targets");

  }

  /* =====================================================================
     3. A WRITTEN NOTE, ATTACHED TO THE JOB IT IS ABOUT
     ===================================================================== */
  {
    const lib = read("netlify/lib/projects.js");
    assert.ok(/"text\/markdown", "text\/plain",/.test(lib), "the store accepts written notes");
    // text has to say its encoding or a browser guesses, and a document full of curly
    // quotes and em-dashes comes back as mojibake
    const fn = read("netlify/functions/projects.js");
    assert.ok(/\/\^text\\\//.test(fn) && /charset=utf-8/.test(fn), "…and they are served with their encoding");
    // these files carry no type of their own — the extension is the only thing that says so
    const mimeOf = bodyOf(JS, "mimeOf");
    assert.ok(/\(md\|markdown\)\$\/i\.test\(file\.name\)\) return "text\/markdown"/.test(mimeOf),
      "a .md is recognised by its extension");
    assert.ok(/\\.txt\$\/i\.test\(file\.name\)\) return "text\/plain"/.test(mimeOf), "…and a .txt too");
    assert.ok((PAGE.match(/\.md,\.markdown,\.txt/g) || []).length === 2,
      "both file pickers offer them");
    // the address is the point: it is what gets handed to Claude in another chat
    assert.ok(/id="lbCopy"/.test(PAGE), "a note's link can be copied");
    assert.ok(/copy\.hidden = !isText\(it\.mime\)/.test(JS), "…and that button is only there for a note");
    assert.ok(/navigator\.clipboard\.writeText\(url\)/.test(JS), "…the whole absolute address, not a fragment");
    // a note is read on the page, not thrown into a tab as raw text
    assert.ok(/mdToHtml\(t\)/.test(JS), "a markdown note is rendered");
    assert.ok(/"<pre>" \+ esc\(t\) \+ "<\/pre>"/.test(JS), "…and a plain .txt is shown as it was written, escaped");
    assert.ok(/\.md table\{border-collapse:collapse/.test(STYLE), "…with its tables drawn as tables");
    assert.ok(/data-file="/.test(JS), "a file on a step opens in the page rather than a new tab");

    /* ---------- the reader, RUN ---------- */
    // the WHOLE line — the definition contains semicolons inside its own strings
    const escSrc = /^const esc = .*$/m.exec(JS);
    assert.ok(escSrc, "the page's own escaper is readable");
    const md = new Function(escSrc[0] + "\nreturn (function mdToHtml(src)" + bodyOf(JS, "mdToHtml") + ");")();

    // THE ONE THAT MATTERS: these documents are written elsewhere and are not trusted.
    const nasty = md('# Hi\n\n<script>alert(1)</script>\n\nAnything using <merge fields> breaks.\n\n<img src=x onerror=alert(1)>');
    assert.ok(!/<script/i.test(nasty), "a <script> in a document cannot become a script in the page");
    assert.ok(!/<img/i.test(nasty), "…nor an <img>");
    assert.ok(!/onerror/i.test(nasty) || !/<[a-z]+[^>]*onerror/i.test(nasty), "…nor an event handler on anything");
    assert.ok(nasty.includes("&lt;merge fields&gt;"), "…and the words that were written still read as the words that were written");
    // a link that is not a link
    const evil = md("[click](javascript:alert(1))");
    assert.ok(!/<a /.test(evil), "only http(s) links become links");
    assert.ok(md("[docs](https://help.gohighlevel.com)").includes('<a href="https://help.gohighlevel.com"'),
      "…and those ones do");

    // and it actually renders the things a document written for Ash contains
    assert.ok(md("# Title").includes("<h1>Title</h1>"), "headings");
    assert.ok(md("### Small").includes("<h3>Small</h3>"), "…at every level");
    assert.ok(md("**bold**").includes("<strong>bold</strong>"), "bold");
    assert.ok(md("some *italic* words").includes("<em>italic</em>"), "italics");
    assert.ok(md("use `code` here").includes("<code>code</code>"), "inline code");
    assert.ok(md("- one\n- two").includes("<ul>") && (md("- one\n- two").match(/<li>/g) || []).length === 2, "bullets");
    assert.ok(md("1. one\n2. two").includes("<ol>"), "numbered lists");
    assert.ok(md("> careful").includes("<blockquote>"), "quotes");
    assert.ok(md("---").includes("<hr>"), "rules");
    const table = md("| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |");
    assert.ok(/<table>[\s\S]*<th>A<\/th>[\s\S]*<td>1<\/td>[\s\S]*<td>4<\/td>[\s\S]*<\/table>/.test(table),
      "pipe tables, header and all rows");
    const fenced = md("```\nconst x = <y>;\n```");
    assert.ok(/<pre><code>/.test(fenced) && fenced.includes("&lt;y&gt;"), "fenced code, escaped inside");
    // an unterminated fence must not eat the document or leave the markup open
    assert.ok(/<\/code><\/pre>/.test(md("```\nnever closed")), "an unclosed code fence still closes itself");
    assert.strictEqual(md(""), "", "an empty document is empty, not an error");
    assert.strictEqual(md(null), "", "…and so is nothing at all");
  }

  console.log("v215-the-small-things: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
