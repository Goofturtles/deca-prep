/* DECA Prep client: home + team streaks, mock exam, practice, key terms, results, import. */
(() => {
  'use strict';
  const app = document.getElementById('app');
  const P = window.DecaParse;
  const AREA_ORDER = Object.keys(P.AREAS);
  const IDLE_MS = 120000; // 2 minutes with no input counts as idle and stops the timer
  const L = 'ABCD';

  // ---------- helpers
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } }
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pad = (n) => String(n).padStart(2, '0');
  const fmtClock = (ms) => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + ':' + pad(m) : m) + ':' + pad(s % 60); };
  const fmtDur = (sec) => { if (!sec) return '0 min'; if (sec < 60) return '<1 min'; const m = Math.round(sec / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm'; };
  const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };
  const addDays = (k, n) => { const d = new Date(k + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const areaName = (k) => P.AREAS[k] || k;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const route = () => location.hash.replace(/^#\/?/, '').split('/');

  const ICONS = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    down: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    l: '<path d="m15 18-6-6 6-6"/>',
    r: '<path d="m9 18 6-6-6-6"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'
  };
  const ic = (n, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
  const LOGO = '<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" class="logo-bg"/><path d="M8.5 19.5l4.5-4.5 3.5 3.5 7-7" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ---------- state + server
  const S = { bank: null, state: null, me: LS.get('dp.me', null), run: LS.get('dp.run', null) };
  const saveRun = () => LS.set('dp.run', S.run);

  async function api(url, body) {
    const r = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401) { location.replace('/login'); throw new Error('locked'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Something went wrong');
    return d;
  }
  const loadState = async () => (S.state = await api('/api/state?me=' + encodeURIComponent(S.me || '')));

  function indexBank(b) {
    b.byId = new Map(b.questions.map((q) => [q.id, q]));
    b.areas = {};
    for (const q of b.questions) (b.areas[q.ar] = b.areas[q.ar] || []).push(q);
    return b;
  }

  // Every finished test is also kept on this device and re-sent if the server ever lost it.
  const localAtts = (m) => LS.get('dp.att.' + m, []);
  function saveLocal(a) { LS.set('dp.att.' + a.m, localAtts(a.m).filter((x) => x.id !== a.id).concat(a).slice(-300)); }
  function findLocal(id) {
    for (const m of S.state.team) { const a = localAtts(m).find((x) => x.id === id); if (a) return a; }
    return null;
  }
  async function resync() {
    try {
      const all = S.state.team.flatMap(localAtts);
      if (!all.length) return;
      const { missing } = await api('/api/sync', { ids: all.map((a) => a.id) });
      if (!missing.length) return;
      await api('/api/sync', { attempts: all.filter((a) => missing.includes(a.id)) });
      await loadState();
      if (route()[0] === '') render();
    } catch { /* retried next visit */ }
  }

  // ---------- active-time timer: runs only while the tab is visible, focused, and in use
  const Timer = {
    on: false, was: false, last: 0, n: 0, iv: 0, lastInput: Date.now(), awayAt: 0,
    active() { return document.visibilityState === 'visible' && document.hasFocus() && Date.now() - this.lastInput < IDLE_MS; },
    start() {
      if (this.on) return;
      this.on = true; this.last = performance.now(); this.lastInput = Date.now(); this.was = this.active();
      this.iv = setInterval(() => this.tick(), 1000);
    },
    stop() { if (!this.on) return; this.tick(); this.on = false; clearInterval(this.iv); },
    tick() {
      const now = performance.now(), dt = Math.min(now - this.last, 5000);
      this.last = now;
      if (!this.on || !S.run) return;
      if (this.was) S.run.act += dt; // only the interval that was active is counted
      this.was = this.active();
      paintTimer();
      if (++this.n % 5 === 0) saveRun();
      if (this.n % 240 === 0 && this.was) api('/api/ping').catch(() => {}); // keeps the free server awake mid-test
    },
    input() {
      const idle = Date.now() - this.lastInput >= IDLE_MS;
      if (idle) this.tick();
      this.lastInput = Date.now();
      if (idle) this.tick();
    }
  };
  function paintTimer() {
    const v = document.getElementById('timer-v');
    if (!v || !S.run) return;
    v.textContent = fmtClock(S.run.act);
    document.getElementById('timer').classList.toggle('paused', !Timer.was);
    const idle = document.visibilityState === 'visible' && Date.now() - Timer.lastInput >= IDLE_MS;
    document.getElementById('idle').classList.toggle('show', idle);
  }
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach((t) => addEventListener(t, () => Timer.input(), { passive: true, capture: true }));
  let moved = 0;
  addEventListener('pointermove', () => { const n = Date.now(); if (n - moved > 1000) { moved = n; Timer.input(); } }, { passive: true });
  function awayCheck() {
    Timer.tick();
    const away = document.visibilityState !== 'visible' || !document.hasFocus();
    if (away) { if (!Timer.awayAt) Timer.awayAt = Date.now(); return; }
    const gone = Timer.awayAt ? Math.round((Date.now() - Timer.awayAt) / 1000) : 0;
    Timer.awayAt = 0;
    if (Timer.on && gone >= 5) toast(`Welcome back. The timer was paused while you were away (${fmtDur(gone)} not counted).`);
  }
  document.addEventListener('visibilitychange', awayCheck);
  addEventListener('focus', awayCheck);
  addEventListener('blur', awayCheck);
  addEventListener('pagehide', () => { Timer.tick(); saveRun(); });

  // ---------- question picking
  const seen = (id) => (S.state.hist && S.state.hist[id] ? S.state.hist[id][0] : 0);
  const freshFirst = (list) => shuffle(list.slice()).sort((a, b) => seen(a.id) - seen(b.id));
  function pickMixed(n) {
    // Same topic mix as the bank (which mirrors the real exams), unseen questions first.
    const total = S.bank.questions.length;
    const parts = Object.entries(S.bank.areas).map(([k, list]) => ({ k, list, exact: (list.length / total) * n }));
    parts.forEach((p) => { p.take = Math.floor(p.exact); });
    let left = n - parts.reduce((s, p) => s + p.take, 0);
    for (const p of parts.slice().sort((a, b) => (b.exact - b.take) - (a.exact - a.take))) {
      if (left <= 0) break;
      if (p.take < p.list.length) { p.take++; left--; }
    }
    return parts.sort((a, b) => AREA_ORDER.indexOf(a.k) - AREA_ORDER.indexOf(b.k)).flatMap((p) => freshFirst(p.list).slice(0, p.take)).map((q) => q.id);
  }
  function pickExam(ex) {
    const num = (q) => (q.src.find((s) => s[0] === ex) || [0, 0])[1];
    return S.bank.questions.filter((q) => q.src.some((s) => s[0] === ex)).sort((a, b) => num(a) - num(b)).map((q) => q.id);
  }

  // ---------- explanations: a short "in short" line plus why the picked option is wrong
  const STOP = new Set('the a an and or of to in on for with by is are was were be been it its this that these their his her he she they them as at from into than then so not no do does can may will would should which who what when how all any'.split(' '));
  const keyWords = (s) => (String(s).toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter((w) => !STOP.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, ''));
  function explain(q, chosen) {
    const ss = P.sentences(q.x);
    const short = [];
    for (const s of ss) { short.push(s); if (short.join(' ').length > 110) break; }
    let whyNot = '';
    if (chosen >= 0 && chosen !== q.a) {
      const words = [...new Set(keyWords(q.o[chosen]))];
      let best = 0;
      for (const s of ss.slice(short.length)) {
        const have = new Set(keyWords(s));
        const score = words.length ? words.filter((w) => have.has(w)).length / words.length : 0;
        if (score > best) { best = score; whyNot = s; }
      }
      if (best < 0.5) whyNot = '';
    }
    return { short: short.join(' '), whyNot };
  }

  // ---------- shared UI
  let toastT;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 5000);
  }
  function modalEl(inner) {
    const el = document.createElement('div');
    el.className = 'modal';
    el.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">${inner}</div>`;
    document.body.appendChild(el);
    return el;
  }
  function confirmBox(title, body, ok, cancel) {
    return new Promise((resolve) => {
      const el = modalEl(`<h2>${esc(title)}</h2><p class="muted">${esc(body)}</p><div class="modal-actions"><button class="btn ghost" data-v="0">${esc(cancel)}</button><button class="btn primary" data-v="1">${esc(ok)}</button></div>`);
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]');
        if (b || e.target === el) { el.remove(); resolve(!!b && b.dataset.v === '1'); }
      });
      el.querySelector('[data-v="1"]').focus();
    });
  }
  const avatar = (name, size) => `<span class="av c${Math.max(0, S.state.team.indexOf(name)) % 4}${size ? ' ' + size : ''}" aria-hidden="true">${esc(name.slice(0, 1).toUpperCase())}</span>`;
  function pickMe() {
    const el = modalEl(`<h2>Who's studying?</h2><p class="muted">Tests on this device are logged under this name.</p>
      <div class="pick">${S.state.team.map((n) => `<button data-me="${esc(n)}">${avatar(n, 'lg')}<span>${esc(n)}</span></button>`).join('')}</div>`);
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-me]');
      if (!b) { if (e.target === el && S.me) el.remove(); return; }
      S.me = b.dataset.me;
      LS.set('dp.me', S.me);
      el.remove();
      await loadState().catch(() => {});
      render();
    });
  }
  function shell(inner, active) {
    const nav = [['', 'Home'], ['mock', 'Mock exam'], ['practice', 'Practice'], ['terms', 'Key terms']];
    return `<header class="top"><div class="wrap top-in">
      <a class="brand" href="#/">${LOGO}<span>DECA Prep</span></a>
      <nav class="nav" aria-label="Main">${nav.map(([h, t]) => `<a href="#/${h}"${active === h ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
      <div class="top-r">
        ${S.me ? `<button class="me" data-act="pick-me" title="Switch person">${avatar(S.me, 'sm')}<span>${esc(S.me)}</span></button>` : ''}
        <button class="icon-btn" data-act="logout" title="Lock this device" aria-label="Lock this device">${ic('lock')}</button>
      </div></div></header>
      <main class="wrap page">${inner}</main>`;
  }
  const backLink = () => `<a class="back" href="#/">${ic('l')}Home</a>`;

  // ---------- home
  function home() {
    const st = S.state;
    const me = st.members.find((m) => m.name === S.me);
    const h = new Date().getHours();
    const done = st.members.filter((m) => m.doneToday).length;
    app.innerHTML = shell(`
      <section class="hello">
        <p class="eyebrow">${esc(new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' }))}</p>
        <h1>${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}${S.me ? ', ' + esc(S.me) : ''}</h1>
      </section>
      ${todayCard(me)}
      <section class="sec">
        <div class="sec-head"><h2>Team today</h2><p class="muted">${done} of ${st.members.length} done · goal: one full mock exam a day</p></div>
        <div class="team">${st.members.map(memberCard).join('')}</div>
      </section>
      <section class="sec">
        <div class="sec-head"><h2>Study</h2></div>
        <div class="tools">
          ${tool('mock', 'target', 'Mock exam', '100 questions, scored at the end. Mixed or a past exam.')}
          ${tool('practice', 'book', 'Practice', 'One at a time, with a plain-English explanation after each.')}
          ${tool('terms', 'list', 'Key terms', S.bank.terms.length + ' terms from every exam, sorted by topic.')}
        </div>
      </section>
      ${feed()}
      <footer class="foot"><span>${S.bank.questions.length} questions from ${S.bank.exams.length} exams</span><a href="#/import">${ic('plus')}Add questions</a></footer>`, '');
  }
  const tool = (h, i, t, d) => `<a class="tool card" href="#/${h}"><span class="tile">${ic(i)}</span><span class="tool-t"><b>${t}</b><span>${d}</span></span>${ic('r', 'go')}</a>`;
  function todayCard(me) {
    const r = S.run && S.run.m === S.me && S.run.mode === 'mock' ? S.run : null;
    if (r) {
      return `<section class="today card"><span class="tile accent">${ic('target')}</span>
        <div class="today-t"><h2>Mock exam in progress</h2><p>${Object.keys(r.ans).length} of ${r.qids.length} answered · ${fmtClock(r.act)} active so far</p></div>
        <div class="today-a"><button class="btn ghost" data-act="discard">Discard</button><button class="btn primary" data-act="resume">Resume</button></div></section>`;
    }
    if (me && me.doneToday) {
      return `<section class="today card done"><span class="tile good">${ic('check')}</span>
        <div class="today-t"><h2>Today's mock exam is done</h2><p>${me.last ? pct(me.last.ok, me.last.n) + '% with ' + fmtDur(me.last.act) + ' of active time · ' : ''}${me.streak}-day streak</p></div>
        <div class="today-a"><a class="btn ghost" href="#/practice">Practice</a><a class="btn primary" href="#/mock">Take another</a></div></section>`;
    }
    return `<section class="today card"><span class="tile accent">${ic('target')}</span>
      <div class="today-t"><h2>Today's mock exam</h2><p>100 questions. It counts once every question is answered with at least ${Math.round(S.state.rules.minSec / 60)} active minutes. The timer pauses whenever you leave the tab.</p></div>
      <div class="today-a"><a class="btn primary lg" href="#/mock">Start mock exam</a></div></section>`;
  }
  function calendar(m) {
    const { today, start } = S.state;
    const done = new Set(m.done);
    const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7;
    const first = addDays(today, -dow - 14);
    let cells = '';
    for (let i = 0; i < 21; i++) {
      const d = addDays(first, i);
      const s = d > today ? 'future' : d < start ? 'off' : done.has(d) ? 'done' : d === today ? 'today' : 'miss';
      const label = { future: '', off: 'before the team started', done: 'done', today: 'today, not done yet', miss: 'missed' }[s];
      cells += `<i class="d d-${s}" title="${d}${label ? ': ' + label : ''}"></i>`;
    }
    return `<div class="cal"><div class="cal-h" aria-hidden="true">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((c) => `<span>${c}</span>`).join('')}</div>
      <div class="cal-g" role="img" aria-label="${esc(m.name)}: ${m.done.length} days done so far">${cells}</div></div>`;
  }
  function memberCard(m) {
    const isMe = m.name === S.me;
    return `<article class="member card${isMe ? ' is-me' : ''}">
      <header class="m-head">${avatar(m.name)}<div class="m-who"><h3>${esc(m.name)}${isMe ? '<span class="you">You</span>' : ''}</h3>
        ${m.doneToday ? `<span class="pill good">${ic('check')}Done today</span>` : '<span class="pill warn">Not done yet</span>'}</div></header>
      <div class="streaks">
        <div class="stk${m.streak ? ' hot' : ''}">${ic('flame')}<div><b class="num">${m.streak}</b><span>day streak</span></div></div>
        <div class="stk${m.missed ? ' cold' : ''}">${ic('down')}<div><b class="num">${m.missed ? '−' + m.missed : '0'}</b><span>missed in a row</span></div></div>
      </div>
      ${calendar(m)}
      <dl class="mstats">
        <div><dt>Last mock</dt><dd class="num">${m.last ? pct(m.last.ok, m.last.n) + '%' : '—'}</dd></div>
        <div><dt>Today</dt><dd class="num">${fmtDur(m.todaySec)}</dd></div>
        <div><dt>This week</dt><dd class="num">${fmtDur(m.weekSec)}</dd></div>
      </dl>
    </article>`;
  }
  function feed() {
    const rec = S.state.recent;
    const body = rec.length ? rec.slice(0, 8).map((a) => `<div class="feed-row">${avatar(a.m, 'sm')}
        <p><b>${esc(a.m)}</b> ${a.mode === 'mock' ? 'finished a mock exam' : 'practiced ' + a.n + ' question' + (a.n === 1 ? '' : 's')}<span class="muted"> · ${pct(a.ok, a.n)}% · ${fmtDur(a.act)} active</span></p>
        ${a.mode === 'mock' ? (a.cnt ? `<span class="pill good">${ic('check')}Counted</span>` : '<span class="pill">Didn’t count</span>') : ''}
        <time class="muted">${ago(a.fin)}</time></div>`).join('')
      : '<p class="empty">Nothing yet. Finished tests show up here for the whole team.</p>';
    return `<section class="sec"><div class="sec-head"><h2>Activity</h2></div><div class="card feed">${body}</div></section>`;
  }

  // ---------- setup screens
  function mockSetup() {
    const exams = S.bank.exams.filter((e) => e.n >= 90);
    app.innerHTML = shell(`${backLink()}
      <section class="setup card">
        <span class="tile accent big">${ic('target')}</span>
        <h1>Mock exam</h1>
        <p class="lead">100 questions, one at a time. Like the real exam, you only see your score at the end.</p>
        <ul class="rules">
          <li>${ic('check')}<span>Counts for today once all 100 are answered with at least ${Math.round(S.state.rules.minSec / 60)} active minutes.</span></li>
          <li>${ic('clock')}<span>The timer only runs while this tab is open and you're using it. Switching tabs, minimizing, or 2 minutes idle pauses it.</span></li>
          <li>${ic('flag')}<span>Flag questions to come back to. Your progress is saved if the tab closes.</span></li>
        </ul>
        <label class="field-l" for="src">Questions</label>
        <select id="src" class="input">
          <option value="">Mixed: 100 from every exam, new questions first</option>
          <optgroup label="A past exam, in its original order">${exams.map((e) => `<option value="${esc(e.id)}">${esc(e.label)}</option>`).join('')}</optgroup>
        </select>
        <button class="btn primary block lg" data-act="start-mock">Start mock exam</button>
      </section>`, 'mock');
  }
  function practiceSetup() {
    const hist = S.state.hist || {};
    const missed = Object.values(hist).filter((h) => h[2] === 0).length;
    const areas = AREA_ORDER.filter((k) => S.bank.areas[k]);
    app.innerHTML = shell(`${backLink()}
      <section class="setup card">
        <span class="tile accent big">${ic('book')}</span>
        <h1>Practice</h1>
        <p class="lead">One question at a time. You'll see right away if you got it, with a short, plain explanation.</p>
        <span class="field-l" id="n-l">How many questions</span>
        <div class="seg" role="radiogroup" aria-labelledby="n-l">${[10, 25, 50, 100].map((n) => `<button role="radio" data-act="seg" data-n="${n}" aria-checked="${n === 25}" class="${n === 25 ? 'on' : ''}">${n}</button>`).join('')}</div>
        <label class="field-l" for="area">Topic</label>
        <select id="area" class="input"><option value="">All topics (${S.bank.questions.length} questions)</option>${areas.map((k) => `<option value="${k}">${esc(areaName(k))} (${S.bank.areas[k].length})</option>`).join('')}</select>
        <label class="check"><input type="checkbox" id="mist"${missed ? '' : ' disabled'}><span>Only questions I got wrong last time <span class="muted">(${missed})</span></span></label>
        <button class="btn primary block lg" data-act="start-practice">Start practice</button>
      </section>`, 'practice');
  }

  // ---------- the test runner (mock + practice)
  async function startRun(mode, qids, ex) {
    if (!qids.length) return toast('No questions match that choice yet.');
    if (S.run && S.run.m === S.me && S.run.mode === 'mock' && Object.keys(S.run.ans).length &&
      !(await confirmBox('Start over?', 'You have a mock exam in progress. Starting something new throws it away.', 'Start new', 'Keep it'))) return;
    let id, st;
    try { ({ id, st } = await api('/api/run/start', { member: S.me, mode, qids, ex })); }
    catch (e) { if (e.message === 'locked') return; id = 'l' + Math.random().toString(36).slice(2, 12); st = Date.now(); }
    S.run = { id, m: S.me, mode, ex: ex || null, qids, st, ans: {}, flags: {}, idx: 0, act: 0 };
    saveRun();
    if (location.hash === '#/run') render(); else location.hash = '#/run';
  }
  function runView() {
    if (!S.run || S.run.m !== S.me) { location.hash = '#/'; return; }
    Timer.start();
    drawRun();
  }
  function drawRun() {
    const r = S.run;
    const q = S.bank.byId.get(r.qids[r.idx]);
    if (!q) { S.run = null; saveRun(); location.hash = '#/'; return; }
    const mock = r.mode === 'mock';
    const chosen = r.ans[q.id];
    const shown = !mock && chosen != null;
    const answered = Object.keys(r.ans).length;
    const last = r.idx === r.qids.length - 1;
    const right = mock ? 0 : r.qids.filter((id) => r.ans[id] != null && r.ans[id] === S.bank.byId.get(id).a).length;
    app.innerHTML = `<div class="runner">
      <header class="run-top">
        <button class="icon-btn" data-act="exit" aria-label="${mock ? 'Leave the exam' : 'End practice'}">${ic('x')}</button>
        <div class="bar" role="progressbar" aria-label="Progress" aria-valuemin="1" aria-valuemax="${r.qids.length}" aria-valuenow="${r.idx + 1}"><span style="width:${((r.idx + 1) / r.qids.length) * 100}%"></span></div>
        <span class="count num">${r.idx + 1}<span class="muted"> / ${r.qids.length}</span></span>
        <span class="timer num" id="timer" title="Active study time. Pauses when you leave the tab or go idle.">${ic('clock')}<span id="timer-v">${fmtClock(r.act)}</span><span class="paused-tag">Paused</span></span>
      </header>
      <main class="run-body">
        <p class="q-meta">${mock ? 'Mock exam' : 'Practice'} · ${esc(areaName(q.ar))}${r.flags[q.id] ? ` · <span class="flag-tag">${ic('flag')}Flagged</span>` : ''}</p>
        <h1 class="q-text">${esc(q.q)}</h1>
        <div class="opts">${q.o.map((o, i) => {
          let c = 'opt';
          if (chosen === i) c += ' sel';
          if (shown) c += i === q.a ? ' right' : chosen === i ? ' wrong' : ' dim';
          const mark = shown && i === q.a ? ic('check', 'mark') : shown && chosen === i ? ic('x', 'mark') : '';
          return `<button class="${c}" data-opt="${i}" aria-pressed="${chosen === i}"${shown ? ' disabled' : ''}><span class="key">${L[i]}</span><span class="txt">${esc(o)}</span>${mark}</button>`;
        }).join('')}</div>
        ${shown ? feedback(q, chosen) : ''}
      </main>
      <footer class="run-bar"><div class="run-bar-in">${mock
        ? `<button class="btn ghost" data-act="back"${r.idx ? '' : ' disabled'} aria-label="Previous question">${ic('l')}<span class="hide-sm">Back</span></button>
           <button class="btn ghost${r.flags[q.id] ? ' on' : ''}" data-act="flag" aria-pressed="${!!r.flags[q.id]}">${ic('flag')}<span class="hide-sm">${r.flags[q.id] ? 'Flagged' : 'Flag'}</span></button>
           <button class="btn ghost" data-act="nav" aria-label="All questions">${ic('grid')}<span class="num">${answered}/${r.qids.length}</span></button>
           <span class="spacer"></span>
           ${last ? '<button class="btn primary" data-act="finish">Finish exam</button>' : `<button class="btn primary" data-act="next">Next${ic('r')}</button>`}`
        : `<button class="btn ghost" data-act="exit">End<span class="hide-sm">session</span></button>
           <span class="hint num">${right} / ${answered} correct</span>
           <span class="spacer"></span>
           <button class="btn primary" data-act="next"${shown ? '' : ' disabled'}>${last ? 'See results' : 'Next'}${ic('r')}</button>`}
      </div></footer>
      <div class="idle" id="idle"><div class="idle-card">${ic('pause')}<h2>Timer paused</h2><p>No activity for 2 minutes, so the clock stopped. Move the mouse or press any key to keep going.</p></div></div>
    </div>`;
    paintTimer();
  }
  function feedback(q, chosen) {
    const ok = chosen === q.a;
    const e = explain(q, chosen);
    return `<section class="fb ${ok ? 'ok' : 'no'}" aria-live="polite">
      <p class="fb-head">${ic(ok ? 'check' : 'x')}${ok ? 'Correct!' : `Not quite. The answer is ${L[q.a]}.`}</p>
      <p><span class="lbl">In short</span>${esc(e.short)}</p>
      ${e.whyNot ? `<p><span class="lbl">Why not ${L[chosen]}</span>${esc(e.whyNot)}</p>` : ''}
      <details><summary>Full explanation</summary><p>${esc(q.x)}</p>${q.c ? `<p class="src">${esc(q.c)}${q.pi ? ' · ' + esc(q.pi) : ''}</p>` : ''}</details>
    </section>`;
  }
  function choose(i) {
    const r = S.run;
    if (!r) return;
    const id = r.qids[r.idx];
    if (r.mode === 'practice' && r.ans[id] != null) return;
    r.ans[id] = i;
    saveRun();
    drawRun();
    if (r.mode === 'practice') { const fb = document.querySelector('.fb'); if (fb) fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }
  function step(d) {
    const r = S.run;
    r.idx = Math.max(0, Math.min(r.qids.length - 1, r.idx + d));
    saveRun();
    drawRun();
    scrollTo(0, 0);
  }
  function openNav() {
    const r = S.run;
    const el = modalEl(`<h2>All questions</h2><p class="muted">${Object.keys(r.ans).length} of ${r.qids.length} answered${Object.keys(r.flags).length ? ' · ' + Object.keys(r.flags).length + ' flagged' : ''}</p>
      <div class="navgrid">${r.qids.map((id, i) => `<button data-jump="${i}" class="${r.ans[id] != null ? 'a' : ''}${r.flags[id] ? ' f' : ''}${i === r.idx ? ' cur' : ''}" aria-label="Question ${i + 1}">${i + 1}</button>`).join('')}</div>
      <div class="legend"><span><i class="lg-a"></i>Answered</span><span><i class="lg-f"></i>Flagged</span></div>
      <div class="modal-actions"><button class="btn ghost" data-close>Close</button></div>`);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-jump]');
      if (b) { r.idx = +b.dataset.jump; saveRun(); el.remove(); drawRun(); scrollTo(0, 0); } else if (e.target.closest('[data-close]') || e.target === el) el.remove();
    });
  }
  async function finishMock() {
    const r = S.run;
    const left = r.qids.filter((id) => r.ans[id] == null).length;
    if (left && !(await confirmBox('Finish with blanks?', `${left} question${left > 1 ? 's are' : ' is'} still blank. A mock exam only counts for today when every question is answered.`, 'Finish anyway', 'Keep going'))) {
      r.idx = r.qids.findIndex((id) => r.ans[id] == null);
      saveRun();
      return drawRun();
    }
    return finishRun();
  }
  function gradeLocal(a) {
    const ans = new Map(a.ans);
    const rows = [];
    let ok = 0;
    for (const id of a.qids) {
      const q = S.bank.byId.get(id);
      if (!q) continue;
      const c = ans.has(id) ? ans.get(id) : -1;
      if (c === q.a) ok++;
      rows.push([id, c, c === q.a ? 1 : 0]);
    }
    const rule = S.state.rules, answered = rows.filter((x) => x[1] >= 0).length;
    return { rows, ok, n: rows.length, cnt: a.mode === 'mock' && rows.length >= rule.mock && answered >= rows.length && a.act >= rule.minSec };
  }
  async function finishRun() {
    const r = S.run;
    Timer.stop();
    const a = {
      id: r.id, m: r.m, mode: r.mode, ex: r.ex, st: r.st, fin: Date.now(), act: Math.round(r.act / 1000),
      qids: r.mode === 'mock' ? r.qids : r.qids.filter((id) => r.ans[id] != null),
      ans: Object.entries(r.ans)
    };
    Object.assign(a, gradeLocal(a));
    saveLocal(a);
    S.run = null;
    saveRun();
    location.hash = '#/result/' + a.id;
    try {
      const srv = await api('/api/run/finish', a);
      Object.assign(a, { cnt: srv.cnt, act: srv.act, synced: true });
      saveLocal(a);
      await loadState();
      if (route()[1] === a.id) resultView(a.id);
    } catch { toast('Saved on this device. It will upload automatically next time you open the site.'); }
  }

  // ---------- results
  const ring = (p) => `<svg viewBox="0 0 120 120" class="ring-svg" role="img" aria-label="${p} percent"><circle cx="60" cy="60" r="52" class="ring-bg"/><circle cx="60" cy="60" r="52" class="ring-fg ${p >= 70 ? 'good' : p >= 50 ? 'mid' : 'low'}" stroke-dasharray="${((p / 100) * 326.7).toFixed(1)} 326.7" transform="rotate(-90 60 60)"/><text x="60" y="61" class="ring-t">${p}%</text></svg>`;
  function cntReason(a) {
    const rule = S.state.rules, blank = a.rows.filter((x) => x[1] < 0).length;
    if (a.n < rule.mock) return `it has fewer than ${rule.mock} questions`;
    if (blank) return `${blank} question${blank > 1 ? 's were' : ' was'} left blank`;
    if (a.act < rule.minSec) return `under ${Math.round(rule.minSec / 60)} active minutes`;
    return 'not uploaded yet';
  }
  function resultView(id) {
    const a = findLocal(id);
    if (!a) { location.hash = '#/'; return; }
    const p = pct(a.ok, a.n);
    const wrong = a.rows.filter((x) => !x[2]);
    const by = {};
    for (const [qid, , ok] of a.rows) {
      const q = S.bank.byId.get(qid);
      if (!q) continue;
      const b = by[q.ar] || (by[q.ar] = [0, 0]);
      b[1]++;
      if (ok) b[0]++;
    }
    const areas = Object.entries(by).sort((x, y) => x[1][0] / x[1][1] - y[1][0] / y[1][1]);
    const mock = a.mode === 'mock';
    app.innerHTML = shell(`${backLink()}
      <section class="result card">
        ${ring(p)}
        <div class="result-main">
          <p class="eyebrow">${mock ? 'Mock exam' : 'Practice'} · ${esc(a.m)} · ${esc(new Date(a.fin).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</p>
          <h1>${a.ok} of ${a.n} correct</h1>
          <div class="chips"><span class="pill">${ic('clock')}${fmtDur(a.act)} active study time</span>${mock ? (a.cnt ? `<span class="pill good">${ic('check')}Counts for today</span>` : `<span class="pill bad">${ic('x')}Didn't count: ${esc(cntReason(a))}</span>`) : ''}</div>
          <div class="row-btns">${wrong.length ? `<button class="btn primary" data-act="practice-these" data-ids="${wrong.map((x) => x[0]).join(',')}">Practice my ${wrong.length} mistake${wrong.length > 1 ? 's' : ''}</button>` : ''}<a class="btn ghost" href="#/">Back to home</a></div>
        </div>
      </section>
      ${areas.length > 1 ? `<section class="sec"><div class="sec-head"><h2>By topic</h2><p class="muted">Weakest first</p></div>
        <div class="card areas">${areas.map(([k, [ok, n]]) => `<div class="area-row"><span>${esc(areaName(k))}</span><span class="meter"><i class="${pct(ok, n) >= 70 ? 'good' : pct(ok, n) >= 50 ? 'mid' : 'low'}" style="width:${pct(ok, n)}%"></i></span><b class="num">${ok}/${n}</b></div>`).join('')}</div></section>` : ''}
      <section class="sec"><div class="sec-head"><h2>${wrong.length ? 'Review your mistakes' : 'Perfect score. Nothing to review.'}</h2></div>
        <div class="review">${wrong.map(([qid, c]) => reviewItem(qid, c)).join('')}</div></section>`, '');
  }
  function reviewItem(qid, c) {
    const q = S.bank.byId.get(qid);
    if (!q) return '';
    const e = explain(q, c);
    return `<article class="rv card">
      <p class="q-meta">${esc(areaName(q.ar))}</p>
      <h3>${esc(q.q)}</h3>
      <div class="ans ${c >= 0 ? 'bad' : 'skip'}"><span class="lbl">Your answer</span>${c >= 0 ? L[c] + '. ' + esc(q.o[c]) : 'Left blank'}</div>
      <div class="ans good"><span class="lbl">Correct answer</span>${L[q.a]}. ${esc(q.o[q.a])}</div>
      <p class="rv-why"><b>In short:</b> ${esc(e.short)}</p>
      ${e.whyNot ? `<p class="rv-why"><b>Why not ${L[c]}:</b> ${esc(e.whyNot)}</p>` : ''}
      <details><summary>Full explanation</summary><p>${esc(q.x)}</p></details>
    </article>`;
  }

  // ---------- key terms
  function termsView() {
    const terms = S.bank.terms;
    const areas = AREA_ORDER.filter((k) => terms.some((t) => t.ar === k));
    app.innerHTML = shell(`${backLink()}
      <section class="terms-head"><h1>Key terms</h1><p class="muted">${terms.length} terms defined in the answer explanations of every exam, grouped by topic.</p>
        <div class="search">${ic('search')}<input id="tq" type="search" placeholder="Search terms and definitions" autocomplete="off" aria-label="Search key terms"></div>
        <div class="chips-row" id="tchips"><button class="chip-btn on" data-area="">All</button>${areas.map((k) => `<button class="chip-btn" data-area="${k}">${esc(areaName(k))}</button>`).join('')}</div>
      </section>
      <div id="tlist"></div>`, 'terms');
    let area = '', text = '';
    const hl = (s, q) => {
      const h = esc(s);
      if (!q) return h;
      const i = h.toLowerCase().indexOf(esc(q));
      return i < 0 ? h : h.slice(0, i) + '<mark>' + h.slice(i, i + esc(q).length) + '</mark>' + h.slice(i + esc(q).length);
    };
    const draw = () => {
      const q = text.trim().toLowerCase();
      const list = terms.filter((t) => (!area || t.ar === area) && (!q || t.t.toLowerCase().includes(q) || t.d.toLowerCase().includes(q)));
      const groups = AREA_ORDER.map((k) => [k, list.filter((t) => t.ar === k)]).filter(([, g]) => g.length);
      document.getElementById('tlist').innerHTML = groups.length
        ? groups.map(([k, g]) => `<section class="tgroup"><h2>${esc(areaName(k))}<span class="muted">${g.length}</span></h2><div class="card tcard">${g.map((t) => `
            <div class="term"><h3>${hl(t.t, q)}</h3><p>${hl(t.d, q)}</p><button class="link" data-act="practice-these" data-ids="${t.q.join(',')}">Practice ${t.q.length === 1 ? 'the question' : 'the ' + t.q.length + ' questions'} that use it</button></div>`).join('')}</div></section>`).join('')
        : `<p class="empty">No terms match “${esc(text)}”.</p>`;
    };
    document.getElementById('tq').addEventListener('input', (e) => { text = e.target.value; draw(); });
    document.getElementById('tchips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-area]');
      if (!b) return;
      area = b.dataset.area;
      document.querySelectorAll('.chip-btn').forEach((x) => x.classList.toggle('on', x === b));
      draw();
    });
    draw();
  }

  // ---------- import
  function importView() {
    app.innerHTML = shell(`${backLink()}
      <section class="setup card wide">
        <h1>Add questions</h1>
        <p class="lead">Paste a whole exam: the numbered questions with A to D options, then the answer key (lines like “1. B” followed by the explanation). Text copied from a DECA sample exam PDF works as-is. Duplicates are skipped.</p>
        <label class="field-l" for="imp-label">Name</label>
        <input id="imp-label" class="input" placeholder="e.g. ICDC 2019" maxlength="40">
        <label class="field-l" for="imp-text">Exam text</label>
        <textarea id="imp-text" class="input ta" rows="12" placeholder="1. Which of the following..."></textarea>
        <div class="row-btns"><button class="btn ghost" data-act="imp-check">Check</button><button class="btn primary" data-act="imp-save">Add to question bank</button></div>
        <div id="imp-out" aria-live="polite"></div>
      </section>`, '');
  }
  async function doImport(save) {
    const text = document.getElementById('imp-text').value;
    const label = document.getElementById('imp-label').value;
    const out = document.getElementById('imp-out');
    const res = P.parseExam(text, {});
    const report = (found, ok, errs, extra) => `<div class="imp-report ${ok ? 'good' : 'bad'}"><p><b>${ok} of ${found || 0} questions read correctly.</b>${extra || ''}</p>${errs.length ? `<ul>${errs.slice(0, 12).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`;
    if (!save || !res.items.length) { out.innerHTML = report(res.found, res.items.length, res.errors, res.items.length ? ' Looks good. Press “Add to question bank”.' : ''); return; }
    const btn = document.querySelector('[data-act="imp-save"]');
    btn.disabled = true;
    try {
      const r = await api('/api/import', { text, label, save: true });
      S.bank = indexBank(await api('/api/bank'));
      out.innerHTML = report(r.found, r.parsed, r.errors, ` Saved: ${r.added} new question${r.added === 1 ? '' : 's'} added.`);
    } catch (e) { out.innerHTML = report(res.found, 0, [e.message]); }
    btn.disabled = false;
  }

  // ---------- routing + events
  function render() {
    const r = route()[0];
    if (r !== 'run') Timer.stop();
    if (!S.state || !S.bank) return;
    const views = { '': home, mock: mockSetup, practice: practiceSetup, run: runView, result: () => resultView(route()[1]), terms: termsView, import: importView };
    (views[r] || home)();
  }
  addEventListener('hashchange', () => { render(); scrollTo(0, 0); });

  app.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-opt]');
    if (opt) { if (!opt.disabled) choose(+opt.dataset.opt); return; }
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled) act(b.dataset.act, b);
  });
  async function act(a, el) {
    const r = S.run;
    switch (a) {
      case 'pick-me': return pickMe();
      case 'logout': await fetch('/api/logout', { method: 'POST' }).catch(() => {}); return location.replace('/login');
      case 'start-mock': { const ex = document.getElementById('src').value; return startRun('mock', ex ? pickExam(ex) : pickMixed(100), ex || null); }
      case 'start-practice': {
        const n = +document.querySelector('.seg .on').dataset.n;
        const area = document.getElementById('area').value;
        const mist = document.getElementById('mist').checked;
        const hist = S.state.hist || {};
        const list = S.bank.questions.filter((q) => (!area || q.ar === area) && (!mist || (hist[q.id] && hist[q.id][2] === 0)));
        return startRun('practice', freshFirst(list).slice(0, n).map((q) => q.id));
      }
      case 'practice-these': return startRun('practice', shuffle(el.dataset.ids.split(',').filter((id) => S.bank.byId.has(id))));
      case 'resume': location.hash = '#/run'; return;
      case 'discard':
        if (await confirmBox('Discard this exam?', 'Your answers so far will be deleted.', 'Discard', 'Keep it')) { S.run = null; saveRun(); render(); }
        return;
      case 'seg': el.parentNode.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === el); x.setAttribute('aria-checked', String(x === el)); }); return;
      case 'back': return step(-1);
      case 'next':
        if (r.idx === r.qids.length - 1) return r.mode === 'mock' ? finishMock() : finishRun();
        return step(1);
      case 'flag': { const id = r.qids[r.idx]; if (r.flags[id]) delete r.flags[id]; else r.flags[id] = 1; saveRun(); return drawRun(); }
      case 'nav': return openNav();
      case 'finish': return finishMock();
      case 'exit':
        if (r.mode === 'practice') {
          if (Object.keys(r.ans).length) return finishRun();
          S.run = null; saveRun(); location.hash = '#/'; return;
        }
        if (await confirmBox('Leave the exam?', 'Your answers are saved on this device, so you can resume from Home. The timer stays paused while you are away.', 'Leave', 'Stay')) { saveRun(); location.hash = '#/'; }
        return;
      case 'imp-check': return doImport(false);
      case 'imp-save': return doImport(true);
    }
  }
  addEventListener('keydown', (e) => {
    if (route()[0] !== 'run' || !S.run || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.modal')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    const i = k.length === 1 ? Math.max('abcd'.indexOf(k), '1234'.indexOf(k)) : -1;
    if (i >= 0) { e.preventDefault(); return choose(i); }
    if (k === 'enter' || k === 'arrowright') {
      const b = document.querySelector('.run-bar .btn.primary:not([disabled])');
      if (b) { e.preventDefault(); b.click(); }
      return;
    }
    if (S.run.mode !== 'mock') return;
    if (k === 'arrowleft') step(-1);
    else if (k === 'f') act('flag');
  });

  async function boot() {
    app.innerHTML = '<div class="boot"><span class="spinner" aria-hidden="true"></span><p>Loading questions…</p></div>';
    try {
      const [bank] = await Promise.all([api('/api/bank'), loadState()]);
      S.bank = indexBank(bank);
    } catch (e) {
      if (e.message === 'locked') return;
      app.innerHTML = '<div class="boot"><p>Couldn’t reach the server. On free hosting it can take up to a minute to wake up.</p><button class="btn primary" id="retry">Try again</button></div>';
      document.getElementById('retry').onclick = boot;
      return;
    }
    if (!S.state.team.includes(S.me)) S.me = null;
    render();
    if (!S.me) pickMe();
    resync();
  }
  boot();
})();
