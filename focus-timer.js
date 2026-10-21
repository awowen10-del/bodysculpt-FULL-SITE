/* =====================================================================
   focus-timer.js — THE FOCUS TIMER, ON EVERY PAGE  (v230)

   Ash: "make the timer survive navigation" — a block started on the Daily page and then a
   click to Projects used to vanish with the page. So the timer is one small shared file,
   loaded by every page with one line, and it keeps its state in this browser
   (localStorage "ft.timer"). Every page rehydrates it on load and draws the same bar under
   its app bar: the clock, what you are working on, Pause and Stop.

   It is the v68/v152 engine, moved here intact, because it was right: time left is always
   DERIVED from timestamps — endAt while running, a frozen pausedRemaining while paused —
   never a decremented counter. That is exactly what makes it survive a page change: a new
   page reads endAt and the clock is simply correct. Another tab changing the timer is heard
   through the "storage" event, so two open pages never disagree for long.

   This file is the WHOLE timer. A page that wants to know when it changes listens for the
   "ft:change" event on document (the Daily page does, to redraw its Today list); nothing
   here knows what a job is beyond the key and title it was started with.

   It is a per-device convenience, not plan data: nothing here touches any store.
   ===================================================================== */
const FT_KEY = "ft.timer";          // { durationMin, endAt, pausedRemaining, finished, jobKey, jobTitle }
const FT_PLAYLIST_KEY = "ft.playlist";
const FT_PRESETS = [25, 45, 60, 90];
/* The focus playlists for Dial in, in the order the picker shows them.
   TO CHANGE ONE: open the playlist in Spotify → Share → Copy link to playlist. The link reads
   https://open.spotify.com/playlist/<ID>?si=… — the ID is the part between "playlist/" and
   "?". Put that ID in BOTH `uri` (spotify:playlist:<ID>) and `url`
   (https://open.spotify.com/playlist/<ID>). `name` is what the picker says; keep it short.
   A name you rename means the remembered pick falls back to the first one, once. */
const FT_PLAYLISTS = [
  { name: "Deep focus (classical)", uri: "spotify:playlist:37i9dQZF1DWWEJlAGA9gs0",   // Classical Essentials
    url: "https://open.spotify.com/playlist/37i9dQZF1DWWEJlAGA9gs0" },
  { name: "Piano", uri: "spotify:playlist:37i9dQZF1DX4sWSpwq3LiO",                    // Peaceful Piano
    url: "https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO" },
  { name: "Lo-fi", uri: "spotify:playlist:1VKtv1xJtFFkS3OsaFY3WZ",                    // the original one
    url: "https://open.spotify.com/playlist/1VKtv1xJtFFkS3OsaFY3WZ" },
];
const FT_TITLE = document.title;
const ft$ = (id) => document.getElementById(id);
const ftEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let ftTimer = null;      // null = idle
let ftTick = null;       // the one interval, alive only while running

/* ---------- this browser's copy ----------
   Anything that does not read as a timer is no timer: junk, a hand-edited value, storage that
   throws. A page must never fail to load because of what is in here. */
function ftClean(v) {
  if (!v || typeof v !== "object") return null;
  const d = Number(v.durationMin);
  if (!(d > 0 && d <= 600)) return null;
  const t = {
    durationMin: d,
    endAt: Number.isFinite(v.endAt) ? v.endAt : null,
    pausedRemaining: Number.isFinite(v.pausedRemaining) ? Math.max(0, v.pausedRemaining) : null,
    finished: v.finished === true,
    jobKey: typeof v.jobKey === "string" ? v.jobKey.slice(0, 200) : "",
    jobTitle: typeof v.jobTitle === "string" ? v.jobTitle.slice(0, 200) : "",
  };
  if (!t.finished && t.endAt == null && t.pausedRemaining == null) return null;
  return t;
}
function ftLoad() {
  try { return ftClean(JSON.parse(localStorage.getItem(FT_KEY) || "null")); } catch (e) { return null; }
}
function ftSave() {
  try {
    if (ftTimer) localStorage.setItem(FT_KEY, JSON.stringify(ftTimer));
    else localStorage.removeItem(FT_KEY);
  } catch (e) { /* no storage: the timer still runs on this page, it just will not follow you */ }
}

