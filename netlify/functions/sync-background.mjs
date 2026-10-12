// Background function: the actual sync. Started by the scheduler or Refresh, never by a browser directly.
import { runSync, withSyncLock } from '../../lib/sync.mjs';
import { kpiStore } from '../../lib/store.mjs';
import { equal } from '../../lib/auth.mjs';

export default async function handler(request) {
  if (request.method !== 'POST' || !equal(request.headers.get('x-sync-secret'), process.env.SYNC_SECRET)) return new Response('Forbidden', { status: 403 });
  const store = kpiStore();
  const result = await withSyncLock(store, () => runSync({ store }));
  console.log('KPI sync', JSON.stringify(result.skipped ? result : Object.fromEntries(Object.entries(result.feeds).map(([k, v]) => [k, v.ok ? 'ok' : v.error]))));
  return new Response('ok');
}
