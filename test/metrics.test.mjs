import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/metrics.js';
import { sampleSnapshot } from '../sandbox/sample.mjs';

const TZ = 'America/Los_Angeles';
const NOW = Date.parse('2026-10-12T20:00:00Z');
const S = { businessHours: { open: '07:00', close: '17:00' }, workdays: [1, 2, 3, 4, 5, 6], rentalDays: 7, followUpDays: 3, estimateDays: 1, containerFleet: { '10 Yard': 4 } };
const P = { demo: 'D', labor: 'L', containers: 'C', changeOrders: 'CO', hiring: 'H' };
const base = over => ({ settings: S, config: { timeZone: TZ, pipelines: P, stages: { Dp: { name: 'Proposal Sent', position: 1, pipelineId: 'D' }, Dn: { name: 'New Lead', position: 0, pipelineId: 'D' } }, proposalStageIds: ['Dp'], laborerTypes: ['laborer'], activeTemps: ['warm', 'hot', 'vip'], dormantTemps: ['cold'] }, contacts: [], opportunities: [], ...over });

test('periods are Pacific: WTD starts Monday, MTD the 1st', () => {
  assert.deepEqual(M.periodRange('wtd', Date.parse('2026-10-15T18:00:00Z'), TZ), { from: '2026-10-12', to: '2026-10-15' });
  assert.deepEqual(M.periodRange('mtd', NOW, TZ), { from: '2026-10-01', to: '2026-10-12' });
  // 11pm Pacific on Oct 12 is still Oct 12.
  assert.equal(M.localDate('2026-10-13T06:00:00Z', TZ), '2026-10-12');
});

test('business minutes skip nights and Sundays', () => {
  // Sat 4pm -> Mon 8am Pacific (PDT): 60 min Saturday + 60 min Monday.
  assert.equal(M.businessMinutes('2026-10-10T23:00:00Z', '2026-10-12T15:00:00Z', S, TZ), 120);
});

test('first response counts the human touch after the lead, in business hours', () => {
  const snap = base({
    contacts: [{ id: 'c1', name: 'A', type: 'home-owner', phone: '+19495550001' }],
    opportunities: [{ id: 'o1', pipelineId: 'D', stageId: 'Dn', status: 'open', value: 100, createdAt: '2026-10-12T16:00:00Z', contactId: 'c1' }],
    messageTouches: { c1: [{ at: '2026-10-12T16:45:00Z' }] }
  });
  const l = M.leadsSection(snap, { range: { from: '2026-10-12', to: '2026-10-12' }, rep: '', now: NOW });
  assert.equal(l.total, 1);
  assert.equal(l.response.median, 45);
  assert.equal(l.response.within60, 1);
});

test('laborers are not leads; repeat customers bucket as repeat', () => {
  const snap = base({
    contacts: [{ id: 'c1', type: 'general-contractor', source: 'Website form' }, { id: 'w1', type: 'laborer' }],
    opportunities: [
      { id: 'old', pipelineId: 'L', status: 'won', value: 50, createdAt: '2026-01-01T16:00:00Z', statusChangedAt: '2026-01-05T16:00:00Z', contactId: 'c1' },
      { id: 'new', pipelineId: 'D', stageId: 'Dn', status: 'open', value: 10, createdAt: '2026-10-05T16:00:00Z', contactId: 'c1' },
      { id: 'lab', pipelineId: 'D', stageId: 'Dn', status: 'open', value: 10, createdAt: '2026-10-05T16:00:00Z', contactId: 'w1' }
    ]
  });
  const l = M.leadsSection(snap, { range: { from: '2026-10-01', to: '2026-10-12' }, rep: '', now: NOW });
  assert.equal(l.total, 1);
  assert.equal(l.bySource[0].key, 'Repeat customer');
});

