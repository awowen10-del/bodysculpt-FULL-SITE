// netlify/lib/grok-connector.js  (v272, edits from v273, the Weekly page from v288)
//
// What the Grok app can see and do. Ash talks to Grok in its own app, and Grok reaches the
// dashboard through these tools. All reads and writes go through the `api` object it is handed,
// which uses the same routes the pages use (stepLink, addStep, the monthly plan's focus list),
// so the rules on those routes hold here too and nothing here touches the store directly.
//
// A CHANGE TAKES TWO CALLS. Without confirmed:true a tool writes nothing and hands back the
// words to read to Ash. Every write also records how to put it back, so "undo" works by voice.
//
// A day follows v252/v268: the step's week and day are written, and its due date moves only if
// it already had one. An undated step is not handed a deadline.
export const WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const UNDO_KEEP = 20;

const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const P = {
  project: { type: "string", description: "The project's name or id" },
  month: { type: "string", description: "YYYY-MM. Leave out for the current month." },
  day: { type: "string", description: "YYYY-MM-DD" },
  stepId: { type: "string", description: "The step's id, from get_project" },
  confirmed: { type: "boolean", description: "True only after Ash has heard this exact change and said yes" },
  week: { type: "string", description: "YYYY-MM-DD, any day in the week. Leave out for this week." },
  slot: { type: "string", enum: ["6-9", "10-12", "1-3", "5-8"], description: "The time on the Weekly grid: 6-9 is 6 to 9am, 10-12 is 9 to 11.30, 1-3 is 12 to 3, 5-8 is 5 to 8pm" },
};
const tool = (name, description, inputSchema, readOnly) => ({ name, description, inputSchema,
  annotations: { readOnlyHint: !!readOnly, destructiveHint: false } });

export const TOOLS = [
  tool("get_my_projects", "Lists Ash's live projects with progress, what is late and the next step.", obj({}), true),
  tool("get_month_plan", "Shows the whole Monthly page for a month, section by section: This Month's Focus, Personal Priorities, Notes & Issues and the Month-End Review, plus the projects not on it.", obj({ month: P.month }), true),
  tool("get_project", "Shows one project's open steps with their ids. Use before changing a step.", obj({ project: P.project }, ["project"]), true),
  tool("add_project_to_month", "Puts an existing project on a month, with an optional one-line goal.", obj({ project: P.project, goal: { type: "string" }, month: P.month, confirmed: P.confirmed }, ["project"])),
  tool("create_project", "Creates a new project and puts it on a month. Check get_my_projects first so a project is not made twice.", obj({ name: { type: "string" }, goal: { type: "string" }, month: P.month, confirmed: P.confirmed }, ["name"])),
  tool("take_project_off_month", "Takes a project off a month. The project and its steps are kept.", obj({ project: P.project, month: P.month, confirmed: P.confirmed }, ["project"])),
  tool("set_month_goal", "Sets the line saying what is true for this project by the end of the month.", obj({ project: P.project, goal: { type: "string" }, month: P.month, confirmed: P.confirmed }, ["project", "goal"])),
  tool("add_step", "Adds a step to a project, with an optional day.", obj({ project: P.project, title: { type: "string" }, day: P.day, confirmed: P.confirmed }, ["project", "title"])),
  tool("set_step_day", "Gives a step a day, or moves it to another. It then shows on Weekly and Today.", obj({ project: P.project, stepId: P.stepId, day: P.day, confirmed: P.confirmed }, ["project", "stepId", "day"])),
  tool("tick_step", "Marks a step done, or not done with done:false.", obj({ project: P.project, stepId: P.stepId, done: { type: "boolean" }, confirmed: P.confirmed }, ["project", "stepId"])),
  tool("add_personal_priority", "Adds an item to Personal Priorities & Projects on Monthly: life outside the business.", obj({ title: { type: "string" }, month: P.month, confirmed: P.confirmed }, ["title"])),
  tool("save_month_notes", "Adds to Notes & Issues on Monthly. What is there already stays.", obj({ notes: { type: "string" }, month: P.month, confirmed: P.confirmed }, ["notes"])),
  tool("get_month_review", "Gathers what happened in a month for the review: its plan, the steps finished, its numbers and any review already written. Leave month out for last month.", obj({ month: P.month }), true),
  tool("save_month_review", "Saves the Month-End Review on Monthly. Only the parts given are changed.", obj({ month: P.month, wins: { type: "string", description: "What moved and the wins" }, notDone: { type: "string", description: "What didn't move" }, carryForward: { type: "string", description: "What carries into next month" }, blockers: { type: "string", description: "Issues and blockers" }, confirmed: P.confirmed })),
  tool("ask_claude_for_plan", "Hands Ash's thoughts to his Claude agent, which has his monthly-planning skill. Saves nothing. Returns a job id. It takes about a minute, so tell him, then use get_claude_plan.", obj({ thoughts: { type: "string" }, month: P.month }, ["thoughts"])),
  tool("get_claude_plan", "Reads the plan Claude built for a job, or says it is still working.", obj({ job: { type: "string" } }, ["job"]), true),
  tool("apply_claude_plan", "Saves Claude's whole plan to the month: projects, goals, steps and days.", obj({ job: { type: "string" }, confirmed: P.confirmed }, ["job"])),
  // v288: the Weekly page. A week is named by any date in it.
  tool("get_week_plan", "Shows the whole Weekly page for a week: what is on each day, the Project and Buffer lists, overdue steps, what he is waiting on, the brain dump, food intentions, the end-of-week review and the Sunday review steps. Also the month's focus the week serves.", obj({ week: P.week }), true),
  tool("get_week_review", "Gathers what happened in a week for the Sunday review: what was ticked off and what wasn't, steps finished, each day's one thing, the daily non-negotiables and any review already written. Leave week out for this week.", obj({ week: P.week }), true),
  tool("save_week_review", "Saves the End-of-Week Review on Weekly. Only the parts given are changed, and a part given replaces what was there.", obj({ week: P.week, wins: { type: "string", description: "Wins this week" }, notDone: { type: "string", description: "What didn't get done" }, blockers: { type: "string", description: "Issues and blockers" }, confirmed: P.confirmed })),
  tool("add_week_notes", "Adds to the Notes / Brain Dump on Weekly. What is there already stays.", obj({ week: P.week, notes: { type: "string" }, confirmed: P.confirmed }, ["notes"])),
  tool("add_food_intentions", "Adds to Intentions Around Food on Weekly. What is there already stays.", obj({ week: P.week, notes: { type: "string" }, confirmed: P.confirmed }, ["notes"])),
  tool("tick_week_review_step", "Ticks a step of the Sunday review on Weekly, or unticks it with done:false.", obj({ week: P.week, step: { type: "string", enum: ["training", "food", "priorities", "reflect", "todo", "motivation", "copyai"], description: "training: sessions diarised and coach checked in. food: food intentions set. priorities: business and personal priorities planned. reflect: reflected on last week. todo: to-do list written. motivation: consumed something motivational. copyai: week run past AI." }, done: { type: "boolean" }, confirmed: P.confirmed }, ["step"])),
  tool("add_week_task", "Adds a one-off job to a week's Project list (business) or Buffer list (small things), and puts it on a day and time if given. A job that belongs to a project is a step instead: use add_step or set_step_day.", obj({ title: { type: "string" }, list: { type: "string", enum: ["project", "buffer"] }, day: P.day, slot: P.slot, week: P.week, confirmed: P.confirmed }, ["title"])),
  tool("add_training", "Puts a training session on Weekly's grid. every_week true: the session runs on those days and time every week, as the Training card's Add a session does (an existing session with that name has its days changed). Otherwise it is on the days given in that one week only.", obj({ title: { type: "string", description: "The session, e.g. Lower body, Swim, 5k run" }, days: { type: "array", items: { type: "string", enum: WEEK_DAYS }, description: "mon to sun" }, slot: P.slot, every_week: { type: "boolean" }, week: P.week, confirmed: P.confirmed }, ["title", "days", "slot"])),
  tool("undo_last_change", "Puts back the last change made through Grok. Say what was undone.", obj({})),
];

