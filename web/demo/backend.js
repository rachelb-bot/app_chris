// Runs the real Voltline API inside the browser for the self-contained preview.
// The database is SQLite (via sql.js) kept in memory and saved to this browser's localStorage.
import initSqlJs from 'sql.js/dist/sql-asm-memory-growth.js';
import { dispatch } from './shims/express.js';

const STORE_KEY = 'voltline-preview-db-v1';
const COOKIE_KEY = 'voltline-preview-cookies';

globalThis.process = globalThis.process || { env: {}, argv: [], cwd: () => '/', platform: 'browser' };
Object.assign(globalThis.process.env, { NODE_ENV: 'production', SESSION_SECRET: 'voltline-browser-preview', DATA_DIR: '/preview' });
globalThis.Buffer = globalThis.Buffer || { from: (s) => String(s) };

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const toB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

let jar = safe(() => JSON.parse(localStorage.getItem(COOKIE_KEY)) || {}, {});
const saveJar = () => safe(() => localStorage.setItem(COOKIE_KEY, JSON.stringify(jar)));

let layers = [];
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => safe(() => localStorage.setItem(STORE_KEY, toB64(globalThis.__DEMO_DB.export()))), 400);
}

export function resetPreview() {
  safe(() => { localStorage.removeItem(STORE_KEY); localStorage.removeItem(COOKIE_KEY); });
  location.reload();
}

async function handle(method, url, body) {
  const u = new URL(url, 'http://preview.local');
  const req = {
    method, path: u.pathname.replace(/^\/api/, '') || '/', query: Object.fromEntries(u.searchParams), body: body || {},
    params: {}, files: [], cookies: jar, headers: {}, protocol: location.protocol.replace(':', ''), get: () => location.host,
  };
  const res = {
    statusCode: 200, sent: false, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.sent = true; return this; },
    cookie(n, v) { jar[n] = v; saveJar(); return this; },
    clearCookie(n) { delete jar[n]; saveJar(); return this; },
    setHeader() { return this; }, type() { return this; },
    sendFile() { this.status(404).json({ error: 'Files are not available in this preview.' }); },
  };
  try {
    const handled = await dispatch(layers.map((h) => ({ h: [h] })), req, res);
    if (!handled) res.status(404).json({ error: 'Not found' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Something went wrong' });
    if (!err.status) console.error(err);
  }
  if (method !== 'GET' && res.statusCode < 400) persist();
  return res;
}

export async function boot() {
  globalThis.__SQL = await initSqlJs();
  const saved = safe(() => localStorage.getItem(STORE_KEY), null);
  if (saved) safe(() => { globalThis.__DEMO_BYTES = fromB64(saved); });

  const { migrate, db } = await import('../../server/db.js');
  migrate();
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
    const { seedDemo } = await import('../../server/seed-demo.js');
    seedDemo();
    persist();
  }
  const [{ loadUser }, core, crm, work, money, insights, hub] = await Promise.all([
    import('../../server/auth.js'), import('../../server/routes/core.js'), import('../../server/routes/crm.js'),
    import('../../server/routes/work.js'), import('../../server/routes/money.js'), import('../../server/routes/insights.js'),
    import('../../server/routes/hub.js'),
  ]);
  const pipeline = await import('../../server/routes/pipeline.js');
  pipeline.backfillDeals();
  layers = [hub.default, loadUser, core.default, crm.default, work.default, money.default, insights.default, pipeline.default];

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api')) return realFetch(input, init);
    let body = null;
    if (typeof init.body === 'string') body = JSON.parse(init.body);
    const r = await handle((init.method || 'GET').toUpperCase(), url, body);
    return new Response(JSON.stringify(r.body ?? null), { status: r.statusCode, headers: { 'Content-Type': 'application/json' } });
  };
}
