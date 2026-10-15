import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLayout, emptyLayout } from '../lib/layout.mjs';

test('layout: empty layout has the four maps', () => {
  assert.deepEqual(emptyLayout(), { containers: {}, hidden: {}, labels: {}, spans: {} });
});

test('layout: keeps valid entries, dedupes order, drops junk', () => {
  const l = cleanLayout({
    containers: { 'overview:kpis:0': ['a', 'b', 'a', 'c'], 'bad': 'not-an-array' },
    hidden: { 'overview:kpis:0#a': true, 'x': false },
    labels: { 'overview:grid:0#jobs': '  Pipeline  ', 'overview:grid:0#blank': '   ' },
    spans: { 'overview:grid:0#jobs': 8, 'overview:grid:0#too-wide': 20, 'overview:grid:0#too-narrow': 2 }
  });
  assert.deepEqual(l.containers['overview:kpis:0'], ['a', 'b', 'c']);
  assert.equal(l.containers.bad, undefined);
  assert.equal(l.hidden['overview:kpis:0#a'], true);
  assert.equal('x' in l.hidden, false);
  assert.equal(l.labels['overview:grid:0#jobs'], 'Pipeline');
  assert.equal('overview:grid:0#blank' in l.labels, false);
  assert.equal(l.spans['overview:grid:0#jobs'], 8);
  assert.equal('overview:grid:0#too-wide' in l.spans, false);
  assert.equal('overview:grid:0#too-narrow' in l.spans, false);
});

test('layout: non-object input returns empty maps', () => {
  assert.deepEqual(cleanLayout(null), { containers: {}, hidden: {}, labels: {}, spans: {} });
  assert.deepEqual(cleanLayout('nope'), { containers: {}, hidden: {}, labels: {}, spans: {} });
});
