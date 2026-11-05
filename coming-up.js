/* =====================================================================
   coming-up.js — WHAT NEEDS YOU NEXT, ON EVERY PLANNING PAGE  (v278)

   Ash: "I also need to be notified when things are due, in as many places as possible."
   One small shared file, loaded by one line per page like focus-timer.js. It reads the Content
   Calendar's plan and the projects, and draws one strip under the page header. How far it looks
   depends on the page: the bigger the planning horizon, the further ahead.

   READ ONLY. It sends two GETs and nothing else, so a page that promises not to write still
   doesn't. If either read fails the strip is smaller or absent; a page never breaks over it.
   Hiding it lasts until tomorrow and lives in this browser only.
   ===================================================================== */
const CU_PAGES = {
  "/daily.html":     { days: 7,   label: "Coming up this week", tasks: true, skipToday: true },
  "/index.html":     { days: 14,  label: "Coming up in the next two weeks", tasks: true },
  "/monthly.html":   { days: 62,  label: "Coming up. Build these into your month", tasks: true, gaps: true },
  "/quarterly.html": { days: 100, label: "Coming up this quarter", tasks: true, gaps: true },
  "/projects.html":  { days: 14,  label: "Coming up in the next two weeks", tasks: false },
  "/social.html":    { days: 45,  label: "Coming up. Plan your content around these", tasks: false },
  "/ads.html":       { days: 45,  label: "Coming up. Plan your ads around these", tasks: false },
  "/schedule.html":  { days: 45,  label: "Coming up. Plan your content around these", tasks: false },
};
const CU_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const CU_MAX = 6;
const cuDays = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
const cuAdd = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const cuPretty = (d) => Number(d.slice(8, 10)) + " " + CU_MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3);
const cuEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
function cuWhen(n) {
  if (n < 0) return -n + (n === -1 ? " day late" : " days late");
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  return n + " days";
}

/* Everything worth a nudge, soonest first. A pure function, so the test can drive it directly. */
function cuCollect(plan, projects, today, cfg) {
  const out = [], last = cuAdd(today, cfg.days), CAL = "/content-calendar.html", PROJ = "/projects.html#deadlines";
  const items = ((plan && plan.items) || []).filter((i) => i && !i.del);
  items.filter((i) => i.fixed).forEach((it) => {
    (it.yearly ? [0, 1, 2] : [0]).forEach((y) => {
      const start = (Number(it.start.slice(0, 4)) + y) + it.start.slice(4);
      const end = (Number(it.end.slice(0, 4)) + y) + it.end.slice(4);
      const prep = cuAdd(start, -7 * (it.prepWeeks || 0));
      if (start <= today && end >= today) out.push({ n: 0, title: it.title, tone: "live", href: CAL, when: "Live now", moment: true });
      else if (start > today && start <= last) out.push({ n: cuDays(today, start), title: it.title, tone: "big", href: CAL, moment: true });
      else if (prep > today && prep <= last) out.push({ n: cuDays(today, prep), title: "Start preparing " + it.title, tone: "", href: CAL, moment: true });
    });
  });
  (projects || []).filter((p) => p && !p.archived && p.status !== "done").forEach((p) => {
    const steps = (p.steps || []).filter((s) => s && !s.del && !s.done && s.due && s.due <= last);
    if (p.targetDate && p.targetDate <= last) {
      const n = cuDays(today, p.targetDate);
      out.push({ n, title: p.name + " deadline", tone: n < 0 ? "late" : "big", href: PROJ });
    }
    if (!cfg.tasks) return;
    const late = steps.filter((s) => s.due < today);
    const soon = steps.filter((s) => s.due >= today && !(cfg.skipToday && s.due === today)).sort((a, b) => (a.due < b.due ? -1 : 1));
    if (late.length) out.push({ n: cuDays(today, late.map((s) => s.due).sort()[0]), tone: "late", href: PROJ,
      title: late.length === 1 ? late[0].title + " (" + p.name + ")" : p.name + ": " + late.length + " tasks overdue" });
    if (soon.length) out.push({ n: cuDays(today, soon[0].due), tone: "", href: PROJ,
      title: soon.length === 1 ? soon[0].title + " (" + p.name + ")" : p.name + ": " + soon.length + " tasks due, next " + cuPretty(soon[0].due) });
  });
  if (cfg.gaps) {
    const m = Number(today.slice(5, 7)) - 1 + 2, y = Number(today.slice(0, 4)) + Math.floor(m / 12), mm = m % 12;
    const ym = y + "-" + String(mm + 1).padStart(2, "0");
    const hit = items.some((i) => cuDays(i.start, i.end) < 90 && (i.start.slice(0, 7) === ym || i.end.slice(0, 7) === ym || (i.yearly && (i.start.slice(5, 7) === ym.slice(5) || i.end.slice(5, 7) === ym.slice(5)))));
    if (!hit) out.push({ n: 9999, title: "No campaign planned for " + CU_MONTHS[mm] + " yet", tone: "gap", href: CAL, when: "Decide" });
  }
  // Calendar moments lead, whatever else is going on: an old overdue job must never bury Black Friday.
  return out.sort((a, b) => (b.moment ? 1 : 0) - (a.moment ? 1 : 0) || a.n - b.n);
}

