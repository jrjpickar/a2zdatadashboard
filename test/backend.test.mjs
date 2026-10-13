import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { useMemoryStore, KEYS } from '../lib/store.mjs';
import { runSync, withSyncLock, mergeWebhookEvents } from '../lib/sync.mjs';
import { trackStages, trackHires, slimContact, findContactTypeField, phoneKey } from '../lib/normalize.mjs';
import { inboundCalls } from '../lib/twilio.mjs';
import { decryptGhlUserData, signSession, verifySession, roleFor, requireSession } from '../lib/auth.mjs';
import { applyChange, roleOf, _resetAccessCache } from '../lib/access.mjs';
import { config, cleanSettings } from '../lib/config.mjs';
import { forViewer } from '../netlify/functions/dashboard-data.mjs';
import { parseStageHook } from '../netlify/functions/ghl-webhook.mjs';

test('stage tracking: first run is baseline; later changes are recorded once', () => {
  const o = { id: 'o1', stageId: 's1', stageChangedAt: '2026-10-01T00:00:00Z', createdAt: '2026-09-30T00:00:00Z' };
  const a = trackStages([o], null, null, '2026-10-02T00:00:00Z');
  assert.equal(a.stageEvents.o1.s1.src, 'baseline');
  const b = trackStages([{ ...o, stageId: 's2', stageChangedAt: '' }], a.lastStages, a.stageEvents, '2026-10-03T00:00:00Z');
  assert.deepEqual(b.stageEvents.o1.s2, { at: '2026-10-03T00:00:00Z', src: 'sync' });
  const c = trackStages([{ ...o, stageId: 's2' }], b.lastStages, b.stageEvents, '2026-10-04T00:00:00Z');
  assert.equal(c.recorded, 0);
});

test('webhook times win over sync and baseline, never over an earlier entry', () => {
  const ev = { o1: { s1: { at: '2026-10-03T00:00:00Z', src: 'sync' }, s2: { at: '2026-10-01T00:00:00Z', src: 'sync' } } };
  mergeWebhookEvents(ev, { o1: { s1: '2026-10-02T10:00:00Z', s2: '2026-10-02T00:00:00Z' } });
  assert.equal(ev.o1.s1.src, 'webhook');
  assert.equal(ev.o1.s2.src, 'sync');
  assert.deepEqual(parseStageHook({ customData: { opportunity_id: 'o9', stage_name: 'Proposal Sent' } }, { sp: { name: 'Proposal  sent', pipelineId: 'D' } }), { oppId: 'o9', stageId: 'sp' });
});

test('hires: first sync is baseline (no date), later ones dated', () => {
  const contacts = [{ id: 'w1', type: 'laborer', temperature: 'hot' }, { id: 'w2', type: 'laborer', temperature: 'cold' }];
  const a = trackHires(contacts, null, ['warm', 'hot', 'vip'], ['laborer'], 'T1', true);
  assert.deepEqual(a.hireEvents.w1, { at: '', baseline: true, temp: 'hot' });
  assert.equal(a.hireEvents.w2, undefined);
  const b = trackHires([{ id: 'w2', type: 'laborer', temperature: 'warm' }], a.hireEvents, ['warm', 'hot', 'vip'], ['laborer'], 'T2', false);
  assert.equal(b.hireEvents.w2.at, 'T2');
});

test('contact type: custom "Contact Type" field wins, values normalized', () => {
  const id = findContactTypeField([{ id: 'f1', name: 'Contact Type', fieldKey: 'contact.contact_type' }], '');
  assert.equal(id, 'f1');
  const c = slimContact({ id: 'c', type: 'lead', phone: '(949) 555-0100', customFields: [{ id: 'f1', value: 'General-contractor' }, { id: 't', value: 'VIP' }] }, { typeFieldId: id, temperatureFieldId: 't' });
  assert.deepEqual([c.type, c.temperature, c.phone], ['general-contractor', 'vip', '+19495550100']);
  assert.equal(slimContact({ id: 'x', type: 'Home owner' }, { typeFieldId: '', temperatureFieldId: 't' }).type, 'home-owner');
});

test('Twilio: forwarded leg decides answered; callbacks are later outbound calls', () => {
  const calls = [
    { sid: 'A', dir: 'inbound', from: '+19495550001', to: '+19497763898', status: 'completed', start: '2026-10-01T16:00:00Z', dur: 40 },
    { sid: 'A1', parent: 'A', dir: 'outbound-dial', to: '+17140000000', status: 'completed', start: '2026-10-01T16:00:05Z', dur: 30 },
    { sid: 'B', dir: 'inbound', from: '+19495550002', to: '+19497763898', status: 'completed', start: '2026-10-01T17:00:00Z', dur: 25 },
    { sid: 'B1', parent: 'B', dir: 'outbound-dial', to: '+17140000000', status: 'no-answer', start: '2026-10-01T17:00:05Z', dur: 0 },
    { sid: 'C', dir: 'outbound-api', from: '+19497763898', to: '+19495550002', status: 'completed', start: '2026-10-01T18:00:00Z', dur: 60 }
  ];
  const { inbound, mode } = inboundCalls(calls, { numbers: ['(949) 776-3898'] });
  assert.equal(mode, 'forwarding');
  const a = inbound.find(c => c.sid === 'A'), b = inbound.find(c => c.sid === 'B');
  assert.equal(a.answered, true);
  assert.equal(b.answered, false);
  assert.equal(b.calledBackAt, '2026-10-01T18:00:00Z');
});

