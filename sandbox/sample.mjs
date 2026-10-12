// Sample snapshot for the local sandbox and the tests. Every name and number here is made up.
const DAY = 86400000;
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export function sampleSnapshot(now = Date.now(), seed = 7) {
  const r = rng(seed);
  const pick = list => list[Math.floor(r() * list.length)];
  const iso = ms => new Date(ms).toISOString();
  const day = ms => iso(ms).slice(0, 10);
  // Pacific business-ish time on a given day offset (UTC-7 approximation is fine for sample data).
  const dayStart = Math.floor((now - 7 * 3600000) / DAY) * DAY + 7 * 3600000;
  const at = (daysAgo, hour = 7 + r() * 10) => Math.min(now - 60000, dayStart - Math.floor(daysAgo) * DAY + hour * 3600000);
  const P = { demo: 'd5Ix1SlN3YpZ5gQewZUo', labor: 'RAP4Cqc1jKRTHaakYTL4', containers: 'F8i8hB7E5xHrJbJUXFr4', changeOrders: 'Nvk3EKhRzg5omo4BLCOK', hiring: 'VMYXilFR93XJEgprCi7j' };
  const stageDefs = {
    [P.demo]: ['New Lead', 'Site Walk', 'Proposal Sent', 'Negotiating', 'Scheduled', 'Invoice'],
    [P.labor]: ['New Lead', 'Proposal Sent', 'Booked', 'Invoice'],
    [P.containers]: ['New Request', 'Proposal Sent', 'Scheduled', 'On Site'],
    [P.changeOrders]: ['Change Order Sent', 'Approved'],
    [P.hiring]: ['Applied', 'Phone Screen', 'Interview', 'Onboarding']
  };
  const stages = {}, stageId = {};
  for (const [pid, names] of Object.entries(stageDefs)) names.forEach((n, i) => { const id = `${pid.slice(0, 4)}-s${i}`; stages[id] = { name: n, position: i, pipelineId: pid }; (stageId[pid] ||= {})[n] = id; });
  const proposalStageIds = [stageId[P.demo]['Proposal Sent'], stageId[P.labor]['Proposal Sent'], stageId[P.containers]['Proposal Sent'], stageId[P.changeOrders]['Change Order Sent']];
  const users = [{ id: 'u-maria', name: 'Maria Lopez' }, { id: 'u-dan', name: 'Dan Ortiz' }, { id: 'u-kim', name: 'Kim Tran' }];
  const first = ['Alex', 'Sam', 'Jordan', 'Chris', 'Pat', 'Taylor', 'Morgan', 'Casey', 'Jamie', 'Riley', 'Drew', 'Avery', 'Quinn', 'Reese', 'Rowan', 'Skyler'];
  const last = ['Nguyen', 'Garcia', 'Smith', 'Patel', 'Kim', 'Brown', 'Rivera', 'Lee', 'Walker', 'Hall', 'Young', 'King', 'Wright', 'Scott', 'Green', 'Baker'];
  const companies = ['Harbor Builders', 'Summit GC', 'Coastline Development', 'Irvine Ridge Homes', 'Pacific Crest Construction', 'Oakview Partners', 'Bayside Properties', 'Canyon Build Co'];
  const sources = ['Website form', 'Phone call', 'Google Ads', 'Email', 'Referral', 'Website form', 'Phone call', ''];
  const types = ['general-contractor', 'general-contractor', 'developer', 'home-owner', 'home-owner', 'home-owner', ''];
  const phone = i => '+1949' + String(5550000 + i).slice(-7);
  const contacts = [], opportunities = [], stageEvents = {}, messageTouches = {}, callTouches = {}, answeredInbound = {};
  for (let i = 0; i < 260; i++) {
    const type = pick(types);
    contacts.push({ id: `c${i}`, name: type === 'home-owner' || !type ? `${pick(first)} ${pick(last)}` : `${pick(first)} ${pick(last)} (${pick(companies)})`, company: '', type, source: pick(sources), temperature: '', phone: phone(i), assignedTo: pick(users).id, dateAdded: iso(at(400 * r())) });
  }
  let oppN = 0;
  for (let d = 400; d >= 0; d--) {
    const n = Math.floor(r() * 4) + (d % 7 === 0 ? 0 : 1);
    for (let k = 0; k < n; k++) {
      const c = contacts[Math.floor(r() * contacts.length)];
      const pid = pick([P.demo, P.labor, P.labor, P.containers, P.containers]);
      const created = at(d);
      const names = stageDefs[pid];
      const age = d;
      let status = 'open', stage = names[0];
      const proposal = r() < 0.8;
      if (age > 3 && proposal) stage = 'Proposal Sent';
      if (age > 6) { const x = r(); status = x < 0.48 ? 'won' : x < 0.82 ? 'lost' : 'open'; }
      if (status === 'won') stage = names[names.length - (r() < 0.5 ? 1 : 2)];
      if (status === 'lost') stage = proposal ? 'Proposal Sent' : names[0];
      const value = pid === P.demo ? Math.round(8000 + r() * 60000) : pid === P.labor ? Math.round(900 + r() * 7000) : Math.round(450 + r() * 900);
      const sentAt = created + (r() < 0.7 ? r() * 0.8 : 0.8 + r() * 3) * DAY;
      const closedAt = created + (5 + r() * 20) * DAY;
      const id = `o${oppN++}`;
      opportunities.push({ id, name: `${c.name} - ${pid === P.demo ? 'Demo' : pid === P.labor ? 'Labor crew' : '40yd container'}`, pipelineId: pid, stageId: stageId[pid][stage], status, value,
        createdAt: iso(created), updatedAt: iso(Math.min(now, closedAt)), stageChangedAt: iso(Math.min(now, status === 'open' ? sentAt : closedAt)), statusChangedAt: status === 'open' ? '' : iso(Math.min(now - 3600000, closedAt)),
        contactId: c.id, contactName: c.name, assignedTo: r() < 0.9 ? c.assignedTo : '', source: '', lostReason: status === 'lost' ? pick(['Price', 'Timing', 'Went with someone else', 'Price', 'No response', '']) : '' });
      if (proposal && sentAt < now && (status !== 'open' || age > 3)) stageEvents[id] = { [stageId[pid]['Proposal Sent']]: { at: iso(sentAt), src: d > 300 ? 'baseline' : 'sync' } };
      if (r() < 0.9 || d > 2) {
        const reply = created + (r() < 0.6 ? r() * 0.7 : 0.7 + r() * 6) * 3600000;
        if (reply < now) (messageTouches[c.id] ||= []).push({ at: iso(reply), channel: pick(['sms', 'call', 'email']) });
      }
      if (proposal && r() < 0.6) { const fu = sentAt + (1 + r() * 3) * DAY; if (fu < now) (messageTouches[c.id] ||= []).push({ at: iso(fu), channel: 'sms' }); }
      if (status === 'won' && r() < 0.15 && d > 30) {
        const co = `o${oppN++}`;
        opportunities.push({ id: co, name: `${c.name} - change order`, pipelineId: P.changeOrders, stageId: stageId[P.changeOrders]['Approved'], status: 'won', value: Math.round(value * (0.1 + r() * 0.3)), createdAt: iso(closedAt + DAY), updatedAt: iso(closedAt + 3 * DAY), stageChangedAt: iso(closedAt + 3 * DAY), statusChangedAt: iso(Math.min(now - 3600000, closedAt + 3 * DAY)), contactId: c.id, contactName: c.name, assignedTo: c.assignedTo, source: '', lostReason: '' });
        stageEvents[co] = { [stageId[P.changeOrders]['Change Order Sent']]: { at: iso(closedAt + DAY), src: 'sync' } };
      }
    }
  }
  for (const k of Object.keys(messageTouches)) messageTouches[k].sort((a, b) => (a.at < b.at ? -1 : 1));
  // Laborers + hiring
  const temps = ['vip', 'hot', 'hot', 'warm', 'warm', 'warm', 'cold', 'cold', ''];
  const laborContacts = [];
  for (let i = 0; i < 70; i++) { const c = { id: `L${i}`, name: `${pick(first)} ${pick(last)}`, company: '', type: 'laborer', source: 'Indeed', temperature: pick(temps), phone: phone(1000 + i), assignedTo: '', dateAdded: iso(at(380 * r())) }; laborContacts.push(c); contacts.push(c); }
  const hireEvents = {};
  for (const c of laborContacts) {
    const applied = at(10 + r() * 360);
    opportunities.push({ id: `h${c.id}`, name: c.name, pipelineId: P.hiring, stageId: stageId[P.hiring][pick(stageDefs[P.hiring])], status: c.temperature && c.temperature !== 'cold' ? 'won' : pick(['open', 'open', 'lost']), value: 0, createdAt: iso(applied), updatedAt: iso(applied + 4 * DAY), stageChangedAt: iso(applied + 2 * DAY), statusChangedAt: '', contactId: c.id, contactName: c.name, assignedTo: '', source: 'Indeed', lostReason: '' });
    if (['vip', 'hot', 'warm'].includes(c.temperature)) hireEvents[c.id] = applied < now - 300 * DAY ? { at: '', baseline: true, temp: c.temperature } : { at: iso(applied + (2 + r() * 10) * DAY), temp: c.temperature };
  }
  for (let i = 0; i < 25; i++) { const applied = at(r() * 60); const c = { id: `A${i}`, name: `${pick(first)} ${pick(last)}`, company: '', type: 'laborer', source: 'Indeed', temperature: '', phone: phone(2000 + i), assignedTo: '', dateAdded: iso(applied) }; contacts.push(c); opportunities.push({ id: `hA${i}`, name: c.name, pipelineId: P.hiring, stageId: stageId[P.hiring][pick(stageDefs[P.hiring].slice(0, 3))], status: 'open', value: 0, createdAt: iso(applied), updatedAt: iso(applied), stageChangedAt: iso(applied), statusChangedAt: '', contactId: c.id, contactName: c.name, assignedTo: '', source: 'Indeed', lostReason: '' }); }
  // Twilio inbound
  const inboundCalls = [];
  for (let d = 120; d >= 0; d--) for (let k = 0; k < 2 + Math.floor(r() * 5); k++) {
    const c = r() < 0.75 ? pick(contacts.filter(x => x.type !== 'laborer')) : null;
    const from = c ? c.phone : '+1714' + String(Math.floor(r() * 9e6) + 1e6);
    const t = at(d); if (t > now) continue;
    const answered = r() < 0.78;
    const calledBackAt = !answered && r() < 0.7 ? iso(t + (0.1 + r() * 5) * 3600000) : '';
    inboundCalls.push({ sid: `CA${d}${k}`, at: iso(t), from, to: '+19497763898', answered, dur: answered ? Math.round(30 + r() * 400) : 0, calledBackAt: calledBackAt && Date.parse(calledBackAt) < now ? calledBackAt : '' });
    if (answered) (answeredInbound[from] ||= []).push(iso(t));
    if (calledBackAt) (callTouches[from] ||= []).push(calledBackAt);
  }
  inboundCalls.sort((a, b) => (a.at < b.at ? 1 : -1));
  // Dispatch
  const crewPool = laborContacts.filter(c => ['vip', 'hot', 'warm'].includes(c.temperature));
  const jobs = [], jobDays = [], bookings = [], eodSheets = [], moves = [], moveRuns = [];
  const assets = [{ id: 'T1', name: 'Truck 1 (F-550)' }, { id: 'T2', name: 'Truck 2 (Roll-off)' }, { id: 'T3', name: 'Truck 3 (Roll-off)' }, { id: 'LB1', name: 'Lowboy' }];
  for (const o of opportunities.filter(o => o.status === 'won' && (o.pipelineId === P.labor || o.pipelineId === P.demo || o.pipelineId === P.changeOrders))) {
    const start = Date.parse(o.statusChangedAt) + (1 + r() * 6) * DAY;
    const length = o.pipelineId === P.demo ? 2 + Math.floor(r() * 6) : 1 + Math.floor(r() * 2);
    const crewSize = o.pipelineId === P.demo ? 3 + Math.floor(r() * 4) : 1 + Math.floor(r() * 3);
    const crew = Array.from({ length: crewSize }, () => pick(crewPool)).filter((v, i, a) => a.indexOf(v) === i).map(c => ({ id: c.id, name: c.name, phone: c.phone }));
    const endMs = start + (length - 1) * DAY;
    const done = endMs + DAY < now;
    for (let i = 0; i < length; i++) { const ds = start + i * DAY; if (ds < now - DAY) jobDays.push({ jobId: o.id, date: day(ds), endDate: day(ds), crew, jobType: o.pipelineId === P.demo ? 'contract' : 'hourly', sentHome: r() < 0.05 ? [{ name: crew[0]?.name, hoursWorked: 4 }] : [], source: 'eod' }); }
    const late = r() < 0.18;
    jobs.push({ jobId: o.id, active: !done, status: done ? (r() < 0.04 ? 'cancelled' : 'completed') : '', jobType: o.pipelineId === P.demo ? 'contract' : 'hourly', pipelineId: o.pipelineId, value: o.value,
      reportDate: done ? '' : day(Math.max(start, now)), reportEndDate: done ? '' : day(Math.max(endMs, now)), crew: done ? [] : crew, closedAt: done ? iso(endMs + (late ? 2 : 0.3) * DAY) : '', jobAddress: `${100 + Math.floor(r() * 9000)} ${pick(['Main St', 'Jamboree Rd', 'Alton Pkwy', 'Culver Dr', 'Barranca Pkwy'])}`, clientName: o.contactName, parentJobId: o.pipelineId === P.changeOrders ? 'parent' : '', crewSize, sentHome: [], updatedAt: iso(now) });
    if (o.pipelineId === P.labor && r() < 0.7) bookings.push({ opportunityId: o.id, kind: 'job', bookedBy: pick(users).name, at: o.statusChangedAt });
    if (done && o.pipelineId !== P.changeOrders) eodSheets.push({ jobId: o.id, date: day(endMs), cost: Math.round(o.value * (0.45 + r() * 0.45)), price: o.value, at: iso(endMs) });
  }
  for (const o of opportunities.filter(o => o.pipelineId === P.containers && o.status === 'won')) {
    const drop = Date.parse(o.statusChangedAt) + r() * 2 * DAY;
    if (drop > now) continue;
    const size = pick(['10 Yard', '40 Yard', '40 Yard']);
    const truck = pick(assets.slice(1, 3)).id;
    moveRuns.push({ moveId: `m${o.id}`, date: day(drop), movementType: 'container_drop', containerSize: size, loadCount: 1, driverName: 'Luis', assetIds: [truck], sourceOpportunityId: o.id, address: o.name, clientName: o.contactName, value: o.value, source: 'reset_day' });
    let t = drop;
    if (r() < 0.35) { t += (2 + r() * 4) * DAY; if (t < now) moveRuns.push({ moveId: `m${o.id}`, date: day(t), movementType: 'container_swap', containerSize: size, loadCount: 1, driverName: 'Luis', assetIds: [truck], sourceOpportunityId: o.id, address: o.name, clientName: o.contactName, value: o.value, source: 'reset_day' }); }
    const back = drop + (3 + r() * 12) * DAY;
    if (back < now - 0.5 * DAY && r() < 0.93) moveRuns.push({ moveId: `m${o.id}`, date: day(back), movementType: 'container_pickup', containerSize: size, loadCount: 1, driverName: 'Luis', assetIds: [truck], sourceOpportunityId: o.id, address: o.name, clientName: o.contactName, value: o.value, source: 'complete' });
    moves.push({ moveId: `m${o.id}`, status: back < now ? 'completed' : 'assigned', active: back >= now, movementType: 'container_drop', containerSize: size, loadCount: 1, sourceOpportunityId: o.id, sourceType: 'container', value: o.value, completedAt: back < now ? iso(back) : '', closedAt: back < now ? iso(back) : '', closedSchedule: back < now ? { date: day(back), time: '08:00' } : null, scheduledDate: '', driverName: '', assetIds: [], address: o.name, clientName: o.contactName, updatedAt: iso(now) });
  }
  for (const j of jobs.filter(j => j.jobType === 'contract')) for (let i = 0; i < 2; i++) { const d0 = jobDays.find(x => x.jobId === j.jobId); if (d0) moveRuns.push({ moveId: `haul-${j.jobId}-${i}`, date: d0.date, movementType: 'dump_and_return', containerSize: '40 Yard', loadCount: 1, driverName: 'Rafa', assetIds: ['T1'], sourceOpportunityId: j.jobId, address: j.jobAddress, clientName: j.clientName, value: 0, source: 'reset_day' }); }
  // Ledger
  const invoiceStages = {}, invoiceStageEvents = {}, invoices = [];
  let num = 31600;
  for (const j of jobs.filter(j => j.status === 'completed')) {
    const issued = Date.parse(j.closedAt) + r() * 3 * DAY; if (issued > now) continue;
    const terms = pick([7, 30, 30, 45]);
    const paidAt = issued + (5 + r() * 50) * DAY;
    const stage = paidAt < now ? 'paid' : issued + terms * DAY < now ? 'overdue' : 'sent';
    invoiceStages[j.jobId] = stage;
    invoiceStageEvents[j.jobId] = { sent: iso(issued), ...(stage === 'paid' ? { paid: iso(paidAt) } : {}), ...(stage === 'overdue' ? { overdue: iso(issued + terms * DAY) } : {}) };
    invoices.push({ opportunityId: j.jobId, number: String(num++), date: day(issued), dueDate: day(issued + terms * DAY), total: j.value, balance: stage === 'paid' ? 0 : j.value, client: j.clientName, contactId: null });
  }
  const bills = [];
  for (let d = 380; d >= 0; d -= 3) {
    const cat = pick(['Materials', 'Fuel', 'Equipment Rental', 'Subcontractor', 'Insurance', 'Utilities', 'Office/Admin', 'Permits & Fees', 'Fuel']);
    const amount = Math.round(150 + r() * 4000);
    const date = day(now - d * DAY); const paid = d > 25 && r() < 0.9;
    bills.push({ id: `b${d}`, vendor: pick(['OC Dump & Recycle', 'Sunbelt Rentals', 'Chevron', 'Home Depot Pro', 'State Fund', 'SCE']), date, dueDate: day(now - (d - 30) * DAY), amount, balance: paid ? 0 : amount, status: paid ? 'paid' : pick(['pending', 'approved']), lines: [{ category: cat, amount }], payments: paid ? [{ amount, date: day(now - (d - 20) * DAY) }] : [] });
  }
  const payroll = [];
  for (let w = 52; w >= 1; w--) { const end = now - w * 7 * DAY; const gross = Math.round(9000 + r() * 9000); payroll.push({ id: `p${w}`, periodStart: day(end - 6 * DAY), periodEnd: day(end), payDate: day(end + 5 * DAY), grossPayroll: gross, employerBurden: Math.round(gross * 0.3), totalCost: Math.round(gross * 1.3), hours: Math.round(gross / 24) }); }
  const ok = { ok: true, at: iso(now - 4 * 60000), checkedAt: iso(now - 4 * 60000), error: '' };
  return {
    version: 1, sample: true, builtAt: iso(now - 4 * 60000),
    settings: { containerFleet: { '10 Yard': 12, '40 Yard': 18 }, rentalDays: 7, followUpDays: 3, workdays: [1, 2, 3, 4, 5, 6], businessHours: { open: '07:00', close: '17:00' } },
    config: { timeZone: 'America/Los_Angeles', locationId: 'QUcu2PEAxPV1sQm1GQCq', ghlAppUrl: 'https://app.gohighlevel.com', pipelines: P,
      pipelineNames: { [P.demo]: 'Demo', [P.labor]: 'Labor', [P.containers]: 'Containers', [P.changeOrders]: 'Change Orders', [P.hiring]: 'Hiring' },
      stages, proposalStageIds, customerTypes: ['general-contractor', 'developer', 'home-owner'], laborerTypes: ['laborer'], activeTemps: ['warm', 'hot', 'vip'], dormantTemps: ['cold'], contactTypeSource: 'GHL contact type' },
    users, opportunities, contacts, stageEvents, hireEvents, messageTouches, callTouches, answeredInbound, inboundCalls,
    history: { stageTrackingSince: iso(now - 300 * DAY), hireTrackingSince: iso(now - 300 * DAY) },
    dispatch: { serverTime: iso(now), jobs, moves, moveRuns, jobDays, bookings, eodSheets, labor: crewPool.map(c => ({ id: c.id, name: c.name, phone: c.phone })), assets, temperatures: [], health: { makeRuns30d: [], pendingGhlScheduleSyncs: 0 } },
    ledger: { serverTime: iso(now), invoiceStages, invoiceStageEvents, invoices, bills, payroll, ar: [], baselineAsOf: '2026-08-31' },
    feeds: {
      ghl: { ...ok, counts: { opportunities: opportunities.length, contacts: contacts.length, contactsScanned: contacts.length + 900, stageEventsRecorded: 3, hiresRecorded: 0 }, apiCalls: 41 },
      conversations: { ...ok, counts: { lookedUp: 12, failed: 0, cached: Object.keys(messageTouches).length, pending: 0 } },
      twilio: { ...ok, counts: { calls: inboundCalls.length * 2, inbound: inboundCalls.length, fetched: 40 }, answerMode: 'forwarding', numbersFiltered: true },
      dispatch: ok, ledger: ok, webhook: { ok: false, at: '', received: 0, optional: true }
    }
  };
}
