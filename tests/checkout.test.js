import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCatalogue } from '../server/catalogue.js';
import { createCheckout } from '../server/checkout.js';
import { handleApi } from '../server/http.js';
import { processItn } from '../server/itn.js';
import { buildAlertText, sendOrderAlert } from '../server/mail.js';
import { publicOrder } from '../server/orders.js';
import { phpUrlencode, signPairs } from '../server/payfast.js';
import { memoryStore } from '../server/store.js';

const env = {
  PAYFAST_MODE: 'sandbox',
  PAYFAST_MERCHANT_ID: '10000100',
  PAYFAST_MERCHANT_KEY: '46f0cd694581a',
  PAYFAST_PASSPHRASE: 'jt7NOE43FZPn',
  ADMIN_PASSWORD: 'test-admin-password',
  ORDER_ALERT_EMAIL: 'hugo@example.com',
  SITE_URL: 'https://shop.example',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'user',
  SMTP_PASS: 'pass',
  SMTP_FROM: 'orders@pieces.example',
};

function customerBody(items, extra = {}) {
  return {
    customer: {
      name: 'Test Buyer',
      email: 'buyer@example.com',
      phone: '082 000 0000',
      address: {
        line1: '1 Long Street',
        line2: 'Unit 2',
        suburb: 'City Bowl',
        city: 'Cape Town',
        province: 'Western Cape',
        postalCode: '8001',
      },
    },
    items,
    ...extra,
  };
}

function pricedCatalogue() {
  const catalogue = structuredClone(getCatalogue());
  const grillz = catalogue.products.find((product) => product.id === 37);
  grillz.price = 800;
  const chain = catalogue.products.find((product) => product.id === 21);
  chain.temuUrl = 'https://www.temu.com/example-chain';
  chain.temuCost = 120;
  chain.supplierSku = 'TM-21';
  chain.supplierNotes = 'Titanium tone, one size';
  return catalogue;
}

function formBody(pairs, passphrase) {
  const signature = signPairs(pairs, passphrase);
  return [...pairs, ['signature', signature]]
    .map(([key, value]) => `${key}=${phpUrlencode(String(value).trim())}`)
    .join('&');
}

async function checkout(store, catalogue, items, extra = {}, origin = 'https://shop.example') {
  return createCheckout({
    body: customerBody(items, extra),
    store,
    env,
    origin,
    catalogue,
  });
}

test('checkout total comes from the catalogue and ignores a browser price', async () => {
  const store = memoryStore();
  const catalogue = pricedCatalogue();
  const result = await checkout(store, catalogue, [
    { id: 21, qty: 2, price: 1, amount: 1 },
    { id: 20, qty: 1, price: 5 },
  ]);
  assert.equal(result.status, 200);
  assert.equal(result.body.amount, '1950.00');
  assert.equal(result.body.processUrl, 'https://sandbox.payfast.co.za/eng/process');
  const fields = result.body.fields;
  assert.equal(fields.at(-1)[0], 'signature');
  assert.equal(fields.some(([key]) => key === 'passphrase'), false);
  assert.equal(signPairs(fields.slice(0, -1), env.PAYFAST_PASSPHRASE), fields.at(-1)[1]);
  const names = fields.map(([key]) => key);
  assert.deepEqual(names.slice(0, 5), ['merchant_id', 'merchant_key', 'return_url', 'cancel_url', 'notify_url']);
  assert.match(JSON.stringify(result.body), /1950\.00/);
  assert.doesNotMatch(JSON.stringify(result.body), /temu|passphrase|TM-21/i);
  const stored = await store.get(result.body.orderId);
  assert.equal(stored.status, 'pending');
  assert.equal(stored.items[0].temuUrl, 'https://www.temu.com/example-chain');
});

test('an empty price cannot be bought, and card fields are rejected', async () => {
  const store = memoryStore();
  const catalogue = pricedCatalogue();
  const unpriced = await checkout(store, catalogue, [{ id: 23, qty: 1 }]);
  assert.equal(unpriced.status, 400);
  assert.match(unpriced.body.error, /not priced yet/);
  const card = await checkout(store, catalogue, [{ id: 21, qty: 1 }], { cardNumber: '4242424242424242', cvv: '123' });
  assert.equal(card.status, 400);
  assert.match(card.body.error, /PayFast/);
  const badPhone = await checkout(store, catalogue, [{ id: 21, qty: 1 }], {
    customer: { ...customerBody([]).customer, phone: '123' },
  });
  assert.equal(badPhone.status, 400);
  const missingVariant = await checkout(store, catalogue, [{ id: 37, qty: 1 }]);
  assert.equal(missingVariant.status, 400);
  assert.match(missingVariant.body.error, /option/i);
  const chosen = await checkout(store, catalogue, [{ id: 37, qty: 1, variant: 'Gold' }]);
  assert.equal(chosen.status, 200);
  assert.equal(chosen.body.amount, '800.00');
});

