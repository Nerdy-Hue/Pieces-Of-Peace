import { getCatalogue } from './catalogue.js';
import { sendOrderAlert } from './mail.js';
import { snapshotSupplier } from './orders.js';
import {
  amountsMatch,
  bodyWithoutSignature,
  ipInPayfastRanges,
  pairsToMap,
  parseFormBody,
  payfastHosts,
  signPairs,
  timingSafeEqualText,
} from './payfast.js';

/**
 * PayFast ITN checks, in order:
 * 1. Signature over the posted fields (passphrase included, blank fields excluded).
 * 2. Source IP is in PayFast's published ranges.
 * 3. amount_gross matches the total stored when the order was created.
 * 4. PayFast's validate endpoint returns exactly VALID.
 * 5. payment_status is COMPLETE.
 * The order is marked paid only after all of those pass.
 */
export async function processItn({
  rawBody,
  sourceIp,
  store,
  env,
  fetchImpl = globalThis.fetch,
  sendAlert = sendOrderAlert,
  catalogue = getCatalogue(),
  ipAllowed = ipInPayfastRanges,
  now = new Date(),
}) {
  let pairs;
  try {
    pairs = parseFormBody(rawBody);
  } catch {
    return { ok: false, status: 200, reason: 'bad-body' };
  }
  const data = pairsToMap(pairs);
  const provided = data.get('signature') || '';
  const expected = signPairs(pairs, env.PAYFAST_PASSPHRASE);
  if (!provided || !timingSafeEqualText(expected, provided)) {
    return { ok: false, status: 200, reason: 'bad-signature' };
  }
  if (!(await ipAllowed(sourceIp))) {
    return { ok: false, status: 200, reason: 'bad-ip' };
  }

  const orderId = data.get('m_payment_id') || '';
  const order = orderId ? await store.get(orderId) : null;
  if (!order) return { ok: false, status: 200, reason: 'unknown-order' };

  const merchantOk = timingSafeEqualText(data.get('merchant_id') || '', env.PAYFAST_MERCHANT_ID);
  if (!merchantOk) {
    order.lastItn = { at: now.toISOString(), result: 'bad-merchant' };
    await store.put(order.id, order);
    return { ok: false, status: 200, reason: 'bad-merchant' };
  }
  if (!amountsMatch(order.amount, data.get('amount_gross'))) {
    order.lastItn = { at: now.toISOString(), result: 'amount-mismatch' };
    await store.put(order.id, order);
    return { ok: false, status: 200, reason: 'amount-mismatch' };
  }

  const { validateUrl } = payfastHosts(env.PAYFAST_MODE);
  const validateBody = bodyWithoutSignature(rawBody);
  let confirmation;
  try {
    const response = await fetchImpl(validateUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: validateBody,
      signal: AbortSignal.timeout(10000),
    });
    confirmation = (await response.text()).trim();
    if (!response.ok) {
      order.lastItn = { at: now.toISOString(), result: 'validate-http' };
      await store.put(order.id, order);
      return { ok: false, status: 500, reason: 'validate-http' };
    }
  } catch (err) {
    console.error('payfast validate failed', order.id, err?.message || err);
    return { ok: false, status: 500, reason: 'validate-unreachable' };
  }
  if (confirmation !== 'VALID') {
    order.lastItn = { at: now.toISOString(), result: 'validate-rejected' };
    await store.put(order.id, order);
    return { ok: false, status: 200, reason: 'validate-rejected' };
  }

  const paymentStatus = data.get('payment_status') || '';
  if (paymentStatus !== 'COMPLETE') {
    if (paymentStatus === 'CANCELLED' && order.status !== 'paid') order.status = 'cancelled';
    order.paymentStatus = paymentStatus;
    order.lastItn = { at: now.toISOString(), result: paymentStatus || 'not-complete' };
    await store.put(order.id, order);
    return { ok: false, status: 200, reason: 'not-complete' };
  }

  if (order.status === 'paid') {
    return { ok: true, status: 200, reason: 'already-paid', order };
  }

  snapshotSupplier(order, catalogue);
  order.status = 'paid';
  order.paymentStatus = 'COMPLETE';
  order.pfPaymentId = data.get('pf_payment_id') || '';
  order.paidAt = now.toISOString();
  order.amountPaid = data.get('amount_gross') || order.amount;
  order.lastItn = { at: now.toISOString(), result: 'paid' };
  const alert = await sendAlert(order, env);
  order.alertSentAt = alert.sent ? now.toISOString() : null;
  order.alertError = alert.sent ? null : alert.reason;
  await store.put(order.id, order);
  return { ok: true, status: 200, reason: 'paid', order };
}
