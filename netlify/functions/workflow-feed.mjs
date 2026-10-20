// POST /api/workflow-feed  (from the GHL Custom JS feed, public/ghl-workflow-feed.js)
// Body is text/plain JSON (no CORS preflight): { key, action, who, ... }
//   claim    -> { go, workflows: [{ id, name, newest, pending }], backfillDays }   (one browser per interval)
//   ingest   -> { wf, rows, state }   slim log rows for one workflow + its paging state
//   overview -> { statistics, weekly, trigger }
//   done     -> marks the run finished
// Write-only: the key lets a browser add workflow stats, never read dashboard data.
import { kpiStore, KEYS } from '../../lib/store.mjs';
import { equal } from '../../lib/auth.mjs';
import { emptyWorkflowData, prepareWorkflowProgress, ingestRows, applyState, claimLease, applyOverview } from '../../lib/workflows.mjs';

const ORIGIN_OK = o => /^https:\/\/([a-z0-9-]+\.)*(gohighlevel\.com|leadconnectorhq\.com|msgsndr\.com)$/i.test(o) || String(process.env.FEED_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean).includes(o);
function reply(request, body, status = 200) {
  const origin = request.headers.get('origin') || '';
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(ORIGIN_OK(origin) ? { 'access-control-allow-origin': origin, vary: 'origin' } : {}) } });
}

export async function handleFeed(body, { store = kpiStore(), now = Date.now(), env = process.env } = {}) {
  if (!env.WORKFLOW_FEED_KEY) return [503, { error: 'WORKFLOW_FEED_KEY is not set' }];
  if (!equal(body.key, env.WORKFLOW_FEED_KEY)) return [401, { error: 'bad key' }];
  const data = (await store.get(KEYS.workflows, { type: 'json' })) || emptyWorkflowData();
  const who = String(body.who || 'browser').slice(0, 80);
  if (body.action === 'claim') {
    if (!claimLease(data, who, now, Number(env.WORKFLOW_FEED_MINUTES) || 25)) return [200, { go: false }];
    prepareWorkflowProgress(data);
    const snap = await store.get(KEYS.snapshot, { type: 'json' });
    const list = (snap?.workflows || []).filter(w => w.status === 'published');
    data.lastRunBy = who;
    await store.setJSON(KEYS.workflows, data);
    return [200, { go: true, backfillDays: 30, workflows: list.map(w => ({ id: w.id, name: w.name, newest: data.state[w.id]?.newest || '', pending: data.state[w.id]?.pending || null })) }];
  }
  if (!data.lease || data.lease.who !== who) return [409, { error: 'not the lease holder' }];
  if (body.action === 'ingest') {
    if (Array.isArray(body.rows) && body.rows.length > 5000) return [400, { error: 'batch exceeds 5000 rows' }];
    const rows = Array.isArray(body.rows) ? body.rows.filter(r => r && r.wf === String(body.wf || '')) : [];
    const added = ingestRows(data, rows, { now });
    applyState(data, String(body.wf || ''), body.state);
    data.lastIngestAt = new Date(now).toISOString();
    data.updatedAt = data.lastIngestAt;
    await store.setJSON(KEYS.workflows, data);
    return [200, { ok: true, added }];
  }
  if (body.action === 'overview') { applyOverview(data, body); data.updatedAt = new Date(now).toISOString(); await store.setJSON(KEYS.workflows, data); return [200, { ok: true }]; }
  if (body.action === 'done') { data.lease = { who, at: new Date(now).toISOString(), done: true }; data.lastIngestAt = new Date(now).toISOString(); await store.setJSON(KEYS.workflows, data); return [200, { ok: true }]; }
  return [400, { error: 'unknown action' }];
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return reply(request, {}, 204);
  if (request.method !== 'POST') return reply(request, { error: 'Method not allowed' }, 405);
  const text = await request.text();
  if (text.length > 3_000_000) return reply(request, { error: 'too large' }, 413);
  let body; try { body = JSON.parse(text); } catch { return reply(request, { error: 'bad json' }, 400); }
  try { const [status, out] = await handleFeed(body); return reply(request, out, status); }
  catch (e) { console.error('workflow-feed', e); return reply(request, { error: 'failed' }, 500); }
}