test('http checkout is refused except on localhost, and live mode requires https and R5', async () => {
  const store = memoryStore();
  const catalogue = pricedCatalogue();
  const remote = await checkout(store, catalogue, [{ id: 21, qty: 1 }], {}, 'http://shop.example');
  assert.equal(remote.status, 400);
  assert.match(remote.body.error, /HTTPS/);
  const local = await checkout(store, catalogue, [{ id: 21, qty: 1 }], {}, 'http://127.0.0.1:8888');
  assert.equal(local.status, 200);
  const liveEnv = { ...env, PAYFAST_MODE: 'live' };
  const liveLocal = await createCheckout({
    body: customerBody([{ id: 21, qty: 1 }]),
    store: memoryStore(),
    env: liveEnv,
    origin: 'http://127.0.0.1:8888',
    catalogue,
  });
  assert.equal(liveLocal.status, 400);
  const cheap = structuredClone(catalogue);
  cheap.products.find((product) => product.id === 21).price = 1;
  const tooSmall = await createCheckout({
    body: customerBody([{ id: 21, qty: 1 }]),
    store: memoryStore(),
    env: liveEnv,
    origin: 'https://shop.example',
    catalogue: cheap,
  });
  assert.equal(tooSmall.status, 400);
  assert.match(tooSmall.body.error, /R5\.00/);
  const liveOk = await createCheckout({
    body: customerBody([{ id: 21, qty: 1 }]),
    store: memoryStore(),
    env: liveEnv,
    origin: 'https://shop.example',
    catalogue,
  });
  assert.equal(liveOk.body.processUrl, 'https://www.payfast.co.za/eng/process');
});

test('stock already held by a pending order cannot be sold twice', async () => {
  const catalogue = pricedCatalogue();
  catalogue.products.find((product) => product.id === 21).stock = 1;
  const store = memoryStore();
  const first = await checkout(store, catalogue, [{ id: 21, qty: 1 }]);
  assert.equal(first.status, 200);
  const second = await checkout(store, catalogue, [{ id: 21, qty: 1 }]);
  assert.equal(second.status, 409);
});

