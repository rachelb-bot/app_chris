// End-to-end API test against a throwaway database. Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voltline-test-'));
process.env.DATA_DIR = dir;
process.env.GEOCODER = 'off';
const { app } = await import('../index.js');
let server, base, cookie = '';

async function call(method, url, body, opts = {}) {
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', cookie: opts.cookie ?? cookie }, body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set && !opts.cookie) cookie = set.split(';')[0];
  return { status: res.status, body: await res.json() };
}

before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://localhost:${server.address().port}/api`; r(); }); }));
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('full quote → job → invoice → payment workflow', async () => {
  assert.equal((await call('GET', '/auth/status')).body.needsSetup, true);
  assert.equal((await call('POST', '/auth/setup', { company_name: 'Test Electric', name: 'Owner', email: 'o@t.ie', password: 'password1' })).status, 200);
  assert.equal((await call('POST', '/auth/setup', { company_name: 'X', name: 'Y', email: 'y@t.ie', password: 'password1' })).status, 409);

  const products = (await call('GET', '/products')).body;
  assert.ok(products.length > 5, 'default electrical catalogue seeded');

  const client = (await call('POST', '/clients', { first_name: 'Ann', last_name: 'Lee', email: 'ann@x.ie', property: { street: '1 Main St', city: 'Cork' } })).body;
  const q = (await call('POST', '/quotes', { client_id: client.id, title: 'Board upgrade', items: [
    { name: 'Board', quantity: 1, unit_price: 1000, unit_cost: 400 },
    { name: 'SPD', quantity: 1, unit_price: 300, optional: 1, selected: 0 },
  ] })).body;
  let quote = (await call('GET', `/quotes/${q.id}`)).body;
  assert.equal(quote.totals.subtotal, 1000, 'unselected optional item excluded');
  assert.equal(quote.totals.tax, 135);
  assert.ok(quote.valid_until, 'default validity applied');

  const sent = (await call('POST', `/quotes/${q.id}/send`, {})).body;
  assert.equal(sent.delivery, 'logged');
  const token = sent.link.split('/').pop();

  // client approves publicly, selecting the optional item
  const hub = (await call('GET', `/hub/quote/${token}`, null, { cookie: '' })).body;
  const spd = hub.items.find((i) => i.name === 'SPD');
  assert.equal((await call('POST', `/hub/quote/${token}/approve`, { signature: 'Ann Lee', selected: [spd.id] }, { cookie: '' })).status, 200);
  quote = (await call('GET', `/quotes/${q.id}`)).body;
  assert.equal(quote.status, 'approved');
  assert.equal(quote.totals.subtotal, 1300);
  assert.equal(quote.client.status, 'active', 'lead promoted to active client');

  const job = (await call('POST', `/quotes/${q.id}/convert`)).body;
  let j = (await call('GET', `/jobs/${job.id}`)).body;
  assert.equal(j.items.length, 2);
  assert.equal(j.display_status, 'unscheduled');
  assert.equal(j.checklist.length, 3);

  await call('POST', `/jobs/${job.id}/visits`, { start_at: new Date().toISOString(), assignees: [1] });
  await call('POST', `/jobs/${job.id}/complete`);
  j = (await call('GET', `/jobs/${job.id}`)).body;
  assert.equal(j.display_status, 'requires_invoicing');

  const inv = (await call('POST', '/invoices', { job_id: job.id })).body;
  let i = (await call('GET', `/invoices/${inv.id}`)).body;
  assert.equal(i.totals.total, 1475.5);
  await call('POST', `/invoices/${inv.id}/send`, {});
  await call('POST', `/invoices/${inv.id}/payments`, { amount: 475.5 });
  i = (await call('GET', `/invoices/${inv.id}`)).body;
  assert.equal(i.display_status, 'partial');
  await call('POST', `/invoices/${inv.id}/payments`, { amount: 1000 });
  i = (await call('GET', `/invoices/${inv.id}`)).body;
  assert.equal(i.display_status, 'paid');
  assert.equal((await call('GET', `/jobs/${job.id}`)).body.display_status, 'completed');

  const dash = (await call('GET', '/dashboard')).body;
  assert.equal(dash.performance.revenue_month, 1475.5);
});

test('technicians cannot see financials', async () => {
  await call('POST', '/users', { name: 'Tech', email: 'tech@t.ie', role: 'tech', password: 'password1' });
  const owner = cookie;
  await call('POST', '/auth/login', { email: 'tech@t.ie', password: 'password1' });
  assert.equal((await call('GET', '/invoices')).status, 403);
  assert.equal((await call('GET', '/insights')).status, 403);
  assert.equal((await call('POST', '/clients', { first_name: 'X' })).status, 403);
  assert.equal((await call('GET', '/jobs')).status, 200);
  cookie = owner;
});

test('unauthenticated access is rejected', async () => {
  assert.equal((await call('GET', '/clients', null, { cookie: '' })).status, 401);
});

