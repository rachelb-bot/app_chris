import { Router } from 'express';
import { db, getSettings } from '../db.js';
import { requireRole, isOffice } from '../auth.js';
import { bad, notFound, pick, insert, update, clientName, today, addDays, nowIso, round2,
  getLineItems, computeTotals, invoiceTotals, invoiceDisplayStatus, jobDisplayStatus } from '../lib.js';
import { sendEmail } from '../mailer.js';

const r = Router();
const office = requireRole('office');

function allInvoices() {
  return db.prepare("SELECT * FROM invoices WHERE status != 'void'").all().map((i) => { const t = invoiceTotals(i); return { ...i, ...t, display_status: invoiceDisplayStatus(i, t) }; });
}
const startOfWeek = (d = new Date()) => { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); x.setUTCDate(x.getUTCDate() - x.getUTCDay()); return x.toISOString().slice(0, 10); };

// ======================= HOME DASHBOARD =======================
r.get('/dashboard', (req, res) => {
  const d = req.query.date || today();
  const now = nowIso();
  const mine = !isOffice(req.user);
  let visits = db.prepare(`SELECT v.*, j.number job_number, j.title job_title, j.client_id, c.first_name, c.last_name, c.company_name, p.street, p.city
    FROM visits v JOIN jobs j ON j.id = v.job_id JOIN clients c ON c.id = j.client_id LEFT JOIN properties p ON p.id = j.property_id
    WHERE substr(v.start_at, 1, 10) <= ? AND substr(v.end_at, 1, 10) >= ? ORDER BY v.start_at`).all(d, d)
    .map((v) => ({ ...v, client_name: clientName(v), assignees: db.prepare('SELECT u.id, u.name, u.color FROM visit_assignments va JOIN users u ON u.id = va.user_id WHERE va.visit_id = ?').all(v.id) }));
  if (mine) visits = visits.filter((v) => v.assignees.some((a) => a.id === req.user.id));
  const appt = {
    total: visits.length,
    active: visits.filter((v) => v.status === 'scheduled' && v.start_at <= now && v.end_at >= now).length,
    completed: visits.filter((v) => v.status === 'completed').length,
    overdue: visits.filter((v) => v.status === 'scheduled' && v.end_at < now).length,
    remaining: visits.filter((v) => v.status === 'scheduled' && v.start_at > now).length,
  };
  const out = { date: d, appointments: appt, visits };
  if (isOffice(req.user)) {
    const inv = allInvoices();
    const receivable = inv.filter((i) => ['awaiting_payment', 'overdue', 'partial'].includes(i.display_status));
    const wk = startOfWeek();
    const wkEnd = addDays(wk, 6);
    const monthStart = today().slice(0, 8) + '01';
    const upcoming = db.prepare(`SELECT COUNT(DISTINCT j.id) c FROM visits v JOIN jobs j ON j.id = v.job_id WHERE v.status='scheduled' AND substr(v.start_at,1,10) BETWEEN ? AND ?`).get(wk, wkEnd).c;
    const upcomingValue = db.prepare(`SELECT DISTINCT j.id FROM visits v JOIN jobs j ON j.id = v.job_id WHERE v.status='scheduled' AND substr(v.start_at,1,10) BETWEEN ? AND ?`).all(wk, wkEnd)
      .reduce((s, j) => s + computeTotals(getLineItems('job', j.id)).subtotal, 0);
    out.performance = {
      receivables: { clients: new Set(receivable.map((i) => i.client_id)).size, amount: round2(receivable.reduce((s, i) => s + i.balance, 0)) },
      upcoming_jobs: { count: upcoming, value: round2(upcomingValue), from: wk, to: wkEnd },
      revenue_month: round2(db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE paid_on >= ?').get(monthStart).s),
    };
    const jobs = db.prepare("SELECT * FROM jobs WHERE status != 'archived'").all().map((j) => ({ ...j, display_status: jobDisplayStatus(j) }));
    out.todo = {
      new_requests: db.prepare("SELECT COUNT(*) c FROM requests WHERE status = 'new'").get().c,
      assessments_today: db.prepare("SELECT COUNT(*) c FROM requests WHERE substr(assessment_start,1,10) = ? AND status != 'archived'").get(d).c,
      assessments_overdue: db.prepare("SELECT COUNT(*) c FROM requests WHERE status = 'assessment' AND COALESCE(assessment_end, assessment_start) < ?").get(now).c,
      quotes_approved: db.prepare("SELECT COUNT(*) c FROM quotes WHERE status = 'approved'").get().c,
      quotes_changes: db.prepare("SELECT COUNT(*) c FROM quotes WHERE status = 'changes_requested'").get().c,
      quotes_draft: db.prepare("SELECT COUNT(*) c FROM quotes WHERE status = 'draft'").get().c,
      jobs_requires_invoicing: jobs.filter((j) => j.display_status === 'requires_invoicing').length,
      jobs_late: jobs.filter((j) => j.display_status === 'late').length,
      jobs_unscheduled: jobs.filter((j) => j.display_status === 'unscheduled').length,
      invoices_overdue: inv.filter((i) => i.display_status === 'overdue').length,
      invoices_draft: inv.filter((i) => i.display_status === 'draft').length,
      timesheets_pending: db.prepare('SELECT COUNT(*) c FROM time_entries WHERE approved = 0 AND end_at IS NOT NULL').get().c,
    };
    out.workflow = {
      requests: db.prepare("SELECT status, COUNT(*) c FROM requests GROUP BY status").all(),
      quotes: db.prepare("SELECT status, COUNT(*) c FROM quotes GROUP BY status").all(),
      jobs: Object.entries(jobs.reduce((a, j) => ((a[j.display_status] = (a[j.display_status] || 0) + 1), a), {})).map(([status, c]) => ({ status, c })),
      invoices: Object.entries(inv.reduce((a, i) => ((a[i.display_status] = (a[i.display_status] || 0) + 1), a), {})).map(([status, c]) => ({ status, c })),
    };
  }
  res.json(out);
});

// ======================= INSIGHTS =======================
r.get('/insights', office, (req, res) => {
  const from = req.query.from || today().slice(0, 8) + '01';
  const to = req.query.to || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw bad('Invalid date range');
  // dates are stored as ISO or sqlite datetime strings; both start with YYYY-MM-DD so half-open ranges work
  const range = (col) => `${col} >= '${from}' AND ${col} < '${addDays(to, 1)}'`;
  const c = (sql) => db.prepare(sql).get().c;
  const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / 864e5) + 1);
  const pFrom = addDays(from, -days);
  const prange = (col) => `${col} >= '${pFrom}' AND ${col} < '${from}'`;
  const pair = (fn) => ({ value: fn(range), previous: fn(prange) });

  const invoicedValue = (rg) => round2(db.prepare(`SELECT * FROM invoices WHERE status != 'void' AND status != 'draft' AND ${rg('issue_date')}`).all().reduce((s, i) => s + invoiceTotals(i).total, 0));
  const overview = {
    new_leads: pair((rg) => c(`SELECT COUNT(*) c FROM clients WHERE ${rg('created_at')}`)),
    new_requests: pair((rg) => c(`SELECT COUNT(*) c FROM requests WHERE ${rg('created_at')}`)),
    converted_quotes: pair((rg) => c(`SELECT COUNT(*) c FROM quotes WHERE approved_at IS NOT NULL AND ${rg('approved_at')}`)),
    new_one_off_jobs: pair((rg) => c(`SELECT COUNT(*) c FROM jobs WHERE job_type = 'one_off' AND ${rg('created_at')}`)),
    new_recurring_jobs: pair((rg) => c(`SELECT COUNT(*) c FROM jobs WHERE job_type = 'recurring' AND ${rg('created_at')}`)),
    invoiced_value: pair(invoicedValue),
  };

  // revenue (payments received) by month for the last 12 months
  const revenue = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i);
    const ym = d.toISOString().slice(0, 7);
    revenue.push({ month: ym, amount: round2(db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE substr(paid_on,1,7) = ?').get(ym).s) });
  }

  // profit & loss on recent jobs
  const jobRows = db.prepare(`SELECT j.*, c.first_name, c.last_name, c.company_name FROM jobs j JOIN clients c ON c.id = j.client_id
    WHERE j.job_type = 'one_off' AND j.status != 'archived' ORDER BY COALESCE(j.completed_at, j.created_at) DESC LIMIT 40`).all();
  const pl = jobRows.map((j) => {
    const t = computeTotals(getLineItems('job', j.id));
    const labour = db.prepare(`SELECT COALESCE(SUM((julianday(COALESCE(t.end_at, ?)) - julianday(t.start_at)) * 24 * u.hourly_cost),0) s
      FROM time_entries t JOIN users u ON u.id = t.user_id WHERE t.job_id = ?`).get(nowIso(), j.id).s;
    const expenses = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE job_id = ?').get(j.id).s + t.cost;
    const profit = t.subtotal - labour - expenses;
    return { id: j.id, number: j.number, title: j.title, client_name: clientName(j), status: j.status, total: t.subtotal, labour: round2(labour), expenses: round2(expenses), profit: round2(profit), margin: t.subtotal ? round2((profit / t.subtotal) * 100) : 0 };
  });

  // cashflow
  const inv = allInvoices();
  const open = inv.filter((i) => ['awaiting_payment', 'overdue', 'partial'].includes(i.display_status));
  const t0 = today(), t7 = addDays(t0, 7);
  const paidInvoices = inv.filter((i) => i.status === 'paid' && i.paid_at && i.paid_at >= addDays(t0, -30));
  const avgDays = (arr) => arr.length ? round2(arr.reduce((s, i) => s + (new Date(i.paid_at) - new Date(i.issue_date)) / 864e5, 0) / arr.length) : null;
  const clientType = db.prepare('SELECT client_type FROM clients WHERE id = ?');
  const cashflow = {
    receivables: { amount: round2(open.reduce((s, i) => s + i.balance, 0)), clients: new Set(open.map((i) => i.client_id)).size },
    due_today: round2(open.filter((i) => i.due_date <= t0).reduce((s, i) => s + i.balance, 0)),
    due_7: round2(open.filter((i) => i.due_date > t0 && i.due_date <= t7).reduce((s, i) => s + i.balance, 0)),
    payment_time_commercial: avgDays(paidInvoices.filter((i) => clientType.get(i.client_id)?.client_type === 'commercial')),
    payment_time_residential: avgDays(paidInvoices.filter((i) => clientType.get(i.client_id)?.client_type !== 'commercial')),
  };

  // lead conversion (90 days)
  const since90 = addDays(t0, -90);
  const leads = db.prepare('SELECT id, created_at FROM clients WHERE created_at >= ?').all(since90);
  const withQuote = leads.filter((l) => db.prepare("SELECT 1 FROM quotes WHERE client_id = ? AND sent_at IS NOT NULL").get(l.id));
  const withJob = leads.filter((l) => db.prepare('SELECT 1 FROM jobs WHERE client_id = ?').get(l.id));
  const convTimes = withJob.map((l) => (new Date(db.prepare('SELECT MIN(created_at) m FROM jobs WHERE client_id = ?').get(l.id).m) - new Date(l.created_at)) / 864e5);
  const approvals = db.prepare("SELECT sent_at, approved_at FROM quotes WHERE approved_at IS NOT NULL AND sent_at IS NOT NULL AND approved_at >= ?").all(addDays(t0, -30));
  const conversion = {
    lead_conversion_days: convTimes.length ? round2(convTimes.reduce((a, b) => a + b, 0) / convTimes.length) : null,
    quote_approval_days: approvals.length ? round2(approvals.reduce((s, q) => s + (new Date(q.approved_at) - new Date(q.sent_at)) / 864e5, 0) / approvals.length) : null,
    funnel: [{ label: 'New leads', value: leads.length }, { label: 'Leads with sent quote', value: withQuote.length }, { label: 'Leads with job created', value: withJob.length }],
  };

  // scheduled job value per week (next 4 weeks)
  const wk = startOfWeek();
  const scheduled = [0, 1, 2, 3].map((i) => {
    const a = addDays(wk, i * 7), b = addDays(a, 6);
    const ids = db.prepare(`SELECT DISTINCT j.id FROM visits v JOIN jobs j ON j.id = v.job_id WHERE v.status='scheduled' AND substr(v.start_at,1,10) BETWEEN ? AND ?`).all(a, b);
    return { week: a, value: round2(ids.reduce((s, j) => s + computeTotals(getLineItems('job', j.id)).subtotal, 0)) };
  });
  const jobsInRange = db.prepare(`SELECT * FROM jobs WHERE ${range('created_at')}`).all().map((j) => ({ ...j, value: computeTotals(getLineItems('job', j.id)).subtotal }));
  const sumBy = (type) => round2(jobsInRange.filter((j) => j.job_type === type).reduce((s, j) => s + j.value, 0));
  const avgBy = (type) => { const a = jobsInRange.filter((j) => j.job_type === type); return a.length ? round2(a.reduce((s, j) => s + j.value, 0) / a.length) : null; };
  const jobsSection = {
    scheduled,
    mix: { one_off: sumBy('one_off'), recurring: sumBy('recurring') },
    avg: { one_off: avgBy('one_off'), recurring: avgBy('recurring') },
  };

  // lead sources
  const sources = db.prepare(`SELECT COALESCE(NULLIF(lead_source,''),'Unknown') source, COUNT(*) c FROM clients WHERE created_at >= ? GROUP BY 1 ORDER BY c DESC`).all(since90);

  // revenue (payments received in range) by lead source, by area and by payment method
  const paid = db.prepare(`SELECT p.amount, p.method, c.lead_source,
      COALESCE(ip.city, (SELECT city FROM properties WHERE client_id = c.id ORDER BY id LIMIT 1)) city
    FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN clients c ON c.id = i.client_id
    LEFT JOIN properties ip ON ip.id = i.property_id
    WHERE p.paid_on >= ? AND p.paid_on <= ?`).all(from, to);
  const group = (key, fallback) => Object.entries(paid.reduce((acc, x) => { const k = (x[key] || '').trim() || fallback; acc[k] = (acc[k] || 0) + x.amount; return acc; }, {}))
    .map(([label, value]) => ({ label, value: round2(value) })).sort((a, b) => b.value - a.value);
  const METHOD = { bank_transfer: 'Bank transfer', card: 'Card', cash: 'Cash', cheque: 'Cheque', other: 'Other' };
  const revenueBySource = group('lead_source', 'Unknown');
  const revenueByArea = group('city', 'No address').slice(0, 12);
  const paymentMethods = group('method', 'other').map((m) => ({ ...m, label: METHOD[m.label] || m.label }));

  // quote performance: quotes sent in range, and how many of those were won
  const sent = db.prepare(`SELECT * FROM quotes WHERE sent_at IS NOT NULL AND ${range('sent_at')}`).all()
    .map((q) => ({ ...q, total: computeTotals(getLineItems('quote', q.id), q).total }));
  const won = sent.filter((q) => ['approved', 'converted'].includes(q.status));
  const quotes = {
    sent_count: sent.length, sent_value: round2(sent.reduce((a, q) => a + q.total, 0)),
    won_count: won.length, won_value: round2(won.reduce((a, q) => a + q.total, 0)),
    conversion_rate: sent.length ? Math.round((won.length / sent.length) * 100) : null,
  };

  res.json({ from, to, overview, revenue, pl, cashflow, conversion, jobs: jobsSection, sources, revenueBySource, revenueByArea, paymentMethods, quotes });
});

