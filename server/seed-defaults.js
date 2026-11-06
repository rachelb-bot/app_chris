import { db } from './db.js';
import { insert } from './lib.js';
import { productImage } from './product-images.js';

/** Starter catalogue + quote templates for an electrical contractor. Safe to run once on setup. */
export const DEFAULT_PRODUCTS = [
  ['Call-out / Diagnostic visit', 'Attend site, fault-find and diagnose electrical issue (first hour).', 'service', 95, 0],
  ['Labour – Electrician (per hour)', 'Registered electrician labour, charged per hour.', 'labour', 65, 32],
  ['Labour – Apprentice (per hour)', 'Apprentice labour, charged per hour.', 'labour', 35, 16],
  ['Consumer unit / panel upgrade', 'Supply and install new consumer unit with RCBO protection, transfer and label circuits, test and certify.', 'service', 1150, 520],
  ['Additional circuit breaker / RCBO', 'Supply and fit additional RCBO, including wiring connection, labelling and testing.', 'material', 150, 55],
  ['Whole-home surge protector (SPD)', 'Surge protection device installed at the main board to protect connected appliances.', 'material', 350, 140],
  ['Smoke / CO detector installation', 'Supply and install interlinked mains smoke / CO detector.', 'material', 120, 45],
  ['Double socket outlet', 'Supply and install new double switched socket outlet.', 'material', 95, 18],
  ['RCD / GFCI outlet replacement', 'Replace standard outlet with tamper-resistant RCD-protected outlet.', 'material', 85, 28],
  ['Light fitting installation', 'Install customer-supplied light fitting.', 'service', 70, 0],
  ['LED downlight (supply & fit)', 'Supply and install fire-rated LED downlight.', 'material', 55, 14],
  ['EV charger installation', 'Supply and install 7kW smart EV charger with dedicated circuit and earthing.', 'service', 1250, 680],
  ['Periodic inspection & test (EICR)', 'Full periodic inspection and testing of installation with written report.', 'service', 220, 0],
  ['Electrical safety certificate', 'Issue completion / safety certificate for works carried out.', 'service', 60, 0],
  ['Full rewire (per room)', 'Rewire of a single room including first and second fix.', 'service', 950, 310],
  ['Outdoor socket (IP66)', 'Supply and install weatherproof outdoor socket with RCD protection.', 'material', 165, 40],
  ['Cable & sundries', 'Cable, clips, junction boxes and consumables.', 'material', 40, 18],
];

export function seedDefaults() {
  if (db.prepare('SELECT COUNT(*) c FROM products').get().c === 0) {
    for (const [name, description, kind, unit_price, unit_cost] of DEFAULT_PRODUCTS) {
      insert('products', { name, description, kind, unit_price, unit_cost, image: productImage(name) });
    }
  }
  if (db.prepare('SELECT COUNT(*) c FROM quote_templates').get().c === 0) {
    const item = (name) => {
      const p = DEFAULT_PRODUCTS.find((x) => x[0] === name);
      return { name: p[0], description: p[1], quantity: 1, unit_price: p[3], unit_cost: p[4], image: productImage(p[0]) };
    };
    insert('quote_templates', {
      name: 'Electrical panel upgrade',
      title: 'Electrical Panel Upgrade',
      intro: 'Upgrade your property\'s electrical supply to a modern, regulation-compliant consumer unit. This service includes professional installation, necessary certification and a full safety inspection to ensure your electrical system is reliable and future-ready.\n\nAll work is performed by a registered electrical contractor and includes clean-up and post-installation verification.',
      items: JSON.stringify([
        item('Consumer unit / panel upgrade'),
        { ...item('Whole-home surge protector (SPD)'), optional: 1 },
        { ...item('Additional circuit breaker / RCBO'), optional: 1 },
        { ...item('Smoke / CO detector installation'), optional: 1 },
        item('Electrical safety certificate'),
      ]),
    });
    insert('quote_templates', {
      name: 'EV charger installation',
      title: 'EV Charger Installation',
      intro: 'Supply and installation of a smart home EV charger on a dedicated circuit, including earthing arrangement, testing and certification.',
      items: JSON.stringify([item('EV charger installation'), item('Cable & sundries'), item('Electrical safety certificate')]),
    });
    insert('quote_templates', {
      name: 'Periodic inspection (EICR)',
      title: 'Periodic Inspection & Test',
      intro: 'A full inspection and test of your electrical installation, with a written condition report and recommendations.',
      items: JSON.stringify([item('Periodic inspection & test (EICR)')]),
    });
  }
}
