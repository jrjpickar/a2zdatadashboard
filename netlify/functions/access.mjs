// GET  /api/access  (admins)  -> users on the list, access requests, GHL users to pick from
// POST /api/access  (admins)  { action: add | remove | set_role | dismiss_request, email, name?, role? }
// Admins add/remove viewers; only senior admins add, change or remove admins.
import { json, errorResponse, readJson, sameOrigin } from '../../lib/http.mjs';
import { config } from '../../lib/config.mjs';
import { requireOwner } from '../../lib/auth.mjs';
import { readAccess, writeAccess, applyChange } from '../../lib/access.mjs';
import { kpiStore, KEYS } from '../../lib/store.mjs';

export default async function handler(request) {
  try {
    const cfg = config(), store = kpiStore();
    const me = await requireOwner(request, cfg, store);
    if (request.method === 'GET') {
      const [data, snap] = await Promise.all([readAccess(store, { fresh: true }), store.get(KEYS.snapshot, { type: 'json' })]);
      return json({ me: { name: me.name, email: me.email, role: me.role }, seniors: cfg.owners, users: data.users, requests: data.requests, log: me.senior ? (data.log || []).slice(0, 50) : [], ghlUsers: (snap?.users || []).filter(u => u.email) });
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    sameOrigin(request);
    const change = await readJson(request);
    const data = applyChange(structuredClone(await readAccess(store, { fresh: true })), change, me, cfg);
    await writeAccess(store, data);
    return json({ ok: true, users: data.users, requests: data.requests });
  } catch (error) { return errorResponse(error); }
}
