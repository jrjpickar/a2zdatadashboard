// A2Z KPI metrics. Pure functions over the snapshot (no DOM), shared by the page and the tests.
// Dates are the dashboard's time zone (America/Los_Angeles): a "day" is a Pacific day.

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;

// ---------- time ----------
const fmtCache = new Map();
function fmt(tz) {
  if (!fmtCache.has(tz)) fmtCache.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  return fmtCache.get(tz);
}
function parts(ms, tz) {
  const p = {}; for (const x of fmt(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, H: Number(p.hour), M: Number(p.minute) };
}
export const toMs = v => (typeof v === 'number' ? v : v ? Date.parse(v) : NaN);
const ldCache = new Map();
export function localDate(v, tz) {
  const ms = toMs(v); if (!Number.isFinite(ms)) return '';
  const key = tz + Math.floor(ms / MIN);
  let d = ldCache.get(key);
  if (!d) { if (ldCache.size > 200000) ldCache.clear(); d = parts(ms, tz).date; ldCache.set(key, d); }
  return d;
}
const dUTC = d => Date.parse(d + 'T12:00:00Z');
export const addDays = (d, n) => new Date(dUTC(d) + n * DAY).toISOString().slice(0, 10);
export const weekday = d => new Date(dUTC(d)).getUTCDay();
export const daysBetween = (a, b) => Math.round((dUTC(b) - dUTC(a)) / DAY);
export const mondayOf = d => addDays(d, -((weekday(d) + 6) % 7));
function offset(ms, tz) { const p = parts(ms, tz); const [y, m, d] = p.date.split('-').map(Number); return Date.UTC(y, m - 1, d, p.H, p.M) - Math.floor(ms / MIN) * MIN; }
const zCache = new Map();
export function zonedToUtc(date, hhmm, tz) {
  const key = date + hhmm + tz;
  if (zCache.has(key)) return zCache.get(key);
  const v = zonedToUtcRaw(date, hhmm, tz); zCache.set(key, v); return v;
}
function zonedToUtcRaw(date, hhmm, tz) {
  const [y, m, d] = date.split('-').map(Number); const [H, M] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, H, M);
  let t = guess - offset(guess, tz);
  t = guess - offset(t, tz);
  return t;
}

export const PERIODS = [
  { id: 'today', label: 'Today' }, { id: 'wtd', label: 'WTD' }, { id: 'mtd', label: 'MTD' }, { id: 'ytd', label: 'YTD' }
];
export function periodRange(id, now, tz) {
  const today = localDate(now, tz);
  if (id === 'today') return { from: today, to: today };
  if (id === 'wtd') return { from: mondayOf(today), to: today };
  if (id === 'mtd') return { from: today.slice(0, 8) + '01', to: today };
  if (id === 'ytd') return { from: today.slice(0, 5) + '01-01', to: today };
  if (id && id.from && id.to) return id;
  return { from: today, to: today };
}
export const inRange = (date, r) => !!date && date >= r.from && date <= r.to;
export function datesIn(r, cap = 400) { const out = []; for (let d = r.from; d <= r.to && out.length < cap; d = addDays(d, 1)) out.push(d); return out; }

// Business minutes between two instants (open-close on workdays).
export function businessMinutes(a, b, settings, tz, cap = Infinity) {
  let t0 = toMs(a), t1 = toMs(b);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return 0;
  const { open, close } = settings.businessHours, work = new Set(settings.workdays);
  let total = 0;
  const end = localDate(t1, tz);
  for (let d = localDate(t0, tz), n = 0; d <= end && n < 120; d = addDays(d, 1), n++) {
    if (!work.has(weekday(d))) continue;
    const o = zonedToUtc(d, open, tz), c = zonedToUtc(d, close, tz);
    total += Math.max(0, Math.min(t1, c) - Math.max(t0, o));
    if (total / MIN >= cap) return cap;
  }
  return total / MIN;
}
export const businessDayMinutes = s => { const [oh, om] = s.businessHours.open.split(':').map(Number), [ch, cm] = s.businessHours.close.split(':').map(Number); return (ch * 60 + cm) - (oh * 60 + om); };

// ---------- small stats ----------
export const sum = (list, f = x => x) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);
export function median(list) { const v = list.filter(Number.isFinite).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }
export const ratio = (a, b) => (b > 0 ? a / b : null);
function groupBy(list, key) { const m = new Map(); for (const x of list) { const k = key(x); (m.get(k) || m.set(k, []).get(k)).push(x); } return m; }

// ---------- labels ----------
export const TYPE_LABELS = { 'general-contractor': 'General contractor', developer: 'Developer', 'home-owner': 'Homeowner', laborer: 'Laborer' };
export const typeLabel = t => TYPE_LABELS[t] || (t ? t.replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase()) : 'Not set');
export const tempLabel = t => ({ vip: 'VIP', hot: 'Hot', warm: 'Warm', cold: 'Cold' }[t] || (t ? t[0].toUpperCase() + t.slice(1) : 'Not set'));
export function sourceBucket(raw, repeat) {
  if (repeat) return 'Repeat customer';
  const s = String(raw || '').toLowerCase();
  if (!s) return 'Unknown';
  if (/call|phone|twilio|inbound/.test(s)) return 'Phone call';
  if (/email|e-mail|mail/.test(s)) return 'Email';
  if (/refer/.test(s)) return 'Referral';
  if (/form|web|site|funnel|landing|survey|chat|quote|booking|online/.test(s)) return 'Web form';
  return 'Other';
}
const CONTAINER_MOVES = { container_drop: 'drop', container_dispatch: 'drop', container_pickup: 'pickup', container_swap: 'swap', dump_and_return: 'dump' };

