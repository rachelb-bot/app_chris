// Vercel serverless entry point. Vercel has no persistent disk, so the database lives in /tmp
// and is filled with the demo company on each cold start. Use this for previews only —
// for real use, deploy with the Dockerfile on a host with a persistent volume (see README).
process.env.DATA_DIR ||= '/tmp/voltline';
process.env.PUBLIC_URL ||= process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '';
// Each serverless instance has its own /tmp, so the session-signing key must be shared via env.
process.env.SESSION_SECRET ||= 'voltline-preview-only-set-SESSION_SECRET-in-vercel';

const { app } = await import('../server/index.js');
const { db } = await import('../server/db.js');
if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
  const { seedDemo } = await import('../server/seed-demo.js');
  seedDemo();
}

export default app;