const ftRemaining = () => {
  if (!ftTimer || ftTimer.finished) return 0;
  if (ftTimer.pausedRemaining != null) return ftTimer.pausedRemaining;
  return Math.max(0, ftTimer.endAt - Date.now());
};
const ftFmt = (ms) => {
  const s = Math.ceil(ms / 1000);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};
// job: optional { key, title } — what the block is FOR, so the bar can say it on any page
function ftStart(min, job) {
  ftTimer = { durationMin: min, endAt: Date.now() + min * 60000, pausedRemaining: null, finished: false,
    jobKey: job && job.key ? String(job.key) : "", jobTitle: job && job.title ? String(job.title).slice(0, 200) : "" };
  ftSave(); ftEnsureTick(); ftRefresh();
}
function ftPause() {
  if (!ftTimer || ftTimer.finished || ftTimer.pausedRemaining != null) return;
  ftTimer.pausedRemaining = Math.max(0, ftTimer.endAt - Date.now());
  ftTimer.endAt = null;
  if (ftTick) { clearInterval(ftTick); ftTick = null; }
  ftSave(); ftRefresh();
}
function ftResume() {
  if (!ftTimer || ftTimer.finished || ftTimer.pausedRemaining == null) return;
  ftTimer.endAt = Date.now() + ftTimer.pausedRemaining;
  ftTimer.pausedRemaining = null;
  ftSave(); ftEnsureTick(); ftRefresh();
}
// Stop, and dismissing a finished block: gone from this page AND from the browser
function ftReset() {
  ftTimer = null;
  if (ftTick) { clearInterval(ftTick); ftTick = null; }
  ftSave(); ftRefresh();
}
// "Keep going": the same length again, on the same job
function ftKeepGoing() {
  if (!ftTimer) return;
  ftStart(ftTimer.durationMin, { key: ftTimer.jobKey, title: ftTimer.jobTitle });
}
function ftEnsureTick() { if (!ftTick) ftTick = setInterval(ftOnTick, 500); }

// A tick patches the clock, the drain bar and the tab title — never a re-render, so nothing
// you are typing is disturbed by a block running in the background.
function ftOnTick() {
  if (!ftTimer || ftTimer.finished || ftTimer.pausedRemaining != null) {
    if (ftTick) { clearInterval(ftTick); ftTick = null; }
    return;
  }
  if (ftTimer.endAt - Date.now() <= 0) {
    // another open page may already have called it — then it has chimed, and this one need not
    const stored = ftLoad();
    const already = !!(stored && stored.finished && stored.durationMin === ftTimer.durationMin);
    ftTimer.finished = true;
    if (ftTick) { clearInterval(ftTick); ftTick = null; }
    ftSave();
    if (!already) ftChime();
    ftRefresh();
    return;
  }
  const left = ftRemaining();
  const clock = ft$("ftClock");
  if (clock) clock.textContent = ftFmt(left);
  const fill = ft$("ftFill");
  if (fill) fill.style.width = ftPct() + "%";
  const bar = ft$("ftBar");
  if (bar) bar.className = "ftbar " + ftTone();
  document.title = ftFmt(left) + " · " + FT_TITLE;
  document.dispatchEvent(new CustomEvent("ft:tick"));
}
const ftPct = () => {
  if (!ftTimer || !ftTimer.durationMin) return 0;
  return Math.max(0, Math.min(100, (ftRemaining() / (ftTimer.durationMin * 60000)) * 100));
};
// The last five minutes of a block are the ones that need saying.
function ftTone() {
  if (!ftTimer) return "";
  if (ftTimer.finished) return "done";
  if (ftTimer.pausedRemaining != null) return "paused";
  const m = ftRemaining() / 60000;
  return m <= 1 ? "last" : m <= 5 ? "soon" : "run";
}
// A short tone rather than a file: nothing to load, nothing to 404, and it works offline.
function ftChime() {
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = new C();
    [880, 1174].forEach((hz, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = hz; o.type = "sine";
      o.connect(g); g.connect(ctx.destination);
      const t0 = ctx.currentTime + i * 0.22;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.start(t0); o.stop(t0 + 0.55);
    });
    setTimeout(() => { try { ctx.close(); } catch (e) {} }, 1500);
  } catch (e) { /* a browser that will not make a noise is not a broken timer */ }
}

