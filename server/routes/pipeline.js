import { Router } from 'express';
import { db, logActivity } from '../db.js';
import { requireRole } from '../auth.js';
import { bad, notFound, pick, insert, update, clientName, nowIso, getLineItems, computeTotals } from '../lib.js';

/** CRM sales pipeline: one deal per sales opportunity, from first enquiry to won/lost. */
const r = Router();
const office = requireRole('office');

export const STAGES = [
  { key: 'new', label: 'New lead' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'assessment', label: 'Assessment booked' },
  { key: 'quote_sent', label: 'Quote sent' },
  { key: 'follow_up', label: 'Follow-up / negotiation' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
];
const ORDER = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));
const sqlNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function stagePatch(stage, current) {
  if (stage === current) return {};
  return { stage, stage_changed_at: sqlNow(), won_at: stage === 'won' ? nowIso() : null, lost_at: stage === 'lost' ? nowIso() : null };
}

/**
 * Keeps the pipeline in step with real work. Finds the deal for a quote or request (or creates one)
 * and moves it forward to `stage`. Automatic moves never go backwards; "won" also overrides "lost".
 */
export function syncDeal({ clientId, requestId = null, quoteId = null, jobId = null, stage, value, title, source, userId }) {
  let deal = (quoteId && db.prepare('SELECT * FROM deals WHERE quote_id = ?').get(quoteId))
    || (requestId && db.prepare('SELECT * FROM deals WHERE request_id = ?').get(requestId))
    || (jobId && db.prepare('SELECT * FROM deals WHERE job_id = ?').get(jobId));
  if (!deal && quoteId) {
    const q = db.prepare('SELECT request_id FROM quotes WHERE id = ?').get(quoteId);
    if (q?.request_id) deal = db.prepare('SELECT * FROM deals WHERE request_id = ?').get(q.request_id);
  }
  if (!deal) {
    const id = insert('deals', { title: title || 'New opportunity', client_id: clientId, request_id: requestId, quote_id: quoteId, job_id: jobId, stage, value: value || 0, source: source || null, owner_id: userId || null, won_at: stage === 'won' ? nowIso() : null });
    return id;
  }
  const patch = { updated_at: sqlNow() };
  if (quoteId && !deal.quote_id) patch.quote_id = quoteId;
  if (requestId && !deal.request_id) patch.request_id = requestId;
  if (jobId && !deal.job_id) patch.job_id = jobId;
  if (value != null && value > 0) patch.value = value;
  const forward = ORDER[stage] > ORDER[deal.stage] && deal.stage !== 'lost' && deal.stage !== 'won';
  if (forward || (stage === 'won' && deal.stage !== 'won')) Object.assign(patch, stagePatch(stage, deal.stage));
  update('deals', deal.id, patch);
  return deal.id;
}

export function quoteValue(quoteId) {
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId);
  return q ? computeTotals(getLineItems('quote', q.id), q).total : 0;
}