// ======================= MARKETING =======================
function audienceClients(audience) {
  let rows;
  if (audience === 'leads') rows = db.prepare("SELECT * FROM clients WHERE status = 'lead'").all();
  else if (audience === 'active') rows = db.prepare("SELECT * FROM clients WHERE status = 'active'").all();
  else if (audience?.startsWith('tag:')) rows = db.prepare('SELECT * FROM clients WHERE tags LIKE ?').all(`%"${audience.slice(4)}"%`);
  else if (audience === 'past') rows = db.prepare("SELECT * FROM clients c WHERE status = 'active' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.client_id = c.id AND j.created_at >= datetime('now','-12 months'))").all();
  else rows = db.prepare("SELECT * FROM clients WHERE status != 'archived'").all();
  return rows.filter((c) => c.email);
}

r.get('/campaigns', office, (_req, res) => res.json(db.prepare('SELECT * FROM campaigns ORDER BY id DESC').all()));
r.get('/campaigns/audience', office, (req, res) => res.json({ count: audienceClients(req.query.audience).length }));
r.post('/campaigns', office, (req, res) => {
  const d = pick(req.body, ['name', 'subject', 'body', 'audience']);
  if (!d.name || !d.subject || !d.body) throw bad('Name, subject and message are required');
  res.json({ id: insert('campaigns', d) });
});
r.put('/campaigns/:id', office, (req, res) => {
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!c) throw notFound('Campaign');
  if (c.status === 'sent') throw bad('This campaign has already been sent');
  update('campaigns', c.id, pick(req.body, ['name', 'subject', 'body', 'audience']));
  res.json({ ok: true });
});
r.delete('/campaigns/:id', office, (req, res) => { db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id); res.json({ ok: true }); });
r.post('/campaigns/:id/send', office, async (req, res) => {
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!c) throw notFound('Campaign');
  if (c.status === 'sent') throw bad('This campaign has already been sent');
  const s = getSettings();
  const recipients = audienceClients(c.audience);
  let failed = 0;
  for (const cl of recipients) {
    const body = c.body.replaceAll('{first_name}', cl.first_name || 'there').replaceAll('{company}', s.company_name);
    const r2 = await sendEmail({ to: cl.email, subject: c.subject, body, relatedType: 'campaign', relatedId: c.id });
    if (r2.status === 'failed') failed++;
  }
  update('campaigns', c.id, { status: 'sent', sent_at: nowIso(), recipients: recipients.length - failed });
  res.json({ ok: true, recipients: recipients.length, failed });
});

r.get('/referrals', office, (_req, res) => {
  const rows = db.prepare(`SELECT r.*, a.first_name a_first, a.last_name a_last, a.company_name a_company, b.first_name b_first, b.last_name b_last, b.company_name b_company
    FROM referrals r LEFT JOIN clients a ON a.id = r.referrer_client_id LEFT JOIN clients b ON b.id = r.referred_client_id ORDER BY r.id DESC`).all();
  res.json(rows.map((x) => ({ ...x,
    referrer_name: clientName({ first_name: x.a_first, last_name: x.a_last, company_name: x.a_company }),
    referred_name: clientName({ first_name: x.b_first, last_name: x.b_last, company_name: x.b_company }) })));
});
r.post('/referrals', office, (req, res) => {
  const d = pick(req.body, ['referrer_client_id', 'referred_client_id', 'reward']);
  if (!d.referrer_client_id || !d.referred_client_id) throw bad('Choose both clients');
  res.json({ id: insert('referrals', d) });
});
r.put('/referrals/:id', office, (req, res) => { update('referrals', req.params.id, pick(req.body, ['reward', 'status'])); res.json({ ok: true }); });
r.delete('/referrals/:id', office, (req, res) => { db.prepare('DELETE FROM referrals WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

export default r;
