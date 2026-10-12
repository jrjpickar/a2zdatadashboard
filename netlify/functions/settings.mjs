// GET /api/settings (signed in) | POST /api/settings (owners): container fleet, rental days, workdays, business hours.
import { json, errorResponse, readJson, sameOrigin } from '../../lib/http.mjs';
import { cleanSettings } from '../../lib/config.mjs';
import { requireSession, requireOwner } from '../../lib/auth.mjs';
import { kpiStore, KEYS } from '../../lib/store.mjs';

export default async function handler(request) {
  try {
    const store = kpiStore();
    if (request.method === 'GET') { requireSession(request); return json(cleanSettings((await store.get(KEYS.settings, { type: 'json' })) || {})); }
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    sameOrigin(request);
    const owner = requireOwner(request);
    const settings = cleanSettings(await readJson(request));
    await store.setJSON(KEYS.settings, { ...settings, updatedBy: owner.name, updatedAt: new Date().toISOString() });
    // Apply right away without waiting for the next sync.
    const snap = await store.get(KEYS.snapshot, { type: 'json' });
    if (snap) { snap.settings = settings; snap.builtAt = new Date().toISOString(); await store.setJSON(KEYS.snapshot, snap); }
    return json({ ok: true, settings });
  } catch (error) { return errorResponse(error); }
}
