// Turns property addresses into map coordinates (for the revenue map).
// Uses OpenStreetMap Nominatim by default: free, max 1 request per second, results stored on the property.
// Set GEOCODER=off to disable, or GEOCODER_URL to point at another Nominatim-compatible service.
import { db } from './db.js';

const enabled = () => (globalThis.process?.env?.GEOCODER || 'nominatim') !== 'off';
const endpoint = () => globalThis.process?.env?.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search';
const queue = [];
let running = false;

export async function geocodeProperty(id) {
  const p = db.prepare('SELECT * FROM properties WHERE id = ?').get(id);
  if (!p || p.lat != null) return p;
  const q = [p.street, p.city, p.region, p.postcode, p.country].filter(Boolean).join(', ');
  if (!q) return p;
  const url = `${endpoint()}?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const headers = { 'User-Agent': `Voltline/1.0 (self-hosted field service app${process.env.GEOCODER_CONTACT ? `; ${process.env.GEOCODER_CONTACT}` : ''})`, 'Accept-Language': 'en' };
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Geocoder replied ${res.status}`);
  const [hit] = await res.json();
  db.prepare('UPDATE properties SET lat = ?, lng = ?, geocoded_at = ? WHERE id = ?')
    .run(hit ? Number(hit.lat) : null, hit ? Number(hit.lon) : null, new Date().toISOString(), id);
  return db.prepare('SELECT * FROM properties WHERE id = ?').get(id);
}

async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const id = queue.shift();
    try { await geocodeProperty(id); } catch (e) { console.warn('Geocoding failed for property', id, e.message); }
    await new Promise((r) => setTimeout(r, 1100)); // usage policy: at most 1 request per second
  }
  running = false;
}

/** Look up a property's coordinates in the background. */
export function queueGeocode(id) {
  if (!enabled() || !id || queue.includes(id)) return;
  queue.push(id);
  drain();
}

/** Queue every property that has an address but no coordinates yet. Returns how many were queued. */
export function queueMissing(limit = 200) {
  if (!enabled()) return 0;
  const rows = db.prepare("SELECT id FROM properties WHERE lat IS NULL AND geocoded_at IS NULL AND COALESCE(street, city, postcode, '') != '' LIMIT ?").all(limit);
  rows.forEach((r) => queueGeocode(r.id));
  return rows.length;
}
export const geocodingEnabled = enabled;
