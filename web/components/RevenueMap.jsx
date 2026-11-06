import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { money, IS_DEMO } from '../format.js';

const BUCKETS = [
  [250, '#c7d7f0'], [500, '#8fb0e3'], [750, '#5a86cf'], [1000, '#2f5fb3'], [Infinity, '#1b3a78'],
];
const colorFor = (v) => BUCKETS.find(([max]) => v <= max)[1];

/** Map of revenue by property: one circle per property, sized and coloured by money received. */
export default function RevenueMap({ points, height = 380, onOpen }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);

  useEffect(() => {
    map.current = L.map(el.current, { scrollWheelZoom: false, attributionControl: !IS_DEMO, zoomAnimation: !IS_DEMO, fadeAnimation: !IS_DEMO }).setView([53.35, -6.4], 9);
    // The self-contained preview can't load map tiles, so it shows the points on a plain background.
    if (!IS_DEMO) {
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' }).addTo(map.current);
    }
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current.stop(); map.current.off(); map.current.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    layer.current.clearLayers();
    if (!points.length) return;
    const max = Math.max(...points.map((p) => p.value));
    for (const p of points) {
      const radius = 7 + Math.sqrt(p.value / max) * 18;
      L.circleMarker([p.lat, p.lng], { radius, color: '#111c27', weight: 1, fillColor: colorFor(p.value), fillOpacity: 0.85 })
        .bindTooltip(`<b>${escapeHtml(p.client_name)}</b><br>${escapeHtml(p.address || '')}<br>${money(p.value)}`)
        .on('click', () => onOpen?.(p))
        .addTo(layer.current);
    }
    m.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])).pad(0.25), { maxZoom: 13, animate: false });
  }, [points]);

  return (
    <div>
      <div ref={el} style={{ height, background: 'var(--surface-2)' }} role="img" aria-label="Map of revenue by property" />
      <div className="row wrap mt-s small muted" style={{ gap: 12 }}>
        {BUCKETS.map(([max, c], i) => (
          <span key={c} className="row" style={{ gap: 5 }}><span style={{ width: 11, height: 11, borderRadius: '50%', background: c, border: '1px solid #111c27' }} />
            {i === 0 ? `up to ${money(max, { compact: true })}` : max === Infinity ? `over ${money(BUCKETS[i - 1][0], { compact: true })}` : `${money(BUCKETS[i - 1][0], { compact: true })}–${money(max, { compact: true })}`}</span>
        ))}
      </div>
    </div>
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
