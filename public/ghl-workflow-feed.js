/* A2Z workflow stats feed. Loaded inside GHL through the agency Custom JS:
 *   <script src="https://YOUR-KPI-SITE/ghl-workflow-feed.js" data-key="WORKFLOW_FEED_KEY" async></script>
 *
 * GHL's workflow numbers only come from GHL's internal API, which needs the logged-in
 * user's session. This script runs inside GHL (same site), reuses the headers GHL's own
 * requests carry (it never reads or stores a password or token anywhere), and every
 * ~30 minutes - in only one open tab, decided by the dashboard - reads new workflow log
 * rows and the overview numbers, and sends slim rows (no message text) to the dashboard.
 *
 * Paging: GHL's logs are newest-first with a cursor (action=next + referenceCreatedAt /
 * referenceSequence / referenceId of the last row). Each workflow scans only the window
 * since its last complete scan (10 min overlap; the dashboard drops duplicates). If the
 * per-run request budget runs out mid-window, the cursor is saved and the next run
 * continues exactly there, so nothing is skipped.
 */
(function () {
  'use strict';
  if (window.__a2zWorkflowFeed) return;
  window.__a2zWorkflowFeed = true;
  var me = document.currentScript || {};
  var ds = me.dataset || {};
  var CFG = {
    endpoint: ds.endpoint || (me.src ? new URL('/api/workflow-feed', me.src).href : ''),
    key: ds.key || '',
    location: ds.location || 'QUcu2PEAxPV1sQm1GQCq',
    checkEveryMs: Number(ds.checkMinutes || 5) * 60000,
    pageLimit: 50,      // rows asked per page
    minFullPage: 10,    // GHL's own page asks 11; a page with fewer rows than this is the last
    maxRequests: 160,   // GHL requests per run, across all workflows
    pauseMs: 300,       // between GHL requests
    backfillDays: 30
  };
  var API = 'https://backend.leadconnectorhq.com';
  var DAY = 86400000;
  var nativeFetch = window.fetch.bind(window);
  var headers = null; // last header set GHL itself sent to backend.leadconnectorhq.com
  var who = 'tab-' + Math.random().toString(36).slice(2, 10);
  var running = false;

  // ---- borrow GHL's own request headers (Authorization etc.) ----
  function keep(h) {
    var out = {};
    Object.keys(h || {}).forEach(function (k) {
      var lk = k.toLowerCase();
      if (lk === 'content-type' || lk === 'content-length' || lk === 'cookie') return;
      out[lk] = h[k];
    });
    if (out.authorization && /^Bearer\s+\S{20,}/.test(out.authorization)) headers = out;
  }
  function headerObj(h) {
    var o = {};
    if (!h) return o;
    if (typeof Headers !== 'undefined' && h instanceof Headers) { h.forEach(function (v, k) { o[k] = v; }); return o; }
    if (Array.isArray(h)) { h.forEach(function (p) { o[p[0]] = p[1]; }); return o; }
    return Object.assign(o, h);
  }
  window.fetch = function (input, init) {
    try {
      var url = String((input && input.url) || input);
      if (url.indexOf('backend.leadconnectorhq.com') !== -1) keep(Object.assign(headerObj(input && input.headers), headerObj(init && init.headers)));
    } catch (e) { /* never break GHL */ }
    return nativeFetch.apply(window, arguments);
  };
  if (window.XMLHttpRequest) {
    var XP = window.XMLHttpRequest.prototype, oOpen = XP.open, oSet = XP.setRequestHeader, oSend = XP.send;
    XP.open = function (m, url) { this.__a2zUrl = String(url || ''); this.__a2zH = {}; return oOpen.apply(this, arguments); };
    XP.setRequestHeader = function (k, v) { try { if (this.__a2zH) this.__a2zH[k] = v; } catch (e) {} return oSet.apply(this, arguments); };
    XP.send = function () { try { if (this.__a2zUrl && this.__a2zUrl.indexOf('backend.leadconnectorhq.com') !== -1) keep(this.__a2zH); } catch (e) {} return oSend.apply(this, arguments); };
  }

  // ---- helpers ----
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function qs(o) { return Object.keys(o).filter(function (k) { return o[k] !== undefined && o[k] !== null && o[k] !== ''; }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); }
  function ghl(path, params) {
    if (!headers) return Promise.reject(new Error('no GHL session yet'));
    return nativeFetch(API + path + '?' + qs(params), { headers: Object.assign({ accept: 'application/json' }, headers) }).then(function (r) {
      if (r.status === 401 || r.status === 403) { headers = null; throw new Error('GHL session expired (' + r.status + ')'); }
      if (!r.ok) throw new Error('GHL ' + r.status + ' on ' + path);
      return r.json();
    });
  }
  function feed(body) {
    body.key = CFG.key; body.who = who;
    return nativeFetch(CFG.endpoint, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }
  function reasonOf(r) {
    var m = r.meta || {}, d = m.data || (m.actionFrom && m.actionFrom.response) || null;
    if (d && (d.success === false || d.isSkipped)) {
      if (d.msg) return String(d.msg);
      try { return JSON.parse(d.executionResponse).message || ''; } catch (e) { return ''; }
    }
    return String(m.reason || m.message || m.error || '');
  }
  function slim(r) {
    var m = r.meta || {};
    return {
      id: r._id, wf: r.workflowId, run: r.workflowStatusId, at: r.createdAt, status: r.status, type: r.type, step: r.stepName,
      contactId: r.contactId || r.entityId || '', contactName: r.contactName || r.displayName || '',
      reason: (r.status === 'success' || r.status === 'finished') ? '' : reasonOf(r),
      end: !!(m.removedFrom && m.removedFrom.type === 'end_of_workflow') || r.type === 'end_of_workflow'
    };
  }
  function listOf(page) { return Array.isArray(page) ? page : (page && (page.logs || page.data || page.items)) || []; }

  // One workflow: scan its window newest-first with the cursor until done or out of budget.
  function scan(wf, budget) {
    var now = Date.now(), from, to, cursor = null;
    if (wf.pending && wf.pending.cursor) { from = Date.parse(wf.pending.from); to = Date.parse(wf.pending.to); cursor = wf.pending.cursor; }
    else { from = (wf.newest ? Date.parse(wf.newest) : now - CFG.backfillDays * DAY) - 10 * 60000; to = now; }
    var rows = [], done = false;
    function page() {
      if (budget.left <= 0) return Promise.resolve();
      budget.left--;
      var q = { locationId: CFG.location, workflowId: wf.id, limit: CFG.pageLimit, action: cursor ? 'next' : 'first', dateType: 'custom', fromDate: String(from), toDate: String(to) };
      if (cursor) { q.referenceCreatedAt = cursor.createdAt; q.referenceSequence = cursor.sequence; q.referenceId = cursor.id; }
      return ghl('/workflows/logs/v2', q).then(function (p) {
        var list = listOf(p);
        list.forEach(function (r) { rows.push(slim(r)); });
        var last = list[list.length - 1];
        if (!last || list.length < CFG.minFullPage || (cursor && last._id === cursor.id)) { done = true; return; }
        cursor = { createdAt: last.createdAt, sequence: last.sequence, id: last._id };
        return sleep(CFG.pauseMs).then(page);
      });
    }
    return page().then(function () {
      var state = done ? { newest: new Date(to).toISOString(), pending: null } : { newest: wf.newest || '', pending: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), cursor: cursor } };
      return { rows: rows, state: state };
    }, function (err) {
      var state = { newest: wf.newest || '', pending: wf.pending || null, error: err.message };
      return { rows: rows, state: state, error: err };
    });
  }

  function overview() {
    var now = Date.now();
    return Promise.all([
      ghl('/workflows/statistics', { locationId: CFG.location }).catch(function () { return null; }),
      ghl('/workflows/logs/weekly-enrollment-data', { locationId: CFG.location }).catch(function () { return null; }),
      ghl('/workflows/trigger/logs/count', { locationId: CFG.location, dateType: 'custom', fromDate: String(now - 30 * DAY), toDate: String(now) }).catch(function () { return null; })
    ]).then(function (r) {
      var trig = Array.isArray(r[2]) ? r[2][0] : r[2];
      return feed({ action: 'overview', statistics: r[0], weekly: Array.isArray(r[1]) ? r[1] : [], trigger: trig ? { total: trig.total, matched: trig.matched, days: 30 } : null });
    });
  }

  function run() {
    if (running || !CFG.key || !CFG.endpoint || !headers) return Promise.resolve('skip');
    if (String(location.pathname).indexOf('/location/' + CFG.location) === -1) return Promise.resolve('other location');
    running = true;
    return feed({ action: 'claim' }).then(function (c) {
      if (!c || !c.go) return 'not my turn';
      var list = (c.workflows || []).slice().sort(function (a, b) { return (b.pending ? 1 : 0) - (a.pending ? 1 : 0) || String(a.newest).localeCompare(String(b.newest)); });
      var budget = { left: CFG.maxRequests };
      var chain = overview().catch(function () {});
      list.forEach(function (wf) {
        chain = chain.then(function () {
          if (budget.left <= 0 || !headers) return;
          return scan(wf, budget).then(function (res) {
            var sends = [], rows = res.rows;
            if (!rows.length) sends.push(feed({ action: 'ingest', wf: wf.id, rows: [], state: res.state }));
            for (var i = 0; i < rows.length; i += 2000) sends.push(feed({ action: 'ingest', wf: wf.id, rows: rows.slice(i, i + 2000), state: i + 2000 >= rows.length ? res.state : null }));
            return Promise.all(sends);
          });
        });
      });
      return chain.then(function () { return feed({ action: 'done' }); }).then(function () { return 'done'; });
    }).catch(function (e) { return 'error: ' + e.message; }).then(function (r) { running = false; return r; });
  }

  window.__a2zWorkflowFeedRun = run; // for a manual test from the console
  setTimeout(run, 20000);
  setInterval(run, CFG.checkEveryMs);
})();
