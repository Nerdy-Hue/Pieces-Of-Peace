import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { getCatalogue, renderProductsJs, toPublicProduct } from '../server/catalogue.js';
import { build } from '../scripts/build.js';

const root = path.resolve(import.meta.dirname, '..');

test('the catalogue keeps the three priced pieces and adds the twenty photos', () => {
  const { products } = getCatalogue();
  assert.equal(products.length, 23);
  const byId = new Map(products.map((product) => [product.id, product]));
  assert.equal(byId.get(20).name, 'Titanium Cuban Link Combo');
  assert.equal(byId.get(20).price, 950);
  assert.equal(byId.get(21).name, 'Cuban Link Chain (Titanium)');
  assert.equal(byId.get(21).price, 500);
  assert.equal(byId.get(22).name, 'Cuban Link Bracelet (Titanium)');
  assert.equal(byId.get(22).price, 500);
  const fresh = products.filter((product) => product.id >= 23);
  assert.equal(fresh.length, 20);
  assert.ok(fresh.every((product) => product.price === null));
  assert.ok(fresh.every((product) => product.image.startsWith('img/products/')));
  assert.ok(fresh.every((product) => existsSync(path.join(root, product.image))));
  for (const product of products) {
    assert.equal(product.temuUrl, '');
    assert.equal(product.temuCost, null);
    assert.equal(product.supplierSku, '');
    assert.equal('temuUrl' in toPublicProduct(product), false);
    assert.equal('supplierSku' in toPublicProduct(product), false);
    assert.equal('supplierNotes' in toPublicProduct(product), false);
    assert.equal('temuCost' in toPublicProduct(product), false);
  }
  const photos = readdirSync(path.join(root, 'img/products')).filter((name) => name.endsWith('.jpg'));
  assert.equal(photos.length, 20);
});

test('the published site has no supplier fields and no catalogue file', async () => {
  const dist = await build();
  const generated = readFileSync(path.join(root, 'js/products.js'), 'utf8');
  assert.equal(generated, renderProductsJs());
  assert.equal(generated.includes('temuUrl'), false);
  assert.equal(generated.includes('supplierSku'), false);
  assert.equal(existsSync(path.join(dist, 'data')), false);
  for (const relative of ['js/products.js', 'index.html', 'checkout.html', 'admin.html']) {
    const text = readFileSync(path.join(dist, relative), 'utf8');
    assert.equal(text.includes('temuUrl'), false, relative);
    assert.equal(text.includes('supplierSku'), false, relative);
  }
  const checkout = readFileSync(path.join(root, 'checkout.html'), 'utf8');
  assert.doesNotMatch(checkout, /cardnumber|cvv|cvc/i);
  assert.match(checkout, /PayFast/);
});