/** One-off: creates deals for requests/quotes that existed before the pipeline did. */
export function backfillDeals() {
  if (db.prepare("SELECT value FROM settings WHERE key = '_deals_backfilled'").get()) return;
  db.transaction(() => {
    for (const rq of db.prepare('SELECT * FROM requests ORDER BY id').all()) {
      const stage = rq.status === 'archived' ? 'lost' : rq.status === 'assessment' ? 'assessment' : 'new';
      const id = syncDeal({ clientId: rq.client_id, requestId: rq.id, stage, title: rq.title, source: rq.source });
      update('deals', id, { created_at: rq.created_at });
    }
    for (const q of db.prepare('SELECT * FROM quotes ORDER BY id').all()) {
      if (q.status === 'draft' && !q.request_id) continue;
      const stage = ['approved', 'converted'].includes(q.status) ? 'won' : q.status === 'archived' ? 'lost' : q.status === 'changes_requested' ? 'follow_up' : q.status === 'sent' ? 'quote_sent' : 'new';
      const job = db.prepare('SELECT id FROM jobs WHERE quote_id = ?').get(q.id);
      const id = syncDeal({ clientId: q.client_id, quoteId: q.id, requestId: q.request_id, jobId: job?.id, stage, value: quoteValue(q.id), title: q.title });
      update('deals', id, { created_at: q.created_at });
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('_deals_backfilled', '1')").run();
  })();
}

function hydrate(d) {
  const c = d.client_id ? db.prepare('SELECT first_name, last_name, company_name, email, phone FROM clients WHERE id = ?').get(d.client_id) : null;
  return {
    ...d,
    client_name: c ? clientName(c) : '',
    client_phone: c?.phone || null,
    client_email: c?.email || null,
    owner: d.owner_id ? db.prepare('SELECT id, name, color FROM users WHERE id = ?').get(d.owner_id) || null : null,
    quote: d.quote_id ? db.prepare('SELECT id, number, status FROM quotes WHERE id = ?').get(d.quote_id) || null : null,
    request: d.request_id ? db.prepare('SELECT id, title, status FROM requests WHERE id = ?').get(d.request_id) || null : null,
    job: d.job_id ? db.prepare('SELECT id, number FROM jobs WHERE id = ?').get(d.job_id) || null : null,
    days_in_stage: Math.max(0, Math.floor((Date.now() - new Date(String(d.stage_changed_at).replace(' ', 'T') + (String(d.stage_changed_at).includes('T') ? '' : 'Z')).getTime()) / 864e5)),
  };
}

r.get('/pipeline', office, (req, res) => {
  backfillDeals();
  const where = [], args = [];
  if (req.query.owner_id) { where.push('owner_id = ?'); args.push(req.query.owner_id); }
  if (req.query.q) { where.push('(title LIKE ? OR client_id IN (SELECT id FROM clients WHERE first_name LIKE ? OR last_name LIKE ? OR company_name LIKE ?))'); args.push(...Array(4).fill(`%${req.query.q}%`)); }
  // closed deals only stay on the board for 60 days
  where.push("(stage NOT IN ('won','lost') OR stage_changed_at >= datetime('now','-60 days'))");
  const deals = db.prepare(`SELECT * FROM deals WHERE ${where.join(' AND ')} ORDER BY sort, updated_at DESC`).all(...args).map(hydrate);
  const open = deals.filter((d) => !['won', 'lost'].includes(d.stage));
  const since90 = "datetime('now','-90 days')";
  const won90 = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(value),0) v FROM deals WHERE stage = 'won' AND stage_changed_at >= ${since90}`).get();
  const lost90 = db.prepare(`SELECT COUNT(*) c FROM deals WHERE stage = 'lost' AND stage_changed_at >= ${since90}`).get();
  res.json({
    stages: STAGES,
    deals,
    summary: {
      open_count: open.length,
      open_value: open.reduce((s, d) => s + d.value, 0),
      won_90: won90.v, won_count_90: won90.c,
      win_rate_90: won90.c + lost90.c ? Math.round((won90.c / (won90.c + lost90.c)) * 100) : null,
      stale: open.filter((d) => d.days_in_stage >= 7).length,
    },
  });
});

r.get('/deals/:id', office, (req, res) => {
  const d = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!d) throw notFound('Deal');
  res.json(hydrate(d));
});

const FIELDS = ['title', 'client_id', 'value', 'owner_id', 'source', 'expected_close', 'next_step', 'next_step_at', 'lost_reason'];

r.post('/deals', office, (req, res) => {
  const d = pick(req.body, FIELDS);
  if (!d.title) throw bad('Give the opportunity a name');
  if (!d.client_id) throw bad('Choose a client');
  const stage = ORDER[req.body.stage] != null ? req.body.stage : 'new';
  const id = insert('deals', { ...d, stage, owner_id: d.owner_id || req.user.id, value: Number(d.value) || 0 });
  logActivity({ userId: req.user.id, entityType: 'deal', entityId: id, clientId: d.client_id, action: 'created', summary: `Opportunity "${d.title}" added to pipeline` });
  res.json({ id });
});

r.put('/deals/:id', office, (req, res) => {
  const d = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!d) throw notFound('Deal');
  const patch = { ...pick(req.body, FIELDS), updated_at: sqlNow() };
  if ('sort' in req.body) patch.sort = Number(req.body.sort) || 0;
  if (req.body.stage && ORDER[req.body.stage] != null && req.body.stage !== d.stage) {
    Object.assign(patch, stagePatch(req.body.stage, d.stage));
    const label = STAGES.find((s) => s.key === req.body.stage).label;
    logActivity({ userId: req.user.id, entityType: 'deal', entityId: d.id, clientId: d.client_id, action: 'stage', summary: `"${d.title}" moved to ${label}` });
  }
  update('deals', d.id, patch);
  res.json({ ok: true });
});

r.delete('/deals/:id', office, (req, res) => {
  db.prepare('DELETE FROM deals WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default r;
