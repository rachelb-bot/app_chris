import { Router } from 'express';
import { db, getSettings, nextNumber, logActivity } from '../db.js';
import { requireRole, isOffice } from '../auth.js';
import { HttpError, bad, notFound, pick, insert, update, clientName, token, today, addDays, nowIso, round2,
  getLineItems, replaceLineItems, copyLineItems, invoiceTotals, invoiceDisplayStatus, parseCustom } from '../lib.js';
import { getClient } from './crm.js';
import { sendEmail } from '../mailer.js';
import { formatMoney, hubUrl } from '../format.js';

const r = Router();
const office = requireRole('office');

// ======================= INVOICES =======================
const INVOICE_FIELDS = ['client_id', 'property_id', 'job_id', 'subject', 'issue_date', 'due_date', 'discount', 'tax_rate', 'client_message', 'notes', 'terms', 'show_quantities', 'show_unit_prices', 'show_line_totals', 'custom'];

export function getInvoice(id) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!inv) throw notFound('Invoice');
  inv.client = getClient(inv.client_id);
  inv.property = inv.client.properties.find((p) => p.id === inv.property_id) || inv.client.properties[0] || null;
  inv.items = getLineItems('invoice', inv.id);
  inv.totals = invoiceTotals(inv);
  inv.display_status = invoiceDisplayStatus(inv, inv.totals);
  inv.payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_on').all(inv.id);
  parseCustom(inv);
  inv.job = inv.job_id ? db.prepare('SELECT id, number, title FROM jobs WHERE id = ?').get(inv.job_id) : null;
  return inv;
}

function listInvoices(where = '', args = []) {
  return db.prepare(`SELECT i.*, c.first_name, c.last_name, c.company_name FROM invoices i JOIN clients c ON c.id = i.client_id ${where} ORDER BY i.id DESC`)
    .all(...args).map((i) => { const t = invoiceTotals(i); return { ...i, ...t, client_name: clientName(i), display_status: invoiceDisplayStatus(i, t) }; });
}

r.get('/invoices', office, (req, res) => {
  const { status, q } = req.query;
  const where = [], args = [];
  if (q) { where.push('(i.subject LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.company_name LIKE ? OR i.number = ?)'); args.push(...Array(4).fill(`%${q}%`), Number(q) || -1); }
  let rows = listInvoices(where.length ? 'WHERE ' + where.join(' AND ') : '', args);
  if (status && status !== 'all') rows = rows.filter((i) => i.display_status === status || (status === 'unpaid' && ['awaiting_payment', 'overdue', 'partial'].includes(i.display_status)));
  res.json(rows);
});

r.get('/invoices/stats', office, (_req, res) => {
  const all = listInvoices();
  const sum = (arr, k = 'balance') => round2(arr.reduce((s, i) => s + i[k], 0));
  const overdue = all.filter((i) => i.display_status === 'overdue');
  const awaiting = all.filter((i) => ['awaiting_payment', 'partial'].includes(i.display_status));
  const drafts = all.filter((i) => i.display_status === 'draft');
  const since30 = addDays(today(), -30);
  const paid30 = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE paid_on >= ?').get(since30).s;
  res.json({
    overdue: { count: overdue.length, amount: sum(overdue) },
    awaiting: { count: awaiting.length, amount: sum(awaiting) },
    draft: { count: drafts.length, amount: sum(drafts, 'total') },
    paid_30: round2(paid30),
  });
});

r.get('/invoices/:id', office, (req, res) => res.json(getInvoice(req.params.id)));