/* ---------- the bar ----------
   It exists in the DOM only while there is a block on, so an idle page is exactly as it
   was. A page with its own #ftHost (the Daily page) says where it goes; any other page gets
   one straight under its app bar — the <header> after the nav scrim, the same on every page. */
function ftHostEl() {
  let host = ft$("ftHost");
  if (host) return host;
  if (!document.body) return null;
  host = document.createElement("div");
  host.id = "ftHost";
  const scrim = ft$("snScrim");
  const header = scrim && scrim.nextElementSibling && scrim.nextElementSibling.tagName === "HEADER"
    ? scrim.nextElementSibling : document.querySelector("body > header");
  if (header && header.parentNode) header.parentNode.insertBefore(host, header.nextSibling);
  else document.body.insertBefore(host, document.body.firstChild);
  return host;
}
function renderTimerBar() {
  const host = ftTimer ? ftHostEl() : ft$("ftHost");
  if (!host) return;
  if (!ftTimer) {
    host.innerHTML = "";
    document.title = FT_TITLE;
    return;
  }
  const what = ftTimer.jobTitle ? "<b>" + ftEsc(ftTimer.jobTitle) + "</b>" : "";
  if (ftTimer.finished) {
    host.innerHTML = '<div class="ftbar done" id="ftBar">' +
      '<svg class="ic"><use href="#ic-check"/></svg>' +
      '<span class="ft-clock" id="ftClock">0:00</span>' +
      '<span class="ft-msg"><b>Time’s up.</b> ' + (what ? what + " — a " : "That was a ") +
        ftTimer.durationMin + " minute block.</span>" +
      '<button type="button" class="ft-btn" id="ftKeep">Keep going</button>' +
      '<button type="button" class="ft-btn ghost" id="ftDone">Dismiss</button></div>';
    document.title = "✓ " + FT_TITLE;
    return;
  }
  const paused = ftTimer.pausedRemaining != null;
  host.innerHTML = '<div class="ftbar ' + ftTone() + '" id="ftBar">' +
    '<span class="ft-fill" id="ftFill" style="width:' + ftPct() + '%"></span>' +
    '<span class="ft-clock" id="ftClock">' + ftFmt(ftRemaining()) + "</span>" +
    '<span class="ft-msg">' + (what || "<b>" + ftTimer.durationMin + "-minute focus block</b>") +
      (paused ? " · paused" : '<span class="ft-say">' +
        (what ? ftTimer.durationMin + " minutes. " : "") + "Heads down. Nothing else until this runs out.</span>") + "</span>" +
    '<button type="button" class="ft-btn" id="ftToggle">' + (paused ? "Resume" : "Pause") + "</button>" +
    '<button type="button" class="ft-btn ghost" id="ftStop">Stop</button></div>';
  document.title = ftFmt(ftRemaining()) + " · " + FT_TITLE;
}
// redraw the bar, and tell the page (the Daily page redraws its Today list and card on this)
function ftRefresh() {
  renderTimerBar();
  try { document.dispatchEvent(new CustomEvent("ft:change")); } catch (e) {}
}

document.addEventListener("click", (e) => {
  const t = e.target && e.target.closest ? e.target.closest("[id^=ft]") : null;
  if (!t) return;
  if (t.id === "ftToggle") { ftTimer && ftTimer.pausedRemaining != null ? ftResume() : ftPause(); }
  else if (t.id === "ftStop" || t.id === "ftDone") ftReset();
  else if (t.id === "ftKeep") ftKeepGoing();
  else if (t.id && t.id.indexOf("ftGo") === 0) ftStart(Number(t.dataset.min));
});

/* ---------- Dial in ----------
   v230: three playlists instead of one, and the last one picked is remembered so Dial in is
   one click next time. The desktop app is tried first with Spotify's "play now" form
   ("<uri>:play"), then the plain uri, then the web player — each only if the one before did
   not take focus within 1.2s (the page blurring or hiding means the app took it). Normal
   cases open exactly one thing; it never opens two. */
