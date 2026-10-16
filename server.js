// DECA Prep: password gate, encrypted question bank, attempt log with team streaks.
// Local:  node server.js  (reads .env, keeps data in data/dev-store.json)
// Render: SITE_PASSWORD, SESSION_SECRET, BANK_KEY, TEAM, START_DATE, REDIS_URL
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const P = require('./lib/parse');
require('./lib/env')(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3564;
const PASSWORD = process.env.SITE_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || '';
const TEAM = (process.env.TEAM || '').split(',').map((s) => s.trim()).filter(Boolean);
const TZ = process.env.TZ_NAME || 'America/Toronto';
const SECURE = !!process.env.RENDER;
const MOCK_SIZE = 100;
const MIN_ACTIVE_SEC = 600; // a full mock only counts with 10+ minutes of active time
const PUB = path.join(__dirname, 'public');
if (!PASSWORD || !SECRET || !TEAM.length) { console.error('Set SITE_PASSWORD, SESSION_SECRET and TEAM'); process.exit(1); }

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (t) => dayFmt.format(new Date(t));
const addDays = (k, n) => { const d = new Date(k + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const START = process.env.START_DATE || dayKey(Date.now());
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// ---------- storage: Render Key Value in production, a JSON file locally
function fileStore(file) {
  let db = {};
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  const save = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(db)); };
  return {
    all: async (h) => ({ ...(db[h] || {}) }),
    get: async (h, k) => (db[h] || {})[k] || null,
    set: async (h, k, v) => { (db[h] = db[h] || {})[k] = v; save(); },
    del: async (h, k) => { if (db[h]) { delete db[h][k]; save(); } }
  };
}
async function redisStore(url) {
  const { createClient } = require('redis');
  const c = createClient({ url });
  c.on('error', (e) => console.error('redis:', e.message));
  await c.connect();
  return {
    all: (h) => c.hGetAll(h),
    get: async (h, k) => (await c.hGet(h, k)) || null,
    set: (h, k, v) => c.hSet(h, k, v),
    del: (h, k) => c.hDel(h, k)
  };
}
let store;

// ---------- question bank (bank.enc is AES-256-GCM; the key lives only in env)
function loadBase() {
  const key = Buffer.from(process.env.BANK_KEY || '', 'base64');
  const enc = JSON.parse(fs.readFileSync(path.join(__dirname, 'bank.enc'), 'utf8'));
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'base64'));
  d.setAuthTag(Buffer.from(enc.tag, 'base64'));
  return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(Buffer.from(enc.data, 'base64')), d.final()])));
}
let BASE = [], BANK = null, BANK_GZ = null, BANK_ETAG = '', QMAP = new Map();
async function rebuildBank() {
  const imported = Object.values(await store.all('dp:imp')).map((s) => JSON.parse(s));
  BANK = P.buildBank(BASE.concat(imported));
  QMAP = new Map(BANK.questions.map((q) => [q.id, q]));
  const json = JSON.stringify(BANK);
  BANK_GZ = zlib.gzipSync(json);
  BANK_ETAG = '"' + crypto.createHash('sha1').update(json).digest('hex').slice(0, 16) + '"';
}

