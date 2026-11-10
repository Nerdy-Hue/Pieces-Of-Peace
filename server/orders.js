import crypto from 'node:crypto';
import { findProduct, priceToCents } from './catalogue.js';
import { formatAmount } from './payfast.js';

export const PROVINCES = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'Northern Cape',
  'North West',
  'Western Cape',
];

export const PENDING_HOLD_MS = 2 * 60 * 60 * 1000;
const CARD_KEYS = new Set([
  'card', 'cardnumber', 'cardno', 'cardnum', 'cvv', 'cvc', 'pan',
  'expiry', 'expirymonth', 'expiryyear', 'ccv',
]);

export function newOrderId() {
  return `POP-${crypto.randomBytes(9).toString('hex')}`;
}

export function cleanText(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function hasCardFields(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return false;
  for (const [key, child] of Object.entries(value)) {
    const normalised = key.toLowerCase().replace(/[^a-z]/g, '');
    if (CARD_KEYS.has(normalised)) return true;
    if (child && typeof child === 'object' && hasCardFields(child, depth + 1)) return true;
  }
  return false;
}

function fail(status, error) {
  return { ok: false, status, error };
}

export function validateCustomer(input) {
  const customer = input || {};
  const name = cleanText(customer.name, 80);
  if (!/^[\p{L}][\p{L}\s'’.-]{1,79}$/u.test(name)) {
    return fail(400, 'Enter the name that should go on the parcel.');
  }
  const email = String(customer.email ?? '').trim().toLowerCase();
  if (email.length > 100 || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) {
    return fail(400, 'Enter a valid email address.');
  }
  const phone = normalizePhone(customer.phone);
  if (!phone) return fail(400, 'Enter a South African phone number.');
  const address = customer.address || {};
  const line1 = cleanText(address.line1, 100);
  const line2 = cleanText(address.line2, 100);
  const suburb = cleanText(address.suburb, 60);
  const city = cleanText(address.city, 60);
  const province = cleanText(address.province, 40);
  const postalCode = String(address.postalCode ?? '').trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N}\s'’.,#/-]{2,99}$/u.test(line1)) {
    return fail(400, 'Enter a street address.');
  }
  if (line2 && !/^[\p{L}\p{N}][\p{L}\p{N}\s'’.,#/-]{0,99}$/u.test(line2)) {
    return fail(400, 'Address line 2 has characters we cannot store.');
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N}\s'’.-]{1,59}$/u.test(suburb)) {
    return fail(400, 'Enter a suburb.');
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N}\s'’.-]{1,59}$/u.test(city)) {
    return fail(400, 'Enter a city.');
  }
  if (!PROVINCES.includes(province)) return fail(400, 'Choose a South African province.');
  if (!/^\d{4}$/.test(postalCode)) return fail(400, 'Enter a 4-digit postal code.');
  return {
    ok: true,
    customer: { name, email, phone, address: { line1, line2, suburb, city, province, postalCode } },
  };
}

export function normalizePhone(input) {
  let digits = String(input ?? '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+27')) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith('27') && digits.length === 11) digits = `0${digits.slice(2)}`;
  if (!/^0\d{9}$/.test(digits)) return null;
  return digits;
}

export function priceCart(items, catalogue) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
    return fail(400, 'Your bag is empty.');
  }
  const lines = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') return fail(400, 'One of the bag items is invalid.');
    const product = findProduct(catalogue, raw.id);
    if (!product) return fail(400, 'One of the pieces in your bag is no longer listed.');
    const unitCents = priceToCents(product.price);
    if (unitCents === null) {
      return fail(400, `${product.name} is not priced yet, so it cannot be ordered.`);
    }
    const qty = Number(raw.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
      return fail(400, `Choose a quantity from 1 to 10 for ${product.name}.`);
    }
    const variant = cleanText(raw.variant, 40);
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length && !variants.includes(variant)) {
      return fail(400, `Choose an option for ${product.name}.`);
    }
    if (!variants.length && variant) {
      return fail(400, `${product.name} does not have that option.`);
    }
    lines.push({
      id: String(product.id),
      sku: product.sku,
      name: product.name,
      qty,
      variant: variant || '',
      unitCents,
      lineCents: unitCents * qty,
      temuUrl: product.temuUrl || '',
      temuCost: product.temuCost ?? null,
      supplierSku: product.supplierSku || '',
      supplierNotes: product.supplierNotes || '',
    });
  }
  const totalCents = lines.reduce((sum, line) => sum + line.lineCents, 0);
  return { ok: true, lines, totalCents };
}

