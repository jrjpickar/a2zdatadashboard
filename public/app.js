import * as M from './metrics.js';
import { barChart, barCell, attachTooltips, esc } from './charts.js';

const $ = id => document.getElementById(id);
const TOKEN_KEY = 'a2z-kpi-token';
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} }, del(k) { try { localStorage.removeItem(k); } catch {} } };
const state = { overrides: {}, snap: null, viewer: null, status: null, etag: '', period: store.get('kpi-period') || 'mtd', rep: store.get('kpi-rep') || '', tab: store.get('kpi-tab') || 'overview', queueKind: 'all', refreshing: false };

// ---------- formatting ----------
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const money = v => (v == null ? '—' : '$' + nf0.format(Math.round(v)));
const moneyShort = v => { const a = Math.abs(v); return a >= 1e6 ? '$' + nf1.format(v / 1e6) + 'M' : a >= 1e3 ? '$' + nf1.format(v / 1e3) + 'k' : '$' + nf0.format(v); };
const int = v => (v == null ? '—' : nf0.format(v));
const pct = v => (v == null ? '—' : nf0.format(v * 100) + '%');
const dec = v => (v == null ? '—' : nf1.format(v));
function mins(m) { if (m == null) return '—'; if (m < 1) return '<1m'; if (m < 60) return Math.round(m) + 'm'; const h = Math.floor(m / 60), r = Math.round(m % 60); return h < 48 ? `${h}h${r ? ' ' + r + 'm' : ''}` : `${nf1.format(m / 60 / 24)}d`; }
function busAge(m) { const day = state.idx ? M.businessDayMinutes(state.idx.settings) : 600; return m == null ? '—' : m < day ? mins(m) + ' bus.' : `${nf1.format(m / day)} bus. days`; }
const phone = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : p || ''; };
const ago = iso => { if (!iso) return 'never'; const m = (Date.now() - Date.parse(iso)) / 60000; return m < 1 ? 'just now' : m < 60 ? Math.round(m) + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
const shortDate = d => { if (!d) return ''; const [y, m, dd] = d.slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}), timeZone: 'UTC' }); };
const monthLabel = m => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }); };
const when = iso => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

// ---------- building blocks ----------
const kpi = (label, value, sub = '', tone = '') => `<div class="kpi ${tone}"><div class="label">${esc(label)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
const card = (span, title, sub, body, note = '') => `<div class="card span-${span}"><h2>${esc(title)}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}${body}${note ? `<p class="note">${note}</p>` : ''}</div>`;
function table(cols, rows, { empty = 'Nothing here for this period.', scroll = false } = {}) {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  const head = cols.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows.map(r => `<tr>${cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.html ? c.html(r) : esc(c.get(r))}</td>`).join('')}</tr>`).join('');
  return `<div class="${scroll ? 'table-wrap' : ''}"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
const link = (href, text) => href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text);
const pill = (text, tone = '') => `<span class="pill ${tone}">${esc(text)}</span>`;
function countTable(list, { label = 'Source', valueCol = false } = {}) {
  const max = Math.max(0, ...list.map(x => x.count));
  return table([{ label, get: r => r.key }, { label: 'Leads', html: r => barCell(r.count, max, int(r.count)) }, ...(valueCol ? [{ label: 'Value', num: true, get: r => money(r.value) }] : [])], list);
}
function winTable(list, label) {
  return table([{ label, get: r => r.key }, { label: 'Won', num: true, get: r => int(r.won) }, { label: 'Lost', num: true, get: r => int(r.lost) }, { label: 'Win rate', num: true, get: r => pct(r.rate) }, { label: 'By $', num: true, get: r => pct(r.rateValue) }], list, { empty: 'No jobs won or lost in this period.' });
}
const unavailable = (what, feed) => `<div class="banner">${esc(what)} isn't connected yet${state.snap?.feeds?.[feed]?.error ? ': ' + esc(state.snap.feeds[feed].error) : ''}. See Data Quality.</div>`;

// ---------- tabs ----------
const TABS = [
  { id: 'overview', label: 'Overview', render: renderOverview },
  { id: 'leads', label: 'Leads', render: renderLeads },
  { id: 'estimates', label: 'Estimates', render: renderEstimates },
  { id: 'containers', label: 'Containers', render: renderContainers },
  { id: 'jobs', label: 'Jobs & Trucks', render: renderJobs },
  { id: 'crews', label: 'Crews', render: renderCrews },
  { id: 'hiring', label: 'Hiring', render: renderHiring },
  { id: 'money', label: 'Money', render: renderMoney, owner: true },
  { id: 'quality', label: 'Data Quality', render: renderQuality },
  { id: 'users', label: 'Users', render: renderUsers, owner: true }
];
function opts() {
  const tz = state.snap?.config?.timeZone || 'America/Los_Angeles';
  return { range: M.periodRange(state.period, Date.now(), tz), rep: state.rep, now: Date.now() };
}

function renderOverview() {
  const o = opts(), ov = M.overview(state.snap, o), e = M.estimatesSection(state.snap, o), l = M.leadsSection(state.snap, o), q = M.actionQueue(state.snap, { ...o, overrides: state.overrides }), c = M.containersSection(state.snap, o), cr = M.crewsSection(state.snap, o);
  return `<div class="kpis">
    ${kpi('New leads', int(ov.leads), 'Demo, labor and container requests')}
    ${kpi('Estimates sent', int(ov.estimatesSent), `Proposal / change order sent · ${money(e.sentValue)}`)}
    ${kpi('Jobs won', int(ov.jobsWon), e.changeOrdersWon ? `+ ${int(e.changeOrdersWon)} change orders` : 'Demo, labor and containers')}
    ${kpi('Revenue booked', money(ov.revenue), 'Value of jobs and change orders won')}
    ${kpi('Win rate', pct(ov.winRate), `By dollars: ${pct(e.winRateValue)}`)}
    ${kpi('Median first response', mins(ov.medianResponse), `Business hours · ${pct(l.response.within60)} within 1 h`, ov.medianResponse > 240 ? 'warn' : '')}
    ${kpi('Containers out now', int(ov.containersOut), ov.fleet ? `${pct(ov.containerUtil)} of ${int(ov.fleet)} owned` : 'Set fleet size in Settings')}
    ${kpi('Crew utilization', pct(ov.crewUtil), `${int(cr.booked)} of ${int(cr.available)} crew-days booked`)}
  </div>
  <div class="grid">
    ${card(7, 'Action queue', 'Needs attention now (not filtered by period)', queueList(q.slice(0, 8)), q.length > 8 ? `${q.length - 8} more on the Leads tab.` : '')}
    ${card(5, 'New leads by day', '', barChart(l.daily.slice(-45).map(d => ({ label: d.date, value: d.count })), { format: v => int(v), labelFormat: shortDate }))}
    ${card(6, 'Win rate by service', 'Jobs won or lost in this period', winTable(e.byService, 'Service'))}
    ${card(6, 'Containers out by size', `${int(c.pastDue.length)} pickups past due (over ${c.rentalDays} days)`, containerSizeTable(c))}
  </div>`;
}

