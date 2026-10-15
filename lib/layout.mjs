// Tile layout for the dashboard: which tiles are hidden, their order within each
// container, renamed labels and card widths. Senior admins edit it on the page;
// everyone else just sees the result. Pure cleaner so it's easy to test and the
// endpoint can't store junk. Shape:
//   { containers: { "<tab>:<kind>:<idx>": [key, ...] },   // order of tile keys
//     hidden: { "<cid>#<key>": true },                     // hidden tiles
//     labels: { "<cid>#<key>": "Custom label" },           // renamed tiles
//     spans:  { "<cid>#<key>": 3..12 } }                   // card width (12-col grid)
const str = (v, n = 80) => String(v ?? '').slice(0, n);
const okId = v => typeof v === 'string' && v.length > 0 && v.length <= 160;

export function emptyLayout() { return { containers: {}, hidden: {}, labels: {}, spans: {} }; }

export function cleanLayout(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const containers = {};
  if (r.containers && typeof r.containers === 'object') {
    for (const [cid, arr] of Object.entries(r.containers).slice(0, 80)) {
      if (!okId(cid) || !Array.isArray(arr)) continue;
      const seen = new Set(), list = [];
      for (const k of arr.slice(0, 200)) { const s = str(k, 120); if (s && !seen.has(s)) { seen.add(s); list.push(s); } }
      if (list.length) containers[cid] = list;
    }
  }
  const hidden = {};
  if (r.hidden && typeof r.hidden === 'object') for (const [k, v] of Object.entries(r.hidden).slice(0, 600)) if (okId(k) && v) hidden[k] = true;
  const labels = {};
  if (r.labels && typeof r.labels === 'object') for (const [k, v] of Object.entries(r.labels).slice(0, 600)) { if (!okId(k)) continue; const s = str(v, 80).trim(); if (s) labels[k] = s; }
  const spans = {};
  if (r.spans && typeof r.spans === 'object') for (const [k, v] of Object.entries(r.spans).slice(0, 600)) { const n = Math.round(Number(v)); if (okId(k) && n >= 3 && n <= 12) spans[k] = n; }
  return { containers, hidden, labels, spans };
}
