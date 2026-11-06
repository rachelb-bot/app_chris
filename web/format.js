let cfg = { currency: 'EUR', locale: 'en-IE' };
export function configureFormat(s) { if (s) cfg = { currency: s.currency || 'EUR', locale: s.locale || 'en-IE' }; }

export function money(n, opts = {}) {
  try {
    return new Intl.NumberFormat(opts.locale || cfg.locale, { style: 'currency', currency: opts.currency || cfg.currency, maximumFractionDigits: opts.compact ? 0 : 2 }).format(Number(n) || 0);
  } catch { return (Number(n) || 0).toFixed(2); }
}

const parse = (d) => (d instanceof Date ? d : new Date(String(d).length === 10 ? d + 'T00:00:00' : String(d).replace(' ', 'T') + (String(d).includes(' ') ? 'Z' : '')));
export function date(d, o = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!d) return '—';
  const x = parse(d);
  return isNaN(x) ? '—' : x.toLocaleDateString(cfg.locale, o);
}
export function time(d) {
  if (!d) return '';
  return parse(d).toLocaleTimeString(cfg.locale, { hour: '2-digit', minute: '2-digit' });
}
export function dateTime(d) { return d ? `${date(d)} ${time(d)}` : '—'; }
export function ago(d) {
  if (!d) return '—';
  const s = (Date.now() - parse(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return date(d);
}
export function hours(h) {
  const total = Math.round((Number(h) || 0) * 60);
  const hh = Math.floor(total / 60), mm = total % 60;
  return `${hh}h ${String(mm).padStart(2, '0')}m`;
}

/** Local YYYY-MM-DD */
export function ymd(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
/** Value for <input type="datetime-local"> from ISO */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${ymd(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
}

export const STATUS_LABELS = {
  lead: 'Lead', active: 'Active', archived: 'Archived', new: 'New', assessment: 'Assessment scheduled', converted: 'Converted',
  draft: 'Draft', sent: 'Awaiting response', approved: 'Approved', changes_requested: 'Changes requested',
  late: 'Late', unscheduled: 'Unscheduled', action_required: 'Action required', requires_invoicing: 'Requires invoicing', completed: 'Completed',
  awaiting_payment: 'Awaiting payment', overdue: 'Overdue', partial: 'Partially paid', paid: 'Paid', void: 'Void',
  scheduled: 'Scheduled', pending: 'Pending', rewarded: 'Rewarded',
};
export const STATUS_TONE = {
  lead: 'blue', active: 'green', archived: 'grey', new: 'blue', assessment: 'purple', converted: 'green',
  draft: 'grey', sent: 'amber', approved: 'green', changes_requested: 'red',
  late: 'red', unscheduled: 'amber', action_required: 'amber', requires_invoicing: 'purple', completed: 'green',
  awaiting_payment: 'amber', overdue: 'red', partial: 'amber', paid: 'green', void: 'grey', scheduled: 'blue', pending: 'amber', rewarded: 'green',
};
