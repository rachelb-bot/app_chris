import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { HttpError, token } from './lib.js';

const SESSION_DAYS = 30;
export const COOKIE = 'vl_session';

export function hashPassword(pw) {
  if (!pw || String(pw).length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  return bcrypt.hashSync(String(pw), 10);
}
export const checkPassword = (pw, hash) => bcrypt.compareSync(String(pw || ''), hash);

export function createSession(res, userId) {
  const t = token(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(t, userId, expires.toISOString());
  res.cookie(COOKIE, t, {
    httpOnly: true, sameSite: 'lax', expires,
    secure: process.env.COOKIE_SECURE === 'true' || (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false'),
  });
}

export function destroySession(req, res) {
  const t = req.cookies?.[COOKIE];
  if (t) db.prepare('DELETE FROM sessions WHERE token = ?').run(t);
  res.clearCookie(COOKIE);
}

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

/** Attaches req.user when a valid session cookie is present. */
export function loadUser(req, _res, next) {
  const t = req.cookies?.[COOKIE];
  if (t) {
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`).get(t, new Date().toISOString());
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
