// Local sandbox: the real page with sample data. No credentials, no provider calls.
//   npm run sandbox  ->  http://127.0.0.1:4174
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { sampleSnapshot } from './sample.mjs';
import { cleanSettings } from '../lib/config.mjs';

const root = new URL('../public/', import.meta.url).pathname;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
let snapshot = sampleSnapshot();
const owner = process.env.SANDBOX_VIEWER !== '1';
const role = owner ? 'senior' : 'viewer';
let overrides = {};
let access = { users: [{ email: 'maria@example.com', name: 'Maria Lopez', role: 'admin', addedBy: 'Sandbox', addedAt: new Date().toISOString() }, { email: 'dan@example.com', name: 'Dan Ortiz', role: 'viewer', addedBy: 'Sandbox', addedAt: new Date().toISOString() }], requests: [{ email: 'kim@example.com', name: 'Kim Tran', at: new Date().toISOString() }], log: [] };
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/session') return send(res, 200, { token: 'sandbox', user: { name: 'Sandbox', email: 'sandbox@example.com' }, owner });
  if (url.pathname === '/api/dashboard-data') return send(res, 200, { viewer: { name: 'Sandbox (sample data)', email: 'sandbox@example.com', owner, role }, snapshot: owner ? snapshot : { ...snapshot, ledger: null }, status: { lastRunAt: snapshot.builtAt } });
  if (url.pathname === '/api/queue') {
    if (req.method === 'POST') { let body = ''; for await (const c of req) body += c; const { applyQueueChange } = await import('../netlify/functions/queue.mjs'); try { overrides = applyQueueChange(overrides, JSON.parse(body), { name: 'Sandbox' }); } catch (e) { return send(res, e.status || 400, { error: e.message }); } }
    return send(res, 200, overrides);
  }
  if (url.pathname === '/api/access') {
    if (req.method === 'POST') {
      let body = ''; for await (const c of req) body += c;
      const { applyChange } = await import('../lib/access.mjs');
      try { access = applyChange(structuredClone(access), JSON.parse(body), { name: 'Sandbox', role }, { owners: ['sandbox@example.com'] }); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
    }
    return send(res, 200, { me: { name: 'Sandbox', email: 'sandbox@example.com', role }, seniors: ['sandbox@example.com'], ...access, ghlUsers: snapshot.users.map(u => ({ ...u, email: u.name.split(' ')[0].toLowerCase() + '@example.com' })) });
  }
  if (url.pathname === '/api/refresh') { snapshot = { ...sampleSnapshot(), builtAt: new Date().toISOString() }; return send(res, 200, { ok: true }); }
  if (url.pathname === '/api/settings') {
    let body = ''; for await (const c of req) body += c;
    const settings = cleanSettings(JSON.parse(body || '{}'));
    snapshot = { ...snapshot, settings, builtAt: new Date().toISOString() };
    return send(res, 200, { ok: true, settings });
  }
  const path = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!path.startsWith(root)) { res.writeHead(403); return res.end(); }
  try { const data = await readFile(path); res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(Number(process.env.PORT) || 4174, '127.0.0.1', () => console.log(`Sandbox (sample data) on http://127.0.0.1:${Number(process.env.PORT) || 4174}`));
