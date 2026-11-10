import { formatAmount } from './payfast.js';

function money(cents) {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return 'not set';
  return `R${formatAmount(cents)}`;
}

function supplierCost(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'not set';
  const cents = Math.round(value * 100);
  return `R${formatAmount(cents)}`;
}

function oneLine(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

export function buildAlertText(order) {
  const address = order.customer.address;
  const lines = [
    `Pieces of Peace — paid order ${order.id}`,
    '',
    `Amount paid: R${order.amount}`,
    `PayFast payment id: ${order.pfPaymentId || '(missing)'}`,
    '',
    'Place this order on Temu and ship it straight to the customer:',
    '',
    oneLine(order.customer.name),
    oneLine(order.customer.email),
    oneLine(order.customer.phone),
    oneLine(address.line1),
    address.line2 ? oneLine(address.line2) : null,
    oneLine(address.suburb),
    `${oneLine(address.city)}, ${oneLine(address.province)}`,
    oneLine(address.postalCode),
    'South Africa',
    '',
    'Items:',
  ].filter((line) => line !== null);

  order.items.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${oneLine(item.name)} (${oneLine(item.sku)})`,
      `   Qty: ${item.qty}`,
      `   Variant: ${item.variant ? oneLine(item.variant) : '—'}`,
      `   Temu: ${item.temuUrl ? oneLine(item.temuUrl) : 'NOT SET — add temuUrl for this product in data/catalogue.json before ordering.'}`,
      `   Supplier SKU: ${item.supplierSku ? oneLine(item.supplierSku) : 'not set'}`,
      `   Supplier notes: ${item.supplierNotes ? oneLine(item.supplierNotes) : 'not set'}`,
      `   Supplier cost (yours, not charged to the customer): ${supplierCost(item.temuCost)}`,
      `   Customer line total: ${money(item.lineCents)}`,
    );
  });

  lines.push(
    '',
    'Mark the order fulfilled, and save the Temu order number, on the admin orders page (/admin.html).',
  );
  return lines.join('\n');
}

async function smtpSend({ env, to, subject, text }) {
  const nodemailer = (await import('nodemailer')).default;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: String(env.SMTP_PORT) === '465',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: 10000,
    socketTimeout: 10000,
  });
  await transport.sendMail({
    from: env.SMTP_FROM,
    to,
    subject,
    text,
  });
}

export async function sendOrderAlert(order, env, send = smtpSend) {
  const text = buildAlertText(order);
  if (!env.ORDER_ALERT_EMAIL) {
    return { sent: false, reason: 'ORDER_ALERT_EMAIL is not set' };
  }
  if (!env.SMTP_HOST || !env.SMTP_FROM) {
    return { sent: false, reason: 'SMTP is not configured' };
  }
  try {
    await send({
      env,
      to: env.ORDER_ALERT_EMAIL,
      subject: `Pieces of Peace paid order ${order.id}`,
      text,
    });
    return { sent: true, reason: null };
  } catch (err) {
    console.error('order alert email failed', order.id, err?.message || err);
    return { sent: false, reason: 'Email could not be sent' };
  }
}
