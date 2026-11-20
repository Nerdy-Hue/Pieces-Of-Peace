import { existsSync, readFileSync } from 'node:fs';

export function loadDotEnv(file = '.env') {
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function readEnv(src = process.env) {
  const mode = String(src.PAYFAST_MODE || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';
  return {
    PAYFAST_MODE: mode,
    PAYFAST_MERCHANT_ID: src.PAYFAST_MERCHANT_ID || '',
    PAYFAST_MERCHANT_KEY: src.PAYFAST_MERCHANT_KEY || '',
    PAYFAST_PASSPHRASE: src.PAYFAST_PASSPHRASE ? src.PAYFAST_PASSPHRASE : null,
    ADMIN_PASSWORD: src.ADMIN_PASSWORD || '',
    ORDER_ALERT_EMAIL: src.ORDER_ALERT_EMAIL || '',
    SITE_URL: src.SITE_URL || '',
    SMTP_HOST: src.SMTP_HOST || '',
    SMTP_PORT: src.SMTP_PORT || '587',
    SMTP_USER: src.SMTP_USER || '',
    SMTP_PASS: src.SMTP_PASS || '',
    SMTP_FROM: src.SMTP_FROM || '',
    ORDER_STORE: src.ORDER_STORE || '',
  };
}

export function checkOrigin(origin, env) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return { ok: false, error: 'Checkout is only available over HTTPS.' };
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !local) {
    return { ok: false, error: 'Checkout is only available over HTTPS.' };
  }
  if (env.PAYFAST_MODE === 'live' && url.protocol !== 'https:') {
    return { ok: false, error: 'Live payments require HTTPS.' };
  }
  return { ok: true, origin: url.origin };
}

export function requestOrigin(request, env) {
  if (env.SITE_URL) {
    const parsed = checkOrigin(env.SITE_URL, env);
    if (!parsed.ok) return env.SITE_URL;
    return parsed.origin;
  }
  if (process.env.NETLIFY) {
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    return `${proto}://${host}`;
  }
  return new URL(request.url).origin;
}