test('estimate sent comes from the recorded Proposal Sent entry; win rate by count and dollars', () => {
  const snap = base({
    contacts: [{ id: 'c1', type: 'developer' }],
    opportunities: [
      { id: 'a', pipelineId: 'D', stageId: 'Dp', status: 'won', value: 300, createdAt: '2026-10-05T16:00:00Z', statusChangedAt: '2026-10-08T16:00:00Z', contactId: 'c1' },
      { id: 'b', pipelineId: 'D', stageId: 'Dp', status: 'lost', value: 100, createdAt: '2026-10-05T16:00:00Z', statusChangedAt: '2026-10-09T16:00:00Z', contactId: 'c1', lostReason: 'Price' }
    ],
    stageEvents: { a: { Dp: { at: '2026-10-05T20:00:00Z', src: 'sync' } }, b: { Dp: { at: '2026-10-07T20:00:00Z', src: 'sync' } } }
  });
  const e = M.estimatesSection(snap, { range: { from: '2026-10-01', to: '2026-10-12' }, rep: '', now: NOW });
  assert.equal(e.sent, 2);
  assert.equal(e.turnaround.withinDay, 0.5);
  assert.equal(e.winRate, 0.5);
  assert.equal(e.winRateValue, 0.75);
  assert.equal(e.lostReasons[0].key, 'Price');
  assert.equal(e.byType[0].key, 'Developer');
});

test('containers: drops minus pickups per customer, rental length, past due, swaps keep the count', () => {
  const run = (date, movementType, key = 'k1') => ({ moveId: 'm-' + key, date, movementType, containerSize: '10 Yard', loadCount: 1, sourceOpportunityId: key, assetIds: [] });
  const snap = base({ dispatch: { jobs: [], moves: [], jobDays: [], moveRuns: [run('2026-09-01', 'container_drop'), run('2026-09-03', 'container_swap'), run('2026-09-06', 'container_pickup'), run('2026-10-01', 'container_drop', 'k2')] } });
  const c = M.containersSection(snap, { range: { from: '2026-09-01', to: '2026-09-30' }, now: NOW });
  assert.equal(c.out, 1);
  assert.equal(c.utilization, 0.25);
  assert.equal(c.avgRental, 5);
  assert.equal(c.swaps, 1);
  assert.equal(c.pastDue.length, 1);
});

test('crew utilization = logged crew-days / active laborers x work days', () => {
  const snap = base({
    contacts: [{ id: 'w1', type: 'laborer', temperature: 'hot' }, { id: 'w2', type: 'laborer', temperature: 'warm' }, { id: 'w3', type: 'laborer', temperature: 'cold' }],
    dispatch: { jobs: [], moves: [], moveRuns: [], jobDays: [{ jobId: 'j', date: '2026-10-05', crew: [{ id: 'w1', name: 'A' }, { id: 'w2', name: 'B' }] }, { jobId: 'j', date: '2026-10-06', crew: [{ id: 'w1', name: 'A' }] }] }
  });
  const c = M.crewsSection(snap, { range: { from: '2026-10-05', to: '2026-10-06' }, rep: '', now: NOW });
  assert.equal(c.activeLaborers, 2);
  assert.equal(c.booked, 3);
  assert.equal(c.available, 4);
  assert.equal(c.utilization, 0.75);
});

test('hiring: warm/hot/VIP laborers are hired; cold is dormant', () => {
  const snap = base({
    contacts: [{ id: 'w1', type: 'laborer', temperature: 'vip' }, { id: 'w2', type: 'laborer', temperature: 'cold' }],
    opportunities: [{ id: 'h1', pipelineId: 'H', status: 'open', createdAt: '2026-10-02T16:00:00Z', contactId: 'w1' }, { id: 'h2', pipelineId: 'H', status: 'open', createdAt: '2026-10-03T16:00:00Z', contactId: 'w2' }],
    hireEvents: { w1: { at: '2026-10-06T16:00:00Z' } }
  });
  const h = M.hiringSection(snap, { range: { from: '2026-10-01', to: '2026-10-12' }, now: NOW });
  assert.deepEqual([h.applicants, h.hireRate, h.hires, h.active, h.dormant], [2, 0.5, 1, 1, 1]);
  assert.equal(h.medianDaysToHire, 4);
});

test('money: invoiced, collected and owed from Ledger columns', () => {
  const snap = base({ ledger: { invoiceStages: { a: 'paid', b: 'overdue' }, invoiceStageEvents: { a: { sent: '2026-10-01T16:00:00Z', paid: '2026-10-11T16:00:00Z' }, b: { sent: '2026-10-02T16:00:00Z' } }, invoices: [{ opportunityId: 'a', date: '2026-10-01', total: 1000, balance: 0 }, { opportunityId: 'b', date: '2026-10-02', total: 500, balance: 500 }], bills: [{ date: '2026-10-03', status: 'approved', balance: 200, amount: 200, lines: [{ category: 'Fuel', amount: 200 }] }], payroll: [] } });
  const m = M.moneySection(snap, { range: { from: '2026-10-01', to: '2026-10-12' }, now: NOW });
  assert.deepEqual([m.invoiced, m.collected, m.arOutstanding, m.arOverdue, m.daysToPaid, m.costOfRevenue], [1500, 1000, 500, 500, 10, 200]);
});