r.post('/invoices', office, (req, res) => {
  const s = getSettings();
  const d = pick(req.body, INVOICE_FIELDS);
  for (const k of Object.keys(d)) if (d[k] == null) delete d[k];
  let items = req.body.items;
  if (d.job_id && !d.client_id) d.client_id = db.prepare('SELECT client_id FROM jobs WHERE id = ?').get(d.job_id)?.client_id;
  if (!d.client_id) throw bad('Select a client');
  const job = d.job_id ? db.prepare('SELECT * FROM jobs WHERE id = ?').get(d.job_id) : null;
  const id = db.transaction(() => {
    const issue = d.issue_date || today();
    const iid = insert('invoices', {
      tax_rate: Number(s.tax_rate) || 0, client_message: s.invoice_message, terms: s.invoice_terms, subject: job?.title || 'For services rendered',
      property_id: job?.property_id || null,
      ...d, issue_date: issue, due_date: d.due_date || addDays(issue, s.invoice_terms_days || 14), number: nextNumber('invoice'), public_token: token(),
    });
    if (items) replaceLineItems('invoice', iid, items);
    else if (job) copyLineItems('job', job.id, 'invoice', iid);
    const fromQuote = job?.quote_id && db.prepare('SELECT show_quantities, show_unit_prices, show_line_totals FROM quotes WHERE id = ?').get(job.quote_id);
    if (fromQuote && !('show_quantities' in d)) update('invoices', iid, fromQuote);
    logActivity({ userId: req.user.id, entityType: 'invoice', entityId: iid, clientId: d.client_id, action: 'created', summary: `Invoice created${job ? ` for job #${job.number}` : ''}` });
    return iid;
  })();
  res.json({ id });
});

r.put('/invoices/:id', office, (req, res) => {
  const inv = getInvoice(req.params.id);
  const d = pick(req.body, [...INVOICE_FIELDS, 'status']);
  db.transaction(() => {
    if (d.status === 'paid' && inv.status !== 'paid') {
      d.paid_at = nowIso();
      if (inv.totals.balance > 0) insert('payments', { invoice_id: inv.id, amount: inv.totals.balance, method: req.body.method || 'other', paid_on: today(), reference: 'Marked as paid' });
    }
    update('invoices', inv.id, d);
    if (req.body.items) replaceLineItems('invoice', inv.id, req.body.items);
    if (d.status && d.status !== inv.status) logActivity({ userId: req.user.id, entityType: 'invoice', entityId: inv.id, clientId: inv.client_id, action: d.status, summary: `Invoice #${inv.number} marked ${d.status}` });
  })();
  res.json({ ok: true });
});

r.delete('/invoices/:id', requireRole('admin'), (req, res) => {
  const inv = getInvoice(req.params.id);
  if (inv.status !== 'draft') throw bad('Only draft invoices can be deleted. Void it instead.');
  db.prepare('DELETE FROM invoices WHERE id = ?').run(inv.id);
  db.prepare("DELETE FROM line_items WHERE parent_type='invoice' AND parent_id = ?").run(inv.id);
  res.json({ ok: true });
});

r.post('/invoices/:id/send', office, async (req, res) => {
  const inv = getInvoice(req.params.id);
  const s = getSettings();
  const to = req.body.to || inv.client.email;
  if (!to) throw bad('This client has no email address. Add one, or copy the client link instead.');
  const link = hubUrl(req, `/hub/invoice/${inv.public_token}`);
  const body = req.body.message || `Hi ${inv.client.first_name || inv.client.name},\n\nPlease find invoice #${inv.number} for "${inv.subject}".\nAmount due: ${formatMoney(inv.totals.balance, s)} by ${inv.due_date}.\n\nView your invoice online:\n${link}\n${s.bank_details ? `\nBank details:\n${s.bank_details}\n` : ''}\nThank you,\n${s.company_name}`;
  const result = await sendEmail({ to, subject: req.body.subject || `Invoice #${inv.number} from ${s.company_name}`, body, relatedType: 'invoice', relatedId: inv.id });
  if (result.status === 'failed') throw new HttpError(502, `Email failed: ${result.error}`);
  db.transaction(() => {
    update('invoices', inv.id, { status: inv.status === 'draft' ? 'sent' : inv.status, sent_at: nowIso() });
    logActivity({ userId: req.user.id, entityType: 'invoice', entityId: inv.id, clientId: inv.client_id, action: 'sent', summary: `Invoice #${inv.number} sent to ${to}` });
  })();
  res.json({ ok: true, delivery: result.status, link });
});

r.post('/invoices/:id/payments', office, (req, res) => {
  const inv = getInvoice(req.params.id);
  const amount = round2(req.body.amount);
  if (!(amount > 0)) throw bad('Enter a payment amount');
  db.transaction(() => {
    insert('payments', { invoice_id: inv.id, amount, method: req.body.method || 'bank_transfer', reference: req.body.reference || null, paid_on: req.body.paid_on || today() });
    const t = invoiceTotals(inv);
    update('invoices', inv.id, t.balance <= 0 ? { status: 'paid', paid_at: nowIso() } : { status: inv.status === 'draft' ? 'sent' : inv.status });
    logActivity({ userId: req.user.id, entityType: 'invoice', entityId: inv.id, clientId: inv.client_id, action: 'payment', summary: `Payment of ${formatMoney(amount)} recorded on invoice #${inv.number}` });
  })();
  res.json({ ok: true });
});

r.delete('/payments/:id', office, (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!p) throw notFound('Payment');
  db.transaction(() => {
    db.prepare('DELETE FROM payments WHERE id = ?').run(p.id);
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(p.invoice_id);
    if (inv.status === 'paid' && invoiceTotals(inv).balance > 0) update('invoices', inv.id, { status: 'sent', paid_at: null });
  })();
  res.json({ ok: true });
});

// ======================= EXPENSES =======================
const EXPENSE_FIELDS = ['title', 'description', 'category', 'amount', 'date', 'job_id', 'user_id', 'reimbursable', 'reimbursed', 'supplier'];

r.get('/expenses', (req, res) => {
  const where = [], args = [];
  if (!isOffice(req.user)) { where.push('e.user_id = ?'); args.push(req.user.id); }
  if (req.query.from) { where.push('e.date >= ?'); args.push(req.query.from); }
  if (req.query.to) { where.push('e.date <= ?'); args.push(req.query.to); }
  if (req.query.job_id) { where.push('e.job_id = ?'); args.push(req.query.job_id); }
  res.json(db.prepare(`SELECT e.*, u.name user_name, j.number job_number, j.title job_title,
      (SELECT COUNT(*) FROM attachments a WHERE a.parent_type='expense' AND a.parent_id = e.id) receipts
    FROM expenses e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN jobs j ON j.id = e.job_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.date DESC, e.id DESC`).all(...args));
});
r.post('/expenses', (req, res) => {
  const d = pick(req.body, EXPENSE_FIELDS);
  if (!d.title) throw bad('Expense title is required');
  if (!isOffice(req.user)) { d.user_id = req.user.id; delete d.reimbursed; }
  const id = insert('expenses', { user_id: req.user.id, ...d, amount: round2(d.amount), date: d.date || today() });
  res.json({ id });
});
r.put('/expenses/:id', (req, res) => {
  const e = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!e) throw notFound('Expense');
  if (!isOffice(req.user) && e.user_id !== req.user.id) throw new HttpError(403, 'Not your expense');
  const d = pick(req.body, EXPENSE_FIELDS);
  if (!isOffice(req.user)) { delete d.reimbursed; delete d.user_id; }
  if ('amount' in d) d.amount = round2(d.amount);
  update('expenses', e.id, d);
  res.json({ ok: true });
});
r.delete('/expenses/:id', (req, res) => {
  const e = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!e) throw notFound('Expense');
  if (!isOffice(req.user) && e.user_id !== req.user.id) throw new HttpError(403, 'Not your expense');
  db.prepare('DELETE FROM expenses WHERE id = ?').run(e.id);
  res.json({ ok: true });
});