function cuStyle() {
  const st = document.createElement("style");
  st.textContent =
    ".cu{max-width:1500px;box-sizing:border-box;margin:12px auto 0;padding:0 16px;}" +
    ".cu-in{background:var(--card);border-radius:14px;box-shadow:var(--shadow);padding:10px 8px 10px 14px;display:flex;align-items:center;gap:12px;}" +
    ".cu-h{flex:0 0 auto;max-width:170px;font-size:12.5px;line-height:1.25;font-weight:800;color:var(--orange);}" +
    ".cu-list{flex:1 1 auto;min-width:0;display:flex;flex-wrap:wrap;gap:6px;}" +
    ".cu-i{display:inline-flex;align-items:center;gap:7px;max-width:100%;box-sizing:border-box;min-height:32px;padding:4px 10px;border-radius:9px;background:var(--navy);color:var(--ink);text-decoration:none;font-size:13px;font-weight:600;}" +
    ".cu-i:hover{color:var(--ink-strong);background:var(--navy-2);}" +
    ".cu-w{flex:0 0 auto;font-size:11.5px;font-weight:800;color:var(--ink-dim);}" +
    ".cu-t{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
    ".cu-i.big{background:rgba(var(--orange-rgb),.1);color:var(--orange);} .cu-i.big .cu-w{color:var(--orange);}" +
    ".cu-i.live{background:var(--orange);color:var(--card);} .cu-i.live .cu-w{color:var(--card);}" +
    ".cu-i.late{background:rgba(var(--red-rgb),.09);color:var(--red);} .cu-i.late .cu-w{color:var(--red);}" +
    ".cu-i.gap{background:rgba(var(--amber-rgb),.1);color:var(--amber);} .cu-i.gap .cu-w{color:var(--amber);}" +
    ".cu-more,.cu-x{font:inherit;background:none;border:0;cursor:pointer;color:var(--ink-dim);}" +
    ".cu-more{min-height:32px;padding:0 6px;font-size:12.5px;font-weight:700;text-decoration:underline;text-underline-offset:2px;}" +
    ".cu-x{flex:0 0 auto;align-self:flex-start;width:32px;height:32px;border-radius:8px;display:grid;place-items:center;}" +
    ".cu-x:hover{background:var(--navy);} .cu-x svg{width:14px;height:14px;}" +
    "@media(max-width:900px){.cu{padding:0 12px;}.cu-in{flex-wrap:wrap;}.cu-h{max-width:none;flex:1 1 60%;}.cu-list{order:3;flex:1 1 100%;}.cu-i,.cu-more{min-height:44px;}.cu-x{width:44px;height:44px;}}";
  document.head.appendChild(st);
}

function cuDraw(host, list, cfg, open) {
  const shown = open ? list : list.slice(0, CU_MAX), more = list.length - shown.length;
  host.innerHTML = '<div class="cu-in"><div class="cu-h">' + cuEsc(cfg.label) + '</div><div class="cu-list">' +
    shown.map((x) => '<a class="cu-i ' + x.tone + '" href="' + x.href + '"><span class="cu-w">' + cuEsc(x.when || cuWhen(x.n)) + '</span><span class="cu-t">' + cuEsc(x.title) + "</span></a>").join("") +
    (more > 0 ? '<button type="button" class="cu-more" id="cuMore">+' + more + " more</button>" : "") +
    '</div><button type="button" class="cu-x" id="cuHide" aria-label="Hide until tomorrow" title="Hide until tomorrow"><svg class="ic"><use href="#ic-close"/></svg></button></div>';
  const m = document.getElementById("cuMore");
  if (m) m.addEventListener("click", () => cuDraw(host, list, cfg, true));
}

async function cuStart() {
  const path = location.pathname === "/" ? "/index.html" : location.pathname.replace(/(\.html)?$/, ".html");
  const cfg = CU_PAGES[path];
  if (!cfg) return;
  const today = new Date().toISOString().slice(0, 10), hideKey = "cu.hide" + path;
  try { if (localStorage.getItem(hideKey) === today) return; } catch (e) { /* a private window just shows it */ }
  const read = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [p, j] = await Promise.all([read("/.netlify/functions/marketing-calendar?plan=1"), read("/.netlify/functions/projects?list=1")]);
  const list = cuCollect(p && p.plan, j && j.projects, today, cfg);
  if (!list.length) return;
  cuStyle();
  const host = document.createElement("section");
  host.className = "cu"; host.id = "cuStrip"; host.setAttribute("aria-label", cfg.label);
  const header = document.querySelector("body > header");
  const ft = document.getElementById("ftHost");
  const after = ft || header;
  if (after && after.parentNode) after.parentNode.insertBefore(host, after.nextSibling);
  else document.body.insertBefore(host, document.body.firstChild);
  cuDraw(host, list, cfg, false);
  host.addEventListener("click", (e) => {
    if (!e.target.closest("#cuHide")) return;
    try { localStorage.setItem(hideKey, today); } catch (err) { /* it still goes for this visit */ }
    host.remove();
  });
}

if (typeof document !== "undefined" && document.addEventListener) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", cuStart);
  else cuStart();
}
