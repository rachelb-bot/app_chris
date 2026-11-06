import express from 'express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate, db } from './db.js';
import { loadUser } from './auth.js';
import core from './routes/core.js';
import crm from './routes/crm.js';
import work from './routes/work.js';
import money from './routes/money.js';
import insights from './routes/insights.js';
import hub from './routes/hub.js';
import pipeline, { backfillDeals } from './routes/pipeline.js';
import imports from './routes/imports.js';

migrate();
backfillDeals();

export const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.get('/healthz', (_req, res) => {
  db.prepare('SELECT 1').get();
  res.json({ ok: true });
});

// Public client hub routes first (no login), then authenticated API.
app.use('/api', hub);
app.use('/api', loadUser, core, crm, work, money, insights, pipeline, imports);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built web app (single-page app with client-side routing).
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Errors → JSON
app.use((err, _req, res, _next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error(err);
  let message = err.message || 'Something went wrong';
  if (String(err.code || '').startsWith('SQLITE_CONSTRAINT')) message = 'That change conflicts with existing data';
  res.status(status).json({ error: status >= 500 && process.env.NODE_ENV === 'production' ? 'Server error' : message });
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Voltline running on http://localhost:${port}`));
}
