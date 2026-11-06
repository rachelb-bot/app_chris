import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db, sessionSecret } from './db.js';
import { HttpError } from './lib.js';

const SESSION_DAYS = 30;
export const COOKIE = 'vl_session';

export function hashPassword(pw) {
  if (!pw || String(pw).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  return bcrypt.hashSync(String(pw), 10);
}
export const checkPassword = (pw, hash) => bcrypt.compareSync(String(pw || ''), hash);

const sign = (payload) => crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');

/** Session = signed cookie "userId.expiryMs.signature" — no server-side state, so it works on multiple instances. */
export function createSession(res, userId) {
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  const payload = `${userId}.${expires.getTime()}`;
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true, sameSite: 'lax', expires,
    secure: process.env.COOKIE_SECURE === 'true' || (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false'),
  });
}

function readSession(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3) return null;
  const [uid, exp, sig] = parts;
  const expected = sign(`${uid}.${exp}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  return Number(uid);
}

export function destroySession(req, res) {
  res.clearCookie(COOKIE);
}

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

/** Attaches req.user when a valid session cookie is present. */
export function loadUser(req, _res, next) {
  const uid = readSession(req.cookies?.[COOKIE]);
  if (uid) {
    const row = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(uid);
    if (row) req.user = publicUser(row);
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in'));
  next();
}

const RANK = { tech: 1, office: 2, admin: 3, owner: 4 };
/** Require at least the given role (tech < office < admin < owner). */
export const requireRole = (role) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in'));
  if ((RANK[req.user.role] || 0) < RANK[role]) return next(new HttpError(403, 'You do not have permission to do that'));
  next();
};
export const isOffice = (user) => (RANK[user?.role] || 0) >= RANK.office;
