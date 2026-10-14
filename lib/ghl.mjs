// GHL (LeadConnector) reads for the KPI sync. Read-only: nothing here writes to GHL.
const ROOT = 'https://services.leadconnectorhq.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function ghlClient(cfg, fetchImpl = fetch) {
  let calls = 0;
  async function get(path, { method = 'GET', body, version = '2021-07-28', attempt = 0 } = {}) {
    calls++;
    const res = await fetchImpl(`${ROOT}${path}`, {
      method, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${cfg.ghlToken}`, Version: version, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }
    });
    if (res.status === 429 && attempt < 4) { await sleep(Number(res.headers.get('retry-after')) * 1000 || 2000 * (attempt + 1)); return get(path, { method, body, version, attempt: attempt + 1 }); }
    if (!res.ok) { let reason = ''; try { reason = (await res.json()).message || ''; } catch {} throw new Error(`GHL ${res.status} on ${path.split('?')[0]}${reason ? ': ' + [reason].flat().join('; ') : ''}`); }
    return res.json();
  }
  return {
    get calls() { return calls; },
    async pipelines() {
      const p = await get(`/opportunities/pipelines?${new URLSearchParams({ locationId: cfg.locationId })}`);
      return (p.pipelines || []).map(x => ({ id: x.id, name: x.name, stages: (x.stages || []).map(s => ({ id: s.id, name: s.name, position: Number(s.position ?? 0) })).sort((a, b) => a.position - b.position) }));
    },
    async users() {
      const p = await get(`/users/?${new URLSearchParams({ locationId: cfg.locationId })}`);
      return (p.users || []).filter(u => u && u.id && !u.deleted).map(u => ({ id: u.id, name: u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id, email: String(u.email || '').toLowerCase() }));
    },
    async opportunities(pipelineId) {
      const all = new Map();
      let startAfter, startAfterId;
      for (let page = 0; page < 200; page++) {
        const q = new URLSearchParams({ location_id: cfg.locationId, pipeline_id: pipelineId, status: 'all', limit: '100' });
        if (startAfter) q.set('startAfter', startAfter);
        if (startAfterId) q.set('startAfterId', startAfterId);
        const p = await get(`/opportunities/search?${q}`);
        const list = p.opportunities || [];
        const before = all.size;
        list.forEach(o => o?.id && all.set(o.id, o));
        if (list.length < 100) return [...all.values()];
        const meta = p.meta || {}, last = list[list.length - 1];
        startAfter = meta.startAfter ?? meta.start_after ?? (last.createdAt ? Date.parse(last.createdAt) : undefined);
        startAfterId = meta.startAfterId ?? meta.start_after_id ?? last.id;
        if (all.size === before) throw new Error('GHL opportunity pagination did not advance');
      }
      throw new Error('GHL opportunity pagination limit reached; refusing a partial pull');
    },
    async contactCustomFields() {
      const p = await get(`/locations/${encodeURIComponent(cfg.locationId)}/customFields?${new URLSearchParams({ model: 'contact' })}`);
      return (p.customFields || []).map(f => ({ id: f.id, name: f.name, fieldKey: f.fieldKey }));
    },
    // Every contact in the location, newest-updated pages via searchAfter.
    async contacts() {
      const all = new Map();
      let searchAfter;
      for (let page = 1; page <= 400; page++) {
        const body = { locationId: cfg.locationId, pageLimit: 500, ...(searchAfter ? { searchAfter } : { page }) };
        const p = await get('/contacts/search', { method: 'POST', body });
        const list = p.contacts || [];
        const before = all.size;
        list.forEach(c => c?.id && all.set(c.id, c));
        if (list.length < 500) return [...all.values()];
        const last = list[list.length - 1];
        searchAfter = Array.isArray(last.searchAfter) ? last.searchAfter : undefined;
        if (all.size === before) throw new Error('GHL contact pagination did not advance');
      }
      throw new Error('GHL contact pagination limit reached');
    },
    // Read/unread state of recently active conversations (newest first), for the action
    // queue: a conversation someone opened in GHL has unreadCount 0.
    async recentConversations(days = 30, maxPages = 10) {
      const out = new Map(), floor = Date.now() - days * 86400000;
      let startAfterDate;
      for (let page = 0; page < maxPages; page++) {
        const q = new URLSearchParams({ locationId: cfg.locationId, limit: '100', sortBy: 'last_message_date', sort: 'desc' });
        if (startAfterDate) q.set('startAfterDate', String(startAfterDate));
        const p = await get(`/conversations/search?${q}`);
        const list = p.conversations || [];
        for (const c of list) {
          const last = Number(c.lastMessageDate) || Date.parse(c.lastMessageDate || c.dateUpdated || '') || 0;
          if (!c.contactId || !last) continue;
          const prev = out.get(c.contactId);
          if (!prev || last > Date.parse(prev.last)) out.set(c.contactId, { unread: Number(c.unreadCount) || 0, last: new Date(last).toISOString(), dir: c.lastMessageDirection || '' });
          else if (Number(c.unreadCount)) prev.unread += Number(c.unreadCount);
        }
        const lastItem = list[list.length - 1];
        const lastDate = Number(lastItem?.lastMessageDate) || Date.parse(lastItem?.lastMessageDate || '') || 0;
        if (list.length < 100 || !lastDate || lastDate < floor) break;
        startAfterDate = Array.isArray(lastItem.sort) ? lastItem.sort[0] : lastDate;
      }
      return Object.fromEntries(out);
    },
    // Workflow list (public API; token needs workflows.readonly).
    async workflows() {
      const p = await get(`/workflows/?${new URLSearchParams({ locationId: cfg.locationId })}`);
      return (p.workflows || []).map(w => ({ id: w.id, name: w.name || w.id, status: String(w.status || '').toLowerCase(), updatedAt: w.updatedAt || '', createdAt: w.createdAt || '' }));
    },
    async contact(id) { const p = await get(`/contacts/${encodeURIComponent(id)}`); return p.contact || null; },
    // Outbound message times (SMS, email, calls logged in GHL) for one contact.
    async outboundTouches(contactId) {
      const c = await get(`/conversations/search?${new URLSearchParams({ locationId: cfg.locationId, contactId, limit: '20' })}`);
      const out = [];
      for (const conv of (c.conversations || []).slice(0, 5)) {
        const m = await get(`/conversations/${encodeURIComponent(conv.id)}/messages?${new URLSearchParams({ limit: '100' })}`);
        const list = m.messages?.messages || m.messages || [];
        for (const msg of Array.isArray(list) ? list : []) {
          if (String(msg.direction || '').toLowerCase() !== 'outbound' || !msg.dateAdded) continue;
          const type = String(msg.messageType || msg.type || '').toUpperCase();
          if (/ACTIVITY|NOTE|WORKFLOW/.test(type)) continue;
          // Automated workflow/bulk messages aren't a human reply.
          if (msg.source === 'workflow' || msg.source === 'bulk_actions' || msg.source === 'campaign') continue;
          out.push({ at: new Date(msg.dateAdded).toISOString(), channel: /CALL/.test(type) ? 'call' : /EMAIL/.test(type) ? 'email' : 'sms' });
        }
      }
      return out;
    }
  };
}
