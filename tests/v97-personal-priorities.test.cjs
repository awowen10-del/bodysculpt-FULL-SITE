// v97 regression: "Priorities & Projects" is repurposed as "Personal Priorities & Projects"
// — the personal counterpart to This Month's Focus. Same section, same items, same save
// path; new framing, a quiet green accent, and NO business Rock link. This Month's Focus
// stays business-only and Rock-linked.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { boot, openPlan } = require("./lib/monthly-env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const STORE_SRC = fs.readFileSync(
  path.join(__dirname, "..", "netlify", "functions", "kpi-store.js"), "utf8");

const AUG = "2026-08";
const ROCKS = [{ title: "Retention above 92%" }, { title: "Open the second studio" }];

// The two cards, sliced out of the rendered plan so each can be checked in isolation.
function cards(env) {
  const html = env.body.innerHTML;
  const pStart = html.indexOf('<div class="mp-box mp-personal">');
  const fStart = html.indexOf("This Month's Focus");
  return {
    html,
    personal: html.slice(pStart, html.indexOf('<div class="mp-box"', pStart + 10)),
    focus: html.slice(html.lastIndexOf('<div class="mp-box">', fStart), pStart),
  };
}

(async () => {
  /* ---------- build stamp ---------- */
  // Requested as v91, but the file was already at v96 and three tests assert ">= v93/94/95";
  // a v91 stamp would move the build backwards and fail them. Shipped as v97 instead.
  assert.ok(/<!-- build v97 · personal-priorities -->/.test(HTML), "build stamp is v97 · personal-priorities");

  const env = await boot({
    plans: { [AUG]: { ym: AUG,
      focus: [{ id: "f1", title: "Rebuild the onboarding call", rockRef: "1", notes: "with Dan", done: false }],
      priorities: [
        // pre-existing items, one carrying a now-meaningless Rock link from before the repurpose
        { id: "p1", title: "Redo the garden", owner: "Ash", status: "In Progress", notes: "quotes in", rockRef: "1" },
        { id: "p2", title: "Book the Italy trip", owner: "", status: "Done", notes: "" },
      ],
    } },
    rocks: ROCKS,
  });
  await openPlan(env, AUG);

  /* ---------- 1. the section reads as personal ---------- */
  {
    const c = cards(env);
    assert.ok(c.personal.includes("Personal Priorities &amp; Projects"), "the heading names it personal");
    assert.ok(!/>Priorities &amp; Projects</.test(c.html), "the old business-sounding heading is gone");
    assert.ok(c.personal.includes("life outside the business"), "the header hint frames it as personal");
    assert.ok(/<div class="mp-intro">Personal projects and priorities for the month — life outside the business\.<\/div>/.test(c.personal),
      "the intro line says what the section is for");
    // quiet green accent, mirroring the weekly app's Training / food-notes treatment
    assert.ok(c.personal.startsWith('<div class="mp-box mp-personal">'), "the card takes the personal class");
    assert.ok(/\.mp-personal\{[^}]*border-left:3px solid rgba\(63,191,127/.test(HTML), "…with a green edge");
    assert.ok(/\.mp-personal \.mp-box-h\{color:var\(--green\);?\}/.test(HTML), "…and a green heading, not the business orange");
    assert.ok(/\.mp-personal \.mp-item\{[^}]*border-left:2px solid rgba\(63,191,127/.test(HTML),
      "…carried onto its items");
    assert.ok(!/\.mp-personal[^{]*\{[^}]*background:var\(--green\)/.test(HTML), "the accent stays quiet, not a filled block");
  }

  /* ---------- 2. no Rock link anywhere in the personal section ---------- */
  {
    const c = cards(env);
    assert.ok(!c.personal.includes("rockRef"), "no Rock-link control renders on a personal item");
    assert.ok(!c.personal.includes("Supports which Rock?"), "…and no Rock label");
    assert.ok(!c.personal.includes("mp-linktag"), "…and no Rock badge");
    assert.ok(!/mpRockOptions/.test(c.personal), "…the Rock option list is never rendered here");
    // the stale link is cleared from state on load, without touching anything else
    const p1 = env.ctx.__mpState.plan.priorities.find((p) => p.id === "p1");
    assert.strictEqual(p1.rockRef, undefined, "a Rock link stored before the repurpose is cleared");
    assert.strictEqual(env.posts.length, 0, "…and nothing is written just by opening the month");
  }

  /* ---------- 3. existing items survive the relabel intact ---------- */
  {
    const list = env.ctx.__mpState.plan.priorities;
    assert.strictEqual(list.length, 2, "no item was dropped");
    assert.strictEqual(list[0].title, "Redo the garden", "titles survive");
    assert.strictEqual(list[0].owner, "Ash", "owners survive");
    assert.strictEqual(list[0].status, "In Progress", "status survives");
    assert.strictEqual(list[0].notes, "quotes in", "notes survive");
    assert.strictEqual(list[0].id, "p1", "ids survive, so weekly links still resolve");
    assert.strictEqual(list[1].status, "Done", "a completed item stays completed");

    const c = cards(env);
    assert.ok(c.personal.includes('value="Redo the garden"'), "the item renders with its title");
    assert.ok(c.personal.includes('value="quotes in"'), "…and its notes");
    assert.ok(/<option selected>In Progress<\/option>/.test(c.personal), "…and its status");
    assert.ok(c.personal.includes("mpPushProjectToWeek('p1')"), "the weekly-action button still works");
  }

  /* ---------- 4. save / load still works on the same path ---------- */
  {
    env.ctx.mpSyncFromDom();
    await env.ctx.mpSaveSection("priorities");
    await env.settle();
    const posted = env.posts[env.posts.length - 1].body.monthlyPlan;
    assert.strictEqual(posted.ym, AUG, "saved against this month");
    assert.deepStrictEqual(Object.keys(posted).sort(), ["priorities", "ym"], "…on the unchanged section path");
    assert.strictEqual(posted.priorities.length, 2, "both items save");
    assert.strictEqual(posted.priorities[0].title, "Redo the garden", "…with their content");
    assert.strictEqual(posted.priorities[0].rockRef, undefined, "…and without the stale Rock link");

    // reload: everything comes back, still personal, still link-free
    const env2 = await boot({ plans: { [AUG]: env.plans[AUG] }, rocks: ROCKS });
    await openPlan(env2, AUG);
    const reloaded = env2.ctx.__mpState.plan.priorities;
    assert.strictEqual(reloaded.length, 2, "both items reload");
    assert.strictEqual(reloaded[0].notes, "quotes in", "…with notes intact");
    assert.strictEqual(reloaded[0].rockRef, undefined, "…and no Rock link");
    // add / remove still behave
    env2.ctx.mpAddPrio();
    assert.strictEqual(env2.ctx.__mpState.plan.priorities.length, 3, "+ Add priority still adds");
    env2.ctx.mpRemovePrio({ closest: () => env2.body.rows().filter((r) => r.kind === "prio")[2] });
    assert.strictEqual(env2.ctx.__mpState.plan.priorities.length, 2, "✕ still removes");
  }

  /* ---------- 5. This Month's Focus is untouched ---------- */
  {
    const c = cards(env);
    assert.ok(c.focus.includes("This Month's Focus"), "the Focus card is still there");
    assert.ok(c.focus.includes("link each to a Rock"), "…still framed as Rock-linked business work");
    assert.ok(c.focus.includes("Supports which Rock?"), "…still offers the Rock link");
    assert.ok(/<option value="1" selected>Rock 2: Open the second studio<\/option>/.test(c.focus),
      "…with the linked Rock preselected");
    assert.ok(c.focus.includes('<span class="mp-linktag">↳ Rock 2</span>'), "…and the Rock badge");
    assert.ok(!c.focus.includes("mp-personal"), "the Focus card takes no personal styling");
    assert.strictEqual(env.ctx.__mpState.plan.focus[0].rockRef, "1", "the focus item keeps its Rock link");

    // and a focus save still carries rockRef
    await env.ctx.mpSaveSection("focus");
    await env.settle();
    const focusPost = env.posts[env.posts.length - 1].body.monthlyPlan;
    assert.deepStrictEqual(Object.keys(focusPost).sort(), ["focus", "ym"], "focus saves on its own path");
    assert.strictEqual(focusPost.focus[0].rockRef, "1", "…with the Rock link intact");
    assert.strictEqual(focusPost.focus[0].notes, "with Dan", "…and its notes");
  }

  /* ---------- 6. the store whitelists personal items the same way ---------- */
  {
    const grab = (name) => {
      const start = STORE_SRC.indexOf("function " + name);
      assert.ok(start >= 0, name + " exists in kpi-store.js");
      return STORE_SRC.slice(start, STORE_SRC.indexOf("\n}", start) + 2);
    };
    const tStart = STORE_SRC.indexOf("const MONTHLY_PRIORITY_STRINGS");
    const table = STORE_SRC.slice(tStart, STORE_SRC.indexOf("};", tStart) + 2);
    const sandbox = { module: {} };
    vm.createContext(sandbox);
    vm.runInContext(table + "\n" + grab("cleanMonthlyPriorities") +
      "\n;module.exports = { cleanMonthlyPriorities };", sandbox);
    const { cleanMonthlyPriorities } = sandbox.module.exports;

    const out = cleanMonthlyPriorities([
      { id: "p1", title: "Redo the garden", owner: "Ash", status: "Done", notes: "n", rockRef: "1", junk: "x" },
      null,
    ]);
    assert.strictEqual(out.length, 1, "null entries are dropped");
    assert.deepStrictEqual(Object.keys(out[0]).sort(), ["id", "notes", "owner", "status", "title"],
      "exactly the personal item's own fields are kept");
    assert.strictEqual(out[0].rockRef, undefined, "a stale Rock link is dropped server-side too");
    assert.strictEqual(out[0].junk, undefined, "unknown fields are dropped");
    assert.strictEqual(out[0].status, "Done", "a completed item stays completed through the store");
    assert.strictEqual(out[0].notes, "n", "notes survive the whitelist");
    assert.strictEqual(cleanMonthlyPriorities(new Array(80).fill({ title: "x" })).length, 60, "runaway lists are capped");
    assert.ok(/if \(Array\.isArray\(incoming\.priorities\)\) incoming\.priorities = cleanMonthlyPriorities/.test(STORE_SRC),
      "priorities are sanitised only when part of the write");
  }

  console.log("v97-personal-priorities.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
