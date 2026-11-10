import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProductsJs } from '../server/catalogue.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function build() {
  const js = renderProductsJs();
  await writeFile(path.join(root, 'js', 'products.js'), js);
  const dist = path.join(root, 'dist');
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  const pages = ['index.html', 'checkout.html', 'return.html', 'cancel.html', 'admin.html', 'README.txt'];
  for (const file of pages) {
    await cp(path.join(root, file), path.join(dist, file));
  }
  await cp(path.join(root, 'css'), path.join(dist, 'css'), { recursive: true });
  await cp(path.join(root, 'js'), path.join(dist, 'js'), { recursive: true });
  await cp(path.join(root, 'img'), path.join(dist, 'img'), { recursive: true });
  return dist;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await build();
  console.log('Built dist/ and refreshed js/products.js');
}
