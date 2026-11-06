import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { db, getSettings, setSettings, UPLOAD_DIR } from '../db.js';
import { hashPassword, checkPassword, createSession, destroySession, requireAuth, requireRole, publicUser, isOffice } from '../auth.js';
import { HttpError, bad, notFound, pick, insert, update, clientName, token, today, nowIso } from '../lib.js';
import { emailEnabled } from '../mailer.js';
import { seedDefaults } from '../seed-defaults.js';

const r = Router();

// ---------------- setup & auth ----------------
r.get('/auth/status', (req, res) => {
  const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  res.json({ needsSetup: users === 0, user: req.user || null, settings: req.user ? getSettings() : { company_name: getSettings().company_name }, emailEnabled: emailEnabled() });
});

r.post('/auth/setup', (req, res) => {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) throw new HttpError(409, 'Setup already completed');
  const { company_name, name, email, password } = req.body || {};
  if (!company_name || !name || !email) throw bad('Company name, your name and email are required');
  const id = db.transaction(() => {
    setSettings({ company_name, company_email: email });
    const uid = insert('users', { name, email, password_hash: hashPassword(password), role: 'owner', color: '#f59e0b' });
    seedDefaults();
    return uid;
  })();
  createSession(res, id);
  res.json({ ok: true });
});

r.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(String(email || '').trim());
  if (!u || !checkPassword(password, u.password_hash)) throw new HttpError(401, 'Incorrect email or password');
  createSession(res, u.id);
  res.json({ user: publicUser(u) });
});

r.post('/auth/logout', (req, res) => { destroySession(req, res); res.json({ ok: true }); });

r.post('/auth/password', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!checkPassword(req.body.current, u.password_hash)) throw bad('Current password is incorrect');
  update('users', u.id, { password_hash: hashPassword(req.body.next) });
  res.json({ ok: true });
});

// Everything below requires a signed-in user.
r.use(requireAuth);

// ---------------- settings ----------------
r.get('/settings', (_req, res) => res.json(getSettings()));
r.put('/settings', requireRole('admin'), (req, res) => { setSettings(req.body || {}); res.json(getSettings()); });

// ---------------- team ----------------
r.get('/users', (_req, res) => {
  res.json(db.prepare('SELECT id, name, email, phone, role, color, hourly_cost, licence_no, active, created_at FROM users ORDER BY active DESC, name').all());
});
r.post('/users', requireRole('admin'), (req, res) => {
  const d = pick(req.body, ['name', 'email', 'phone', 'role', 'color', 'hourly_cost', 'licence_no']);
  if (!d.name || !d.email) throw bad('Name and email are required');
  if (d.role === 'owner' && req.user.role !== 'owner') throw new HttpError(403, 'Only the owner can add another owner');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(d.email)) throw bad('A team member with that email already exists');
  const id = insert('users', { ...d, password_hash: hashPassword(req.body.password) });
  res.json({ id });
});
r.put('/users/:id', requireRole('admin'), (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) throw notFound('Team member');
  const d = pick(req.body, ['name', 'email', 'phone', 'role', 'color', 'hourly_cost', 'licence_no', 'active']);
  if ((target.role === 'owner' || d.role === 'owner') && req.user.role !== 'owner') throw new HttpError(403, 'Only the owner can change an owner');
  if (target.role === 'owner' && (d.role && d.role !== 'owner' || d.active === false || d.active === 0)) {
    const owners = db.prepare("SELECT COUNT(*) c FROM users WHERE role='owner' AND active=1").get().c;
    if (owners <= 1) throw bad('There must be at least one active owner');
  }
  if (req.body.password) d.password_hash = hashPassword(req.body.password);
  update('users', target.id, d);
  if (d.active === false || d.active === 0) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  res.json({ ok: true });
});

// ---------------- products & services ----------------
r.get('/products', (req, res) => {
  const all = req.query.all === '1';
  res.json(db.prepare(`SELECT * FROM products ${all ? '' : 'WHERE active = 1'} ORDER BY kind, name`).all());
});
r.post('/products', requireRole('office'), (req, res) => {
  const d = pick(req.body, ['name', 'description', 'kind', 'unit_price', 'unit_cost', 'taxable', 'active']);
  if (!d.name) throw bad('Name is required');
  res.json({ id: insert('products', d) });
});
r.put('/products/:id', requireRole('office'), (req, res) => {
  update('products', req.params.id, pick(req.body, ['name', 'description', 'kind', 'unit_price', 'unit_cost', 'taxable', 'active']));
  res.json({ ok: true });
});
r.delete('/products/:id', requireRole('office'), (req, res) => {
  update('products', req.params.id, { active: 0 });
  res.json({ ok: true });
});