export const INSTRUCTIONS = "Ash's Bodysculpt dashboard. He talks to you, often out loud on his phone, so keep replies short and spoken. "
  + "He finds a blank planning page hard, so ask one question at a time and do the organising for him. "
  + "When he asks you to fill out his monthly plan: use get_month_plan and work down the page in order. "
  + "This Month's Focus first: which projects matter, a goal for each, the steps, and a next step with a day for each. Then Personal Priorities. Then Notes & Issues. "
  + "Ask one question at a time, only about sections that are still empty, and then fill them in from his answers. He should not have to think about tools or sections. "
  + "When he asks you to review a month: use get_month_review, tell him briefly what you found, ask what moved, what didn't, what carries forward and what got in the way, then save it with save_month_review. "
  + "When he asks to go through his week or do his weekly review: this is his Sunday review on the Weekly page. Use get_week_review for the week he is closing, tell him briefly what you found, then ask what the wins were, what didn't get done and what got in the way, and save it with save_week_review. "
  + "Then plan the next week with get_week_plan for that week: what the month's focus needs from it, which project steps go on which days (set_step_day, add_step), any one-off jobs (add_week_task), what he is fixing with food (add_food_intentions), his training sessions (add_training: ask whether a session is every week or just that week) and anything else on his mind (add_week_notes). "
  + "Food intentions, the brain dump and the review ticks go on the week being closed, the same as the review on the page. As each part of the Sunday review is covered, offer to tick it with tick_week_review_step. "
  + "Month and week tools state today's date, so use that to work out which month or week he means. If he has not planned the current month yet, check whether that is the one he means by next month. "
  + "When a change tool says it is not done yet, read it to him and wait for a clear yes before calling it again with confirmed true. To save him saying yes over and over, you may read out a section's changes together, and one yes covers everything you read out. "
  + "Never set confirmed true on your own say-so. Never say something is saved until the tool says so. If he says undo, use undo_last_change.";

