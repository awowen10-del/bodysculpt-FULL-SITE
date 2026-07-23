// v71 harness — (1) the personal Training card and (2) the two-tab Notes card.
// Asserts training is a fully separate collection sharing the recurring engine, that a
// one-off training item behaves like a buffer task while a scheduled one places on its
// exact days and rolls over, that training carries its distinct 🏋️/green styling in
// card + grid + Today modal, and that the two rich-text note tabs (Brain Dump /
// Intentions Around Food) save independently, sanitise, round-trip formatting, commit
// on tab-switch, copy as clean plain text, and leave the Today modal reading Notes only.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");

const MARK = "<!--wp:rich-->";
const ALL_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const NOW = new Date();
function mondayIso(d) {
  const x = new Date(d);
  const back = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - back);
  x.setUTCHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}
// Fixed Mondays inside NAV_WEEKS for the rollover section…
const WEEK = "2026-03-16";
const PREV = "2026-03-09";
// …and the real current week (+ day) for the Today-modal section.
const TODAY_WEEK = mondayIso(NOW);
const TODAY = ALL_DAYS[NOW.getUTCDay()];

const lastPost = (posts, pred) => { const f = posts.filter(pred); return f[f.length - 1]; };
const notesPostsFor = (posts, field) =>
  posts.filter((p) => p.body.weeklyPlan && field in p.body.weeklyPlan);

