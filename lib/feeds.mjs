// The dispatch board and Ledger feeds (their /api/metrics-export), slimmed to what the dashboard uses.
import { phoneKey } from './normalize.mjs';

export async function fetchFeed({ url, key }, fetchImpl = fetch) {
  const res = await fetchImpl(`${url}/api/metrics-export`, { headers: { 'x-metrics-key': key, accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
  let body = null; try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error(`HTTP ${res.status}${body?.error ? ': ' + body.error : ''}`);
  if (!body || body.version !== 1) throw new Error('Unexpected feed format (update that site to the version with /api/metrics-export)');
  return body;
}

const arrIn = (data, keys) => {
  if (Array.isArray(data)) return data;
  for (const k of keys) { if (Array.isArray(data?.[k])) return data[k]; if (Array.isArray(data?.data?.[k])) return data.data[k]; }
  return [];
};
const parseMaybe = v => { if (typeof v !== 'string') return v || {}; try { return JSON.parse(v); } catch { return {}; } };
const crewOf = list => (Array.isArray(list) ? list : []).map(w => ({ id: String(w.id || w.contactId || ''), name: String(w.name || w.workerName || ''), phone: phoneKey(w.phone || w.workerPhone) })).filter(w => w.name);

export function slimDispatch(d) {
  const r = d.rosters || {};
  const hidden = new Set((d.hiddenWorkers || []).map(h => String(h.contactId || h.phone || h.name || '').toLowerCase()));
  const labor = [
    ...arrIn(r.labor?.data, ['labor', 'laborers']).map(w => { const c = parseMaybe(w.customData); return { id: String(w.id || w.contactId || w.contact_id || ''), name: String(w.name || w.full_name || w.fullName || c.name || ''), phone: phoneKey(w.phone || c.phone) }; }),
    ...(d.manualWorkers || []).filter(w => w.isLabor).map(w => ({ id: w.contactId, name: w.name, phone: phoneKey(w.phone) }))
  ].filter(w => w.name && !hidden.has(String(w.id || '').toLowerCase()) && !hidden.has(String(w.phone || '').toLowerCase()));
  const assets = arrIn(r.assets?.data, ['assets', 'assetRoster', 'equipment', 'lowboys']).flatMap(rec => Array.isArray(rec?.data?.assets) ? rec.data.assets.map(a => ({ ...a, id: a.id || a.assetId || rec.key })) : [rec])
    .map(a => ({ id: String(a.id || a.assetId || a.asset_id || ''), name: String(a.name || a.assetName || a.asset_name || a.unitName || a.unit || a.assetId || a.id || '') })).filter(a => a.id);
  return {
    serverTime: d.serverTime,
    jobs: (d.jobs || []).map(j => ({
      jobId: j.jobId, active: j.active !== false, status: j.status || '', jobType: j.jobType || '', pipelineId: j.pipelineId || '',
      value: Number(j.monetaryValue) || 0, reportDate: j.reportDate || '', reportEndDate: j.reportEndDate || '', crew: crewOf(j.crew),
      closedAt: j.closedAt || '', jobAddress: j.jobAddress || j.closedJobName || '', clientName: j.clientName || j.closedClientName || '',
      parentJobId: j.parentJobId || '', crewSize: j.crewSize ?? null, sentHome: (j.sentHome || []).map(s => ({ name: s.name, hoursWorked: Number(s.hoursWorked) || 0, reportDate: s.reportDate || '' })), updatedAt: j.updatedAt
    })),
    moves: (d.moves || []).map(m => ({
      moveId: m.moveId, status: m.status || '', active: m.active !== false, movementType: m.movementType || '', containerSize: m.containerSize || '',
      loadCount: Number(m.loadCount) || 1, sourceOpportunityId: m.sourceOpportunityId || m.opportunityId || m.jobId || '', sourceType: m.sourceType || '',
      value: Number(m.monetaryValue) || 0, completedAt: m.completedAt || '', closedAt: m.closedAt || '', closedSchedule: m.closedSchedule || null,
      scheduledDate: m.scheduledDate || m.requestedDate || '', driverName: m.driverName || '', assetIds: [...new Set([...(m.assets || []).map(a => String(a.assetId || a.id)), ...(m.closedAssetIds || [])])].filter(Boolean),
      address: m.destinationAddress || m.deliveryAddress || m.jobAddress || '', clientName: m.clientName || '', updatedAt: m.updatedAt
    })),
    moveRuns: (d.moveRuns || []).map(x => ({ moveId: x.moveId, date: x.runDate, movementType: x.movementType || '', containerSize: x.containerSize || '', loadCount: Number(x.loadCount) || 1,
      driverName: x.driverName || '', assetIds: x.assetIds || [], sourceOpportunityId: x.sourceOpportunityId || '', address: x.jobAddress || '', clientName: x.clientName || '', value: Number(x.monetaryValue) || 0, source: x.source })),
    jobDays: (d.jobDays || []).map(x => ({ jobId: x.jobId, date: x.reportDate, endDate: x.reportEndDate || '', crew: crewOf(x.crew), jobType: x.jobType || '', sentHome: (x.sentHome || []).map(s => ({ name: s.name, hoursWorked: Number(s.hoursWorked) || 0 })), source: x.source })),
    bookings: (d.bookings || []).filter(b => b.opportunityId).map(b => ({ opportunityId: b.opportunityId, kind: b.kind, bookedBy: b.bookedBy || '', at: b.at })),
    eodSheets: (d.eodSheets || []).map(e => ({ jobId: e.jobId, date: e.date, cost: e.totalJobCost, price: e.totalPriceToCustomer, at: e.at })),
    labor, assets,
    temperatures: (d.temperatures || []).map(t => ({ contactId: t.contactId, value: t.value })),
    health: d.health || {}
  };
}

export function slimLedger(l) {
  return {
    serverTime: l.serverTime,
    invoiceStages: l.invoiceStages || {}, invoiceStageEvents: l.invoiceStageEvents || {},
    invoices: (l.generatedInvoices || []).map(i => ({ opportunityId: i.opportunityId, number: i.invoiceNumber, date: i.invoiceDate, dueDate: i.dueDate, total: i.total, balance: i.balanceDue, client: i.billToName, contactId: i.ghlContactId })),
    bills: (l.bills || []).map(b => ({ id: b.id, vendor: b.vendorName, date: b.billDate, dueDate: b.dueDate, amount: b.amount, balance: b.balance, status: b.status, lines: b.lineItems, payments: b.payments })),
    payroll: l.payrollRuns || [],
    ar: l.arInvoices || [],
    baselineAsOf: l.ytdBaseline?.asOf || l.ytdBaseline?.asOfDate || ''
  };
}
