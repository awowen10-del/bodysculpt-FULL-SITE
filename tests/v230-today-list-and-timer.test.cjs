// v230 — the Daily page's jobs as a list on the page, a focus timer that follows you to
// every page, and Dial in with a choice of playlist.
//
// The timer is RUN here, not read: /focus-timer.js is booted in two separate "pages" that
// share one browser's localStorage, which is exactly what clicking from Daily to Projects is.
// Dial in is run against a fake window that records what it was asked to open.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const FT = read("focus-timer.js");
const DAILY = read("daily.html");
const DJS = DAILY.slice(DAILY.lastIndexOf("<script>") + 8, DAILY.lastIndexOf("</script>"));
const PAGES = ["index.html", "daily.html", "monthly.html", "quarterly.html", "projects.html",
  "finances.html", "ads.html", "social.html", "schedule.html"];
function bodyOf(js, name) {
  const re = new RegExp("\\n(?:async )?function " + name + "\\s*\\(", "g");
  const m = re.exec(js);
  assert.ok(m, "defines " + name + "()");
  let i = js.indexOf("{", m.index + m[0].length - 1), depth = 0, j = i;
  for (; j < js.length; j++) {
    if (js[j] === "{") depth++;
    else if (js[j] === "}") { depth--; if (!depth) break; }
  }
  return js.slice(i, j + 1);
}

/* ---------- a tiny browser: enough DOM for the timer, one shared localStorage ---------- */
function makeStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function el(tag, id) {
  const e = { tagName: tag.toUpperCase(), id: id || "", innerHTML: "", textContent: "", className: "", style: {}, dataset: {},
    children: [], parentNode: null, nextElementSibling: null, nextSibling: null,
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c, ref) {
      c.parentNode = this;
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    },
    click() { this.clicked = (this.clicked || 0) + 1; },
  };
  return e;
}
function bootPage(storage, opts) {
  opts = opts || {};
  const body = el("body"), head = el("head");
  const scrim = el("div", "snScrim"), header = el("header");
  scrim.nextElementSibling = header;
  body.appendChild(scrim); body.appendChild(header);
  const ids = { snScrim: scrim };
  const listeners = {};
  const winListeners = {};
  const timers = [];
  const opened = [];
  const doc = {
    title: opts.title || "Projects", readyState: "complete", head, body, documentElement: el("html"), hidden: false,
    getElementById(id) {
      if (ids[id]) return ids[id];
      // anything the bar drew is findable by id, as in a real page
      const host = ids.ftHost;
      if (host && host.innerHTML.includes('id="' + id + '"')) return (ids["__" + id] = ids["__" + id] || el("span", id));
      return null;
    },
    createElement(tag) {
      const e = el(tag);
      Object.defineProperty(e, "id", { get() { return this._id || ""; }, set(v) { this._id = v; ids[v] = this; } });
      return e;
    },
    querySelector(sel) { return sel === "body > header" ? header : null; },
    querySelectorAll() { return []; },
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener() {},
    dispatchEvent(ev) { (listeners[ev.type] || []).forEach((f) => f(ev)); },
  };
  const win = {
    addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); },
    removeEventListener(t, f) { const l = winListeners[t] || []; const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); },
    open(u) { opened.push(u); },
    location: { set href(v) { opened.push(v); }, get href() { return ""; } },
  };
  const ctx = {
    document: doc, window: win, localStorage: storage, console, Date, JSON, Math, Number, String,
    CustomEvent: class { constructor(type) { this.type = type; } },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    clearTimeout() {},
    setInterval: () => 1, clearInterval() {},
  };
  win.document = doc;
  vm.createContext(ctx);
  vm.runInContext(FT + "\n;globalThis.__ft = { get t(){ return ftTimer; } };", ctx);
  return { ctx, doc, header, body, timers, opened, winListeners, listeners, host: () => ids.ftHost };
}