test('pipeline follows the sales workflow automatically', async () => {
  const c = (await call('POST', '/clients', { first_name: 'Pip', last_name: 'Line', email: 'pip@x.ie' })).body;
  const rq = (await call('POST', '/requests', { client_id: c.id, title: 'EV charger', source: 'Google' })).body;
  let board = (await call('GET', '/pipeline')).body;
  let deal = board.deals.find((d) => d.request_id === rq.id);
  assert.equal(deal.stage, 'new');
  await call('PUT', `/requests/${rq.id}`, { assessment_start: new Date(Date.now() + 864e5).toISOString() });
  const q = (await call('POST', '/quotes', { client_id: c.id, request_id: rq.id, title: 'EV charger', items: [{ name: 'Charger', quantity: 1, unit_price: 1000 }] })).body;
  await call('POST', `/quotes/${q.id}/send`, {});
  board = (await call('GET', '/pipeline')).body;
  deal = board.deals.find((d) => d.request_id === rq.id);
  assert.equal(deal.stage, 'quote_sent');
  assert.equal(deal.quote_id, q.id);
  assert.equal(deal.value, 1135);
  assert.equal(board.deals.filter((d) => d.request_id === rq.id).length, 1, 'one deal per opportunity');
  await call('POST', `/quotes/${q.id}/convert`);
  deal = (await call('GET', `/deals/${deal.id}`)).body;
  assert.equal(deal.stage, 'won');
  assert.ok(deal.job_id);
  // manual moves
  const manual = (await call('POST', '/deals', { title: 'Office refit', client_id: c.id, value: 5000 })).body;
  await call('PUT', `/deals/${manual.id}`, { stage: 'lost', lost_reason: 'Price' });
  assert.equal((await call('GET', `/deals/${manual.id}`)).body.stage, 'lost');
});

test('payroll can be marked paid', async () => {
  const start = new Date(); start.setUTCHours(8, 0, 0, 0);
  const end = new Date(start.getTime() + 4 * 3600e3);
  const e = (await call('POST', '/timesheets', { start_at: start.toISOString(), end_at: end.toISOString() })).body;
  await call('POST', '/timesheets/approve', { ids: [e.id] });
  const day = start.toISOString().slice(0, 10);
  let row = (await call('GET', `/payroll?from=${day}&to=${day}`)).body.rows.find((r) => r.id === 1);
  assert.equal(row.status, 'unpaid');
  await call('POST', '/payroll/pay', { user_id: 1, from: day, to: day });
  row = (await call('GET', `/payroll?from=${day}&to=${day}`)).body.rows.find((r) => r.id === 1);
  assert.equal(row.status, 'paid');
});

test('client import and insights reports', async () => {
  const r = (await call('POST', '/clients/import', { rows: [
    { first_name: 'Imp', last_name: 'One', email: 'imp1@x.ie', street: '1 Rd', city: 'Galway', tags: 'landlord; EV' },
    { first_name: 'Dup', email: 'ann@x.ie' },
    { email: 'noname@x.ie' },
  ] })).body;
  assert.deepEqual(r, { created: 1, skipped: 1, duplicates: 1 });
  const ins = (await call('GET', '/insights')).body;
  for (const k of ['revenueBySource', 'revenueByArea', 'paymentMethods', 'quotes']) assert.ok(k in ins, k);
  assert.ok(ins.quotes.sent_count >= 1);
  const steps = (await call('GET', '/onboarding')).body;
  assert.ok(steps.find((s) => s.key === 'quote').done);
});

test('payment schedule raises one invoice per payment', async () => {
  const c = (await call('POST', '/clients', { first_name: 'Sched', email: 'sched@x.ie' })).body;
  const q = (await call('POST', '/quotes', { client_id: c.id, title: 'Rewire', items: [{ name: 'Rewire', quantity: 1, unit_price: 2000 }],
    milestones: [{ label: 'Deposit', kind: 'percent', value: 30 }, { label: 'Balance', kind: 'remainder' }] })).body;
  const quote = (await call('GET', `/quotes/${q.id}`)).body;
  assert.deepEqual(quote.milestones.map((m) => m.amount), [600, 1400]);
  await call('POST', `/quotes/${q.id}/send`, {});
  const token = quote.public_token;
  const hub = (await call('GET', `/hub/quote/${token}`, null, { cookie: '' })).body;
  assert.equal(hub.milestones.length, 2, 'client sees the schedule');
  const job = (await call('POST', `/quotes/${q.id}/convert`)).body;
  let j = (await call('GET', `/jobs/${job.id}`)).body;
  assert.equal(j.milestones.length, 2, 'schedule carried over to the job');
  const inv = (await call('POST', `/jobs/${job.id}/milestones/${j.milestones[0].id}/invoice`)).body;
  const i = (await call('GET', `/invoices/${inv.id}`)).body;
  assert.equal(i.totals.subtotal, 600);
  assert.equal((await call('POST', `/jobs/${job.id}/milestones/${j.milestones[0].id}/invoice`)).status, 400, 'no double invoicing');
  await call('POST', `/jobs/${job.id}/complete`);
  j = (await call('GET', `/jobs/${job.id}`)).body;
  assert.equal(j.display_status, 'requires_invoicing', 'balance still to invoice');
  await call('POST', `/jobs/${job.id}/milestones/${j.milestones[1].id}/invoice`);
  assert.equal((await call('GET', `/jobs/${job.id}`)).body.display_status, 'completed');
  // editing the schedule keeps the invoice links
  j = (await call('GET', `/jobs/${job.id}`)).body;
  await call('PUT', `/jobs/${job.id}/milestones`, { milestones: j.milestones.map((m) => ({ ...m, due_date: '2030-01-01' })) });
  assert.ok((await call('GET', `/jobs/${job.id}`)).body.milestones.every((m) => m.invoice));
});

