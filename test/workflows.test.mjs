import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkflowData, ingestRows, claimLease, applyState, applyOverview, publicWorkflowData } from '../lib/workflows.mjs';
import { handleFeed } from '../netlify/functions/workflow-feed.mjs';
import { useMemoryStore, KEYS } from '../lib/store.mjs';
import * as M from '../public/metrics.js';

const row = (id, run, at, status = 'success', extra = {}) => ({ id, wf: 'W', run, at, status, type: 'sms', step: 'SMS', contactId: 'c1', contactName: 'Diego', reason: '', ...extra });

test('ingest dedupes, counts each run once, tracks finished runs and issue reasons', () => {
  const d = emptyWorkflowData();
  const rows = [
    row('a', 'R1', '2026-10-14T14:07:12Z'), row('b', 'R1', '2026-10-14T14:07:16Z'),
    row('c', 'R1', '2026-10-14T14:07:37Z', 'skipped', { step: 'Send documents & contracts', reason: 'Internal Action Error - [HTTP 400] Contact does not have an email' }),
    row('e', 'R1', '2026-10-14T14:07:38Z', 'finished', { type: 'remove_from_workflow', end: true }),
    row('f', 'R2', '2026-10-14T15:00:00Z', 'failed', { reason: 'Twilio error' })
  ];
  const now = Date.parse('2026-10-14T20:00:00Z');
  assert.equal(ingestRows(d, rows, { now }), 5);
  assert.equal(ingestRows(d, rows, { now }), 0);
  const day = d.daily.W['2026-10-14'];
  assert.deepEqual([day.runs, day.finished, day.skipped, day.failed, day.steps], [2, 1, 1, 1, 5]);
  assert.equal(day.reasons['[HTTP 400] Contact does not have an email'], 1);
  assert.equal(d.issues.length, 2);
});

test('lease lets one tab work per interval, including the tab that just finished', () => {
  const d = emptyWorkflowData(), t = Date.parse('2026-10-14T20:00:00Z');
  assert.equal(claimLease(d, 'A', t), true);
  assert.equal(claimLease(d, 'B', t + 60000), false);
  assert.equal(claimLease(d, 'A', t + 60000), true);
  d.lease.done = true;
  assert.equal(claimLease(d, 'A', t + 5 * 60000), false);
  assert.equal(claimLease(d, 'B', t + 26 * 60000), true);
});

test('applyState keeps the per-workflow cursor; applyOverview grows the weekly history', () => {
  const d = emptyWorkflowData();
  applyState(d, 'W', { newest: '2026-10-14T20:00:00Z', pending: { from: '2026-09-14T00:00:00Z', to: '2026-10-14T20:00:00Z', cursor: { createdAt: '2026-10-14T14:00:00Z', sequence: 2, id: 'id9' } } });
  assert.equal(d.state.W.pending.cursor.id, 'id9');
  applyOverview(d, { statistics: { totalWorkflows: 71, publishedWorkflows: 49 }, weekly: [{ weekStart: '2026-10-04', enrollments: '397' }], trigger: { total: '14486', matched: '1450' } });
  applyOverview(d, { weekly: [{ weekStart: '2026-10-11', enrollments: '236' }] });
  assert.deepEqual(d.overview.weeklyHistory, { '2026-10-04': 397, '2026-10-11': 236 });
  assert.equal(d.overview.publishedWorkflows, 49);
});

test('feed endpoint: key gate, lease gate, claim/ingest/done, and the Workflows tab reads it', async () => {
  const store = useMemoryStore(new Map());
  const env = { WORKFLOW_FEED_KEY: 'k'.repeat(32) };
  await store.setJSON(KEYS.snapshot, { workflows: [{ id: 'W', name: 'Crew schedule text', status: 'published' }, { id: 'X', name: 'Old', status: 'draft' }] });
  assert.equal((await handleFeed({ key: 'nope', action: 'claim' }, { store, env }))[0], 401);
  const [, c] = await handleFeed({ key: env.WORKFLOW_FEED_KEY, action: 'claim', who: 'A' }, { store, env });
  assert.deepEqual(c.workflows.map(w => w.id), ['W']);
  assert.equal((await handleFeed({ key: env.WORKFLOW_FEED_KEY, action: 'ingest', who: 'B', wf: 'W', rows: [] }, { store, env }))[0], 409);
  await handleFeed({ key: env.WORKFLOW_FEED_KEY, action: 'ingest', who: 'A', wf: 'W', rows: [row('a', 'R1', '2026-10-14T14:07:12Z'), row('c', 'R1', '2026-10-14T14:08:00Z', 'skipped', { reason: 'Contact does not have an email' })], state: { newest: '2026-10-14T20:00:00Z', pending: null } }, { store, env });
  await handleFeed({ key: env.WORKFLOW_FEED_KEY, action: 'overview', who: 'A', statistics: { publishedWorkflows: 49, totalWorkflows: 71 }, weekly: [{ weekStart: '2026-10-11', enrollments: '236' }], trigger: { total: '14486', matched: '1450' } }, { store, env });
  await handleFeed({ key: env.WORKFLOW_FEED_KEY, action: 'done', who: 'A' }, { store, env });
  const data = publicWorkflowData(await store.get(KEYS.workflows, { type: 'json' }));
  const snap = { config: { timeZone: 'America/Los_Angeles', pipelines: {} }, workflows: [{ id: 'W', name: 'Crew schedule text', status: 'published' }], workflowStats: data };
  const w = M.workflowsSection(snap, { range: { from: '2026-10-01', to: '2026-10-14' }, now: Date.parse('2026-10-14T20:00:00Z') });
  assert.deepEqual([w.runs, w.skipped, w.issues.length, w.rows[0].name], [1, 1, 1, 'Crew schedule text']);
  assert.equal(Math.round(w.triggerRate * 1000), 100);
  assert.equal(w.weeks.at(-1).enrollments, 236);
});
