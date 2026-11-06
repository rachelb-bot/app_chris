import { Router } from 'express';
import { db, logActivity } from '../db.js';
import { requireRole } from '../auth.js';
import { syncDeal } from './pipeline.js';
import { queueGeocode } from '../geocode.js';
import { bad, notFound, pick, insert, update, clientName, formatAddress, getLineItems, replaceLineItems, computeTotals, invoiceTotals, invoiceDisplayStatus, jobDisplayStatus, parseCustom } from '../lib.js';

const r = Router();
const CLIENT_FIELDS = ['first_name', 'last_name', 'company_name', 'email', 'phone', 'status', 'client_type', 'lead_source', 'notes', 'custom'];
const PROPERTY_FIELDS = ['street', 'city', 'region', 'postcode', 'country', 'notes', 'lat', 'lng'];

export function getClient(id) {
  const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  if (!c) throw notFound('Client');
  c.tags = JSON.parse(c.tags || '[]');
  parseCustom(c);
  c.name = clientName(c);
  c.properties = db.prepare('SELECT * FROM properties WHERE client_id = ? ORDER BY id').all(id).map((p) => ({ ...p, address: formatAddress(p) }));
  return c;
}

/** Leads become active clients as soon as real work (a job or approved quote) exists. */
export function promoteLead(clientId) {
  db.prepare("UPDATE clients SET status = 'active', updated_at = datetime('now') WHERE id = ? AND status = 'lead'").run(clientId);
}

// ---------------- getting started checklist ----------------
r.get('/onboarding', (_req, res) => {
  const c = (sql) => db.prepare(sql).get().c;
  const s = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((x) => [x.key, x.value]));
  res.json([
    { key: 'company', label: 'Add your company details, VAT number and bank details', done: !!(s.company_phone && s.company_address && s.bank_details), url: '/settings/company' },
    { key: 'team', label: 'Add your electricians and office team', done: c('SELECT COUNT(*) c FROM users') > 1, url: '/settings/team' },
    { key: 'products', label: 'Check your prices in the products & services list', done: c("SELECT COUNT(*) c FROM products WHERE created_at > (SELECT MIN(created_at) FROM users)") > 0 || c('SELECT COUNT(*) c FROM line_items') > 0, url: '/settings/products' },
    { key: 'client', label: 'Add or import your clients', done: c('SELECT COUNT(*) c FROM clients') > 0, url: '/clients' },
    { key: 'quote', label: 'Send your first quote', done: c('SELECT COUNT(*) c FROM quotes WHERE sent_at IS NOT NULL') > 0, url: '/quotes/new' },
    { key: 'job', label: 'Schedule a job', done: c('SELECT COUNT(*) c FROM visits') > 0, url: '/jobs/new' },
    { key: 'invoice', label: 'Send an invoice', done: c('SELECT COUNT(*) c FROM invoices WHERE sent_at IS NOT NULL') > 0, url: '/invoices/new' },
    { key: 'payment', label: 'Record a payment', done: c('SELECT COUNT(*) c FROM payments') > 0, url: '/invoices' },
    { key: 'booking', label: 'Put your online booking form on your website', done: c("SELECT COUNT(*) c FROM requests WHERE source = 'Online booking'") > 0, url: '/marketing' },
  ]);
});

// ---------------- clients ----------------
r.get('/clients', (req, res) => {
  const { q, status, tag } = req.query;
  const where = [], args = [];
  if (status === 'leads_active' || !status) where.push("c.status IN ('lead','active')");
  else if (status !== 'all') { where.push('c.status = ?'); args.push(status); }
  if (q) {
    const like = `%${q}%`;
    where.push("(c.first_name LIKE ? OR c.last_name LIKE ? OR c.company_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR (c.first_name || ' ' || c.last_name) LIKE ? OR EXISTS (SELECT 1 FROM properties p WHERE p.client_id = c.id AND (p.street LIKE ? OR p.city LIKE ?)))");
    args.push(like, like, like, like, like, like, like, like);
  }
  if (tag) { where.push('c.tags LIKE ?'); args.push(`%"${tag}"%`); }
  const rows = db.prepare(`SELECT c.*,
      (SELECT MAX(x) FROM (SELECT MAX(created_at) x FROM activity WHERE client_id = c.id UNION SELECT c.updated_at)) last_activity
    FROM clients c ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.updated_at DESC LIMIT 500`).all(...args);
  const firstProp = db.prepare('SELECT * FROM properties WHERE client_id = ? ORDER BY id LIMIT 1');
  res.json(rows.map((c) => ({ ...c, tags: JSON.parse(c.tags || '[]'), name: clientName(c), address: formatAddress(firstProp.get(c.id)) })));
});