function queueList(items, { edit = false } = {}) {
  if (!items.length) return '<div class="empty">Nothing here. Nice.</div>';
  const admin = edit && state.viewer?.owner;
  const today = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  return items.map(i => {
    let status = '';
    if (i.override) status = `<div class="what">${i.override.action === 'snooze' ? `Snoozed until ${esc(shortDate(i.override.until))}` : i.override.action === 'done' ? 'Marked done' : 'Dismissed'} by ${esc(i.override.by)} · ${esc(when(i.override.at))}</div>`;
    if (i.readAt) status = `<div class="what">Read in GHL (conversation opened) · last message ${esc(when(i.readAt))}</div>`;
    if (i.snoozeEnded) status = `<div class="what">Snooze ended ${esc(shortDate(i.snoozeEnded))}</div>`;
    const data = `data-qkey="${esc(i.key)}" data-qbase="${esc(i.lastEventAt || '')}" data-qlabel="${esc(i.label + ': ' + i.name)}"`;
    const controls = !admin ? '' : i.override
      ? `<div class="q-actions"><button class="btn" type="button" data-qact="restore" ${data}>Restore</button></div>`
      : i.readAt ? '' : `<div class="q-actions"><button class="btn" type="button" data-qact="done" ${data}>Done</button><button class="btn" type="button" data-qact="dismiss" ${data}>Dismiss</button><label class="q-snooze">Snooze<input type="date" min="${today}" data-qact="snooze" ${data}></label></div>`;
    return `<div class="queue-item">${pill(i.label.split(' (')[0].split(',')[0], i.kind === 'missed-call' || i.kind === 'no-reply' ? 'crit' : 'warn')}
    <div><div>${link(i.link, i.kind === 'missed-call' && !i.contactId ? phone(i.name) : i.name)}${i.value ? ` · ${money(i.value)}` : ''}</div><div class="what">${esc(i.label)}${i.service ? ' · ' + esc(i.service) : ''}${i.owner ? ' · ' + esc(userName(i.owner)) : ''}</div>${status}${controls}</div>
    <div class="age">${i.kind === 'no-reply' || i.kind === 'estimate-overdue' ? busAge(i.ageMin) : mins(i.ageMin)}</div></div>`;
  }).join('');
}
async function queueAction(el, action, until) {
  try { state.overrides = await api('/api/queue', { method: 'POST', body: JSON.stringify({ key: el.dataset.qkey, action, until, baseline: el.dataset.qbase, label: el.dataset.qlabel }) }); render(); }
  catch (e) { alertBanner(e.message); }
}
document.addEventListener('click', e => { const b = e.target.closest('button[data-qact]'); if (b) queueAction(b, b.dataset.qact); });
document.addEventListener('change', e => { const d = e.target.closest('input[data-qact="snooze"]'); if (d && d.value) queueAction(d, 'snooze', `${d.value}T15:00:00Z`); });
async function loadOverrides() { try { state.overrides = await api('/api/queue'); } catch { state.overrides = state.overrides || {}; } }
const userName = id => state.snap?.users?.find(u => u.id === id)?.name || '';

