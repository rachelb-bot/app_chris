import nodemailer from 'nodemailer';
import { db, getSettings } from './db.js';

let transport = null;
if (process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}
export const emailEnabled = () => !!transport;

/**
 * Sends an email (when SMTP is configured) and always records it in the outbox,
 * so there is one log of every message sent to a client.
 */
export async function sendEmail({ to, subject, body, relatedType, relatedId }) {
  if (!to) return { status: 'skipped', error: 'No email address' };
  const id = db.prepare('INSERT INTO outbox (to_email, subject, body, related_type, related_id) VALUES (?,?,?,?,?)')
    .run(to, subject, body, relatedType || null, relatedId || null).lastInsertRowid;
  if (!transport) {
    db.prepare("UPDATE outbox SET status = 'logged' WHERE id = ?").run(id);
    return { status: 'logged' };
  }
  const s = getSettings();
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM || `"${s.company_name}" <${s.company_email || process.env.SMTP_USER}>`,
      replyTo: s.company_email || undefined,
      to, subject, text: body,
    });
    db.prepare("UPDATE outbox SET status = 'sent' WHERE id = ?").run(id);
    return { status: 'sent' };
  } catch (e) {
    db.prepare("UPDATE outbox SET status = 'failed', error = ? WHERE id = ?").run(String(e.message), id);
    return { status: 'failed', error: e.message };
  }
}