// ======================= TIMESHEETS =======================
const hoursSql = "(julianday(COALESCE(t.end_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))) - julianday(t.start_at)) * 24";

r.get('/timesheets', (req, res) => {
  const from = req.query.from || today();
  const to = req.query.to || from;
  const where = ['t.start_at >= ?', 't.start_at <= ?'], args = [from + 'T00:00:00.000Z', to + 'T23:59:59.999Z'];
  if (!isOffice(req.user)) { where.push('t.user_id = ?'); args.push(req.user.id); }
  else if (req.query.user_id) { where.push('t.user_id = ?'); args.push(req.query.user_id); }
  if (req.query.approved === '0') where.push('t.approved = 0 AND t.end_at IS NOT NULL');
  res.json(db.prepare(`SELECT t.*, ${hoursSql} hours, u.name user_name, u.color, j.number job_number, j.title job_title, a.name approved_by_name
    FROM time_entries t JOIN users u ON u.id = t.user_id LEFT JOIN jobs j ON j.id = t.job_id LEFT JOIN users a ON a.id = t.approved_by
    WHERE ${where.join(' AND ')} ORDER BY t.start_at DESC`).all(...args));
});

r.get('/timesheets/current', (req, res) => {
  res.json(db.prepare(`SELECT t.*, j.number job_number, j.title job_title FROM time_entries t LEFT JOIN jobs j ON j.id = t.job_id
    WHERE t.user_id = ? AND t.end_at IS NULL ORDER BY t.start_at DESC LIMIT 1`).get(req.user.id) || null);
});

r.get('/timesheets/active', office, (_req, res) => {
  res.json(db.prepare(`SELECT t.*, u.name user_name, u.color, j.number job_number, j.title job_title FROM time_entries t JOIN users u ON u.id = t.user_id
    LEFT JOIN jobs j ON j.id = t.job_id WHERE t.end_at IS NULL ORDER BY t.start_at`).all());
});

r.post('/timesheets/clock-in', (req, res) => {
  const now = nowIso();
  db.transaction(() => {
    db.prepare('UPDATE time_entries SET end_at = ? WHERE user_id = ? AND end_at IS NULL').run(now, req.user.id);
    insert('time_entries', { user_id: req.user.id, job_id: req.body.job_id || null, start_at: now, notes: req.body.notes || null });
  })();
  res.json({ ok: true });
});

r.post('/timesheets/clock-out', (req, res) => {
  const changed = db.prepare('UPDATE time_entries SET end_at = ? WHERE user_id = ? AND end_at IS NULL').run(nowIso(), req.user.id).changes;
  if (!changed) throw bad('You are not clocked in');
  res.json({ ok: true });
});