// ---------- index (built once per snapshot) ----------
const indexCache = new WeakMap();
export function buildIndex(snap) {
  if (indexCache.has(snap)) return indexCache.get(snap);
  const cfg = snap.config || {};
  const P = cfg.pipelines || {};
  const tz = cfg.timeZone || 'America/Los_Angeles';
  const contacts = new Map((snap.contacts || []).map(c => [c.id, c]));
  const opps = snap.opportunities || [];
  const servicePipes = [P.demo, P.labor, P.containers].filter(Boolean);
  const jobPipes = new Set([...servicePipes, P.changeOrders].filter(Boolean));
  const laborerTypes = new Set(cfg.laborerTypes || ['laborer']);
  const isLaborer = c => !!c && laborerTypes.has(c.type);
  const wonByContact = new Map();
  for (const o of opps) if (jobPipes.has(o.pipelineId) && o.status === 'won' && o.contactId) (wonByContact.get(o.contactId) || wonByContact.set(o.contactId, []).get(o.contactId)).push(o.statusChangedAt || o.updatedAt || o.createdAt);
  for (const l of wonByContact.values()) l.sort();
  const temps = new Map((snap.dispatch?.temperatures || []).map(t => [t.contactId, String(t.value || '').toLowerCase().replace(/\s+/g, '-')]));
  const touchCache = new Map();
  function touches(contactId) {
    if (touchCache.has(contactId)) return touchCache.get(contactId);
    const c = contacts.get(contactId);
    const list = [
      ...((snap.messageTouches || {})[contactId] || []).map(t => t.at),
      ...(c?.phone ? (snap.callTouches || {})[c.phone] || [] : []),
      ...(c?.phone ? (snap.answeredInbound || {})[c.phone] || [] : [])
    ].filter(Boolean).sort();
    touchCache.set(contactId, list);
    return list;
  }
  const proposalIds = new Set(cfg.proposalStageIds || []);
  const proposalByPipe = new Map();
  for (const id of proposalIds) { const s = cfg.stages?.[id]; if (s) proposalByPipe.set(s.pipelineId, { id, position: s.position }); }
  const events = snap.stageEvents || {};
  function sentAt(o) {
    const pr = proposalByPipe.get(o.pipelineId);
    if (!pr) return null;
    const e = events[o.id]?.[pr.id];
    if (e?.at) return { at: e.at, src: e.src };
    if (o.stageId === pr.id && o.stageChangedAt) return { at: o.stageChangedAt, src: 'ghl' };
    return null;
  }
  const idx = { cfg, P, tz, contacts, opps, servicePipes, jobPipes, isLaborer, wonByContact, touches, temps, proposalByPipe, sentAt,
    settings: snap.settings || { businessHours: { open: '07:00', close: '17:00' }, workdays: [1, 2, 3, 4, 5, 6], rentalDays: 7, followUpDays: 3, containerFleet: {} } };
  idx.serviceName = id => ({ [P.demo]: 'Demo', [P.labor]: 'Labor', [P.containers]: 'Containers', [P.changeOrders]: 'Change orders', [P.hiring]: 'Hiring' }[id] || cfg.pipelineNames?.[id] || 'Other');
  idx.isRepeat = (contactId, beforeIso) => (wonByContact.get(contactId) || []).some(t => t < beforeIso);
  idx.tempOf = c => (c?.temperature || temps.get(c?.id) || '');
  idx.repMatch = (o, rep) => !rep || o.assignedTo === rep || (!o.assignedTo && contacts.get(o.contactId)?.assignedTo === rep);
  idx.contactLink = id => (id && cfg.locationId ? `${cfg.ghlAppUrl || 'https://app.gohighlevel.com'}/v2/location/${cfg.locationId}/contacts/detail/${id}` : '');
  indexCache.set(snap, idx);
  return idx;
}

// ---------- leads & speed to lead ----------
export function leadOpps(idx, rep) {
  return idx.opps.filter(o => idx.servicePipes.includes(o.pipelineId) && !idx.isLaborer(idx.contacts.get(o.contactId)) && idx.repMatch(o, rep));
}
export function firstResponse(idx, o) {
  const created = toMs(o.createdAt);
  if (!Number.isFinite(created)) return null;
  const start = new Date(created - HOUR).toISOString();
  const t = idx.touches(o.contactId).find(x => x >= start);
  if (!t) return null;
  return { at: t, minutes: businessMinutes(created, Math.max(created, toMs(t)), idx.settings, idx.tz) };
}
export function leadsSection(snap, { range, rep, now }) {
  const idx = buildIndex(snap);
  const tz = idx.tz;
  const leads = leadOpps(idx, rep).filter(o => inRange(localDate(o.createdAt, tz), range));
  const rows = leads.map(o => {
    const c = idx.contacts.get(o.contactId);
    const repeat = idx.isRepeat(o.contactId, o.createdAt);
    const resp = firstResponse(idx, o);
    const ageMin = businessMinutes(o.createdAt, now, idx.settings, tz, 10000);
    return { o, c, repeat, source: o.source || c?.source || '', bucket: sourceBucket(o.source || c?.source, repeat), service: idx.serviceName(o.pipelineId), type: c?.type || '', resp, ageMin };
  });
  const count = (key) => [...groupBy(rows, key)].map(([k, l]) => ({ key: k, count: l.length, value: sum(l, r => r.o.value) })).sort((a, b) => b.count - a.count);
  const responded = rows.filter(r => r.resp);
  const eligible60 = rows.filter(r => r.resp || r.ageMin >= 60);
  const eligible240 = rows.filter(r => r.resp || r.ageMin >= 240);
  const daily = groupBy(rows, r => localDate(r.o.createdAt, tz));
  return {
    total: rows.length,
    bySource: count(r => r.bucket), byRawSource: count(r => r.source || 'Not set'), byService: count(r => r.service), byType: count(r => typeLabel(r.type)),
    response: {
      median: median(responded.map(r => r.resp.minutes)),
      within60: ratio(eligible60.filter(r => r.resp && r.resp.minutes <= 60).length, eligible60.length),
      within240: ratio(eligible240.filter(r => r.resp && r.resp.minutes <= 240).length, eligible240.length),
      responded: responded.length, awaiting: rows.filter(r => !r.resp && r.o.status === 'open').length, eligible60: eligible60.length, eligible240: eligible240.length
    },
    daily: datesIn(range, 400).map(d => ({ date: d, count: (daily.get(d) || []).length })),
    rows
  };
}