// ---------- auth: one shared password -> signed HttpOnly cookie
const sign = (v) => crypto.createHmac('sha256', SECRET + '|' + PASSWORD).update(v).digest('base64url');
const cookie = (v, age) => `dp=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${SECURE ? '; Secure' : ''}`;
function authed(req) {
  const m = /(?:^|;\s*)dp=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return false;
  const tok = decodeURIComponent(m[1]);
  const i = tok.lastIndexOf('.');
  if (i < 0) return false;
  const a = Buffer.from(sign(tok.slice(0, i))), b = Buffer.from(tok.slice(i + 1));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const fails = new Map();
function clientIp(req) {
  // On onrender.com, Cloudflare + two Render hops each append one entry: the visitor is 3rd from the right.
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff.length >= 3 ? xff[xff.length - 3] : xff[0] || req.socket.remoteAddress || '?';
}
async function login(req, res) {
  const ip = clientIp(req), now = Date.now();
  const recent = (k) => (fails.get(k) || []).filter((t) => now - t < 15 * 60e3);
  if (recent(ip).length >= 8 || recent('*').length >= 80) return json(res, 429, { error: 'Too many tries. Wait 15 minutes and try again.' });
  const body = await readBody(req);
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  if (!crypto.timingSafeEqual(h(body.password || ''), h(PASSWORD))) {
    fails.set(ip, [...recent(ip), now]);
    fails.set('*', [...recent('*'), now]);
    return json(res, 401, { error: 'That password isn’t right.' });
  }
  const v = 'v1.' + now;
  res.setHeader('Set-Cookie', cookie(v + '.' + sign(v), 90 * 86400));
  return json(res, 200, { ok: true });
}

// ---------- attempts
function grade(qids, ans) {
  const pick = new Map((Array.isArray(ans) ? ans : []).filter(Array.isArray).map(([q, c]) => [String(q), Number(c)]));
  const rows = [];
  let ok = 0;
  for (const id of qids) {
    const q = QMAP.get(id);
    if (!q) continue;
    const c = pick.has(id) && pick.get(id) >= 0 && pick.get(id) <= 3 ? pick.get(id) : -1;
    if (c === q.a) ok++;
    rows.push([id, c, c === q.a ? 1 : 0]);
  }
  return { rows, ok };
}
function makeAttempt(b, fin) {
  const m = String(b.m || '');
  if (!TEAM.includes(m)) throw bad('Unknown team member');
  const mode = b.mode === 'mock' ? 'mock' : 'practice';
  const qids = (Array.isArray(b.qids) ? b.qids : []).map(String).slice(0, 300);
  const st = Math.min(Number(b.st) || fin, fin);
  const g = grade(qids, b.ans);
  const rows = mode === 'mock' ? g.rows : g.rows.filter((r) => r[1] >= 0);
  const answered = rows.filter((r) => r[1] >= 0).length;
  // Active time comes from the page (it pauses when the tab is hidden or idle); it can never exceed wall-clock time.
  const act = Math.max(0, Math.min(Math.round(Number(b.act) || 0), Math.round((fin - st) / 1000) + 5));
  const cnt = mode === 'mock' && rows.length >= MOCK_SIZE && answered >= rows.length && act >= MIN_ACTIVE_SEC;
  return { id: b.id, m, mode, ex: b.ex ? String(b.ex).slice(0, 40) : null, st, fin, act, n: rows.length, ok: g.ok, cnt, day: dayKey(fin), rows };
}
const validId = (id) => /^[a-z0-9-]{6,40}$/i.test(id);

async function startRun(b) {
  const m = String(b.member || '');
  if (!TEAM.includes(m)) throw bad('Unknown team member');
  const qids = (Array.isArray(b.qids) ? b.qids : []).map(String).filter((id) => QMAP.has(id)).slice(0, 300);
  if (!qids.length) throw bad('No questions');
  for (const [k, v] of Object.entries(await store.all('dp:run'))) {
    if (Date.now() - JSON.parse(v).st > 3 * 86400e3) await store.del('dp:run', k);
  }
  const run = { id: crypto.randomBytes(8).toString('hex'), m, mode: b.mode === 'mock' ? 'mock' : 'practice', ex: b.ex || null, st: Date.now(), qids };
  await store.set('dp:run', run.id, JSON.stringify(run));
  return { id: run.id, st: run.st };
}
async function finishRun(b) {
  const id = String(b.id || '');
  if (!validId(id)) throw bad('Bad attempt id');
  const prev = await store.get('dp:att', id);
  if (prev) return JSON.parse(prev);
  const run = JSON.parse((await store.get('dp:run', id)) || 'null');
  const src = run ? { ...b, m: run.m, mode: run.mode, ex: run.ex, st: run.st, qids: run.qids } : b;
  const att = makeAttempt({ ...src, id }, Date.now());
  await store.set('dp:att', id, JSON.stringify(att));
  if (run) await store.del('dp:run', id);
  return att;
}
// Each browser keeps its own attempts and re-uploads any the server lost (Key Value has no disk).
async function sync(b) {
  if (Array.isArray(b.ids)) {
    const have = await store.all('dp:att');
    return { missing: b.ids.map(String).filter((id) => validId(id) && !have[id]) };
  }
  let added = 0;
  for (const a of (Array.isArray(b.attempts) ? b.attempts : []).slice(0, 300)) {
    const id = String(a.id || '');
    if (!validId(id) || (await store.get('dp:att', id))) continue;
    try { await store.set('dp:att', id, JSON.stringify(makeAttempt({ ...a, id }, Math.min(Number(a.fin) || Date.now(), Date.now())))); added++; } catch { /* skip bad rows */ }
  }
  return { added };
}

async function teamState(me) {
  const atts = Object.values(await store.all('dp:att')).map((s) => JSON.parse(s)).sort((a, b) => a.fin - b.fin);
  const today = dayKey(Date.now());
  const days = [];
  for (let d = START; d <= today; d = addDays(d, 1)) days.push(d);
  const weekAgo = addDays(today, -6);
  const members = TEAM.map((name) => {
    const mine = atts.filter((a) => a.m === name);
    const done = new Set(mine.filter((a) => a.cnt).map((a) => a.day));
    const doneToday = done.has(today);
    let streak = 0, missed = 0, best = 0, run = 0;
    for (let i = days.length - (doneToday ? 1 : 2); i >= 0 && done.has(days[i]); i--) streak++;
    if (!doneToday) for (let i = days.length - 2; i >= 0 && !done.has(days[i]); i--) missed++;
    for (const d of days) { run = done.has(d) ? run + 1 : 0; best = Math.max(best, run); }
    const mocks = mine.filter((a) => a.cnt).reverse();
    const last = mocks[0] ? { ok: mocks[0].ok, n: mocks[0].n, act: mocks[0].act, fin: mocks[0].fin } : null;
    const avg = mocks.length ? Math.round((mocks.slice(0, 5).reduce((s, a) => s + a.ok / a.n, 0) / Math.min(5, mocks.length)) * 100) : null;
    const secSince = (from) => mine.filter((a) => a.day >= from).reduce((s, a) => s + a.act, 0);
    return { name, doneToday, streak, missed, best, done: [...done], todaySec: secSince(today), weekSec: secSince(weekAgo), last, avg, mocks: mocks.length };
  });
  const recent = atts.slice(-10).reverse().map(({ m, mode, ok, n, act, fin, cnt }) => ({ m, mode, ok, n, act, fin, cnt }));
  const out = { team: TEAM, today, start: START, members, recent, rules: { mock: MOCK_SIZE, minSec: MIN_ACTIVE_SEC } };
  if (TEAM.includes(me)) {
    const hist = {}; // question id -> [times seen, times wrong, last result 1/0]
    for (const a of atts) {
      if (a.m !== me) continue;
      for (const [id, c, r] of a.rows) {
        if (c < 0) continue;
        const h = hist[id] || (hist[id] = [0, 0, 0]);
        h[0]++; if (!r) h[1]++; h[2] = r;
      }
    }
    out.hist = hist;
  }
  return out;
}

async function importExam(b) {
  const text = String(b.text || '');
  if (text.trim().length < 50) throw bad('Paste a full exam: the questions, then the answer key.');
  const label = String(b.label || '').trim().slice(0, 40) || 'Imported exam';
  const id = 'imp-' + P.hash(text).slice(0, 10);
  const r = P.parseExam(text, { id, label });
  const out = { found: r.found, parsed: r.items.length, errors: r.errors.slice(0, 25), sample: r.items.slice(0, 2) };
  if (!b.save || !r.items.length) return out;
  const before = BANK.questions.length;
  await store.set('dp:imp', id, JSON.stringify({ id, label, items: r.items }));
  await rebuildBank();
  return { ...out, saved: r.items.length, added: BANK.questions.length - before };
}

// ---------- http
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
function json(res, status, data) {
  res.writeHead(status, { ...SEC_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function redirect(res, to) { res.writeHead(302, { Location: to }); res.end(); }
function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, SEC_HEADERS); return res.end('Not found'); }
    const etag = `"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
    res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag });
    fs.createReadStream(file).pipe(res);
  });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 3e6) { reject(bad('Too large', 413)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(bad('Bad JSON')); } });
    req.on('error', reject);
  });
}

async function api(req, res, url) {
  const p = url.pathname;
  if (p === '/api/health') {
    const t = Date.now();
    await store.all('dp:run'); // proves the store answers
    return json(res, 200, { ok: true, questions: BANK.questions.length, terms: BANK.terms.length, store: process.env.REDIS_URL ? 'redis' : 'file', storeMs: Date.now() - t });
  }
  if (p === '/api/login' && req.method === 'POST') return login(req, res);
  if (p === '/api/logout' && req.method === 'POST') { res.setHeader('Set-Cookie', cookie('', 0)); return json(res, 200, { ok: true }); }
  if (!authed(req)) return json(res, 401, { error: 'Locked' });
  if (p === '/api/ping') return json(res, 200, { ok: true });
  if (p === '/api/bank') {
    if (req.headers['if-none-match'] === BANK_ETAG) { res.writeHead(304, { ETag: BANK_ETAG }); return res.end(); }
    const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-cache', ETag: BANK_ETAG, Vary: 'Accept-Encoding', ...(gz ? { 'Content-Encoding': 'gzip' } : {}) });
    return res.end(gz ? BANK_GZ : zlib.gunzipSync(BANK_GZ));
  }
  if (p === '/api/state') return json(res, 200, await teamState(url.searchParams.get('me')));
  if (req.method !== 'POST') return json(res, 404, { error: 'Not found' });
  const body = await readBody(req);
  if (p === '/api/run/start') return json(res, 200, await startRun(body));
  if (p === '/api/run/finish') return json(res, 200, await finishRun(body));
  if (p === '/api/sync') return json(res, 200, await sync(body));
  if (p === '/api/import') return json(res, 200, await importExam(body));
  return json(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    if (p.startsWith('/api/')) return await api(req, res, url);
    if (p === '/' || p === '/index.html') return authed(req) ? serveFile(req, res, path.join(PUB, 'index.html')) : redirect(res, '/login');
    if (p === '/login') return authed(req) ? redirect(res, '/') : serveFile(req, res, path.join(PUB, 'login.html'));
    if (p === '/lib/parse.js') return serveFile(req, res, path.join(__dirname, 'lib', 'parse.js'));
    const file = path.normalize(path.join(PUB, decodeURIComponent(p)));
    if (!file.startsWith(PUB + path.sep) || file.endsWith('.html')) { res.writeHead(404, SEC_HEADERS); return res.end('Not found'); }
    return serveFile(req, res, file);
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong' });
  }
});

(async () => {
  BASE = loadBase();
  store = process.env.REDIS_URL ? await redisStore(process.env.REDIS_URL) : fileStore(path.join(__dirname, 'data', 'dev-store.json'));
  await rebuildBank();
  server.listen(PORT, () => console.log(`DECA Prep on http://localhost:${PORT}: ${BANK.questions.length} questions, ${BANK.terms.length} terms`));
})().catch((e) => { console.error(e); process.exit(1); });
