// POST /api/refresh -> start a sync now (signed-in users). The page polls status.
import { json, errorResponse, sameOrigin, HttpError } from '../../lib/http.mjs';
import { requireSession } from '../../lib/auth.mjs';
import { kpiStore, KEYS } from '../../lib/store.mjs';
import { triggerBackgroundSync } from '../../lib/trigger.mjs';

export default async function handler(request) {
  try {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    sameOrigin(request);
    await requireSession(request);
    const lock = await kpiStore().get(KEYS.lock, { type: 'json' });
    if (lock && Date.now() - lock.at < 14 * 60000) return json({ ok: true, running: true, startedAt: new Date(lock.at).toISOString() });
    try { await triggerBackgroundSync(); } catch (e) { throw new HttpError(e.message, 500); }
    return json({ ok: true, running: true });
  } catch (error) { return errorResponse(error); }
}
