import Database from 'better-sqlite3';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'voltline.db');
export const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

// Ordered list of migrations. Never edit an applied migration; append new ones.
const migrations = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'tech' CHECK (role IN ('owner','admin','office','tech')),
    color TEXT DEFAULT '#2563eb',
    hourly_cost REAL DEFAULT 0,
    licence_no TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE clients (
    id INTEGER PRIMARY KEY,
    first_name TEXT, last_name TEXT, company_name TEXT,
    email TEXT, phone TEXT,
    status TEXT NOT NULL DEFAULT 'lead' CHECK (status IN ('lead','active','archived')),
    client_type TEXT NOT NULL DEFAULT 'residential' CHECK (client_type IN ('residential','commercial')),
    tags TEXT NOT NULL DEFAULT '[]',
    lead_source TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE properties (
    id INTEGER PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    street TEXT, city TEXT, region TEXT, postcode TEXT, country TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    kind TEXT NOT NULL DEFAULT 'service' CHECK (kind IN ('service','material','labour')),
    unit_price REAL NOT NULL DEFAULT 0,
    unit_cost REAL NOT NULL DEFAULT 0,
    taxable INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE requests (
    id INTEGER PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    details TEXT,
    source TEXT,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','assessment','converted','archived')),
    assessment_start TEXT, assessment_end TEXT,
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE quote_templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    title TEXT, intro TEXT,
    items TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE quotes (
    id INTEGER PRIMARY KEY,
    number INTEGER NOT NULL UNIQUE,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
    request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    intro TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','approved','changes_requested','converted','archived')),
    discount REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0,
    deposit REAL NOT NULL DEFAULT 0,
    client_message TEXT,
    terms TEXT,
    valid_until TEXT,
    public_token TEXT UNIQUE,
    sent_at TEXT, approved_at TEXT, client_signature TEXT, client_feedback TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY,
    number INTEGER NOT NULL UNIQUE,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
    quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    instructions TEXT,
    job_type TEXT NOT NULL DEFAULT 'one_off' CHECK (job_type IN ('one_off','recurring')),
    recurrence TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
    billing TEXT NOT NULL DEFAULT 'on_completion' CHECK (billing IN ('on_completion','per_visit','none')),
    start_date TEXT, end_date TEXT,
    certificate_no TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE visits (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    title TEXT,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    anytime INTEGER NOT NULL DEFAULT 0,
    instructions TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed')),
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX visits_start ON visits(start_at);

  CREATE TABLE visit_assignments (
    visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (visit_id, user_id)
  );

  CREATE TABLE checklist_items (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    done_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    done_at TEXT,
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE line_items (
    id INTEGER PRIMARY KEY,
    parent_type TEXT NOT NULL CHECK (parent_type IN ('request','quote','job','invoice')),
    parent_id INTEGER NOT NULL,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    quantity REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    unit_cost REAL NOT NULL DEFAULT 0,
    optional INTEGER NOT NULL DEFAULT 0,
    selected INTEGER NOT NULL DEFAULT 1,
    is_text INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX line_items_parent ON line_items(parent_type, parent_id);

  CREATE TABLE invoices (
    id INTEGER PRIMARY KEY,
    number INTEGER NOT NULL UNIQUE,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
    job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','void')),
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    discount REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0,
    client_message TEXT,
    notes TEXT,
    public_token TEXT UNIQUE,
    sent_at TEXT, paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE payments (
    id INTEGER PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    method TEXT NOT NULL DEFAULT 'bank_transfer',
    reference TEXT,
    paid_on TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE expenses (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,
    amount REAL NOT NULL DEFAULT 0,
    date TEXT NOT NULL,
    job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reimbursable INTEGER NOT NULL DEFAULT 0,
    reimbursed INTEGER NOT NULL DEFAULT 0,
    supplier TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE time_entries (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    start_at TEXT NOT NULL,
    end_at TEXT,
    notes TEXT,
    approved INTEGER NOT NULL DEFAULT 0,
    approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX time_entries_user ON time_entries(user_id, start_at);

  CREATE TABLE notes (
    id INTEGER PRIMARY KEY,
    parent_type TEXT NOT NULL,
    parent_id INTEGER NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX notes_parent ON notes(parent_type, parent_id);

  CREATE TABLE attachments (
    id INTEGER PRIMARY KEY,
    parent_type TEXT NOT NULL,
    parent_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime TEXT, size INTEGER,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX attachments_parent ON attachments(parent_type, parent_id);

  CREATE TABLE campaigns (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    audience TEXT NOT NULL DEFAULT 'all',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent')),
    recipients INTEGER NOT NULL DEFAULT 0,
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE referrals (
    id INTEGER PRIMARY KEY,
    referrer_client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    referred_client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    reward TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','rewarded')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE outbox (
    id INTEGER PRIMARY KEY,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    related_type TEXT, related_id INTEGER,
    status TEXT NOT NULL DEFAULT 'queued',
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE activity (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    client_id INTEGER,
    action TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX activity_client ON activity(client_id);
  `,
  // 2 — CRM pipeline, document display options, terms, payroll status
  `
  CREATE TABLE deals (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
    quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
    job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','contacted','assessment','quote_sent','follow_up','won','lost')),
    value REAL NOT NULL DEFAULT 0,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    source TEXT,
    expected_close TEXT,
    next_step TEXT,
    next_step_at TEXT,
    lost_reason TEXT,
    sort REAL NOT NULL DEFAULT 0,
    stage_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    won_at TEXT, lost_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX deals_stage ON deals(stage);
  ALTER TABLE quote_templates ADD COLUMN client_message TEXT;
  ALTER TABLE quote_templates ADD COLUMN terms TEXT;
  ALTER TABLE quotes ADD COLUMN show_quantities INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE quotes ADD COLUMN show_unit_prices INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE quotes ADD COLUMN show_line_totals INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE invoices ADD COLUMN terms TEXT;
  ALTER TABLE invoices ADD COLUMN show_quantities INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE invoices ADD COLUMN show_unit_prices INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE invoices ADD COLUMN show_line_totals INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE requests ADD COLUMN requested_on TEXT;
  ALTER TABLE time_entries ADD COLUMN paid_at TEXT;
  ALTER TABLE expenses ADD COLUMN reimbursed_at TEXT;
  `,
  // 3 — line item photos, map coordinates, client-visible files, custom fields, payment schedules
  `
  ALTER TABLE products ADD COLUMN image TEXT;
  ALTER TABLE line_items ADD COLUMN image TEXT;
  ALTER TABLE properties ADD COLUMN lat REAL;
  ALTER TABLE properties ADD COLUMN lng REAL;
  ALTER TABLE properties ADD COLUMN geocoded_at TEXT;
  ALTER TABLE attachments ADD COLUMN client_visible INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE clients ADD COLUMN custom TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE requests ADD COLUMN custom TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE quotes ADD COLUMN custom TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE jobs ADD COLUMN custom TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE invoices ADD COLUMN custom TEXT NOT NULL DEFAULT '{}';
  CREATE TABLE custom_fields (
    id INTEGER PRIMARY KEY,
    entity TEXT NOT NULL CHECK (entity IN ('client','request','quote','job','invoice')),
    label TEXT NOT NULL,
    field_type TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text','number','date','select','checkbox')),
    options TEXT NOT NULL DEFAULT '[]',
    show_to_client INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE payment_milestones (
    id INTEGER PRIMARY KEY,
    parent_type TEXT NOT NULL CHECK (parent_type IN ('quote','job')),
    parent_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'percent' CHECK (kind IN ('percent','amount','remainder')),
    value REAL NOT NULL DEFAULT 0,
    due_date TEXT,
    invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX payment_milestones_parent ON payment_milestones(parent_type, parent_id);
  `,
];

export function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT DEFAULT (datetime(\'now\')))');
  const applied = new Set(db.prepare('SELECT id FROM _migrations').all().map((r) => r.id));
  migrations.forEach((sql, i) => {
    if (applied.has(i + 1)) return;
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(i + 1);
    })();
  });
}

// ---------- settings ----------
export const DEFAULT_SETTINGS = {
  company_name: 'My Electrical Ltd',
  company_email: '',
  company_phone: '',
  company_address: '',
  company_reg_no: '',
  vat_no: '',
  currency: 'EUR',
  locale: 'en-IE',
  tax_rate: '13.5',
  tax_label: 'VAT',
  invoice_terms_days: '14',
  quote_valid_days: '30',
  quote_terms: 'All work carried out by registered electrical contractors to current wiring regulations. Quote valid for 30 days.',
  invoice_message: 'Thank you for your business. Please pay by bank transfer using the invoice number as reference.',
  invoice_terms: 'Payment due within the agreed terms. Late payments may incur interest. All materials remain the property of the contractor until paid in full.',
  workdays: '1,2,3,4,5',
  bank_details: '',
  next_quote_number: '1001',
  next_job_number: '1001',
  next_invoice_number: '1001',
  workday_start: '08:00',
  workday_end: '17:00',
  public_url: '',
};

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (!r.key.startsWith('_')) s[r.key] = r.value;
  return s;
}

export function setSettings(obj) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => {
    for (const [k, v] of Object.entries(obj)) {
      if (k in DEFAULT_SETTINGS) stmt.run(k, v == null ? '' : String(v));
    }
  })();
}

/** Atomically take the next document number (quote/job/invoice). */
export function nextNumber(kind) {
  const key = `next_${kind}_number`;
  return db.transaction(() => {
    const current = Number(getSettings()[key]) || 1001;
    const table = kind === 'quote' ? 'quotes' : kind === 'job' ? 'jobs' : 'invoices';
    const max = db.prepare(`SELECT MAX(number) m FROM ${table}`).get().m || 0;
    const n = Math.max(current, max + 1);
    setSettings({ [key]: n + 1 });
    return n;
  })();
}

/** Secret for signing session cookies: SESSION_SECRET env, else generated once and stored. */
export function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const row = db.prepare("SELECT value FROM settings WHERE key = '_session_secret'").get();
  if (row) return row.value;
  const v = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT INTO settings (key, value) VALUES ('_session_secret', ?)").run(v);
  return v;
}

export function logActivity({ userId, entityType, entityId, clientId, action, summary }) {
  db.prepare('INSERT INTO activity (user_id, entity_type, entity_id, client_id, action, summary) VALUES (?,?,?,?,?,?)')
    .run(userId ?? null, entityType, entityId ?? null, clientId ?? null, action, summary);
}
