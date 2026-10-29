// A stand-in for TailorIT during e2e runs: node:http only, loopback only, port 3190 (MOCK_PORT overrides). Phase 0
// answers health and keeps a request log; later phases serve the contract's golden answers from
// src/contract/tailorit/v1/fixtures. Authorization headers are redacted in the log.
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 3190);
/** @type {Array<{ method: string; path: string; headers: Record<string, string>; body: string }>} */
let requests = [];

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
async function handle(req, res) {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  let body = '';
  for await (const chunk of req) body += chunk;
  const send = (status, data) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  if (url.pathname === '/__mock/health') return send(200, { ok: true });
  if (url.pathname === '/__mock/requests') return send(200, requests);
  if (url.pathname === '/__mock/reset' && req.method === 'POST') {
    requests = [];
    return send(204, {});
  }
  const headers = Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, key === 'authorization' ? 'REDACTED' : String(value)]));
  requests.push({ method: req.method ?? 'GET', path: url.pathname, headers, body });
  return send(404, { error: { code: 'not_found' } });
}

const servers = [];
for (const host of ['127.0.0.1', '::1']) {
  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', (/** @type {NodeJS.ErrnoException} */ error) => (host === '::1' && error.code === 'EADDRNOTAVAIL' ? resolve(null) : reject(error)));
    server.listen(PORT, host, () => resolve(null));
  });
  servers.push(server);
}
console.log(`mock TailorIT listening on http://localhost:${PORT}`);
const stop = () => {
  for (const server of servers) server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