export function callsSection(snap, { range, now }) {
  const idx = buildIndex(snap);
  const tz = idx.tz;
  const byPhone = new Map([...idx.contacts.values()].filter(c => c.phone).map(c => [c.phone, c]));
  const calls = (snap.inboundCalls || []).filter(c => inRange(localDate(c.at, tz), range)).map(c => ({ ...c, contact: byPhone.get(c.from) || null }));
  const missed = calls.filter(c => !c.answered);
  const notCalledBack = missed.filter(c => !c.calledBackAt);
  const cbMins = missed.filter(c => c.calledBackAt).map(c => (toMs(c.calledBackAt) - toMs(c.at)) / MIN);
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, answered: 0, missed: 0 }));
  for (const c of calls) { const p = parts(toMs(c.at), tz); byHour[p.H][c.answered ? 'answered' : 'missed']++; }
  return {
    total: calls.length, answered: calls.length - missed.length, missed: missed.length, answerRate: ratio(calls.length - missed.length, calls.length),
    notCalledBack: notCalledBack.length, calledBackMedianMin: median(cbMins), calledBackWithin60: ratio(cbMins.filter(m => m <= 60).length, missed.length),
    byHour: byHour.filter(h => h.answered || h.missed),
    missedList: missed.slice(0, 200), mode: snap.feeds?.twilio?.answerMode || '', available: !!snap.inboundCalls
  };
}

// Things to do now (not filtered by period).
export function actionQueue(snap, { rep, now }) {
  const idx = buildIndex(snap);
  const tz = idx.tz, s = idx.settings, bdm = businessDayMinutes(s);
  const items = [];
  const since = days => new Date(toMs(now) - days * DAY).toISOString();
  for (const o of leadOpps(idx, rep)) {
    if (o.status !== 'open') continue;
    const c = idx.contacts.get(o.contactId);
    const name = c?.name || o.contactName || o.name;
    const base = { oppId: o.id, contactId: o.contactId, name, service: idx.serviceName(o.pipelineId), value: o.value, owner: o.assignedTo, link: idx.contactLink(o.contactId) };
    const pr = idx.proposalByPipe.get(o.pipelineId);
    const stage = idx.cfg.stages?.[o.stageId];
    const sent = idx.sentAt(o);
    if (o.createdAt >= since(30) && !firstResponse(idx, o)) {
      const age = businessMinutes(o.createdAt, now, s, tz);
      items.push({ ...base, kind: 'no-reply', label: 'New lead, no reply yet', since: o.createdAt, ageMin: age, overdue: age > 240 });
      continue;
    }
    if (pr && stage && stage.position < pr.position && !sent && o.createdAt >= since(60)) {
      const age = businessMinutes(o.createdAt, now, s, tz);
      if (age > bdm) items.push({ ...base, kind: 'estimate-overdue', label: 'Estimate not sent (1 business day)', since: o.createdAt, ageMin: age, overdue: true });
      continue;
    }
    if (pr && o.stageId === pr.id && sent) {
      const after = new Date(toMs(sent.at) + 2 * HOUR).toISOString();
      const followed = idx.touches(o.contactId).some(t => t >= after);
      if (!followed && toMs(now) - toMs(sent.at) > s.followUpDays * DAY && toMs(now) - toMs(sent.at) < 60 * DAY) items.push({ ...base, kind: 'no-follow-up', label: `Proposal sent, no follow-up in ${s.followUpDays} days`, since: sent.at, ageMin: (toMs(now) - toMs(sent.at)) / MIN, overdue: true });
    }
  }
  const byPhone = new Map([...idx.contacts.values()].filter(c => c.phone).map(c => [c.phone, c]));
  if (!rep) for (const c of snap.inboundCalls || []) {
    if (c.answered || c.calledBackAt || c.at < since(7)) continue;
    const contact = byPhone.get(c.from);
    items.push({ kind: 'missed-call', label: 'Missed call, not called back', name: contact?.name || c.from, contactId: contact?.id || '', link: idx.contactLink(contact?.id), since: c.at, ageMin: (toMs(now) - toMs(c.at)) / MIN, overdue: true, phone: c.from });
  }
  const order = { 'missed-call': 0, 'no-reply': 1, 'estimate-overdue': 2, 'no-follow-up': 3 };
  return items.sort((a, b) => order[a.kind] - order[b.kind] || (a.since < b.since ? -1 : 1));
}