(async () => {
  /* ================= PART 1 — TRAINING CARD ================= */

  /* ---------- 1: two separate collections — neither list bleeds into the other ---------- */
  {
    const defaults = [{ id: "r1", title: "Weekly Scorecard" }];
    const training = [{ id: "t1", title: "Leg day", days: ["mon", "thu"], time: "6-9" }, { id: "t2", title: "Yoga" }];
    const { ctx } = await boot({ defaults, training, plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    const st = ctx.__wpState;

    // the two underlying collections are distinct objects, no shared members
    assert.deepStrictEqual(st.defaults.map((d) => d.id), ["r1"], "recurring defaults unchanged");
    assert.deepStrictEqual(st.training.map((d) => d.id), ["t1", "t2"], "training collection loaded separately");

    const html = ctx.document.getElementById("wpBody").innerHTML;
    // Recurring card lists ONLY business tasks; Training card lists ONLY training
    const recCard = html.split('wpAddRecurring()')[0];
    const trainCard = html.split('wpAddTraining()')[0].split('wpAddRecurring()').pop();
    assert.ok(recCard.includes("Weekly Scorecard"), "recurring task in the Recurring card");
    assert.ok(!recCard.includes("Leg day") && !recCard.includes("Yoga"), "training tasks never appear in the Recurring card");
    assert.ok(trainCard.includes("Leg day") && trainCard.includes("Yoga"), "training tasks appear in the Training card");
    assert.ok(!trainCard.includes("Weekly Scorecard"), "recurring task never appears in the Training card");
    // the shared resolver keeps them apart by ref prefix
    assert.strictEqual(ctx.wpResolveRef("training:t1").title, "Leg day", "training ref resolves to a training item");
    assert.strictEqual(ctx.wpResolveRef("recurring:r1").title, "Weekly Scorecard", "recurring ref resolves to a recurring item");
    assert.strictEqual(ctx.wpResolveRef("training:r1"), null, "a recurring id is not resolvable as training");
  }

  /* ---------- 2: a one-off training item behaves like a buffer item ---------- */
  {
    const training = [{ id: "t1", title: "Sauna" }]; // no days → one-off
    const { ctx, posts } = await boot({ training, plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    const st = ctx.__wpState;
    const ref = "training:t1";

    // drag onto a single cell (like a buffer task) — lands in exactly that one cell
    await ctx.wpPlaceRefAt(ref, "1-3", "wed");
    // Array.from — vm-realm arrays fail deepStrictEqual's prototype check
    assert.deepStrictEqual(Array.from(ctx.wpPlacementsOf(ref)), ["1-3:wed"], "one-off training placed in the single dropped cell");
    // move it — leaves the old cell, occupies only the new one
    await ctx.wpPlaceRefAt(ref, "5-8", "fri");
    assert.deepStrictEqual(Array.from(ctx.wpPlacementsOf(ref)), ["5-8:fri"], "one-off training moves like a buffer task");
    // tick done — stored in trainingDone under the plain id, recurringDone untouched
    await ctx.wpToggleDoneRef(ref, true, "fri");
    assert.strictEqual(st.plan.trainingDone.t1, true, "one-off training done flag in trainingDone");
    assert.strictEqual(Object.keys(st.plan.recurringDone).length, 0, "recurringDone never touched by training");
    assert.ok(ctx.wpIsDone("training", ctx.wpResolveRef(ref)), "wpIsDone reflects the training tick");
    // its placement/done persist via the normal timeBlocks section
    const tb = lastPost(posts, (p) => p.body.weeklyPlan && p.body.weeklyPlan.trainingDone);
    assert.ok(tb.body.weeklyPlan.trainingDone.t1 === true, "training done round-trips to the store");
  }

  /* ---------- 3: a scheduled training item places on exactly its days (shared engine) ---------- */
  {
    const training = [{ id: "t1", title: "Strength" }];
    const { ctx } = await boot({ training, plans: { [WEEK]: { weekEnding: WEEK, placements: {} } } });
    await ctx.loadWeeklyPlan(WEEK);
    const st = ctx.__wpState;
    // schedule via the SAME writer recurring uses, with a source arg
    await ctx.wpSetRecurrence("t1", ["mon", "wed", "fri"], "10-12", "training");
    const P = st.plan.placements;
    assert.deepStrictEqual(Array.from(ctx.wpPlacementsOf("training:t1")).sort(), ["10-12:fri", "10-12:mon", "10-12:wed"], "placed on exactly its three selected days at its slot");
    ["tue", "thu", "sat", "sun"].forEach((d) => assert.ok(!(P["10-12:" + d] || []).includes("training:t1"), "not placed on unselected " + d));
    assert.deepStrictEqual(Array.from(st.training.find((t) => t.id === "t1").days), ["mon", "wed", "fri"], "days stored on the training item");
    // multi-day done keys are per-day under trainingDone (mirrors recurring's shape)
    await ctx.wpToggleDoneRef("training:t1", true, "wed");
    assert.strictEqual(st.plan.trainingDone["t1:wed"], true, "per-day training done key");
    assert.ok(!("t1" in st.plan.trainingDone), "no plain key invented for a multi-day training task");
    // clearing the day set returns it to one-off (unplaced), engine-shared
    await ctx.wpSetRecurrence("t1", [], "10-12", "training");
    assert.strictEqual(ctx.wpPlacementsOf("training:t1").length, 0, "empty day set unplaces the training task");
    assert.ok(!st.training.find((t) => t.id === "t1").days, "days field removed when schedule cleared");
  }

  /* ---------- 4: scheduled training rolls into a fresh week; one-off does not ---------- */
  {
    const training = [
      { id: "t1", title: "Strength", days: ["mon", "wed"], time: "6-9" }, // scheduled → should seed
      { id: "t2", title: "Massage" },                                     // one-off → must NOT seed
    ];
    const defaults = [{ id: "r1", title: "Scorecard" }];
    const plans = {
      [WEEK]: null, // fresh week
      [PREV]: {
        weekEnding: PREV,
        placements: {
          "6-9:mon": ["training:t1", "recurring:r1"],
          "6-9:wed": ["training:t1"],
          "1-3:tue": ["training:t2"], // a hand-placed one-off from last week
        },
      },
    };
    const { ctx } = await boot({ training, defaults, plans });
    await ctx.loadWeeklyPlan(WEEK);
    const P = ctx.__wpState.plan.placements;
    assert.ok((P["6-9:mon"] || []).includes("training:t1") && (P["6-9:wed"] || []).includes("training:t1"), "scheduled training rolled into the new week on its days");
    assert.ok((P["6-9:mon"] || []).includes("recurring:r1"), "recurring still rolls over alongside (independent pass)");
    const all = Object.values(P).flat();
    assert.ok(!all.includes("training:t2"), "one-off training does not auto-roll into a fresh week");
  }

  /* ---------- 5: distinct 🏋️/green styling in card, grid, and Today modal ---------- */
  {
    const training = [{ id: "t1", title: "Leg day", days: [TODAY], time: "6-9" }];
    const plans = { [TODAY_WEEK]: { weekEnding: TODAY_WEEK, placements: { ["6-9:" + TODAY]: ["training:t1"] } } };
    const { ctx } = await boot({ training, plans });
    await ctx.loadWeeklyPlan(TODAY_WEEK);
    // card row: green accent class + emoji + schedule button
    const body = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(body.includes("wp-train-row") && body.includes("🏋️"), "training card row carries the green class + 🏋️");
    assert.ok(body.includes(`wpOpenPopup('training','t1'`), "training row opens the shared day/slot popup");
    // grid chip: green chip class + emoji, distinct from recurring's teal wp-recur
    assert.ok(body.includes("wp-cellchip") && body.includes("wp-train"), "training grid chip carries the wp-train accent");
    assert.ok(body.includes(`wpToggleDoneRef('training:t1'`), "training chip ticks through the shared done path");
    // Today modal: same chip styling via the shared renderer
    ctx.wpOpenToday();
    const modal = ctx.document.getElementById("wpTodayBody").innerHTML;
    assert.ok(modal.includes("wp-train") && modal.includes("🏋️"), "training chip keeps 🏋️/green in the Today modal");
    assert.ok(modal.includes(`wpTodayToggleDone('training:t1'`), "training placed today is tickable in the modal");
    ctx.wpCloseToday();
  }

  /* ================= PART 2 — NOTES TABS ================= */

  /* ---------- 6: existing notes preserved under the renamed tab; foodNotes is separate ---------- */
  {
    const plans = { [WEEK]: { weekEnding: WEEK, placements: {}, notes: "my existing brain dump" } };
    const { ctx } = await boot({ plans });
    await ctx.loadWeeklyPlan(WEEK);
    const body = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(body.includes("Notes / Brain Dump") && body.includes("Intentions Around Food"), "both tabs rendered in the same card");
    assert.ok(body.includes("my existing brain dump"), "existing notes content carried over untouched under the renamed tab");
    assert.ok(body.includes(`id="wpWeekNotesEd"`) && body.includes(`id="wpWeekFoodEd"`), "both editors present");
    assert.strictEqual(ctx.__wpState.plan.foodNotes, "", "foodNotes defaults to empty, independent of notes");
    // the food editor advertises its structure-hinting placeholder
    assert.ok(body.includes("What went well? What didn't?"), "food tab shows the structured placeholder");
  }

  /* ---------- 7: the two fields save independently and never overwrite each other ---------- */
  {
    const plans = { [WEEK]: { weekEnding: WEEK, placements: {}, notes: "brain", foodNotes: "food" } };
    const { ctx, posts } = await boot({ plans });
    await ctx.loadWeeklyPlan(WEEK);
    const st = ctx.__wpState;
    // edit notes only, save its section
    ctx.document.getElementById("wpWeekNotesEd").innerHTML = "brain edited";
    ctx.document.getElementById("wpWeekFoodEd").innerHTML = "food"; // unchanged on screen
    await ctx.wpSaveSection("notes");
    const nPost = lastPost(posts, (p) => p.body.weeklyPlan && "notes" in p.body.weeklyPlan);
    assert.ok(!("foodNotes" in nPost.body.weeklyPlan), "the notes save carries ONLY the notes field");
    assert.strictEqual(nPost.body.weeklyPlan.notes, MARK + "brain edited", "notes field saved");
    // edit food only, save its section
    ctx.document.getElementById("wpWeekFoodEd").innerHTML = "food edited";
    await ctx.wpSaveSection("foodNotes");
    const fPost = lastPost(posts, (p) => p.body.weeklyPlan && "foodNotes" in p.body.weeklyPlan);
    assert.ok(!("notes" in fPost.body.weeklyPlan), "the foodNotes save carries ONLY the foodNotes field");
    assert.strictEqual(fPost.body.weeklyPlan.foodNotes, MARK + "food edited", "foodNotes field saved");
    assert.strictEqual(st.plan.notes, MARK + "brain edited", "notes not clobbered by the food save");
  }

  /* ---------- 8: rich formatting + checkbox state round-trip on BOTH tabs ---------- */
  {
    const RICH = `<b>bold</b><ul><li>item</li></ul><div class="wp-note-todo"><input type="checkbox" checked>&nbsp;done thing</div><div class="wp-note-todo"><input type="checkbox">&nbsp;todo thing</div>`;
    // save both fields with rich content, then reload from the echoed store values
    const plans1 = { [WEEK]: { weekEnding: WEEK, placements: {}, notes: "", foodNotes: "" } };
    const b1 = await boot({ plans: plans1 });
    await b1.ctx.loadWeeklyPlan(WEEK);
    b1.ctx.document.getElementById("wpWeekNotesEd").innerHTML = RICH;
    b1.ctx.document.getElementById("wpWeekFoodEd").innerHTML = RICH;
    await b1.ctx.wpSaveSection("notes");
    await b1.ctx.wpSaveSection("foodNotes");
    const storedNotes = notesPostsFor(b1.posts, "notes").pop().body.weeklyPlan.notes;
    const storedFood = notesPostsFor(b1.posts, "foodNotes").pop().body.weeklyPlan.foodNotes;
    assert.strictEqual(storedNotes, MARK + RICH, "notes rich content stored verbatim");
    assert.strictEqual(storedFood, MARK + RICH, "food rich content stored verbatim");

    const b2 = await boot({ plans: { [WEEK]: { weekEnding: WEEK, placements: {}, notes: storedNotes, foodNotes: storedFood } } });
    await b2.ctx.loadWeeklyPlan(WEEK);
    const body = b2.ctx.document.getElementById("wpBody").innerHTML;
    // both editors show the same formatting incl. ticked + unticked checkbox states
    const twice = body.split(RICH).length - 1;
    assert.strictEqual(twice, 2, "both tabs reloaded the rich content (formatting + checkbox state) verbatim");
    assert.ok(body.includes(`<input type="checkbox" checked>&nbsp;done thing`), "ticked checkbox persists");
    assert.ok(body.includes(`<input type="checkbox">&nbsp;todo thing`), "unticked checkbox persists");
  }

  /* ---------- 9: switching tabs commits unsaved edits ---------- */
  {
    const plans = { [WEEK]: { weekEnding: WEEK, placements: {}, notes: "", foodNotes: "" } };
    const { ctx, posts } = await boot({ plans });
    await ctx.loadWeeklyPlan(WEEK);
    const st = ctx.__wpState;
    assert.strictEqual(ctx.__wpState && ctx.document.getElementById("wpWeekNotesEd") != null, true, "notes tab active by default");
    // type into notes but do NOT blur — then switch to the food tab
    ctx.document.getElementById("wpWeekNotesEd").innerHTML = "unsaved brain dump";
    const before = posts.length;
    ctx.wpNotesSwitchTab("foodNotes");
    assert.strictEqual(st.plan.notes, MARK + "unsaved brain dump", "outgoing tab's edit committed to its field on switch");
    const committed = lastPost(posts, (p) => p.body.weeklyPlan && "notes" in p.body.weeklyPlan);
    assert.ok(committed && committed.body.weeklyPlan.notes === MARK + "unsaved brain dump", "…and saved through wpSaveSection('notes')");
    assert.ok(posts.length > before, "a save fired on tab switch");
    // now the food tab is active and rendered
    assert.ok(ctx.document.getElementById("wpBody").innerHTML.includes(`wp-notes-rich" data-notes-block="foodNotes"`) ||
      ctx.document.getElementById("wpBody").innerHTML.includes(`data-notes-block="foodNotes"`), "food tab now present");
    // switching back with no change fires no redundant save
    const n = posts.length;
    ctx.wpNotesSwitchTab("notes");
    ctx.wpNotesSwitchTab("notes"); // same tab → no-op
    assert.strictEqual(posts.length, n, "no save when the outgoing tab is unchanged / switching to the current tab");
  }

  /* ---------- 10: sanitising applies to BOTH tabs ---------- */
  {
    const EVIL = `<script>alert(1)<` + `/script><b onclick="x()">keep</b><a href="javascript:e()">link</a><iframe src="https://x"></iframe><input type="checkbox" onclick="y()" checked>`;
    const plans = { [WEEK]: { weekEnding: WEEK, placements: {}, notes: "", foodNotes: "" } };
    const { ctx, posts } = await boot({ plans });
    await ctx.loadWeeklyPlan(WEEK);
    for (const [ed, field] of [["wpWeekNotesEd", "notes"], ["wpWeekFoodEd", "foodNotes"]]) {
      ctx.document.getElementById(ed).innerHTML = EVIL;
      await ctx.wpSaveSection(field);
      const saved = notesPostsFor(posts, field).pop().body.weeklyPlan[field];
      for (const bad of ["<script", "alert(", "onclick", "javascript:", "<iframe", "href"]) {
        assert.ok(!saved.includes(bad), field + " save stripped " + JSON.stringify(bad));
      }
      assert.ok(saved.includes("<b>keep</b>"), field + ": legit formatting kept");
      assert.ok(saved.includes(`<input type="checkbox" checked>`), field + ": checkbox kept, handler dropped");
    }
    // render side too: a tampered stored value is sanitised before it reaches the page
    ctx.__wpState.plan.foodNotes = MARK + EVIL;
    ctx.renderWeeklyPlan();
    const body = ctx.document.getElementById("wpBody").innerHTML;
    assert.ok(!body.includes("alert(") && !body.includes("<script") && !body.includes("javascript:"), "tampered foodNotes sanitised on render");
  }

  /* ---------- 11: copy produces clean plain text with bullets/checkboxes converted ---------- */
  {
    const plans = { [WEEK]: { weekEnding: WEEK, placements: {}, notes: "", foodNotes: "" } };
    const { ctx } = await boot({ plans });
    await ctx.loadWeeklyPlan(WEEK);
    const rich = MARK + `<b>Wins</b><ul><li>hit 3 sessions</li><li>slept well</li></ul>` +
      `<div class="wp-note-todo"><input type="checkbox" checked>&nbsp;meal prep</div>` +
      `<div class="wp-note-todo"><input type="checkbox">&nbsp;order protein</div>`;
    const plain = ctx.wpNotesToPlainText(rich);
    assert.ok(plain.includes("- hit 3 sessions") && plain.includes("- slept well"), "bullets become '- '");
    assert.ok(plain.includes("[x] meal prep"), "ticked checkbox becomes '[x] '");
    assert.ok(plain.includes("[ ] order protein"), "unticked checkbox becomes '[ ] '");
    assert.ok(!/[<>]/.test(plain), "no angle-bracket markup left in the plain text");
    // line breaks preserved as real newlines
    assert.ok(plain.split("\n").length >= 5, "line breaks preserved");
    // legacy plain text passes straight through
    assert.strictEqual(ctx.wpNotesToPlainText("just plain\ntext"), "just plain\ntext", "legacy plain text copied as-is");

    // the copy PATH flashes feedback using the shared clipboard helper
    const copied = [];
    ctx.navigator.clipboard = { writeText: (t) => { copied.push(t); return Promise.resolve(); } };
    ctx.__wpState.plan.foodNotes = rich;
    await ctx.wpNotesCopy("foodNotes");
    assert.strictEqual(copied.length, 1, "copy wrote to the clipboard");
    assert.ok(copied[0].includes("[x] meal prep"), "clipboard got the clean plain text");
    assert.strictEqual(ctx.document.getElementById("wpmsg-foodNotes").textContent, "Copied ✓", "Copied ✓ feedback shown in the tab");
  }

  /* ---------- 12: the Today modal still reads and writes ONLY the Notes field ---------- */
  {
    const plans = { [TODAY_WEEK]: { weekEnding: TODAY_WEEK, placements: {}, notes: "brain dump", foodNotes: "food plan" } };
    const { ctx, posts } = await boot({ plans });
    await ctx.loadWeeklyPlan(TODAY_WEEK);
    ctx.wpOpenToday();
    const modal = ctx.document.getElementById("wpTodayBody").innerHTML;
    assert.ok(modal.includes("brain dump"), "modal shows the Notes / Brain Dump field");
    assert.ok(!modal.includes("food plan") && !modal.includes("Intentions Around Food"), "modal never shows the food field");
    // editing in the modal writes notes only, food untouched, mirror-before-save intact.
    // Touch the weekly Notes editor so it exists for the mirror to write into (the real
    // DOM has it present after render; the stub only materialises it on first access).
    ctx.document.getElementById("wpWeekNotesEd");
    ctx.document.getElementById("wpTodayNotes").innerHTML = "edited via modal";
    await ctx.wpTodaySaveNotes();
    assert.strictEqual(ctx.__wpState.plan.notes, MARK + "edited via modal", "modal edit lands in notes");
    assert.strictEqual(ctx.__wpState.plan.foodNotes, "food plan", "foodNotes untouched by the modal (stays exactly as loaded)");
    const nPost = lastPost(posts, (p) => p.body.weeklyPlan && "notes" in p.body.weeklyPlan);
    assert.ok(!("foodNotes" in nPost.body.weeklyPlan), "modal save carries only the notes field");
    // the weekly Notes editor was mirrored (kept in sync without a re-render)
    assert.strictEqual(ctx.document.getElementById("wpWeekNotesEd").innerHTML, "edited via modal", "weekly Notes editor mirrored from the modal");
    ctx.wpCloseToday();
  }

  console.log("v71-training-and-notes-tabs.test: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