function renderLeads() {
  const o = opts(), l = M.leadsSection(state.snap, o), calls = M.callsSection(state.snap, o), qs = M.queueState(state.snap, { ...o, overrides: state.overrides }), q = qs.active;
  const kinds = [['all', 'All'], ['missed-call', 'Missed calls'], ['no-reply', 'No reply'], ['estimate-overdue', 'Estimate overdue'], ['no-follow-up', 'No follow-up']];
  const extra = [['snoozed', 'Snoozed', qs.snoozed], ['closed', 'Done / dismissed', qs.closed], ['read', 'Read in GHL', qs.read]];
  const shown = state.queueKind === 'all' ? q : extra.find(x => x[0] === state.queueKind)?.[2] || q.filter(i => i.kind === state.queueKind);
  return `<div class="kpis">
    ${kpi('New leads', int(l.total), `${int(l.response.awaiting)} still waiting for a reply`)}
    ${kpi('Median first response', mins(l.response.median), 'Business hours, first human call / text / email')}
    ${kpi('Answered within 1 hour', pct(l.response.within60), `${int(l.response.eligible60)} leads counted`, l.response.within60 != null && l.response.within60 < 0.5 ? 'warn' : '')}
    ${kpi('Answered within 4 hours', pct(l.response.within240), 'Site promise: reply within a few hours')}
    ${kpi('Inbound calls', calls.available ? int(calls.total) : '—', calls.available ? `${int(calls.answered)} answered · ${int(calls.missed)} missed` : 'Twilio not connected')}
    ${kpi('Answer rate', pct(calls.answerRate), 'Inbound calls picked up', calls.answerRate != null && calls.answerRate < 0.8 ? 'warn' : '')}
    ${kpi('Missed, not called back', int(calls.notCalledBack), 'No outbound call to that number since', calls.notCalledBack ? 'crit' : 'good')}
    ${kpi('Callback time', mins(calls.calledBackMedianMin), `Median, missed calls · ${pct(calls.calledBackWithin60)} within 1 h`)}
  </div>
  <div class="grid">
    ${card(12, 'Lead funnel', 'Leads created in this period and where they are now · laborers never count', funnelHtml(M.leadFunnel(state.snap, o)))}
  </div><div style="height:14px"></div>
  <div class="grid">
    ${card(12, 'Action queue', `Leads with no reply, estimates overdue, proposals with no follow-up, missed calls not called back. ${state.viewer?.owner ? 'Done, Dismiss and Snooze hold until something new happens on that lead in GHL. ' : ''}Conversations opened (read) in GHL drop out on the next sync.`,
      `<div class="chips" id="queueChips">${kinds.map(([k, t]) => `<button type="button" data-kind="${k}" aria-pressed="${state.queueKind === k}">${t} (${k === 'all' ? q.length : q.filter(i => i.kind === k).length})</button>`).join('')}<span style="width:10px"></span>${extra.map(([k, t, l]) => `<button type="button" data-kind="${k}" aria-pressed="${state.queueKind === k}">${t} (${l.length})</button>`).join('')}</div>${queueList(shown.slice(0, 60), { edit: true })}`, shown.length > 60 ? `Showing 60 of ${shown.length}.` : '')}
    ${card(4, 'Leads by source', 'Repeat = they had a won job before', countTable(l.bySource))}
    ${card(4, 'Leads by service line', '', countTable(l.byService, { label: 'Service', valueCol: true }))}
    ${card(4, 'Leads by customer type', 'GHL contact type', countTable(l.byType, { label: 'Type' }))}
    ${card(6, 'New leads by day', '', barChart(l.daily.slice(-62).map(d => ({ label: d.date, value: d.count })), { format: v => int(v), labelFormat: shortDate }))}
    ${card(6, 'Inbound calls by hour', 'Pacific time', calls.available ? barChart(calls.byHour.map(h => ({ label: h.hour, tip: `${h.hour % 12 || 12} ${h.hour < 12 ? 'AM' : 'PM'}`, answered: h.answered, missed: h.missed })), { series: [{ key: 'answered', label: 'Answered' }, { key: 'missed', label: 'Missed' }], format: v => int(v), labelFormat: h => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}` }) : unavailable('Twilio', 'twilio'))}
    ${card(12, 'Missed calls', 'Newest first', table([
      { label: 'When', get: r => when(r.at) }, { label: 'Caller', html: r => r.contact ? link(state.idx.contactLink(r.contact.id), r.contact.name) : esc(phone(r.from)) },
      { label: 'Called back', html: r => r.calledBackAt ? `${esc(when(r.calledBackAt))} <span class="pill good">${mins((Date.parse(r.calledBackAt) - Date.parse(r.at)) / 60000)}</span>` : pill('Not yet', 'crit') }
    ], calls.missedList, { scroll: true, empty: 'No missed calls in this period.' }))}
    ${card(12, 'Raw lead sources', 'Exactly as GHL has them', countTable(l.byRawSource))}
  </div>`;
}

function renderEstimates() {
  const o = opts(), e = M.estimatesSection(state.snap, o);
  const maxStage = Math.max(0, ...e.byStage.map(s => s.value));
  return `<div class="kpis">
    ${kpi('Estimates sent', int(e.sent), money(e.sentValue))}
    ${kpi(`Sent within ${e.turnaround.days} business days`, pct(e.turnaround.withinDay), `Of opportunities created this period: ${int(e.turnaround.sent)} sent · ${int(e.turnaround.missed)} overdue · ${int(e.turnaround.pending)} still inside the window`, e.turnaround.withinDay != null && e.turnaround.withinDay < 0.8 ? 'warn' : '')}
    ${kpi('Median turnaround', mins(e.turnaround.median), 'Business hours, opportunity created to proposal sent')}
    ${kpi('Win rate', pct(e.winRate), `${int(e.won + e.changeOrdersWon)} won · ${int(e.lostCount)} lost`)}
    ${kpi('Win rate by dollars', pct(e.winRateValue), 'Won value ÷ decided value')}
    ${kpi('Revenue booked', money(e.revenue), 'Incl. change orders')}
    ${kpi('Open pipeline', money(e.openValue), 'All open job opportunities')}
    ${kpi('Lost', int(e.lostCount), e.lostReasons[0] ? `Top reason: ${esc(e.lostReasons[0].key)}` : '')}
  </div>
  <div class="grid">
    ${card(4, 'Win rate by service', '', winTable(e.byService, 'Service'))}
    ${card(4, 'Win rate by customer type', '', winTable(e.byType, 'Type'))}
    ${card(4, 'Win rate by lead source', '', winTable(e.bySource, 'Source'))}
    ${card(4, 'Average job value', 'Jobs won in this period', table([{ label: 'Service', get: r => r.key }, { label: 'Won', num: true, get: r => int(r.count) }, { label: 'Average', num: true, get: r => money(r.avg) }, { label: 'Total', num: true, get: r => money(r.value) }], e.avgByService))}
    ${card(8, 'Open pipeline by stage', 'Current, not filtered by period', table([{ label: 'Pipeline', get: r => r.pipeline }, { label: 'Stage', get: r => r.name }, { label: 'Open', num: true, get: r => int(r.count) }, { label: 'Value', html: r => barCell(r.value, maxStage, money(r.value)) }], e.byStage, { scroll: true }))}
    ${card(5, 'How long proposals have been waiting', 'Open opportunities sitting in Proposal Sent / Change Order Sent', barChart(e.aging.map(a => ({ label: a.key, value: a.count, tip: `${a.key} · ${money(a.value)}` })), { format: v => int(v) }))}
    ${card(7, 'Waiting longest', '', table([{ label: 'Customer', html: r => link(r.link, r.name) }, { label: 'Service', get: r => state.idx.serviceName(r.o.pipelineId) }, { label: 'Value', num: true, get: r => money(r.o.value) }, { label: 'Days waiting', num: true, get: r => dec(r.days) }], e.waiting, { scroll: true, empty: 'No proposals waiting.' }))}
    ${card(12, 'Lost reasons', 'Jobs marked lost in this period', table([{ label: 'Reason', get: r => r.key }, { label: 'Lost', html: r => barCell(r.count, Math.max(...e.lostReasons.map(x => x.count)), int(r.count)) }, { label: 'Value', num: true, get: r => money(r.value) }], e.lostReasons, { empty: 'Nothing lost in this period.' }))}
  </div>`;
}

function containerSizeTable(c) {
  return table([{ label: 'Size', get: r => r.size }, { label: 'Out now', num: true, get: r => int(r.out) }, { label: 'Owned', num: true, get: r => r.fleet ? int(r.fleet) : '—' }, { label: 'In yard', num: true, get: r => r.fleet ? int(Math.max(0, r.fleet - r.out)) : '—' }, { label: 'Utilization', num: true, get: r => r.fleet ? pct(r.out / r.fleet) : '—' }], c.bySize, { empty: 'No containers out.' });
}
function renderContainers() {
  const o = opts(), c = M.containersSection(state.snap, o);
  if (!c.available) return unavailable('The dispatch board', 'dispatch');
  return `<div class="kpis">
    ${kpi('Containers out now', int(c.out), c.fleet ? `${int(Math.max(0, c.fleet - c.out))} in the yard` : 'Set fleet size in Settings')}
    ${kpi('Utilization', pct(c.utilization), c.fleet ? `Out ÷ ${int(c.fleet)} owned` : 'Needs fleet size')}
    ${kpi('Pickups past due', int(c.pastDue.length), `Out more than ${c.rentalDays} days`, c.pastDue.length ? 'warn' : 'good')}
    ${kpi('Average rental', c.avgRental == null ? '—' : dec(c.avgRental) + ' days', `${int(c.closedRentals)} picked up this period`)}
    ${kpi('Drops', int(c.drops))}${kpi('Pickups', int(c.pickups))}${kpi('Swaps', int(c.swaps))}${kpi('Dump & returns', int(c.dumps))}
  </div>
  <div class="grid">
    ${card(4, 'Out by size', 'Counts containers, not yards', containerSizeTable(c))}
    ${card(8, 'Container runs per week', 'Last 12 weeks', barChart(c.weeks.map(w => ({ label: w.week, tip: 'Week of ' + shortDate(w.week), drops: w.drops, pickups: w.pickups, swaps: w.swaps, dumps: w.dumps })), { series: [{ key: 'drops', label: 'Drops' }, { key: 'pickups', label: 'Pickups' }, { key: 'swaps', label: 'Swaps' }, { key: 'dumps', label: 'Dump & return' }], format: v => int(v), labelFormat: shortDate }))}
    ${card(6, 'Pickups past due', `Out more than ${c.rentalDays} days`, table([{ label: 'Customer', get: r => r.client || r.key }, { label: 'Where', get: r => r.address }, { label: 'Size', get: r => r.size }, { label: 'Out since', get: r => shortDate(r.out) }, { label: 'Days', num: true, get: r => int(r.age) }], c.pastDue, { scroll: true, empty: 'Nothing past due.' }))}
    ${card(6, 'All containers out', '', table([{ label: 'Customer', get: r => r.client || r.key }, { label: 'Size', get: r => r.size }, { label: 'Out since', get: r => shortDate(r.out) }, { label: 'Days', num: true, get: r => int(r.age) }], c.openRentals, { scroll: true, empty: 'No containers out.' }))}
  </div>`;
}

function renderJobs() {
  const o = opts(), j = M.jobsSection(state.snap, o);
  if (!j.available) return unavailable('The dispatch board', 'dispatch');
  const maxLoads = Math.max(0, ...j.trucks.map(t => t.loads));
  return `<div class="kpis">
    ${kpi('Jobs scheduled', int(j.scheduled), j.scheduledByKind.map(k => `${int(k.count)} ${k.key.toLowerCase()}`).join(' · '))}
    ${kpi('Jobs completed', int(j.completed), j.cancelled ? `${int(j.cancelled)} cancelled` : '')}
    ${kpi('Finished on scheduled date', pct(j.onTimeRate), `${int(j.onTimeKnown)} completed jobs with a scheduled end`, j.onTimeRate != null && j.onTimeRate < 0.8 ? 'warn' : '')}
    ${kpi('Backlog', j.backlogWeeks == null ? '—' : dec(j.backlogWeeks) + ' weeks', j.backlogWeeks == null ? `${money(j.openValue)} booked · not enough finished work in the last 8 weeks to estimate pace` : `${money(j.openValue)} on the board ÷ ${money(j.avgWeeklyCompleted)}/week ${j.paceSource === 'invoiced' ? 'invoiced' : 'completed'}`)}
    ${kpi('Crew backlog', j.backlogWeeksCrew == null ? '—' : dec(j.backlogWeeksCrew) + ' weeks', `${int(j.futureCrewDays)} crew-days scheduled ahead`)}
    ${kpi('Loads per truck per day', dec(j.loadsPerTruckDay), `${dec(j.loads)} loads · ${int(j.truckDays)} truck-days`)}
    ${kpi('Revenue per truck-day', money(j.revenuePerTruckDay), 'Move value spread over its runs')}
    ${kpi('Open jobs', int(j.openJobs), j.staleCount ? `${int(j.staleCount)} more on the board look stale (${money(j.staleValue)}), not counted` : 'On the dispatch board, active in the last 60 days')}
  </div>
  <div class="grid">
    ${card(7, j.paceSource === 'invoiced' ? 'Invoiced per week' : 'Completed per week', `${j.paceSource === 'invoiced' ? 'Job value invoiced on the Ledger' : 'Job value closed as Completed on the board'} · last 8 weeks · this is the backlog pace`, barChart(j.weekly.map(w => ({ label: w.week, tip: `Week of ${shortDate(w.week)} · ${w.count} jobs`, value: w.value })), { format: (v, axis) => axis ? moneyShort(v) : money(v), labelFormat: shortDate }))}
    ${card(6, 'Backlog: jobs counted', `${int(j.openJobs)} jobs · ${money(j.openValue)} · biggest first. Value comes from the board, else GHL.`, table([{ label: 'Job', get: r => r.j.jobAddress || r.j.clientName || r.j.jobId }, { label: 'Type', get: r => r.kind }, { label: 'Last activity', get: r => shortDate(r.last) }, { label: 'Value', num: true, get: r => money(r.value) }], j.openRows, { scroll: true, empty: 'No open jobs on the board.' }))}
    ${card(6, 'On the board but stale', 'Nothing scheduled, logged or edited in 60 days and nothing ahead. Mark them Completed or Cancelled on the dispatch board (or move them in GHL) to clear them.', table([{ label: 'Job', get: r => r.j.jobAddress || r.j.clientName || r.j.jobId }, { label: 'Type', get: r => r.kind }, { label: 'Last activity', get: r => r.last ? shortDate(r.last) : 'Never' }, { label: 'Value', num: true, get: r => money(r.value) }], j.staleRows, { scroll: true, empty: 'Nothing stale.' }))}
    ${card(5, 'Late finishes', 'Completed after the scheduled end date', table([{ label: 'Job', get: r => r.j.jobAddress || r.j.clientName || r.j.jobId }, { label: 'Scheduled end', get: r => shortDate(r.planned) }, { label: 'Closed', get: r => shortDate(r.closed) }], j.late, { scroll: true, empty: 'Every completed job finished on time.' }))}
    ${card(12, 'Trucks', 'Logistics runs with a vehicle on them', table([{ label: 'Truck', get: r => r.name }, { label: 'Days used', num: true, get: r => int(r.days) }, { label: 'Loads', html: r => barCell(r.loads, maxLoads, dec(r.loads)) }, { label: 'Loads / day', num: true, get: r => dec(r.loadsPerDay) }, { label: 'Revenue / day', num: true, get: r => money(r.revenuePerDay) }], j.trucks, { empty: 'No truck runs in this period.' }), 'Grading and demo haul-offs only count when they are run as logistics moves with a truck assigned.')}
  </div>`;
}

function renderCrews() {
  const o = opts(), c = M.crewsSection(state.snap, o);
  return `<div class="kpis">
    ${kpi('Crew utilization', pct(c.utilization), 'Crew-days booked ÷ available, through today')}
    ${kpi('Crew-days booked', int(c.booked), 'Worker × day on a job')}
    ${kpi('Crew-days available', int(c.available), `${int(c.activeLaborers)} active laborers × ${int(c.workDays)} work days`)}
    ${kpi('Active laborers', int(c.activeLaborers), 'Temperature warm, hot or VIP')}
    ${kpi('Labor jobs won', int(c.laborWon), `${int(c.boardBooked)} booked on the board · ${int(c.elsewhere)} elsewhere`)}
    ${kpi('Booked online / GHL', pct(c.laborWon ? c.elsewhere / c.laborWon : null), 'Labor jobs not booked from the dispatch board')}
    ${kpi('Repeat-customer rate', pct(c.repeatRate), `${int(c.repeatCustomers)} of ${int(c.customers)} customers who booked`)}
    ${kpi('Sent-home hours', dec(c.sentHomeHours), 'Workers released early')}
  </div>
  <div class="grid">
    ${card(8, 'Next 14 days', 'Crew-days on the board vs. active laborers', barChart(c.ahead.map(d => ({ label: d.date, booked: d.booked, available: d.available })), { series: [{ key: 'booked', label: 'Booked' }, { key: 'available', label: 'Available' }], stacked: false, format: v => int(v), labelFormat: shortDate }))}
    ${card(4, 'Repeat customers by type', 'Customers with a job won in this period', table([{ label: 'Type', get: r => r.key }, { label: 'Customers', num: true, get: r => int(r.count) }, { label: 'Repeat', num: true, get: r => int(r.repeat) }, { label: 'Rate', num: true, get: r => pct(r.rate) }], c.repeatByType))}
    ${card(6, 'Most booked workers', 'Days on a job this period', table([{ label: 'Worker', get: r => r.name }, { label: 'Days', html: r => barCell(r.days, c.topWorkers[0]?.days || 0, int(r.days)) }], c.topWorkers))}
    ${card(6, 'How labor jobs were booked', 'Labor jobs won this period', table([{ label: 'Booked', get: r => r.k }, { label: 'Jobs', html: r => barCell(r.n, c.laborWon, int(r.n)) }], [{ k: 'On the dispatch board', n: c.boardBooked }, { k: 'Online or directly in GHL', n: c.elsewhere }]), 'Booked on the board = created with Book Job. Everything else in the Labor pipeline counts as online / GHL.')}
  </div>`;
}

function renderHiring() {
  const o = opts(), h = M.hiringSection(state.snap, o);
  return `<div class="kpis">
    ${kpi('Applicants', int(h.applicants), 'New in the hiring pipeline')}
    ${kpi('Hire rate', pct(h.hireRate), `${int(h.hiredFromApplicants)} of this period's applicants are warm / hot / VIP`)}
    ${kpi('Hires', int(h.hires), 'Turned warm, hot or VIP this period')}
    ${kpi('Days to hire', h.medianDaysToHire == null ? '—' : dec(h.medianDaysToHire), 'Median, applied to hired')}
    ${kpi('Labor pool', int(h.pool), 'Contacts typed Laborer')}
    ${kpi('Active', int(h.active), 'Warm, hot or VIP', 'good')}
    ${kpi('Dormant', int(h.dormant), 'Cold')}
    ${kpi('Active and booked (30 days)', int(h.booked30), `${int(h.active - h.booked30)} active not booked`)}
  </div>
  <div class="grid">
    ${card(8, 'Applicants and hires by month', 'Last 12 months', barChart(h.monthly.map(m => ({ label: m.month, applicants: m.applicants, hires: m.hires })), { series: [{ key: 'applicants', label: 'Applicants' }, { key: 'hires', label: 'Hires' }], stacked: false, format: v => int(v), labelFormat: monthLabel }), h.baselineHires ? `${int(h.baselineHires)} laborers were already warm / hot / VIP when tracking started; they count in the pool but have no hire date.` : '')}
    ${card(4, 'Labor pool by temperature', '', table([{ label: 'Temperature', get: r => r.key }, { label: 'Laborers', html: r => barCell(r.count, h.pool, int(r.count)) }], h.byTemp))}
    ${card(4, 'Open applicants by stage', 'Hiring pipeline, now', table([{ label: 'Stage', get: r => r.key }, { label: 'Open', num: true, get: r => int(r.count) }], h.openByStage, { empty: 'No open applicants.' }))}
    ${card(4, 'Retention', 'Hires still getting booked', table([{ label: 'After', get: r => r.k }, { label: 'Hires', num: true, get: r => int(r.v.cohort) }, { label: 'Still booked', num: true, get: r => int(r.v.kept) }, { label: 'Rate', num: true, get: r => pct(r.v.rate) }], [{ k: '30 days', v: h.retention30 }, { k: '60 days', v: h.retention60 }]))}
    ${card(4, 'Active but not booked in 30 days', '', table([{ label: 'Laborer', html: r => link(r.link, r.name) }, { label: 'Temp', get: r => M.tempLabel(r.temp) }, { label: 'Last booked', get: r => r.last ? shortDate(r.last) : 'Never' }], h.activeNotBooked, { scroll: true, empty: 'Everyone active was booked.' }))}
  </div>`;
}

function renderMoney() {
  const o = opts(), m = M.moneySection(state.snap, o);
  if (!m.available) return unavailable('The Ledger', 'ledger');
  return `<div class="kpis">
    ${kpi('Invoiced', money(m.invoiced), `${int(m.invoicedCount)} invoices sent`)}
    ${kpi('Collected', money(m.collected), `${int(m.collectedCount)} invoices paid`)}
    ${kpi('Owed to A2Z', money(m.arOutstanding), `${money(m.arOverdue)} overdue`, m.arOverdue > 0 ? 'warn' : '')}
    ${kpi('Days sales outstanding', m.dso == null ? '—' : dec(m.dso), 'Owed ÷ average daily invoicing (90 days)')}
    ${kpi('Days to get paid', m.daysToPaid == null ? '—' : dec(m.daysToPaid), 'Median, sent to paid')}
    ${kpi('Cost of revenue', money(m.costOfRevenue), `Incl. ${money(m.payroll)} BBSI payroll`)}
    ${kpi('Gross margin', pct(m.grossMargin), `${money(m.grossProfit)} on invoiced work`, m.grossMargin != null && m.grossMargin < 0.25 ? 'warn' : '')}
    ${kpi('Bills unpaid', money(m.apOutstanding), `${money(m.apOverdue)} past due`)}
  </div>
  <div class="grid">
    ${card(8, 'Invoiced vs. collected', 'Last 12 months', barChart(m.monthly.map(x => ({ label: x.month, invoiced: x.invoiced, collected: x.collected })), { series: [{ key: 'invoiced', label: 'Invoiced' }, { key: 'collected', label: 'Collected' }], stacked: false, format: (v, axis) => axis ? moneyShort(v) : money(v), labelFormat: monthLabel }))}
    ${card(4, 'Owed by customer', 'Sent + overdue invoices', table([{ label: 'Customer', get: r => r.key }, { label: 'Owed', num: true, get: r => money(r.value) }, { label: 'Overdue', num: true, html: r => r.overdue ? `<span style="color:var(--crit)">${money(r.overdue)}</span>` : '—' }], m.arByClient, { empty: 'Nothing owed.' }))}
    ${card(5, 'Costs by category', 'Bills dated this period', table([{ label: 'Category', get: r => r.key }, { label: 'Type', html: r => r.cor ? pill('Job cost') : pill('Overhead') }, { label: 'Amount', num: true, get: r => money(r.value) }], m.costByCategory))}
    ${card(7, 'Job margins', 'Completed jobs: EOD sheet cost vs. invoice (or job value)', table([{ label: 'Job', get: r => r.name }, { label: 'Revenue', num: true, get: r => money(r.revenue) }, { label: 'Cost', num: true, get: r => money(r.cost) }, { label: 'Margin', num: true, html: r => `<span style="color:${r.pct != null && r.pct < 0.2 ? 'var(--crit)' : 'inherit'}">${pct(r.pct)}</span>` }, { label: '', html: r => r.invoiced ? '' : pill('Not invoiced', 'warn') }], m.margins, { scroll: true, empty: 'No completed jobs with an EOD sheet in this period.' }), 'Lowest margin first. Margins only cover what is on the EOD sheets.')}
  </div>`;
}

const FEED_LABELS = { ghl: 'GHL (opportunities, contacts)', conversations: 'GHL conversations (reply times)', twilio: 'Twilio (calls)', dispatch: 'Dispatch board', ledger: 'Ledger', webhook: 'GHL stage webhook (optional)' };
function renderQuality() {
  const dq = M.dataQuality(state.snap, { now: Date.now() });
  const feeds = Object.entries(FEED_LABELS).map(([k, label]) => {
    const f = dq.feeds[k] || {};
    const tone = f.ok ? 'good' : f.optional ? '' : 'crit';
    const counts = f.counts ? Object.entries(f.counts).map(([n, v]) => `${n}: ${int(v)}`).join(' · ') : '';
    const extra = [counts, f.answerMode ? `answer detection: ${f.answerMode === 'forwarding' ? 'forwarded leg connected' : 'call length'}` : '', f.error || ''].filter(Boolean).join(' · ');
    return `<div class="feed"><span class="name">${esc(label)}</span>${pill(f.ok ? 'OK' : f.optional ? 'Not set up' : 'Problem', tone)}<span class="detail">Last success ${esc(ago(f.at))}${extra ? ' · ' + esc(extra) : ''}</span></div>`;
  }).join('');
  const checks = table([{ label: 'Area', get: r => r.area }, { label: 'Check', html: r => `${esc(r.label)}<div style="font-size:11.5px;color:var(--muted)">${esc(r.help)}</div>` }, { label: 'Count', num: true, html: r => r.severity === 'ok' ? pill('0', 'good') : pill(`${int(r.bad)}${r.total > 1 ? ' of ' + int(r.total) : ''}`, r.severity === 'crit' ? 'crit' : r.severity === 'info' ? '' : 'warn') }], dq.checks);
  const defs = [
    ['Lead', 'An opportunity created in the Demo, Labor or Containers pipeline. Laborers never count: contact type Laborer, anyone in the hiring pipeline, or anyone on the dispatch labor roster. Change orders are not leads.'],
    ['Lead source', 'Opportunity source, else contact source. "Repeat customer" = that contact already had a won job.'],
    ['First response', 'First human outbound touch to the contact: a Twilio call, or an SMS / email / call in GHL conversations (workflow and bulk messages excluded), or an answered inbound call from them. Touches up to 1 hour before the lead was created count (the call that created it). Measured in business hours.'],
    ['Inbound calls', 'Twilio calls into A2Z numbers. Answered = the forwarded leg connected (or, with no forwarding, the call lasted the minimum seconds). Called back = any later outbound Twilio call to that number.'],
    ['Estimate sent', 'The opportunity entered Proposal Sent (Change Order Sent for change orders). Stage history is recorded by this dashboard from ' + (dq.history.stageTrackingSince ? shortDate(dq.history.stageTrackingSince) : 'its first sync') + '; earlier proposals use GHL\'s last stage change.'],
    ['Sent within / turnaround', 'Opportunities created in the period: share whose proposal was sent within the business-day target (3 by default, Settings) of the opportunity being created. Still-open ones past the target count as misses; ones still inside it, or closed without a proposal, are left out. Turnaround = business hours from creation to Proposal Sent.'],
    ['Action queue edits', 'Admins can mark an item Done, Dismiss it or Snooze it to a date. The edit holds until GHL shows something new on that lead or caller (a call, text, email, stage or status change); then the item comes back if it still applies. A conversation opened (read) in GHL also takes its item out of the queue.'],
    ['Jobs won / revenue booked', 'Opportunities marked Won, dated by GHL\'s status change. Revenue = their value. Win rate = won ÷ (won + lost) decided in the period.'],
    ['Containers out', 'Container drops minus pickups per customer from the dispatch board\'s runs (Reset day / Complete). Swaps and dump & returns keep the count. Quantity, not yards.'],
    ['Crew utilization', 'Crew-days on jobs (each worker each day, from Complete EOD Sheet logs plus scheduled days) ÷ active laborers × work days, up to today.'],
    ['Hired / active', 'A laborer whose temperature is warm, hot or VIP. Cold = dormant. Hire date = the first sync that saw them warm or above.'],
    ['Money', 'From the Ledger: invoiced = left Draft (invoice date), collected = moved to Paid, owed = Sent + Overdue. Job cost categories and BBSI payroll are cost of revenue.']
  ];
  return `<div class="grid">
    ${card(5, 'Data feeds', `Snapshot built ${esc(ago(state.snap.builtAt))}. Syncs every ~30 minutes, or on Refresh.`, feeds)}
    ${card(7, 'Coverage checks', '', checks)}
    ${card(6, 'Detected settings', '', `<dl class="defs">
      <dt>Estimate-sent stages</dt><dd>${dq.proposalStages.length ? dq.proposalStages.map(s => esc(`${s.pipeline}: ${s.name}`)).join('<br>') : '<span style="color:var(--crit)">None found</span>'}</dd>
      <dt>Contact type read from</dt><dd>${esc(dq.config.contactTypeSource || '—')}</dd>
      <dt>Customer types</dt><dd>${esc((dq.config.customerTypes || []).map(M.typeLabel).join(', '))}</dd>
      <dt>Business hours</dt><dd>${esc(dq.settings.businessHours.open)}–${esc(dq.settings.businessHours.close)}, ${esc(dq.settings.workdays.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(' '))}</dd>
      <dt>Containers owned</dt><dd>${esc(Object.entries(dq.settings.containerFleet).filter(([, n]) => n).map(([k, n]) => `${n} × ${k}`).join(', ') || 'Not set')}</dd>
      <dt>Stage history since</dt><dd>${esc(dq.history.stageTrackingSince ? shortDate(dq.history.stageTrackingSince) : '—')}</dd></dl>`)}
    ${card(6, 'How each number is counted', '', `<dl class="defs">${defs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`)}
  </div>`;
}

// ---------- lead funnel (same shape as the LCP acquisition funnel) ----------
let funnelAnimated = false;
function funnelHtml(f) {
  const defs = {
    leads: ['New leads', 'Demo, labor and container requests created in the period'],
    responded: ['Responded', 'A human call, text or email reached them'],
    estimate: ['Estimate sent', 'Reached Proposal Sent (or was won)'],
    won: ['Won', 'Marked won in GHL, any time since']
  };
  const palette = [['#fed7aa', '#431407'], ['#fdba74', '#431407'], ['#ea580c', '#fff'], ['#9a3412', '#fff']];
  const top = Math.max(1, f.stages[0].count);
  const widthOf = v => Math.max(0.1, Math.sqrt(Math.max(0, v) / top));
  const rows = f.stages.map((st, i) => ({ ...st, i, width: widthOf(st.count), color: palette[i] }));
  const parts = [];
  rows.forEach((r, i) => {
    const [label, note] = defs[r.key];
    const share = i ? (f.stages[0].count ? r.count / f.stages[0].count : null) : 1;
    const out = `<b>${pct(share)}</b><span>${i ? 'of new leads' : 'of new leads'}${r.value ? ' · ' + moneyShort(r.value) : ''}</span>`;
    parts.push(`<div class="fn-label" title="${esc(note)}"><b>${label}</b><span>${esc(note)}</span></div>`
      + `<div class="fn-track"><div class="fn-bar" style="--w:${(r.width * 100).toFixed(1)}%;--c:${r.color[0]};--ink:${r.color[1]}" title="${esc(`${label}: ${int(r.count)} · ${money(r.value)}`)}">${int(r.count)}</div></div>`
      + `<div class="fn-out">${out}</div>`);
    const next = rows[i + 1];
    if (next) {
      const a = r.width * 50, b = next.width * 50, step = r.count ? next.count / r.count : null;
      parts.push(`<div></div><div class="fn-gap"><div class="fn-joint" style="--c:${next.color[0]};clip-path:polygon(${50 - a}% 0,${50 + a}% 0,${50 + b}% 100%,${50 - b}% 100%)"></div>${step != null && step <= 1 ? `<span class="fn-step">↓ ${pct(step)}</span>` : ''}</div><div></div>`);
    }
  });
  const [L, R, E, W] = f.stages;
  const summary = `<div class="fn-summary">
    <span>Lead → won <b>${pct(L.count ? W.count / L.count : null)}</b></span>
    <span>Estimate → won <b>${pct(E.count ? W.count / E.count : null)}</b></span>
    <span>Replied within 4 business hours <b>${pct(L.count ? f.quick / L.count : null)}</b></span>
    <span>Median first response <b>${mins(f.medianResponse)}</b></span>
    <span>Still open <b>${int(f.open)}</b> · lost <b>${int(f.lost)}</b></span>
  </div><p class="note">Band widths use a square-root scale so small stages stay readable; hover a band for exact numbers.</p>`;
  const html = `<div class="fn${funnelAnimated ? '' : ' fn-anim'}">${parts.join('')}</div>${summary}`;
  funnelAnimated = true;
  return html;
}

// ---------- users (admins) ----------
const ROLE_LABEL = { senior: 'Senior admin', admin: 'Admin', viewer: 'Viewer' };
function renderUsers() {
  const a = state.access;
  if (!a) { loadAccess(); return '<div class="empty">Loading users…</div>'; }
  const senior = a.me.role === 'senior';
  const listed = new Set([...a.users.map(u => u.email), ...a.seniors]);
  const pickable = a.ghlUsers.filter(u => !listed.has(u.email)).sort((x, y) => x.name.localeCompare(y.name));
  const roleSelect = (u) => senior ? `<select data-role-for="${esc(u.email)}"><option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>Viewer</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option></select>` : esc(ROLE_LABEL[u.role]);
  const rows = [
    ...a.seniors.map(e => ({ email: e, name: a.ghlUsers.find(u => u.email === e)?.name || e, role: 'senior', fixed: true })),
    ...a.users
  ];
  const canRemove = u => !u.fixed && (senior || u.role !== 'admin');
  return `<div class="grid">
    ${card(8, 'Who can open the dashboard', 'Viewers see everything except Money, Settings and Users. Admins also see those and add or remove viewers. Only senior admins add or remove admins.',
      table([{ label: 'Name', get: r => r.name }, { label: 'Email', get: r => r.email },
        { label: 'Role', html: r => r.fixed ? pill('Senior admin', 'good') : (r.role === 'admin' && !senior ? pill('Admin') : roleSelect(r)) },
        { label: 'Added', get: r => r.fixed ? 'Built in' : `${r.addedBy || ''}${r.addedAt ? ' · ' + shortDate(r.addedAt) : ''}` },
        { label: '', html: r => canRemove(r) ? `<button class="btn" type="button" data-remove="${esc(r.email)}">Remove</button>` : '' }], rows),
      'A PIN sign-in is always viewer level, even for admins. Changes apply within about 20 seconds.')}
    ${card(4, 'Add someone', 'Pick a GHL user, or type an email', `
      <div class="field"><label for="addUserPick">GHL user</label><select id="addUserPick" style="width:100%;padding:7px 9px;border:1px solid var(--border);border-radius:8px;background:var(--surface)"><option value="">Choose…</option>${pickable.map(u => `<option value="${esc(u.email)}" data-name="${esc(u.name)}">${esc(u.name)} (${esc(u.email)})</option>`).join('')}</select></div>
      <div class="field"><label for="addUserEmail">or email</label><input id="addUserEmail" type="email" placeholder="name@a2zcs.net"></div>
      <div class="field"><label for="addUserRole">Role</label><select id="addUserRole" style="width:100%;padding:7px 9px;border:1px solid var(--border);border-radius:8px;background:var(--surface)"><option value="viewer">Viewer</option>${senior ? '<option value="admin">Admin</option>' : ''}</select></div>
      <div class="error" id="usersError"></div>
      <button class="btn primary" type="button" id="addUserBtn">Add</button>`)}
    ${card(6, 'Asked for access', 'People who opened the dashboard in GHL but are not on the list', table([{ label: 'Name', get: r => r.name }, { label: 'Email', get: r => r.email }, { label: 'When', get: r => when(r.at) }, { label: '', html: r => `<button class="btn primary" type="button" data-grant="${esc(r.email)}" data-name="${esc(r.name)}">Add as viewer</button> <button class="btn" type="button" data-dismiss="${esc(r.email)}">Dismiss</button>` }], a.requests, { empty: 'No requests.' }))}
    ${senior ? card(6, 'Recent changes', 'Senior admins only', table([{ label: 'When', get: r => when(r.at) }, { label: 'Who', get: r => r.by }, { label: 'Change', get: r => `${r.action.replace('_', ' ')} ${r.email}${r.role ? ' (' + r.role + ')' : ''}` }], a.log || [], { empty: 'No changes yet.' })) : ''}
  </div>`;
}
async function loadAccess() { try { state.access = await api('/api/access'); render(); } catch (e) { alertBanner(e.message); } }
async function changeAccess(body) {
  try { await api('/api/access', { method: 'POST', body: JSON.stringify(body) }); state.access = await api('/api/access'); render(); }
  catch (e) { const el = $('usersError'); if (el) el.textContent = e.message; else alertBanner(e.message); }
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-remove],[data-grant],[data-dismiss],#addUserBtn');
  if (!t) return;
  if (t.id === 'addUserBtn') {
    const pick = $('addUserPick'), opt = pick.selectedOptions[0];
    const email = ($('addUserEmail').value || pick.value).trim();
    if (!email) { $('usersError').textContent = 'Choose a GHL user or type an email.'; return; }
    changeAccess({ action: 'add', email, name: $('addUserEmail').value ? email : opt?.dataset.name || email, role: $('addUserRole').value });
  }
  if (t.dataset.remove && confirm(`Remove ${t.dataset.remove}?`)) changeAccess({ action: 'remove', email: t.dataset.remove });
  if (t.dataset.grant) changeAccess({ action: 'add', email: t.dataset.grant, name: t.dataset.name, role: 'viewer' });
  if (t.dataset.dismiss) changeAccess({ action: 'dismiss_request', email: t.dataset.dismiss });
});
document.addEventListener('change', e => { const s = e.target.closest('[data-role-for]'); if (s) changeAccess({ action: 'set_role', email: s.dataset.roleFor, role: s.value }); });

// ---------- shell ----------
function renderShell() {
  const tabs = TABS.filter(t => !t.owner || state.viewer?.owner);
  if (!tabs.some(t => t.id === state.tab)) state.tab = 'overview';
  $('tabs').innerHTML = tabs.map(t => `<button class="tab" role="tab" type="button" data-tab="${t.id}" aria-selected="${t.id === state.tab}">${esc(t.label)}</button>`).join('');
  $('periodSeg').innerHTML = M.PERIODS.map(p => `<button type="button" data-period="${p.id}" aria-pressed="${p.id === state.period}">${p.label}</button>`).join('');
  const users = (state.snap?.users || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  $('repSelect').innerHTML = `<option value="">All reps</option>${users.map(u => `<option value="${esc(u.id)}" ${u.id === state.rep ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}`;
  $('settingsBtn').hidden = !state.viewer?.owner;
  $('who').innerHTML = state.viewer ? `${esc(state.viewer.name)} <span class="role-badge">${esc((ROLE_LABEL[state.viewer.role] || '').toUpperCase())}</span>` : '';
}
function render() {
  if (!state.snap) { $('view').innerHTML = '<div class="banner">No data yet. The first sync runs within 15 minutes of deploy, or click Refresh live data.</div>'; return; }
  state.idx = M.buildIndex(state.snap);
  renderShell();
  const o = opts();
  $('rangeLabel').textContent = o.range.from === o.range.to ? shortDate(o.range.from) : `${shortDate(o.range.from)} – ${shortDate(o.range.to)}`;
  $('freshness').textContent = `Updated ${ago(state.snap.builtAt)}`;
  const banners = [];
  if (state.snap.sample) banners.push('<div class="banner"><b>Sample data.</b> Every name and number on this page is made up (local sandbox).</div>');
  const broken = Object.entries(state.snap.feeds || {}).filter(([k, f]) => !f.ok && !f.optional && FEED_LABELS[k]);
  if (broken.length) banners.push(`<div class="banner crit">${broken.map(([k]) => esc(FEED_LABELS[k])).join(', ')}: last pull failed or not set up. Numbers from ${broken.length > 1 ? 'those sources' : 'it'} may be stale. See Data Quality.</div>`);
  if (state.rep) banners.push(`<div class="banner">Filtered to <b>${esc(userName(state.rep))}</b>: leads, estimates and wins only. Containers, jobs, crews and hiring always show the whole company.</div>`);
  $('banners').innerHTML = banners.join('');
  const tab = TABS.find(t => t.id === state.tab) || TABS[0];
  try { $('view').innerHTML = `<div role="tabpanel">${tab.render()}</div>`; }
  catch (e) { console.error(e); $('view').innerHTML = `<div class="banner crit">This tab could not be drawn: ${esc(e.message)}</div>`; }
}

// ---------- data + auth ----------
async function api(path, options = {}) {
  const token = store.get(TOKEN_KEY);
  const res = await fetch(path, { ...options, headers: { ...(options.headers || {}), ...(token ? { 'x-kpi-session': token } : {}), ...(options.body ? { 'content-type': 'application/json' } : {}) } });
  if (res.status === 304) return { notModified: true };
  let body = {}; try { body = await res.json(); } catch {}
  if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status });
  return body;
}
async function load() {
  const data = await api('/api/dashboard-data', { headers: state.etag ? { 'if-none-match': state.etag } : {} });
  if (data.notModified) return false;
  const changed = data.snapshot?.builtAt !== state.snap?.builtAt;
  state.snap = data.snapshot; state.viewer = data.viewer; state.status = data.status; state.etag = data.snapshot ? `"${data.snapshot.builtAt}-${data.viewer.role}"` : '';
  return changed;
}
// Ask GHL (the Custom Page host) for the logged-in user. GHL can be slow to start
// listening, and the page can sit one frame deeper than expected, so ask the
// parent and the top window every second for up to 15 s. The answer is encrypted
// and checked on the server, so accepting it from either frame is safe.
const ghlDiag = { asked: 0, seen: [] };
addEventListener('message', e => { if (ghlDiag.seen.length < 8) ghlDiag.seen.push(`${e.origin || '?'} → ${typeof e.data === 'object' ? JSON.stringify(Object.keys(e.data || {})) + ' ' + (e.data?.message || e.data?.type || '') : String(e.data).slice(0, 60)}`); });
function diagText() {
  let top = 'blocked'; try { top = window.top === window ? 'not embedded' : 'embedded'; } catch {}
  return `Frame: ${window.parent === window ? 'not embedded' : 'embedded'} · opened from: ${document.referrer ? new URL(document.referrer).origin : 'unknown'} · requests sent: ${ghlDiag.asked} · messages received: ${ghlDiag.seen.length ? ghlDiag.seen.join(' | ') : 'none'}`;
}
function askGhl() {
  return new Promise((resolve, reject) => {
    const targets = [...new Set([window.parent, window.top].filter(w => w && w !== window))];
    let timer;
    const done = () => { clearInterval(timer); clearTimeout(stop); removeEventListener('message', on); };
    function on(e) {
      if (!targets.includes(e.source) || e.data?.message !== 'REQUEST_USER_DATA_RESPONSE' || !e.data.payload) return;
      done(); resolve(e.data.payload);
    }
    const ask = () => { ghlDiag.asked++; targets.forEach(w => { try { w.postMessage({ message: 'REQUEST_USER_DATA' }, '*'); } catch {} }); };
    const stop = setTimeout(() => { done(); reject(new Error('GHL did not send your user. Open the dashboard from the A2Z Dashboard app menu item (a Custom Page of the Marketplace app), not a custom menu link.')); }, 15000);
    addEventListener('message', on);
    ask(); timer = setInterval(ask, 1000);
  });
}
async function signIn() {
  $('app').hidden = true; $('signin').hidden = false;
  if (window.parent !== window) {
    try { const enc = await askGhl(); const r = await api('/api/session', { method: 'POST', body: JSON.stringify({ action: 'ghl', encryptedData: enc }) }); store.set(TOKEN_KEY, r.token); return; }
    catch (e) { $('signinMsg').textContent = e.message; $('signinDiag').textContent = diagText(); $('signinDiag').hidden = false; }
  } else $('signinMsg').textContent = 'Open this dashboard from its menu item in GHL, or sign in with your GHL email and the dashboard PIN.';
  $('pinForm').hidden = false;
  await new Promise(resolve => {
    $('pinForm').onsubmit = async ev => {
      ev.preventDefault(); $('pinError').textContent = '';
      try { const r = await api('/api/session', { method: 'POST', body: JSON.stringify({ action: 'pin', email: $('pinEmail').value, pin: $('pinCode').value }) }); store.set(TOKEN_KEY, r.token); resolve(); }
      catch (e) { $('pinError').textContent = e.message; $('pinCode').value = ''; }
    };
  });
}
async function boot() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await load(); break; }
    catch (e) { if (e.status === 401 || e.status === 403) { store.del(TOKEN_KEY); await signIn(); continue; } $('signin').hidden = false; $('signinMsg').textContent = 'Could not load the dashboard: ' + e.message; return; }
  }
  $('signin').hidden = true; $('app').hidden = false;
  await loadOverrides();
  render();
  setInterval(async () => { if (document.hidden || state.refreshing) return; try { await loadOverrides(); if (await load() || state.tab === 'leads' || state.tab === 'overview') render(); else $('freshness').textContent = `Updated ${ago(state.snap?.builtAt)}`; } catch {} }, 5 * 60000);
}

