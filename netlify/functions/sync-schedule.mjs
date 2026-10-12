// Every 15 minutes: start a sync if the last one is older than SYNC_INTERVAL_MINUTES (default 30).
import { config as readConfig } from '../../lib/config.mjs';
import { kpiStore, KEYS } from '../../lib/store.mjs';
import { triggerBackgroundSync } from '../../lib/trigger.mjs';

export default async function handler() {
  const cfg = readConfig();
  const status = await kpiStore().get(KEYS.status, { type: 'json' });
  const age = status?.lastRunAt ? Date.now() - Date.parse(status.lastRunAt) : Infinity;
  if (age < (cfg.syncIntervalMinutes - 2) * 60000) return new Response('fresh');
  try { await triggerBackgroundSync(); } catch (e) { console.error('KPI scheduler', e.message); }
  return new Response('started');
}
export const config = { schedule: '*/15 * * * *' };
