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

const progressNow = Date.parse('2026-10-20T20:00:00Z');
const progressRange = { from: '2026-10-01', to: '2026-10-20' };
const progressSnap = d => ({ config: { timeZone: 'America/Los_Angeles', pipelines: {} },
  workflows: [{ id: 'W', name: 'Intake', status: 'published' }], workflowStats: publicWorkflowData(d, { includeProgress: true }) });

test('progress merges reverse-order logs, retries and replays; repeat enrollments stay separate', () => {
  const d = emptyWorkflowData();
  const rows = [
    row('end', 'R1', '2026-10-19T15:00:00Z', 'finished', { end: true, step: '', contactId: '', contactName: '' }),
    row('ok', 'R1', '2026-10-19T14:10:00Z', 'success', { stepId: 'sms' }),
    row('fail', 'R1', '2026-10-19T14:00:00Z', 'failed', { stepId: 'sms' }),
    row('again', 'R2', '2026-10-20T14:00:00Z', 'success', { stepId: 'sms' })
  ];
  ingestRows(d, rows, { now: progressNow });
  const saved = JSON.stringify(d.progress);
  assert.equal(ingestRows(d, rows, { now: progressNow }), 0);
  assert.equal(JSON.stringify(d.progress), saved);
  const p = M.workflowProgress(progressSnap(d), { range: progressRange, workflow: 'W', now: progressNow });
  assert.equal(p.runs, 2);
  assert.equal(p.finished, 1);
  assert.equal(p.stages.length, 1);
  assert.deepEqual([p.stages[0].count, p.stages[0].successful, p.stages[0].failed], [2, 2, 1]);
  const run = p.details.find(r => r.run === 'R1');
  assert.equal(run.firstAt, '2026-10-19T14:00:00.000Z');
  assert.equal(run.status, 'finished');
  assert.equal(run.contactName, 'Diego');
});

test('progress does not invent intermediate steps across branches; duplicate labels use action IDs', () => {
  const d = emptyWorkflowData();
  ingestRows(d, [
    row('a', 'R1', '2026-10-19T14:00:00Z', 'success', { stepId: 'A', step: 'Message' }),
    row('b', 'R2', '2026-10-19T14:00:00Z', 'skipped', { stepId: 'B', step: 'Message' }),
    row('c', 'R3', '2026-10-19T14:00:00Z', 'success', { stepId: 'B', step: 'Message' }),
    row('missing-run', '', '2026-10-19T14:00:00Z', 'success')
  ], { now: progressNow });
  const p = M.workflowProgress(progressSnap(d), { range: progressRange, workflow: 'W' });
  assert.equal(p.runs, 3);
  assert.equal(p.stages.length, 2);
  assert.deepEqual(p.stages.map(s => s.count).sort(), [1, 2]);
  const b = p.stages.find(s => s.id === '["id","B"]');
  assert.deepEqual([b.successful, b.skipped], [1, 1]);
  const drill = M.workflowProgress(progressSnap(d), { range: progressRange, workflow: 'W', stage: b.id });
  assert.equal(drill.details.length, 2);
  assert(!drill.details.some(r => r.run === 'R1'));
});

test('stage cohort uses first observed date in Pacific time even when completion is later', () => {
  const d = emptyWorkflowData();
  ingestRows(d, [row('end', 'R', '2026-10-20T17:00:00Z', 'finished', { end: true }),
    row('start', 'R', '2026-10-20T06:59:00Z')], { now: progressNow });
  const snap = progressSnap(d);
  assert.equal(M.workflowProgress(snap, { range: { from: '2026-10-19', to: '2026-10-19' }, workflow: 'W' }).finished, 1);
  assert.equal(M.workflowProgress(snap, { range: { from: '2026-10-20', to: '2026-10-20' }, workflow: 'W' }).runs, 0);
});

test('migration replays once, preserving daily totals and reconstructing progress from already-seen logs', async () => {
  const store = useMemoryStore(new Map()), env = { WORKFLOW_FEED_KEY: 'secret' };
  const d = emptyWorkflowData();
  const r = row('seen', 'R', '2026-10-19T14:00:00Z');
  ingestRows(d, [r], { now: progressNow });
  const totals = JSON.stringify(d.daily);
  d.version = 1; delete d.progress;
  d.state.W = { newest: '2026-10-20T19:00:00Z' };
  await store.setJSON(KEYS.workflows, d);
  await store.setJSON(KEYS.snapshot, { workflows: [{ id: 'W', status: 'published' }] });
  const args = { store, env, now: progressNow };
  const [, claim] = await handleFeed({ key: 'secret', who: 'A', action: 'claim' }, args);
  assert.equal(claim.workflows[0].newest, '');
  await handleFeed({ key: 'secret', who: 'A', action: 'ingest', wf: 'W', rows: [r], state: { newest: '2026-10-20T20:00:00Z' } }, args);
  const upgraded = await store.get(KEYS.workflows, { type: 'json' });
  assert.equal(upgraded.version, 2);
  assert.equal(JSON.stringify(upgraded.daily), totals);
  assert.equal(Object.keys(upgraded.progress).length, 1);
  const [, again] = await handleFeed({ key: 'secret', who: 'A', action: 'claim' }, args);
  assert.equal(again.workflows[0].newest, '2026-10-20T20:00:00.000Z');
});

test('progress retention prunes inactive runs; same run ID in another workflow stays independent', () => {
  const d = emptyWorkflowData();
  const old = Date.parse('2026-06-01T12:00:00Z');
  ingestRows(d, [row('old', 'old', new Date(old).toISOString())], { now: old });
  ingestRows(d, [row('new1', 'same', '2026-10-19T14:00:00Z'), row('new2', 'same', '2026-10-19T14:00:00Z', 'success', { wf: 'OTHER' })], { now: progressNow });
  assert.equal(Object.keys(d.progress).length, 2);
  assert(Object.values(d.progress).every(r => r.run === 'same'));
  assert(!('progress' in publicWorkflowData(d)), 'normal dashboard payload excludes raw progress');
});

test('progress endpoint bounds contact detail, validates dates, and requires a session', async () => {
  const { progressResponse, default: handler } = await import('../netlify/functions/workflow-progress.mjs');
  const d = emptyWorkflowData();
  ingestRows(d, Array.from({ length: 205 }, (_, n) => row('row' + n, 'run' + n, '2026-10-19T14:00:00Z')), { now: progressNow });
  const params = new URLSearchParams({ workflow: 'W', from: progressRange.from, to: progressRange.to });
  const response = progressResponse(progressSnap(d), d, params, progressNow);
  assert.equal(response.runs, 205);
  assert.equal(response.detailCount, 205);
  assert.equal(response.details.length, 200);
  params.set('from', '2026-02-30');
  assert.throws(() => progressResponse(progressSnap(d), d, params), /valid date/);
  const result = await handler(new Request('https://dashboard.test/api/workflow-progress?from=2026-10-01&to=2026-10-20'));
  assert.equal(result.status, 401);
});