test('every tab computes on the sample snapshot without throwing', () => {
  const snap = sampleSnapshot(NOW);
  for (const p of ['today', 'wtd', 'mtd', 'ytd']) {
    const o = { range: M.periodRange(p, NOW, TZ), rep: '', now: NOW };
    for (const f of [M.overview, M.leadsSection, M.callsSection, M.estimatesSection, M.containersSection, M.jobsSection, M.crewsSection, M.hiringSection, M.moneySection]) f(snap, o);
  }
  assert.ok(M.actionQueue(snap, { rep: 'u-dan', now: NOW }).every(i => i.kind !== 'missed-call'));
  assert.ok(M.dataQuality(snap, { now: NOW }).checks.length > 5);
});

test('laborers (typed, in hiring, or on the labor roster) are never leads, queue items or lead calls', () => {
  const snap = base({
    contacts: [{ id: 'c1', type: 'home-owner', phone: '+19495550001' }, { id: 'w1', type: '', phone: '+19495550002' }, { id: 'w2', type: '', phone: '+19495550003' }],
    opportunities: [
      { id: 'o1', pipelineId: 'D', stageId: 'Dn', status: 'open', createdAt: '2026-10-12T16:00:00Z', contactId: 'c1' },
      { id: 'o2', pipelineId: 'D', stageId: 'Dn', status: 'open', createdAt: '2026-10-12T16:00:00Z', contactId: 'w1' },
      { id: 'h1', pipelineId: 'H', status: 'open', createdAt: '2026-10-01T16:00:00Z', contactId: 'w1' },
      { id: 'o3', pipelineId: 'D', stageId: 'Dn', status: 'open', createdAt: '2026-10-12T16:00:00Z', contactId: 'w2' }
    ],
    dispatch: { labor: [{ id: '', name: 'W2', phone: '+19495550003' }], jobs: [], moves: [], moveRuns: [], jobDays: [] },
    inboundCalls: [{ sid: 'a', at: '2026-10-12T17:00:00Z', from: '+19495550003', answered: false, calledBackAt: '' }, { sid: 'b', at: '2026-10-12T17:30:00Z', from: '+19495550001', answered: false, calledBackAt: '' }]
  });
  const o = { range: { from: '2026-10-12', to: '2026-10-12' }, rep: '', now: NOW };
  assert.equal(M.leadsSection(snap, o).total, 1);
  const q = M.actionQueue(snap, o);
  assert.ok(q.some(i => i.contactId === 'c1'));
  assert.ok(q.every(i => i.contactId !== 'w1' && i.contactId !== 'w2' && i.phone !== '+19495550003'));
  assert.equal(M.callsSection(snap, o).total, 1);
  const f = M.leadFunnel(snap, o);
  assert.equal(f.stages[0].count, 1);
});

test('estimates: within N business days follows the setting (default 3)', () => {
  const mk = estimateDays => base({ settings: { ...S, estimateDays }, contacts: [{ id: 'c1', type: 'developer' }], opportunities: [{ id: 'a', pipelineId: 'D', stageId: 'Dp', status: 'open', value: 1, createdAt: '2026-10-05T16:00:00Z', contactId: 'c1' }], stageEvents: { a: { Dp: { at: '2026-10-07T20:00:00Z', src: 'sync' } } } });
  const o = { range: { from: '2026-10-01', to: '2026-10-12' }, rep: '', now: NOW };
  assert.equal(M.estimatesSection(mk(1), o).turnaround.withinDay, 0);
  assert.equal(M.estimatesSection(mk(3), o).turnaround.withinDay, 1);
});

