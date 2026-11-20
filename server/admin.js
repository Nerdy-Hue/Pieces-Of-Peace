import crypto from 'node:crypto';
import { timingSafeEqualText } from './payfast.js';

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export function adminConfigured(env) {
  return Boolean(env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length >= 8);
}

export function createAdminToken(password, env, now = Date.now()) {
  if (!adminConfigured(env)) return null;
  if (!timingSafeEqualText(password, env.ADMIN_PASSWORD)) return null;
  const exp = now + TOKEN_TTL_MS;
  const payload = String(exp);
  const sig = crypto.createHmac('sha256', env.ADMIN_PASSWORD).update(payload).digest('base64url');
  return { token: `${payload}.${sig}`, expiresAt: new Date(exp).toISOString() };
}

export function verifyAdminToken(token, env, now = Date.now()) {
  if (!adminConfigured(env)) return false;
  const text = String(token || '');
  const dot = text.indexOf('.');
  if (dot <= 0) return false;
  const payload = text.slice(0, dot);
  const sig = text.slice(dot + 1);
  const exp = Number(payload);
  if (!Number.isFinite(exp) || exp < now) return false;
  const expected = crypto.createHmac('sha256', env.ADMIN_PASSWORD).update(payload).digest('base64url');
  return timingSafeEqualText(sig, expected);
}

export function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}
