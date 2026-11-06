// Populates a realistic demo electrical company. Usage: npm run seed:demo  (refuses to run on a database that already has clients)
import { db, migrate, setSettings, nextNumber, logActivity } from './db.js';
import { insert, replaceLineItems, token, addDays, today } from './lib.js';
import { hashPassword } from './auth.js';
import { seedDefaults, DEFAULT_PRODUCTS } from './seed-defaults.js';
import { backfillDeals } from './routes/pipeline.js';
import { productImage } from './product-images.js';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const iso = (d, h = 9, m = 0) => { const x = new Date(d + 'T00:00:00'); x.setHours(h, m, 0, 0); return x.toISOString(); };
const dt = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString().replace('T', ' ').slice(0, 19);
const P = (name, qty = 1, extra = {}) => { const p = DEFAULT_PRODUCTS.find((x) => x[0] === name); return { name: p[0], description: p[1], quantity: qty, unit_price: p[3], unit_cost: p[4], image: productImage(p[0]), ...extra }; };

export function seedDemo() {
db.transaction(() => {
  let owner = db.prepare("SELECT * FROM users WHERE role = 'owner'").get();
  if (!owner) {
    setSettings({ company_name: 'Bright Spark Electrical Ltd', company_email: 'office@brightspark.example', company_phone: '01 555 0142', company_address: 'Unit 4, Fonthill Business Park\nDublin 22', vat_no: 'IE1234567T', company_reg_no: 'RECI 12345', bank_details: 'Bright Spark Electrical Ltd\nIBAN: IE29 AIBK 9311 5212 3456 78\nBIC: AIBKIE2D' });
    const id = insert('users', { name: 'Chris Byrne', email: 'demo@voltline.app', password_hash: hashPassword('demo1234'), role: 'owner', color: '#f59e0b', hourly_cost: 45, licence_no: 'RECI-0099' });
    owner = { id };
  }
  seedDefaults();
  const team = [
    ['Aoife Kelly', 'aoife@brightspark.example', 'office', '#7c3aed', 28],
    ['Liam Murphy', 'liam@brightspark.example', 'tech', '#2563eb', 34],
    ['Sean Walsh', 'sean@brightspark.example', 'tech', '#16a34a', 32],
    ['Ciara Doyle', 'ciara@brightspark.example', 'tech', '#dc2626', 18],
  ].map(([name, email, role, color, cost]) => {
    const ex = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    return ex ? ex.id : insert('users', { name, email, role, color, hourly_cost: cost, password_hash: hashPassword('demo1234') });
  });
  const [aoife, liam, sean, ciara] = team;

  const COORDS = { Lucan: [53.3573, -6.4486], Clondalkin: [53.3203, -6.3946], Naas: [53.2159, -6.6669], Tallaght: [53.2859, -6.3733], 'Dublin 2': [53.3381, -6.2463], Celbridge: [53.3399, -6.5393], Saggart: [53.2803, -6.4433] };
  const jitter = (i) => ((i * 7919) % 100) / 10000;
  const clientData = [
    ['Rachel', 'Nolan', null, 'rachel.nolan@example.com', '087 123 4567', 'residential', 'Google', ['EV'], '14 Riverside Drive', 'Lucan', 'Co. Dublin', 'K78 X2Y4', 2],
    ['Declan', 'Ryan', null, 'declan.ryan@example.com', '086 222 3344', 'residential', 'Referral', ['landlord'], '7 Oak Park', 'Clondalkin', 'Dublin 22', 'D22 F3K9', 40],
    ['Siobhan', 'Brennan', 'Brennan\'s Café', 'hello@brennanscafe.example', '01 444 9090', 'commercial', 'Website', ['commercial', 'priority'], '22 Main Street', 'Naas', 'Co. Kildare', 'W91 P2R6', 90],
    ['Mark', 'O\'Connor', null, 'mark.oc@example.com', '085 777 1212', 'residential', 'Facebook', [], '3 Willow Grove', 'Tallaght', 'Dublin 24', 'D24 H6T1', 15],
    ['Niamh', 'Fitzgerald', null, 'niamh.f@example.com', '087 909 1100', 'residential', 'Google', ['EV'], '91 Ballyowen Lane', 'Lucan', 'Co. Dublin', 'K78 R4E2', 8],
    ['Tom', 'Gallagher', 'Gallagher Property Mgmt', 'tom@gallagherpm.example', '01 610 2020', 'commercial', 'Repeat client', ['landlord', 'commercial'], '1 Grand Canal Quay', 'Dublin 2', 'Dublin', 'D02 Y7K8', 200],
    ['Emma', 'Quinn', null, 'emma.quinn@example.com', '083 456 7788', 'residential', 'Van signage', [], '45 Castle Road', 'Celbridge', 'Co. Kildare', 'W23 T8N3', 1],
    ['Patrick', 'Daly', null, null, '087 333 4455', 'residential', 'Referral', [], '12 Hillview', 'Saggart', 'Co. Dublin', 'D24 W1X5', 25],
  ];
  const clients = clientData.map(([first_name, last_name, company_name, email, phone, client_type, lead_source, tags, street, city, region, postcode, age]) => {
    const id = insert('clients', { first_name, last_name, company_name, email, phone, client_type, lead_source, tags: JSON.stringify(tags), status: 'lead', created_at: dt(age), updated_at: dt(Math.max(0, age - 1)) });
    const [lat, lng] = COORDS[city] || [null, null];
    const pid = insert('properties', { client_id: id, street, city, region, postcode, country: 'Ireland', created_at: dt(age), lat: lat && lat + jitter(age), lng: lng && lng - jitter(age + 3), geocoded_at: lat ? new Date().toISOString() : null });
    return { id, pid, name: company_name || `${first_name} ${last_name}` };
  });
  const active = (cid) => db.prepare("UPDATE clients SET status='active' WHERE id = ?").run(cid);
  const t = today();

  // Requests
  const r1 = insert('requests', { client_id: clients[6].id, property_id: clients[6].pid, title: 'Lights flickering upstairs', details: 'Lights in two bedrooms flicker, sometimes trips. House built 1998.', source: 'Phone', status: 'new', created_at: dt(0) });
  const r2 = insert('requests', { client_id: clients[0].id, property_id: clients[0].pid, title: 'EV charger for new car', details: 'Getting a Tesla Model 3 next month, want a charger on the side of the house. Board is in the garage.', source: 'Online booking', status: 'assessment', assessment_start: iso(addDays(t, 1), 15), assessment_end: iso(addDays(t, 1), 16), assigned_to: liam, created_at: dt(2) });
  logActivity({ userId: aoife, entityType: 'request', entityId: r1, clientId: clients[6].id, action: 'created', summary: 'Request "Lights flickering upstairs" created' });
  logActivity({ userId: aoife, entityType: 'request', entityId: r2, clientId: clients[0].id, action: 'created', summary: 'Request "EV charger for new car" created' });

  // Quotes
  const mkQuote = (c, title, intro, items, status, extra = {}) => {
    const id = insert('quotes', { number: nextNumber('quote'), client_id: c.id, property_id: c.pid, title, intro, status, tax_rate: 13.5, terms: 'All work carried out by registered electrical contractors to current wiring regulations. Quote valid for 30 days.', valid_until: addDays(t, 30), public_token: token(), created_by: owner.id, ...extra });
    replaceLineItems('quote', id, items);
    return id;
  };
  mkQuote(clients[4], 'EV Charger Installation', 'Supply and install 7kW smart charger on dedicated circuit.', [P('EV charger installation'), P('Cable & sundries', 2), P('Electrical safety certificate')], 'sent', { sent_at: new Date(Date.now() - 3 * 864e5).toISOString(), created_at: dt(4) });
  mkQuote(clients[3], 'Electrical Panel Upgrade', 'Upgrade to modern consumer unit with RCBO protection.', [P('Consumer unit / panel upgrade'), P('Whole-home surge protector (SPD)', 1, { optional: 1, selected: 0 }), P('Smoke / CO detector installation', 3, { optional: 1, selected: 1 }), P('Electrical safety certificate')], 'approved', { sent_at: new Date(Date.now() - 6 * 864e5).toISOString(), approved_at: new Date(Date.now() - 2 * 864e5).toISOString(), client_signature: 'Mark O\'Connor', created_at: dt(7) });
  active(clients[3].id);
  mkQuote(clients[1], 'Rental property rewire – 2 bedrooms', 'Rewire two bedrooms ahead of new tenancy.', [P('Full rewire (per room)', 2), P('Double socket outlet', 6), P('LED downlight (supply & fit)', 8)], 'draft', { created_at: dt(1) });

  // Jobs
  const mkJob = (c, title, items, opts = {}) => {
    const id = insert('jobs', { number: nextNumber('job'), client_id: c.id, property_id: c.pid, title, instructions: opts.instructions || null, job_type: opts.type || 'one_off', status: opts.status || 'active', start_date: opts.start || t, completed_at: opts.completed_at || null, created_at: opts.created_at || dt(5) });
    replaceLineItems('job', id, items);
    for (const v of opts.visits || []) {
      const vid = insert('visits', { job_id: id, title, start_at: v.start, end_at: v.end, status: v.status || 'scheduled', completed_at: v.status === 'completed' ? v.end : null });
      for (const u of v.team) db.prepare('INSERT INTO visit_assignments (visit_id, user_id) VALUES (?, ?)').run(vid, u);
    }
    ['Safe isolation confirmed', 'Test results recorded', 'Certificate issued to client'].forEach((label, i) => insert('checklist_items', { job_id: id, label, sort: i, done: opts.status === 'completed' ? 1 : 0 }));
    active(c.id);
    return id;
  };
  const j1 = mkJob(clients[2], 'Café kitchen – new circuits for equipment', [P('Additional circuit breaker / RCBO', 3), P('Labour – Electrician (per hour)', 10), P('Cable & sundries', 3)], {
    instructions: 'Café closes at 3pm — work after closing. Board in back store room.', created_at: dt(12),
    visits: [{ start: iso(t, 15), end: iso(t, 19), team: [liam, sean] }, { start: iso(addDays(t, 2), 15), end: iso(addDays(t, 2), 18), team: [liam] }] });
  const j2 = mkJob(clients[3], 'Electrical Panel Upgrade', [P('Consumer unit / panel upgrade'), P('Smoke / CO detector installation', 3), P('Electrical safety certificate')], {
    created_at: dt(2), visits: [{ start: iso(addDays(t, 1), 8), end: iso(addDays(t, 1), 14), team: [sean, ciara] }] });
  const j3 = mkJob(clients[5], 'Quarterly landlord safety checks', [P('Periodic inspection & test (EICR)')], { type: 'recurring', created_at: dt(60),
    visits: [0, 1, 2].map((i) => ({ start: iso(addDays(t, 3 + i * 7), 9), end: iso(addDays(t, 3 + i * 7), 12), team: [liam] })) });
  const j4 = mkJob(clients[1], 'Replace faulty RCD & 4 sockets', [P('Call-out / Diagnostic visit'), P('RCD / GFCI outlet replacement', 4)], { status: 'completed', created_at: dt(20), completed_at: new Date(Date.now() - 18 * 864e5).toISOString(),
    visits: [{ start: iso(addDays(t, -18), 9), end: iso(addDays(t, -18), 13), status: 'completed', team: [sean] }] });
  const j5 = mkJob(clients[7], 'Outdoor socket & garden lighting', [P('Outdoor socket (IP66)'), P('Light fitting installation', 4)], { status: 'completed', created_at: dt(6), completed_at: new Date(Date.now() - 1 * 864e5).toISOString(),
    visits: [{ start: iso(addDays(t, -1), 10), end: iso(addDays(t, -1), 15), status: 'completed', team: [liam, ciara] }] });
  const j6 = mkJob(clients[0], 'Downlights in kitchen extension', [P('LED downlight (supply & fit)', 10), P('Labour – Electrician (per hour)', 4)], { created_at: dt(1) });

  // Custom fields
  insert('custom_fields', { entity: 'client', label: 'MPRN (meter number)', field_type: 'text', sort: 0 });
  insert('custom_fields', { entity: 'job', label: 'Certificate type', field_type: 'select', options: JSON.stringify(['Completion certificate', 'Periodic inspection report', 'Minor works certificate', 'None needed']), sort: 0 });
  insert('custom_fields', { entity: 'job', label: 'Supply isolated by ESB Networks', field_type: 'checkbox', sort: 1 });
  insert('custom_fields', { entity: 'quote', label: 'Estimated duration', field_type: 'text', show_to_client: 1, sort: 0 });
  db.prepare("UPDATE jobs SET custom = ? WHERE id = ?").run(JSON.stringify({ 2: 'Completion certificate' }), j1);
  db.prepare("UPDATE clients SET custom = ? WHERE id = ?").run(JSON.stringify({ 1: '10012345678' }), clients[3].id);
  // Payment schedule on the café job: 30% deposit, 40% at first fix, balance on completion
  [['Deposit', 'percent', 30, addDays(t, -10)], ['First fix complete', 'percent', 40, addDays(t, 2)], ['Final balance', 'remainder', 0, null]]
    .forEach(([label, kind, value, due_date], i) => insert('payment_milestones', { parent_type: 'job', parent_id: j1, label, kind, value, due_date, sort: i }));

  // Invoices & payments
  const mkInv = (c, jobId, subject, items, issueAgo, status, payments = []) => {
    const issue = addDays(t, -issueAgo);
    const id = insert('invoices', { number: nextNumber('invoice'), client_id: c.id, property_id: c.pid, job_id: jobId, subject, status, issue_date: issue, due_date: addDays(issue, 14), tax_rate: 13.5, client_message: 'Thank you for your business.', public_token: token(), sent_at: status !== 'draft' ? new Date(issue).toISOString() : null });
    replaceLineItems('invoice', id, items);
    for (const [amt, ago, method] of payments) insert('payments', { invoice_id: id, amount: amt, method, paid_on: addDays(t, -ago) });
    return id;
  };
  mkInv(clients[1], j4, 'Replace faulty RCD & 4 sockets', [P('Call-out / Diagnostic visit'), P('RCD / GFCI outlet replacement', 4)], 17, 'paid', [[493.43, 10, 'bank_transfer']]);
  db.prepare("UPDATE invoices SET paid_at = ? WHERE job_id = ?").run(new Date(Date.now() - 10 * 864e5).toISOString(), j4);
  mkInv(clients[5], null, 'Emergency call-out – common area lighting', [P('Call-out / Diagnostic visit'), P('Labour – Electrician (per hour)', 3), P('LED downlight (supply & fit)', 6)], 30, 'sent');
  const depInv = mkInv(clients[2], j1, 'Deposit – Café kitchen – new circuits for equipment', [{ name: 'Deposit', description: '30% of job #1001', quantity: 1, unit_price: 366 }], 12, 'sent', [[200, 5, 'card']]);
  db.prepare("UPDATE payment_milestones SET invoice_id = ? WHERE parent_type = 'job' AND parent_id = ? AND label = 'Deposit'").run(depInv, j1);
  // Historic revenue so charts have shape
  const histC = [clients[5], clients[2], clients[1], clients[3]];
  for (let m = 1; m <= 10; m++) {
    const c = histC[m % histC.length];
    const amt = 900 + ((m * 737) % 2600);
    const id = mkInv(c, null, `Electrical works – ${m} month(s) ago`, [{ name: 'Electrical works', quantity: 1, unit_price: Math.round(amt / 1.135) }], m * 30 + 5, 'paid', [[amt, m * 30 - 3, 'bank_transfer']]);
    db.prepare('UPDATE invoices SET paid_at = ? WHERE id = ?').run(new Date(Date.now() - (m * 30 - 3) * 864e5).toISOString(), id);
  }

  // Time entries & expenses
  const te = (u, job, daysAgo, h1, h2, approved = 1) => insert('time_entries', { user_id: u, job_id: job, start_at: iso(addDays(t, -daysAgo), h1), end_at: iso(addDays(t, -daysAgo), h2), approved, approved_by: approved ? owner.id : null });
  te(sean, j4, 18, 9, 13); te(liam, j5, 1, 10, 15, 0); te(ciara, j5, 1, 10, 15, 0); te(liam, j1, 3, 15, 19, 0); te(sean, j1, 3, 15, 19, 0);
  for (let d = 2; d <= 9; d++) if (d % 7 !== 0 && d % 7 !== 6) { te(liam, null, d, 8, 16); te(sean, null, d, 8, 16, d > 4 ? 1 : 0); }
  insert('expenses', { title: 'Hager 10-way consumer unit', category: 'Materials', amount: 412.5, date: addDays(t, -2), job_id: j2, user_id: owner.id, supplier: 'Electrical Wholesale Ltd' });
  insert('expenses', { title: '2.5mm T&E cable 100m', category: 'Materials', amount: 96.4, date: addDays(t, -3), job_id: j1, user_id: liam, supplier: 'City Electrical', reimbursable: 1 });
  insert('expenses', { title: 'Diesel – van 2', category: 'Fuel & travel', amount: 85, date: addDays(t, -4), user_id: sean, reimbursable: 1 });
  insert('expenses', { title: 'Outdoor IP66 socket + glands', category: 'Materials', amount: 38.9, date: addDays(t, -1), job_id: j5, user_id: liam });
  insert('expenses', { title: 'Multifunction tester calibration', category: 'Tools & equipment', amount: 120, date: addDays(t, -9), user_id: owner.id });

  insert('referrals', { referrer_client_id: clients[1].id, referred_client_id: clients[7].id, reward: '€25 credit on next job', status: 'pending' });
  insert('campaigns', { name: 'Autumn EICR reminder', subject: 'Is your home electrically safe this winter?', body: 'Hi {first_name},\n\nWinter is the busiest time for electrical faults. Book a periodic inspection now and get 10% off.\n\nKind regards,\n{company}', audience: 'active' });
  // Pipeline: derive deals from the requests/quotes above, then add a few in other stages
  db.prepare("DELETE FROM settings WHERE key = '_deals_backfilled'").run();
  backfillDeals();
  const deal = (c, title, stage, value, extra = {}) => insert('deals', { title, client_id: c.id, stage, value, owner_id: owner.id, source: db.prepare('SELECT lead_source FROM clients WHERE id = ?').get(c.id).lead_source, ...extra });
  deal(clients[5], 'Office LED lighting retrofit – 3 floors', 'contacted', 6800, { next_step: 'Walk-through with facilities manager', next_step_at: addDays(t, 2), expected_close: addDays(t, 21), stage_changed_at: dt(3) });
  deal(clients[2], 'Second café unit – full fit-out', 'follow_up', 9400, { next_step: 'Revise quote with 3-phase supply option', next_step_at: addDays(t, 1), expected_close: addDays(t, 14), stage_changed_at: dt(9) });
  deal(clients[6], 'Garden room supply & lighting', 'new', 1850, { stage_changed_at: dt(0) });
  deal(clients[1], 'Apartment block EICRs (6 units)', 'quote_sent', 1320, { owner_id: aoife, expected_close: addDays(t, 10), stage_changed_at: dt(5) });
  deal(clients[4], 'Solar PV battery prep', 'lost', 2400, { lost_reason: 'Went with the solar installer\'s own electrician', lost_at: new Date(Date.now() - 12 * 864e5).toISOString(), stage_changed_at: dt(12) });

  for (const j of [j1, j2, j3, j5, j6]) logActivity({ userId: aoife, entityType: 'job', entityId: j, clientId: db.prepare('SELECT client_id FROM jobs WHERE id = ?').get(j).client_id, action: 'created', summary: `Job #${db.prepare('SELECT number FROM jobs WHERE id = ?').get(j).number} created` });
})();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  migrate();
  if (db.prepare('SELECT COUNT(*) c FROM clients').get().c > 0 && !process.argv.includes('--force')) {
    console.log('Database already has clients — not seeding demo data. Use --force to add anyway.');
    process.exit(0);
  }
  seedDemo();
  console.log('Demo data added. Sign in with demo@voltline.app / demo1234 (team members use their email + demo1234).');
}
