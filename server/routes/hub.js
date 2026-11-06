import { Router } from 'express';
import { db, getSettings, logActivity } from '../db.js';
import { bad, notFound, insert, update, nowIso, getLineItems, computeTotals, formatAddress, clientName, invoiceTotals, invoiceDisplayStatus, getMilestones } from '../lib.js';
import path from 'node:path';
import { UPLOAD_DIR } from '../db.js';
import { promoteLead } from './crm.js';
import { syncDeal, quoteValue } from './pipeline.js';
import { sendEmail } from '../mailer.js';

/** Public client hub: no login, access by unguessable token only. */
const r = Router();

function company() {
  const s = getSettings();
  return { name: s.company_name, email: s.company_email, phone: s.company_phone, address: s.company_address, vat_no: s.vat_no, reg_no: s.company_reg_no,
    currency: s.currency, locale: s.locale, tax_label: s.tax_label, bank_details: s.bank_details };
}
function clientInfo(clientId, propertyId) {
  const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  const p = (propertyId && db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId)) || db.prepare('SELECT * FROM properties WHERE client_id = ? LIMIT 1').get(clientId);
  return { name: clientName(c), email: c.email, phone: c.phone, address: formatAddress(p) };
}
const publicItems = (items) => items.map(({ id, name, description, quantity, unit_price, optional, selected, is_text, image }) => ({ id, name, description, quantity, unit_price, optional, selected, is_text, image }));

/** Custom fields marked "show to client", as label/value pairs. */
function publicCustom(entity, raw) {
  let values = {};
  try { values = JSON.parse(raw || '{}'); } catch { /* ignore */ }
  return db.prepare('SELECT * FROM custom_fields WHERE entity = ? AND show_to_client = 1 AND active = 1 ORDER BY sort, id').all(entity)
    .map((f) => ({ label: f.label, type: f.field_type, value: values[f.id] }))
    .filter((f) => f.value !== undefined && f.value !== null && f.value !== '' && f.value !== false);
}
const publicFiles = (type, id) => db.prepare('SELECT id, filename, mime, size FROM attachments WHERE parent_type = ? AND parent_id = ? AND client_visible = 1 ORDER BY created_at').all(type, id);

function quoteByToken(t) {
  const q = db.prepare('SELECT * FROM quotes WHERE public_token = ?').get(t);
  if (!q || q.status === 'draft' || q.status === 'archived') throw notFound('Quote');
  return q;
}

r.get('/hub/quote/:token', (req, res) => {
  const q = quoteByToken(req.params.token);
  const items = getLineItems('quote', q.id);
  res.json({
    company: company(), client: clientInfo(q.client_id, q.property_id),
    quote: { number: q.number, title: q.title, intro: q.intro, status: q.status, created_at: q.created_at, valid_until: q.valid_until, terms: q.terms,
      client_message: q.client_message, deposit: q.deposit, discount: q.discount, tax_rate: q.tax_rate, approved_at: q.approved_at, client_signature: q.client_signature,
      show_quantities: q.show_quantities, show_unit_prices: q.show_unit_prices, show_line_totals: q.show_line_totals },
    items: publicItems(items), totals: computeTotals(items, q),
    milestones: getMilestones('quote', q.id).map(({ label, kind, value, due_date, amount }) => ({ label, kind, value, due_date, amount })),
    custom: publicCustom('quote', q.custom), files: publicFiles('quote', q.id),
  });
});

r.post('/hub/quote/:token/approve', (req, res) => {
  const q = quoteByToken(req.params.token);
  if (!['sent', 'changes_requested'].includes(q.status)) throw bad('This quote can no longer be approved online');
  const signature = String(req.body.signature || '').trim();
  if (!signature) throw bad('Please type your full name to approve');
  const selected = new Set((req.body.selected || []).map(Number));
  db.transaction(() => {
    for (const it of getLineItems('quote', q.id)) if (it.optional) update('line_items', it.id, { selected: selected.has(it.id) ? 1 : 0 });
    update('quotes', q.id, { status: 'approved', approved_at: nowIso(), client_signature: signature });
    promoteLead(q.client_id);
    syncDeal({ clientId: q.client_id, quoteId: q.id, requestId: q.request_id, stage: 'won', value: quoteValue(q.id), title: q.title });
    logActivity({ entityType: 'quote', entityId: q.id, clientId: q.client_id, action: 'approved', summary: `Quote #${q.number} approved online by ${signature}` });
  })();
  const s = getSettings();
  if (s.company_email) sendEmail({ to: s.company_email, subject: `Quote #${q.number} approved`, body: `${signature} approved quote #${q.number} "${q.title}".`, relatedType: 'quote', relatedId: q.id });
  res.json({ ok: true });
});