test('ITN marks the order paid only after signature, IP, amount and PayFast validate', async () => {
  const catalogue = pricedCatalogue();
  const store = memoryStore();
  const created = await checkout(store, catalogue, [{ id: 21, qty: 1 }]);
  const orderId = created.body.orderId;
  catalogue.products.find((product) => product.id === 21).temuUrl = 'https://www.temu.com/example-chain-updated';
  const basePairs = [
    ['m_payment_id', orderId],
    ['pf_payment_id', '1089250'],
    ['payment_status', 'COMPLETE'],
    ['item_name', `Pieces of Peace ${orderId}`],
    ['amount_gross', '500.00'],
    ['amount_fee', '-11.50'],
    ['amount_net', '488.50'],
    ['name_first', 'Test'],
    ['name_last', 'Buyer'],
    ['email_address', 'buyer@example.com'],
    ['merchant_id', '10000100'],
  ];
  const sent = [];
  const calls = [];
  async function sendAlert(order) {
    sent.push(buildAlertText(order));
    return { sent: true, reason: null };
  }
  async function fetchImpl(url, options) {
    calls.push({ url, body: options.body });
    return new Response('VALID', { status: 200 });
  }
  const run = (rawBody, ipAllowed = async () => true) => processItn({
    rawBody,
    sourceIp: '197.97.145.150',
    store,
    env,
    fetchImpl,
    sendAlert,
    catalogue,
    ipAllowed,
  });

  const badSig = await run(formBody(basePairs, env.PAYFAST_PASSPHRASE).replace('amount_gross=500.00', 'amount_gross=500.01'));
  assert.equal(badSig.reason, 'bad-signature');
  assert.equal(calls.length, 0);
  assert.equal((await store.get(orderId)).status, 'pending');

  const badIp = await run(formBody(basePairs, env.PAYFAST_PASSPHRASE), async () => false);
  assert.equal(badIp.reason, 'bad-ip');
  assert.equal(calls.length, 0);

  const wrongGross = basePairs.map(([key, value]) => (key === 'amount_gross' ? [key, '1.00'] : [key, value]));
  const mismatch = await run(formBody(wrongGross, env.PAYFAST_PASSPHRASE));
  assert.equal(mismatch.reason, 'amount-mismatch');
  assert.equal(calls.length, 0);

  const wrongMerchant = basePairs.map(([key, value]) => (key === 'merchant_id' ? [key, '99999999'] : [key, value]));
  const merchant = await run(formBody(wrongMerchant, env.PAYFAST_PASSPHRASE));
  assert.equal(merchant.reason, 'bad-merchant');
  assert.equal(calls.length, 0);

  const invalid = await processItn({
    rawBody: formBody(basePairs, env.PAYFAST_PASSPHRASE),
    sourceIp: '41.74.179.200',
    store,
    env,
    fetchImpl: async () => new Response('INVALID', { status: 200 }),
    sendAlert,
    catalogue,
    ipAllowed: async () => true,
  });
  assert.equal(invalid.reason, 'validate-rejected');
  assert.equal((await store.get(orderId)).status, 'pending');

  const offline = await processItn({
    rawBody: formBody(basePairs, env.PAYFAST_PASSPHRASE),
    sourceIp: '41.74.179.200',
    store,
    env,
    fetchImpl: async () => { throw new Error('network'); },
    sendAlert,
    catalogue,
    ipAllowed: async () => true,
  });
  assert.equal(offline.status, 500);
  assert.equal((await store.get(orderId)).status, 'pending');

  const paid = await run(formBody(basePairs, env.PAYFAST_PASSPHRASE));
  assert.equal(paid.reason, 'paid');
  assert.equal(calls[0].url, 'https://sandbox.payfast.co.za/eng/query/validate');
  assert.doesNotMatch(calls[0].body, /passphrase|signature/);
  assert.match(calls[0].body, /amount_gross=500\.00/);
  const order = await store.get(orderId);
  assert.equal(order.status, 'paid');
  assert.equal(order.pfPaymentId, '1089250');
  assert.equal(order.items[0].temuUrl, 'https://www.temu.com/example-chain-updated');
  assert.equal(sent.length, 1);
  assert.match(sent[0], /example-chain-updated/);
  assert.match(sent[0], /1 Long Street/);
  assert.match(sent[0], /buyer@example.com/);
  assert.match(sent[0], /1089250/);
  assert.match(sent[0], /R500\.00/);
  assert.match(sent[0], /TM-21/);
  const visible = JSON.stringify(publicOrder(order));
  assert.doesNotMatch(visible, /temu|buyer@example.com|TM-21|Long Street/i);

  const again = await run(formBody(basePairs, env.PAYFAST_PASSPHRASE));
  assert.equal(again.reason, 'already-paid');
  assert.equal(sent.length, 1);
});

test('a cancelled ITN does not mark the order paid or email the owner', async () => {
  const catalogue = pricedCatalogue();
  const store = memoryStore();
  const created = await checkout(store, catalogue, [{ id: 22, qty: 1 }]);
  const pairs = [
    ['m_payment_id', created.body.orderId],
    ['pf_payment_id', '55'],
    ['payment_status', 'CANCELLED'],
    ['amount_gross', '500.00'],
    ['merchant_id', '10000100'],
  ];
  let emails = 0;
  const result = await processItn({
    rawBody: formBody(pairs, env.PAYFAST_PASSPHRASE),
    sourceIp: '144.126.193.139',
    store,
    env,
    fetchImpl: async () => new Response('VALID'),
    sendAlert: async () => { emails += 1; return { sent: true }; },
    catalogue,
    ipAllowed: async () => true,
  });
  assert.equal(result.reason, 'not-complete');
  assert.equal(emails, 0);
  assert.equal((await store.get(created.body.orderId)).status, 'cancelled');
});

