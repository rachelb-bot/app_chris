import crypto from 'node:crypto';
import { db } from './db.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bad = (msg) => new HttpError(400, msg);
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);

export const token = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
export const today = () => new Date().toISOString().slice(0, 10);
export const nowIso = () => new Date().toISOString();
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

export function clientName(c) {
  if (!c) return '';
  const person = [c.first_name, c.last_name].filter(Boolean).join(' ');
  return c.company_name ? (person ? `${c.company_name} (${person})` : c.company_name) : person || 'Unnamed client';
}

export function formatAddress(p) {
  if (!p) return '';
  return [p.street, p.city, p.region, p.postcode, p.country].filter(Boolean).join(', ');
}

/** Pick only allowed keys from a body, converting '' to null. */
export function pick(body, keys) {
  const out = {};
  for (const k of keys) if (body && k in body) out[k] = body[k] === '' ? null : body[k];
  return out;
}

export function insert(table, data) {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  return db.prepare(sql).run(...keys.map((k) => normalize(data[k]))).lastInsertRowid;
}

export function update(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...keys.map((k) => normalize(data[k])), id);
}

function normalize(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v === undefined ? null : v;
}

// ---------------- line items & totals ----------------
export function getLineItems(parentType, parentId) {
  return db.prepare('SELECT * FROM line_items WHERE parent_type = ? AND parent_id = ? ORDER BY sort, id').all(parentType, parentId);
}

/** Accepts only small inline images (data: URLs made by the browser's resize step). */
export function cleanImage(v) {
  if (!v) return null;
  const str = String(v);
  if (!/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(str)) return null;
  if (str.length > 600_000) throw new HttpError(413, 'That photo is too large. Use an image under 400KB.');
  return str;
}

