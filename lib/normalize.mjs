// Pure shaping of GHL / Twilio records into the small rows the browser needs.
export const normType = v => String(v ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
export const normName = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function phoneKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return digits.length >= 8 ? '+' + digits : '';
}
const iso = v => { if (!v) return ''; const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : ''; };

export function customValue(contact, fieldId) {
  const list = Array.isArray(contact?.customFields) ? contact.customFields : Array.isArray(contact?.customField) ? contact.customField : [];
  const hit = list.find(f => f && (f.id === fieldId || f.fieldId === fieldId));
  const v = hit ? (hit.value ?? hit.field_value ?? hit.fieldValue ?? '') : '';
  return Array.isArray(v) ? v.filter(Boolean).join(', ') : String(v ?? '').trim();
}

// The contact type field: CONTACT_TYPE_FIELD_ID if set, else a custom field named
// "Contact Type", else GHL's built-in `type`.
export function findContactTypeField(fields, configured) {
  if (configured) return configured;
  const f = (fields || []).find(x => /^contact\.?_?type$/i.test(String(x.fieldKey || '').replace(/[{}\s]/g, '').replace(/^contact\./i, 'contact.')) || normName(x.name) === 'contact type');
  return f ? f.id : '';
}

export function slimContact(c, { typeFieldId, temperatureFieldId }) {
  const custom = typeFieldId ? customValue(c, typeFieldId) : '';
  return {
    id: c.id,
    name: String(c.contactName || c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.companyName || c.email || c.phone || c.id).replace(/\s+/g, ' ').trim(),
    company: c.companyName || '',
    type: normType(custom || c.type || ''),
    source: String(c.source || '').trim(),
    temperature: normType(customValue(c, temperatureFieldId)),
    phone: phoneKey(c.phone),
    assignedTo: c.assignedTo || '',
    dateAdded: iso(c.dateAdded || c.createdAt)
  };
}

export function slimOpportunity(o) {
  return {
    id: o.id,
    name: String(o.name || '').slice(0, 140),
    pipelineId: o.pipelineId || '',
    stageId: o.pipelineStageId || '',
    status: String(o.status || 'open').toLowerCase(),
    value: Number.isFinite(Number(o.monetaryValue)) ? Number(o.monetaryValue) : 0,
    createdAt: iso(o.createdAt),
    updatedAt: iso(o.updatedAt),
    stageChangedAt: iso(o.lastStageChangeAt),
    statusChangedAt: iso(o.lastStatusChangeAt),
    contactId: o.contactId || o.contact?.id || '',
    contactName: o.contact?.name || '',
    assignedTo: o.assignedTo || '',
    source: String(o.source || '').trim(),
    lostReason: String(o.lostReason?.name || o.lostReasonName || o.lostReasonId || '').trim()
  };
}

// Stage history GHL doesn't keep: compare each opportunity's stage with the last
// sync and record when it entered a new one. The first ever sync records each
// opportunity's current stage at GHL's lastStageChangeAt (marked baseline).
export function trackStages(opps, previous, events, nowIso) {
  const last = { ...(previous || {}) };
  const out = { ...(events || {}) };
  const firstRun = !previous;
  let recorded = 0;
  for (const o of opps) {
    if (!o.stageId || last[o.id] === o.stageId) continue;
    const mine = out[o.id] = { ...(out[o.id] || {}) };
    const prevMax = Object.values(mine).reduce((m, e) => (e.at > m ? e.at : m), '');
    let at;
    if (firstRun || !last[o.id]) at = o.stageChangedAt || o.createdAt || nowIso;
    else at = o.stageChangedAt && o.stageChangedAt > prevMax ? o.stageChangedAt : nowIso;
    if (!mine[o.stageId]) { mine[o.stageId] = { at, src: firstRun ? 'baseline' : 'sync' }; recorded++; }
    last[o.id] = o.stageId;
  }
  return { lastStages: last, stageEvents: out, recorded };
}

// Hired = a laborer whose temperature is warm / hot / VIP. The first sync that
// sees it records the date (baseline on the very first sync: date unknown).
export function trackHires(contacts, events, activeTemps, laborerTypes, nowIso, firstRun) {
  const out = { ...(events || {}) };
  let added = 0;
  for (const c of contacts) {
    if (!laborerTypes.includes(c.type) || !activeTemps.includes(c.temperature) || out[c.id]) continue;
    out[c.id] = firstRun ? { at: '', baseline: true, temp: c.temperature } : { at: nowIso, temp: c.temperature };
    added++;
  }
  return { hireEvents: out, added };
}