test('backlog counts only jobs still on the board and paces on invoiced work', () => {
  const won = (id, stageId, value) => ({ id, pipelineId: 'L', stageId, status: 'won', value, createdAt: '2026-08-01T16:00:00Z', contactId: 'c' });
  const snap = base({
    config: { ...base().config, boardStageIds: ['board'] },
    opportunities: [won('j1', 'board', 1000), won('stale', 'invoice', 50000)],
    dispatch: { jobs: [{ jobId: 'j1', active: true, status: '', value: 1000 }, { jobId: 'stale', active: true, status: '', value: 50000 }], moves: [], moveRuns: [], jobDays: [] },
    ledger: { invoiceStages: { a: 'paid', b: 'sent', c: 'sent', d: 'sent' }, invoiceStageEvents: {}, invoices: ['a', 'b', 'c', 'd'].map((id, i) => ({ opportunityId: id, date: `2026-09-${10 + i * 5}`, total: 1000 })), bills: [], payroll: [] }
  });
  const j = M.jobsSection(snap, { range: { from: '2026-10-01', to: '2026-10-12' }, now: NOW });
  assert.equal(j.openValue, 1000, 'stale row the board no longer shows is left out');
  assert.equal(j.paceSource, 'invoiced');
  assert.equal(j.avgWeeklyCompleted, 500);
  assert.equal(j.backlogWeeks, 2);
});

test('queue: admin Done/Snooze hold until new GHL activity; read conversations drop out', () => {
  const snap = base({
    contacts: [{ id: 'c1', type: 'home-owner' }, { id: 'c2', type: 'home-owner' }, { id: 'c3', type: 'home-owner' }],
    opportunities: ['c1', 'c2', 'c3'].map(id => ({ id: 'o' + id, pipelineId: 'D', stageId: 'Dn', status: 'open', createdAt: '2026-10-12T16:00:00Z', updatedAt: '2026-10-12T16:00:00Z', contactId: id })),
    conversationState: { c3: { unread: 0, last: '2026-10-12T16:05:00Z' } }
  });
  const o = { rep: '', now: NOW };
  const all = M.queueState(snap, o);
  assert.equal(all.active.length, 2);
  assert.equal(all.read[0].contactId, 'c3');
  const k1 = all.active.find(i => i.contactId === 'c1');
  const overrides = { [k1.key]: { action: 'done', baseline: k1.lastEventAt, by: 'J', at: '2026-10-12T19:00:00Z' }, 'no-reply:oc2': { action: 'snooze', until: '2026-10-20T15:00:00Z', baseline: '2026-10-12T16:00:00Z', by: 'J', at: '2026-10-12T19:00:00Z' } };
  const held = M.queueState(snap, { ...o, overrides });
  assert.deepEqual([held.active.length, held.closed.length, held.snoozed.length], [0, 1, 1]);
  // New activity in GHL (opportunity updated after the edit) brings it back.
  snap.opportunities[0].updatedAt = '2026-10-12T19:30:00Z';
  const back = M.queueState({ ...snap }, { ...o, overrides });
  assert.ok(back.active.some(i => i.contactId === 'c1'));
});

test('sent within: cohort is opportunities created in the period, overdue unsent ones count as misses', () => {
  const snap = base({
    settings: { ...S, estimateDays: 1 },
    contacts: [{ id: 'c', type: 'developer' }],
    opportunities: [
      { id: 'a', pipelineId: 'D', stageId: 'Dp', status: 'open', createdAt: '2026-10-05T16:00:00Z', contactId: 'c' },
      { id: 'b', pipelineId: 'D', stageId: 'Dn', status: 'open', createdAt: '2026-10-06T16:00:00Z', contactId: 'c' },
      { id: 'p', pipelineId: 'D', stageId: 'Dn', status: 'open', createdAt: '2026-10-12T19:00:00Z', contactId: 'c' },
      { id: 'w', pipelineId: 'D', stageId: 'Dn', status: 'won', createdAt: '2026-10-06T16:00:00Z', statusChangedAt: '2026-10-06T18:00:00Z', contactId: 'c' },
      { id: 'old', pipelineId: 'D', stageId: 'Dp', status: 'open', createdAt: '2026-09-01T16:00:00Z', contactId: 'c' }
    ],
    stageEvents: { a: { Dp: { at: '2026-10-05T18:00:00Z', src: 'sync' } }, old: { Dp: { at: '2026-10-02T18:00:00Z', src: 'sync' } } }
  });
  const t = M.estimatesSection(snap, { range: { from: '2026-10-01', to: '2026-10-12' }, rep: '', now: NOW }).turnaround;
  assert.deepEqual([t.sent, t.missed, t.pending, t.withinDay, t.median], [1, 1, 1, 0.5, 120]);
});