// ---------- estimates & pipeline ----------
export function estimatesSection(snap, { range, rep, now }) {
  const idx = buildIndex(snap);
  const tz = idx.tz, s = idx.settings, bdm = businessDayMinutes(s);
  const jobOpps = idx.opps.filter(o => idx.jobPipes.has(o.pipelineId) && !idx.isLaborer(idx.contacts.get(o.contactId)) && idx.repMatch(o, rep));
  const sentRows = [];
  for (const o of jobOpps) { const sa = idx.sentAt(o); if (sa && inRange(localDate(sa.at, tz), range)) sentRows.push({ o, sentAt: sa.at, src: sa.src, mins: businessMinutes(o.createdAt, sa.at, s, tz) }); }
  const timed = sentRows.filter(r => r.src !== 'baseline' && r.o.createdAt);
  const closed = jobOpps.filter(o => (o.status === 'won' || o.status === 'lost') && inRange(localDate(o.statusChangedAt || o.updatedAt, tz), range));
  const won = closed.filter(o => o.status === 'won');
  const winSplit = key => [...groupBy(closed, key)].map(([k, l]) => {
    const w = l.filter(o => o.status === 'won');
    return { key: k, won: w.length, lost: l.length - w.length, rate: ratio(w.length, l.length), wonValue: sum(w, o => o.value), lostValue: sum(l.filter(o => o.status === 'lost'), o => o.value), rateValue: ratio(sum(w, o => o.value), sum(l, o => o.value)) };
  }).sort((a, b) => (b.won + b.lost) - (a.won + a.lost));
  const c = o => idx.contacts.get(o.contactId);
  const open = jobOpps.filter(o => o.status === 'open');
  const stages = idx.cfg.stages || {};
  const byStage = [...groupBy(open, o => o.stageId)].map(([id, l]) => ({ id, name: stages[id]?.name || 'Unknown stage', pipeline: idx.serviceName(stages[id]?.pipelineId || l[0].pipelineId), position: stages[id]?.position ?? 99, count: l.length, value: sum(l, o => o.value) }))
    .sort((a, b) => a.pipeline.localeCompare(b.pipeline) || a.position - b.position);
  const aging = { '0–3 days': 0, '4–7 days': 0, '8–14 days': 0, '15–30 days': 0, '31+ days': 0 }, agingValue = { ...aging };
  const waiting = [];
  for (const o of open) {
    const pr = idx.proposalByPipe.get(o.pipelineId);
    if (!pr || o.stageId !== pr.id) continue;
    const sa = idx.sentAt(o); if (!sa) continue;
    const d = (toMs(now) - toMs(sa.at)) / DAY;
    const k = d <= 3 ? '0–3 days' : d <= 7 ? '4–7 days' : d <= 14 ? '8–14 days' : d <= 30 ? '15–30 days' : '31+ days';
    aging[k]++; agingValue[k] += o.value;
    waiting.push({ o, days: d, name: c(o)?.name || o.contactName || o.name, link: idx.contactLink(o.contactId) });
  }
  const lost = closed.filter(o => o.status === 'lost');
  const wonService = [...groupBy(won.filter(o => idx.servicePipes.includes(o.pipelineId) || o.pipelineId === idx.P.changeOrders), o => idx.serviceName(o.pipelineId))].map(([k, l]) => ({ key: k, count: l.length, value: sum(l, o => o.value), avg: sum(l, o => o.value) / l.length }));
  return {
    sent: sentRows.length, sentValue: sum(sentRows, r => r.o.value),
    turnaround: { median: median(timed.map(r => r.mins)), withinDay: ratio(timed.filter(r => r.mins <= bdm).length, timed.length), timed: timed.length },
    won: won.filter(o => o.pipelineId !== idx.P.changeOrders).length, changeOrdersWon: won.filter(o => o.pipelineId === idx.P.changeOrders).length,
    revenue: sum(won, o => o.value), lostCount: lost.length,
    winRate: ratio(won.length, closed.length), winRateValue: ratio(sum(won, o => o.value), sum(closed, o => o.value)),
    byService: winSplit(o => idx.serviceName(o.pipelineId)), byType: winSplit(o => typeLabel(c(o)?.type)), bySource: winSplit(o => sourceBucket(o.source || c(o)?.source, idx.isRepeat(o.contactId, o.createdAt))),
    avgByService: wonService, byStage, aging: Object.entries(aging).map(([k, v]) => ({ key: k, count: v, value: agingValue[k] })),
    waiting: waiting.sort((a, b) => b.days - a.days).slice(0, 50),
    lostReasons: [...groupBy(lost, o => o.lostReason || 'No reason given')].map(([k, l]) => ({ key: k, count: l.length, value: sum(l, o => o.value) })).sort((a, b) => b.count - a.count),
    openValue: sum(open, o => o.value)
  };
}