r.get('/clients/stats', (_req, res) => {
  const q = (sql) => db.prepare(sql).get().c;
  res.json({
    new_leads_30: q("SELECT COUNT(*) c FROM clients WHERE status='lead' AND created_at >= datetime('now','-30 days')"),
    new_leads_prev_30: q("SELECT COUNT(*) c FROM clients WHERE created_at >= datetime('now','-60 days') AND created_at < datetime('now','-30 days')"),
    new_clients_30: q("SELECT COUNT(*) c FROM clients WHERE status='active' AND created_at >= datetime('now','-30 days')"),
    total_new_ytd: q("SELECT COUNT(*) c FROM clients WHERE created_at >= strftime('%Y-01-01','now')"),
    tags: [...new Set(db.prepare('SELECT tags FROM clients').all().flatMap((r) => JSON.parse(r.tags || '[]')))].sort(),
  });
});

r.get('/clients/:id', (req, res) => {
  const c = getClient(req.params.id);
  const id = c.id;
  const invoices = db.prepare('SELECT * FROM invoices WHERE client_id = ? ORDER BY id DESC').all(id).map((i) => {
    const t = invoiceTotals(i);
    return { ...i, ...t, display_status: invoiceDisplayStatus(i, t) };
  });
  c.requests = db.prepare('SELECT * FROM requests WHERE client_id = ? ORDER BY id DESC').all(id);
  c.quotes = db.prepare('SELECT * FROM quotes WHERE client_id = ? ORDER BY id DESC').all(id)
    .map((q) => ({ ...q, ...computeTotals(getLineItems('quote', q.id), q) }));
  c.jobs = db.prepare('SELECT * FROM jobs WHERE client_id = ? ORDER BY id DESC').all(id)
    .map((j) => ({ ...j, display_status: jobDisplayStatus(j), ...computeTotals(getLineItems('job', j.id)) }));
  c.invoices = invoices;
  c.balance = invoices.filter((i) => !['void', 'draft'].includes(i.status)).reduce((s, i) => s + i.balance, 0);
  c.lifetime_value = invoices.filter((i) => i.status !== 'void').reduce((s, i) => s + i.paid, 0);
  c.upcoming_visits = db.prepare(`SELECT v.*, j.title job_title, j.number job_number FROM visits v JOIN jobs j ON j.id = v.job_id
    WHERE j.client_id = ? AND v.status = 'scheduled' ORDER BY v.start_at LIMIT 10`).all(id);
  res.json(c);
});

r.post('/clients', requireRole('office'), (req, res) => {
  const d = pick(req.body, CLIENT_FIELDS);
  if (!d.first_name && !d.last_name && !d.company_name) throw bad('Enter a name or company name');
  const id = db.transaction(() => {
    const cid = insert('clients', { ...d, status: d.status || 'lead', tags: JSON.stringify(req.body.tags || []) });
    const p = pick(req.body.property || {}, PROPERTY_FIELDS);
    if (Object.values(p).some(Boolean)) queueGeocode(insert('properties', { ...p, client_id: cid }));
    logActivity({ userId: req.user.id, entityType: 'client', entityId: cid, clientId: cid, action: 'created', summary: `Client ${clientName(d)} created` });
    return cid;
  })();
  res.json({ id });
});

r.put('/clients/:id', requireRole('office'), (req, res) => {
  getClient(req.params.id);
  const d = pick(req.body, CLIENT_FIELDS);
  if (req.body.tags) d.tags = JSON.stringify(req.body.tags);
  update('clients', req.params.id, { ...d, updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19) });
  res.json({ ok: true });
});

