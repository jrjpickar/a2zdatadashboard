import * as M from './metrics.js';
import { barChart, barCell, attachTooltips, esc } from './charts.js';

const $ = id => document.getElementById(id);
const TOKEN_KEY = 'a2z-kpi-token';
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} }, del(k) { try { localStorage.removeItem(k); } catch {} } };
const state = { snap: null, viewer: null, status: null, etag: '', period: store.get('kpi-period') || 'mtd', rep: store.get('kpi-rep') || '', tab: store.get('kpi-tab') || 'overview', queueKind: 'all', refreshing: false };

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
  { id: 'quality', label: 'Data Quality', render: renderQuality }
];
function opts() {
  const tz = state.snap?.config?.timeZone || 'America/Los_Angeles';
  return { range: M.periodRange(state.period, Date.now(), tz), rep: state.rep, now: Date.now() };
}

function renderOverview() {
  const o = opts(), ov = M.overview(state.snap, o), e = M.estimatesSection(state.snap, o), l = M.leadsSection(state.snap, o), q = M.actionQueue(state.snap, o), c = M.containersSection(state.snap, o), cr = M.crewsSection(state.snap, o);
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

function queueList(items) {
  if (!items.length) return '<div class="empty">Nothing waiting. Nice.</div>';
  return items.map(i => `<div class="queue-item">${pill(i.label.split(' (')[0].split(',')[0], i.kind === 'missed-call' || i.kind === 'no-reply' ? 'crit' : 'warn')}
    <div><div>${link(i.link, i.kind === 'missed-call' && !i.contactId ? phone(i.name) : i.name)}${i.value ? ` · ${money(i.value)}` : ''}</div><div class="what">${esc(i.label)}${i.service ? ' · ' + esc(i.service) : ''}${i.owner ? ' · ' + esc(userName(i.owner)) : ''}</div></div>
    <div class="age">${i.kind === 'no-reply' || i.kind === 'estimate-overdue' ? busAge(i.ageMin) : mins(i.ageMin)}</div></div>`).join('');
}
const userName = id => state.snap?.users?.find(u => u.id === id)?.name || '';

function renderLeads() {
  const o = opts(), l = M.leadsSection(state.snap, o), calls = M.callsSection(state.snap, o), q = M.actionQueue(state.snap, o);
  const kinds = [['all', 'All'], ['missed-call', 'Missed calls'], ['no-reply', 'No reply'], ['estimate-overdue', 'Estimate overdue'], ['no-follow-up', 'No follow-up']];
  const shown = state.queueKind === 'all' ? q : q.filter(i => i.kind === state.queueKind);
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
    ${card(12, 'Action queue', 'Leads with no reply, estimates overdue, proposals with no follow-up, missed calls not called back',
      `<div class="chips" id="queueChips">${kinds.map(([k, t]) => `<button type="button" data-kind="${k}" aria-pressed="${state.queueKind === k}">${t} (${k === 'all' ? q.length : q.filter(i => i.kind === k).length})</button>`).join('')}</div>${queueList(shown.slice(0, 60))}`, shown.length > 60 ? `Showing 60 of ${shown.length}.` : '')}
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
    ${kpi('Sent within 1 business day', pct(e.turnaround.withinDay), `${int(e.turnaround.timed)} with a known request time`, e.turnaround.withinDay != null && e.turnaround.withinDay < 0.8 ? 'warn' : '')}
    ${kpi('Median turnaround', mins(e.turnaround.median), 'Business hours, lead to proposal sent')}
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
    ${kpi('Backlog', j.backlogWeeks == null ? '—' : dec(j.backlogWeeks) + ' weeks', `${money(j.openValue)} booked ÷ ${money(j.avgWeeklyCompleted)}/week`)}
    ${kpi('Crew backlog', j.backlogWeeksCrew == null ? '—' : dec(j.backlogWeeksCrew) + ' weeks', `${int(j.futureCrewDays)} crew-days scheduled ahead`)}
    ${kpi('Loads per truck per day', dec(j.loadsPerTruckDay), `${dec(j.loads)} loads · ${int(j.truckDays)} truck-days`)}
    ${kpi('Revenue per truck-day', money(j.revenuePerTruckDay), 'Move value spread over its runs')}
    ${kpi('Open jobs', int(j.openJobs), 'On the dispatch board now')}
  </div>
  <div class="grid">
    ${card(7, 'Completed per week', 'Job value closed as Completed on the board · last 8 weeks', barChart(j.weekly.map(w => ({ label: w.week, tip: `Week of ${shortDate(w.week)} · ${w.count} jobs`, value: w.value })), { format: (v, axis) => axis ? moneyShort(v) : money(v), labelFormat: shortDate }))}
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
    ['Lead', 'An opportunity created in the Demo, Labor or Containers pipeline, for a contact not typed Laborer. Change orders are not leads.'],
    ['Lead source', 'Opportunity source, else contact source. "Repeat customer" = that contact already had a won job.'],
    ['First response', 'First human outbound touch to the contact: a Twilio call, or an SMS / email / call in GHL conversations (workflow and bulk messages excluded), or an answered inbound call from them. Touches up to 1 hour before the lead was created count (the call that created it). Measured in business hours.'],
    ['Inbound calls', 'Twilio calls into A2Z numbers. Answered = the forwarded leg connected (or, with no forwarding, the call lasted the minimum seconds). Called back = any later outbound Twilio call to that number.'],
    ['Estimate sent', 'The opportunity entered Proposal Sent (Change Order Sent for change orders). Stage history is recorded by this dashboard from ' + (dq.history.stageTrackingSince ? shortDate(dq.history.stageTrackingSince) : 'its first sync') + '; earlier proposals use GHL\'s last stage change.'],
    ['Within 1 business day', 'Proposal sent within one business day of business hours after the lead was created.'],
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

// ---------- shell ----------
function renderShell() {
  const tabs = TABS.filter(t => !t.owner || state.viewer?.owner);
  if (!tabs.some(t => t.id === state.tab)) state.tab = 'overview';
  $('tabs').innerHTML = tabs.map(t => `<button class="tab" role="tab" type="button" data-tab="${t.id}" aria-selected="${t.id === state.tab}">${esc(t.label)}</button>`).join('');
  $('periodSeg').innerHTML = M.PERIODS.map(p => `<button type="button" data-period="${p.id}" aria-pressed="${p.id === state.period}">${p.label}</button>`).join('');
  const users = (state.snap?.users || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  $('repSelect').innerHTML = `<option value="">All reps</option>${users.map(u => `<option value="${esc(u.id)}" ${u.id === state.rep ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}`;
  $('settingsBtn').hidden = !state.viewer?.owner;
  $('who').textContent = state.viewer ? state.viewer.name : '';
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
  state.snap = data.snapshot; state.viewer = data.viewer; state.status = data.status; state.etag = data.snapshot ? `"${data.snapshot.builtAt}-${data.viewer.owner ? 'o' : 'v'}"` : '';
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
  render();
  setInterval(async () => { if (document.hidden || state.refreshing) return; try { if (await load()) render(); else $('freshness').textContent = `Updated ${ago(state.snap?.builtAt)}`; } catch {} }, 5 * 60000);
}

// ---------- events ----------
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab],[data-period],[data-kind]');
  if (!t) return;
  if (t.dataset.tab) { state.tab = t.dataset.tab; store.set('kpi-tab', state.tab); }
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
  $('rentalDays').value = s.rentalDays ?? 7; $('followUpDays').value = s.followUpDays ?? 3;
  $('openTime').value = s.businessHours?.open || '07:00'; $('closeTime').value = s.businessHours?.close || '17:00';
  const wd = new Set(s.workdays || [1, 2, 3, 4, 5, 6]);
  $('workdays').innerHTML = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => `<label><input type="checkbox" value="${i}" ${wd.has(i) ? 'checked' : ''}>${d}</label>`).join('');
  $('settingsError').textContent = '';
  $('settingsDialog').showModal();
});
$('settingsSave').addEventListener('click', async () => {
  const body = {
    containerFleet: Object.fromEntries([...document.querySelectorAll('#fleetRows input')].map(i => [i.dataset.size, Number(i.value) || 0])),
    rentalDays: Number($('rentalDays').value), followUpDays: Number($('followUpDays').value),
    businessHours: { open: $('openTime').value, close: $('closeTime').value },
    workdays: [...document.querySelectorAll('#workdays input:checked')].map(i => Number(i.value))
  };
  try { const r = await api('/api/settings', { method: 'POST', body: JSON.stringify(body) }); state.snap = { ...state.snap, settings: r.settings }; state.etag = ''; $('settingsDialog').close(); render(); }
  catch (e) { $('settingsError').textContent = e.message; }
});
attachTooltips(document.body, $('tooltip'));
boot();