r.post('/timesheets', (req, res) => {
  const d = pick(req.body, ['user_id', 'job_id', 'start_at', 'end_at', 'notes']);
  if (!isOffice(req.user) || !d.user_id) d.user_id = req.user.id;
  if (!d.start_at || !d.end_at) throw bad('Start and end times are required');
  if (d.end_at <= d.start_at) throw bad('End time must be after start time');
  res.json({ id: insert('time_entries', d) });
});

r.put('/timesheets/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(req.params.id);
  if (!t) throw notFound('Time entry');
  if (!isOffice(req.user) && (t.user_id !== req.user.id || t.approved)) throw new HttpError(403, 'You cannot edit this entry');
  const d = pick(req.body, ['job_id', 'start_at', 'end_at', 'notes']);
  if (isOffice(req.user) && 'approved' in req.body) { d.approved = req.body.approved ? 1 : 0; d.approved_by = req.body.approved ? req.user.id : null; }
  update('time_entries', t.id, d);
  res.json({ ok: true });
});

r.post('/timesheets/approve', office, (req, res) => {
  const ids = (req.body.ids || []).map(Number);
  const st = db.prepare('UPDATE time_entries SET approved = 1, approved_by = ? WHERE id = ? AND end_at IS NOT NULL');
  db.transaction(() => ids.forEach((id) => st.run(req.user.id, id)))();
  res.json({ ok: true, count: ids.length });
});

r.delete('/timesheets/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(req.params.id);
  if (!t) throw notFound('Time entry');
  if (!isOffice(req.user) && (t.user_id !== req.user.id || t.approved)) throw new HttpError(403, 'You cannot delete this entry');
  db.prepare('DELETE FROM time_entries WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

/** Payroll summary for a period: approved / unapproved hours and cost per team member, plus reimbursable expenses. */
r.get('/payroll', office, (req, res) => {
  const from = req.query.from || addDays(today(), -13);
  const to = req.query.to || today();
  const rows = db.prepare(`SELECT u.id, u.name, u.color, u.hourly_cost,
      COALESCE(SUM(CASE WHEN t.approved = 1 THEN ${hoursSql} END), 0) approved_hours,
      COALESCE(SUM(CASE WHEN t.approved = 0 THEN ${hoursSql} END), 0) pending_hours,
      COALESCE(SUM(CASE WHEN t.approved = 1 AND t.paid_at IS NULL THEN ${hoursSql} END), 0) unpaid_hours,
      COUNT(t.id) entries,
      (SELECT COALESCE(SUM(amount),0) FROM expenses e WHERE e.user_id = u.id AND e.reimbursable = 1 AND e.reimbursed = 0 AND e.date BETWEEN ? AND ?) reimbursements
    FROM users u LEFT JOIN time_entries t ON t.user_id = u.id AND t.end_at IS NOT NULL AND t.start_at >= ? AND t.start_at <= ?
    WHERE u.active = 1 GROUP BY u.id ORDER BY u.name`).all(from, to, from + 'T00:00:00.000Z', to + 'T23:59:59.999Z');
  res.json({ from, to, rows: rows.map((r) => {
    const status = !r.entries && !r.reimbursements ? 'none' : r.unpaid_hours > 0.001 || r.reimbursements > 0 ? 'unpaid' : r.pending_hours > 0.001 ? 'pending' : 'paid';
    return { ...r, gross: round2(r.approved_hours * r.hourly_cost), unpaid_gross: round2(r.unpaid_hours * r.hourly_cost), status };
  }) });
});

/** Mark a team member's approved hours and reimbursable expenses in a pay period as paid. */
r.post('/payroll/pay', office, (req, res) => {
  const { user_id, from, to } = req.body || {};
  if (!user_id || !from || !to) throw bad('Choose a team member and pay period');
  const now = nowIso();
  const out = db.transaction(() => ({
    hours: db.prepare('UPDATE time_entries SET paid_at = ? WHERE user_id = ? AND approved = 1 AND paid_at IS NULL AND end_at IS NOT NULL AND start_at >= ? AND start_at <= ?').run(now, user_id, from + 'T00:00:00.000Z', to + 'T23:59:59.999Z').changes,
    expenses: db.prepare('UPDATE expenses SET reimbursed = 1, reimbursed_at = ? WHERE user_id = ? AND reimbursable = 1 AND reimbursed = 0 AND date BETWEEN ? AND ?').run(now, user_id, from, to).changes,
  }))();
  const u = db.prepare('SELECT name FROM users WHERE id = ?').get(user_id);
  logActivity({ userId: req.user.id, entityType: 'payroll', entityId: Number(user_id), action: 'paid', summary: `Payroll marked paid for ${u?.name || 'team member'} (${from} – ${to})` });
  res.json({ ok: true, ...out });
});

export default r;
