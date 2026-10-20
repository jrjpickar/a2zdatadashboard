import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the real browser script with fake HTTP responses. No live GHL calls.
async function exerciseFeed({ failBatch = false } = {}) {
  const source = await readFile(new URL('../public/ghl-workflow-feed.js', import.meta.url), 'utf8');
  const batches = [], commits = [];
  let offset = 0, active = 0, maximumActive = 0, done = false;
  const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fetch = async (url, init = {}) => {
    if (String(url).startsWith('https://dashboard.test')) {
      const body = JSON.parse(init.body);
      if (body.action === 'claim') return response({ go: true, workflows: [{ id: 'W' }] });
      if (body.action === 'ingest') {
        active++; maximumActive = Math.max(active, maximumActive);
        await new Promise(resolve => setImmediate(resolve));
        batches.push(body);
        active--;
        if (failBatch) return response({ error: 'storage unavailable' }, 503);
        commits.push(body.state);
      }
      if (body.action === 'done') done = true;
      return response({ ok: true });
    }
    if (String(url).includes('/workflows/logs/v2')) {
      const count = Math.min(50, 2050 - offset);
      const rows = Array.from({ length: count }, (_, n) => {
        const i = offset + n;
        return { _id: 'event-' + i, workflowId: 'W', workflowStatusId: 'R' + i,
          createdAt: new Date(Date.parse('2026-10-20T20:00:00Z') - i * 1000).toISOString(),
          sequence: i, status: 'success', stepName: 'SMS', actionId: 'sms-action', contactId: 'C' + i };
      });
      offset += count;
      return response(rows);
    }
    return response({});
  };
  const window = { fetch };
  const context = { window, document: { currentScript: { src: 'https://dashboard.test/ghl-workflow-feed.js', dataset: { key: 'key', location: 'L' } } },
    location: { pathname: '/v2/location/L/automation' }, URL, Headers, Promise, Date, Math,
    setTimeout(fn, ms) { if (ms === 300) queueMicrotask(fn); }, setInterval() {} };
  vm.runInNewContext(source, context);
  await window.fetch('https://backend.leadconnectorhq.com/probe', { headers: { authorization: 'Bearer ' + 'x'.repeat(30) } });
  const result = await window.__a2zWorkflowFeedRun();
  return { batches, commits, maximumActive, done, result };
}

test('browser feed commits batches sequentially, preserving action IDs and advancing cursor last', async () => {
  const r = await exerciseFeed();
  assert.equal(r.result, 'done');
  assert.equal(r.maximumActive, 1);
  assert.deepEqual(r.batches.map(b => b.rows.length), [2000, 50]);
  assert.equal(r.batches[0].rows[0].stepId, 'sms-action');
  assert.equal(r.commits[0], null);
  assert(r.commits[1].newest);
  assert.equal(r.done, true);
});

test('browser feed stops on rejected ingest without committing a cursor or marking done', async () => {
  const r = await exerciseFeed({ failBatch: true });
  assert.match(r.result, /error: Workflow feed 503/);
  assert.equal(r.batches.length, 1);
  assert.equal(r.commits.length, 0);
  assert.equal(r.done, false);
});