export function replaceLineItems(parentType, parentId, items = []) {
  db.prepare('DELETE FROM line_items WHERE parent_type = ? AND parent_id = ?').run(parentType, parentId);
  const stmt = db.prepare(`INSERT INTO line_items
    (parent_type, parent_id, product_id, name, description, quantity, unit_price, unit_cost, optional, selected, is_text, sort, image)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  items.forEach((it, i) => {
    if (!it || !(it.name || '').trim()) return;
    stmt.run(parentType, parentId, it.product_id || null, String(it.name).trim(), it.description || null,
      Number(it.quantity ?? 1) || 0, round2(it.unit_price), round2(it.unit_cost),
      it.optional ? 1 : 0, it.selected === false || it.selected === 0 ? 0 : 1, it.is_text ? 1 : 0, i, cleanImage(it.image));
  });
}

export function copyLineItems(fromType, fromId, toType, toId, { onlySelected = false } = {}) {
  const items = getLineItems(fromType, fromId).filter((i) => !onlySelected || !i.optional || i.selected);
  replaceLineItems(toType, toId, items.map((i) => ({ ...i, optional: toType === 'quote' ? i.optional : 0, selected: 1 })));
}

export function computeTotals(items, { discount = 0, tax_rate = 0 } = {}) {
  let subtotal = 0, cost = 0;
  for (const it of items) {
    if (it.is_text) continue;
    if (it.optional && !it.selected) continue;
    subtotal += (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
    cost += (Number(it.quantity) || 0) * (Number(it.unit_cost) || 0);
  }
  subtotal = round2(subtotal);
  const disc = round2(Math.min(Number(discount) || 0, subtotal));
  const tax = round2(((subtotal - disc) * (Number(tax_rate) || 0)) / 100);
  return { subtotal, discount: disc, tax, total: round2(subtotal - disc + tax), cost: round2(cost) };
}

export function invoiceTotals(inv) {
  const items = getLineItems('invoice', inv.id);
  const t = computeTotals(items, inv);
  const paid = round2(db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id = ?').get(inv.id).s);
  return { ...t, paid, balance: round2(t.total - paid) };
}

export function invoiceDisplayStatus(inv, totals) {
  if (inv.status === 'void' || inv.status === 'draft') return inv.status;
  if (inv.status === 'paid' || totals.balance <= 0) return 'paid';
  if (inv.due_date < today()) return 'overdue';
  if (totals.paid > 0) return 'partial';
  return 'awaiting_payment';
}

export function jobDisplayStatus(job) {
  if (job.status === 'archived') return 'archived';
  const ms = db.prepare('SELECT due_date, invoice_id FROM payment_milestones WHERE parent_type = ? AND parent_id = ?').all('job', job.id);
  if (ms.length) {
    const open = ms.filter((m) => !m.invoice_id);
    if (job.status === 'completed') return open.length ? 'requires_invoicing' : 'completed';
    if (open.some((m) => m.due_date && m.due_date <= today())) return 'requires_invoicing';
  }
  if (job.status === 'completed') {
    if (job.billing === 'none') return 'completed';
    const inv = db.prepare("SELECT COUNT(*) c FROM invoices WHERE job_id = ? AND status != 'void'").get(job.id).c;
    return inv ? 'completed' : 'requires_invoicing';
  }
  const now = nowIso();
  const v = db.prepare(`SELECT
      SUM(CASE WHEN status='scheduled' AND end_at < ? THEN 1 ELSE 0 END) late,
      SUM(CASE WHEN status='scheduled' THEN 1 ELSE 0 END) upcoming,
      COUNT(*) total
    FROM visits WHERE job_id = ?`).get(now, job.id);
  if (v.late) return 'late';
  if (!v.total) return 'unscheduled';
  if (!v.upcoming) return 'action_required';
  return 'active';
}

// ---------------- payment schedules ----------------
/** Net amount (before tax) a schedule is split over. */
export function scheduleBase(parentType, parentId) {
  if (parentType === 'quote') {
    const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(parentId);
    const t = computeTotals(getLineItems('quote', parentId), q || {});
    return round2(t.subtotal - t.discount);
  }
  return computeTotals(getLineItems('job', parentId)).subtotal;
}

/** Milestones with their worked-out net amounts. A "remainder" milestone takes whatever is left. */
export function getMilestones(parentType, parentId, base = scheduleBase(parentType, parentId)) {
  const rows = db.prepare('SELECT * FROM payment_milestones WHERE parent_type = ? AND parent_id = ? ORDER BY sort, id').all(parentType, parentId);
  const fixed = rows.filter((m) => m.kind !== 'remainder').reduce((s, m) => s + (m.kind === 'percent' ? round2((base * m.value) / 100) : round2(m.value)), 0);
  return rows.map((m) => {
    const amount = m.kind === 'percent' ? round2((base * m.value) / 100) : m.kind === 'amount' ? round2(m.value) : round2(Math.max(0, base - fixed));
    const inv = m.invoice_id ? db.prepare('SELECT id, number, status FROM invoices WHERE id = ?').get(m.invoice_id) : null;
    return { ...m, amount, invoice: inv || null };
  });
}

export function replaceMilestones(parentType, parentId, list = []) {
  const existing = new Map(db.prepare('SELECT id, invoice_id FROM payment_milestones WHERE parent_type = ? AND parent_id = ?').all(parentType, parentId).map((m) => [m.id, m.invoice_id]));
  db.prepare('DELETE FROM payment_milestones WHERE parent_type = ? AND parent_id = ?').run(parentType, parentId);
  const remainders = list.filter((m) => m && m.kind === 'remainder').length;
  if (remainders > 1) throw new HttpError(400, 'Only one payment can be "the remaining balance"');
  list.forEach((m, i) => {
    if (!m || !String(m.label || '').trim()) return;
    const kind = ['percent', 'amount', 'remainder'].includes(m.kind) ? m.kind : 'percent';
    db.prepare('INSERT INTO payment_milestones (parent_type, parent_id, label, kind, value, due_date, invoice_id, sort) VALUES (?,?,?,?,?,?,?,?)')
      .run(parentType, parentId, String(m.label).trim(), kind, kind === 'remainder' ? 0 : Number(m.value) || 0, m.due_date || null, m.id && existing.has(Number(m.id)) ? existing.get(Number(m.id)) : null, i);
  });
}

export function copyMilestones(fromType, fromId, toType, toId) {
  const rows = db.prepare('SELECT label, kind, value, due_date FROM payment_milestones WHERE parent_type = ? AND parent_id = ? ORDER BY sort, id').all(fromType, fromId);
  replaceMilestones(toType, toId, rows);
}

/** Parse the JSON custom-field values stored on a record. */
export function parseCustom(row) {
  if (row && typeof row.custom === 'string') { try { row.custom = JSON.parse(row.custom || '{}'); } catch { row.custom = {}; } }
  return row;
}
