// Twilio call log for inbound answered / missed / called back and outbound response times.
import { phoneKey } from './normalize.mjs';
const API = 'https://api.twilio.com';

export function slimCall(c) {
  return { sid: c.sid, parent: c.parent_call_sid || '', dir: c.direction || '', from: phoneKey(c.from), to: phoneKey(c.to), status: c.status || '',
    start: c.start_time ? new Date(c.start_time).toISOString() : (c.date_created ? new Date(c.date_created).toISOString() : ''), dur: Number(c.duration) || 0 };
}

export async function fetchCalls(cfg, sinceDate, fetchImpl = fetch) {
  const t = cfg.twilio;
  const user = t.apiKeySid || t.accountSid, pass = t.apiKeySid ? t.apiKeySecret : t.authToken;
  const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  const out = [];
  let next = `/2010-04-01/Accounts/${encodeURIComponent(t.accountSid)}/Calls.json?${new URLSearchParams({ 'StartTime>': sinceDate, PageSize: '1000' })}`;
  for (let page = 0; next && page < 200; page++) {
    const res = await fetchImpl(API + next, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error(`Twilio ${res.status} listing calls`);
    const body = await res.json();
    for (const c of body.calls || []) out.push(slimCall(c));
    next = body.next_page_uri || '';
  }
  return out;
}

// Inbound calls to A2Z numbers with answered/missed and when a missed caller was
// called back. Answered: a forwarded leg (child call) connected; with no child legs
// in the account at all, a completed call of at least answerMinSeconds.
export function inboundCalls(calls, { numbers = [], answerMinSeconds = 20 } = {}) {
  const ours = new Set(numbers.map(phoneKey).filter(Boolean));
  const isOurs = n => !ours.size || ours.has(n);
  const children = new Map();
  for (const c of calls) if (c.parent) (children.get(c.parent) || children.set(c.parent, []).get(c.parent)).push(c);
  const usesForwarding = calls.some(c => c.parent && c.dir === 'outbound-dial');
  const bySid = new Map(calls.map(c => [c.sid, c]));
  const outboundByNumber = new Map();
  for (const c of calls) {
    if (!/^outbound/.test(c.dir) || !c.to || !c.start) continue;
    if (c.dir === 'outbound-dial' && c.parent && bySid.get(c.parent)?.dir === 'inbound') continue; // forwarding leg, not a callback
    (outboundByNumber.get(c.to) || outboundByNumber.set(c.to, []).get(c.to)).push(c.start);
  }
  for (const list of outboundByNumber.values()) list.sort();
  const result = [];
  for (const c of calls) {
    if (c.dir !== 'inbound' || !c.start || !isOurs(c.to)) continue;
    const legs = children.get(c.sid) || [];
    const answered = legs.length ? legs.some(l => l.status === 'completed' && l.dur > 0) : (!usesForwarding && c.status === 'completed' && c.dur >= answerMinSeconds);
    const after = (outboundByNumber.get(c.from) || []).find(t => t > c.start) || '';
    result.push({ sid: c.sid, at: c.start, from: c.from, to: c.to, answered, dur: Math.max(c.dur, ...legs.map(l => l.dur)), calledBackAt: answered ? '' : after });
  }
  return { inbound: result.sort((a, b) => (a.at < b.at ? 1 : -1)), mode: usesForwarding ? 'forwarding' : 'duration', outboundByNumber };
}
