/**
 * Server-side catalogue. This file is the shop's price list.
 * Supplier fields are stripped before anything is sent to the browser.
 */

import catalogue from '../data/catalogue.json' with { type: 'json' };

export const PUBLIC_PRODUCT_KEYS = [
  'id',
  'sku',
  'name',
  'category',
  'description',
  'price',
  'stock',
  'image',
  'angles',
  'variants',
];

export function getCatalogue() {
  return catalogue;
}

export function priceToCents(price) {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  const cents = Math.round(price * 100);
  if (Math.abs(price * 100 - cents) > 1e-6) return null;
  return cents;
}

export function isForSale(product) {
  return priceToCents(product?.price) !== null;
}

export function toPublicProduct(product) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    category: product.category,
    description: product.description || '',
    price: isForSale(product) ? product.price : null,
    stock: product.stock === undefined ? null : product.stock,
    image: product.image || '',
    angles: Array.isArray(product.angles) ? product.angles : [],
    variants: Array.isArray(product.variants) ? product.variants : [],
  };
}

export function toPublicCatalogue(source = getCatalogue()) {
  return {
    categories: source.categories,
    products: source.products.map(toPublicProduct),
  };
}

export function renderProductsJs(source = getCatalogue()) {
  const pub = toPublicCatalogue(source);
  return `/* Generated from data/catalogue.json. Edit that file, then run npm run build.
   Prices live there. Supplier fields (Temu URL, cost, SKU, notes) are not in this file
   and are never sent to the browser. */
window.PRODUCTS = ${JSON.stringify(pub.products, null, 2)};

window.CATEGORIES = ${JSON.stringify(pub.categories, null, 2)};
`;
}

export function findProduct(catalogueSource, id) {
  return catalogueSource.products.find((product) => String(product.id) === String(id)) || null;
}
