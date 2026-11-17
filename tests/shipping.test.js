import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCheckout } from '../server/checkout.js';
import { PROVINCES } from '../server/orders.js';
import { shippingForProvince } from '../server/shipping.js';
import { memoryStore } from '../server/store.js';
import { getCatalogue } from '../server/catalogue.js';

const fees = {
  Gauteng: 50,
  'North West': 100,
  'Free State': 100,
  Limpopo: 100,
  Mpumalanga: 100,
  'KwaZulu-Natal': 120,
  'Eastern Cape': 150,
  'Northern Cape': 150,
  'Western Cape': 150,
};

test('each province maps to its delivery fee', () => {
  assert.deepEqual(Object.keys(fees).sort(), [...PROVINCES].sort());
  for (const [province, fee] of Object.entries(fees)) {
    const quote = shippingForProvince(province);
    assert.equal(quote.fee, fee);
    assert.equal(quote.feeCents, fee * 100);
    assert.equal(quote.label, `${province} delivery`);
  }
  assert.equal(shippingForProvince(''), null);
  assert.equal(shippingForProvince('Overseas'), null);
});

test('checkout adds the province fee and ignores a browser total', async () => {
  const env = {
    PAYFAST_MODE: 'sandbox',
    PAYFAST_MERCHANT_ID: '10000100',
    PAYFAST_MERCHANT_KEY: '46f0cd694581a',
    PAYFAST_PASSPHRASE: 'jt7NOE43FZPn',
    ADMIN_PASSWORD: 'test-admin-password',
    ORDER_ALERT_EMAIL: '',
    SMTP_HOST: '',
    SMTP_FROM: '',
  };
  const catalogue = structuredClone(getCatalogue());
  for (const [province, fee] of Object.entries(fees)) {
    const result = await createCheckout({
      body: {
        amount: 1,
        shippingFee: 0,
        total: 5,
        customer: {
          name: 'Test Buyer',
          email: 'buyer@example.com',
          phone: '0820000000',
          address: {
            line1: '1 Long Street',
            line2: '',
            suburb: 'Centre',
            city: 'Town',
            province,
            postalCode: '0001',
          },
        },
        items: [{ id: 21, qty: 1, price: 1 }],
      },
      store: memoryStore(),
      env,
      origin: 'https://shop.example',
      catalogue,
    });
    assert.equal(result.status, 200, province);
    assert.equal(result.body.subtotal, '500.00', province);
    assert.equal(result.body.shippingFee, `${fee}.00`, province);
    assert.equal(result.body.shippingProvince, province);
    assert.equal(result.body.amount, `${500 + fee}.00`, province);
    const amountField = result.body.fields.find(([key]) => key === 'amount');
    assert.equal(amountField[1], `${500 + fee}.00`);
  }
});
