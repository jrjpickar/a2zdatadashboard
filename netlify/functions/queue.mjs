// GET  /api/queue (signed in)  -> action queue overrides
// POST /api/queue (admins)     { key, action: done | dismiss | snooze | restore, until?, baseline, label? }
// An override holds until GHL shows something new on that lead or caller (the dashboard
// compares the item's latest GHL activity with the baseline saved here). Kept 180 days.
import { json, errorResponse, readJson, sameOrigin, HttpError } from '../../lib/http.mjs';
import { requireSession, requireOwner } from '../../lib/auth.mjs';
import { kpiStore, KEYS } from '../../lib/store.mjs';

export function applyQueueChange(map, body, actor, now = Date.now()) {
  const key = String(body.key || '').slice(0, 200);
  if (!/^(no-reply|estimate-overdue|no-follow-up|missed-call):[A-Za-z0-9_-]+$/.test(key)) throw new HttpError('Unknown queue item');
  const out = { ...map };
  if (body.action === 'restore') delete out[key];
  else if (['done', 'dismiss', 'snooze'].includes(body.action)) {
    const until = body.action === 'snooze' ? new Date(body.until || '') : null;
    if (until && (!Number.isFinite(+until) || +until <= now)) throw new HttpError('Pick a snooze date in the future.');
    out[key] = { action: body.action, until: until ? until.toISOString() : '', baseline: String(body.baseline || ''), by: actor.name, at: new Date(now).toISOString(), label: String(body.label || '').slice(0, 160) };
  } else throw new HttpError('Unknown action');
  const cutoff = new Date(now - 180 * 86400000).toISOString();
  for (const [k, v] of Object.entries(out)) if (v.at < cutoff) delete out[k];
  return out;
}
export default async function handler(request) {
  try {
    const store = kpiStore();
    if (request.method === 'GET') { await requireSession(request); return json((await store.get(KEYS.queue, { type: 'json' })) || {}); }
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    sameOrigin(request);
    const me = await requireOwner(request);
    const next = applyQueueChange((await store.get(KEYS.queue, { type: 'json' })) || {}, await readJson(request), me);
    await store.setJSON(KEYS.queue, next);
    return json(next);
  } catch (error) { return errorResponse(error); }
}
