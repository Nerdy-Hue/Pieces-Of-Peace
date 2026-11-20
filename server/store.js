import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;

export function memoryStore(seed = []) {
  const map = new Map();
  for (const order of seed) map.set(order.id, structuredClone(order));
  return {
    async get(id) {
      return map.has(id) ? structuredClone(map.get(id)) : null;
    },
    async put(id, order) {
      map.set(id, structuredClone(order));
    },
    async list() {
      return [...map.values()].map((order) => structuredClone(order));
    },
  };
}

export function fileStore(dir) {
  return {
    async get(id) {
      assertId(id);
      try {
        const text = await readFile(path.join(dir, `${id}.json`), 'utf8');
        return JSON.parse(text);
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },
    async put(id, order) {
      assertId(id);
      await mkdir(dir, { recursive: true });
      const dest = path.join(dir, `${id}.json`);
      const tmp = `${dest}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(order), 'utf8');
      await rename(tmp, dest);
    },
    async list() {
      let names = [];
      try {
        names = await readdir(dir);
      } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
      }
      const orders = [];
      for (const name of names) {
        if (!name.endsWith('.json') || name.endsWith('.tmp')) continue;
        const text = await readFile(path.join(dir, name), 'utf8');
        orders.push(JSON.parse(text));
      }
      return orders;
    },
  };
}

function assertId(id) {
  if (!ID_PATTERN.test(String(id))) {
    const error = new Error('Invalid order id');
    error.status = 400;
    throw error;
  }
}

export async function netlifyBlobStore() {
  const { getStore } = await import('@netlify/blobs');
  const store = getStore({ name: 'orders', consistency: 'strong' });
  return {
    async get(id) {
      assertId(id);
      return store.get(id, { type: 'json' });
    },
    async put(id, order) {
      assertId(id);
      await store.setJSON(id, order);
    },
    async list() {
      const listed = await store.list();
      const blobs = listed.blobs || [];
      const orders = [];
      for (const blob of blobs) {
        const order = await store.get(blob.key, { type: 'json' });
        if (order) orders.push(order);
      }
      return orders;
    },
  };
}

let singleton;

export async function openDefaultStore() {
  if (singleton) return singleton;
  const choice = process.env.ORDER_STORE || (process.env.NETLIFY ? 'netlify-blobs' : 'file');
  if (choice === 'memory') {
    singleton = memoryStore();
  } else if (choice === 'netlify-blobs') {
    singleton = await netlifyBlobStore();
  } else {
    const dir = process.env.ORDER_DATA_DIR || path.join(process.cwd(), 'data', 'orders');
    singleton = fileStore(dir);
  }
  return singleton;
}

export function resetDefaultStore() {
  singleton = null;
}
