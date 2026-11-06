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

export function replaceLineItems(parentType, parentId, items = []) {
  db.prepare('DELETE FROM line_items WHERE parent_type = ? AND parent_id = ?').run(parentType, parentId);
  const stmt = db.prepare(`INSERT INTO line_items
    (parent_type, parent_id, product_id, name, description, quantity, unit_price, unit_cost, optional, selected, is_text, sort)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  items.forEach((it, i) => {
    if (!it || !(it.name || '').trim()) return;
    stmt.run(parentType, parentId, it.product_id || null, String(it.name).trim(), it.description || null,
      Number(it.quantity ?? 1) || 0, round2(it.unit_price), round2(it.unit_cost),
      it.optional ? 1 : 0, it.selected === false || it.selected === 0 ? 0 : 1, it.is_text ? 1 : 0, i);
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
