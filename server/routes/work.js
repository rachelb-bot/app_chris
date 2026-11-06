import { Router } from 'express';
import { db, getSettings, nextNumber, logActivity } from '../db.js';
import { requireRole, isOffice } from '../auth.js';
import { HttpError, bad, notFound, pick, insert, update, clientName, token, today, addDays, nowIso,
  getLineItems, replaceLineItems, copyLineItems, computeTotals, jobDisplayStatus } from '../lib.js';
import { getClient, promoteLead } from './crm.js';
import { sendEmail } from '../mailer.js';
import { formatMoney, hubUrl } from '../format.js';

const r = Router();
export const DEFAULT_CHECKLIST = ['Safe isolation confirmed', 'Test results recorded', 'Certificate issued to client'];

// ======================= QUOTE TEMPLATES =======================
r.get('/quote-templates', (_req, res) => {
  res.json(db.prepare('SELECT * FROM quote_templates ORDER BY name').all().map((t) => ({ ...t, items: JSON.parse(t.items || '[]') })));
});
r.post('/quote-templates', requireRole('office'), (req, res) => {
  const d = pick(req.body, ['name', 'title', 'intro']);
  if (!d.name) throw bad('Template name is required');
  res.json({ id: insert('quote_templates', { ...d, items: JSON.stringify(req.body.items || []) }) });
});
r.put('/quote-templates/:id', requireRole('office'), (req, res) => {
  const d = pick(req.body, ['name', 'title', 'intro']);
  if (req.body.items) d.items = JSON.stringify(req.body.items);
  update('quote_templates', req.params.id, d);
  res.json({ ok: true });
});
r.delete('/quote-templates/:id', requireRole('office'), (req, res) => {
  db.prepare('DELETE FROM quote_templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ======================= QUOTES =======================
const QUOTE_FIELDS = ['client_id', 'property_id', 'request_id', 'title', 'intro', 'discount', 'tax_rate', 'deposit', 'client_message', 'terms', 'valid_until'];

export function getQuote(id) {
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  if (!q) throw notFound('Quote');
  q.client = getClient(q.client_id);
  q.property = q.client.properties.find((p) => p.id === q.property_id) || q.client.properties[0] || null;
  q.items = getLineItems('quote', q.id);
  q.totals = computeTotals(q.items, q);
  q.jobs = db.prepare('SELECT id, number, title FROM jobs WHERE quote_id = ?').all(q.id);
  return q;
}

r.get('/quotes', requireRole('office'), (req, res) => {
  const { status, q } = req.query;
  const where = [], args = [];
  if (status && status !== 'all') { where.push('q.status = ?'); args.push(status); } else if (!status) where.push("q.status != 'archived'");
  if (q) { where.push('(q.title LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.company_name LIKE ? OR q.number = ?)'); args.push(...Array(4).fill(`%${q}%`), Number(q) || -1); }
  const rows = db.prepare(`SELECT q.*, c.first_name, c.last_name, c.company_name FROM quotes q JOIN clients c ON c.id = q.client_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.id DESC`).all(...args);
  res.json(rows.map((x) => ({ ...x, client_name: clientName(x), ...computeTotals(getLineItems('quote', x.id), x) })));
});

r.get('/quotes/:id', requireRole('office'), (req, res) => res.json(getQuote(req.params.id)));

r.post('/quotes', requireRole('office'), (req, res) => {
  const s = getSettings();
  const d = pick(req.body, QUOTE_FIELDS);
  for (const k of Object.keys(d)) if (d[k] == null) delete d[k]; // keep defaults for blank fields
  if (!d.client_id) throw bad('Select a client');
  if (!d.title) throw bad('Quote title is required');
  const id = db.transaction(() => {
    const qid = insert('quotes', {
      tax_rate: Number(s.tax_rate) || 0, terms: s.quote_terms, valid_until: addDays(today(), s.quote_valid_days || 30),
      ...d, number: nextNumber('quote'), public_token: token(), created_by: req.user.id,
    });
    replaceLineItems('quote', qid, req.body.items);
    if (d.request_id) db.prepare("UPDATE requests SET status = 'converted' WHERE id = ?").run(d.request_id);
    logActivity({ userId: req.user.id, entityType: 'quote', entityId: qid, clientId: d.client_id, action: 'created', summary: `Quote "${d.title}" created` });
    return qid;
  })();
  res.json({ id });
});

r.put('/quotes/:id', requireRole('office'), (req, res) => {
  const q = getQuote(req.params.id);
  const d = pick(req.body, [...QUOTE_FIELDS, 'status']);
  db.transaction(() => {
    update('quotes', q.id, d);
    if (req.body.items) replaceLineItems('quote', q.id, req.body.items);
    if (d.status && d.status !== q.status) {
      if (d.status === 'approved') { update('quotes', q.id, { approved_at: nowIso() }); promoteLead(q.client_id); }
      logActivity({ userId: req.user.id, entityType: 'quote', entityId: q.id, clientId: q.client_id, action: d.status, summary: `Quote #${q.number} marked ${d.status.replace('_', ' ')}` });
    }
  })();
  res.json({ ok: true });
});

r.delete('/quotes/:id', requireRole('office'), (req, res) => {
  db.prepare('DELETE FROM quotes WHERE id = ?').run(req.params.id);
  db.prepare("DELETE FROM line_items WHERE parent_type='quote' AND parent_id = ?").run(req.params.id);
  res.json({ ok: true });
});

r.post('/quotes/:id/send', requireRole('office'), async (req, res) => {
  const q = getQuote(req.params.id);
  const s = getSettings();
  const to = req.body.to || q.client.email;
  if (!to) throw bad('This client has no email address. Add one, or copy the client link instead.');
  const link = hubUrl(req, `/hub/quote/${q.public_token}`);
  const body = req.body.message || `Hi ${q.client.first_name || q.client.name},\n\nThank you for asking us to quote for "${q.title}". Your quote #${q.number} comes to ${formatMoney(q.totals.total, s)}.\n\nYou can view and approve it online here:\n${link}\n\nKind regards,\n${s.company_name}`;
  const result = await sendEmail({ to, subject: req.body.subject || `Quote #${q.number} from ${s.company_name}`, body, relatedType: 'quote', relatedId: q.id });
  if (result.status === 'failed') throw new HttpError(502, `Email failed: ${result.error}`);
  db.transaction(() => {
    update('quotes', q.id, { status: ['draft', 'changes_requested'].includes(q.status) ? 'sent' : q.status, sent_at: nowIso() });
    logActivity({ userId: req.user.id, entityType: 'quote', entityId: q.id, clientId: q.client_id, action: 'sent', summary: `Quote #${q.number} sent to ${to}` });
  })();
  res.json({ ok: true, delivery: result.status, link });
});

/** Quote → Job (only the selected optional items are carried over). */
r.post('/quotes/:id/convert', requireRole('office'), (req, res) => {
  const q = getQuote(req.params.id);
  const id = db.transaction(() => {
    const jid = insert('jobs', {
      number: nextNumber('job'), client_id: q.client_id, property_id: q.property?.id || null, quote_id: q.id,
      title: q.title, instructions: q.intro, start_date: today(),
    });
    copyLineItems('quote', q.id, 'job', jid, { onlySelected: true });
    DEFAULT_CHECKLIST.forEach((label, i) => insert('checklist_items', { job_id: jid, label, sort: i }));
    update('quotes', q.id, { status: 'converted', approved_at: q.approved_at || nowIso() });
    promoteLead(q.client_id);
    logActivity({ userId: req.user.id, entityType: 'job', entityId: jid, clientId: q.client_id, action: 'created', summary: `Job created from quote #${q.number}` });
    return jid;
  })();
  res.json({ id });
});

r.post('/quotes/:id/duplicate', requireRole('office'), (req, res) => {
  const q = getQuote(req.params.id);
  const id = db.transaction(() => {
    const nid = insert('quotes', { ...pick(q, QUOTE_FIELDS), title: `${q.title} (copy)`, number: nextNumber('quote'), public_token: token(), created_by: req.user.id });
    copyLineItems('quote', q.id, 'quote', nid);
    return nid;
  })();
  res.json({ id });
});

// ======================= JOBS =======================
const JOB_FIELDS = ['client_id', 'property_id', 'quote_id', 'title', 'instructions', 'job_type', 'recurrence', 'billing', 'start_date', 'end_date', 'certificate_no'];

function assignees(visitId) {
  return db.prepare('SELECT u.id, u.name, u.color FROM visit_assignments va JOIN users u ON u.id = va.user_id WHERE va.visit_id = ?').all(visitId);
}
function setAssignees(visitId, userIds = []) {
  db.prepare('DELETE FROM visit_assignments WHERE visit_id = ?').run(visitId);
  const st = db.prepare('INSERT OR IGNORE INTO visit_assignments (visit_id, user_id) VALUES (?, ?)');
  for (const u of userIds) st.run(visitId, Number(u));
}

export function getJob(id) {
  const j = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!j) throw notFound('Job');
  j.client = getClient(j.client_id);
  j.property = j.client.properties.find((p) => p.id === j.property_id) || j.client.properties[0] || null;
  j.items = getLineItems('job', j.id);
  j.totals = computeTotals(j.items, { tax_rate: Number(getSettings().tax_rate) });
  j.visits = db.prepare('SELECT * FROM visits WHERE job_id = ? ORDER BY start_at').all(j.id).map((v) => ({ ...v, assignees: assignees(v.id) }));
  j.checklist = db.prepare('SELECT c.*, u.name done_by_name FROM checklist_items c LEFT JOIN users u ON u.id = c.done_by WHERE job_id = ? ORDER BY sort, id').all(j.id);
  j.invoices = db.prepare('SELECT id, number, subject, status FROM invoices WHERE job_id = ?').all(j.id);
  j.quote = j.quote_id ? db.prepare('SELECT id, number, title FROM quotes WHERE id = ?').get(j.quote_id) : null;
  j.display_status = jobDisplayStatus(j);
  // job costing
  j.labour = db.prepare(`SELECT COALESCE(SUM((julianday(COALESCE(t.end_at, ?)) - julianday(t.start_at)) * 24), 0) hours,
      COALESCE(SUM((julianday(COALESCE(t.end_at, ?)) - julianday(t.start_at)) * 24 * u.hourly_cost), 0) cost
    FROM time_entries t JOIN users u ON u.id = t.user_id WHERE t.job_id = ?`).get(nowIso(), nowIso(), j.id);
  j.expenses = db.prepare('SELECT * FROM expenses WHERE job_id = ? ORDER BY date DESC').all(j.id);
  j.expense_total = j.expenses.reduce((s, e) => s + e.amount, 0);
  j.profit = j.totals.subtotal - j.totals.cost - j.labour.cost - j.expense_total;
  return j;
}

r.get('/jobs', (req, res) => {
  const { status, q } = req.query;
  const where = [], args = [];
  if (q) { where.push('(j.title LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.company_name LIKE ? OR j.number = ?)'); args.push(...Array(4).fill(`%${q}%`), Number(q) || -1); }
  if (!isOffice(req.user)) { where.push('EXISTS (SELECT 1 FROM visits v JOIN visit_assignments va ON va.visit_id = v.id WHERE v.job_id = j.id AND va.user_id = ?)'); args.push(req.user.id); }
  const rows = db.prepare(`SELECT j.*, c.first_name, c.last_name, c.company_name,
      (SELECT MIN(start_at) FROM visits v WHERE v.job_id = j.id AND v.status = 'scheduled') next_visit
    FROM jobs j JOIN clients c ON c.id = j.client_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY j.id DESC`).all(...args);
  let out = rows.map((j) => ({ ...j, client_name: clientName(j), display_status: jobDisplayStatus(j), ...computeTotals(getLineItems('job', j.id)) }));
  if (status && status !== 'all') out = out.filter((j) => j.display_status === status);
  else if (!status) out = out.filter((j) => j.display_status !== 'archived');
  res.json(out);
});

r.get('/jobs/:id', (req, res) => {
  const j = getJob(req.params.id);
  if (!isOffice(req.user)) { delete j.totals; delete j.profit; delete j.labour; j.items = j.items.map(({ unit_price, unit_cost, ...rest }) => rest); }
  res.json(j);
});

r.post('/jobs', requireRole('office'), (req, res) => {
  const d = pick(req.body, JOB_FIELDS);
  if (!d.client_id) throw bad('Select a client');
  if (!d.title) throw bad('Job title is required');
  const id = db.transaction(() => {
    const jid = insert('jobs', { ...d, number: nextNumber('job'), start_date: d.start_date || today() });
    replaceLineItems('job', jid, req.body.items);
    for (const v of req.body.visits || []) createVisit(jid, v, d.title);
    (req.body.checklist || []).forEach((label, i) => label && insert('checklist_items', { job_id: jid, label, sort: i }));
    if (req.body.request_id) db.prepare("UPDATE requests SET status = 'converted' WHERE id = ?").run(req.body.request_id);
    promoteLead(d.client_id);
    logActivity({ userId: req.user.id, entityType: 'job', entityId: jid, clientId: d.client_id, action: 'created', summary: `Job "${d.title}" created` });
    return jid;
  })();
  res.json({ id });
});

r.put('/jobs/:id', requireRole('office'), (req, res) => {
  const j = getJob(req.params.id);
  const d = pick(req.body, [...JOB_FIELDS, 'status']);
  db.transaction(() => {
    if (d.status === 'completed' && j.status !== 'completed') d.completed_at = nowIso();
    if (d.status === 'active') d.completed_at = null;
    update('jobs', j.id, d);
    if (req.body.items) replaceLineItems('job', j.id, req.body.items);
    if (d.status && d.status !== j.status) logActivity({ userId: req.user.id, entityType: 'job', entityId: j.id, clientId: j.client_id, action: d.status, summary: `Job #${j.number} marked ${d.status}` });
  })();
  res.json({ ok: true });
});

/** Close a job: completes all remaining visits and marks the job completed. */
r.post('/jobs/:id/complete', (req, res) => {
  const j = getJob(req.params.id);
  db.transaction(() => {
    db.prepare("UPDATE visits SET status = 'completed', completed_at = ? WHERE job_id = ? AND status = 'scheduled'").run(nowIso(), j.id);
    update('jobs', j.id, { status: 'completed', completed_at: nowIso() });
    logActivity({ userId: req.user.id, entityType: 'job', entityId: j.id, clientId: j.client_id, action: 'completed', summary: `Job #${j.number} completed` });
  })();
  res.json({ ok: true });
});

r.delete('/jobs/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
  db.prepare("DELETE FROM line_items WHERE parent_type='job' AND parent_id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---- checklist ----
r.post('/jobs/:id/checklist', (req, res) => {
  if (!req.body.label) throw bad('Checklist item is empty');
  const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 s FROM checklist_items WHERE job_id = ?').get(req.params.id).s;
  res.json({ id: insert('checklist_items', { job_id: Number(req.params.id), label: req.body.label, sort }) });
});
r.put('/checklist/:id', (req, res) => {
  const done = req.body.done ? 1 : 0;
  update('checklist_items', req.params.id, { done, done_by: done ? req.user.id : null, done_at: done ? nowIso() : null, ...(req.body.label ? { label: req.body.label } : {}) });
  res.json({ ok: true });
});
r.delete('/checklist/:id', (req, res) => { db.prepare('DELETE FROM checklist_items WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

// ======================= VISITS & SCHEDULE =======================
function createVisit(jobId, v, fallbackTitle) {
  if (!v.start_at) throw bad('Visit start time is required');
  const end = v.end_at && v.end_at > v.start_at ? v.end_at : new Date(new Date(v.start_at).getTime() + 2 * 3600e3).toISOString();
  const vid = insert('visits', { job_id: jobId, title: v.title || fallbackTitle, start_at: v.start_at, end_at: end, anytime: v.anytime ? 1 : 0, instructions: v.instructions || null });
  setAssignees(vid, v.assignees || []);
  return vid;
}

r.post('/jobs/:id/visits', requireRole('office'), (req, res) => {
  const j = getJob(req.params.id);
  const ids = db.transaction(() => {
    const out = [createVisit(j.id, req.body, j.title)];
    // optional repeat: { repeat: 'weekly'|'monthly', occurrences: n }
    const n = Math.min(Number(req.body.occurrences) || 1, 104);
    for (let i = 1; i < n; i++) {
      const shift = (d) => { const x = new Date(d); if (req.body.repeat === 'monthly') x.setMonth(x.getMonth() + i); else x.setDate(x.getDate() + 7 * i); return x.toISOString(); };
      out.push(createVisit(j.id, { ...req.body, start_at: shift(req.body.start_at), end_at: shift(req.body.end_at || req.body.start_at) }, j.title));
    }
    if (j.status === 'completed') update('jobs', j.id, { status: 'active', completed_at: null });
    return out;
  })();
  res.json({ ids });
});

r.put('/visits/:id', (req, res) => {
  const v = db.prepare('SELECT * FROM visits WHERE id = ?').get(req.params.id);
  if (!v) throw notFound('Visit');
  const assigned = db.prepare('SELECT 1 FROM visit_assignments WHERE visit_id = ? AND user_id = ?').get(v.id, req.user.id);
  if (!isOffice(req.user) && !assigned) throw new HttpError(403, 'You can only update your own visits');
  // technicians can only change completion status
  const d = isOffice(req.user) ? pick(req.body, ['title', 'start_at', 'end_at', 'anytime', 'instructions', 'status']) : pick(req.body, ['status']);
  if (d.status === 'completed' && v.status !== 'completed') d.completed_at = nowIso();
  if (d.status === 'scheduled') d.completed_at = null;
  db.transaction(() => {
    update('visits', v.id, d);
    if (isOffice(req.user) && req.body.assignees) setAssignees(v.id, req.body.assignees);
    if (d.status) {
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(v.job_id);
      logActivity({ userId: req.user.id, entityType: 'job', entityId: job.id, clientId: job.client_id, action: 'visit_' + d.status, summary: `Visit on job #${job.number} marked ${d.status}` });
    }
  })();
  res.json({ ok: true });
});

r.delete('/visits/:id', requireRole('office'), (req, res) => {
  db.prepare('DELETE FROM visits WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/** Calendar feed: visits + request assessments in a date range. */
r.get('/schedule', (req, res) => {
  const from = req.query.from || today();
  const to = req.query.to || addDays(from, 7);
  const userFilter = req.query.user_id ? Number(req.query.user_id) : (!isOffice(req.user) ? req.user.id : null);
  const visits = db.prepare(`SELECT v.*, j.number job_number, j.title job_title, j.client_id, c.first_name, c.last_name, c.company_name,
      p.street, p.city
    FROM visits v JOIN jobs j ON j.id = v.job_id JOIN clients c ON c.id = j.client_id
    LEFT JOIN properties p ON p.id = j.property_id
    WHERE v.start_at < ? AND v.end_at >= ? AND j.status != 'archived' ORDER BY v.start_at`).all(to + 'T23:59:59.999Z', from + 'T00:00:00.000Z')
    .map((v) => ({ ...v, kind: 'visit', client_name: clientName(v), assignees: assignees(v.id) }))
    .filter((v) => !userFilter || (req.query.user_id === 'unassigned' ? !v.assignees.length : v.assignees.some((a) => a.id === userFilter)));
  const assessments = db.prepare(`SELECT r.id, r.title, r.assessment_start start_at, r.assessment_end end_at, r.assigned_to, r.client_id,
      c.first_name, c.last_name, c.company_name
    FROM requests r JOIN clients c ON c.id = r.client_id
    WHERE r.assessment_start IS NOT NULL AND r.assessment_start < ? AND COALESCE(r.assessment_end, r.assessment_start) >= ? AND r.status != 'archived'`)
    .all(to + 'T23:59:59.999Z', from + 'T00:00:00.000Z')
    .map((a) => ({ ...a, kind: 'assessment', end_at: a.end_at || new Date(new Date(a.start_at).getTime() + 3600e3).toISOString(), client_name: clientName(a),
      assignees: a.assigned_to ? [db.prepare('SELECT id, name, color FROM users WHERE id = ?').get(a.assigned_to)].filter(Boolean) : [] }))
    .filter((a) => !userFilter || a.assignees.some((u) => u.id === userFilter));
  res.json([...visits, ...assessments]);
});

/** Unscheduled jobs that need a visit (for the schedule sidebar). */
r.get('/schedule/unscheduled', requireRole('office'), (_req, res) => {
  const rows = db.prepare(`SELECT j.*, c.first_name, c.last_name, c.company_name FROM jobs j JOIN clients c ON c.id = j.client_id
    WHERE j.status = 'active' AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.job_id = j.id AND v.status = 'scheduled') ORDER BY j.id DESC`).all();
  res.json(rows.map((j) => ({ ...j, client_name: clientName(j) })));
});

export default r;