class Say extends Error {}
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const validDay = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + "T00:00:00Z"));
const clip = (s, n) => (typeof s === "string" ? s.trim().slice(0, n) : "");
const newId = (prefix) => prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export function dayOf(s) {
  if (s.due) return s.due;
  if (!s.week || !s.day) return "";
  const d = new Date(s.week + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Math.max(0, WEEK_DAYS.indexOf(s.day)));
  return d.toISOString().slice(0, 10);
}
export function weekOf(ymd) {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export const dayKey = (ymd) => WEEK_DAYS[(new Date(ymd + "T00:00:00Z").getUTCDay() + 6) % 7];
export function dayFields(step, ymd) {
  const was = { week: step.week || "", day: step.day || "", slot: step.slot || "" };
  const fields = { week: weekOf(ymd), day: dayKey(ymd), slot: step.slot || "" };
  if (step.due) { was.due = step.due; fields.due = ymd; }
  return { fields, was };
}
const liveSteps = (p) => (p.steps || []).filter((s) => s && !s.del);
const finished = (p) => { const l = liveSteps(p); return p.status === "done" || (l.length > 0 && l.every((s) => s.done)); };
function openSteps(p) {
  const open = liveSteps(p).filter((s) => !s.done);
  const dated = open.filter((s) => dayOf(s)).sort((a, b) => (dayOf(a) > dayOf(b) ? 1 : -1));
  return dated.concat(open.filter((s) => !dayOf(s)));
}
function nextLine(p, today) {
  const n = openSteps(p)[0];
  if (!n) return liveSteps(p).length ? "all steps done" : "no steps yet";
  const on = dayOf(n);
  return "next: " + n.title + (on ? (on < today ? " (late, was " + on + ")" : " on " + on) : ", no day yet");
}
export function projectsText(projects, today) {
  const words = { planned: "Not started", active: "Running", paused: "Parked", done: "Finished" };
  const live = (projects || []).filter((p) => p && !p.archived && p.status !== "done");
  if (!live.length) return "There are no live projects.";
  return live.map((p) => {
    const steps = liveSteps(p), open = steps.filter((s) => !s.done);
    const late = open.filter((s) => dayOf(s) && dayOf(s) < today).length;
    return [p.name + " (" + (words[p.status] || p.status) + ")", (steps.length - open.length) + " of " + steps.length + " steps done",
      late ? late + " late" : "", nextLine(p, today)].filter(Boolean).join(". ");
  }).join("\n");
}
export function findProject(projects, ref) {
  const live = (projects || []).filter((p) => p && !p.archived);
  const hit = live.find((p) => p.id === ref) || live.find((p) => same(p.name, ref));
  if (hit) return hit;
  const q = String(ref || "").trim().toLowerCase();
  const near = q.length < 2 ? [] : live.filter((p) => p.name.toLowerCase().includes(q));
  if (near.length === 1) return near[0];
  if (near.length > 1) throw new Say("That could be " + near.map((p) => p.name).join(" or ") + ". Which one?");
  throw new Say("There's no project called " + ref + ". Live projects: " + live.map((p) => p.name).join(", "));
}
function findStep(p, id) {
  const s = liveSteps(p).find((x) => x.id === id);
  if (!s) throw new Say("That step isn't on " + p.name + ". Use get_project for its steps.");
  return s;
}
function monthOf(args, today) {
  const m = args && args.month;
  if (m === undefined || m === "") return today.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new Say("The month needs to be YYYY-MM.");
  return m;
}
function checkDay(day, today) {
  if (!validDay(day)) throw new Say("The day needs to be YYYY-MM-DD.");
  if (day < today) throw new Say(day + " has passed. Which day should it be?");
  return day;
}
const notYet = (what) => "NOT DONE YET. Read this to Ash and wait for his yes: " + what + ". If he says yes, call this tool again with exactly the same details and confirmed true.";

async function remember(api, label, ops) {
  const stack = (await api.undoLoad()) || [];
  stack.push({ label, ops, at: new Date().toISOString() });
  await api.undoSave(stack.slice(-UNDO_KEEP));
}
async function moveStep(api, p, s, ymd, ops) {
  const from = dayOf(s), { fields, was } = dayFields(s, ymd);
  await api.stepLink({ projectId: p.id, stepId: s.id, ...fields });
  ops.unshift({ k: "link", projectId: p.id, stepId: s.id, fields: was });
  if (from && weekOf(from) !== fields.week) {
    await api.calendar({ weekEnding: weekOf(from), tgt: { p: p.id, s: s.id }, cell: "",
      to: (fields.slot || "any") + ":" + fields.day, toWeek: fields.week, title: String(s.title || "") });
  }
}
const previousMonth = (ym) => { const [y, m] = ym.split("-").map(Number); return m === 1 ? (y - 1) + "-12" : y + "-" + String(m - 1).padStart(2, "0"); };
const REVIEW_PARTS = { wins: "What moved", notDone: "What didn't move", carryForward: "Carry forward", blockers: "Issues and blockers" };
const NUMBER_PARTS = { recurringRev: "recurring revenue", trialRev: "trial revenue", upfrontRev: "upfront revenue", otherRev: "other revenue",
  signups: "sign-ups", cancellations: "cancellations", recurring: "recurring members", leads: "leads", trialSales: "trial sales", adSpend: "ad spend" };
function planFocus(plan) { return plan && Array.isArray(plan.focus) ? plan.focus : []; }
const focusItem = (p, goal) => ({ id: "f" + Math.random().toString(36).slice(2, 9), title: p.name, rockRef: "", notes: "", done: false, projectId: p.id, ...(goal ? { goal } : {}) });
async function followDone(api, p, ym) {
  const plan = await api.plan(ym), focus = planFocus(plan);
  if (!focus.some((f) => f.projectId === p.id && !!f.done !== finished(p))) return;
  await api.savePlan(ym, focus.map((f) => (f.projectId === p.id ? { ...f, done: finished(p) } : f)));
}

function proposalText(pr) {
  const lines = [pr.summary || ""];
  for (const p of pr.projects) {
    lines.push(p.name + ": " + p.goal);
    for (const s of p.steps) lines.push("  " + s.title + (s.day ? " on " + s.day : ", no day yet"));
  }
  if (pr.leftOut && pr.leftOut.length) lines.push("Left out: " + pr.leftOut.join("; "));
  if (pr.question) lines.push("Claude asks: " + pr.question);
  return lines.filter(Boolean).join("\n");
}

/* ---------- v288: the Weekly page ----------
   A week is filed under its Monday (index.html calls it weekEnding). Every write sends only the
   fields it changes; the store merges a week's plan field by field, so the rest of the week is
   kept. The grid's placement engine lives in index.html and is not copied here: the days are
   read from the cache that page writes (weekly-agenda-<week>), with project steps read live
   from their boards, the way the page lays them out (v227). */
// Must match WP_REVIEW_CHECKLIST in index.html (the v288 test holds the two together).
export const WEEK_REVIEW_STEPS = [
  { id: "training", label: "Training sessions diarised + checked in with coach" },
  { id: "food", label: "Intentions around food set" },
  { id: "priorities", label: "Business + personal priorities planned" },
  { id: "reflect", label: "Reflect on last week" },
  { id: "todo", label: "To-do list written" },
  { id: "motivation", label: "Consume something motivational or educational" },
  { id: "copyai", label: "Copy the week and run it past AI for feedback" },
];
const WEEK_REVIEW = { wins: "Wins this week", notDone: "What didn't get done", blockers: "Issues and blockers" };
const SLOT_WORDS = { any: "any time", "6-9": "6 to 9", "10-12": "9 to 11.30", "1-3": "12 to 3", "5-8": "5 to 8", notes: "notes" };
const SLOT_ORDER = ["any", "6-9", "10-12", "1-3", "5-8", "notes"];
const HABITS = { read: "Read", mobility: "Mobility", house: "House" };
const NOTES_MARK = "<!--wp:rich-->";
const LISTS = { project: "projectItems", buffer: "bufferItems" };
export function addDays(ymd, n) {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const shortDate = (ymd) => new Date(ymd + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const weekName = (wk) => "the week of " + shortDate(wk) + " to " + shortDate(addDays(wk, 6));
function weekArg(a, today) {
  const w = a && a.week;
  if (w === undefined || w === "") return weekOf(today);
  if (!validDay(w)) throw new Say("The week needs to be a date, YYYY-MM-DD.");
  return weekOf(w);
}
// Where a step sits in a week, the way the Weekly page lays it out (wpStepCell in index.html).
export function stepCell(s, wk) {
  const slots = ["6-9", "10-12", "1-3", "5-8"];
  if (s.due) {
    if (!validDay(s.due) || weekOf(s.due) !== wk) return null;
    const day = dayKey(s.due);
    return { day, slot: s.week === wk && s.day === day && slots.includes(s.slot) ? s.slot : "any" };
  }
  if (s.week === wk && WEEK_DAYS.includes(s.day)) return { day: s.day, slot: slots.includes(s.slot) ? s.slot : "any" };
  if (s.week === wk) return { day: "", slot: "" };
  return null;
}
// Stored notes, either format, as plain words (wpNotesToPlainText in index.html, simplified).
export function notesPlain(stored) {
  const raw = typeof stored === "string" ? stored : "";
  if (raw.indexOf(NOTES_MARK) !== 0) return raw.trim();
  return raw.slice(NOTES_MARK.length)
    .replace(/<input[^>]*checked[^>]*>/g, "[x] ").replace(/<input[^>]*>/g, "[ ] ")
    .replace(/<li>/g, "\n- ").replace(/<br\s*\/?>/g, "\n").replace(/<(?:div|p)[^>]*>/g, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
}
// Adds lines to stored notes in the format they are already in, so nothing there is rewritten.
export function appendNotes(stored, text) {
  const before = typeof stored === "string" ? stored : "";
  if (before.indexOf(NOTES_MARK) === 0) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return before + text.split("\n").map((l) => "<div>" + (l.trim() ? esc(l) : "<br>") + "</div>").join("");
  }
  return before.trim() ? before.replace(/\s+$/, "") + "\n" + text : text;
}
const hasLegacyList = (plan) => ["project", "projects", "buffer"].some((k) => {
  const v = plan && plan[k];
  return (typeof v === "string" && v.trim()) || (Array.isArray(v) && v.length);
});
function weekList(plan, list) {
  const v = plan && plan[LISTS[list]];
  if (Array.isArray(v)) return v;
  if (hasLegacyList(plan)) throw new Say("That week was saved in an old format. Open it on Weekly once, then try again.");
  return [];
}
const listItems = (plan, list) => (Array.isArray(plan && plan[LISTS[list]]) ? plan[LISTS[list]] : []).filter((x) => x && !x.derived && String(x.title || "").trim());
// Everything on each day of a week, as rows { day, slot, title, done, plain }.
function weekRows(wk, plan, agenda, projects) {
  const rows = [];
  if (agenda && agenda.cells) {
    for (const [key, list] of Object.entries(agenda.cells)) {
      const [slot, day] = key.split(":");
      for (const r of list || []) if (!(r.tgt && r.tgt.p)) rows.push({ day, slot, title: r.title, done: !!r.done });
    }
  } else {
    const titles = {};
    for (const list of Object.keys(LISTS)) for (const it of listItems(plan, list)) titles[list + ":" + it.id] = it;
    for (const [key, refs] of Object.entries((plan && plan.placements) || {})) {
      const [slot, day] = key.split(":");
      for (const ref of refs || []) { const it = titles[ref]; if (it) rows.push({ day, slot, title: it.title, done: !!it.done }); }
    }
  }
  const tb = (plan && plan.timeBlocks) || {};
  for (const slot of SLOT_ORDER) for (const day of WEEK_DAYS) {
    const t = tb[slot] && typeof tb[slot][day] === "string" ? tb[slot][day].trim() : "";
    if (t) rows.push({ day, slot, title: t, plain: true });
  }
  for (const p of projects || []) {
    if (!p || p.archived) continue;
    for (const s of liveSteps(p)) {
      const at = stepCell(s, wk);
      if (at && at.day) rows.push({ day: at.day, slot: at.slot, title: s.title + " (" + p.name + ")", done: !!s.done, step: true });
    }
  }
  return rows;
}
function daysText(wk, rows) {
  return WEEK_DAYS.map((day, i) => {
    const here = rows.filter((r) => r.day === day).sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
    const bySlot = SLOT_ORDER.map((slot) => {
      const t = here.filter((r) => r.slot === slot).map((r) => r.title + (r.done ? " (done)" : ""));
      return t.length ? (SLOT_WORDS[slot] || slot) + ": " + t.join(", ") : "";
    }).filter(Boolean);
    return shortDate(addDays(wk, i)) + ": " + (bySlot.length ? bySlot.join("; ") : "nothing planned") + ".";
  }).join("\n");
}
function reviewStepsText(plan) {
  const rc = (plan && plan.reviewChecklist) || {};
  const left = WEEK_REVIEW_STEPS.filter((s) => !rc[s.id]);
  return "Sunday review steps: " + (WEEK_REVIEW_STEPS.length - left.length) + " of " + WEEK_REVIEW_STEPS.length + " done."
    + (left.length ? " Still to do: " + left.map((s) => s.label + " (" + s.id + ")").join("; ") + "." : "");
}
function reviewWrittenText(plan) {
  const r = (plan && plan.review) || {};
  const w = Object.entries(WEEK_REVIEW).filter(([k]) => String(r[k] || "").trim()).map(([k, label]) => label + ": " + String(r[k]).trim());
  return w.length ? "Review already written. " + w.join(". ") : "No review written yet.";
}
// Takes out the one task Grok added, by its id, so anything else changed since is kept.
async function undoWeekTask(api, op) {
  const plan = await api.week(op.week), field = LISTS[op.list], ref = op.list + ":" + op.id;
  const placements = {};
  for (const [k, refs] of Object.entries((plan && plan.placements) || {})) placements[k] = (refs || []).filter((r) => r !== ref);
  await api.saveWeek(op.week, { [field]: (Array.isArray(plan[field]) ? plan[field] : []).filter((x) => !x || x.id !== op.id), placements });
  const ag = await api.agenda(op.week).catch(() => null);
  if (ag && ag.cells) {
    for (const k of Object.keys(ag.cells)) ag.cells[k] = ag.cells[k].filter((r) => !(r.tgt && r.tgt.l === field && r.tgt.k === op.id));
    await api.saveAgenda(ag).catch(() => {});
  }
}
// Today reads a week from the cache Weekly writes. A week with a cache gets the new rows so Today
// shows them straight away; a week without one is left for Weekly to write whole.
async function addAgendaRows(api, wk, rows, ref) {
  const ag = await api.agenda(wk).catch(() => null);
  if (!ag || !ag.cells) return;
  const id = ref.split(":")[1];
  for (const { key, row } of rows) {
    const cell = (ag.cells[key] || []).filter((r) => !(r.kind === "training" && r.tgt && r.tgt.k && String(r.tgt.k).split(":")[0] === id));
    ag.cells[key] = cell.concat([row]);
  }
  await api.saveAgenda(ag).catch(() => {});
}
async function removeAgendaRef(api, wk, id) {
  const ag = await api.agenda(wk).catch(() => null);
  if (!ag || !ag.cells) return;
  for (const k of Object.keys(ag.cells)) ag.cells[k] = ag.cells[k].filter((r) => !(r.kind === "training" && r.tgt && String(r.tgt.k || "").split(":")[0] === id));
  await api.saveAgenda(ag).catch(() => {});
}
async function undoWeekRef(api, op) {
  const plan = await api.week(op.week), placements = { ...((plan && plan.placements) || {}) };
  for (const k of op.keys) if (placements[k]) placements[k] = placements[k].filter((r) => r !== op.ref);
  await api.saveWeek(op.week, { placements });
  await removeAgendaRef(api, op.week, op.ref.split(":")[1]);
}
const todayName = (today) => new Date(today + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });

export async function callTool(name, a, api, today) {
  a = a || {};
  switch (name) {
    case "get_my_projects": return projectsText(await api.projects(), today);
    case "get_month_plan": {
      const ym = monthOf(a, today);
      const [projects, plan] = await Promise.all([api.projects(), api.plan(ym)]);
      const focus = planFocus(plan);
      const on = focus.map((f) => {
        const p = (projects || []).find((x) => x.id === f.projectId);
        if (!p) return f.title + (f.done ? " (done)" : "");
        return p.name + (f.goal ? ": " + f.goal : ": no goal yet") + ". " + nextLine(p, today);
      });
      const ids = new Set(focus.map((f) => f.projectId).filter(Boolean));
      const off = (projects || []).filter((p) => !p.archived && !ids.has(p.id) && !finished(p)).map((p) => p.name);
      const personal = (plan.priorities || []).filter((x) => x && String(x.title || "").trim()).map((x) => x.title + " (" + (x.status || "Not Started") + ")");
      const review = Object.entries(REVIEW_PARTS).filter(([k]) => plan.review && String(plan.review[k] || "").trim()).map(([k]) => REVIEW_PARTS[k]);
      return ["Today is " + today + ". This is " + ym + ".",
        "This Month's Focus: " + (on.length ? "\n" + on.join("\n") : "empty."),
        "Personal Priorities: " + (personal.length ? personal.join("; ") : "empty."),
        "Notes & Issues: " + (String(plan.notes || "").trim() ? plan.notes : "empty."),
        "Month-End Review: " + (review.length ? "has " + review.join(", ") : "empty."),
      ].concat(off.length ? ["Projects not on this month: " + off.join(", ")] : []).join("\n");
    }
    case "get_project": {
      const p = findProject(await api.projects(), a.project);
      const open = openSteps(p);
      return p.name + ". " + (open.length ? open.slice(0, 30).map((s) => s.id + ": " + s.title + (dayOf(s) ? " on " + dayOf(s) : ", no day yet")).join("\n") : "No open steps.");
    }
    case "add_project_to_month": {
      const ym = monthOf(a, today), p = findProject(await api.projects(), a.project), goal = clip(a.goal, 400);
      if (!a.confirmed) return notYet("put " + p.name + " on " + ym + (goal ? " with the goal: " + goal : ""));
      const focus = planFocus(await api.plan(ym));
      if (focus.some((f) => f.projectId === p.id)) return p.name + " is already on " + ym + ".";
      await api.savePlan(ym, focus.concat([focusItem(p, goal)]));
      await remember(api, p.name + " added to " + ym, [{ k: "focus", ym, focus }]);
      return "Saved. " + p.name + " is on " + ym + ".";
    }
    case "create_project": {
      const ym = monthOf(a, today), title = clip(a.name, 160), goal = clip(a.goal, 400);
      if (!title) throw new Say("What should the project be called?");
      const clash = (await api.projects()).find((p) => !p.archived && same(p.name, title));
      if (clash) throw new Say(clash.name + " already exists. Use add_project_to_month.");
      if (!a.confirmed) return notYet("create a new project called " + title + " and put it on " + ym + (goal ? " with the goal: " + goal : ""));
      const p = await api.createProject(title);
      const focus = planFocus(await api.plan(ym));
      await api.savePlan(ym, focus.concat([focusItem(p, goal)]));
      await remember(api, title + " created", [{ k: "focus", ym, focus }]);
      return "Saved. " + title + " is on " + ym + ".";
    }
    case "take_project_off_month": {
      const ym = monthOf(a, today), p = findProject(await api.projects(), a.project);
      const focus = planFocus(await api.plan(ym));
      if (!focus.some((f) => f.projectId === p.id)) return p.name + " isn't on " + ym + ".";
      if (!a.confirmed) return notYet("take " + p.name + " off " + ym + ", keeping the project and its steps");
      await api.savePlan(ym, focus.filter((f) => f.projectId !== p.id));
      await remember(api, p.name + " taken off " + ym, [{ k: "focus", ym, focus }]);
      return "Saved. " + p.name + " is off " + ym + ". Its steps are kept.";
    }
    case "set_month_goal": {
      const ym = monthOf(a, today), p = findProject(await api.projects(), a.project), goal = clip(a.goal, 400);
      if (!goal) throw new Say("What's the goal?");
      const focus = planFocus(await api.plan(ym));
      if (!focus.some((f) => f.projectId === p.id)) throw new Say(p.name + " isn't on " + ym + " yet.");
      if (!a.confirmed) return notYet("set the goal for " + p.name + " to: " + goal);
      await api.savePlan(ym, focus.map((f) => (f.projectId === p.id ? { ...f, goal } : f)));
      await remember(api, "Goal set on " + p.name, [{ k: "focus", ym, focus }]);
      return "Saved.";
    }
    case "add_step": {
      const p = findProject(await api.projects(), a.project), title = clip(a.title, 240);
      if (!title) throw new Say("What's the step?");
      const day = a.day ? checkDay(a.day, today) : "";
      if (liveSteps(p).some((s) => !s.done && same(s.title, title))) throw new Say(p.name + " already has that step.");
      if (!a.confirmed) return notYet("add the step " + title + " to " + p.name + (day ? " on " + day : ""));
      const step = await api.addStep({ projectId: p.id, title, id: newId("s_") });
      const ops = [{ k: "link", projectId: p.id, stepId: step.id, fields: { del: true } }];
      if (day) await moveStep(api, p, step, day, ops);
      await remember(api, "Step added to " + p.name, ops);
      return "Saved. " + title + (day ? " is on " + day : " has no day yet") + ".";
    }
    case "set_step_day": {
      const p = findProject(await api.projects(), a.project), s = findStep(p, a.stepId), day = checkDay(a.day, today);
      if (!a.confirmed) return notYet("put " + s.title + " on " + day);
      if (dayOf(s) === day) return "It's already on " + day + ".";
      const ops = [];
      await moveStep(api, p, s, day, ops);
      await remember(api, s.title + " moved to " + day, ops);
      return "Saved. " + s.title + " is on " + day + ".";
    }
    case "tick_step": {
      const p = findProject(await api.projects(), a.project), s = findStep(p, a.stepId), done = a.done !== false;
      if (!a.confirmed) return notYet("mark " + s.title + (done ? " as done" : " as not done"));
      if (!!s.done === done) return "It's already marked that way.";
      await api.stepLink({ projectId: p.id, stepId: s.id, done });
      s.done = done;
      await followDone(api, p, today.slice(0, 7));
      await remember(api, s.title + (done ? " ticked" : " unticked"), [{ k: "link", projectId: p.id, stepId: s.id, fields: { done: !done } }]);
      return "Saved. " + s.title + (done ? " is done." : " is open again.");
    }
    case "add_personal_priority": {
      const ym = monthOf(a, today), title = clip(a.title, 400);
      if (!title) throw new Say("What's the priority?");
      if (!a.confirmed) return notYet("add to Personal Priorities for " + ym + ": " + title);
      const plan = await api.plan(ym), before = Array.isArray(plan.priorities) ? plan.priorities : [];
      if (before.some((x) => x && same(x.title, title))) return "That's already on Personal Priorities.";
      await api.savePart(ym, { priorities: before.concat([{ id: "mprj-" + Math.random().toString(36).slice(2, 9), title, owner: "Ash", status: "Not Started", notes: "" }]) });
      await remember(api, title + " added to Personal Priorities", [{ k: "part", ym, part: { priorities: before } }]);
      return "Saved.";
    }
    case "save_month_notes": {
      const ym = monthOf(a, today), notes = clip(a.notes, 4000);
      if (!notes) throw new Say("What's the note?");
      if (!a.confirmed) return notYet("add to Notes & Issues for " + ym + ": " + notes);
      const plan = await api.plan(ym), before = String(plan.notes || "");
      await api.savePart(ym, { notes: before.trim() ? before.trimEnd() + "\n" + notes : notes });
      await remember(api, "Notes added for " + ym, [{ k: "part", ym, part: { notes: before } }]);
      return "Saved.";
    }
    case "get_month_review": {
      const ym = a.month ? monthOf(a, today) : previousMonth(today.slice(0, 7));
      const [projects, plan, month] = await Promise.all([api.projects(), api.plan(ym), api.monthNumbers(ym)]);
      const lines = ["Today is " + today + ". Reviewing " + ym + "."];
      const focus = planFocus(plan);
      lines.push(focus.length ? "Planned: " + focus.map((f) => f.title + (f.done ? " (done)" : " (not done)")).join("; ") : "Nothing was planned on Monthly for this month.");
      const ticked = [];
      for (const p of projects) for (const s of liveSteps(p)) {
        if (s.done && String(s.updatedAt || "").startsWith(ym)) ticked.push(s.title + " (" + p.name + ")");
      }
      lines.push(ticked.length ? "Steps ticked off, " + ticked.length + " in all: " + ticked.slice(0, 20).join("; ") : "No steps were ticked off this month.");
      const nums = Object.entries(NUMBER_PARTS).filter(([k]) => month && typeof month[k] === "number").map(([k, w]) => w + " " + month[k]);
      lines.push(nums.length ? "Numbers: " + nums.join(", ") : "No numbers are in for this month yet.");
      const written = Object.entries(REVIEW_PARTS).filter(([k]) => plan && plan.review && String(plan.review[k] || "").trim()).map(([k, w]) => w + ": " + plan.review[k]);
      lines.push(written.length ? "Already written. " + written.join(". ") : "No review written yet.");
      return lines.join("\n");
    }
    case "save_month_review": {
      const ym = a.month ? monthOf(a, today) : previousMonth(today.slice(0, 7));
      const given = Object.keys(REVIEW_PARTS).filter((k) => clip(a[k], 4000));
      if (!given.length) throw new Say("There's nothing to save yet.");
      if (!a.confirmed) return notYet("save this review for " + ym + ": " + given.map((k) => REVIEW_PARTS[k] + ": " + clip(a[k], 4000)).join(". "));
      const plan = await api.plan(ym);
      const before = { wins: "", notDone: "", carryForward: "", blockers: "", ...((plan && plan.review) || {}) };
      const review = { ...before };
      for (const k of given) review[k] = clip(a[k], 4000);
      await api.saveReview(ym, review);
      await remember(api, "Review saved for " + ym, [{ k: "review", ym, review: before }]);
      return "Saved to the review for " + ym + ".";
    }
    case "ask_claude_for_plan": {
      const text = clip(a.thoughts, 8000);
      if (!text) throw new Say("What's on his mind for the month?");
      const job = await api.askStart(text, monthOf(a, today));
      return "Claude is working on it. It takes about a minute. The job id is " + job + ". Use get_claude_plan with that id.";
    }
    case "get_claude_plan": {
      const r = await api.askJob(a.job);
      if (r.status === "running") return "Claude is still working. Check again shortly.";
      if (r.status !== "done" || !r.proposal) return "Claude couldn't finish: " + (r.error || "no plan came back") + ".";
      return "Claude's plan. Nothing is saved yet.\n" + proposalText(r.proposal);
    }
    case "apply_claude_plan": {
      const r = await api.askJob(a.job);
      if (r.status !== "done" || !r.proposal) throw new Say("That plan isn't ready.");
      const pr = r.proposal, ym = /^\d{4}-\d{2}$/.test(pr.month || "") ? pr.month : today.slice(0, 7);
      if (!a.confirmed) return notYet("save this plan to " + ym + ":\n" + proposalText(pr));
      const projects = await api.projects();
      const before = planFocus(await api.plan(ym));
      const focus = before.map((f) => ({ ...f }));
      const ops = [];
      let done = 0, failed = 0;
      for (const x of pr.projects) {
        try {
          let p = projects.find((q) => q.id === x.projectId && !q.archived) || projects.find((q) => same(q.name, x.name) && !q.archived);
          if (!p) { p = await api.createProject(x.name); projects.push(p); }
          let it = focus.find((f) => f.projectId === p.id);
          if (!it) { it = focusItem(p, ""); focus.push(it); }
          if (x.goal) it.goal = x.goal;
          for (const y of x.steps) {
            let s = liveSteps(p).find((q) => q.id === y.stepId) || liveSteps(p).find((q) => same(q.title, y.title));
            if (!s) {
              s = await api.addStep({ projectId: p.id, title: y.title, id: newId("s_") });
              p.steps = (p.steps || []).concat([s]);
              ops.push({ k: "link", projectId: p.id, stepId: s.id, fields: { del: true } });
            }
            if (y.day && validDay(y.day) && y.day >= today && !s.done && dayOf(s) !== y.day) await moveStep(api, p, s, y.day, ops);
            done++;
          }
        } catch (e) { failed++; }
      }
      await api.savePlan(ym, focus);
      ops.push({ k: "focus", ym, focus: before });
      await remember(api, "Claude's plan saved to " + ym, ops);
      return failed ? "Partly saved. " + failed + " project didn't go in, so check Monthly." : "Saved to " + ym + ". " + done + " steps are in place.";
    }
    case "get_week_plan": {
      const wk = weekArg(a, today), ym = addDays(wk, 3).slice(0, 7);
      const [projects, plan, agenda, month, waiting] = await Promise.all([api.projects(), api.week(wk),
        api.agenda(wk).catch(() => null), api.plan(ym).catch(() => null), api.waiting().catch(() => [])]);
      const lines = ["Today is " + todayName(today) + " " + today + ". This is " + weekName(wk) + " (week " + wk + ")."];
      const focus = planFocus(month);
      lines.push(focus.length ? "The month's focus (" + ym + "): " + focus.map((f) => f.title + (f.goal ? ": " + f.goal : "") + (f.done ? " (done)" : "")).join("; ") + "."
        : "Monthly has no focus set for " + ym + ".");
      lines.push("Day by day:\n" + daysText(wk, weekRows(wk, plan, agenda, projects)));
      if (!agenda) lines.push("Regular jobs and training aren't shown because Weekly hasn't been opened on this week yet. They land from their own schedules.");
      const pulled = [];
      for (const p of projects || []) if (p && !p.archived) for (const s of liveSteps(p)) {
        const at = stepCell(s, wk);
        if (at && !at.day && !s.done) pulled.push(s.title + " (" + p.name + ")");
      }
      const items = (list) => listItems(plan, list).map((x) => x.title + (x.done ? " (done)" : ""));
      const proj = items("project").concat(pulled);
      lines.push("Project list: " + (proj.length ? proj.join("; ") : "empty") + ".");
      lines.push("Buffer list: " + (items("buffer").length ? items("buffer").join("; ") : "empty") + ".");
      const sessions = ((await api.training().catch(() => [])) || []).filter((t) => t && String(t.title || "").trim())
        .map((t) => t.title + (Array.isArray(t.days) && t.days.length ? " (every " + t.days.join(", ") + (SLOT_WORDS[t.time] ? " " + SLOT_WORDS[t.time] : "") + ")" : " (no set days)"));
      lines.push("Training sessions: " + (sessions.length ? sessions.join("; ") : "none set up") + ".");
      if (addDays(wk, 6) >= today) {
        const late = [];
        for (const p of projects || []) if (p && !p.archived) for (const s of liveSteps(p)) if (!s.done && s.due && s.due < today) late.push(s.title + " (" + p.name + ", was " + s.due + ")");
        if (late.length) lines.push("Overdue project steps: " + late.slice(0, 15).join("; ") + ".");
      }
      const wait = (Array.isArray(waiting) ? waiting : []).filter((w) => !w.ready).map((w) => w.title + (w.on ? ", waiting on " + w.on : ""));
      if (wait.length) lines.push("Waiting on: " + wait.slice(0, 15).join("; ") + ".");
      const brain = notesPlain(plan.notes), food = notesPlain(plan.foodNotes);
      lines.push("Notes / Brain Dump: " + (brain ? "\n" + brain.slice(0, 3000) : "empty."));
      lines.push("Intentions Around Food: " + (food ? "\n" + food.slice(0, 2000) : "empty."));
      lines.push("End-of-Week Review: " + reviewWrittenText(plan));
      lines.push(reviewStepsText(plan));
      return lines.join("\n");
    }
    case "get_week_review": {
      const wk = weekArg(a, today), end = addDays(wk, 6);
      const [projects, plan, agenda, checkins] = await Promise.all([api.projects(), api.week(wk),
        api.agenda(wk).catch(() => null), api.checkins().catch(() => ({}))]);
      const lines = ["Today is " + todayName(today) + " " + today + ". Reviewing " + weekName(wk) + " (week " + wk + ")."];
      const rows = weekRows(wk, plan, agenda, projects).filter((r) => !r.plain);
      const done = rows.filter((r) => r.done), open = rows.filter((r) => !r.done);
      lines.push(rows.length ? done.length + " of " + rows.length + " things on the days were ticked off." : "Nothing was put on the days of this week.");
      if (open.length) lines.push("Not ticked off: " + open.slice(0, 25).map((r) => r.title + " (" + shortDate(addDays(wk, WEEK_DAYS.indexOf(r.day))) + ")").join("; ") + ".");
      if (!agenda) lines.push("Regular jobs and training aren't counted because Weekly wasn't opened on this week.");
      const lists = ["project", "buffer"].map((l) => listItems(plan, l)).flat();
      const listOpen = lists.filter((x) => !x.done).map((x) => x.title);
      if (lists.length) lines.push("Week lists: " + (lists.length - listOpen.length) + " of " + lists.length + " done." + (listOpen.length ? " Still open: " + listOpen.slice(0, 20).join("; ") + "." : ""));
      const ticked = [];
      for (const p of projects || []) for (const s of liveSteps(p)) {
        const at = String(s.updatedAt || "").slice(0, 10);
        if (s.done && at >= wk && at <= end) ticked.push(s.title + " (" + p.name + ")");
      }
      lines.push(ticked.length ? "Project steps finished, " + ticked.length + " in all: " + ticked.slice(0, 20).join("; ") + "." : "No project steps were finished this week.");
      const ones = [], habits = {};
      for (let i = 0; i < 7; i++) {
        const e = checkins && checkins[addDays(wk, i)];
        if (!e) continue;
        const one = notesPlain(e.oneThing);
        if (one) ones.push(shortDate(addDays(wk, i)) + ": " + one + (e.oneThingDone === true ? " (done)" : e.oneThingDone === false ? " (not done)" : ""));
        for (const k of Object.keys(HABITS)) if (e.habits && e.habits[k] === true) habits[k] = (habits[k] || 0) + 1;
      }
      lines.push(ones.length ? "Each day's one thing. " + ones.join(". ") + "." : "No one thing was set on any day.");
      lines.push("Daily non-negotiables: " + Object.entries(HABITS).map(([k, w]) => w + " " + (habits[k] || 0) + " of 7").join(", ") + ".");
      lines.push(reviewWrittenText(plan));
      lines.push(reviewStepsText(plan));
      return lines.join("\n");
    }
    case "save_week_review": {
      const wk = weekArg(a, today);
      const given = Object.keys(WEEK_REVIEW).filter((k) => clip(a[k], 4000));
      if (!given.length) throw new Say("There's nothing to save yet.");
      if (!a.confirmed) return notYet("save this review for " + weekName(wk) + ": " + given.map((k) => WEEK_REVIEW[k] + ": " + clip(a[k], 4000)).join(". "));
      const plan = await api.week(wk);
      const before = { wins: "", notDone: "", carryForward: "", blockers: "", ...((plan && plan.review) || {}) };
      const review = { ...before };
      for (const k of given) review[k] = clip(a[k], 4000);
      await api.saveWeek(wk, { review });
      await remember(api, "Weekly review saved for " + weekName(wk), [{ k: "week", week: wk, part: { review: before } }]);
      return "Saved to the review for " + weekName(wk) + ".";
    }
    case "add_week_notes":
    case "add_food_intentions": {
      const wk = weekArg(a, today), text = clip(a.notes, 4000);
      const field = name === "add_week_notes" ? "notes" : "foodNotes", where = name === "add_week_notes" ? "the brain dump" : "Intentions Around Food";
      if (!text) throw new Say("What should it say?");
      if (!a.confirmed) return notYet("add to " + where + " for " + weekName(wk) + ": " + text);
      const plan = await api.week(wk), before = typeof plan[field] === "string" ? plan[field] : "";
      await api.saveWeek(wk, { [field]: appendNotes(before, text) });
      await remember(api, "Added to " + where + " for " + weekName(wk), [{ k: "week", week: wk, part: { [field]: before } }]);
      return "Saved.";
    }
    case "tick_week_review_step": {
      const wk = weekArg(a, today), step = WEEK_REVIEW_STEPS.find((s) => s.id === a.step), done = a.done !== false;
      if (!step) throw new Say("That isn't one of the Sunday review steps.");
      if (!a.confirmed) return notYet((done ? "tick " : "untick ") + step.label + " for " + weekName(wk));
      const plan = await api.week(wk);
      const before = plan.reviewChecklist && typeof plan.reviewChecklist === "object" && !Array.isArray(plan.reviewChecklist) ? plan.reviewChecklist : {};
      if (!!before[step.id] === done) return "It's already " + (done ? "ticked" : "unticked") + ".";
      const rc = { ...before };
      if (done) rc[step.id] = true; else delete rc[step.id];
      await api.saveWeek(wk, { reviewChecklist: rc });
      await remember(api, step.label + (done ? " ticked" : " unticked"), [{ k: "week", week: wk, part: { reviewChecklist: before } }]);
      return "Saved. " + (WEEK_REVIEW_STEPS.filter((s) => rc[s.id]).length) + " of " + WEEK_REVIEW_STEPS.length + " steps done.";
    }
    case "add_week_task": {
      const title = clip(a.title, 200), list = a.list === "buffer" ? "buffer" : "project";
      if (!title) throw new Say("What's the job?");
      if (a.slot && !SLOT_WORDS[a.slot]) throw new Say("The time needs to be 6-9, 10-12, 1-3 or 5-8.");
      const day = a.day ? checkDay(a.day, today) : "";
      if (day && !a.slot) throw new Say("What time on " + shortDate(day) + ": 6 to 9, 9 to 11.30, 12 to 3, or 5 to 8?");
      const wk = day ? weekOf(day) : weekArg(a, today);
      if (day && a.week && weekArg(a, today) !== wk) throw new Say(day + " isn't in that week.");
      const plan = await api.week(wk), items = weekList(plan, list);
      if (items.some((x) => x && !x.done && same(x.title, title))) throw new Say("That's already on the " + list + " list for " + weekName(wk) + ".");
      const where = (list === "buffer" ? "the Buffer list" : "the Project list") + " for " + weekName(wk) + (day ? ", on " + shortDate(day) + " " + SLOT_WORDS[a.slot] : ", with no day yet");
      if (!a.confirmed) return notYet("add " + title + " to " + where);
      const id = newId("t");
      const placements = { ...((plan && plan.placements) || {}) };
      const part = { [LISTS[list]]: items.concat([{ id, title, done: false }]) };
      if (day) { const key = a.slot + ":" + dayKey(day); placements[key] = (placements[key] || []).concat([list + ":" + id]); part.placements = placements; }
      await api.saveWeek(wk, part);
      if (day) {
        const ag = await api.agenda(wk).catch(() => null);
        if (ag && ag.cells) {
          const key = a.slot + ":" + dayKey(day);
          ag.cells[key] = (ag.cells[key] || []).concat([{ title, kind: list, done: false, tgt: { l: LISTS[list], k: id } }]);
          await api.saveAgenda(ag).catch(() => {});
        }
      }
      await remember(api, title + " added to " + weekName(wk), [{ k: "weekTask", week: wk, list, id }]);
      return "Saved. " + title + " is on " + where + ".";
    }
    case "add_training": {
      const title = clip(a.title, 120), every = a.every_week === true;
      if (!title) throw new Say("What's the session?");
      if (!SLOT_WORDS[a.slot] || a.slot === "any" || a.slot === "notes") throw new Say("What time: 6 to 9, 9 to 11.30, 12 to 3, or 5 to 8?");
      const days = WEEK_DAYS.filter((d) => Array.isArray(a.days) && a.days.includes(d));
      if (!days.length) throw new Say("Which days?");
      const wk = weekArg(a, today), list = (await api.training()) || [];
      const hit = list.find((t) => t && same(t.title, title));
      const dayWords = days.map((d) => d[0].toUpperCase() + d.slice(1)).join(", ") + " " + SLOT_WORDS[a.slot];
      if (every) {
        if (!a.confirmed) return notYet((hit ? "change " + hit.title + " to" : "add the training session " + title + ",") + " every week on " + dayWords);
        const before = hit ? { ...hit } : null, id = (hit && hit.id) || newId("t");
        const item = { ...(hit || {}), id, title: hit ? hit.title : title, days, time: a.slot };
        await api.saveTraining(hit ? list.map((t) => (t === hit ? item : t)) : list.concat([item]));
        for (const w of [weekOf(today), addDays(weekOf(today), 7)]) {
          await addAgendaRows(api, w, days.map((d) => ({ key: a.slot + ":" + d, row: { title: item.title, kind: "training", done: false, tgt: { m: "trainingDone", k: days.length > 1 ? id + ":" + d : id } } })), "training:" + id);
        }
        await remember(api, item.title + " set for every week", [{ k: "training", id, item: before }]);
        return "Saved. " + item.title + " is every week on " + dayWords + ".";
      }
      if (hit && Array.isArray(hit.days) && hit.days.length) {
        throw new Say(hit.title + " already runs every week on " + hit.days.join(", ") + ". Give this one a different name, like " + hit.title + " extra, or change its days with every_week.");
      }
      if (!a.confirmed) return notYet("put " + (hit ? hit.title : title) + " on " + dayWords + " for " + weekName(wk) + " only");
      const ops = [];
      let id = hit && hit.id;
      if (!id) {
        id = newId("t");
        const item = hit ? { ...hit, id } : { id, title };
        await api.saveTraining(hit ? list.map((t) => (t === hit ? item : t)) : list.concat([item]));
        ops.push({ k: "training", id, item: hit ? { ...hit } : null });
      }
      const ref = "training:" + id, name = hit ? hit.title : title;
      const plan = await api.week(wk), placements = { ...((plan && plan.placements) || {}) };
      for (const d of days) { const key = a.slot + ":" + d; placements[key] = (placements[key] || []).filter((r) => r !== ref).concat([ref]); }
      await api.saveWeek(wk, { placements });
      await addAgendaRows(api, wk, days.map((d) => ({ key: a.slot + ":" + d, row: { title: name, kind: "training", done: false, tgt: { m: "trainingDone", k: id } } })), ref);
      ops.unshift({ k: "weekRef", week: wk, ref, keys: days.map((d) => a.slot + ":" + d) });
      await remember(api, name + " put on " + weekName(wk), ops);
      return "Saved. " + name + " is on " + dayWords + " for " + weekName(wk) + ".";
    }
    case "undo_last_change": {
      const stack = (await api.undoLoad()) || [];
      const last = stack.pop();
      if (!last) return "There's nothing to undo.";
      for (const op of last.ops) {
        if (op.k === "focus") await api.savePlan(op.ym, op.focus);
        else if (op.k === "review") await api.saveReview(op.ym, op.review);
        else if (op.k === "part") await api.savePart(op.ym, op.part);
        else if (op.k === "week") await api.saveWeek(op.week, op.part);
        else if (op.k === "weekTask") await undoWeekTask(api, op);
        else if (op.k === "weekRef") await undoWeekRef(api, op);
        else if (op.k === "training") {
          const list = (await api.training()) || [];
          await api.saveTraining(op.item ? list.map((t) => (t && (t.id === op.id || (!t.id && same(t.title, op.item.title))) ? op.item : t)) : list.filter((t) => !t || t.id !== op.id));
          for (const w of [weekOf(today), addDays(weekOf(today), 7)]) {
            await removeAgendaRef(api, w, op.id);
            const ds = op.item && Array.isArray(op.item.days) ? op.item.days : [];
            if (ds.length && op.item.time) await addAgendaRows(api, w, ds.map((d) => ({ key: op.item.time + ":" + d,
              row: { title: op.item.title, kind: "training", done: false, tgt: { m: "trainingDone", k: ds.length > 1 ? op.id + ":" + d : op.id } } })), "training:" + op.id);
          }
        }
        else await api.stepLink({ projectId: op.projectId, stepId: op.stepId, ...op.fields });
      }
      await api.undoSave(stack);
      return "Undone: " + last.label + ".";
    }
    default: throw new Say("Unknown tool.");
  }
}

// One JSON-RPC message in, one reply out, or null for a notification.
export async function handleRpc(msg, api, today) {
  const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id: (msg && msg.id) ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(-32600, "Invalid request");
  if (msg.id === undefined) return null;
  const text = (t, isError) => reply({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
  switch (msg.method) {
    case "initialize":
      return reply({ protocolVersion: (msg.params && msg.params.protocolVersion) || "2025-06-18",
        capabilities: { tools: {} }, serverInfo: { name: "bodysculpt-dashboard", version: "1.5.0" }, instructions: INSTRUCTIONS });
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS });
    case "tools/call": {
      const name = msg.params && msg.params.name;
      if (!TOOLS.some((t) => t.name === name)) return fail(-32602, "Unknown tool");
      try { return text(await callTool(name, msg.params.arguments, api, today)); }
      catch (e) { return text(e instanceof Say ? e.message : "That didn't work, and nothing was confirmed as saved. Check the dashboard before trying again.", true); }
    }
    default: return fail(-32601, "Method not found");
  }
}