// ---------- containers (quantity, from dispatch runs) ----------
export function containerRuns(snap) {
  const idx = buildIndex(snap);
  const d = snap.dispatch || {};
  const runs = [];
  const logged = new Set();
  for (const r of d.moveRuns || []) {
    const kind = CONTAINER_MOVES[r.movementType]; if (!kind) continue;
    logged.add(r.moveId + '|' + r.date);
    runs.push({ ...r, kind, key: r.sourceOpportunityId || r.moveId, legacy: false });
  }
  // Moves closed before run logging existed: approximate the date.
  for (const m of d.moves || []) {
    const kind = CONTAINER_MOVES[m.movementType]; if (!kind || m.status !== 'completed') continue;
    const date = m.closedSchedule?.date || localDate(m.completedAt || m.closedAt || m.updatedAt, idx.tz);
    if (!date || logged.has(m.moveId + '|' + date) || (d.moveRuns || []).some(r => r.moveId === m.moveId)) continue;
    runs.push({ moveId: m.moveId, date, movementType: m.movementType, containerSize: m.containerSize, loadCount: m.loadCount, driverName: m.driverName, assetIds: m.assetIds, sourceOpportunityId: m.sourceOpportunityId, address: m.address, clientName: m.clientName, value: m.value, kind, key: m.sourceOpportunityId || m.moveId, legacy: !m.closedSchedule });
  }
  return runs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
export function containersSection(snap, { range, now }) {
  const idx = buildIndex(snap);
  const today = localDate(now, idx.tz), s = idx.settings;
  const runs = containerRuns(snap);
  const open = new Map(), closedRentals = [];
  for (const r of runs) {
    const q = Math.max(1, Math.round(r.loadCount || 1));
    const list = open.get(r.key) || open.set(r.key, []).get(r.key);
    if (r.kind === 'drop') for (let i = 0; i < q; i++) list.push({ out: r.date, size: r.containerSize || 'Unknown size', client: r.clientName, address: r.address, key: r.key, legacy: r.legacy });
    if (r.kind === 'pickup') for (let i = 0; i < q && list.length; i++) { const x = list.shift(); closedRentals.push({ ...x, back: r.date, days: daysBetween(x.out, r.date) }); }
  }
  const openRentals = [...open.values()].flat().map(x => ({ ...x, age: daysBetween(x.out, today) }));
  const fleet = Object.values(s.containerFleet || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  const bySize = [...groupBy(openRentals, x => x.size)].map(([size, l]) => ({ size, out: l.length, fleet: Number(s.containerFleet?.[size]) || 0 }));
  for (const [size, n] of Object.entries(s.containerFleet || {})) if (n && !bySize.some(b => b.size === size)) bySize.push({ size, out: 0, fleet: n });
  const inWin = runs.filter(r => inRange(r.date, range));
  const closedInWin = closedRentals.filter(r => inRange(r.back, range));
  const weeks = []; for (let i = 11; i >= 0; i--) { const start = addDays(mondayOf(today), -7 * i); weeks.push({ week: start, swaps: 0, dumps: 0, drops: 0, pickups: 0 }); }
  for (const r of runs) { const w = weeks.find(x => r.date >= x.week && r.date < addDays(x.week, 7)); if (w) w[{ swap: 'swaps', dump: 'dumps', drop: 'drops', pickup: 'pickups' }[r.kind]] += Math.max(1, Math.round(r.loadCount || 1)); }
  const qty = (list, kind) => sum(list.filter(r => r.kind === kind), r => Math.max(1, Math.round(r.loadCount || 1)));
  return {
    out: openRentals.length, fleet, utilization: fleet ? openRentals.length / fleet : null, bySize: bySize.sort((a, b) => a.size.localeCompare(b.size, undefined, { numeric: true })),
    drops: qty(inWin, 'drop'), pickups: qty(inWin, 'pickup'), swaps: qty(inWin, 'swap'), dumps: qty(inWin, 'dump'),
    avgRental: closedInWin.length ? sum(closedInWin, r => r.days) / closedInWin.length : null, closedRentals: closedInWin.length,
    pastDue: openRentals.filter(x => x.age > s.rentalDays).sort((a, b) => b.age - a.age), rentalDays: s.rentalDays,
    openRentals: openRentals.sort((a, b) => b.age - a.age), weeks, legacyRuns: runs.filter(r => r.legacy).length, totalRuns: runs.length,
    available: !!snap.dispatch
  };
}

// ---------- jobs & trucks ----------
function jobKind(idx, j) {
  if (j.parentJobId || j.pipelineId === idx.P.changeOrders) return 'Change order';
  if (j.jobType === 'contract' || j.pipelineId === idx.P.demo) return 'Demo';
  if (j.jobType === 'hourly' || j.pipelineId === idx.P.labor) return 'Labor';
  const o = idx.opps.find(x => x.id === j.jobId);
  return o ? idx.serviceName(o.pipelineId) : 'Job';
}
// Every job-day with its crew: logged days, plus scheduled days on the board not logged yet.
export function jobDayMap(snap) {
  const d = snap.dispatch || {};
  const map = new Map();
  for (const x of d.jobDays || []) map.set(x.jobId + '|' + x.date, { jobId: x.jobId, date: x.date, crew: x.crew || [], logged: true, sentHome: x.sentHome || [] });
  for (const j of d.jobs || []) {
    if (!j.active || j.status || !/^\d{4}-\d{2}-\d{2}$/.test(j.reportDate || '')) continue;
    const end = j.reportEndDate && j.reportEndDate >= j.reportDate ? j.reportEndDate : j.reportDate;
    for (let day = j.reportDate, n = 0; day <= end && n < 60; day = addDays(day, 1), n++) if (!map.has(j.jobId + '|' + day)) map.set(j.jobId + '|' + day, { jobId: j.jobId, date: day, crew: j.crew || [], logged: false, sentHome: [] });
  }
  return [...map.values()];
}
export function jobsSection(snap, { range, now }) {
  const idx = buildIndex(snap);
  const tz = idx.tz, today = localDate(now, tz);
  const d = snap.dispatch || {};
  const jobs = d.jobs || [];
  const days = jobDayMap(snap);
  const byJobDays = groupBy(days, x => x.jobId);
  const scheduledIds = new Set(days.filter(x => inRange(x.date, range)).map(x => x.jobId));
  const completed = jobs.filter(j => j.status === 'completed' && inRange(localDate(j.closedAt, tz), range));
  const onTimeRows = completed.map(j => {
    const ds = byJobDays.get(j.jobId) || [];
    const planned = [j.reportEndDate, j.reportDate, ...ds.map(x => x.date)].filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x || '')).sort().pop() || '';
    const closed = localDate(j.closedAt, tz);
    return { j, planned, closed, onTime: planned ? closed <= planned : null };
  });
  const known = onTimeRows.filter(r => r.onTime !== null);
  const valueOf = j => j.value || idx.opps.find(o => o.id === j.jobId)?.value || 0;
  const openJobs = jobs.filter(j => j.active && !j.status);
  const openValue = sum(openJobs, valueOf);
  const weeks = []; for (let i = 7; i >= 0; i--) weeks.push(addDays(mondayOf(today), -7 * (i + 1)));
  const weekly = weeks.map(w => ({ week: w, value: sum(jobs.filter(j => j.status === 'completed' && localDate(j.closedAt, tz) >= w && localDate(j.closedAt, tz) < addDays(w, 7)), valueOf), count: jobs.filter(j => j.status === 'completed' && localDate(j.closedAt, tz) >= w && localDate(j.closedAt, tz) < addDays(w, 7)).length }));
  const avgWeekly = sum(weekly, w => w.value) / weekly.length;
  const futureCrewDays = sum(days.filter(x => x.date > today), x => x.crew.length);
  const pastWeeksCrewDays = sum(days.filter(x => x.date < mondayOf(today) && x.date >= addDays(mondayOf(today), -28)), x => x.crew.length) / 4;
  // Trucks: every logistics run with a vehicle on it.
  const moveRunCount = groupBy(d.moveRuns || [], r => r.moveId);
  const runs = (d.moveRuns || []).filter(r => inRange(r.date, range) && (r.assetIds || []).length);
  const assetName = new Map((d.assets || []).map(a => [a.id, a.name]));
  const perTruck = new Map();
  for (const r of runs) {
    const share = (r.value || 0) / ((moveRunCount.get(r.moveId) || [1]).length || 1) / r.assetIds.length;
    for (const a of r.assetIds) {
      const t = perTruck.get(a) || perTruck.set(a, { id: a, name: assetName.get(a) || a, days: new Set(), loads: 0, revenue: 0 }).get(a);
      t.days.add(r.date); t.loads += (r.loadCount || 1) / r.assetIds.length; t.revenue += share;
    }
  }
  const trucks = [...perTruck.values()].map(t => ({ ...t, days: t.days.size, loadsPerDay: t.loads / t.days.size, revenuePerDay: t.revenue / t.days.size })).sort((a, b) => b.days - a.days);
  const truckDays = sum(trucks, t => t.days);
  const kinds = groupBy([...scheduledIds].map(id => jobs.find(j => j.jobId === id)).filter(Boolean), j => jobKind(idx, j));
  return {
    scheduled: scheduledIds.size, completed: completed.length, cancelled: jobs.filter(j => j.status === 'cancelled' && inRange(localDate(j.closedAt, tz), range)).length,
    onTimeRate: ratio(known.filter(r => r.onTime).length, known.length), onTimeKnown: known.length, late: onTimeRows.filter(r => r.onTime === false),
    scheduledByKind: [...kinds].map(([k, l]) => ({ key: k, count: l.length })),
    openJobs: openJobs.length, openValue, avgWeeklyCompleted: avgWeekly, backlogWeeks: avgWeekly > 0 ? openValue / avgWeekly : null,
    futureCrewDays, avgWeeklyCrewDays: pastWeeksCrewDays, backlogWeeksCrew: pastWeeksCrewDays > 0 ? futureCrewDays / pastWeeksCrewDays : null,
    weekly, trucks, truckDays, loads: sum(trucks, t => t.loads), loadsPerTruckDay: truckDays ? sum(trucks, t => t.loads) / truckDays : null,
    revenuePerTruckDay: truckDays ? sum(trucks, t => t.revenue) / truckDays : null, available: !!snap.dispatch
  };
}