(async () => {
  /* 1. every page loads the one shared timer, in its head, after its title */
  for (const f of PAGES) {
    const h = read(f);
    const head = h.slice(0, h.indexOf("</head>"));
    assert.strictEqual((h.match(/<script src="\/focus-timer\.js"><\/script>/g) || []).length, 1, f + " loads /focus-timer.js once");
    assert.ok(head.includes('<script src="/focus-timer.js"></script>'), f + " …in its head");
    assert.ok(head.indexOf("<title>") < head.indexOf("/focus-timer.js"), f + " …after its title, so the tab title can be restored");
    assert.ok(!/let ftTimer|function ftStart/.test(h), f + " keeps no timer of its own");
  }

  /* 2. it follows you: start on one page, the next page picks it up */
  {
    const storage = makeStorage();
    const daily = bootPage(storage, { title: "Daily" });
    assert.ok(!daily.host(), "an idle page draws no bar at all");
    daily.ctx.ftStart(25, { key: "plan:recurringDone:r1:wed", title: "Lead Generation" });
    const saved = JSON.parse(storage.getItem("ft.timer"));
    assert.strictEqual(saved.durationMin, 25, "the block is kept in this browser");
    assert.strictEqual(saved.jobKey, "plan:recurringDone:r1:wed", "…with the job it is for");
    assert.strictEqual(saved.jobTitle, "Lead Generation", "…and its title, so any page can say it");
    assert.ok(saved.endAt > Date.now() + 24 * 60000, "…and when it ends — a timestamp, not a counter");

    const projects = bootPage(storage, { title: "Projects" });
    const t = projects.ctx.__ft.t;
    assert.ok(t && t.durationMin === 25 && !t.finished, "the next page rehydrates the running block");
    const host = projects.host();
    assert.ok(host, "…and draws the bar");
    assert.strictEqual(host.parentNode, projects.body, "…in the page");
    assert.strictEqual(projects.body.children.indexOf(host), projects.body.children.indexOf(projects.header) + 1,
      "…straight under the app bar");
    assert.ok(/Lead Generation/.test(host.innerHTML), "the bar says what you are working on");
    assert.ok(/id="ftToggle">Pause</.test(host.innerHTML) && /id="ftStop">Stop</.test(host.innerHTML), "…with Pause and Stop");
    assert.ok(/^2[45]:\d\d · Projects$/.test(projects.doc.title), "…and the countdown in the tab title");

    projects.ctx.ftPause();
    assert.ok(JSON.parse(storage.getItem("ft.timer")).pausedRemaining > 0, "pausing is kept too");
    const third = bootPage(storage);
    assert.ok(/Resume/.test(third.host().innerHTML) && /paused/.test(third.host().innerHTML), "a paused block comes back paused");
    third.ctx.ftReset();
    assert.strictEqual(storage.getItem("ft.timer"), null, "Stop clears it from the browser");
    assert.ok(!bootPage(storage).host(), "…so the next page has no bar");
  }

  /* 3. it finished while you were away; Keep going; Dismiss clears it */
  {
    const storage = makeStorage({ "ft.timer": JSON.stringify({ durationMin: 45, endAt: Date.now() - 3 * 3600000,
      pausedRemaining: null, finished: false, jobKey: "k", jobTitle: "Write the email" }) });
    const p = bootPage(storage);
    assert.ok(p.ctx.__ft.t.finished, "a block that ran out with no page open is finished");
    assert.ok(/Time’s up\./.test(p.host().innerHTML) && /Write the email/.test(p.host().innerHTML), "the bar turns done and names the job");
    assert.ok(/id="ftKeep">Keep going</.test(p.host().innerHTML) && /id="ftDone">Dismiss</.test(p.host().innerHTML),
      "…offering Keep going and Dismiss");
    p.ctx.ftKeepGoing();
    const again = JSON.parse(storage.getItem("ft.timer"));
    assert.ok(!again.finished && again.durationMin === 45 && again.jobKey === "k", "Keep going starts the same length again, same job");
    p.ctx.ftReset();
    assert.strictEqual(storage.getItem("ft.timer"), null, "dismissing a finished block clears it");

    // junk in storage is no timer, and no crash
    for (const junk of ["{", "[]", JSON.stringify({ durationMin: -4 }), JSON.stringify({ durationMin: 25 })]) {
      const j = bootPage(makeStorage({ "ft.timer": junk }));
      assert.strictEqual(j.ctx.__ft.t, null, "junk " + junk + " is no timer");
    }
  }

  /* 4. Dial in: three playlists, the pick remembered, the app tried before the web, never two */
  {
    const storage = makeStorage();
    let p = bootPage(storage);
    const names = vm.runInContext("FT_PLAYLISTS.map(x => x.name)", p.ctx);
    assert.deepStrictEqual(Array.from(names), ["Deep focus (classical)", "Piano", "Lo-fi"], "three named playlists");
    assert.ok(/TO CHANGE ONE:/.test(FT), "…with a note above them saying how to swap one");
    assert.strictEqual(p.ctx.ftPlaylist().name, "Deep focus (classical)", "nothing picked: the first");
    p.ctx.ftSetPlaylist("Piano");
    assert.strictEqual(storage.getItem("ft.playlist"), "Piano", "the pick is remembered");
    p = bootPage(storage);
    assert.strictEqual(p.ctx.ftPlaylist().name, "Piano", "…on the next page too");
    p.ctx.ftSetPlaylist("Nonsense");
    assert.strictEqual(p.ctx.ftPlaylist().name, "Piano", "a name that is not one is ignored");

    // no app answers: play-now uri, then the plain uri, then the web player — one at a time
    const a = { href: "", clicked: 0, click() { this.clicked++; } };
    assert.strictEqual(p.ctx.ftDialIn(a), false, "the link itself is held back");
    assert.deepStrictEqual(p.opened.slice(), ["spotify:playlist:37i9dQZF1DX4sWSpwq3LiO:play"], "first: the desktop app, play now");
    p.timers.shift().f();
    assert.deepStrictEqual(p.opened.slice(), ["spotify:playlist:37i9dQZF1DX4sWSpwq3LiO:play", "spotify:playlist:37i9dQZF1DX4sWSpwq3LiO"],
      "then the plain uri, 1.2s later, only because nothing took focus");
    assert.strictEqual(a.clicked, 0, "…and still no web tab");
    p.timers.shift().f();
    assert.strictEqual(a.clicked, 1, "then the web player, once");
    assert.strictEqual(a.href, "https://open.spotify.com/playlist/37i9dQZF1DX4sWSpwq3LiO", "…of the picked playlist");

    // the app takes it: nothing else opens
    const q = bootPage(storage);
    const b = { href: "", clicked: 0, click() { this.clicked++; } };
    q.ctx.ftDialIn(b);
    (q.winListeners.blur || []).slice().forEach((f) => f());     // the app took focus
    q.timers.shift().f();
    assert.strictEqual(q.opened.length, 1, "the app took it — the plain uri is never tried");
    assert.strictEqual(b.clicked, 0, "…and no web tab opens");
  }

  /* 5. the Daily page's Today list, rendered */
  {
    const JOBS = [
      { key: "step:p1:sL", title: "Reply to the leads", source: "step", from: "Ads back on", late: 2, when: "2 days late", done: false },
      { key: "plan:recurringDone:lg:wed", title: "Lead Generation", source: "plan", when: "9–11.30", done: false },
      { key: "plan:bufferItems:b1", title: "Ring the accountant", source: "plan", when: "12–3", done: true },
      { key: "step:p1:sD", title: "Point the forms at GHL", source: "step", from: "Migrate to GHL", done: false },
      { key: "plan:bufferItems:b2", title: "Parked thing", source: "plan", when: "5–8", done: false },
    ];
    const els = {};
    const $ = (id) => (els[id] = els[id] || { innerHTML: "", textContent: "", dataset: {}, addEventListener() {} });
    const entry = { oneThing: "Ship the migration", oneThingDone: false, parked: ["plan:bufferItems:b2"] };
    const make = (timer) => new Function("$", "ckEntry", "ckToday", "richToText", "fmBuildQueue", "fmDetail", "esc",
      "ftTimer", "FT_PRESETS", "ftDialHtml", "agendaToday",
      "let tlOpen = {}, tlShowParked = false, tlFocusPick = '';\n" +
      "function tlWireOnce(){}\n" +
      ["tlJobs", "tlWhere", "tlDetailHtml", "tlRowHtml", "renderTodayList"].map((n) => {
        const args = { tlJobs: "", tlWhere: "j", tlDetailHtml: "j", tlRowHtml: "j, isParked", renderTodayList: "" }[n];
        return "function " + n + "(" + args + ")" + bodyOf(DJS, n);
      }).join("\n") +
      "\nconst tlFind = () => null;\nreturn { renderTodayList, setPick: (k) => { tlFocusPick = k; } };")(
      $, () => entry, () => "2026-10-21", (s) => s, () => JOBS.map((j) => Object.assign({}, j)), () => null,
      (s) => String(s), timer, [25, 45, 60, 90], (l) => '<a class="ft-dial">' + l + "</a>", () => ({}));

    let api = make(null);
    api.renderTodayList();
    const html = els.tlBody.innerHTML;
    const order = [...html.matchAll(/class="tl-t">([^<]*)</g)].map((m) => m[1]);
    assert.deepStrictEqual(order, ["Ship the migration", "Reply to the leads", "Lead Generation", "Point the forms at GHL", "Ring the accountant"],
      "One Thing first, then overdue, then the plan, then due today — and the done one sinks to the bottom");
    assert.strictEqual(els.tlSub.textContent, "1 of 5 done", "the header counts what is done");
    assert.ok(/tl-row late[\s\S]*?Ads back on · 2 days late/.test(html), "an overdue row is red and says how late");
    assert.ok(/Lead Generation<\/span><span class="tl-w">9–11\.30/.test(html), "a planned row says its block");
    assert.ok(/Point the forms at GHL<\/span><span class="tl-w">Migrate to GHL · due today/.test(html), "a dated step says its project");
    assert.ok(/tl-row done[\s\S]*?Ring the accountant/.test(html), "a done row is still there, greyed");
    assert.ok(/Parked \(1\)/.test(html) && !/Parked thing/.test(html), "parked jobs fold into one line, closed");

    // Focus on a row → the lengths; a running block on it → the marker and "and dial in"
    api.setPick("plan:recurringDone:lg:wed");
    api.renderTodayList();
    assert.ok(/data-tl="min" data-min="45"/.test(els.tlBody.innerHTML), "Focus on a row offers the preset lengths");
    api = make({ durationMin: 25, endAt: Date.now() + 60000, pausedRemaining: null, finished: false, jobKey: "plan:recurringDone:lg:wed" });
    api.renderTodayList();
    assert.ok(/tl-row running[\s\S]*?Lead Generation[\s\S]*?Running[\s\S]*?and dial in/.test(els.tlBody.innerHTML),
      "the row whose block is running is marked, and offers Dial in as a second button");
    api = make({ durationMin: 25, endAt: null, pausedRemaining: null, finished: true, jobKey: "plan:recurringDone:lg:wed" });
    api.renderTodayList();
    assert.ok(/Time’s up on this one\.[\s\S]*?data-tl="fin-done">Done ✓[\s\S]*?data-tl="keep">Keep going/.test(els.tlBody.innerHTML),
      "when its block runs out the row offers Done ✓ / Keep going");
  }

  /* 6. the one-at-a-time stage is gone; the morning and evening stay */
  {
    for (const gone of ["function fmDayHtml", "function fmSkipCurrent", "function fmParkCurrent", "function fmTimerHtml", "id=\"fmDone\""]) {
      assert.ok(!DJS.includes(gone), "gone: " + gone);
    }
    for (const kept of ["function fmMorningHtml", "function fmEveningHtml", 'id="fm_mind"', 'id="fm_note"']) {
      assert.ok(DJS.includes(kept), "kept: " + kept);
    }
  }

  console.log("v230-today-list-and-timer: all assertions passed");
})().catch((e) => { console.error(e); process.exit(1); });
