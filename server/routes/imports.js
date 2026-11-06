import { Router } from 'express';
import { db, getSettings, nextNumber, logActivity } from '../db.js';
import { requireRole } from '../auth.js';
import { bad, insert, update, token, today, addDays, round2, replaceLineItems, invoiceTotals } from '../lib.js';

/**
 * Import existing quotes, jobs or invoices from another system (rows parsed from CSV in the browser).
 * Rows with the same document number become one document with several line items.
 */
const r = Router();

const QUOTE_STATUS = { draft: 'draft', sent: 'sent', awaiting: 'sent', 'awaiting response': 'sent', pending: 'sent', approved: 'approved', accepted: 'approved', won: 'approved', converted: 'converted', archived: 'archived', declined: 'archived', lost: 'archived', rejected: 'archived', expired: 'archived', 'changes requested': 'changes_requested' };
const JOB_STATUS = { active: 'active', open: 'active', scheduled: 'active', 'in progress': 'active', completed: 'completed', complete: 'completed', closed: 'completed', done: 'completed', finished: 'completed', archived: 'archived', cancelled: 'archived', canceled: 'archived' };
const INVOICE_STATUS = { draft: 'draft', sent: 'sent', unpaid: 'sent', outstanding: 'sent', 'awaiting payment': 'sent', overdue: 'sent', 'past due': 'sent', partial: 'sent', 'partially paid': 'sent', paid: 'paid', 'paid in full': 'paid', void: 'void', voided: 'void', cancelled: 'void', canceled: 'void', 'bad debt': 'void' };

const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
function isoDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s); // day/month/year (Ireland/UK)
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

function findOrCreateClient(row, counters) {
  const email = String(row.client_email || '').trim();
  const name = String(row.client_name || '').trim();
  let c = email ? db.prepare('SELECT * FROM clients WHERE email = ? COLLATE NOCASE').get(email) : null;
  if (!c && name) {
    c = db.prepare("SELECT * FROM clients WHERE company_name = ? COLLATE NOCASE OR (first_name || ' ' || COALESCE(last_name, '')) = ? COLLATE NOCASE OR (TRIM(first_name || ' ' || COALESCE(last_name, ''))) = ? COLLATE NOCASE").get(name, name, name);
  }
  if (c) return c.id;
  if (!name && !email) return null;
  const parts = name.split(/\s+/);
  const looksLikeCompany = /\b(ltd|limited|llc|inc|plc|group|company|co\.|services|management|properties|café|cafe|hotel|school)\b/i.test(name);
  const id = insert('clients', looksLikeCompany
    ? { company_name: name, email: email || null, phone: row.client_phone || null, status: 'active', client_type: 'commercial' }
    : { first_name: parts.shift() || email, last_name: parts.join(' ') || null, email: email || null, phone: row.client_phone || null, status: 'active' });
  if (row.address || row.city) insert('properties', { client_id: id, street: row.address || null, city: row.city || null, postcode: row.postcode || null });
  counters.clients++;
  return id;
}

