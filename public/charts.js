// Small inline-SVG charts (no library). Bars only: magnitude over time or categories.
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];

// Top of the axis = 4 equal, round steps (1, 2, 5 x 10^n; whole numbers below 10).
function niceMax(v) {
  if (!(v > 0)) return 4;
  const raw = v / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
  let step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 && p >= 10 ? 2.5 : n <= 5 ? 5 : 10) * p;
  if (step < 1) step = 1;
  return step * 4;
}
function topRounded(x, y, w, h, r) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// data: [{ label, tip?, <seriesKey>: number }]; series: [{ key, label }]
export function barChart(data, { series = [{ key: 'value', label: '' }], format = v => String(v), height = 200, stacked = true, labelEvery = 0, labelFormat = l => l } = {}) {
  if (!data.length) return '<div class="empty">No data in this period.</div>';
  const W = 640, H = height, padL = 44, padR = 8, padT = 10, padB = 24;
  const totals = data.map(d => stacked ? series.reduce((s, x) => s + (Number(d[x.key]) || 0), 0) : Math.max(...series.map(x => Number(d[x.key]) || 0)));
  const max = niceMax(Math.max(...totals));
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slot = plotW / data.length;
  const groupW = Math.max(2, Math.min(42, slot * 0.72));
  const y = v => padT + plotH - (v / max) * plotH;
  const every = labelEvery || Math.max(1, Math.ceil(data.length / 12));
  let svg = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, yy = y(v);
    svg += `<line class="${i ? 'gridline' : 'baseline'}" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/>`;
    svg += `<text class="axis" x="${padL - 6}" y="${yy + 3}" text-anchor="end">${esc(format(v, true))}</text>`;
  }
  data.forEach((d, i) => {
    const x0 = padL + slot * i + (slot - groupW) / 2;
    const tipLines = series.filter(s => s.label || series.length === 1).map(s => `${s.label ? esc(s.label) + ': ' : ''}${esc(format(Number(d[s.key]) || 0))}`);
    const tip = `<b>${esc(d.tip || labelFormat(d.label))}</b>${tipLines.join('<br>')}`;
    if (stacked) {
      let base = 0;
      series.forEach((s, si) => {
        const v = Number(d[s.key]) || 0; if (!v) return;
        const top = y(base + v), bottom = y(base);
        const gap = base > 0 ? 2 : 0;
        const isTop = series.slice(si + 1).every(n => !(Number(d[n.key]) > 0));
        const h = Math.max(0, bottom - top - gap);
        svg += isTop ? `<path d="${topRounded(x0, top, groupW, h, 4)}" fill="${SERIES[si % 5]}"/>` : `<rect x="${x0}" y="${top}" width="${groupW}" height="${h}" fill="${SERIES[si % 5]}"/>`;
        base += v;
      });
    } else {
      const bw = (groupW - 2 * (series.length - 1)) / series.length;
      series.forEach((s, si) => { const v = Number(d[s.key]) || 0; svg += `<path d="${topRounded(x0 + si * (bw + 2), y(v), bw, y(0) - y(v), 4)}" fill="${SERIES[si % 5]}"/>`; });
    }
    svg += `<rect class="hit" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${plotH}" fill="transparent" data-tip="${esc(tip)}"/>`;
    if (i % every === 0) svg += `<text class="axis" x="${padL + slot * i + slot / 2}" y="${H - 7}" text-anchor="middle">${esc(labelFormat(d.label))}</text>`;
  });
  const legend = series.length > 1 ? `<div class="legend">${series.map((s, i) => `<span><i style="background:${SERIES[i % 5]}"></i>${esc(s.label)}</span>`).join('')}</div>` : '';
  return `${legend}<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart">${svg}</svg></div>`;
}

// Horizontal bars inside a table cell.
export const barCell = (value, max, text) => `<div class="bar-cell"><div class="track"><div class="fill" style="width:${max > 0 ? Math.max(1, (value / max) * 100) : 0}%"></div></div><span>${esc(text)}</span></div>`;

export function attachTooltips(root, tooltip) {
  root.addEventListener('mousemove', e => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) { tooltip.hidden = true; return; }
    tooltip.innerHTML = t.getAttribute('data-tip');
    tooltip.hidden = false;
    const r = tooltip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tooltip.style.left = x + 'px'; tooltip.style.top = y + 'px';
  });
  root.addEventListener('mouseleave', () => { tooltip.hidden = true; });
}
