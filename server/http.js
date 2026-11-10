import { createAdminToken, bearerToken, verifyAdminToken, adminConfigured } from './admin.js';
import { createCheckout } from './checkout.js';
import { getCatalogue, toPublicCatalogue } from './catalogue.js';
import { readEnv, requestOrigin } from './env.js';
import { processItn } from './itn.js';
import { isPayfastSource } from './payfast.js';
import { adminOrder, applyFulfilment, ordersToCsv, publicOrder } from './orders.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function text(status, body, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extra,
    },
  });
}

export function normalizeApiPath(pathname) {
  let path = pathname || '/';
  const marker = '/.netlify/functions/api';
  const at = path.indexOf(marker);
  if (at !== -1) {
    path = path.slice(at + marker.length) || '/';
    if (!path.startsWith('/api')) path = `/api${path.startsWith('/') ? path : `/${path}`}`;
  }
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

async function readLimited(request, limit = 65536) {
  const reader = request.body?.getReader?.();
  if (!reader) {
    const textBody = await request.text();
    if (textBody.length > limit) {
      const error = new Error('too-large');
      error.status = 413;
      throw error;
    }
    return textBody;
  }
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      const error = new Error('too-large');
      error.status = 413;
      throw error;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function browserPost(request) {
  return (request.headers.get('x-pop-request') || '') === '1';
}

export async function handleApi(request, deps = {}) {
  const env = deps.env || readEnv();
  const store = deps.store;
  const url = new URL(request.url);
  const path = normalizeApiPath(url.pathname);
  const method = request.method.toUpperCase();

  try {
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

    if (method === 'GET' && path === '/api/catalogue') {
      return json(200, toPublicCatalogue(deps.catalogue || getCatalogue()));
    }

    const statusMatch = path.match(/^\/api\/orders\/(POP-[a-f0-9]+)\/status$/);
    if (method === 'GET' && statusMatch) {
      const order = await store.get(statusMatch[1]);
      if (!order) return json(404, { error: 'Order not found.' });
      return json(200, publicOrder(order));
    }

    if (method === 'POST' && path === '/api/payfast/itn') {
      const rawBody = await readLimited(request);
      const contentType = request.headers.get('content-type') || '';
      if (contentType && !contentType.includes('application/x-www-form-urlencoded')) {
        return text(200, 'OK');
      }
      const sourceIp = deps.sourceIp !== undefined
        ? deps.sourceIp
        : (request.headers.get('x-nf-client-connection-ip') || '');
      const result = await processItn({
        rawBody,
        sourceIp,
        store,
        env,
        fetchImpl: deps.fetchImpl,
        sendAlert: deps.sendAlert,
        catalogue: deps.catalogue,
        ipAllowed: deps.ipAllowed || isPayfastSource,
        now: deps.now,
      });
      if (result.reason && result.reason !== 'paid' && result.reason !== 'already-paid') {
        console.error('payfast itn', result.reason);
      }
      return text(result.status, result.status === 200 ? 'OK' : 'ERROR');
    }

    if (method === 'POST' && path === '/api/checkout') {
      if (!browserPost(request)) return json(400, { error: 'Order could not be placed.' });
      const contentType = request.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return json(415, { error: 'Order could not be read.' });
      const raw = await readLimited(request);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return json(400, { error: 'Order could not be read.' });
      }
      const result = await createCheckout({
        body,
        store,
        env,
        origin: deps.origin || requestOrigin(request, env),
        catalogue: deps.catalogue,
        now: deps.now,
      });
      return json(result.status, result.body);
    }

    if (path.startsWith('/api/admin')) {
      if (!browserPost(request) && method !== 'GET') {
        return json(400, { error: 'Request could not be read.' });
      }
      if (method === 'GET' && !browserPost(request)) return json(400, { error: 'Request could not be read.' });
      if (!adminConfigured(env)) return json(503, { error: 'The admin password is not configured.' });

      if (method === 'POST' && path === '/api/admin/login') {
        const raw = await readLimited(request);
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return json(400, { error: 'Request could not be read.' });
        }
        const session = createAdminToken(body.password || '', env, deps.now ? deps.now.getTime() : Date.now());
        if (!session) return json(401, { error: 'That password is not right.' });
        return json(200, session);
      }

      if (!verifyAdminToken(bearerToken(request), env, deps.now ? deps.now.getTime() : Date.now())) {
        return json(401, { error: 'Sign in again.' });
      }

      if (method === 'GET' && (path === '/api/admin/orders' || path === '/api/admin/orders.csv')) {
        const orders = (await store.list()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        const status = url.searchParams.get('status');
        const filtered = status === 'all' ? orders : orders.filter((order) => order.status === (status || 'paid'));
        if (path.endsWith('.csv')) {
          return text(200, ordersToCsv(filtered), {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="pieces-of-peace-orders.csv"',
          });
        }
        return json(200, { orders: filtered.map(adminOrder) });
      }

      const updateMatch = path.match(/^\/api\/admin\/orders\/(POP-[a-f0-9]+)$/);
      if (updateMatch && (method === 'POST' || method === 'PATCH')) {
        const raw = await readLimited(request);
        let patch;
        try {
          patch = JSON.parse(raw);
        } catch {
          return json(400, { error: 'Request could not be read.' });
        }
        const order = await store.get(updateMatch[1]);
        const result = applyFulfilment(order, patch, deps.now || new Date());
        if (!result.ok) return json(result.status, { error: result.error });
        await store.put(result.order.id, result.order);
        return json(200, { order: adminOrder(result.order) });
      }
    }

    return json(404, { error: 'Not found.' });
  } catch (err) {
    if (err.status === 413) return json(413, { error: 'That request is too large.' });
    console.error('api error', err?.message || err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
}