function groupRows(rows) {
  const groups = new Map();
  rows.forEach((row, i) => {
    const key = String(row.number || '').trim() || `row-${i}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return [...groups.values()];
}

function itemsFrom(group) {
  const items = group.filter((r) => r.item || r.unit_price || r.line_total).map((r) => {
    const qty = r.quantity != null && r.quantity !== '' ? num(r.quantity) || 1 : 1;
    const unit = r.unit_price != null && r.unit_price !== '' ? num(r.unit_price) : num(r.line_total) / qty;
    return { name: String(r.item || r.title || 'Imported item').slice(0, 200), description: r.description || null, quantity: qty, unit_price: round2(unit) };
  });
  if (!items.length) {
    const total = num(group[0].total);
    items.push({ name: String(group[0].title || 'Imported total').slice(0, 200), description: group[0].description || null, quantity: 1, unit_price: total });
  }
  return items;
}

function takeNumber(kind, table, wanted) {
  const n = Number(String(wanted || '').replace(/[^0-9]/g, ''));
  if (n > 0 && n < 1e9 && !db.prepare(`SELECT 1 FROM ${table} WHERE number = ?`).get(n)) return n;
  return nextNumber(kind);
}

r.post('/import/:kind', requireRole('office'), (req, res) => {
  const kind = req.params.kind;
  if (!['quotes', 'jobs', 'invoices'].includes(kind)) throw bad('Unknown import type');
  const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 20000) : [];
  if (!rows.length) throw bad('The file has no rows to import');
  const s = getSettings();
  const taxRate = req.body.prices_include_tax ? 0 : Number(req.body.tax_rate ?? s.tax_rate) || 0;
  const counters = { created: 0, skipped: 0, clients: 0 };

  db.transaction(() => {
    for (const group of groupRows(rows)) {
      const first = group[0];
      const clientId = findOrCreateClient(first, counters);
      if (!clientId) { counters.skipped++; continue; }
      const items = itemsFrom(group);
      const date = isoDate(first.date) || today();
      const statusKey = String(first.status || '').trim().toLowerCase();
      const title = String(first.title || items[0].name || 'Imported').slice(0, 200);
      const created_at = `${date} 09:00:00`;
      const propertyId = db.prepare('SELECT id FROM properties WHERE client_id = ? ORDER BY id LIMIT 1').get(clientId)?.id || null;

      if (kind === 'quotes') {
        const status = QUOTE_STATUS[statusKey] || 'sent';
        const id = insert('quotes', {
          number: takeNumber('quote', 'quotes', first.number), client_id: clientId, property_id: propertyId, title, intro: first.notes || null,
          status, tax_rate: taxRate, public_token: token(), created_by: req.user.id, created_at,
          sent_at: status !== 'draft' ? `${date}T09:00:00.000Z` : null, approved_at: ['approved', 'converted'].includes(status) ? `${date}T09:00:00.000Z` : null,
          valid_until: addDays(date, s.quote_valid_days || 30),
        });
        replaceLineItems('quote', id, items);
      } else if (kind === 'jobs') {
        const status = JOB_STATUS[statusKey] || 'active';
        const id = insert('jobs', {
          number: takeNumber('job', 'jobs', first.number), client_id: clientId, property_id: propertyId, title, instructions: first.notes || null,
          status, start_date: date, created_at, completed_at: status === 'completed' ? `${date}T17:00:00.000Z` : null,
          billing: status === 'active' ? 'on_completion' : 'none', // past jobs don't need invoicing reminders
        });
        replaceLineItems('job', id, items.map((it) => ({ ...it })));
      } else {
        let status = INVOICE_STATUS[statusKey] || 'sent';
        const due = isoDate(first.due_date) || addDays(date, s.invoice_terms_days || 14);
        const id = insert('invoices', {
          number: takeNumber('invoice', 'invoices', first.number), client_id: clientId, property_id: propertyId, subject: title,
          status: status === 'paid' ? 'sent' : status, issue_date: date, due_date: due, tax_rate: taxRate, public_token: token(), created_at,
          sent_at: status !== 'draft' ? `${date}T09:00:00.000Z` : null, notes: first.notes || null,
        });
        replaceLineItems('invoice', id, items);
        const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
        const total = invoiceTotals(inv).total;
        const paidAmount = first.amount_paid != null && first.amount_paid !== '' ? Math.min(num(first.amount_paid), total) : status === 'paid' ? total : 0;
        if (paidAmount > 0) {
          const paidOn = isoDate(first.paid_date) || due;
          insert('payments', { invoice_id: id, amount: round2(paidAmount), method: 'other', reference: 'Imported', paid_on: paidOn });
          if (paidAmount >= total - 0.005) update('invoices', id, { status: 'paid', paid_at: `${paidOn}T12:00:00.000Z` });
        }
      }
      counters.created++;
    }
    logActivity({ userId: req.user.id, entityType: kind.slice(0, -1), action: 'imported', summary: `Imported ${counters.created} ${kind}${counters.clients ? ` (and ${counters.clients} new clients)` : ''}` });
  })();
  res.json(counters);
});

export default r;