test('the HTTP API hides supplier data, ignores forwarded IP spoofing, and guards admin', async () => {
  const catalogue = pricedCatalogue();
  const store = memoryStore();
  const origin = 'https://shop.example';
  const checkoutRequest = (body, header = '1') => new Request(`${origin}/api/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pop-request': header, 'x-forwarded-for': '197.97.145.144' },
    body: JSON.stringify(body),
  });
  const missingHeader = await handleApi(checkoutRequest(customerBody([{ id: 21, qty: 1, price: 1 }]), ''), {
    store, env, catalogue, origin,
  });
  assert.equal(missingHeader.status, 400);

  const created = await handleApi(checkoutRequest(customerBody([{ id: 21, qty: 1, price: 1 }])), {
    store, env, catalogue, origin,
  });
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  assert.equal(createdBody.amount, '500.00');

  const seen = [];
  const spoofBody = formBody([
    ['m_payment_id', createdBody.orderId],
    ['pf_payment_id', '1'],
    ['payment_status', 'COMPLETE'],
    ['amount_gross', '500.00'],
    ['merchant_id', env.PAYFAST_MERCHANT_ID],
  ], env.PAYFAST_PASSPHRASE);
  const spoof = await handleApi(new Request(`${origin}/api/payfast/itn`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '197.97.145.150' },
    body: spoofBody,
  }), {
    store,
    env,
    catalogue,
    sourceIp: '',
    ipAllowed: async (ip) => { seen.push(ip); return false; },
  });
  assert.equal(spoof.status, 200);
  assert.deepEqual(seen, ['']);
  assert.equal((await store.get(createdBody.orderId)).status, 'pending');

  const catalogueResponse = await handleApi(new Request(`${origin}/api/catalogue`), { store, env, catalogue });
  const publicCatalogue = await catalogueResponse.json();
  assert.equal(publicCatalogue.products.length, 23);
  assert.equal(JSON.stringify(publicCatalogue).includes('temu'), false);

  const statusResponse = await handleApi(new Request(`${origin}/api/orders/${createdBody.orderId}/status`), { store, env });
  const status = await statusResponse.json();
  assert.equal(status.status, 'pending');
  assert.equal(JSON.stringify(status).includes('buyer@example.com'), false);

  const login = await handleApi(new Request(`${origin}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pop-request': '1' },
    body: JSON.stringify({ password: 'nope' }),
  }), { store, env });
  assert.equal(login.status, 401);
  const session = await handleApi(new Request(`${origin}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pop-request': '1' },
    body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
  }), { store, env });
  const { token } = await session.json();
  const paidList = await handleApi(new Request(`${origin}/api/admin/orders`, {
    headers: { authorization: `Bearer ${token}`, 'x-pop-request': '1' },
  }), { store, env });
  assert.deepEqual((await paidList.json()).orders, []);

  const pairs = [
    ['m_payment_id', createdBody.orderId],
    ['pf_payment_id', '777'],
    ['payment_status', 'COMPLETE'],
    ['amount_gross', '500.00'],
    ['merchant_id', env.PAYFAST_MERCHANT_ID],
  ];
  const itn = await handleApi(new Request(`${origin}/api/payfast/itn`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody(pairs, env.PAYFAST_PASSPHRASE),
  }), {
    store,
    env,
    catalogue,
    sourceIp: '102.216.36.10',
    fetchImpl: async () => new Response('VALID'),
    sendAlert: async () => ({ sent: false, reason: 'SMTP is not configured' }),
    ipAllowed: async () => true,
  });
  assert.equal(itn.status, 200);
  assert.equal((await store.get(createdBody.orderId)).status, 'paid');

  const orders = await handleApi(new Request(`${origin}/api/admin/orders`, {
    headers: { authorization: `Bearer ${token}`, 'x-pop-request': '1' },
  }), { store, env });
  const listed = await orders.json();
  assert.equal(listed.orders.length, 1);
  assert.equal(listed.orders[0].items[0].temuUrl, 'https://www.temu.com/example-chain');
  assert.equal(listed.orders[0].pfPaymentId, '777');
  assert.match(listed.orders[0].alertError, /SMTP/);

  const saved = await handleApi(new Request(`${origin}/api/admin/orders/${createdBody.orderId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-pop-request': '1' },
    body: JSON.stringify({ fulfilled: true, temuOrderNumber: 'TEMU-1001' }),
  }), { store, env });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.equal(savedBody.order.fulfilled, true);
  assert.equal(savedBody.order.temuOrderNumber, 'TEMU-1001');

  const csvDenied = await handleApi(new Request(`${origin}/api/admin/orders.csv`), { store, env });
  assert.equal(csvDenied.status, 400);
  const csv = await handleApi(new Request(`${origin}/api/admin/orders.csv`, {
    headers: { authorization: `Bearer ${token}`, 'x-pop-request': '1' },
  }), { store, env });
  const csvText = await csv.text();
  assert.match(csvText, /TEMU-1001/);
  assert.match(csvText, /777/);
  assert.match(csvText, /example-chain/);
  assert.match(csvText, /Test Buyer/);
});

test('order alert explains a missing mailbox instead of throwing', async () => {
  const order = {
    id: 'POP-test',
    amount: '500.00',
    pfPaymentId: '1',
    customer: {
      name: 'Test Buyer',
      email: 'buyer@example.com',
      phone: '0820000000',
      address: { line1: '1 Long Street', line2: '', suburb: 'City Bowl', city: 'Cape Town', province: 'Western Cape', postalCode: '8001' },
    },
    items: [{ name: 'Chain', sku: 'NO.021', qty: 1, variant: '', temuUrl: '', temuCost: null, supplierSku: '', supplierNotes: '', lineCents: 50000 }],
  };
  const result = await sendOrderAlert(order, { ...env, SMTP_HOST: '', ORDER_ALERT_EMAIL: '' });
  assert.equal(result.sent, false);
  assert.match(buildAlertText(order), /NOT SET/);
});