r.post('/hub/quote/:token/changes', (req, res) => {
  const q = quoteByToken(req.params.token);
  const msg = String(req.body.message || '').trim();
  if (!msg) throw bad('Tell us what you would like changed');
  db.transaction(() => {
    update('quotes', q.id, { status: 'changes_requested', client_feedback: msg });
    syncDeal({ clientId: q.client_id, quoteId: q.id, requestId: q.request_id, stage: 'follow_up', title: q.title });
    insert('notes', { parent_type: 'quote', parent_id: q.id, body: `Client requested changes: ${msg}` });
    logActivity({ entityType: 'quote', entityId: q.id, clientId: q.client_id, action: 'changes_requested', summary: `Client requested changes on quote #${q.number}` });
  })();
  res.json({ ok: true });
});

r.get('/hub/invoice/:token', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE public_token = ?').get(req.params.token);
  if (!inv || inv.status === 'draft') throw notFound('Invoice');
  const items = getLineItems('invoice', inv.id);
  const totals = invoiceTotals(inv);
  res.json({
    company: company(), client: clientInfo(inv.client_id, inv.property_id),
    invoice: { number: inv.number, subject: inv.subject, issue_date: inv.issue_date, due_date: inv.due_date, client_message: inv.client_message,
      discount: inv.discount, tax_rate: inv.tax_rate, status: invoiceDisplayStatus(inv, totals), terms: inv.terms,
      show_quantities: inv.show_quantities, show_unit_prices: inv.show_unit_prices, show_line_totals: inv.show_line_totals },
    items: publicItems(items), totals,
    payments: db.prepare('SELECT amount, method, paid_on FROM payments WHERE invoice_id = ? ORDER BY paid_on').all(inv.id),
    custom: publicCustom('invoice', inv.custom), files: publicFiles('invoice', inv.id),
  });
});

/** Download a file the office chose to share on a quote or invoice. */
r.get('/hub/:kind/:token/files/:fid', (req, res) => {
  const table = req.params.kind === 'quote' ? 'quotes' : req.params.kind === 'invoice' ? 'invoices' : null;
  if (!table) throw notFound('File');
  const doc = db.prepare(`SELECT id, status FROM ${table} WHERE public_token = ?`).get(req.params.token);
  if (!doc || doc.status === 'draft') throw notFound('File');
  const a = db.prepare('SELECT * FROM attachments WHERE id = ? AND parent_type = ? AND parent_id = ? AND client_visible = 1').get(req.params.fid, req.params.kind, doc.id);
  if (!a) throw notFound('File');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(a.filename)}"`);
  res.type(a.mime || 'application/octet-stream');
  res.sendFile(path.join(UPLOAD_DIR, a.stored_name));
});

/** Public "request work" form, e.g. linked from the company website. */
r.get('/hub/booking', (_req, res) => res.json({ company: company() }));
r.post('/hub/booking', (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot field for bots
  if (!b.first_name || !(b.email || b.phone)) throw bad('Please enter your name and an email or phone number');
  if (!b.details) throw bad('Please describe the work you need');
  db.transaction(() => {
    let client = b.email ? db.prepare('SELECT * FROM clients WHERE email = ? COLLATE NOCASE').get(b.email) : null;
    const cid = client ? client.id : insert('clients', { first_name: b.first_name, last_name: b.last_name || null, email: b.email || null, phone: b.phone || null, status: 'lead', lead_source: 'Online booking' });
    let pid = null;
    if (b.street || b.city) pid = insert('properties', { client_id: cid, street: b.street || null, city: b.city || null, postcode: b.postcode || null });
    const title = String(b.service || 'Online request').slice(0, 120);
    const rid = insert('requests', { client_id: cid, property_id: pid, title, details: `${b.details}${b.preferred ? `\n\nPreferred time: ${b.preferred}` : ''}`, source: 'Online booking', requested_on: new Date().toISOString().slice(0, 10) });
    syncDeal({ clientId: cid, requestId: rid, stage: 'new', title, source: 'Online booking' });
    logActivity({ entityType: 'request', entityId: rid, clientId: cid, action: 'created', summary: `New online request from ${b.first_name}` });
  })();
  const s = getSettings();
  if (s.company_email) sendEmail({ to: s.company_email, subject: `New work request from ${b.first_name} ${b.last_name || ''}`, body: `${b.service || ''}\n\n${b.details}\n\n${b.email || ''} ${b.phone || ''}` });
  res.json({ ok: true });
});

export default r;