// ---------- crews ----------
export function laborers(snap) {
  const idx = buildIndex(snap);
  return [...idx.contacts.values()].filter(c => idx.isLaborer(c)).map(c => ({ ...c, temp: idx.tempOf(c) }));
}
const workerKey = w => String(w.id || w.phone || w.name || '').toLowerCase();
export function crewsSection(snap, { range, rep, now }) {
  const idx = buildIndex(snap);
  const tz = idx.tz, s = idx.settings, today = localDate(now, tz);
  const active = laborers(snap).filter(c => idx.cfg.activeTemps?.includes(c.temp));
  const days = jobDayMap(snap);
  const work = new Set(s.workdays);
  const pastRange = { from: range.from, to: range.to < today ? range.to : today };
  const workDates = datesIn(pastRange).filter(d => work.has(weekday(d)));
  const booked = sum(days.filter(x => inRange(x.date, pastRange)), x => x.crew.length);
  const available = active.length * workDates.length;
  const ahead = datesIn({ from: today, to: addDays(today, 13) }).map(date => ({ date, booked: sum(days.filter(x => x.date === date), x => x.crew.length), available: work.has(weekday(date)) ? active.length : 0 }));
  const bookedIds = new Set((snap.dispatch?.bookings || []).map(b => b.opportunityId));
  const laborWon = idx.opps.filter(o => o.pipelineId === idx.P.labor && o.status === 'won' && inRange(localDate(o.statusChangedAt || o.updatedAt, tz), range) && idx.repMatch(o, rep));
  const board = laborWon.filter(o => bookedIds.has(o.id)).length;
  const custWins = idx.opps.filter(o => idx.jobPipes.has(o.pipelineId) && o.status === 'won' && o.contactId && inRange(localDate(o.statusChangedAt || o.updatedAt, tz), range) && !idx.isLaborer(idx.contacts.get(o.contactId)) && idx.repMatch(o, rep));
  const firstWin = new Map(); for (const o of custWins) { const t = o.statusChangedAt || o.updatedAt; if (!firstWin.has(o.contactId) || t < firstWin.get(o.contactId)) firstWin.set(o.contactId, t); }
  const customers = [...firstWin].map(([id, t]) => ({ id, type: idx.contacts.get(id)?.type || '', repeat: idx.isRepeat(id, t) }));
  const workerDays = new Map();
  for (const x of days.filter(x => inRange(x.date, pastRange))) for (const w of x.crew) { const k = workerKey(w); const e = workerDays.get(k) || workerDays.set(k, { name: w.name, days: 0 }).get(k); e.days++; }
  const sentHome = sum((snap.dispatch?.jobDays || []).filter(x => inRange(x.date, range)), x => sum(x.sentHome || [], h => h.hoursWorked));
  return {
    booked, available, activeLaborers: active.length, workDays: workDates.length, utilization: ratio(booked, available), ahead,
    laborWon: laborWon.length, boardBooked: board, elsewhere: laborWon.length - board,
    customers: customers.length, repeatCustomers: customers.filter(c => c.repeat).length, repeatRate: ratio(customers.filter(c => c.repeat).length, customers.length),
    repeatByType: [...groupBy(customers, c => typeLabel(c.type))].map(([k, l]) => ({ key: k, count: l.length, repeat: l.filter(c => c.repeat).length, rate: ratio(l.filter(c => c.repeat).length, l.length) })).sort((a, b) => b.count - a.count),
    topWorkers: [...workerDays.values()].sort((a, b) => b.days - a.days).slice(0, 15), sentHomeHours: sentHome, available_: !!snap.dispatch
  };
}

// ---------- hiring & labor pool ----------
export function hiringSection(snap, { range, now }) {
  const idx = buildIndex(snap);
  const tz = idx.tz, today = localDate(now, tz);
  const activeTemps = idx.cfg.activeTemps || ['warm', 'hot', 'vip'], dormant = idx.cfg.dormantTemps || ['cold'];
  const hiringOpps = idx.opps.filter(o => o.pipelineId === idx.P.hiring);
  const applicants = hiringOpps.filter(o => inRange(localDate(o.createdAt, tz), range));
  const isHired = id => activeTemps.includes(idx.tempOf(idx.contacts.get(id)));
  const events = snap.hireEvents || {};
  const appliedAt = new Map(); for (const o of hiringOpps) if (o.contactId && (!appliedAt.has(o.contactId) || o.createdAt < appliedAt.get(o.contactId))) appliedAt.set(o.contactId, o.createdAt);
  const hires = Object.entries(events).filter(([, e]) => e.at && inRange(localDate(e.at, tz), range));
  const tth = Object.entries(events).filter(([id, e]) => e.at && appliedAt.has(id) && e.at >= appliedAt.get(id)).map(([id, e]) => (toMs(e.at) - toMs(appliedAt.get(id))) / DAY);
  const stages = idx.cfg.stages || {};
  const openByStage = [...groupBy(hiringOpps.filter(o => o.status === 'open'), o => o.stageId)].map(([id, l]) => ({ key: stages[id]?.name || 'Unknown stage', position: stages[id]?.position ?? 99, count: l.length })).sort((a, b) => a.position - b.position);
  const months = []; for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - i, 1)); months.push(d.toISOString().slice(0, 7)); }
  const monthly = months.map(m => ({ month: m, hires: Object.values(events).filter(e => e.at && localDate(e.at, tz).startsWith(m)).length, applicants: hiringOpps.filter(o => localDate(o.createdAt, tz).startsWith(m)).length }));
  // Pool
  const pool = laborers(snap);
  const byTemp = ['vip', 'hot', 'warm', 'cold', ''].map(t => ({ key: tempLabel(t), temp: t, count: pool.filter(c => (t ? c.temp === t : !c.temp || ![...activeTemps, ...dormant].includes(c.temp))).length }));
  const days = jobDayMap(snap).filter(x => x.date <= today);
  const lastBooked = new Map();
  const byPhone = new Map(pool.filter(c => c.phone).map(c => [c.phone, c.id]));
  const byName = new Map(pool.map(c => [String(c.name).toLowerCase(), c.id]));
  for (const x of days) for (const w of x.crew) { const id = (w.id && idx.contacts.has(w.id) && w.id) || byPhone.get(w.phone) || byName.get(String(w.name).toLowerCase()); if (id && (!lastBooked.has(id) || x.date > lastBooked.get(id))) lastBooked.set(id, x.date); }
  const activePool = pool.filter(c => activeTemps.includes(c.temp));
  const booked30 = activePool.filter(c => (lastBooked.get(c.id) || '') >= addDays(today, -30));
  const retention = days => { const cohort = Object.entries(events).filter(([, e]) => e.at && daysBetween(localDate(e.at, tz), today) >= days); const kept = cohort.filter(([id, e]) => (lastBooked.get(id) || '') >= addDays(localDate(e.at, tz), days)); return { cohort: cohort.length, kept: kept.length, rate: ratio(kept.length, cohort.length) }; };
  return {
    applicants: applicants.length, hiredFromApplicants: applicants.filter(o => isHired(o.contactId)).length, hireRate: ratio(applicants.filter(o => isHired(o.contactId)).length, applicants.length),
    hires: hires.length, medianDaysToHire: median(tth), openByStage, monthly,
    pool: pool.length, active: activePool.length, dormant: pool.filter(c => dormant.includes(c.temp)).length, byTemp,
    booked30: booked30.length, activeNotBooked: activePool.filter(c => !booked30.includes(c)).map(c => ({ name: c.name, temp: c.temp, last: lastBooked.get(c.id) || '', link: idx.contactLink(c.id) })).sort((a, b) => (a.last < b.last ? -1 : 1)),
    retention30: retention(30), retention60: retention(60), baselineHires: Object.values(events).filter(e => e.baseline).length
  };
}

