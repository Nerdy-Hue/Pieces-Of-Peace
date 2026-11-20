/**
 * PayFast custom-checkout signature and ITN helpers.
 *
 * Signature rules follow PayFast's documented PHP generateSignature():
 * non-blank fields, in the order given (checkout attribute order, not A–Z),
 * PHP urlencode (spaces as "+", uppercase hex), then MD5.
 * The passphrase is appended as &passphrase=... and is never a form field.
 *
 * Docs: https://developers.payfast.co.za/docs/#step_2_create_security_signature
 */

import crypto from 'node:crypto';
import { lookup } from 'node:dns/promises';

/** Published PayFast egress ranges (docs: "Ports and IP addresses"). */
export const PAYFAST_CIDRS = [
  ['197.97.145.144', 28],
  ['41.74.179.192', 27],
  ['102.216.36.0', 28],
  ['102.216.36.128', 28],
  ['144.126.193.139', 32],
];

export const PAYFAST_HOSTS = [
  'www.payfast.co.za',
  'sandbox.payfast.co.za',
  'w1w.payfast.co.za',
  'w2w.payfast.co.za',
];

/** Checkout field order from the PayFast custom integration docs. */
export const CHECKOUT_FIELD_ORDER = [
  'merchant_id',
  'merchant_key',
  'return_url',
  'cancel_url',
  'notify_url',
  'name_first',
  'name_last',
  'email_address',
  'cell_number',
  'm_payment_id',
  'amount',
  'item_name',
  'item_description',
  'custom_int1',
  'custom_int2',
  'custom_int3',
  'custom_int4',
  'custom_int5',
  'custom_str1',
  'custom_str2',
  'custom_str3',
  'custom_str4',
  'custom_str5',
  'email_confirmation',
  'confirmation_address',
  'payment_method',
];

export function payfastHosts(mode) {
  const live = mode === 'live';
  return {
    processUrl: live ? 'https://www.payfast.co.za/eng/process' : 'https://sandbox.payfast.co.za/eng/process',
    validateUrl: live ? 'https://www.payfast.co.za/eng/query/validate' : 'https://sandbox.payfast.co.za/eng/query/validate',
  };
}

/** PHP urlencode: RFC 1738, spaces as "+", hex digits uppercase. */
export function phpUrlencode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*~]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
}

export function phpUrldecode(value) {
  return decodeURIComponent(String(value).replace(/\+/g, ' '));
}

export function buildParamString(pairs, { skipBlank = true } = {}) {
  const parts = [];
  for (const [key, value] of pairs) {
    if (key === 'signature') continue;
    if (value === undefined || value === null) continue;
    const str = String(value);
    const trimmed = str.trim();
    if (skipBlank && trimmed === '') continue;
    parts.push(`${key}=${phpUrlencode(skipBlank ? trimmed : str)}`);
  }
  return parts.join('&');
}

/**
 * @param {string|null|undefined} passphrase  null/undefined/'' means the dashboard has no passphrase
 */
export function signParamString(paramString, passphrase) {
  let signed = paramString;
  if (passphrase !== undefined && passphrase !== null && String(passphrase) !== '') {
    signed += `&passphrase=${phpUrlencode(String(passphrase).trim())}`;
  }
  return crypto.createHash('md5').update(signed).digest('hex');
}

export function signPairs(pairs, passphrase) {
  return signParamString(buildParamString(pairs), passphrase);
}

export function timingSafeEqualText(a, b) {
  const left = crypto.createHash('sha256').update(String(a)).digest();
  const right = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}

export function parseFormBody(raw) {
  const pairs = [];
  if (!raw) return pairs;
  for (const part of String(raw).split('&')) {
    if (part === '') continue;
    const eq = part.indexOf('=');
    const keyPart = eq === -1 ? part : part.slice(0, eq);
    const valPart = eq === -1 ? '' : part.slice(eq + 1);
    pairs.push([phpUrldecode(keyPart), phpUrldecode(valPart)]);
  }
  return pairs;
}

export function bodyWithoutSignature(raw) {
  return String(raw || '')
    .split('&')
    .filter((part) => {
      if (part === '') return false;
      const eq = part.indexOf('=');
      const keyPart = eq === -1 ? part : part.slice(0, eq);
      try {
        return phpUrldecode(keyPart) !== 'signature';
      } catch {
        return false;
      }
    })
    .join('&');
}

export function pairsToMap(pairs) {
  const map = new Map();
  for (const [key, value] of pairs) map.set(key, value);
  return map;
}

export function normalizeIp(ip) {
  if (!ip) return '';
  let s = String(ip).trim();
  if (s.startsWith('::ffff:')) s = s.slice('::ffff:'.length);
  return s;
}

function ipv4ToInt(ip) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

export function ipInCidr(ip, base, bits) {
  const left = ipv4ToInt(ip);
  const right = ipv4ToInt(base);
  if (left === null || right === null) return false;
  if (bits === 0) return true;
  const mask = bits >= 32 ? 0xffffffff : ((~0 << (32 - bits)) >>> 0);
  return (left & mask) === (right & mask);
}

export function ipInPayfastRanges(ip) {
  const normalized = normalizeIp(ip);
  return PAYFAST_CIDRS.some(([base, bits]) => ipInCidr(normalized, base, bits));
}

let dnsCache = { at: 0, ips: new Set() };

async function resolvePayfastIps() {
  const ips = new Set();
  await Promise.all(PAYFAST_HOSTS.map(async (host) => {
    try {
      const records = await lookup(host, { all: true });
      for (const record of records) ips.add(normalizeIp(record.address));
    } catch {
      /* Ranges still apply when DNS is unavailable. */
    }
  }));
  return ips;
}

/** Published ranges, plus a short-lived DNS lookup of PayFast's documented hostnames. */
export async function isPayfastSource(ip) {
  if (ipInPayfastRanges(ip)) return true;
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  const now = Date.now();
  if (now - dnsCache.at > 10 * 60 * 1000) {
    const ips = await Promise.race([
      resolvePayfastIps(),
      new Promise((resolve) => setTimeout(() => resolve(dnsCache.ips), 1500)),
    ]);
    dnsCache = { at: now, ips };
  }
  return dnsCache.ips.has(normalized);
}

export function formatAmount(cents) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/** Parse a PayFast amount (gross) to integer cents. Rejects more than 2 decimal places. */
export function parseAmountToCents(value) {
  const s = String(value ?? '').trim();
  const withCents = /^(\d+)\.(\d{2})$/.exec(s);
  if (withCents) return Number(withCents[1]) * 100 + Number(withCents[2]);
  const oneDecimal = /^(\d+)\.(\d)$/.exec(s);
  if (oneDecimal) return Number(oneDecimal[1]) * 100 + Number(oneDecimal[2]) * 10;
  const whole = /^(\d+)$/.exec(s);
  if (whole) return Number(whole[1]) * 100;
  return null;
}

export function amountsMatch(expectedAmount, gross) {
  const expected = parseAmountToCents(expectedAmount);
  const paid = parseAmountToCents(gross);
  if (expected === null || paid === null) return false;
  return expected === paid;
}