r.delete('/clients/:id', requireRole('admin'), (req, res) => {
  const c = getClient(req.params.id);
  const hasMoney = db.prepare("SELECT COUNT(*) c FROM invoices WHERE client_id = ? AND status != 'draft'").get(c.id).c;
  if (hasMoney) throw bad('This client has issued invoices. Archive the client instead of deleting.');
  db.prepare('DELETE FROM clients WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

/** Merge a duplicate client into this one: moves all records, then deletes the duplicate. */
r.post('/clients/:id/merge', requireRole('admin'), (req, res) => {
  const keep = getClient(req.params.id);
  const dup = getClient(req.body.duplicate_id);
  if (keep.id === dup.id) throw bad('Choose a different client to merge');
  db.transaction(() => {
    for (const t of ['properties', 'requests', 'quotes', 'jobs', 'invoices']) db.prepare(`UPDATE ${t} SET client_id = ? WHERE client_id = ?`).run(keep.id, dup.id);
    db.prepare("UPDATE notes SET parent_id = ? WHERE parent_type = 'client' AND parent_id = ?").run(keep.id, dup.id);
    db.prepare("UPDATE attachments SET parent_id = ? WHERE parent_type = 'client' AND parent_id = ?").run(keep.id, dup.id);
    db.prepare('UPDATE activity SET client_id = ? WHERE client_id = ?').run(keep.id, dup.id);
    const tags = [...new Set([...keep.tags, ...dup.tags])];
    const fill = {};
    for (const f of ['email', 'phone', 'company_name', 'lead_source']) if (!keep[f] && dup[f]) fill[f] = dup[f];
    update('clients', keep.id, { ...fill, tags: JSON.stringify(tags), status: keep.status === 'lead' && dup.status === 'active' ? 'active' : keep.status });
    db.prepare('DELETE FROM clients WHERE id = ?').run(dup.id);
    logActivity({ userId: req.user.id, entityType: 'client', entityId: keep.id, clientId: keep.id, action: 'merged', summary: `Merged duplicate ${dup.name} into this client` });
  })();
  res.json({ ok: true });
});

/** Bulk import clients (rows already parsed from CSV in the browser). Skips rows with no name. */
r.post('/clients/import', requireRole('office'), (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 5000) : [];
  let created = 0, skipped = 0, duplicates = 0;
  const byEmail = db.prepare('SELECT id FROM clients WHERE email = ? COLLATE NOCASE');
  db.transaction(() => {
    for (const row of rows) {
      const c = pick(row, CLIENT_FIELDS);
      if (!c.first_name && !c.last_name && !c.company_name) { skipped++; continue; }
      if (c.email && byEmail.get(c.email)) { duplicates++; continue; }
      const status = ['lead', 'active', 'archived'].includes(String(c.status || '').toLowerCase()) ? String(c.status).toLowerCase() : 'active';
      const type = String(c.client_type || '').toLowerCase().startsWith('com') ? 'commercial' : 'residential';
      const tags = String(row.tags || '').split(/[;,|]/).map((t) => t.trim()).filter(Boolean);
      const cid = insert('clients', { ...c, status, client_type: type, tags: JSON.stringify(tags) });
      const p = pick(row, PROPERTY_FIELDS);
      if (Object.values(p).some(Boolean)) insert('properties', { ...p, client_id: cid });
      created++;
    }
    if (created) logActivity({ userId: req.user.id, entityType: 'client', action: 'imported', summary: `Imported ${created} clients` });
  })();
  res.json({ created, skipped, duplicates });
});

// ---------------- properties ----------------
r.post('/clients/:id/properties', requireRole('office'), (req, res) => {
  getClient(req.params.id);
  const p = pick(req.body, PROPERTY_FIELDS);
  const id = insert('properties', { ...p, client_id: Number(req.params.id) });
  if (p.lat == null) queueGeocode(id);
  res.json({ id });
});
r.put('/properties/:id', requireRole('office'), (req, res) => {
  const p = pick(req.body, PROPERTY_FIELDS);
  const addressChanged = ['street', 'city', 'region', 'postcode', 'country'].some((k) => k in p);
  if (addressChanged && !('lat' in p)) { p.lat = null; p.lng = null; p.geocoded_at = null; }
  update('properties', req.params.id, p);
  if (addressChanged && p.lat == null) queueGeocode(Number(req.params.id));
  res.json({ ok: true });
});
r.delete('/properties/:id', requireRole('office'), (req, res) => {
  db.prepare('DELETE FROM properties WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------------- requests ----------------
const REQUEST_FIELDS = ['client_id', 'property_id', 'title', 'details', 'source', 'status', 'assessment_start', 'assessment_end', 'assigned_to', 'requested_on', 'custom'];

function getRequest(id) {
  const x = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
  if (!x) throw notFound('Request');
  x.client = getClient(x.client_id);
  x.property = x.property_id ? x.client.properties.find((p) => p.id === x.property_id) : x.client.properties[0];
  x.items = getLineItems('request', x.id);
  x.totals = computeTotals(x.items);
  x.quotes = db.prepare('SELECT id, number, title, status FROM quotes WHERE request_id = ?').all(x.id);
  parseCustom(x);
  x.assignee = x.assigned_to ? db.prepare('SELECT id, name, color FROM users WHERE id = ?').get(x.assigned_to) : null;
  return x;
}

r.get('/requests', (req, res) => {
  const { status, q } = req.query;
  const where = [], args = [];
  if (status && status !== 'all') { where.push('r.status = ?'); args.push(status); } else if (!status) where.push("r.status != 'archived'");
  if (q) { where.push("(r.title LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.company_name LIKE ?)"); args.push(...Array(4).fill(`%${q}%`)); }
  const rows = db.prepare(`SELECT r.*, c.first_name, c.last_name, c.company_name, c.phone, c.email FROM requests r JOIN clients c ON c.id = r.client_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE r.status WHEN 'new' THEN 0 WHEN 'assessment' THEN 1 ELSE 2 END, r.created_at DESC`).all(...args);
  res.json(rows.map((x) => ({ ...x, client_name: clientName(x) })));
});

r.get('/requests/:id', (req, res) => res.json(getRequest(req.params.id)));

r.post('/requests', requireRole('office'), (req, res) => {
  let d = pick(req.body, REQUEST_FIELDS);
  const id = db.transaction(() => {
    if (!d.client_id && req.body.new_client) {
      const nc = req.body.new_client;
      if (!nc.first_name && !nc.last_name && !nc.company_name) throw bad('Enter the client\'s name');
      d.client_id = insert('clients', { ...pick(nc, CLIENT_FIELDS), status: 'lead', lead_source: d.source || nc.lead_source || null });
      const p = pick(nc.property || {}, PROPERTY_FIELDS);
      if (Object.values(p).some(Boolean)) d.property_id = insert('properties', { ...p, client_id: d.client_id });
    }
    if (!d.client_id) throw bad('Select a client');
    if (!d.title) throw bad('Request title is required');
    if (d.assessment_start && (!d.status || d.status === 'new')) d.status = 'assessment';
    const rid = insert('requests', { ...d, requested_on: d.requested_on || new Date().toISOString().slice(0, 10) });
    replaceLineItems('request', rid, req.body.items);
    syncDeal({ clientId: d.client_id, requestId: rid, stage: d.status === 'assessment' ? 'assessment' : 'new', title: d.title, source: d.source, userId: req.user.id });
    logActivity({ userId: req.user.id, entityType: 'request', entityId: rid, clientId: d.client_id, action: 'created', summary: `Request "${d.title}" created` });
    return rid;
  })();
  res.json({ id });
});

r.put('/requests/:id', requireRole('office'), (req, res) => {
  const x = getRequest(req.params.id);
  const d = pick(req.body, REQUEST_FIELDS);
  if (d.assessment_start && x.status === 'new' && !d.status) d.status = 'assessment';
  db.transaction(() => {
    update('requests', x.id, d);
    if (req.body.items) replaceLineItems('request', x.id, req.body.items);
    if (d.assessment_start) syncDeal({ clientId: x.client_id, requestId: x.id, stage: 'assessment', title: x.title });
  })();
  res.json({ ok: true });
});

r.delete('/requests/:id', requireRole('office'), (req, res) => {
  db.prepare('DELETE FROM requests WHERE id = ?').run(req.params.id);
  db.prepare("DELETE FROM line_items WHERE parent_type='request' AND parent_id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default r;
