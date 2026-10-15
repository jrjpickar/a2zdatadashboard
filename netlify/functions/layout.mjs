// GET /api/layout (signed in) -> the shared tile layout.
// POST /api/layout (senior admins only) -> save it.
import { json, errorResponse, readJson, sameOrigin } from '../../lib/http.mjs';
import { requireSession } from '../../lib/auth.mjs';
import { cleanLayout, emptyLayout } from '../../lib/layout.mjs';
import { kpiStore, KEYS } from '../../lib/store.mjs';

export default async function handler(request) {
  try {
    const store = kpiStore();
    if (request.method === 'GET') {
      await requireSession(request);
      return json((await store.get(KEYS.layout, { type: 'json' })) || emptyLayout());
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    sameOrigin(request);
    const session = await requireSession(request);
    if (!session.senior) return json({ error: 'Only a senior admin can change the dashboard layout.' }, 403);
    const layout = cleanLayout(await readJson(request));
    await store.setJSON(KEYS.layout, { ...layout, updatedBy: session.name, updatedAt: new Date().toISOString() });
    return json({ ok: true, layout });
  } catch (error) { return errorResponse(error); }
}
