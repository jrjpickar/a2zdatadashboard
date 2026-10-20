// Read progress only when the Workflows funnel is opened. Raw per-run history
// stays out of the main dashboard snapshot; contact drilldowns are bounded.
import { json, errorResponse, HttpError } from '../../lib/http.mjs';
import { config } from '../../lib/config.mjs';
import { requireSession } from '../../lib/auth.mjs';
import { kpiStore, KEYS } from '../../lib/store.mjs';
import { publicWorkflowData } from '../../lib/workflows.mjs';
import { workflowProgress } from '../../public/metrics.js';

export function progressResponse(snapshot, data, params, now = Date.now()) {
  const from = params.get('from') || '', to = params.get('to') || '';
  const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
  if (!validDate(from) || !validDate(to) || from > to) throw new HttpError('A valid date range is required');
  const p = workflowProgress({ config: snapshot?.config || {}, workflows: snapshot?.workflows || [],
    workflowStats: publicWorkflowData(data, { includeProgress: true, tz: snapshot?.config?.timeZone }) },
    { range: { from, to }, workflow: params.get('workflow') || '', stage: params.get('stage') || '', now });
  return { ...p, detailCount: p.details.length, details: p.details.slice(0, 200) };
}
export default async function handler(request) {
  try {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    await requireSession(request, config());
    const store = kpiStore();
    const [snapshot, data] = await Promise.all([store.get(KEYS.snapshot, { type: 'json' }), store.get(KEYS.workflows, { type: 'json' })]);
    return json(progressResponse(snapshot, data, new URL(request.url).searchParams));
  } catch (error) { return errorResponse(error); }
}