test('GHL user context decrypts like CryptoJS AES; sessions sign and verify', () => {
  const pass = 'shared-secret', salt = randomBytes(8), blocks = []; let prev = Buffer.alloc(0);
  while (Buffer.concat(blocks).length < 48) { prev = createHash('md5').update(Buffer.concat([prev, Buffer.from(pass), salt])).digest(); blocks.push(prev); }
  const m = Buffer.concat(blocks), c = createCipheriv('aes-256-cbc', m.subarray(0, 32), m.subarray(32, 48));
  const enc = Buffer.concat([Buffer.from('Salted__'), salt, c.update('{"userId":"u1"}'), c.final()]).toString('base64');
  assert.equal(decryptGhlUserData(enc, pass), '{"userId":"u1"}');
  const cfg = config({ SESSION_SECRET: 's'.repeat(32) });
  const t = signSession({ id: 'u', name: 'J', email: 'jesse@a2zcs.net' }, 'ghl_sso', cfg);
  assert.equal(verifySession(t, cfg).email, 'jesse@a2zcs.net');
  assert.equal(verifySession(t + 'x', cfg), null);
});

test('non-owners never receive Ledger data or EOD costs', () => {
  const v = forViewer({ ledger: { bills: [1] }, dispatch: { eodSheets: [{ cost: 5 }], jobs: [] } }, false);
  assert.equal(v.ledger, null);
  assert.deepEqual(v.dispatch.eodSheets, []);
});

test('settings are cleaned', () => {
  const s = cleanSettings({ containerFleet: { '10 Yard': '12', bad: -1 }, rentalDays: 0, workdays: [1, 9, 2], businessHours: { open: '18:00', close: '07:00' } });
  assert.deepEqual(s.containerFleet, { '10 Yard': 12 });
  assert.equal(s.rentalDays, 7);
  assert.deepEqual(s.workdays, [1, 2]);
  assert.equal(s.businessHours.open, '07:00');
});

test('full sync against mocked GHL / Twilio / feeds builds a snapshot; a failing feed keeps the rest', async () => {
  const map = new Map();
  const store = useMemoryStore(map);
  const env = { GHL_API_TOKEN: 't', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'x', DISPATCH_URL: 'https://d', DISPATCH_EXPORT_KEY: 'k', LEDGER_URL: 'https://l', LEDGER_EXPORT_KEY: 'k' };
  const json = b => new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/opportunities/pipelines')) return json({ pipelines: [{ id: 'd5Ix1SlN3YpZ5gQewZUo', name: 'Demo', stages: [{ id: 'dn', name: 'New Lead', position: 0 }, { id: 'dp', name: 'Proposal Sent', position: 1 }] }] });
    if (u.includes('/users/')) return json({ users: [{ id: 'u1', name: 'Maria' }] });
    if (u.includes('/customFields')) return json({ customFields: [] });
    if (u.includes('/opportunities/search')) return json({ opportunities: u.includes('d5Ix1SlN3YpZ5gQewZUo') ? [{ id: 'o1', pipelineId: 'd5Ix1SlN3YpZ5gQewZUo', pipelineStageId: 'dp', status: 'open', monetaryValue: 5000, createdAt: '2026-10-10T16:00:00Z', lastStageChangeAt: '2026-10-10T19:00:00Z', contactId: 'c1' }] : [] });
    if (u.includes('/contacts/search')) return json({ contacts: [{ id: 'c1', firstName: 'Ann', type: 'Home-owner', phone: '9495550001' }, { id: 'w1', firstName: 'Lu', type: 'laborer', customFields: [{ id: 'xOi9gCcAt2UvgA6POHMB', value: 'Hot' }] }, { id: 'x', firstName: 'Other', type: 'lead' }] });
    if (u.includes('/conversations/search')) return json({ conversations: [{ id: 'cv1' }] });
    if (u.includes('/conversations/cv1/messages')) return json({ messages: { messages: [{ direction: 'outbound', dateAdded: '2026-10-10T16:20:00Z', messageType: 'TYPE_SMS' }, { direction: 'outbound', dateAdded: '2026-10-10T16:01:00Z', messageType: 'TYPE_SMS', source: 'workflow' }] } });
    if (u.startsWith('https://api.twilio.com')) return json({ calls: [{ sid: 'CA1', direction: 'inbound', from: '+19495550001', to: '+19497763898', status: 'no-answer', start_time: '2026-10-10T15:00:00Z', duration: '0' }], next_page_uri: null });
    if (u.startsWith('https://d/')) return json({ version: 1, jobs: [], moves: [], moveRuns: [], jobDays: [], bookings: [], eodSheets: [], rosters: {}, manualWorkers: [], hiddenWorkers: [], temperatures: [] });
    if (u.startsWith('https://l/')) return new Response('{"error":"Invalid metrics key"}', { status: 401 });
    throw new Error('unexpected ' + u);
  };
  const r = await runSync({ env, fetchImpl, store, now: Date.parse('2026-10-12T20:00:00Z') });
  const snap = JSON.parse(map.get(KEYS.snapshot));
  assert.equal(snap.opportunities.length, 1);
  assert.equal(snap.contacts.length, 2, 'unrelated contacts are dropped');
  assert.deepEqual(snap.config.proposalStageIds, ['dp']);
  assert.equal(snap.messageTouches.c1.length, 1, 'workflow messages are not a reply');
  assert.equal(snap.inboundCalls[0].answered, false);
  assert.equal(snap.hireEvents.w1.baseline, true);
  assert.equal(r.feeds.dispatch.ok, true);
  assert.equal(r.feeds.ledger.ok, false);
  assert.match(r.feeds.ledger.error, /401/);
  assert.equal(phoneKey('9495550001'), '+19495550001');
  const locked = await withSyncLock(store, async () => withSyncLock(store, async () => 'inner'));
  assert.equal(locked.skipped, true);
});

