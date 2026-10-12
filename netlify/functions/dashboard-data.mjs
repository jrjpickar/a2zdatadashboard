// GET /api/dashboard-data -> the latest snapshot (Money data only for owners).
import { gzipSync } from 'node:zlib';
import { json, errorResponse } from '../../lib/http.mjs';
import { config } from '../../lib/config.mjs';
import { requireSession } from '../../lib/auth.mjs';
import { kpiStore, KEYS } from '../../lib/store.mjs';

export function forViewer(snapshot, owner) {
  if (!snapshot || owner) return snapshot;
  const { ledger, ...rest } = snapshot;
  return { ...rest, ledger: null, dispatch: rest.dispatch ? { ...rest.dispatch, eodSheets: [] } : rest.dispatch };
}
export default async function handler(request) {
  try {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const cfg = config();
    const session = requireSession(request, cfg);
    const store = kpiStore();
    const [snapshot, status] = await Promise.all([store.get(KEYS.snapshot, { type: 'json' }), store.get(KEYS.status, { type: 'json' })]);
    const etag = `"${(snapshot?.builtAt || 'none')}-${session.owner ? 'o' : 'v'}"`;
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } });
    const body = JSON.stringify({ viewer: { name: session.name, email: session.email, owner: session.owner }, snapshot: forViewer(snapshot, session.owner), status });
    const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', etag };
    if (/\bgzip\b/.test(request.headers.get('accept-encoding') || '')) return new Response(gzipSync(body), { headers: { ...headers, 'content-encoding': 'gzip', vary: 'accept-encoding' } });
    return new Response(body, { headers });
  } catch (error) { return errorResponse(error); }
}
