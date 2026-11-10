import { getCatalogue } from './catalogue.js';
import { checkOrigin } from './env.js';
import { checkStock, hasCardFields, newOrderId, priceCart, validateCustomer } from './orders.js';
import { CHECKOUT_FIELD_ORDER, formatAmount, payfastHosts, signPairs } from './payfast.js';

const MAX_CENTS = 100_000_000;

export function splitName(full) {
  const parts = String(full).split(' ').filter(Boolean);
  if (parts.length <= 1) {
    const only = (parts[0] || '').slice(0, 100);
    return { first: only, last: only };
  }
  return {
    first: parts.slice(0, -1).join(' ').slice(0, 100),
    last: parts[parts.length - 1].slice(0, 100),
  };
}

export function buildCheckoutFields({ order, customer, env, origin }) {
  const names = splitName(customer.name);
  const values = {
    merchant_id: env.PAYFAST_MERCHANT_ID,
    merchant_key: env.PAYFAST_MERCHANT_KEY,
    return_url: `${origin}/return.html?order=${encodeURIComponent(order.id)}`,
    cancel_url: `${origin}/cancel.html`,
    notify_url: `${origin}/api/payfast/itn`,
    name_first: names.first,
    name_last: names.last,
    email_address: customer.email,
    cell_number: customer.phone,
    m_payment_id: order.id,
    amount: order.amount,
    item_name: `Pieces of Peace ${order.id}`.slice(0, 100),
    item_description: order.items
      .map((item) => `${item.qty} x ${item.name}${item.variant ? ` (${item.variant})` : ''}`)
      .join(', ')
      .slice(0, 255),
    custom_str1: order.id,
  };
  if (env.ORDER_ALERT_EMAIL) {
    values.email_confirmation = '1';
    values.confirmation_address = env.ORDER_ALERT_EMAIL;
  }
  const pairs = [];
  for (const key of CHECKOUT_FIELD_ORDER) {
    if (values[key] === undefined || values[key] === null) continue;
    const trimmed = String(values[key]).trim();
    if (!trimmed) continue;
    pairs.push([key, trimmed]);
  }
  const signature = signPairs(pairs, env.PAYFAST_PASSPHRASE);
  pairs.push(['signature', signature]);
  return pairs;
}

export async function createCheckout({
  body,
  store,
  env,
  origin,
  catalogue = getCatalogue(),
  now = new Date(),
}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { status: 400, body: { error: 'Order could not be read.' } };
  }
  if (hasCardFields(body)) {
    return { status: 400, body: { error: 'Card details must be entered on PayFast, not on this site.' } };
  }
  if (body.company || body.website) {
    return { status: 400, body: { error: 'Order could not be placed.' } };
  }
  const secure = checkOrigin(origin, env);
  if (!secure.ok) return { status: 400, body: { error: secure.error } };
  if (!env.PAYFAST_MERCHANT_ID || !env.PAYFAST_MERCHANT_KEY) {
    return { status: 503, body: { error: 'PayFast is not configured yet.' } };
  }

  const customerResult = validateCustomer(body.customer);
  if (!customerResult.ok) return { status: customerResult.status, body: { error: customerResult.error } };

  const priced = priceCart(body.items, catalogue);
  if (!priced.ok) return { status: priced.status, body: { error: priced.error } };

  const existing = await store.list();
  const stockError = checkStock(priced.lines, existing, catalogue, now);
  if (stockError) return { status: 409, body: { error: stockError } };

  const minimum = env.PAYFAST_MODE === 'live' ? 500 : 1;
  if (priced.totalCents < minimum) {
    const error = env.PAYFAST_MODE === 'live'
      ? 'PayFast live payments must be at least R5.00.'
      : 'Order total must be greater than zero.';
    return { status: 400, body: { error } };
  }
  if (priced.totalCents > MAX_CENTS) {
    return { status: 400, body: { error: 'That order is larger than we can take online.' } };
  }

  const order = {
    id: newOrderId(),
    createdAt: now.toISOString(),
    status: 'pending',
    amount: formatAmount(priced.totalCents),
    currency: 'ZAR',
    customer: customerResult.customer,
    items: priced.lines,
    pfPaymentId: '',
    paidAt: null,
    fulfilled: false,
    fulfilledAt: null,
    temuOrderNumber: '',
    alertSentAt: null,
    alertError: null,
    lastItn: null,
  };
  await store.put(order.id, order);

  const fields = buildCheckoutFields({
    order,
    customer: customerResult.customer,
    env,
    origin: secure.origin,
  });
  const { processUrl } = payfastHosts(env.PAYFAST_MODE);
  return {
    status: 200,
    body: {
      orderId: order.id,
      amount: order.amount,
      currency: 'ZAR',
      processUrl,
      fields,
      items: order.items.map((item) => ({
        name: item.name,
        qty: item.qty,
        variant: item.variant,
        lineTotal: formatAmount(item.lineCents),
      })),
    },
  };
}