function ftPlaylist() {
  let n = "";
  try { n = localStorage.getItem(FT_PLAYLIST_KEY) || ""; } catch (e) {}
  return FT_PLAYLISTS.find((p) => p.name === n) || FT_PLAYLISTS[0];
}
function ftSetPlaylist(name) {
  if (!FT_PLAYLISTS.some((p) => p.name === name)) return;
  try { localStorage.setItem(FT_PLAYLIST_KEY, name); } catch (e) {}
  const url = ftPlaylist().url;
  document.querySelectorAll("a.ft-dial").forEach((a) => { a.href = url; });
}
// the picker, for a page to put next to its focus controls
function ftPickerHtml() {
  const cur = ftPlaylist().name;
  return '<select class="ft-pick" aria-label="Focus playlist" title="Which playlist Dial in plays" ' +
    'onchange="ftSetPlaylist(this.value)">' +
    FT_PLAYLISTS.map((p) => '<option value="' + ftEsc(p.name) + '"' + (p.name === cur ? " selected" : "") + ">" +
      ftEsc(p.name) + "</option>").join("") + "</select>";
}
// the link itself; label defaults to "Dial in"
function ftDialHtml(label, cls) {
  return '<a class="ft-dial' + (cls ? " " + cls : "") + '" href="' + ftEsc(ftPlaylist().url) +
    '" target="_blank" rel="noopener noreferrer" title="Play the focus playlist in Spotify" ' +
    'onclick="return ftDialIn(this)"><svg class="ic"><use href="#ic-headphones"/></svg>' +
    ftEsc(label || "Dial in") + "</a>";
}
let ftDialFallback = false;
function ftDialIn(a) {
  if (ftDialFallback) { ftDialFallback = false; return true; }   // the fallback re-click: follow the link
  const pl = ftPlaylist();
  if (a) a.href = pl.url;
  const tries = [pl.uri + ":play", pl.uri];
  let taken = false;
  const noteTaken = () => { taken = true; };
  window.addEventListener("blur", noteTaken);
  document.addEventListener("visibilitychange", noteTaken);
  const done = () => {
    window.removeEventListener("blur", noteTaken);
    document.removeEventListener("visibilitychange", noteTaken);
  };
  const attempt = (i) => {
    if (i >= tries.length) {                     // no app answered: the web player, once
      done();
      ftDialFallback = true;
      if (a) a.click(); else window.open(pl.url, "_blank", "noopener");
      return;
    }
    try { window.location.href = tries[i]; } catch (e) { /* no handler for the scheme */ }
    setTimeout(() => {
      if (taken || document.hidden) { done(); return; }   // the desktop app took it; open nothing else
      attempt(i + 1);
    }, 1200);
  };
  attempt(0);
  return false;                                  // never both
}

/* ---------- its look ----------
   Carried with the timer so every page draws the same bar from the same tokens (every page
   has the one v121 palette). Moved here from daily.html, unchanged apart from the picker. */