// ---------- money (owners) ----------
const COST_OF_REVENUE = ['materials', 'labor', 'subcontractor', 'equipment rental', 'fuel', 'permits & fees'];
export function moneySection(snap, { range, now }) {
  const L = snap.ledger;
  if (!L) return { available: false };
  const idx = buildIndex(snap);
  const tz = idx.tz, today = localDate(now, tz);
  const docs = new Map((L.invoices || []).map(i => [i.opportunityId, i]));
  const oppById = new Map(idx.opps.map(o => [o.id, o]));
  const ids = new Set([...Object.keys(L.invoiceStages || {}), ...Object.keys(L.invoiceStageEvents || {}), ...docs.keys()]);
  const inv = [...ids].map(id => {
    const doc = docs.get(id), ev = (L.invoiceStageEvents || {})[id] || {}, stage = (L.invoiceStages || {})[id] || 'draft', o = oppById.get(id);
    const amount = doc?.total || o?.value || 0;
    return { id, stage, amount, balance: stage === 'paid' ? 0 : (doc ? (doc.balance ?? doc.total) : amount), issued: doc?.date || (ev.sent ? localDate(ev.sent, tz) : ''), sentAt: ev.sent || (doc?.date ? doc.date + 'T12:00:00Z' : ''), paidAt: stage === 'paid' ? ev.paid || '' : '', client: doc?.client || o?.contactName || o?.name || id, hasDoc: !!doc };
  }).filter(x => x.stage !== 'hidden');
  const issued = inv.filter(x => x.stage !== 'draft' && inRange(x.issued, range));
  const paid = inv.filter(x => x.paidAt && inRange(localDate(x.paidAt, tz), range));
  const ar = inv.filter(x => x.stage === 'sent' || x.stage === 'overdue');
  const last90 = sum(inv.filter(x => x.stage !== 'draft' && x.issued >= addDays(today, -90)), x => x.amount);
  const bills = (L.bills || []).filter(b => b.status !== 'rejected');
  const billsIn = bills.filter(b => inRange(b.date, range));
  const cats = new Map();
  for (const b of billsIn) for (const l of b.lines || []) cats.set(l.category || 'Uncategorized', (cats.get(l.category || 'Uncategorized') || 0) + l.amount);
  const payroll = sum((L.payroll || []).filter(r => inRange(r.periodEnd, range)), r => r.totalCost);
  const cor = sum([...cats].filter(([k]) => COST_OF_REVENUE.includes(k.toLowerCase())), ([, v]) => v) + payroll;
  const opex = sum([...cats].filter(([k]) => !COST_OF_REVENUE.includes(k.toLowerCase()) && !/loan/i.test(k)), ([, v]) => v);
  const months = []; for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - i, 1)); months.push(d.toISOString().slice(0, 7)); }
  const monthly = months.map(m => ({ month: m, invoiced: sum(inv.filter(x => x.stage !== 'draft' && x.issued.startsWith(m)), x => x.amount), collected: sum(inv.filter(x => x.paidAt && localDate(x.paidAt, tz).startsWith(m)), x => x.amount) }));
  // Job margin: EOD sheet cost vs what was invoiced (or the job value).
  const eod = groupBy(snap.dispatch?.eodSheets || [], e => e.jobId);
  const jobs = (snap.dispatch?.jobs || []).filter(j => j.status === 'completed' && inRange(localDate(j.closedAt, tz), range));
  const margins = jobs.map(j => {
    const cost = sum(eod.get(j.jobId) || [], e => e.cost);
    const revenue = docs.get(j.jobId)?.total || j.value || oppById.get(j.jobId)?.value || 0;
    return { jobId: j.jobId, name: j.jobAddress || j.clientName || j.jobId, client: j.clientName, cost, revenue, margin: revenue - cost, pct: revenue ? (revenue - cost) / revenue : null, invoiced: docs.has(j.jobId), hasCost: cost > 0 };
  }).filter(m => m.hasCost);
  return {
    available: true,
    invoiced: sum(issued, x => x.amount), invoicedCount: issued.length, collected: sum(paid, x => x.amount), collectedCount: paid.length,
    arOutstanding: sum(ar, x => x.balance), arOverdue: sum(ar.filter(x => x.stage === 'overdue'), x => x.balance), arCount: ar.length,
    daysToPaid: median(paid.filter(x => x.sentAt).map(x => (toMs(x.paidAt) - toMs(x.sentAt)) / DAY)),
    dso: last90 > 0 ? sum(ar, x => x.balance) / (last90 / 90) : null,
    apOutstanding: sum(bills.filter(b => b.status === 'pending' || b.status === 'approved'), b => b.balance), apOverdue: sum(bills.filter(b => (b.status === 'pending' || b.status === 'approved') && b.dueDate && b.dueDate < today), b => b.balance),
    costOfRevenue: cor, payroll, opex, grossProfit: sum(issued, x => x.amount) - cor, grossMargin: ratio(sum(issued, x => x.amount) - cor, sum(issued, x => x.amount)),
    costByCategory: [...cats].map(([k, v]) => ({ key: k, value: v, cor: COST_OF_REVENUE.includes(k.toLowerCase()) })).sort((a, b) => b.value - a.value),
    monthly, margins: margins.sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0)), invoicesNoDoc: inv.filter(x => x.stage !== 'draft' && !x.hasDoc).length,
    arByClient: [...groupBy(ar, x => x.client)].map(([k, l]) => ({ key: k, value: sum(l, x => x.balance), overdue: sum(l.filter(x => x.stage === 'overdue'), x => x.balance) })).sort((a, b) => b.value - a.value).slice(0, 10)
  };
}