test('roles: Jesse is senior admin; admins need GHL sign-in; unlisted people are refused', async () => {
  const cfg = config({ SESSION_SECRET: 's'.repeat(32) });
  const access = { users: [{ email: 'maria@a2zcs.net', role: 'admin' }, { email: 'dan@a2zcs.net', role: 'viewer' }], requests: [] };
  assert.equal(roleOf({ email: 'jesse@a2zcs.net', via: 'ghl_sso' }, access, cfg), 'senior');
  assert.equal(roleOf({ email: 'jesse@a2zcs.net', via: 'pin' }, access, cfg), 'viewer');
  assert.equal(roleOf({ email: 'maria@a2zcs.net', via: 'ghl_sso' }, access, cfg), 'admin');
  assert.equal(roleOf({ email: 'maria@a2zcs.net', via: 'pin' }, access, cfg), 'viewer');
  assert.equal(roleOf({ email: 'nobody@a2zcs.net', via: 'ghl_sso' }, access, cfg), null);
  const map = new Map(); const store = useMemoryStore(map); _resetAccessCache();
  await store.setJSON(KEYS.access, access);
  const req = email => new Request('https://x/api/dashboard-data', { headers: { 'x-kpi-session': signSession({ id: email, name: email, email }, 'ghl_sso', cfg) } });
  assert.equal((await requireSession(req('maria@a2zcs.net'), cfg, store)).owner, true);
  await assert.rejects(requireSession(req('nobody@a2zcs.net'), cfg, store), e => e.status === 403);
});

test('only senior admins manage admins; seniors cannot be removed; admins manage viewers', () => {
  const cfg = config({});
  const data = () => ({ users: [{ email: 'maria@a2zcs.net', name: 'Maria', role: 'admin' }], requests: [{ email: 'kim@a2zcs.net' }] });
  const admin = { name: 'Maria', role: 'admin' }, senior = { name: 'Jesse', role: 'senior' };
  const d1 = applyChange(data(), { action: 'add', email: 'Kim@a2zcs.net', name: 'Kim' }, admin, cfg);
  assert.equal(d1.users.find(u => u.email === 'kim@a2zcs.net').role, 'viewer');
  assert.equal(d1.requests.length, 0, 'adding clears their request');
  assert.throws(() => applyChange(data(), { action: 'add', email: 'x@a2zcs.net', role: 'admin' }, admin, cfg), e => e.status === 403);
  assert.throws(() => applyChange(data(), { action: 'remove', email: 'maria@a2zcs.net' }, admin, cfg), e => e.status === 403);
  assert.throws(() => applyChange(data(), { action: 'remove', email: 'jesse@a2zcs.net' }, senior, cfg), e => e.status === 409);
  assert.equal(applyChange(data(), { action: 'set_role', email: 'maria@a2zcs.net', role: 'viewer' }, senior, cfg).users[0].role, 'viewer');
  assert.equal(applyChange(data(), { action: 'remove', email: 'maria@a2zcs.net' }, senior, cfg).users.length, 0);
});

import { applyQueueChange } from '../netlify/functions/queue.mjs';
test('queue overrides validate keys and snooze dates', () => {
  const now = Date.parse('2026-10-13T00:00:00Z');
  const m = applyQueueChange({}, { key: 'no-reply:o1', action: 'snooze', until: '2026-10-20', baseline: 'x' }, { name: 'J' }, now);
  assert.equal(m['no-reply:o1'].action, 'snooze');
  assert.throws(() => applyQueueChange({}, { key: 'no-reply:o1', action: 'snooze', until: '2026-10-01' }, { name: 'J' }, now), e => e.status === 400);
  assert.throws(() => applyQueueChange({}, { key: 'bogus', action: 'done' }, { name: 'J' }, now));
  assert.deepEqual(applyQueueChange(m, { key: 'no-reply:o1', action: 'restore' }, { name: 'J' }, now), {});
});