test('import old quotes, jobs and invoices', async () => {
  const q = (await call('POST', '/import/quotes', { rows: [
    { number: '501', client_name: 'Old Client Ltd', client_email: 'old@x.ie', title: 'Board swap', date: '15/03/2025', status: 'Accepted', item: 'Board', quantity: '1', unit_price: '900' },
    { number: '501', client_name: 'Old Client Ltd', client_email: 'old@x.ie', title: 'Board swap', date: '15/03/2025', status: 'Accepted', item: 'RCBO', quantity: '2', unit_price: '€75.00' },
    { number: '502', client_name: 'Ann Lee', title: 'Sockets', date: '2025-04-01', status: 'declined', total: '300' },
  ] })).body;
  assert.deepEqual(q, { created: 2, skipped: 0, clients: 1 });
  const list = (await call('GET', '/quotes?status=all')).body;
  const q501 = list.find((x) => x.number === 501);
  assert.equal(q501.subtotal, 1050);
  assert.equal(q501.status, 'approved');
  assert.equal(list.find((x) => x.number === 502).client_name, 'Ann Lee', 'matched existing client by name');
  const inv = (await call('POST', '/import/invoices', { prices_include_tax: true, rows: [
    { number: '7001', client_email: 'old@x.ie', title: 'Board swap', date: '20/03/2025', status: 'Paid', total: '1050', paid_date: '30/03/2025' },
    { number: '7002', client_email: 'old@x.ie', title: 'Extra', date: '2025-05-01', status: 'Unpaid', total: '200', amount_paid: '50' },
  ] })).body;
  assert.equal(inv.created, 2);
  const invs = (await call('GET', '/invoices?status=all')).body;
  assert.equal(invs.find((x) => x.number === 7001).display_status, 'paid');
  assert.equal(invs.find((x) => x.number === 7002).balance, 150);
  const jobs = (await call('POST', '/import/jobs', { rows: [{ client_email: 'old@x.ie', title: 'Board swap', date: '2025-03-25', status: 'Completed', total: '1050' }] })).body;
  assert.equal(jobs.created, 1);
});

test('custom fields, product photos, shared files and map data', async () => {
  const f = (await call('POST', '/custom-fields', { entity: 'quote', label: 'Duration', field_type: 'text', show_to_client: 1 })).body;
  const hidden = (await call('POST', '/custom-fields', { entity: 'quote', label: 'Internal margin note', field_type: 'text' })).body;
  const c = (await call('POST', '/clients', { first_name: 'Cf', email: 'cf@x.ie', property: { street: '1 Main St', city: 'Cork', lat: 51.9, lng: -8.47 } })).body;
  const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const q = (await call('POST', '/quotes', { client_id: c.id, title: 'Custom', custom: { [f.id]: '2 days', [hidden.id]: 'secret' },
    items: [{ name: 'Panel', quantity: 1, unit_price: 100, image: photo }, { name: 'Bad', quantity: 1, unit_price: 1, image: 'javascript:alert(1)' }] })).body;
  const quote = (await call('GET', `/quotes/${q.id}`)).body;
  assert.equal(quote.custom[f.id], '2 days');
  assert.equal(quote.items[0].image, photo);
  assert.equal(quote.items[1].image, null, 'non-image data is dropped');
  await call('POST', `/quotes/${q.id}/send`, {});
  const hub = (await call('GET', `/hub/quote/${quote.public_token}`, null, { cookie: '' })).body;
  assert.deepEqual(hub.custom.map((x) => x.label), ['Duration'], 'only client-visible fields are shared');
  assert.equal(hub.items[0].image, photo);
  assert.deepEqual(hub.files, []);
  const p = (await call('POST', '/products', { name: 'Pictured', unit_price: 10, image: photo })).body;
  assert.equal((await call('GET', '/products')).body.find((x) => x.id === p.id).image, photo);
  const ins = (await call('GET', `/insights?from=2020-01-01`)).body;
  assert.ok(Array.isArray(ins.revenueMap.points));
  assert.equal(ins.revenueMap.geocoding, false);
});
