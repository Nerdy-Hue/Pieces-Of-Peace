import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './env.js';
import { handleApi } from './http.js';
import { openDefaultStore } from './store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotEnv(path.join(root, '.env'));

const PORT = Number(process.env.PORT || 8888);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self'",
    "connect-src 'self'",
    "form-action 'self' https://sandbox.payfast.co.za https://www.payfast.co.za",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; '),
};

function blocked(urlPath) {
  return (
    urlPath.includes('..') ||
    urlPath.split('/').some((part) => part.startsWith('.')) ||
    /^\/(?:data|server|tests|netlify|scripts|node_modules)(?:\/|$)/.test(urlPath)
  );
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = TYPES[ext];
  if (!type) {
    res.writeHead(404, SECURITY_HEADERS);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', ...SECURITY_HEADERS });
  createReadStream(filePath).pipe(res);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) {
      const error = new Error('too-large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || `127.0.0.1:${PORT}`;
    const url = new URL(req.url || '/', `http://${host}`);
    if (url.pathname.startsWith('/api/')) {
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        const lower = key.toLowerCase();
        if (['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host', 'content-length'].includes(lower)) continue;
        if (Array.isArray(value)) value.forEach((part) => headers.append(key, part));
        else headers.set(key, value);
      }
      const request = new Request(url, { method: req.method, headers, body });
      const store = await openDefaultStore();
      const localOrigin = `http://127.0.0.1:${PORT}`;
      const response = await handleApi(request, {
        store,
        sourceIp: req.socket.remoteAddress || '',
        origin: process.env.SITE_URL || localOrigin,
      });
      const responseHeaders = Object.fromEntries(response.headers.entries());
      res.writeHead(response.status, responseHeaders);
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    if (blocked(decodeURIComponent(url.pathname))) {
      res.writeHead(404, SECURITY_HEADERS);
      res.end('Not found');
      return;
    }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const filePath = path.resolve(root, relative);
    if (!filePath.startsWith(root + path.sep) && filePath !== root) {
      res.writeHead(404, SECURITY_HEADERS);
      res.end('Not found');
      return;
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, SECURITY_HEADERS);
      res.end('Not found');
      return;
    }
    sendFile(res, filePath);
  } catch (err) {
    const status = err.status || 500;
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(status === 413 ? 'Too large' : 'Error');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Pieces of Peace running at http://127.0.0.1:${PORT}`);
});
