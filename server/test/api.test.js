// End-to-end API test against a throwaway database. Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voltline-test-'));
process.env.DATA_DIR = dir;
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
