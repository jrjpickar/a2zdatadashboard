// Workflow run stats from GHL's workflow logs, sent by the browser feed
// (public/ghl-workflow-feed.js, loaded through GHL's agency Custom JS).
// The browser sends slim log rows; this file dedupes them and keeps daily
// aggregates per workflow, recent issues, per-workflow paging state and the
// overview numbers (statistics, weekly enrollments, trigger match count).
// Pure functions over a plain object so they're easy to test.

const DAY = 86400000;
const MAX_ISSUES = 400;
const SEEN_DAYS = 45;

export function emptyWorkflowData() {
  return { version: 2, progress: {}, progressSince: '', daily: {}, runs: {}, seen: {}, issues: [], state: {}, overview: null, lease: null, lastIngestAt: '', lastRunBy: '', updatedAt: '' };
}

// One log row from /workflows/logs/v2, slimmed in the browser to:
// { id, wf, run, at, status, type, step, contactId, contactName, reason, end }
export function cleanRow(r) {
  if (!r || typeof r !== 'object') return null;
  const s = v => String(v ?? '').slice(0, 200);
  const at = Date.parse(r.at);
  if (!r.id || !r.wf || !Number.isFinite(at)) return null;
  return { id: s(r.id), wf: s(r.wf), run: s(r.run), at: new Date(at).toISOString(), status: s(r.status).toLowerCase(), type: s(r.type), step: s(r.step), stepId: s(r.stepId), contactId: s(r.contactId), contactName: s(r.contactName), reason: s(r.reason), end: !!r.end };
}
export const isFailed = r => r.status === 'failed' || r.status === 'error' || r.status === 'errored';
export const isSkipped = r => r.status === 'skipped';
export const isFinished = r => r.end || r.status === 'finished';