(function ftStyle() {
  const css =
    /* --- THE FOCUS BAR ---
       "it needs to be like 'wow, this is time sensitive, focus'." So when a block is running
       it is not a widget in a card — it pins itself under the app bar, across the whole page,
       with the clock at 46px and the block visibly draining underneath it. Under five minutes
       it goes amber and the clock breathes; under one, red. */
    ".ftbar{position:sticky;top:0;z-index:55;display:flex;align-items:center;" +
      "gap:var(--sp-4);padding:14px 20px;margin:var(--sp-3) 0 0;border-radius:var(--r-lg);" +
      "overflow:hidden;box-shadow:var(--shadow-lift);background:var(--ink-strong);color:var(--card);}" +
    /* Lift the real children above the drain, and NOT the drain itself. */
    ".ftbar > *{position:relative;}" +
    ".ftbar .ft-fill{position:absolute;left:0;top:0;bottom:0;" +
      "background:rgba(var(--orange-rgb),.34);transition:width 1s linear;pointer-events:none;}" +
    ".ft-clock{font-size:46px;font-weight:800;letter-spacing:-.045em;line-height:1;" +
      "font-variant-numeric:tabular-nums;flex:0 0 auto;}" +
    ".ft-msg{font-size:14px;line-height:1.4;flex:1;min-width:0;opacity:.92;}" +
    ".ft-msg b{font-weight:700;}" +
    ".ft-say{display:block;font-size:12.5px;opacity:.75;margin-top:2px;}" +
    ".ft-btn{font-family:inherit;font-size:13px;font-weight:700;color:var(--ink-strong);" +
      "background:var(--card);border:0;border-radius:var(--r-md);padding:9px 18px;cursor:pointer;flex:0 0 auto;}" +
    ".ft-btn.ghost{background:transparent;color:var(--card);box-shadow:inset 0 0 0 1px rgba(var(--line-rgb),.45);}" +
    ".ft-btn:focus-visible{outline:none;box-shadow:var(--focus);}" +
    ".ftbar .ic{width:26px;height:26px;flex:0 0 auto;}" +
    ".ftbar.soon .ft-fill{background:rgba(var(--amber-rgb),.42);}" +
    ".ftbar.soon .ft-clock{color:var(--amber-2);animation:ftbreathe 2s ease-in-out infinite;}" +
    ".ftbar.last .ft-fill{background:rgba(var(--red-rgb),.45);}" +
    ".ftbar.last .ft-clock{color:var(--red-2);animation:ftbreathe 1s ease-in-out infinite;}" +
    ".ftbar.paused{background:var(--ink-dim);}" +
    ".ftbar.paused .ft-fill{background:rgba(var(--line-rgb),.3);}" +
    ".ftbar.done{background:var(--green-2);}" +
    "@keyframes ftbreathe{0%,100%{opacity:1;}50%{opacity:.55;}}" +
    /* somebody who has asked for less movement gets a colour change and no pulse */
    "@media(prefers-reduced-motion:reduce){.ftbar.soon .ft-clock,.ftbar.last .ft-clock{animation:none;}.ft-fill{transition:none;}}" +
    "@media(max-width:900px){.ftbar{top:58px;}}" +     /* under the pinned narrow-screen bar */
    "@media(max-width:700px){.ftbar{flex-wrap:wrap;gap:var(--sp-3);padding:12px 14px;}" +
      ".ft-clock{font-size:34px;}.ft-msg{flex:1 1 100%;order:3;}}" +
    /* Dial in, and the playlist it plays */
    ".ft-dial{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;" +
      "color:var(--teal-bright);text-decoration:none;padding:4px 10px 4px 8px;" +
      "border-radius:var(--r-pill);background:rgba(var(--teal-rgb),.10);transition:background var(--tap);}" +
    ".ft-dial:hover{background:rgba(var(--teal-rgb),.2);}" +
    ".ft-dial .ic{width:13px;height:13px;}" +
    ".ft-pick{font-family:inherit;font-size:12px;font-weight:600;color:var(--ink-dim);background:var(--card);" +
      "border:1px solid var(--line);border-radius:var(--r-pill);padding:4px 8px;max-width:170px;cursor:pointer;}" +
    ".ft-pick:focus-visible{outline:none;box-shadow:var(--focus);}";
  const el = document.createElement("style");
  el.id = "ftStyle";
  el.textContent = css;
  (document.head || document.documentElement).appendChild(el);
})();

/* ---------- on every page, at load ----------
   Rehydrate from this browser. A block that ran out while no page was open is finished; it
   only chimes if it ran out in the last minute (a click between pages), not hours ago. */
function ftBoot() {
  ftTimer = ftLoad();
  if (ftTimer && !ftTimer.finished && ftTimer.pausedRemaining == null && ftTimer.endAt - Date.now() <= 0) {
    const late = Date.now() - ftTimer.endAt;
    ftTimer.finished = true;
    ftSave();
    if (late < 60000) ftChime();
  }
  if (ftTimer && !ftTimer.finished && ftTimer.pausedRemaining == null) ftEnsureTick();
  ftRefresh();
}
// another tab started, paused, stopped or finished it
window.addEventListener("storage", (e) => {
  if (e.key !== FT_KEY && e.key !== null) return;
  ftTimer = ftLoad();
  if (ftTick) { clearInterval(ftTick); ftTick = null; }
  if (ftTimer && !ftTimer.finished && ftTimer.pausedRemaining == null) ftEnsureTick();
  ftRefresh();
});
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ftBoot);
else ftBoot();
