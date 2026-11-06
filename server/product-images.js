// Simple original illustrations for the starter catalogue, so quotes have product pictures out of the box.
// Each is a small SVG stored as a data URL on the product (and copied onto line items).
const wrap = (body, bg = '#eef2f6') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="14" fill="${bg}"/>${body}</svg>`;
const INK = '#1b2a38', AMBER = '#f5b301', GREY = '#9aa7b2', WHITE = '#ffffff';

const ICONS = {
  board: wrap(`<rect x="16" y="22" width="64" height="52" rx="6" fill="${WHITE}" stroke="${INK}" stroke-width="3"/>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${22 + i * 9}" y="34" width="6" height="22" rx="1.5" fill="${i === 0 ? AMBER : INK}"/>`).join('')}
    <rect x="22" y="62" width="52" height="5" rx="2" fill="${GREY}"/>`),
  breaker: wrap(`<rect x="34" y="16" width="28" height="64" rx="5" fill="${WHITE}" stroke="${INK}" stroke-width="3"/>
    <rect x="42" y="34" width="12" height="20" rx="2" fill="${INK}"/><rect x="42" y="34" width="12" height="9" rx="2" fill="${AMBER}"/>
    <circle cx="48" cy="68" r="3" fill="${GREY}"/><circle cx="48" cy="24" r="3" fill="${GREY}"/>`),
  surge: wrap(`<rect x="24" y="16" width="48" height="64" rx="6" fill="${WHITE}" stroke="${INK}" stroke-width="3"/>
    <path d="M52 26 38 50h10l-4 20 16-26H50z" fill="${AMBER}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`),
  smoke: wrap(`<circle cx="48" cy="48" r="30" fill="${WHITE}" stroke="${INK}" stroke-width="3"/>
    <circle cx="48" cy="48" r="18" fill="none" stroke="${GREY}" stroke-width="2" stroke-dasharray="4 4"/>
    <circle cx="48" cy="48" r="6" fill="${INK}"/><circle cx="66" cy="34" r="3.5" fill="#d64545"/>`),
  socket: wrap(`<rect x="14" y="26" width="68" height="44" rx="6" fill="${WHITE}" stroke="${INK}" stroke-width="3"/>
    ${[30, 58].map((x) => `<rect x="${x - 2}" y="38" width="4" height="9" rx="1" fill="${INK}"/><rect x="${x - 9}" y="51" width="4" height="7" rx="1" fill="${INK}"/><rect x="${x + 5}" y="51" width="4" height="7" rx="1" fill="${INK}"/>`).join('')}
    <rect x="44" y="33" width="8" height="4" rx="1" fill="${AMBER}"/>`),
  light: wrap(`<circle cx="48" cy="42" r="22" fill="${WHITE}" stroke="${INK}" stroke-width="3"/>
    <circle cx="48" cy="42" r="12" fill="${AMBER}"/>
    <path d="M30 72h36M36 80h24" stroke="${GREY}" stroke-width="3" stroke-linecap="round"/>`),
  ev: wrap(`<rect x="26" y="14" width="34" height="56" rx="7" fill="${WHITE}" stroke="${INK}" stroke-width="3"/>
    <path d="M46 24 37 40h7l-3 13 10-17h-7z" fill="${AMBER}"/>
    <path d="M60 52c12 0 12 10 12 16v6" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
    <rect x="66" y="74" width="12" height="8" rx="2" fill="${INK}"/>`),
  inspect: wrap(`<rect x="22" y="14" width="44" height="60" rx="5" fill="${WHITE}" stroke="${INK}" stroke-width="3"/>
    <path d="M30 30h28M30 40h28M30 50h18" stroke="${GREY}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="62" cy="64" r="12" fill="${AMBER}" stroke="${INK}" stroke-width="3"/><path d="m56 64 4 4 8-8" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`),
  cable: wrap(`<circle cx="48" cy="48" r="26" fill="none" stroke="${INK}" stroke-width="7"/>
    <circle cx="48" cy="48" r="15" fill="none" stroke="${AMBER}" stroke-width="7"/><circle cx="48" cy="48" r="5" fill="${GREY}"/>`),
  outdoor: wrap(`<rect x="22" y="20" width="52" height="58" rx="6" fill="${WHITE}" stroke="${INK}" stroke-width="3"/>
    <path d="M22 34h52" stroke="${INK}" stroke-width="3"/><rect x="34" y="44" width="28" height="22" rx="4" fill="${AMBER}"/>
    ${[40, 56].map((x) => `<rect x="${x - 2}" y="50" width="4" height="9" rx="1" fill="${INK}"/>`).join('')}`),
  tools: wrap(`<path d="M28 68 58 38" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
    <path d="M58 38c-4-8 2-18 12-18l-6 8 4 6 8-4c0 10-10 16-18 8z" fill="${AMBER}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="28" cy="68" r="4" fill="${WHITE}"/>`),
};

const toDataUrl = (svg) => `data:image/svg+xml;base64,${btoa(svg.replace(/\s+/g, ' '))}`;

/** Product name → illustration key. */
const BY_PRODUCT = {
  'Consumer unit / panel upgrade': 'board',
  'Additional circuit breaker / RCBO': 'breaker',
  'Whole-home surge protector (SPD)': 'surge',
  'Smoke / CO detector installation': 'smoke',
  'Double socket outlet': 'socket',
  'RCD / GFCI outlet replacement': 'socket',
  'Light fitting installation': 'light',
  'LED downlight (supply & fit)': 'light',
  'EV charger installation': 'ev',
  'Periodic inspection & test (EICR)': 'inspect',
  'Electrical safety certificate': 'inspect',
  'Full rewire (per room)': 'cable',
  'Cable & sundries': 'cable',
  'Outdoor socket (IP66)': 'outdoor',
  'Call-out / Diagnostic visit': 'tools',
};

export function productImage(name) {
  const key = BY_PRODUCT[name];
  return key ? toDataUrl(ICONS[key]) : null;
}