const dayOf = (iso, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

// Adds rows (any order, duplicates allowed). Returns how many were new.
// Keep compact per-enrollment observations, not raw logs. Replaying a window is safe:
// first/last timestamps and flags merge without incrementing stage counts.
export function prepareWorkflowProgress(data) {
  if (data.version !== 2) {
    data.version = 2;
    data.progress = {};
    data.progressSince = '';
    // One bounded replay of the existing 30-day window, using the usual page budget.
    // Keep daily stats and dedupe IDs intact.
    data.state = {};
  }
  data.progress ||= {};
}

function observeProgress(data, r, now) {
  if (!r.run || Date.parse(r.at) < now - 90 * DAY) return;
  const key = JSON.stringify([r.wf, r.run]);
  const run = data.progress[key] ||= { wf: r.wf, run: r.run, firstAt: r.at, lastAt: r.at,
    contactId: r.contactId, contactName: r.contactName, steps: {}, finishedAt: '' };
  if (r.at < run.firstAt) run.firstAt = r.at;
  if (r.at >= run.lastAt) {
    run.lastAt = r.at; run.status = r.status; run.step = r.step || r.type;
    if (r.contactId) run.contactId = r.contactId;
    if (r.contactName) run.contactName = r.contactName;
  }
  if (!run.contactId && r.contactId) run.contactId = r.contactId;
  if (!run.contactName && r.contactName) run.contactName = r.contactName;
  if (isFinished(r) && (!run.finishedAt || r.at < run.finishedAt)) run.finishedAt = r.at;
  if (r.step || r.stepId) {
    const id = r.stepId ? JSON.stringify(['id', r.stepId]) : JSON.stringify(['name', r.type, r.step]);
    const st = run.steps[id] ||= { id, name: r.step || r.type || 'Unnamed step', type: r.type,
      identified: !!r.stepId, firstAt: r.at, lastAt: r.at, status: r.status, successful: false, failed: false, skipped: false };
    if (r.at < st.firstAt) st.firstAt = r.at;
    if (r.at >= st.lastAt) { st.lastAt = r.at; st.status = r.status; st.name = r.step || st.name; }
    st.successful ||= ['success', 'finished', 'completed'].includes(r.status);
    st.failed ||= isFailed(r);
    st.skipped ||= isSkipped(r);
  }
}

export function ingestRows(data, rows, { tz = 'America/Los_Angeles', now = Date.now() } = {}) {
  prepareWorkflowProgress(data);
  data.progressSince ||= new Date(now).toISOString();
  let added = 0;
  for (const raw of rows) {
    const r = cleanRow(raw);
    if (!r) continue;
    observeProgress(data, r, now);
    if (data.seen[r.id]) continue;
    data.seen[r.id] = r.at;
    added++;
    const day = dayOf(r.at, tz);
    const wf = data.daily[r.wf] ||= {};
    const d = wf[day] ||= { runs: 0, finished: 0, steps: 0, skipped: 0, failed: 0, reasons: {} };
    d.steps++;
    // A run (enrollment) is counted once, on the day its first row is seen.
    if (r.run && !data.runs[r.run]) { data.runs[r.run] = { day, wf: r.wf }; d.runs++; }
    if (isFinished(r) && r.run && !data.runs[r.run].finished) { data.runs[r.run].finished = true; d.finished++; }
    if (isSkipped(r) || isFailed(r)) {
      if (isSkipped(r)) d.skipped++; else d.failed++;
      const key = (r.reason || r.step || 'Unknown').replace(/^Internal Action Error - /, '').slice(0, 120);
      d.reasons[key] = (d.reasons[key] || 0) + 1;
      data.issues.push({ wf: r.wf, at: r.at, status: r.status, step: r.step, type: r.type, reason: r.reason, contactId: r.contactId, contactName: r.contactName, run: r.run });
    }
  }
  if (added) {
    data.issues.sort((a, b) => (a.at < b.at ? 1 : -1));
    data.issues = data.issues.slice(0, MAX_ISSUES);
  }
  prune(data, now);
  return added;
}

function prune(data, now) {
  const progressCut = new Date(now - 90 * DAY).toISOString();
  for (const [key, run] of Object.entries(data.progress || {})) if (run.lastAt < progressCut) delete data.progress[key];
  const cut = new Date(now - SEEN_DAYS * DAY).toISOString();
  for (const [id, at] of Object.entries(data.seen)) if (at < cut) delete data.seen[id];
  const cutDay = new Date(now - SEEN_DAYS * DAY).toISOString().slice(0, 10);
  for (const [id, r] of Object.entries(data.runs)) if (r.day < cutDay) delete data.runs[id];
  const keepDay = new Date(now - 400 * DAY).toISOString().slice(0, 10);
  for (const wf of Object.values(data.daily)) for (const day of Object.keys(wf)) if (day < keepDay) delete wf[day];
}

// Paging state per workflow, reported by the browser after each workflow:
//   newest:  end of the last fully scanned window (next window starts here, minus overlap)
//   pending: { from, to, cursor } when a window was cut short by the page budget
export function applyState(data, wf, st) {
  if (!wf || !st || typeof st !== 'object') return;
  const iso = v => (v && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : '');
  const prev = data.state[wf] || {};
  const pending = st.pending && st.pending.cursor ? {
    from: iso(st.pending.from), to: iso(st.pending.to),
    cursor: { createdAt: iso(st.pending.cursor.createdAt), sequence: Number(st.pending.cursor.sequence) || 0, id: String(st.pending.cursor.id || '').slice(0, 64) }
  } : null;
  data.state[wf] = { newest: iso(st.newest) || prev.newest || '', pending, checkedAt: new Date().toISOString(), lastError: String(st.error || '').slice(0, 200) };
}

// Lease so only one open GHL tab does the work each interval.
export function claimLease(data, who, now = Date.now(), minutes = 25) {
  const fresh = data.lease && now - Date.parse(data.lease.at) < minutes * 60000;
  // Within the interval nobody starts a new run: not another tab, and not the tab that just finished.
  if (fresh && (data.lease.who !== who || data.lease.done)) return false;
  data.lease = { who: String(who).slice(0, 80), at: new Date(now).toISOString() };
  return true;
}

export function applyOverview(data, o) {
  if (!o || typeof o !== 'object') return;
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
  const weekly = Array.isArray(o.weekly) ? o.weekly.map(w => ({ weekStart: String(w.weekStart || '').slice(0, 10), enrollments: num(w.enrollments) })).filter(w => /^\d{4}-\d{2}-\d{2}$/.test(w.weekStart)) : [];
  const hist = { ...(data.overview?.weeklyHistory || {}) };
  for (const w of weekly) hist[w.weekStart] = w.enrollments;
  const prev = data.overview || {};
  const keep = (v, old) => (v == null ? (old ?? null) : v);
  data.overview = {
    at: new Date().toISOString(),
    totalWorkflows: keep(num(o.statistics?.totalWorkflows), prev.totalWorkflows), publishedWorkflows: keep(num(o.statistics?.publishedWorkflows), prev.publishedWorkflows), totalEnrollments: keep(num(o.statistics?.totalEnrollments), prev.totalEnrollments),
    trigger: o.trigger ? { total: num(o.trigger.total), matched: num(o.trigger.matched), days: num(o.trigger.days) || 30 } : prev.trigger || null,
    weeklyHistory: hist
  };
}

// What the dashboard page needs (no seen-ids or run maps).
export function publicWorkflowData(data, { includeProgress = false, tz = 'America/Los_Angeles' } = {}) {
  if (!data) return null;
  // Small date/count summary lets the UI choose a populated workflow without
  // sending raw run/contact history in the main dashboard response.
  const progressDaily = {};
  const progressDay = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  for (const run of Object.values(data.progress || {})) {
    const wf = progressDaily[run.wf] ||= {};
    const day = progressDay.format(new Date(run.firstAt));
    wf[day] = (wf[day] || 0) + 1;
  }
  return { progressDaily, progressTimeZone: tz, ...(includeProgress ? { progress: data.progress || {} } : {}), progressSince: data.progressSince || '', retentionDays: 90, daily: data.daily, issues: data.issues.slice(0, 200), overview: data.overview, state: data.state, lastIngestAt: data.lastIngestAt, lastRunBy: data.lastRunBy };
}