// ---------- events ----------
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab],[data-period],[data-kind]');
  if (!t) return;
  if (t.dataset.tab) { state.tab = t.dataset.tab; store.set('kpi-tab', state.tab); if (t.dataset.tab === 'users') state.access = null; }
  if (t.dataset.period) { state.period = t.dataset.period; store.set('kpi-period', state.period); }
  if (t.dataset.kind) state.queueKind = t.dataset.kind;
  render();
});
$('repSelect').addEventListener('change', e => { state.rep = e.target.value; store.set('kpi-rep', state.rep); render(); });
$('refreshBtn').addEventListener('click', async () => {
  const btn = $('refreshBtn'); btn.disabled = true; btn.textContent = 'Refreshing…'; state.refreshing = true;
  const before = state.snap?.builtAt;
  try {
    await api('/api/refresh', { method: 'POST', body: '{}' });
    for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 10000)); if (await load() && state.snap?.builtAt !== before) break; }
    render();
  } catch (e) { alertBanner(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Refresh live data'; state.refreshing = false; }
});
function alertBanner(msg) { $('banners').insertAdjacentHTML('afterbegin', `<div class="banner crit">${esc(msg)}</div>`); }
function applyTheme(theme) { if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme; const dark = theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; $('themeBtn').textContent = dark ? 'Light mode' : 'Dark mode'; }
applyTheme(store.get('kpi-theme'));
$('themeBtn').addEventListener('click', () => { const dark = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark'; const next = dark ? 'light' : 'dark'; store.set('kpi-theme', next); applyTheme(next); });

// Settings (owners)
$('settingsBtn').addEventListener('click', () => {
  const s = state.snap?.settings || {};
  const fleet = { '10 Yard': 0, '20 Yard': 0, '30 Yard': 0, '40 Yard': 0, ...(s.containerFleet || {}) };
  $('fleetRows').innerHTML = Object.entries(fleet).map(([k, v]) => `<div><label for="fleet-${esc(k)}">${esc(k)}</label><input type="number" min="0" max="10000" id="fleet-${esc(k)}" data-size="${esc(k)}" value="${Number(v) || 0}"></div>`).join('');
  $('rentalDays').value = s.rentalDays ?? 7; $('followUpDays').value = s.followUpDays ?? 3; $('estimateDays').value = s.estimateDays ?? 3;
  $('openTime').value = s.businessHours?.open || '07:00'; $('closeTime').value = s.businessHours?.close || '17:00';
  const wd = new Set(s.workdays || [1, 2, 3, 4, 5, 6]);
  $('workdays').innerHTML = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => `<label><input type="checkbox" value="${i}" ${wd.has(i) ? 'checked' : ''}>${d}</label>`).join('');
  $('settingsError').textContent = '';
  $('settingsDialog').showModal();
});
$('settingsSave').addEventListener('click', async () => {
  const body = {
    containerFleet: Object.fromEntries([...document.querySelectorAll('#fleetRows input')].map(i => [i.dataset.size, Number(i.value) || 0])),
    rentalDays: Number($('rentalDays').value), followUpDays: Number($('followUpDays').value), estimateDays: Number($('estimateDays').value),
    businessHours: { open: $('openTime').value, close: $('closeTime').value },
    workdays: [...document.querySelectorAll('#workdays input:checked')].map(i => Number(i.value))
  };
  try { const r = await api('/api/settings', { method: 'POST', body: JSON.stringify(body) }); state.snap = { ...state.snap, settings: r.settings }; state.etag = ''; $('settingsDialog').close(); render(); }
  catch (e) { $('settingsError').textContent = e.message; }
});
attachTooltips(document.body, $('tooltip'));
boot();