export function reservedQty(orders, productId, now) {
  const at = now instanceof Date ? now.getTime() : new Date(now).getTime();
  let count = 0;
  for (const order of orders) {
    const pendingFresh = order.status === 'pending' && at - Date.parse(order.createdAt) < PENDING_HOLD_MS;
    if (!pendingFresh && order.status !== 'paid') continue;
    for (const line of order.items || []) {
      if (String(line.id) === String(productId)) count += line.qty;
    }
  }
  return count;
}

export function checkStock(lines, orders, catalogue, now) {
  const wanted = new Map();
  for (const line of lines) {
    wanted.set(line.id, (wanted.get(line.id) || 0) + line.qty);
  }
  for (const [id, qty] of wanted) {
    const product = findProduct(catalogue, id);
    if (product.stock === null || product.stock === undefined) continue;
    const left = product.stock - reservedQty(orders, id, now);
    if (qty > left) {
      return left > 0
        ? `Only ${left} of ${product.name} can be ordered right now.`
        : `${product.name} is sold out.`;
    }
  }
  return null;
}

export function snapshotSupplier(order, catalogue) {
  for (const line of order.items) {
    const product = findProduct(catalogue, line.id);
    if (!product) continue;
    line.temuUrl = product.temuUrl || '';
    line.temuCost = product.temuCost ?? null;
    line.supplierSku = product.supplierSku || '';
    line.supplierNotes = product.supplierNotes || '';
  }
}

export function publicOrder(order) {
  return {
    id: order.id,
    status: order.status,
    amount: order.amount,
    currency: 'ZAR',
    paidAt: order.paidAt || null,
    items: (order.items || []).map((item) => ({
      name: item.name,
      qty: item.qty,
      variant: item.variant || '',
      lineTotal: formatAmount(item.lineCents),
    })),
  };
}

export function adminOrder(order) {
  return {
    id: order.id,
    createdAt: order.createdAt,
    paidAt: order.paidAt || null,
    status: order.status,
    amount: order.amount,
    currency: 'ZAR',
    pfPaymentId: order.pfPaymentId || '',
    customer: order.customer,
    items: order.items,
    fulfilled: Boolean(order.fulfilled),
    fulfilledAt: order.fulfilledAt || null,
    temuOrderNumber: order.temuOrderNumber || '',
    alertSentAt: order.alertSentAt || null,
    alertError: order.alertError || null,
    lastItn: order.lastItn || null,
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function ordersToCsv(orders) {
  const header = [
    'order_id', 'created_at', 'paid_at', 'status', 'customer_name', 'email', 'phone',
    'address', 'items', 'amount_zar', 'payfast_payment_id', 'fulfilled', 'temu_order_number',
    'temu_links', 'supplier_skus',
  ];
  const rows = [header.join(',')];
  for (const order of orders) {
    const address = order.customer?.address || {};
    const addressText = [address.line1, address.line2, address.suburb, address.city, address.province, address.postalCode]
      .filter(Boolean)
      .join(', ');
    const items = (order.items || [])
      .map((item) => `${item.qty} x ${item.name}${item.variant ? ` (${item.variant})` : ''}`)
      .join('; ');
    const links = (order.items || []).map((item) => item.temuUrl || '').join(' ');
    const skus = (order.items || []).map((item) => item.supplierSku || '').join(' ');
    const cells = [
      order.id,
      order.createdAt,
      order.paidAt || '',
      order.status,
      order.customer?.name || '',
      order.customer?.email || '',
      order.customer?.phone || '',
      addressText,
      items,
      order.amount,
      order.pfPaymentId || '',
      order.fulfilled ? 'yes' : 'no',
      order.temuOrderNumber || '',
      links,
      skus,
    ];
    rows.push(cells.map(csvCell).join(','));
  }
  return `${rows.join('\n')}\n`;
}

export function applyFulfilment(order, patch, now = new Date()) {
  if (!order) return fail(404, 'Order not found.');
  if (order.status !== 'paid') return fail(409, 'Only a paid order can be marked fulfilled.');
  if (patch.fulfilled !== undefined) {
    if (typeof patch.fulfilled !== 'boolean') return fail(400, 'Fulfilled must be true or false.');
    order.fulfilled = patch.fulfilled;
    order.fulfilledAt = patch.fulfilled ? (order.fulfilledAt || now.toISOString()) : null;
  }
  if (patch.temuOrderNumber !== undefined) {
    const number = cleanText(patch.temuOrderNumber, 64);
    if (number && !/^[A-Za-z0-9][A-Za-z0-9 _.:/-]*$/.test(number)) {
      return fail(400, 'The Temu order number has characters we cannot store.');
    }
    order.temuOrderNumber = number;
  }
  return { ok: true, order };
}
