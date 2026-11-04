// netlify/lib/grok-connector.js  (v272, edits from v273)
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
};
const tool = (name, description, inputSchema, readOnly) => ({ name, description, inputSchema,
  annotations: { readOnlyHint: !!readOnly, destructiveHint: false } });

export const TOOLS = [
  tool("get_my_projects", "Lists Ash's live projects with progress, what is late and the next step.", obj({}), true),
  tool("get_month_plan", "Shows the projects on a month, each with its goal and next step, and the projects not on it.", obj({ month: P.month }), true),
  tool("get_project", "Shows one project's open steps with their ids. Use before changing a step.", obj({ project: P.project }, ["project"]), true),
  tool("add_project_to_month", "Puts an existing project on a month, with an optional one-line goal.", obj({ project: P.project, goal: { type: "string" }, month: P.month, confirmed: P.confirmed }, ["project"])),
  tool("create_project", "Creates a new project and puts it on a month. Check get_my_projects first so a project is not made twice.", obj({ name: { type: "string" }, goal: { type: "string" }, month: P.month, confirmed: P.confirmed }, ["name"])),
  tool("take_project_off_month", "Takes a project off a month. The project and its steps are kept.", obj({ project: P.project, month: P.month, confirmed: P.confirmed }, ["project"])),
  tool("set_month_goal", "Sets the line saying what is true for this project by the end of the month.", obj({ project: P.project, goal: { type: "string" }, month: P.month, confirmed: P.confirmed }, ["project", "goal"])),
  tool("add_step", "Adds a step to a project, with an optional day.", obj({ project: P.project, title: { type: "string" }, day: P.day, confirmed: P.confirmed }, ["project", "title"])),
  tool("set_step_day", "Gives a step a day, or moves it to another. It then shows on Weekly and Today.", obj({ project: P.project, stepId: P.stepId, day: P.day, confirmed: P.confirmed }, ["project", "stepId", "day"])),
  tool("tick_step", "Marks a step done, or not done with done:false.", obj({ project: P.project, stepId: P.stepId, done: { type: "boolean" }, confirmed: P.confirmed }, ["project", "stepId"])),
  tool("get_month_review", "Gathers what happened in a month for the review: its plan, the steps finished, its numbers and any review already written. Leave month out for last month.", obj({ month: P.month }), true),
  tool("save_month_review", "Saves the Month-End Review on Monthly. Only the parts given are changed.", obj({ month: P.month, wins: { type: "string", description: "What moved and the wins" }, notDone: { type: "string", description: "What didn't move" }, carryForward: { type: "string", description: "What carries into next month" }, blockers: { type: "string", description: "Issues and blockers" }, confirmed: P.confirmed })),
  tool("ask_claude_for_plan", "Hands Ash's thoughts to his Claude agent, which has his monthly-planning skill. Saves nothing. Returns a job id. It takes about a minute, so tell him, then use get_claude_plan.", obj({ thoughts: { type: "string" }, month: P.month }, ["thoughts"])),
  tool("get_claude_plan", "Reads the plan Claude built for a job, or says it is still working.", obj({ job: { type: "string" } }, ["job"]), true),
  tool("apply_claude_plan", "Saves Claude's whole plan to the month: projects, goals, steps and days.", obj({ job: { type: "string" }, confirmed: P.confirmed }, ["job"])),
  tool("undo_last_change", "Puts back the last change made through Grok. Say what was undone.", obj({})),
];

export const INSTRUCTIONS = "Ash's Bodysculpt dashboard. He talks to you, often out loud on his phone, so keep replies short and spoken. "
  + "He finds a blank planning page hard, so ask one question at a time and do the organising for him. "
  + "When he says let's review last month: use get_month_review, tell him briefly what you found, then ask about what moved, what didn't, what carries forward and what got in the way, one at a time. Read the finished review back, then use save_month_review. "
  + "When he says let's plan the month: use get_month_plan and any carry-forward from the review, ask one question at a time, then put the projects on the month with a goal for each, add the steps, and give each project a next step with a day. Save it project by project. "
  + "Month tools state today's date, so use that to work out which month he means. If he has not planned the current month yet, check whether that is the one he means by next month. "
  + "When a change tool says it is not done yet, read those words to him and wait for a clear yes before calling it again with confirmed true. "
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
      return "Today is " + today + ". This is " + ym + ". " + (on.length ? "On the month:\n" + on.join("\n") : "Nothing is on the month yet.") + (off.length ? "\nNot on the month: " + off.join(", ") : "");
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
    case "undo_last_change": {
      const stack = (await api.undoLoad()) || [];
      const last = stack.pop();
      if (!last) return "There's nothing to undo.";
      for (const op of last.ops) {
        if (op.k === "focus") await api.savePlan(op.ym, op.focus);
        else if (op.k === "review") await api.saveReview(op.ym, op.review);
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
        capabilities: { tools: {} }, serverInfo: { name: "bodysculpt-dashboard", version: "1.2.0" }, instructions: INSTRUCTIONS });
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS });
    case "tools/call": {
      const name = msg.params && msg.params.name;
      if (!TOOLS.some((t) => t.name === name)) return fail(-32602, "Unknown tool");
      try { return text(await callTool(name, msg.params.arguments, api, today)); }
      catch (e) { return text(e instanceof Say ? e.message : "That didn't work, and nothing was confirmed as saved. Check Monthly before trying again.", true); }
    }
    default: return fail(-32601, "Method not found");
  }
}
