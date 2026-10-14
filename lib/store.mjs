// Netlify Blobs, one store for the dashboard. Tests and the sandbox swap in a Map.
import { getStore } from '@netlify/blobs';
let override = null;
export const useMemoryStore = (map = new Map()) => {
  override = {
    async get(key, opts = {}) { const v = map.get(key); if (v === undefined) return null; return opts.type === 'json' ? JSON.parse(v) : v; },
    async setJSON(key, value) { map.set(key, JSON.stringify(value)); },
    async set(key, value) { map.set(key, String(value)); },
    async delete(key) { map.delete(key); }
  };
  return override;
};
export const kpiStore = () => override || getStore({ name: 'a2z-kpi', consistency: 'strong' });
export const KEYS = {
  snapshot: 'snapshot', status: 'status', settings: 'settings', lock: 'sync-lock',
  stageEvents: 'stage-events', lastStages: 'last-stages', hireEvents: 'hire-events',
  calls: 'twilio-calls', access: 'access', queue: 'queue-overrides', workflows: 'workflow-stats', contacts: 'contacts-cache', touches: 'conversation-touches', webhook: 'webhook-log'
};
