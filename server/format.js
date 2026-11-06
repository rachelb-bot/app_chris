import { getSettings } from './db.js';

export function formatMoney(n, s = getSettings()) {
  try {
    return new Intl.NumberFormat(s.locale || 'en-IE', { style: 'currency', currency: s.currency || 'EUR' }).format(Number(n) || 0);
  } catch {
    return `${(Number(n) || 0).toFixed(2)} ${s.currency || ''}`;
  }
}

/** Absolute URL for client-hub links (uses PUBLIC_URL / settings.public_url, else the request host). */
export function hubUrl(req, path) {
  const base = (process.env.PUBLIC_URL || getSettings().public_url || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return base + path;
}
