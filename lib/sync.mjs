// Builds the dashboard snapshot from GHL, Twilio, the dispatch board and the Ledger,
// and saves it to Blobs. Each source is independent: one that fails keeps its last
// good data in the snapshot and shows the error on Data Quality.
import { config as readConfig, cleanSettings } from './config.mjs';
import { kpiStore, KEYS } from './store.mjs';
import { ghlClient } from './ghl.mjs';
import { fetchCalls, inboundCalls } from './twilio.mjs';
import { fetchFeed, slimDispatch, slimLedger } from './feeds.mjs';
import { slimContact, slimOpportunity, findContactTypeField, trackStages, trackHires, normName, phoneKey } from './normalize.mjs';

const DAY = 86400000;
const dateOnly = ms => new Date(ms).toISOString().slice(0, 10);

export async function runSync({ env = process.env, fetchImpl = fetch, now = Date.now(), store = kpiStore() } = {}) {
  const cfg = readConfig(env);
  const nowIso = new Date(now).toISOString();
  const prev = (await store.get(KEYS.snapshot, { type: 'json' })) || {};
  const settings = cleanSettings((await store.get(KEYS.settings, { type: 'json' })) || {});
  const feeds = { ...(prev.feeds || {}) };
  const snap = { ...prev, version: 1, builtAt: nowIso, settings };
  const mark = (name, ok, extra = {}) => { feeds[name] = { ...(feeds[name] || {}), ok, checkedAt: nowIso, ...(ok ? { at: nowIso, error: '' } : {}), ...extra }; };

  // ---------- GHL ----------
  if (!cfg.ghlToken) mark('ghl', false, { error: 'GHL_API_TOKEN is not set.' });
  else {
    try {
      const ghl = ghlClient(cfg, fetchImpl);
      const [pipelines, users, fields] = await Promise.all([ghl.pipelines(), ghl.users().catch(() => prev.users || []), ghl.contactCustomFields().catch(() => [])]);
      const ids = cfg.pipelines;
      const want = Object.values(ids);
      const oppLists = [];
      for (const id of want) oppLists.push(await ghl.opportunities(id));
      const opportunities = oppLists.flat().map(slimOpportunity);
      const typeFieldId = findContactTypeField(fields, cfg.contactTypeFieldId);
      // Contacts: the full list (thousands) only every CONTACTS_FULL_SYNC_HOURS; in between,
      // reuse the cached list and look up just the contacts on new opportunities.
      const referenced = new Set(opportunities.map(o => o.contactId).filter(Boolean));
      const keepTypes = new Set([...cfg.customerTypes, ...cfg.laborerTypes]);
      const slim = c => slimContact(c, { typeFieldId, temperatureFieldId: cfg.temperatureFieldId });
      const cached = (await store.get(KEYS.contacts, { type: 'json' })) || null;
      let contacts, contactMode, scanned = 0, lookedUpContacts = 0;
      if (!cached || now - Date.parse(cached.fullAt || 0) > cfg.contactsFullSyncHours * 3600000) {
        const rawContacts = await ghl.contacts();
        scanned = rawContacts.length;
        contacts = rawContacts.map(slim).filter(c => referenced.has(c.id) || keepTypes.has(c.type));
        await store.setJSON(KEYS.contacts, { fullAt: nowIso, contacts });
        contactMode = 'full';
      } else {
        const byId = new Map(cached.contacts.map(c => [c.id, c]));
        for (const id of [...referenced].filter(id => !byId.has(id)).slice(0, 150)) {
          try { const c = await ghl.contact(id); if (c) { byId.set(id, slim(c)); lookedUpContacts++; } } catch { /* next run */ }
        }
        contacts = [...byId.values()].filter(c => referenced.has(c.id) || keepTypes.has(c.type));
        await store.setJSON(KEYS.contacts, { fullAt: cached.fullAt, contacts });
        contactMode = 'incremental';
      }
      const stages = {};
      for (const p of pipelines) if (want.includes(p.id)) for (const s of p.stages) stages[s.id] = { name: s.name, position: s.position, pipelineId: p.id };
      const proposalNames = cfg.proposalStageNames.map(normName);
      const proposalStageIds = Object.entries(stages).filter(([, s]) => proposalNames.includes(normName(s.name))).map(([id]) => id);

      // Stage history + hires (kept in their own blobs; they only grow).
      const [lastStages, stageEvents, hireEvents] = await Promise.all([store.get(KEYS.lastStages, { type: 'json' }), store.get(KEYS.stageEvents, { type: 'json' }), store.get(KEYS.hireEvents, { type: 'json' })]);
      const st = trackStages(opportunities, lastStages, stageEvents, nowIso);
      const hooks = (await store.get(KEYS.webhook, { type: 'json' })) || {};
      mergeWebhookEvents(st.stageEvents, hooks.events || {});
      feeds.webhook = { ok: !!hooks.lastReceivedAt, at: hooks.lastReceivedAt || '', received: hooks.received || 0, optional: true };
      const hires = contactMode === 'full' || !hireEvents ? trackHires(contacts, hireEvents, cfg.activeTemps, cfg.laborerTypes, nowIso, !hireEvents) : { hireEvents, added: 0 };
      await Promise.all([store.setJSON(KEYS.lastStages, st.lastStages), store.setJSON(KEYS.stageEvents, st.stageEvents), store.setJSON(KEYS.hireEvents, hires.hireEvents)]);
      if (!snap.history) snap.history = {};
      snap.history.stageTrackingSince = prev.history?.stageTrackingSince || nowIso;
      snap.history.hireTrackingSince = prev.history?.hireTrackingSince || nowIso;

      snap.config = {
        timeZone: cfg.timeZone, locationId: cfg.locationId, ghlAppUrl: cfg.ghlAppUrl, pipelines: ids,
        pipelineNames: Object.fromEntries(pipelines.filter(p => want.includes(p.id)).map(p => [p.id, p.name])),
        stages, proposalStageIds, boardStageIds: cfg.boardStageIds, customerTypes: cfg.customerTypes, laborerTypes: cfg.laborerTypes, activeTemps: cfg.activeTemps, dormantTemps: cfg.dormantTemps,
        contactTypeSource: typeFieldId ? 'custom field' : 'GHL contact type'
      };
      try { snap.workflows = await ghl.workflows(); feeds.workflowList = { ok: true, at: nowIso, checkedAt: nowIso, counts: { workflows: snap.workflows.length } }; }
      catch (e) { feeds.workflowList = { ...(feeds.workflowList || {}), ok: false, checkedAt: nowIso, error: e.message + (/40[13]/.test(e.message) ? ' (add the workflows.readonly scope to the token)' : '') }; }
      Object.assign(snap, { users, opportunities, contacts, stageEvents: st.stageEvents, hireEvents: hires.hireEvents });
      mark('ghl', true, { counts: { opportunities: opportunities.length, contacts: contacts.length, contactsScanned: scanned, contactsLookedUp: lookedUpContacts, stageEventsRecorded: st.recorded, hiresRecorded: hires.added }, contactMode, contactsFullAt: contactMode === 'full' ? nowIso : cached.fullAt, apiCalls: ghl.calls, missingProposalStage: proposalStageIds.length === 0 });

      // Conversation touches (first human reply to a lead). Bounded per run, cached.
      const touchCache = (await store.get(KEYS.touches, { type: 'json' })) || {};
      const leadPipelines = new Set([ids.demo, ids.labor, ids.containers, ids.changeOrders]);
      const cutoff = new Date(now - cfg.responseLookbackDays * DAY).toISOString();
      const laborerIds = new Set([...contacts.filter(c => cfg.laborerTypes.includes(c.type)).map(c => c.id), ...opportunities.filter(o => o.pipelineId === ids.hiring).map(o => o.contactId)]);
      const due = [...new Set(opportunities.filter(o => leadPipelines.has(o.pipelineId) && o.contactId && !laborerIds.has(o.contactId) && o.createdAt >= cutoff)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .filter(o => { const t = touchCache[o.contactId]; if (!t) return true; const stale = now - Date.parse(t.checkedAt) > 6 * 3600000; return stale && o.status === 'open'; })
        .map(o => o.contactId))].slice(0, cfg.conversationLookupsPerRun);
      let looked = 0, failed = 0, denied = '';
      for (const contactId of due) {
        try { const list = await ghl.outboundTouches(contactId); touchCache[contactId] = { checkedAt: nowIso, out: list.sort((a, b) => (a.at < b.at ? -1 : 1)).slice(-100) }; looked++; }
        catch (e) { failed++; if (/GHL 4(01|03)/.test(e.message)) { denied = e.message + ' (the token needs conversations.readonly and conversations/message.readonly)'; break; } }
      }
      for (const [id, t] of Object.entries(touchCache)) if (Date.parse(t.checkedAt) < now - 400 * DAY) delete touchCache[id];
      await store.setJSON(KEYS.touches, touchCache);
      snap.messageTouches = Object.fromEntries(Object.entries(touchCache).map(([id, t]) => [id, t.out]));
      try { snap.conversationState = await ghl.recentConversations(30); } catch (e) { if (/GHL 4(01|03)/.test(e.message)) denied ||= e.message; }
      if (denied) mark('conversations', false, { error: denied });
      else mark('conversations', true, { counts: { lookedUp: looked, failed, cached: Object.keys(touchCache).length, pending: Math.max(0, due.length - looked), readStates: Object.keys(snap.conversationState || {}).length } });
    } catch (error) { mark('ghl', false, { error: error.message }); }
  }

  // ---------- Twilio ----------
  if (!cfg.twilio.accountSid || !(cfg.twilio.authToken || cfg.twilio.apiKeySecret)) mark('twilio', false, { error: 'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN (or an API key) are not set.' });
  else {
    try {
      const cache = (await store.get(KEYS.calls, { type: 'json' })) || { calls: {}, through: '' };
      const floor = now - cfg.twilio.historyDays * DAY;
      const since = cache.through ? Math.max(floor, Date.parse(cache.through) - 2 * DAY) : floor;
      const fresh = await fetchCalls(cfg, dateOnly(since), fetchImpl);
      for (const c of fresh) cache.calls[c.sid] = c;
      for (const [sid, c] of Object.entries(cache.calls)) if (Date.parse(c.start) < floor) delete cache.calls[sid];
      cache.through = nowIso;
      await store.setJSON(KEYS.calls, cache);
      const all = Object.values(cache.calls);
      const { inbound, mode, outboundByNumber } = inboundCalls(all, cfg.twilio);
      snap.inboundCalls = inbound;
      snap.callTouches = Object.fromEntries([...outboundByNumber.entries()].map(([n, list]) => [n, list.slice(-100)]));
      snap.answeredInbound = Object.fromEntries(Object.entries(inbound.filter(c => c.answered).reduce((m, c) => { (m[c.from] ||= []).push(c.at); return m; }, {})).map(([n, l]) => [n, l.sort().slice(-50)]));
      mark('twilio', true, { counts: { calls: all.length, inbound: inbound.length, fetched: fresh.length }, answerMode: mode, numbersFiltered: cfg.twilio.numbers.length > 0 });
    } catch (error) { mark('twilio', false, { error: error.message }); }
  }

  // ---------- Dispatch board + Ledger ----------
  for (const [name, source, slim] of [['dispatch', cfg.dispatch, slimDispatch], ['ledger', cfg.ledger, slimLedger]]) {
    if (!source.url || !source.key) { mark(name, false, { error: `${name === 'dispatch' ? 'DISPATCH_URL / DISPATCH_EXPORT_KEY' : 'LEDGER_URL / LEDGER_EXPORT_KEY'} not set.` }); continue; }
    try { snap[name] = slim(await fetchFeed(source, fetchImpl)); mark(name, true); }
    catch (error) { mark(name, false, { error: error.message }); }
  }

  snap.feeds = feeds;
  await store.setJSON(KEYS.snapshot, snap);
  await store.setJSON(KEYS.status, { lastRunAt: nowIso, feeds });
  return { ok: Object.values(feeds).some(f => f.ok), feeds };
}

// Prevents two syncs at once (scheduled + Refresh). A lock older than 14 minutes is stale.
export async function withSyncLock(store, fn, now = Date.now()) {
  const lock = await store.get(KEYS.lock, { type: 'json' });
  if (lock && now - lock.at < 14 * 60000) return { skipped: true, reason: 'A sync is already running.' };
  await store.setJSON(KEYS.lock, { at: now });
  try { return await fn(); } finally { await store.delete(KEYS.lock); }
}
// Stage changes GHL posted to /api/ghl-webhook are exact; they win over a sync's
// "noticed at" time, but never over an earlier recorded entry.
export function mergeWebhookEvents(events, hooks) {
  for (const [oppId, stagesSeen] of Object.entries(hooks || {})) {
    for (const [stageId, at] of Object.entries(stagesSeen || {})) {
      const mine = events[oppId] ||= {};
      const cur = mine[stageId];
      if (!cur || cur.src === 'baseline' || at < cur.at) mine[stageId] = { at, src: 'webhook' };
    }
  }
  return events;
}
export { phoneKey };
