// v94 regression: the Monthly Report renders at the Weekly Dashboard's width and lands
// on the Monthly Plan tab. Layout + default-tab only — every tab must still switch.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/monthly-env.cjs");

const MONTHLY = fs.readFileSync(path.join(__dirname, "..", "monthly.html"), "utf8");
const WEEKLY = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

(async () => {
  /* ---------- build stamp ---------- */
  // "v94 or later" — the stamp moves with every release; the current one is asserted by
  // the newest version's test.
  const stamp = /<!-- build v(\d+) · [a-z0-9-]+ -->/.exec(MONTHLY);
  assert.ok(stamp && Number(stamp[1]) >= 94, "build stamp is v94 or later");

  /* ---------- 1. one width across the two pages ---------- */
  {
    // Weekly's container is .wrap; monthly's body IS the container. Same numbers either way.
    const wrap = /\.wrap\{([^}]*)\}/.exec(WEEKLY)[1];
    const body = /\n  body\{([^}]*)\}/.exec(MONTHLY)[1];
    const widthOf = (css) => (/max-width:(\d+)px/.exec(css) || [])[1];
    assert.strictEqual(widthOf(wrap), "1500", "the Weekly Dashboard container is 1500px");
    assert.strictEqual(widthOf(body), widthOf(wrap), "the Monthly Report matches the Weekly width");
    assert.ok(/margin:0 auto/.test(body), "…and is centred like Weekly");
    const pad = (css) => (/padding:0 (\d+)px/.exec(css) || [])[1];
    assert.strictEqual(pad(body), pad(wrap), "…with the same gutters");
    // the Weekly Dashboard itself is untouched
    assert.ok(/\.wrap\{max-width:1500px;margin:0 auto;padding:0 20px;\}/.test(WEEKLY),
      "index.html's container rule is unchanged");
  }

  /* ---------- 2. it lands on the Monthly Plan tab ---------- */
  {
    const env = await boot({ plans: {} });   // boot() only — no test-side navigation
    assert.strictEqual(env.ctx.__mpState.defaultView, "plan", "the default view is the Monthly Plan");
    assert.strictEqual(env.ctx.__mpState.view, "plan", "the Monthly Report opens on the Monthly Plan tab");
    // the static markup agrees, so there is no flash of the wrong tab before boot runs
    assert.ok(/<button class="vt active" data-view="plan">Monthly Plan<\/button>/.test(MONTHLY),
      "the Monthly Plan tab is marked active in the markup");
    assert.strictEqual((MONTHLY.match(/class="vt active"/g) || []).length, 1, "exactly one tab starts active");

    /* ---------- 3. every tab still switches ---------- */
    for (const view of ["home", "money", "growth", "plan", "home"]) {
      env.ctx.showView(view);
      await env.settle();
      assert.strictEqual(env.ctx.__mpState.view, view, "the " + view + " tab still switches");
    }
    ["plan", "home", "money", "growth"].forEach((v) =>
      assert.ok(MONTHLY.includes(`data-view="${v}"`), "the " + v + " tab is still in the bar"));
  }

  console.log("v94-monthly-width-and-default-tab.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
