# Voltline

The single operations platform and source of truth for an electrical contracting company: clients, requests, quotes, jobs, scheduling, invoices, payments, expenses, timesheets, payroll, marketing and reporting. Everything is stored in **one SQLite database file**.

## What's in it

| Area | What it does |
|---|---|
| **Home** | Workflow overview (requests → quotes → jobs → invoices), today's appointments, receivables, upcoming jobs, revenue, recent activity |
| **Schedule** | Month / week / day calendar of visits and on-site assessments, team filter, drag to reschedule, drag unscheduled jobs onto the calendar |
| **Clients** | Leads & active clients, multiple properties, tags, lead source, billing history, activity, notes, files, merge duplicates |
| **Requests** | Work enquiries, on-site assessment booking, convert to quote or job, plus a **public online booking form** (`/hub/book`) |
| **Quotes** | Electrical quote templates, optional line items, deposit, margin, email to client, **online approval with signature**, convert to job |
| **Jobs** | One-off & recurring jobs, visits with assigned electricians, on-site safety checklist, photos/certs, live **job costing** (materials, labour from timesheets, expenses) |
| **Invoices** | From a job in one click or manually, VAT, discounts, send, client view link, partial payments, overdue tracking, void |
| **Expenses** | Receipts, link to job, reimbursable tracking |
| **Timesheets** | Clock in/out from the top bar, manual entries, approval, payroll summary + CSV |
| **Marketing** | Lead-source performance, email campaigns to client segments, referral tracking |
| **Insights** | Leads, conversions, revenue (12 months), P&L per job, cashflow, payment times, lead funnel |
| **Settings** | Company & VAT details, bank details, numbering, team & roles, products/services catalogue, quote templates, data export, email log |

**Roles:** Owner / Admin (everything), Office (all client & money work), Electrician (their schedule, jobs, checklist, time and expenses only — no prices or financials). The server enforces these permissions, not just the menus.

## Run locally

Requires Node.js 20+.

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Open http://localhost:3000 and create your company account. To explore with sample data first instead:

```bash
npm run seed:demo
```

Then sign in with `demo@voltline.app` / `demo1234`.

For development with hot reload (API on :3000, UI on :5173):

```bash
npm run dev
```

Run the API test suite:

```bash
npm test
```

## Deploy

It's one Node process with one data folder (`DATA_DIR`) that holds the database and uploaded files. **Put that folder on a persistent volume and back it up.**

**Docker (any VPS, e.g. Hetzner / DigitalOcean / Lightsail):**

```bash
cp .env.example .env
```

```bash
docker compose up -d --build
```

**Render / Railway / Fly.io:** deploy from the repo using the included `Dockerfile`, attach a persistent disk/volume mounted at `/data`, and set `PUBLIC_URL` (plus `SMTP_*` if you want email). Health check path: `/healthz`.

Put it behind HTTPS (your host normally does this). Sessions use secure cookies in production; set `COOKIE_SECURE=false` only when serving over plain HTTP on a private network.

### Vercel (preview only)

The repo includes `vercel.json` and `api/index.js`, so you can import it into Vercel as-is. Set a `SESSION_SECRET` environment variable (any long random string).

Vercel has no persistent disk. On Vercel the database lives in temporary storage and is reloaded with the **demo company** whenever a new server instance starts. Changes you make there **will not last**. Use it to click around and share a preview, and use the Docker route above for real use.

### Configuration

All settings are optional environment variables; see `.env.example`.

- `SESSION_SECRET`: key for signing login cookies (generated and stored automatically if unset; **required** on Vercel/multi-instance hosts)
- `DATA_DIR`: where `voltline.db` and `uploads/` live (default `./data`)
- `PUBLIC_URL`: base URL used in links you email to clients
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: outgoing email. Without them, emails are recorded in Settings → Data & email log and documents are still marked as sent, so you can copy the client link and send it yourself.

### Backups

- Live: copy the `DATA_DIR` folder. SQLite runs in WAL mode, so for a consistent hot copy use `sqlite3 data/voltline.db ".backup backup.db"`.
- Portable: Settings → Data → **Export all data** downloads every record as JSON.

## Project layout

```
server/            Express API + SQLite (better-sqlite3)
  db.js            schema & migrations (append-only), settings, numbering
  routes/          core (auth, team, search, files), crm, work (quotes/jobs/schedule), money, insights, hub (public)
  seed-defaults.js starter electrical catalogue + quote templates
  seed-demo.js     sample company
web/               React single-page app (Vite)
  pages/           one file per area
  hub/             public client pages (quote approval, invoice, booking form)
```

To change the schema, add a new SQL string to the end of the `migrations` array in `server/db.js`. It runs automatically on the next start.