// ---------------- global search ----------------
r.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const like = `%${q}%`;
  const num = /^\d+$/.test(q.replace('#', '')) ? Number(q.replace('#', '')) : -1;
  const out = [];
  db.prepare(`SELECT * FROM clients WHERE first_name LIKE ? OR last_name LIKE ? OR company_name LIKE ? OR email LIKE ? OR phone LIKE ?
    OR (first_name || ' ' || last_name) LIKE ? LIMIT 8`).all(like, like, like, like, like, like)
    .forEach((c) => out.push({ type: 'client', id: c.id, title: clientName(c), subtitle: c.email || c.phone || c.status, url: `/clients/${c.id}` }));
  db.prepare(`SELECT p.*, c.first_name, c.last_name, c.company_name FROM properties p JOIN clients c ON c.id = p.client_id
    WHERE p.street LIKE ? OR p.city LIKE ? OR p.postcode LIKE ? LIMIT 5`).all(like, like, like)
    .forEach((p) => out.push({ type: 'property', id: p.id, title: [p.street, p.city].filter(Boolean).join(', '), subtitle: clientName(p), url: `/clients/${p.client_id}` }));
  db.prepare('SELECT r.*, c.first_name, c.last_name, c.company_name FROM requests r JOIN clients c ON c.id = r.client_id WHERE r.title LIKE ? LIMIT 5').all(like)
    .forEach((x) => out.push({ type: 'request', id: x.id, title: x.title, subtitle: clientName(x), url: `/requests/${x.id}` }));
  db.prepare('SELECT q.*, c.first_name, c.last_name, c.company_name FROM quotes q JOIN clients c ON c.id = q.client_id WHERE q.title LIKE ? OR q.number = ? LIMIT 5').all(like, num)
    .forEach((x) => out.push({ type: 'quote', id: x.id, title: `Quote #${x.number} · ${x.title}`, subtitle: clientName(x), url: `/quotes/${x.id}` }));
  db.prepare('SELECT j.*, c.first_name, c.last_name, c.company_name FROM jobs j JOIN clients c ON c.id = j.client_id WHERE j.title LIKE ? OR j.number = ? LIMIT 5').all(like, num)
    .forEach((x) => out.push({ type: 'job', id: x.id, title: `Job #${x.number} · ${x.title}`, subtitle: clientName(x), url: `/jobs/${x.id}` }));
  if (isOffice(req.user)) {
    db.prepare('SELECT i.*, c.first_name, c.last_name, c.company_name FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.subject LIKE ? OR i.number = ? LIMIT 5').all(like, num)
      .forEach((x) => out.push({ type: 'invoice', id: x.id, title: `Invoice #${x.number} · ${x.subject}`, subtitle: clientName(x), url: `/invoices/${x.id}` }));
  }
  res.json(out);
});

// ---------------- notes (internal, any record) ----------------
const NOTE_PARENTS = ['client', 'request', 'quote', 'job', 'invoice'];
r.get('/notes/:type/:id', (req, res) => {
  res.json(db.prepare(`SELECT n.*, u.name user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id
    WHERE parent_type = ? AND parent_id = ? ORDER BY n.created_at DESC`).all(req.params.type, req.params.id));
});
r.post('/notes/:type/:id', (req, res) => {
  if (!NOTE_PARENTS.includes(req.params.type)) throw bad('Invalid note target');
  if (!String(req.body.body || '').trim()) throw bad('Note is empty');
  const id = insert('notes', { parent_type: req.params.type, parent_id: Number(req.params.id), user_id: req.user.id, body: req.body.body });
  res.json({ id });
});
r.delete('/notes/:id', (req, res) => {
  const n = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!n) throw notFound('Note');
  if (n.user_id !== req.user.id && !isOffice(req.user)) throw new HttpError(403, 'You can only delete your own notes');
  db.prepare('DELETE FROM notes WHERE id = ?').run(n.id);
  res.json({ ok: true });
});

// ---------------- attachments ----------------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${token(8)}${path.extname(file.originalname).toLowerCase().slice(0, 10)}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});
const ATTACH_PARENTS = ['client', 'request', 'quote', 'job', 'invoice', 'expense'];
r.get('/attachments/:type/:id', (req, res) => {
  res.json(db.prepare('SELECT * FROM attachments WHERE parent_type = ? AND parent_id = ? ORDER BY created_at DESC').all(req.params.type, req.params.id));
});
r.post('/attachments/:type/:id', upload.array('files', 10), (req, res) => {
  if (!ATTACH_PARENTS.includes(req.params.type)) throw bad('Invalid attachment target');
  for (const f of req.files || []) {
    insert('attachments', { parent_type: req.params.type, parent_id: Number(req.params.id), filename: f.originalname, stored_name: f.filename, mime: f.mimetype, size: f.size, user_id: req.user.id });
  }
  res.json({ ok: true, count: (req.files || []).length });
});
r.get('/files/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!a) throw notFound('File');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(a.filename)}"`);
  res.type(a.mime || 'application/octet-stream');
  res.sendFile(path.join(UPLOAD_DIR, a.stored_name));
});
r.delete('/attachments/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!a) throw notFound('File');
  db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
  fs.rm(path.join(UPLOAD_DIR, a.stored_name), { force: true }, () => {});
  res.json({ ok: true });
});

// ---------------- activity feed ----------------
r.get('/activity', (req, res) => {
  const where = req.query.client_id ? 'WHERE a.client_id = ?' : '';
  const args = req.query.client_id ? [req.query.client_id] : [];
  res.json(db.prepare(`SELECT a.*, u.name user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id ${where} ORDER BY a.id DESC LIMIT ${Math.min(Number(req.query.limit) || 30, 200)}`).all(...args));
});

// ---------------- outbox ----------------
r.get('/outbox', requireRole('office'), (_req, res) => {
  res.json(db.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 200').all());
});

// ---------------- full data export (backup) ----------------
r.get('/export', requireRole('admin'), (_req, res) => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('sessions','_migrations')").all().map((t) => t.name);
  const out = { exported_at: nowIso() };
  for (const t of tables) {
    out[t] = db.prepare(`SELECT * FROM ${t}`).all().map((row) => { if (t === 'users') delete row.password_hash; return row; });
  }
  res.setHeader('Content-Disposition', `attachment; filename="voltline-export-${today()}.json"`);
  res.json(out);
});

export default r;