// ---------- overview ----------
export function overview(snap, opts) {
  const leads = leadsSection(snap, opts), est = estimatesSection(snap, opts), cont = containersSection(snap, opts), crews = crewsSection(snap, opts);
  return { leads: leads.total, estimatesSent: est.sent, jobsWon: est.won, revenue: est.revenue, winRate: est.winRate, medianResponse: leads.response.median, containersOut: cont.out, fleet: cont.fleet, containerUtil: cont.utilization, crewUtil: crews.utilization, crewBooked: crews.booked, crewAvailable: crews.available };
}

// ---------- data quality ----------
export function dataQuality(snap, { now }) {
  const idx = buildIndex(snap);
  const tz = idx.tz;
  const leads = leadOpps(idx, '');
  const recent = leads.filter(o => o.createdAt >= new Date(toMs(now) - 90 * DAY).toISOString());
  const c = o => idx.contacts.get(o.contactId);
  const won = idx.opps.filter(o => idx.jobPipes.has(o.pipelineId) && o.status === 'won');
  const pool = laborers(snap);
  const checks = [];
  const add = (area, label, bad, total, help, severity = 'warn') => checks.push({ area, label, bad, total, share: total ? bad / total : 0, help, severity: bad ? severity : 'ok' });
  add('GHL', 'Leads (last 90 days) with no contact type', recent.filter(o => !c(o)?.type).length, recent.length, 'Set Contact Type to General-contractor, Developer or Home-owner so win rate and repeat customers split by type.');
  add('GHL', 'Leads (last 90 days) with no source', recent.filter(o => !(o.source || c(o)?.source)).length, recent.length, 'Lead source comes from the opportunity source, else the contact source.');
  add('GHL', 'Won jobs with no value', won.filter(o => !o.value).length, won.length, 'Revenue booked and win rate by dollars use the opportunity value.');
  add('GHL', 'Open leads with no assigned user', leads.filter(o => o.status === 'open' && !o.assignedTo && !c(o)?.assignedTo).length, leads.filter(o => o.status === 'open').length, 'Unassigned leads drop out when you filter by rep.', 'info');
  const pipesNoProposal = idx.servicePipes.concat(idx.P.changeOrders).filter(p => p && !idx.proposalByPipe.has(p)).map(idx.serviceName);
  if (pipesNoProposal.length) checks.push({ area: 'GHL', label: `No "Proposal Sent" / "Change Order Sent" stage found in: ${pipesNoProposal.join(', ')}`, bad: pipesNoProposal.length, total: 4, share: 1, help: 'Estimates sent and turnaround need that stage name (PROPOSAL_STAGE_NAMES changes it).', severity: 'crit' });
  add('GHL', 'Contacts typed Laborer with no temperature', pool.filter(p => !p.temp).length, pool.length, 'Set Temperature (Cold / Warm / Hot / VIP) so they count as dormant or active.');
  const hiring = idx.opps.filter(o => o.pipelineId === idx.P.hiring);
  add('GHL', 'Hiring pipeline contacts not typed Laborer', hiring.filter(o => !idx.isLaborer(c(o))).length, hiring.length, 'They are left out of the labor pool and hire counts.');
  const cr = containersSection(snap, { range: periodRange('ytd', now, tz), now });
  add('Dispatch', 'Container runs from before run logging (dates approximate)', cr.legacyRuns, cr.totalRuns, 'Moves closed before dispatch 1.9 use the close date; new runs are exact.', 'info');
  add('Dispatch', 'Containers out more than 90 days (check the pickup was logged)', cr.openRentals.filter(x => x.age > 90).length, cr.out, 'A pickup that was never logged on the board keeps a container "out".');
  if (!Object.values(idx.settings.containerFleet || {}).some(Boolean)) checks.push({ area: 'Settings', label: 'Container fleet count not set', bad: 1, total: 1, share: 1, help: 'Set how many containers you own (Settings) for utilization.', severity: 'warn' });
  const jobs = snap.dispatch?.jobs || [];
  add('Dispatch', 'Completed jobs with no scheduled end date', jobs.filter(j => j.status === 'completed' && !j.reportEndDate && !j.reportDate && !(snap.dispatch?.jobDays || []).some(x => x.jobId === j.jobId)).length, jobs.filter(j => j.status === 'completed').length, '% finished on the scheduled date skips these.', 'info');
  const byPhone = new Set([...idx.contacts.values()].map(x => x.phone).filter(Boolean));
  const inbound = snap.inboundCalls || [];
  add('Twilio', 'Inbound calls from numbers not on a GHL contact', inbound.filter(x => !byPhone.has(x.from)).length, inbound.length, 'Usually new callers or spam. Their missed calls still count.', 'info');
  return {
    feeds: snap.feeds || {}, checks, history: snap.history || {}, settings: idx.settings, config: snap.config || {},
    proposalStages: (snap.config?.proposalStageIds || []).map(id => ({ id, name: snap.config.stages[id]?.name, pipeline: idx.serviceName(snap.config.stages[id]?.pipelineId) }))
  };
}
