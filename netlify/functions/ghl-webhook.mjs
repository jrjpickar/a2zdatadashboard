// POST /api/ghl-webhook?key=<GHL_WEBHOOK_SECRET>   (optional, for exact stage-change times)
// From a GHL workflow: trigger "Pipeline Stage Changed" -> action Webhook (POST) with
// custom data opportunity_id = {{opportunity.id}} and stage_id = {{opportunity.pipeline_stage_id}}
// (or stage_name = {{opportunity.pipeline_stage}}). Without it, the sync still notices
// stage changes within one sync interval.
import { json, errorResponse, readJson, HttpError } from '../../lib/http.mjs';
import { config } from '../../lib/config.mjs';
import { equal } from '../../lib/auth.mjs';
import { kpiStore, KEYS } from '../../lib/store.mjs';
import { normName } from '../../lib/normalize.mjs';

export function parseStageHook(body, stages = {}) {
  const data = { ...(body.customData || {}), ...body };
  const oppId = String(data.opportunity_id || data.opportunityId || data.opportunity?.id || (data.type === 'OpportunityStageUpdate' ? data.id : '') || '').trim();
  let stageId = String(data.stage_id || data.pipelineStageId || data.pipeline_stage_id || data.opportunity?.pipelineStageId || '').trim();
  if (!stageId && (data.stage_name || data.pipeline_stage)) {
    const want = normName(data.stage_name || data.pipeline_stage);
    const pipelineId = data.pipeline_id || data.pipelineId || '';
    const hit = Object.entries(stages).find(([, s]) => normName(s.name) === want && (!pipelineId || s.pipelineId === pipelineId));
    stageId = hit ? hit[0] : '';
  }
  return oppId && stageId ? { oppId, stageId } : null;
}
export default async function handler(request) {
  try {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const cfg = config();
    if (!cfg.webhookSecret) throw new HttpError('GHL_WEBHOOK_SECRET is not set.', 503);
    if (!equal(new URL(request.url).searchParams.get('key'), cfg.webhookSecret)) throw new HttpError('Invalid key', 401);
    const store = kpiStore();
    const snap = await store.get(KEYS.snapshot, { type: 'json' });
    const hit = parseStageHook(await readJson(request), snap?.config?.stages);
    if (!hit) return json({ ok: false, ignored: 'no opportunity id / stage' });
    const hooks = (await store.get(KEYS.webhook, { type: 'json' })) || { events: {} };
    const mine = (hooks.events ||= {})[hit.oppId] ||= {};
    if (!mine[hit.stageId]) mine[hit.stageId] = new Date().toISOString();
    hooks.lastReceivedAt = new Date().toISOString();
    hooks.received = (hooks.received || 0) + 1;
    await store.setJSON(KEYS.webhook, hooks);
    return json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
