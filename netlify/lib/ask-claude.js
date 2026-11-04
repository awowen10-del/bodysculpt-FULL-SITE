// netlify/lib/ask-claude.js  (v270)
//
// The shape of a planning job and of the plan Claude sends back. Kept apart from the function
// so it holds no storage and can be tested alone.
//
// A plan is only ever a PROPOSAL. It is stored here and shown on Monthly, and nothing reaches
// a project or a month until Ash presses the button. Claude has no route that writes either.
export const JOB_PREFIX = "job-";
export const MAX_TEXT = 8000;
export const MAX_PER_HOUR = 10;
export const JOB_MINUTES = 15;

const str = (v, n) => (typeof v === "string" ? v.slice(0, n).trim() : "");
const ymd = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
const ym = (v) => (typeof v === "string" && /^\d{4}-\d{2}$/.test(v) ? v : "");
const idOf = (v) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : "");

// Everything Claude sends is cut down to these fields, so a bad reply can never put anything
// else in front of the page. The page escapes all of it again when it draws.
export function cleanProposal(raw) {
  if (!raw || typeof raw !== "object") return null;
  const projects = (Array.isArray(raw.projects) ? raw.projects : []).map((p) => {
    if (!p || typeof p !== "object") return null;
    const name = str(p.name, 160);
    if (!name) return null;
    return {
      projectId: idOf(p.projectId), name, goal: str(p.goal, 400),
      steps: (Array.isArray(p.steps) ? p.steps : []).map((s) => {
        if (!s || typeof s !== "object") return null;
        const title = str(s.title, 240);
        return title ? { stepId: idOf(s.stepId), title, day: ymd(s.day) } : null;
      }).filter(Boolean).slice(0, 8),
    };
  }).filter(Boolean).slice(0, 5);
  if (!projects.length) return null;
  return {
    month: ym(raw.month), summary: str(raw.summary, 800), projects,
    leftOut: (Array.isArray(raw.leftOut) ? raw.leftOut : []).map((x) => str(x, 240)).filter(Boolean).slice(0, 8),
    question: str(raw.question, 400),
  };
}

export function fireText(job, today) {
  return ["JOB: " + job.id, "TOKEN: " + job.token, "MONTH: " + job.month, "TODAY: " + today,
    "ASH SAID:", job.text].join("\n");
}
